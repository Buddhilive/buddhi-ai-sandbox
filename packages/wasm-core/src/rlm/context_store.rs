use crate::rlm::chunker::Chunker;
use crate::rlm::ChunkStrategy;

#[derive(Clone, Debug, Default)]
pub struct ContextStore {
    pub chunks: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SearchMatch {
    pub chunk_index: usize,
    pub snippet: String,
}

impl ContextStore {
    pub fn new() -> Self {
        Self {
            chunks: Vec::new(),
        }
    }

    /// Push pre-chunked string
    pub fn push_chunk(&mut self, chunk: String) {
        if !chunk.is_empty() {
            self.chunks.push(chunk);
        }
    }

    /// Push raw text using specified chunk strategy
    pub fn push_text(&mut self, text: &str, strategy: &ChunkStrategy) -> usize {
        let new_chunks = Chunker::chunk(text, strategy);
        let count = new_chunks.len();
        for chunk in new_chunks {
            self.push_chunk(chunk);
        }
        count
    }

    /// Get chunk by 0-based index
    pub fn get(&self, index: usize) -> Option<&str> {
        self.chunks.get(index).map(|s| s.as_str())
    }

    /// Total number of chunks stored
    pub fn len(&self) -> usize {
        self.chunks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.chunks.is_empty()
    }

    /// Total characters across all chunks
    pub fn total_chars(&self) -> usize {
        self.chunks.iter().map(|c| c.len()).sum()
    }

    /// Clear all stored chunks
    pub fn clear(&mut self) {
        self.chunks.clear();
    }

    /// Search chunks using BM25 keyword relevance scoring
    pub fn bm25_search(&self, query: &str, top_k: usize) -> Vec<(usize, f32)> {
        crate::rlm::bm25::Bm25Index::search(query, &self.chunks, top_k)
    }

    /// Search across chunks using pattern matching / regex-like matching.
    /// Supports:
    /// - `(?i)` prefix for case-insensitivity
    /// - `.` matches any character
    /// - `*` matches 0 or more characters
    /// - substring matching
    pub fn search(&self, pattern: &str, max_matches: usize) -> Vec<SearchMatch> {
        if pattern.is_empty() || self.chunks.is_empty() {
            return Vec::new();
        }

        let (case_insensitive, raw_pat) = if pattern.starts_with("(?i)") {
            (true, &pattern[4..])
        } else {
            (false, pattern)
        };

        let mut results = Vec::new();
        let target_pat = if case_insensitive {
            raw_pat.to_lowercase()
        } else {
            raw_pat.to_string()
        };

        for (idx, chunk) in self.chunks.iter().enumerate() {
            let search_chunk = if case_insensitive {
                chunk.to_lowercase()
            } else {
                chunk.clone()
            };

            if let Some(pos) = match_pattern(&search_chunk, &target_pat) {
                // Generate a snippet around the match
                let start = pos.saturating_sub(40);
                let end = (pos + target_pat.len() + 40).min(chunk.len());

                // Find valid UTF-8 char boundaries
                let start_idx = chunk
                    .char_indices()
                    .map(|(i, _)| i)
                    .filter(|&i| i <= start)
                    .last()
                    .unwrap_or(0);

                let end_idx = chunk
                    .char_indices()
                    .map(|(i, _)| i)
                    .find(|&i| i >= end)
                    .unwrap_or(chunk.len());

                let snippet = chunk[start_idx..end_idx].trim().to_string();
                results.push(SearchMatch {
                    chunk_index: idx,
                    snippet,
                });

                if results.len() >= max_matches {
                    break;
                }
            }
        }

        results
    }
}

/// Matches pattern with optional simple wildcards (`*`, `.`)
pub fn match_pattern(text: &str, pat: &str) -> Option<usize> {
    if !pat.contains('*') && !pat.contains('.') {
        // Fast path: literal substring match
        return text.find(pat);
    }

    // Pattern matching supporting '.' (any char) and '*' (wildcard)
    let text_chars: Vec<char> = text.chars().collect();
    let pat_chars: Vec<char> = pat.chars().collect();

    if pat_chars.is_empty() {
        return Some(0);
    }

    for i in 0..text_chars.len() {
        if is_match_at(&text_chars[i..], &pat_chars) {
            let byte_pos: usize = text_chars[..i].iter().map(|c| c.len_utf8()).sum();
            return Some(byte_pos);
        }
    }

    None
}

fn is_match_at(text: &[char], pat: &[char]) -> bool {
    let mut t = 0;
    let mut p = 0;
    let mut star_p: Option<usize> = None;
    let mut match_t: usize = 0;

    while t < text.len() {
        if p == pat.len() {
            return true;
        }
        if pat[p] == '.' || pat[p] == text[t] {
            t += 1;
            p += 1;
        } else if pat[p] == '*' {
            star_p = Some(p);
            p += 1;
            match_t = t;
        } else if let Some(sp) = star_p {
            p = sp + 1;
            match_t += 1;
            t = match_t;
        } else {
            return false;
        }
    }

    while p < pat.len() && pat[p] == '*' {
        p += 1;
    }

    p == pat.len()
}
