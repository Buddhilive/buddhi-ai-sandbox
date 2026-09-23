use crate::rlm::ChunkStrategy;

pub struct Chunker;

impl Chunker {
    pub fn chunk(text: &str, strategy: &ChunkStrategy) -> Vec<String> {
        if text.trim().is_empty() {
            return Vec::new();
        }

        match strategy {
            ChunkStrategy::FixedChar(size) => {
                let size = (*size).max(1);
                let mut chunks = Vec::new();
                let mut start = 0;
                let len = text.len();

                while start < len {
                    let mut end = (start + size).min(len);
                    while end < len && !text.is_char_boundary(end) {
                        end += 1;
                    }
                    let chunk = text[start..end].trim().to_string();
                    if !chunk.is_empty() {
                        chunks.push(chunk);
                    }
                    start = end;
                }
                chunks
            }
            ChunkStrategy::Paragraph => {
                let normalized = text.replace("\r\n", "\n");
                let parts: Vec<&str> = normalized.split("\n\n").collect();
                parts
                    .into_iter()
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                    .collect()
            }
            ChunkStrategy::Sentence => {
                let mut sentences = Vec::new();
                let mut current = String::new();
                let chars: Vec<char> = text.chars().collect();
                let len = chars.len();

                for i in 0..len {
                    current.push(chars[i]);
                    let is_punct = chars[i] == '.' || chars[i] == '!' || chars[i] == '?';
                    let next_is_space_or_end = i + 1 == len || chars[i + 1].is_whitespace();

                    if is_punct && next_is_space_or_end {
                        let trimmed = current.trim().to_string();
                        if !trimmed.is_empty() {
                            sentences.push(trimmed);
                        }
                        current.clear();
                    }
                }
                let trimmed = current.trim().to_string();
                if !trimmed.is_empty() {
                    sentences.push(trimmed);
                }
                sentences
            }
        }
    }
}
