pub mod bm25;
pub mod chunker;
pub mod commands;
pub mod context_store;
pub mod index;
pub mod observation;
pub mod source;
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RlmMode {
    Legacy,
    Explore,
    Auto,
}

impl Default for RlmMode {
    fn default() -> Self {
        RlmMode::Legacy
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
    #[serde(default)]
    pub mode: RlmMode,
    #[serde(default = "default_max_turns")]
    pub max_turns: u32,
    #[serde(default = "default_max_sub_queries")]
    pub max_sub_queries: u32,
    #[serde(default = "default_max_observation_chars")]
    pub max_observation_chars: usize,
    #[serde(default = "default_direct_answer_threshold_chars")]
    pub direct_answer_threshold_chars: usize,
}

fn default_max_depth() -> u32 {
    5
}

fn default_chunk_size() -> usize {
    8000
}

fn default_max_turns() -> u32 {
    10
}

fn default_max_sub_queries() -> u32 {
    10
}

fn default_max_observation_chars() -> usize {
    4000
}

fn default_direct_answer_threshold_chars() -> usize {
    16000
}

impl Default for RlmConfig {
    fn default() -> Self {
        Self {
            max_depth: default_max_depth(),
            chunk_size: default_chunk_size(),
            chunk_strategy: ChunkStrategy::default(),
            context_type: None,
            mode: RlmMode::default(),
            max_turns: default_max_turns(),
            max_sub_queries: default_max_sub_queries(),
            max_observation_chars: default_max_observation_chars(),
            direct_answer_threshold_chars: default_direct_answer_threshold_chars(),
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LlmRole {
    Root,
    Sub,
}

impl Default for LlmRole {
    fn default() -> Self {
        LlmRole::Root
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
        #[serde(default)]
        role: LlmRole,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        sub_id: Option<String>,
    },
    #[serde(rename = "done")]
    Done {
        answer: String,
        iterations: u32,
        terminated_by: String, // "FINAL", "FINAL_VAR", "max_depth", "cancelled", "budget"
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
    pub source: Option<Box<dyn crate::rlm::source::ByteSource>>,
    pub index: Option<crate::rlm::index::DocumentIndex>,
    pub iteration: u32,
    pub total_prompt_chars: usize,
    pub total_response_chars: usize,
    pub cancelled: bool,
    pub current_turn_id: Option<String>,
    pub query: String,
    // Exploration and subquery state
    pub sub_queries_count: u32,
    pub pending_sub_queue: Vec<(u64, u64, String, Option<String>)>,
    pub current_sub_turn: Option<(String, Option<String>)>, // (sub_id, target_var)
    pub last_observation: Option<String>,
    pub consecutive_parse_errors: u32,
    pub is_synthesizing: bool,
}

impl RlmSession {
    pub fn new(id: String, config: RlmConfig) -> Self {
        Self {
            id,
            config,
            context_store: ContextStore::new(),
            variable_store: VariableStore::new(),
            source: None,
            index: None,
            iteration: 0,
            total_prompt_chars: 0,
            total_response_chars: 0,
            cancelled: false,
            current_turn_id: None,
            query: String::new(),
            sub_queries_count: 0,
            pending_sub_queue: Vec::new(),
            current_sub_turn: None,
            last_observation: None,
            consecutive_parse_errors: 0,
            is_synthesizing: false,
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

    pub fn attach_mem_source(&mut self, text: &str) -> Result<usize, String> {
        let mem = crate::rlm::source::MemSource::from_str(text);
        let index = crate::rlm::index::DocumentIndex::build(&mem, self.config.chunk_size)?;
        let count = index.chunk_count();
        self.source = Some(Box::new(mem));
        self.index = Some(index);
        Ok(count)
    }

    #[cfg(target_arch = "wasm32")]
    pub fn attach_opfs(&mut self, handle: web_sys::FileSystemSyncAccessHandle) -> Result<usize, String> {
        let opfs = crate::rlm::source::OpfsSource::new(handle)?;
        let index = crate::rlm::index::DocumentIndex::build(&opfs, self.config.chunk_size)?;
        let count = index.chunk_count();
        self.source = Some(Box::new(opfs));
        self.index = Some(index);
        Ok(count)
    }

    pub fn read_range(&self, offset: u64, length: u64) -> Result<String, String> {
        if let (Some(source), Some(index)) = (&self.source, &self.index) {
            index.read_range(source.as_ref(), offset, length)
        } else {
            let total = self.context_store.total_chars() as u64;
            if offset >= total {
                return Ok(String::new());
            }
            let full = self.context_store.chunks.join("\n");
            let start = offset as usize;
            let end = (offset + length).min(full.len() as u64) as usize;
            Ok(full[start..end].to_string())
        }
    }

    fn get_total_bytes(&self) -> u64 {
        if let Some(idx) = &self.index {
            idx.total_bytes
        } else {
            self.context_store.total_chars() as u64
        }
    }

    fn get_chunk_count(&self) -> usize {
        if let Some(idx) = &self.index {
            idx.chunk_count()
        } else {
            self.context_store.len()
        }
    }

    fn should_explore(&self) -> bool {
        match self.config.mode {
            RlmMode::Legacy => false,
            RlmMode::Explore => true,
            RlmMode::Auto => {
                let total = self.get_total_bytes();
                total > self.config.direct_answer_threshold_chars as u64
            }
        }
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

        // If in Explore mode (or Auto resolved to explore)
        if self.should_explore() {
            return self.step_explore();
        }

        // --- Legacy Mode Step ---
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
            role: LlmRole::Root,
            sub_id: None,
        }
    }

    fn step_explore(&mut self) -> RlmStepResult {
        // 1. If we have queued subqueries to dispatch, dispatch the next subquery
        if let Some((start_offset, end_offset, sub_prompt, target_var)) = self.pending_sub_queue.pop() {
            let sub_id = format!("sub_{}_{}", self.id, self.sub_queries_count + 1);
            let turn_id = format!("turn_{}_sub_{}", self.id, self.sub_queries_count + 1);
            self.current_turn_id = Some(turn_id.clone());
            self.current_sub_turn = Some((sub_id.clone(), target_var));
            self.sub_queries_count += 1;

            let length = end_offset.saturating_sub(start_offset);
            let slice_text = self.read_range(start_offset, length).unwrap_or_default();

            let prompt = format!(
                "You are an on-device language model answering a sub-task over a document slice.\n\
                 Context slice (bytes {}..{}):\n\
                 \"\"\"\n{}\n\"\"\"\n\n\
                 Task question:\n{}\n\n\
                 Provide a clear, factual answer based only on the slice above:",
                start_offset,
                end_offset,
                slice_text,
                sub_prompt
            );

            self.total_prompt_chars += prompt.len();

            return RlmStepResult::NeedsLlm {
                turn_id,
                prompt,
                iteration: self.iteration + 1,
                role: LlmRole::Sub,
                sub_id: Some(sub_id),
            };
        }

        // 2. Check if synthesis was requested
        if self.is_synthesizing {
            let turn_id = format!("turn_{}_synthesize", self.id);
            self.current_turn_id = Some(turn_id.clone());
            let prompt = self.format_synthesis_prompt();
            self.total_prompt_chars += prompt.len();

            return RlmStepResult::NeedsLlm {
                turn_id,
                prompt,
                iteration: self.iteration + 1,
                role: LlmRole::Root,
                sub_id: None,
            };
        }

        // 3. Check turn budget limit -> trigger forced synthesis
        let max_turns = self.config.max_turns.min(self.config.max_depth * 2).max(1);
        if self.iteration >= max_turns {
            self.is_synthesizing = true;
            return self.step_explore();
        }

        // 4. Generate root exploration prompt
        let turn_id = format!("turn_{}_{}", self.id, self.iteration + 1);
        self.current_turn_id = Some(turn_id.clone());

        let prompt = self.format_explore_prompt();
        self.total_prompt_chars += prompt.len();

        RlmStepResult::NeedsLlm {
            turn_id,
            prompt,
            iteration: self.iteration + 1,
            role: LlmRole::Root,
            sub_id: None,
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

        // If in Explore mode (or Auto resolved to explore)
        if self.should_explore() {
            return self.feed_response_explore(response);
        }

        // --- Legacy Mode Response Handling ---
        // 1. First, parse any variable assignments (e.g. buffer = "..." or buffer = """...""")
        if let Some((k, v)) = parse_variable_assignment(response) {
            self.variable_store.set(&k, &v);
        }

        // 2. Helper to resolve variable or outside text when argument is a variable name like "buffer"
        let resolve_answer = |arg: &str, var_store: &VariableStore, raw_resp: &str| -> Option<String> {
            let cleaned = strip_outer_quotes(arg.trim());
            if cleaned != "buffer" && cleaned != "FINAL_VAR(buffer)" && !var_store.has(cleaned) {
                if !cleaned.is_empty() {
                    return Some(cleaned.to_string());
                }
            }

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

        self.step()
    }

    fn feed_response_explore(&mut self, response: &str) -> RlmStepResult {
        // Case A: This was a sub-query turn response
        if let Some((_sub_id, target_var)) = self.current_sub_turn.take() {
            let var_name = target_var.unwrap_or_else(|| format!("sub_result_{}", self.sub_queries_count));
            self.variable_store.set(&var_name, response.trim());

            // Build observation for root model
            let meta = self.make_obs_meta();
            let obs = crate::rlm::observation::ObservationBuilder::build(
                "OK",
                &format!("Subquery completed. Result saved to variable `{}`:\n\"\"\"\n{}\n\"\"\"", var_name, response.trim()),
                &meta,
                self.config.max_observation_chars,
            );
            self.last_observation = Some(obs);

            // Continue stepping (will dispatch next pending subquery or return to root)
            return self.step();
        }

        // Case B: This was a forced synthesis turn response
        if self.is_synthesizing {
            let cleaned = strip_outer_quotes(response.trim());
            let final_ans = if let Some(arg) = extract_parenthesized_argument(response, "FINAL") {
                strip_outer_quotes(arg.trim()).to_string()
            } else if !cleaned.is_empty() {
                cleaned.to_string()
            } else {
                self.variable_store
                    .get("buffer")
                    .unwrap_or("No answer generated during synthesis.")
                    .to_string()
            };

            return RlmStepResult::Done {
                answer: final_ans,
                iterations: self.iteration,
                terminated_by: "budget".to_string(),
                cost_estimate_tokens: self.estimate_tokens(),
            };
        }

        // Case C: Root exploration turn - parse command
        match crate::rlm::commands::parse_command(response) {
            Ok(cmd) => {
                self.consecutive_parse_errors = 0;
                self.execute_command(cmd)
            }
            Err(err_msg) => {
                self.consecutive_parse_errors += 1;
                // If repeated parse failures, force synthesis
                if self.consecutive_parse_errors >= 3 {
                    self.is_synthesizing = true;
                    return self.step();
                }

                let meta = self.make_obs_meta();
                let obs = crate::rlm::observation::ObservationBuilder::error(&err_msg, &meta);
                self.last_observation = Some(obs);
                self.step()
            }
        }
    }

    fn execute_command(&mut self, cmd: crate::rlm::commands::RlmCommand) -> RlmStepResult {
        use crate::rlm::commands::RlmCommand;

        match cmd {
            RlmCommand::Final(answer) => {
                RlmStepResult::Done {
                    answer,
                    iterations: self.iteration,
                    terminated_by: "FINAL".to_string(),
                    cost_estimate_tokens: self.estimate_tokens(),
                }
            }
            RlmCommand::FinalVar(var_name) => {
                let answer = self
                    .variable_store
                    .get(&var_name)
                    .unwrap_or(&format!("[Variable '{}' not found]", var_name))
                    .to_string();

                RlmStepResult::Done {
                    answer,
                    iterations: self.iteration,
                    terminated_by: "FINAL_VAR".to_string(),
                    cost_estimate_tokens: self.estimate_tokens(),
                }
            }
            RlmCommand::LegacyBuffer(val) => {
                self.variable_store.set("buffer", &val);
                let meta = self.make_obs_meta();
                let obs = crate::rlm::observation::ObservationBuilder::build(
                    "OK",
                    &format!("Saved to buffer (length {} chars).", val.len()),
                    &meta,
                    self.config.max_observation_chars,
                );
                self.last_observation = Some(obs);
                self.step()
            }
            RlmCommand::Set { name, value } => {
                self.variable_store.set(&name, &value);
                let meta = self.make_obs_meta();
                let obs = crate::rlm::observation::ObservationBuilder::build(
                    "OK",
                    &format!("Variable `{}` set.", name),
                    &meta,
                    self.config.max_observation_chars,
                );
                self.last_observation = Some(obs);
                self.step()
            }
            RlmCommand::Get { name } => {
                let meta = self.make_obs_meta();
                let content = if let Some(v) = self.variable_store.get(&name) {
                    format!("Variable `{}` = \"{}\"", name, v)
                } else {
                    format!("Variable `{}` does not exist.", name)
                };
                let obs = crate::rlm::observation::ObservationBuilder::build(
                    "OK",
                    &content,
                    &meta,
                    self.config.max_observation_chars,
                );
                self.last_observation = Some(obs);
                self.step()
            }
            RlmCommand::Peek { offset, length } => {
                let meta = self.make_obs_meta();
                let content = match self.read_range(offset, length) {
                    Ok(text) => format!("Bytes {}..{}:\n\"\"\"\n{}\n\"\"\"", offset, offset + length, text),
                    Err(e) => format!("Error reading range: {}", e),
                };
                let obs = crate::rlm::observation::ObservationBuilder::build(
                    "OK",
                    &content,
                    &meta,
                    self.config.max_observation_chars,
                );
                self.last_observation = Some(obs);
                self.step()
            }
            RlmCommand::Lines { start_line, end_line } => {
                let meta = self.make_obs_meta();
                let content = if let (Some(source), Some(index)) = (&self.source, &self.index) {
                    match index.read_lines(source.as_ref(), start_line, end_line) {
                        Ok(text) => format!("Lines {}..{}:\n\"\"\"\n{}\n\"\"\"", start_line, end_line, text),
                        Err(e) => format!("Error reading lines: {}", e),
                    }
                } else {
                    format!("Lines {}..{}:\n\"\"\"\n{}\n\"\"\"", start_line, end_line, "[Line index not available for in-memory context]")
                };
                let obs = crate::rlm::observation::ObservationBuilder::build(
                    "OK",
                    &content,
                    &meta,
                    self.config.max_observation_chars,
                );
                self.last_observation = Some(obs);
                self.step()
            }
            RlmCommand::Search { pattern, max_matches } => {
                let meta = self.make_obs_meta();
                let content = if let (Some(source), Some(index)) = (&self.source, &self.index) {
                    match index.search(source.as_ref(), &pattern, max_matches) {
                        Ok(matches) => {
                            if matches.is_empty() {
                                format!("No matches found for pattern '{}'.", pattern)
                            } else {
                                let mut s = format!("Found {} matches for '{}':\n", matches.len(), pattern);
                                for (i, m) in matches.iter().enumerate() {
                                    s.push_str(&format!("  {}. offset {}: \"{}\"\n", i + 1, m.byte_offset, m.snippet));
                                }
                                s
                            }
                        }
                        Err(e) => format!("Error searching index: {}", e),
                    }
                } else {
                    // Fall back to context store search
                    let matches = self.context_store.search(&pattern, max_matches);
                    if matches.is_empty() {
                        format!("No matches found for pattern '{}'.", pattern)
                    } else {
                        let mut s = format!("Found {} matches for '{}':\n", matches.len(), pattern);
                        for (i, m) in matches.iter().enumerate() {
                            s.push_str(&format!("  {}. chunk {}: \"{}\"\n", i + 1, m.chunk_index, m.snippet));
                        }
                        s
                    }
                };
                let obs = crate::rlm::observation::ObservationBuilder::build(
                    "OK",
                    &content,
                    &meta,
                    self.config.max_observation_chars,
                );
                self.last_observation = Some(obs);
                self.step()
            }
            RlmCommand::SubQuery { start_offset, end_offset, prompt, target_var } => {
                // Check sub-query budget
                if self.sub_queries_count >= self.config.max_sub_queries {
                    let meta = self.make_obs_meta();
                    let obs = crate::rlm::observation::ObservationBuilder::build(
                        "BUDGET_EXCEEDED",
                        "Sub-query budget exhausted (max_sub_queries reached). Please use existing variables and output FINAL(\"<answer>\") or FINAL_VAR(<var>).",
                        &meta,
                        self.config.max_observation_chars,
                    );
                    self.last_observation = Some(obs);
                    return self.step();
                }

                self.pending_sub_queue.push((start_offset, end_offset, prompt, target_var));
                self.step()
            }
            RlmCommand::SubQueryBatch { slices, prompt, target_var } => {
                // Check sub-query budget
                if self.sub_queries_count + slices.len() as u32 > self.config.max_sub_queries {
                    let meta = self.make_obs_meta();
                    let obs = crate::rlm::observation::ObservationBuilder::build(
                        "BUDGET_EXCEEDED",
                        "Sub-query budget would be exceeded by batch. Please issue fewer sub-queries or synthesize FINAL answer.",
                        &meta,
                        self.config.max_observation_chars,
                    );
                    self.last_observation = Some(obs);
                    return self.step();
                }

                // Push slices in reverse order so pop() pops the first slice first
                for (idx, (start, end)) in slices.into_iter().enumerate().rev() {
                    let var = target_var.as_ref().map(|v| format!("{}_{}", v, idx));
                    self.pending_sub_queue.push((start, end, prompt.clone(), var));
                }
                self.step()
            }
        }
    }

    fn make_obs_meta(&self) -> crate::rlm::observation::ObservationMetadata {
        crate::rlm::observation::ObservationMetadata {
            total_bytes: self.get_total_bytes(),
            chunk_count: self.get_chunk_count(),
            turn: self.iteration + 1,
            max_turns: self.config.max_turns,
            sub_queries_used: self.sub_queries_count,
            max_sub_queries: self.config.max_sub_queries,
        }
    }

    fn format_explore_prompt(&self) -> String {
        let total_bytes = self.get_total_bytes();
        let total_chunks = self.get_chunk_count();
        let var_summary = self.variable_store.format_state_summary();

        let obs_text = if let Some(obs) = &self.last_observation {
            format!("\nLatest Observation:\n{}\n", obs)
        } else {
            String::new()
        };

        format!(
            "You are an on-device Recursive Language Model (RLM) root controller analyzing an out-of-core document.\n\
             Environment:\n\
             - Document size: {} bytes across {} chunks.\n\
             - Turn: {} / {}\n\
             - Subqueries used: {} / {}\n\n\
             {}\n\
             {}\n\
             User Query:\n\
             {}\n\n\
             Available Commands (output EXACTLY ONE command on its own line):\n\
             - PEEK <offset> <len>                         (Read byte slice from document)\n\
             - SEARCH \"<pattern>\"                          (Search keyword or (?i)regex in index)\n\
             - LINES <start> <end>                         (Read line range 1-indexed)\n\
             - SET <var> = \"<value>\"                       (Store variable notes)\n\
             - GET <var>                                   (Read stored variable)\n\
             - SUBQUERY <start> <end> \"<question>\" -> <var> (Delegate slice question to submodel)\n\
             - FINAL(\"<answer>\")                           (Output final synthesized answer)\n\
             - FINAL_VAR(<var>)                            (Use contents of variable as answer)\n\n\
             Command:",
            total_bytes,
            total_chunks,
            self.iteration + 1,
            self.config.max_turns,
            self.sub_queries_count,
            self.config.max_sub_queries,
            var_summary,
            obs_text,
            if self.query.is_empty() { "[None specified]" } else { &self.query }
        )
    }

    fn format_synthesis_prompt(&self) -> String {
        let var_summary = self.variable_store.format_state_summary();

        format!(
            "You are finalizing the answer for the user query using all gathered notes and subquery results.\n\
             Budget limit reached (turns or subqueries).\n\n\
             {}\n\n\
             User Query:\n\
             {}\n\n\
             Synthesize the final answer based on the stored variables above. Output your complete answer inside FINAL(...):\n\
             FINAL(<complete answer here>)",
            var_summary,
            if self.query.is_empty() { "[None specified]" } else { &self.query }
        )
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

pub fn session_attach_text(id: &str, text: &str) -> Result<usize, String> {
    with_sessions(|sessions| {
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("RLM session {} not found", id))?;
        session.attach_mem_source(text)
    })
}

#[cfg(target_arch = "wasm32")]
pub fn session_attach_opfs(
    id: &str,
    handle: web_sys::FileSystemSyncAccessHandle,
) -> Result<usize, String> {
    with_sessions(|sessions| {
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("RLM session {} not found", id))?;
        session.attach_opfs(handle)
    })
}

pub fn session_read_range(id: &str, offset: u64, length: u64) -> Result<String, String> {
    with_sessions(|sessions| {
        let session = sessions
            .get(id)
            .ok_or_else(|| format!("RLM session {} not found", id))?;
        session.read_range(offset, length)
    })
}

pub fn session_destroy(id: &str) -> bool {
    with_sessions(|sessions| sessions.remove(id).is_some())
}
