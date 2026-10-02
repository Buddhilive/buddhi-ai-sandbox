use serde::{Deserialize, Serialize};

/// High-level commands issued by the root model during document exploration
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum RlmCommand {
    Peek {
        offset: u64,
        length: u64,
    },
    Search {
        pattern: String,
        max_matches: usize,
    },
    Lines {
        start_line: usize,
        end_line: usize,
    },
    Set {
        name: String,
        value: String,
    },
    Get {
        name: String,
    },
    SubQuery {
        start_offset: u64,
        end_offset: u64,
        prompt: String,
        target_var: Option<String>,
    },
    SubQueryBatch {
        slices: Vec<(u64, u64)>,
        prompt: String,
        target_var: Option<String>,
    },
    Final(String),
    FinalVar(String),
    LegacyBuffer(String),
}

/// Parses the model response into the first recognized valid RlmCommand.
/// Tolerates leading/trailing conversational filler, markdown code fences, and multiline text.
pub fn parse_command(response: &str) -> Result<RlmCommand, String> {
    let trimmed = response.trim();
    if trimmed.is_empty() {
        return Err("Empty response received. Provide an RLM command or FINAL answer.".to_string());
    }

    // 1. Fast path: check for legacy or explicit FINAL(...) / FINAL_VAR(...) tags anywhere
    if let Some(final_arg) = crate::rlm::extract_parenthesized_argument(trimmed, "FINAL") {
        let answer = crate::rlm::strip_outer_quotes(final_arg.trim());
        if !answer.is_empty() && answer != "buffer" {
            return Ok(RlmCommand::Final(answer.to_string()));
        }
    }

    if let Some(var_arg) = crate::rlm::extract_parenthesized_argument(trimmed, "FINAL_VAR") {
        let var_name = crate::rlm::strip_outer_quotes(var_arg.trim());
        if !var_name.is_empty() {
            return Ok(RlmCommand::FinalVar(var_name.to_string()));
        }
    }

    // 2. Iterate through lines (unwrapping code fences if present)
    for line in trimmed.lines() {
        let mut clean_line = line.trim();

        // Strip leading markdown quotes or list markers (e.g. "> PEEK...", "- PEEK...")
        clean_line = clean_line.trim_start_matches(|c: char| c == '>' || c == '-' || c == '*' || c.is_whitespace());
        if clean_line.starts_with("```") || clean_line.is_empty() {
            continue;
        }

        // Try parsing line as an RlmCommand
        if let Some(cmd) = parse_command_line(clean_line) {
            return Ok(cmd);
        }
    }

    // 3. Fallback: check for variable assignment `buffer = "..."`
    if let Some((k, v)) = parse_var_assignment(trimmed) {
        if k == "buffer" {
            return Ok(RlmCommand::LegacyBuffer(v));
        } else {
            return Ok(RlmCommand::Set { name: k, value: v });
        }
    }

    Err(
        "No valid RLM command detected. Commands must start on a new line: PEEK <offset> <len>, SEARCH \"<pat>\", LINES <start> <end>, SET <k> = \"<v>\", SUBQUERY <start> <end> \"<q>\" -> <var>, FINAL(\"<answer>\"), or FINAL_VAR(<var>)."
            .to_string(),
    )
}

