pub mod bm25;
pub mod chunker;
pub mod context_store;
pub mod variable_store;

use std::collections::HashMap;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};

use crate::rlm::context_store::ContextStore;
use crate::rlm::variable_store::VariableStore;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "value")]
pub enum ChunkStrategy {
    #[serde(rename = "fixed_char")]
    FixedChar(usize),
    #[serde(rename = "paragraph")]
    Paragraph,
    #[serde(rename = "sentence")]
    Sentence,
}

impl Default for ChunkStrategy {
    fn default() -> Self {
        ChunkStrategy::FixedChar(8000)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RlmConfig {
    #[serde(default = "default_max_depth")]
    pub max_depth: u32,
    #[serde(default = "default_chunk_size")]
    pub chunk_size: usize,
    #[serde(default)]
    pub chunk_strategy: ChunkStrategy,
    #[serde(default)]
    pub context_type: Option<String>,
}

fn default_max_depth() -> u32 {
    5
}

fn default_chunk_size() -> usize {
    8000
}

impl Default for RlmConfig {
    fn default() -> Self {
        Self {
            max_depth: default_max_depth(),
            chunk_size: default_chunk_size(),
            chunk_strategy: ChunkStrategy::default(),
            context_type: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status")]
pub enum RlmStepResult {
    #[serde(rename = "needs_llm")]
    NeedsLlm {
        turn_id: String,
        prompt: String,
        iteration: u32,
    },
    #[serde(rename = "done")]
    Done {
        answer: String,
        iterations: u32,
        terminated_by: String, // "FINAL", "FINAL_VAR", "max_depth", "cancelled"
        cost_estimate_tokens: usize,
    },
    #[serde(rename = "error")]
    Error {
        message: String,
        code: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RlmResult {
    pub answer: String,
    pub iterations: u32,
    pub terminated_by: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub cost_estimate_tokens: usize,
}

pub struct RlmSession {
    pub id: String,
    pub config: RlmConfig,
    pub context_store: ContextStore,
    pub variable_store: VariableStore,
    pub iteration: u32,
    pub total_prompt_chars: usize,
    pub total_response_chars: usize,
    pub cancelled: bool,
    pub current_turn_id: Option<String>,
    pub query: String,
}

impl RlmSession {
    pub fn new(id: String, config: RlmConfig) -> Self {
        Self {
            id,
            config,
            context_store: ContextStore::new(),
            variable_store: VariableStore::new(),
            iteration: 0,
            total_prompt_chars: 0,
            total_response_chars: 0,
            cancelled: false,
            current_turn_id: None,
            query: String::new(),
        }
    }

    pub fn set_query(&mut self, query: &str) {
        self.query = query.to_string();
        self.variable_store.set("query", query);
    }

    pub fn cancel(&mut self) {
        self.cancelled = true;
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled
    }

    pub fn estimate_tokens(&self) -> usize {
        // Standard rule of thumb: ~4 characters per token
        (self.total_prompt_chars + self.total_response_chars) / 4
    }

    /// Advances the RLM state machine by one turn.
    /// Returns NeedsLlm(prompt) or Done(result).
    pub fn step(&mut self) -> RlmStepResult {
        if self.cancelled {
            let answer = self
                .variable_store
                .get("buffer")
                .unwrap_or("Session cancelled by user")
                .to_string();
            return RlmStepResult::Done {
                answer,
                iterations: self.iteration,
                terminated_by: "cancelled".to_string(),
                cost_estimate_tokens: self.estimate_tokens(),
            };
        }

        if self.iteration >= self.config.max_depth {
            let answer = self
                .variable_store
                .get("buffer")
                .unwrap_or("Maximum recursion depth reached without explicit FINAL() answer")
                .to_string();
            return RlmStepResult::Done {
                answer,
                iterations: self.iteration,
                terminated_by: "max_depth".to_string(),
                cost_estimate_tokens: self.estimate_tokens(),
            };
        }

        let turn_id = format!("turn_{}_{}", self.id, self.iteration + 1);
        self.current_turn_id = Some(turn_id.clone());

        let prompt = self.format_prompt();
        self.total_prompt_chars += prompt.len();

        RlmStepResult::NeedsLlm {
            turn_id,
            prompt,
            iteration: self.iteration + 1,
        }
    }

    /// Feeds an LLM turn response back into the RLM session state machine.
    pub fn feed_response(&mut self, turn_id: &str, response: &str) -> RlmStepResult {
        if self.cancelled {
            let answer = self
                .variable_store
                .get("buffer")
                .unwrap_or("Session cancelled by user")
                .to_string();
            return RlmStepResult::Done {
                answer,
                iterations: self.iteration,
                terminated_by: "cancelled".to_string(),
                cost_estimate_tokens: self.estimate_tokens(),
            };
        }

        // Validate turn ID
        if let Some(expected) = &self.current_turn_id {
            if expected != turn_id {
                return RlmStepResult::Error {
                    message: format!("Turn ID mismatch: expected {}, got {}", expected, turn_id),
                    code: "ERR_TURN_MISMATCH".to_string(),
                };
            }
        }

        self.iteration += 1;
        self.total_response_chars += response.len();
        self.current_turn_id = None;

        // 1. First, parse any variable assignments (e.g. buffer = "..." or buffer = """...""")
        if let Some((k, v)) = parse_variable_assignment(response) {
            self.variable_store.set(&k, &v);
        }

        // 2. Helper to resolve variable or outside text when argument is a variable name like "buffer"
        let resolve_answer = |arg: &str, var_store: &VariableStore, raw_resp: &str| -> Option<String> {
            let cleaned = strip_outer_quotes(arg.trim());
            // If argument is NOT "buffer" and NOT a known variable, it's the direct answer text
            if cleaned != "buffer" && cleaned != "FINAL_VAR(buffer)" && !var_store.has(cleaned) {
                if !cleaned.is_empty() {
                    return Some(cleaned.to_string());
                }
            }

            // If it is "buffer" or a variable, resolve from variable_store
            let var_key = if var_store.has(cleaned) {
                cleaned
            } else {
                "buffer"
            };

            if let Some(val) = var_store.get(var_key) {
                let val_trimmed = val.trim();
                if !val_trimmed.is_empty() && val_trimmed != "buffer" {
                    return Some(val_trimmed.to_string());
                }
            }

            // If variable_store doesn't have it, extract text outside FINAL(...) / FINAL_VAR(...)
            let outside = raw_resp
                .replace(&format!("FINAL({})", arg), "")
                .replace(&format!("FINAL_VAR({})", arg), "")
                .replace("FINAL(buffer)", "")
                .replace("FINAL_VAR(buffer)", "");

            let mut candidate = outside.trim();
            if let Some(eq_pos) = candidate.find('=') {
                let left = candidate[..eq_pos].trim();
                if left == "buffer" {
                    candidate = candidate[eq_pos + 1..].trim();
                }
            }
            let stripped = strip_outer_quotes(candidate).trim();
            if stripped.len() > 10 && stripped != "buffer" {
                return Some(stripped.to_string());
            }

            None
        };

        // 3. Check for FINAL(...)
        if let Some(final_arg) = extract_parenthesized_argument(response, "FINAL") {
            if let Some(answer) = resolve_answer(final_arg, &self.variable_store, response) {
                return RlmStepResult::Done {
                    answer,
                    iterations: self.iteration,
                    terminated_by: "FINAL".to_string(),
                    cost_estimate_tokens: self.estimate_tokens(),
                };
            }
        }

        // 4. Check for FINAL_VAR(...)
        if let Some(var_name) = extract_parenthesized_argument(response, "FINAL_VAR") {
            if let Some(answer) = resolve_answer(var_name, &self.variable_store, response) {
                return RlmStepResult::Done {
                    answer,
                    iterations: self.iteration,
                    terminated_by: "FINAL_VAR".to_string(),
                    cost_estimate_tokens: self.estimate_tokens(),
                };
            }
        }

        // 5. Default accumulation into buffer if no explicit assignment
        if !self.variable_store.has("buffer") || self.variable_store.get("buffer").map_or(true, |b| b.trim().is_empty()) {
            let existing = self.variable_store.get("buffer").unwrap_or("");
            let new_buf = if existing.is_empty() {
                response.trim().to_string()
            } else {
                format!("{}\n{}", existing, response.trim())
            };
            self.variable_store.set("buffer", &new_buf);
        }

        // 6. If we reached max depth after this response, terminate
        if self.iteration >= self.config.max_depth {
            let mut answer = self
                .variable_store
                .get("buffer")
                .unwrap_or("")
                .trim()
                .to_string();

            if answer.is_empty() || answer == "buffer" {
                answer = "Maximum recursion depth reached without explicit FINAL() answer.".to_string();
            }

            return RlmStepResult::Done {
                answer,
                iterations: self.iteration,
                terminated_by: "max_depth".to_string(),
                cost_estimate_tokens: self.estimate_tokens(),
            };
        }

        // Advance to next step
        self.step()
    }

    fn format_prompt(&self) -> String {
        let total_chunks = self.context_store.len();
        let total_chars = self.context_store.total_chars();
        let var_summary = self.variable_store.format_state_summary();

        // Sample preview of context or chunks
        let chunk_preview = if total_chunks == 0 {
            "No context chunks currently loaded.".to_string()
        } else if total_chunks <= 3 {
            let mut s = String::new();
            for i in 0..total_chunks {
                s.push_str(&format!("\n--- Chunk {} ---\n{}", i, self.context_store.get(i).unwrap_or("")));
            }
            s
        } else {
            format!(
                "First chunk preview:\n{}\n\n[... {} additional chunks stored ...]\nLast chunk preview:\n{}",
                self.context_store.get(0).unwrap_or(""),
                total_chunks - 2,
                self.context_store.get(total_chunks - 1).unwrap_or("")
            )
        };

        let bm25_hints = if !self.query.is_empty() && total_chunks > 0 {
            let top_hits = self.context_store.bm25_search(&self.query, 3);
            if !top_hits.is_empty() {
                let mut hint = String::from("\nTop relevant chunks by BM25 keyword score:\n");
                for (c_idx, score) in top_hits {
                    let preview = self.context_store.get(c_idx).unwrap_or("");
                    let snippet = if preview.len() > 100 {
                        format!("{}...", &preview[..97])
                    } else {
                        preview.to_string()
                    };
                    hint.push_str(&format!("  - Chunk {} (score {:.2}): {}\n", c_idx, score, snippet));
                }
                hint
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        format!(
            "You are an in-browser Recursive Language Model (RLM) analyzing document context.\n\
             Context Info: {} chunks, ~{} characters.\n\
             Iteration: {} / {}\n\n\
             {}\n\n\
             Context Overview:\n{}{}\n\n\
             Task Query:\n{}\n\n\
             Instructions:\n\
             1. Examine the stored context chunks, search hints, and notes.\n\
             2. To record intermediate progress or notes, write: buffer = \"<your findings>\"\n\
             3. When you have the final answer, output your complete answer text inside FINAL(...):\n\
                FINAL(<write your complete answer here>)\n\
                Do NOT output just FINAL(buffer) without the actual answer content.\n",
            total_chunks,
            total_chars,
            self.iteration + 1,
            self.config.max_depth,
            var_summary,
            chunk_preview,
            bm25_hints,
            if self.query.is_empty() { "[None specified]" } else { &self.query }
        )
    }
}

/// Depth-tracking parenthesis parser for `TAG(...)`
pub fn extract_parenthesized_argument<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    let tag_pattern = format!("{}(", tag);
    let start_idx = text.find(&tag_pattern)? + tag_pattern.len();

    let bytes = text.as_bytes();
    let mut depth = 1usize;
    let mut i = start_idx;

    while i < bytes.len() {
        match bytes[i] {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start_idx..i]);
                }
            }
            _ => {}
        }
        i += 1;
    }

    None
}

/// Strips matching outer single, double, or triple quotes
pub fn strip_outer_quotes(s: &str) -> &str {
    let trimmed = s.trim();
    if (trimmed.starts_with("\"\"\"") && trimmed.ends_with("\"\"\"") && trimmed.len() >= 6)
        || (trimmed.starts_with("'''") && trimmed.ends_with("'''") && trimmed.len() >= 6)
    {
        trimmed[3..trimmed.len() - 3].trim()
    } else if (trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2)
        || (trimmed.starts_with('\'') && trimmed.ends_with('\'') && trimmed.len() >= 2)
    {
        trimmed[1..trimmed.len() - 1].trim()
    } else {
        trimmed
    }
}

/// Parses simple or multiline assignment: `var_name = "value"` or `var_name = """value"""`
fn parse_variable_assignment(text: &str) -> Option<(String, String)> {
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(eq_pos) = trimmed.find('=') {
            let left = trimmed[..eq_pos].trim();
            if !left.is_empty() && left.chars().all(|c| c.is_alphanumeric() || c == '_') {
                let right_on_line = trimmed[eq_pos + 1..].trim();
                // Check if right side starts with multiline triple quotes
                if right_on_line.starts_with("\"\"\"") || right_on_line.starts_with("'''") {
                    let delim = &right_on_line[..3];
                    if let Some(pos) = text.find(&format!("{}=", left)) {
                        let after_eq = &text[pos + left.len() + 1..];
                        if let Some(start) = after_eq.find(delim) {
                            let rest = &after_eq[start + 3..];
                            if let Some(end) = rest.find(delim) {
                                return Some((left.to_string(), rest[..end].trim().to_string()));
                            }
                        }
                    }
                } else if right_on_line.starts_with('"') || right_on_line.starts_with('\'') {
                    let delim = &right_on_line[..1];
                    if let Some(pos) = text.find(&format!("{}=", left)) {
                        let after_eq = &text[pos + left.len() + 1..];
                        if let Some(start) = after_eq.find(delim) {
                            let rest = &after_eq[start + 1..];
                            if let Some(end) = rest.find(delim) {
                                return Some((left.to_string(), rest[..end].trim().to_string()));
                            }
                        }
                    }
                }

                let cleaned_val = strip_outer_quotes(right_on_line);
                return Some((left.to_string(), cleaned_val.to_string()));
            }
        }
    }
    None
}

// Global Session Registry
static SESSIONS: Mutex<Option<HashMap<String, RlmSession>>> = Mutex::new(None);

fn with_sessions<F, R>(f: F) -> R
where
    F: FnOnce(&mut HashMap<String, RlmSession>) -> R,
{
    let mut guard = SESSIONS.lock().unwrap();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    f(guard.as_mut().unwrap())
}

pub fn create_session(id: String, config: RlmConfig) {
    with_sessions(|sessions| {
        sessions.insert(id.clone(), RlmSession::new(id, config));
    });
}

pub fn push_context(id: &str, text: &str) -> Result<usize, String> {
    with_sessions(|sessions| {
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("RLM session {} not found", id))?;
        let count = session.context_store.push_text(text, &session.config.chunk_strategy);
        Ok(count)
    })
}

pub fn run_session_init(id: &str, query: &str) -> Result<(), String> {
    with_sessions(|sessions| {
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("RLM session {} not found", id))?;
        session.set_query(query);
        Ok(())
    })
}

pub fn session_step(id: &str) -> Result<RlmStepResult, String> {
    with_sessions(|sessions| {
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("RLM session {} not found", id))?;
        Ok(session.step())
    })
}

pub fn session_feed_response(id: &str, turn_id: &str, response: &str) -> Result<RlmStepResult, String> {
    with_sessions(|sessions| {
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("RLM session {} not found", id))?;
        Ok(session.feed_response(turn_id, response))
    })
}

pub fn session_cancel(id: &str) -> Result<bool, String> {
    with_sessions(|sessions| {
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("RLM session {} not found", id))?;
        session.cancel();
        Ok(true)
    })
}

pub fn session_destroy(id: &str) -> bool {
    with_sessions(|sessions| sessions.remove(id).is_some())
}
