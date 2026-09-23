use std::collections::{HashMap, HashSet};

pub struct Bm25Index;

impl Bm25Index {
    /// Compute BM25 ranking for a query across a list of text chunks.
    /// Returns top_k pairs of (chunk_index, score) sorted descending by relevance.
    pub fn search(query: &str, chunks: &[String], top_k: usize) -> Vec<(usize, f32)> {
        let n = chunks.len();
        if n == 0 || query.trim().is_empty() || top_k == 0 {
            return Vec::new();
        }

        // Tokenize query
        let query_tokens = tokenize(query);
        if query_tokens.is_empty() {
            return Vec::new();
        }

        // Tokenize all chunks and compute term frequencies and chunk lengths
        let mut chunk_token_counts: Vec<HashMap<String, usize>> = Vec::with_capacity(n);
        let mut chunk_lengths: Vec<usize> = Vec::with_capacity(n);
        let mut total_length: usize = 0;

        // Inverted document frequency tracker: count of chunks containing each term
        let mut doc_freq: HashMap<String, usize> = HashMap::new();

        for chunk in chunks {
            let tokens = tokenize(chunk);
            let len = tokens.len();
            chunk_lengths.push(len);
            total_length += len;

            let mut counts: HashMap<String, usize> = HashMap::new();
            let mut unique_in_chunk: HashSet<String> = HashSet::new();

            for tok in tokens {
                *counts.entry(tok.clone()).or_insert(0) += 1;
                unique_in_chunk.insert(tok);
            }

            for tok in unique_in_chunk {
                *doc_freq.entry(tok).or_insert(0) += 1;
            }

            chunk_token_counts.push(counts);
        }

        let avgdl = (total_length as f32) / (n as f32);
        let k1: f32 = 1.2;
        let b: f32 = 0.75;

        // Precompute IDF for query terms
        // IDF(q) = ln(1 + (N - n(q) + 0.5) / (n(q) + 0.5))
        let mut idf: HashMap<String, f32> = HashMap::new();
        for q in &query_tokens {
            let n_q = *doc_freq.get(q).unwrap_or(&0) as f32;
            let val = ((n as f32 - n_q + 0.5) / (n_q + 0.5)).max(0.0) + 1.0;
            idf.insert(q.clone(), val.ln());
        }

        // Score each chunk
        let mut scores: Vec<(usize, f32)> = Vec::with_capacity(n);

        for (idx, counts) in chunk_token_counts.iter().enumerate() {
            let mut score = 0.0f32;
            let doc_len = chunk_lengths[idx] as f32;
            let denom_norm = if avgdl > 0.0 {
                1.0 - b + b * (doc_len / avgdl)
            } else {
                1.0
            };

            for q in &query_tokens {
                if let Some(&tf) = counts.get(q) {
                    let tf_f = tf as f32;
                    let q_idf = *idf.get(q).unwrap_or(&0.0);
                    let term_score = q_idf * (tf_f * (k1 + 1.0)) / (tf_f + k1 * denom_norm);
                    score += term_score;
                }
            }

            if score > 0.0 {
                scores.push((idx, score));
            }
        }

        // Sort descending by score
        scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scores.truncate(top_k);
        scores
    }
}

/// Tokenizes text into lowercase alphanumeric words
fn tokenize(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 2)
        .map(|t| t.to_lowercase())
        .collect()
}
