use serde::{Deserialize, Serialize};

/// Formats capped observations returned back to the model after executing an RlmCommand.
/// Enforces FR-009: length-capped, with enough metadata (document length, offsets, remaining budgets).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ObservationMetadata {
    pub total_bytes: u64,
    pub chunk_count: usize,
    pub turn: u32,
    pub max_turns: u32,
    pub sub_queries_used: u32,
    pub max_sub_queries: u32,
}

pub struct ObservationBuilder;

impl ObservationBuilder {
    /// Formats a command observation with contextual header/footer metadata.
    pub fn build(
        status: &str,
        content: &str,
        meta: &ObservationMetadata,
        max_chars: usize,
    ) -> String {
        let meta_header = format!(
            "[OBSERVATION status={status} doc_len={}B chunks={} turn={}/{} subqueries={}/{}]\n",
            meta.total_bytes,
            meta.chunk_count,
            meta.turn,
            meta.max_turns,
            meta.sub_queries_used,
            meta.max_sub_queries,
        );

        let available_chars = if max_chars > meta_header.len() + 100 {
            max_chars - meta_header.len() - 60
        } else {
            max_chars
        };

        let trimmed_content = if content.len() > available_chars {
            // Find a clean boundary
            let mut end = available_chars;
            while end > 0 && !content.is_char_boundary(end) {
                end -= 1;
            }
            format!(
                "{}\n[... truncated ({} chars omitted, max_observation_chars={}) ...]",
                &content[..end],
                content.len() - end,
                max_chars
            )
        } else {
            content.to_string()
        };

        format!("{}{}", meta_header, trimmed_content)
    }

    /// Formats an error observation that guides the model to correct its command syntax.
    pub fn error(err_msg: &str, meta: &ObservationMetadata) -> String {
        format!(
            "[OBSERVATION status=ERROR turn={}/{} subqueries={}/{}]\n{}\nValid commands: PEEK <offset> <len>, SEARCH \"<pattern>\", LINES <start> <end>, SET <var> = \"<val>\", GET <var>, SUBQUERY <start> <end> \"<question>\" -> <var>, FINAL(\"<answer>\"), FINAL_VAR(<var>)",
            meta.turn,
            meta.max_turns,
            meta.sub_queries_used,
            meta.max_sub_queries,
            err_msg
        )
    }
}