fn parse_command_line(line: &str) -> Option<RlmCommand> {
    let mut parts = line.split_whitespace();
    let keyword = parts.next()?;
    let upper = keyword.to_uppercase();

    // Remainder of line after keyword
    let rest = line[keyword.len()..].trim();

    match upper.as_str() {
        "FINAL" => {
            if rest.starts_with('{') {
                #[derive(Deserialize)]
                struct FinalJson {
                    answer: String,
                }
                if let Ok(j) = serde_json::from_str::<FinalJson>(rest) {
                    return Some(RlmCommand::Final(j.answer));
                }
            }
            let stripped = crate::rlm::strip_outer_quotes(rest);
            if !stripped.is_empty() {
                Some(RlmCommand::Final(stripped.to_string()))
            } else {
                None
            }
        }
        "FINAL_VAR" => {
            if rest.starts_with('{') {
                #[derive(Deserialize)]
                struct FinalVarJson {
                    name: String,
                }
                if let Ok(j) = serde_json::from_str::<FinalVarJson>(rest) {
                    return Some(RlmCommand::FinalVar(j.name));
                }
            }
            let stripped = crate::rlm::strip_outer_quotes(rest);
            let var_name = stripped.trim_matches(|c: char| c == '(' || c == ')' || c.is_whitespace());
            if !var_name.is_empty() {
                Some(RlmCommand::FinalVar(var_name.to_string()))
            } else {
                None
            }
        }
        "PEEK" => {
            if rest.starts_with('{') {
                #[derive(Deserialize)]
                struct PeekJson {
                    offset: u64,
                    length: u64,
                }
                if let Ok(j) = serde_json::from_str::<PeekJson>(rest) {
                    return Some(RlmCommand::Peek {
                        offset: j.offset,
                        length: j.length,
                    });
                }
            }
            let off = parts.next()?.parse::<u64>().ok()?;
            let len = parts.next()?.parse::<u64>().ok()?;
            Some(RlmCommand::Peek {
                offset: off,
                length: len,
            })
        }
        "SEARCH" => {
            if rest.starts_with('{') {
                #[derive(Deserialize)]
                struct SearchJson {
                    pattern: String,
                    #[serde(default = "default_max_matches")]
                    max: usize,
                }
                fn default_max_matches() -> usize {
                    5
                }
                if let Ok(j) = serde_json::from_str::<SearchJson>(rest) {
                    return Some(RlmCommand::Search {
                        pattern: j.pattern,
                        max_matches: j.max,
                    });
                }
            }
            let pat = extract_quoted_string(rest)
                .unwrap_or_else(|| rest.to_string());
            Some(RlmCommand::Search {
                pattern: pat,
                max_matches: 5,
            })
        }
        "LINES" => {
            if rest.starts_with('{') {
                #[derive(Deserialize)]
                struct LinesJson {
                    start: usize,
                    end: usize,
                }
                if let Ok(j) = serde_json::from_str::<LinesJson>(rest) {
                    return Some(RlmCommand::Lines {
                        start_line: j.start,
                        end_line: j.end,
                    });
                }
            }
            let start = parts.next()?.parse::<usize>().ok()?;
            let end = parts.next()?.parse::<usize>().ok()?;
            Some(RlmCommand::Lines {
                start_line: start,
                end_line: end,
            })
        }
        "SET" => {
            if rest.starts_with('{') {
                #[derive(Deserialize)]
                struct SetJson {
                    name: String,
                    value: String,
                }
                if let Ok(j) = serde_json::from_str::<SetJson>(rest) {
                    return Some(RlmCommand::Set {
                        name: j.name,
                        value: j.value,
                    });
                }
            }
            parse_var_assignment(rest).map(|(k, v)| RlmCommand::Set { name: k, value: v })
        }
        "GET" => {
            if rest.starts_with('{') {
                #[derive(Deserialize)]
                struct GetJson {
                    name: String,
                }
                if let Ok(j) = serde_json::from_str::<GetJson>(rest) {
                    return Some(RlmCommand::Get { name: j.name });
                }
            }
            let name = parts.next()?.trim_matches(|c: char| c == '"' || c == '\'');
            Some(RlmCommand::Get {
                name: name.to_string(),
            })
        }
        "SUBQUERY" => {
            if rest.starts_with('{') {
                #[derive(Deserialize)]
                struct SubQueryJson {
                    start: u64,
                    end: u64,
                    prompt: String,
                    target_var: Option<String>,
                }
                if let Ok(j) = serde_json::from_str::<SubQueryJson>(rest) {
                    return Some(RlmCommand::SubQuery {
                        start_offset: j.start,
                        end_offset: j.end,
                        prompt: j.prompt,
                        target_var: j.target_var,
                    });
                }
            }
            let start = parts.next()?.parse::<u64>().ok()?;
            let end = parts.next()?.parse::<u64>().ok()?;
            let remainder = parts.collect::<Vec<_>>().join(" ");
            let (prompt, target_var) = parse_prompt_and_target_var(&remainder)?;
            Some(RlmCommand::SubQuery {
                start_offset: start,
                end_offset: end,
                prompt,
                target_var,
            })
        }
        "SUBQUERY_BATCH" => {
            if rest.starts_with('{') {
                #[derive(Deserialize)]
                struct SubQueryBatchJson {
                    slices: Vec<[u64; 2]>,
                    prompt: String,
                    target_var: Option<String>,
                }
                if let Ok(j) = serde_json::from_str::<SubQueryBatchJson>(rest) {
                    let slices = j.slices.into_iter().map(|s| (s[0], s[1])).collect();
                    return Some(RlmCommand::SubQueryBatch {
                        slices,
                        prompt: j.prompt,
                        target_var: j.target_var,
                    });
                }
            }
            None
        }
        _ => None,
    }
}

fn extract_quoted_string(s: &str) -> Option<String> {
    let trimmed = s.trim();
    if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        return Some(trimmed[1..trimmed.len() - 1].to_string());
    }
    if let Some(first_quote) = trimmed.find('"') {
        if let Some(second_quote) = trimmed[first_quote + 1..].find('"') {
            return Some(trimmed[first_quote + 1..first_quote + 1 + second_quote].to_string());
        }
    }
    None
}

fn parse_prompt_and_target_var(s: &str) -> Option<(String, Option<String>)> {
    let trimmed = s.trim();
    // Check for trailing `-> var_name`
    if let Some(arrow_pos) = trimmed.rfind("->") {
        let before_arrow = trimmed[..arrow_pos].trim();
        let var_name = trimmed[arrow_pos + 2..].trim().to_string();
        let prompt = extract_quoted_string(before_arrow).unwrap_or_else(|| before_arrow.to_string());
        Some((prompt, Some(var_name)))
    } else {
        let prompt = extract_quoted_string(trimmed).unwrap_or_else(|| trimmed.to_string());
        Some((prompt, None))
    }
}

fn parse_var_assignment(text: &str) -> Option<(String, String)> {
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(eq_pos) = trimmed.find('=') {
            let left = trimmed[..eq_pos].trim();
            if !left.is_empty() && left.chars().all(|c| c.is_alphanumeric() || c == '_') {
                let right = trimmed[eq_pos + 1..].trim();
                let val = crate::rlm::strip_outer_quotes(right);
                return Some((left.to_string(), val.to_string()));
            }
        }
    }
    None
}
