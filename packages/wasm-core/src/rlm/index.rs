use crate::rlm::source::ByteSource;
use serde::{Deserialize, Serialize};

/// Target default chunk size for out-of-core document chunking (~8 KB)
pub const DEFAULT_TARGET_CHUNK_SIZE: usize = 8192;

/// Lookahead window to search for a clean newline break around chunk boundaries
pub const NEWLINE_LOOKAHEAD_WINDOW: usize = 1024;

/// Lightweight descriptor of a chunk's location in the underlying ByteSource
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChunkDescriptor {
    pub chunk_index: usize,
    pub start_byte: u64,
    pub end_byte: u64, // exclusive
    pub line_count: usize,
}

impl ChunkDescriptor {
    pub fn byte_len(&self) -> u64 {
        self.end_byte.saturating_sub(self.start_byte)
    }
}

/// Out-of-core index maintaining chunk metadata and random-access slicing
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocumentIndex {
    pub total_bytes: u64,
    pub total_lines: usize,
    pub chunks: Vec<ChunkDescriptor>,
}

impl DocumentIndex {
    /// Builds a document index over any ByteSource.
    /// Reads in streaming blocks without loading the entire payload into linear memory.
    pub fn build(source: &dyn ByteSource, target_chunk_size: usize) -> Result<Self, String> {
        let total_bytes = source.len();
        if total_bytes == 0 {
            return Ok(Self {
                total_bytes: 0,
                total_lines: 0,
                chunks: Vec::new(),
            });
        }

        let chunk_size = if target_chunk_size == 0 {
            DEFAULT_TARGET_CHUNK_SIZE
        } else {
            target_chunk_size
        };

        let mut chunks = Vec::new();
        let mut curr_offset: u64 = 0;
        let mut total_lines = 0;
        let mut chunk_idx = 0;

        // Buffer for probing chunk boundaries
        let mut probe_buf = vec![0u8; chunk_size + NEWLINE_LOOKAHEAD_WINDOW];

        while curr_offset < total_bytes {
            let remaining = total_bytes - curr_offset;
            if remaining <= chunk_size as u64 {
                // Last chunk
                let chunk_len = remaining as usize;
                let mut last_buf = vec![0u8; chunk_len];
                source.read_at(curr_offset, &mut last_buf)?;
                let line_count = count_newlines(&last_buf);
                total_lines += line_count;

                chunks.push(ChunkDescriptor {
                    chunk_index: chunk_idx,
                    start_byte: curr_offset,
                    end_byte: total_bytes,
                    line_count,
                });
                break;
            }

            // Probe target boundary + lookahead window
            let bytes_to_probe = probe_buf.len().min(remaining as usize);
            let bytes_read = source.read_at(curr_offset, &mut probe_buf[..bytes_to_probe])?;
            if bytes_read == 0 {
                break;
            }

            // Search for nearest newline in [chunk_size .. bytes_read]
            let mut cut_point = chunk_size.min(bytes_read);
            let search_start = cut_point.saturating_sub(128);
            let search_end = bytes_read;

            if let Some(nl_pos) = probe_buf[search_start..search_end]
                .iter()
                .position(|&b| b == b'\n')
            {
                // Align right after the newline character
                cut_point = search_start + nl_pos + 1;
            } else {
                // No newline found in lookahead; align to valid UTF-8 boundary
                cut_point = align_utf8_forward(&probe_buf[..bytes_read], cut_point);
            }

            // Ensure cut_point does not split a multi-byte sequence
            cut_point = align_utf8_boundary(&probe_buf[..bytes_read], cut_point);
            if cut_point == 0 {
                cut_point = 1.max(bytes_read);
            }

            let chunk_lines = count_newlines(&probe_buf[..cut_point]);
            total_lines += chunk_lines;

            let end_byte = curr_offset + cut_point as u64;
            chunks.push(ChunkDescriptor {
                chunk_index: chunk_idx,
                start_byte: curr_offset,
                end_byte,
                line_count: chunk_lines,
            });

            curr_offset = end_byte;
            chunk_idx += 1;
        }

        Ok(Self {
            total_bytes,
            total_lines,
            chunks,
        })
    }

    pub fn chunk_count(&self) -> usize {
        self.chunks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.total_bytes == 0
    }

    /// Reads a slice from the source, aligning start and end boundaries to UTF-8 code points.
    pub fn read_range(
        &self,
        source: &dyn ByteSource,
        offset: u64,
        length: u64,
    ) -> Result<String, String> {
        if self.total_bytes == 0 || length == 0 || offset >= self.total_bytes {
            return Ok(String::new());
        }

        // Clamp to file size
        let available = self.total_bytes.saturating_sub(offset);
        let bytes_to_read = length.min(available) as usize;

        // Allocate buffer with small margin to adjust boundaries if needed
        let mut raw = vec![0u8; bytes_to_read];
        let actual_read = source.read_at(offset, &mut raw)?;
        if actual_read == 0 {
            return Ok(String::new());
        }
        raw.truncate(actual_read);

        // Sanitize UTF-8 boundaries on raw read slice
        Ok(clean_utf8_lossy(&raw))
    }

    /// Returns chunk descriptor by index
    pub fn get_chunk(&self, index: usize) -> Option<&ChunkDescriptor> {
        self.chunks.get(index)
    }

    /// Reads an entire chunk by index as UTF-8 string
    pub fn read_chunk(&self, source: &dyn ByteSource, index: usize) -> Result<String, String> {
        let desc = self
            .chunks
            .get(index)
            .ok_or_else(|| format!("Chunk index {} out of range", index))?;
        self.read_range(source, desc.start_byte, desc.byte_len())
    }

    /// Search across chunks in source using pattern matching.
    pub fn search(
        &self,
        source: &dyn ByteSource,
        pattern: &str,
        max_matches: usize,
    ) -> Result<Vec<IndexSearchMatch>, String> {
        if pattern.is_empty() || self.chunks.is_empty() || max_matches == 0 {
            return Ok(Vec::new());
        }

        let (case_insensitive, raw_pat) = if pattern.starts_with("(?i)") {
            (true, &pattern[4..])
        } else {
            (false, pattern)
        };

        let target_pat = if case_insensitive {
            raw_pat.to_lowercase()
        } else {
            raw_pat.to_string()
        };

        let mut results = Vec::new();

        for desc in &self.chunks {
            let chunk_text = self.read_range(source, desc.start_byte, desc.byte_len())?;
            let search_chunk = if case_insensitive {
                chunk_text.to_lowercase()
            } else {
                chunk_text.clone()
            };

            if let Some(pos) = crate::rlm::context_store::match_pattern(&search_chunk, &target_pat) {
                let start = pos.saturating_sub(40);
                let end = (pos + target_pat.len() + 40).min(chunk_text.len());

                let start_idx = chunk_text
                    .char_indices()
                    .map(|(i, _)| i)
                    .filter(|&i| i <= start)
                    .last()
                    .unwrap_or(0);

                let end_idx = chunk_text
                    .char_indices()
                    .map(|(i, _)| i)
                    .find(|&i| i >= end)
                    .unwrap_or(chunk_text.len());

                let snippet = chunk_text[start_idx..end_idx].trim().to_string();
                results.push(IndexSearchMatch {
                    chunk_index: desc.chunk_index,
                    byte_offset: desc.start_byte + pos as u64,
                    snippet,
                });

                if results.len() >= max_matches {
                    break;
                }
            }
        }

        Ok(results)
    }

    /// Reads lines between start_line and end_line (1-indexed inclusive).
    pub fn read_lines(
        &self,
        source: &dyn ByteSource,
        start_line: usize,
        end_line: usize,
    ) -> Result<String, String> {
        if start_line == 0 || end_line < start_line || self.total_bytes == 0 {
            return Ok(String::new());
        }

        let mut current_line = 1usize;
        let mut start_byte: Option<u64> = None;
        let mut end_byte: Option<u64> = None;

        // Iterate through chunks to find target lines
        for desc in &self.chunks {
            let next_line = current_line + desc.line_count;
            if start_byte.is_none() && end_line >= current_line && start_line < next_line {
                // The start line is within or after current_line
                let text = self.read_chunk(source, desc.chunk_index)?;
                let mut line_offset = desc.start_byte;
                for line in text.split_inclusive('\n') {
                    if current_line == start_line && start_byte.is_none() {
                        start_byte = Some(line_offset);
                    }
                    if current_line == end_line {
                        end_byte = Some(line_offset + line.len() as u64);
                        break;
                    }
                    line_offset += line.len() as u64;
                    current_line += 1;
                }
            } else if start_byte.is_some() && end_byte.is_none() {
                let text = self.read_chunk(source, desc.chunk_index)?;
                let mut line_offset = desc.start_byte;
                for line in text.split_inclusive('\n') {
                    if current_line == end_line {
                        end_byte = Some(line_offset + line.len() as u64);
                        break;
                    }
                    line_offset += line.len() as u64;
                    current_line += 1;
                }
            } else {
                current_line = next_line;
            }

            if start_byte.is_some() && end_byte.is_some() {
                break;
            }
        }

        let s_offset = start_byte.unwrap_or(0);
        let e_offset = end_byte.unwrap_or(self.total_bytes);
        if s_offset >= self.total_bytes {
            return Ok(String::new());
        }
        let len = e_offset.saturating_sub(s_offset);
        self.read_range(source, s_offset, len)
    }
}

/// Match found by DocumentIndex::search
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexSearchMatch {
    pub chunk_index: usize,
    pub byte_offset: u64,
    pub snippet: String,
}

/// Counts newline characters in slice
fn count_newlines(slice: &[u8]) -> usize {
    slice.iter().filter(|&&b| b == b'\n').count()
}

/// Checks if byte is a UTF-8 continuation byte (0b10xxxxxx)
fn is_utf8_continuation(b: u8) -> bool {
    (b & 0b1100_0000) == 0b1000_0000
}

/// Adjusts cut_point backward if landing in middle of multi-byte sequence
fn align_utf8_boundary(slice: &[u8], mut idx: usize) -> usize {
    if idx >= slice.len() {
        return slice.len();
    }
    while idx > 0 && is_utf8_continuation(slice[idx]) {
        idx -= 1;
    }
    idx
}

/// Adjusts cut_point forward if landing in middle of multi-byte sequence
fn align_utf8_forward(slice: &[u8], mut idx: usize) -> usize {
    if idx >= slice.len() {
        return slice.len();
    }
    while idx < slice.len() && is_utf8_continuation(slice[idx]) {
        idx += 1;
    }
    idx
}

/// Converts bytes to UTF-8 without trailing / leading broken code point artifacts
pub fn clean_utf8_lossy(slice: &[u8]) -> String {
    if slice.is_empty() {
        return String::new();
    }

    // Trim leading continuation bytes
    let mut start = 0;
    while start < slice.len() && is_utf8_continuation(slice[start]) {
        start += 1;
    }
    if start >= slice.len() {
        return String::new();
    }

    // Trim trailing incomplete multi-byte sequence
    let mut end = slice.len();
    // Look backward up to 4 bytes
    let lookback_start = end.saturating_sub(4).max(start);
    for i in (lookback_start..end).rev() {
        let b = slice[i];
        if !is_utf8_continuation(b) {
            let expected_len = if (b & 0b1000_0000) == 0 {
                1
            } else if (b & 0b1110_0000) == 0b1100_0000 {
                2
            } else if (b & 0b1111_0000) == 0b1110_0000 {
                3
            } else if (b & 0b1111_1000) == 0b1111_0000 {
                4
            } else {
                1
            };
            if end - i < expected_len {
                end = i;
            }
            break;
        }
    }

    String::from_utf8_lossy(&slice[start..end]).to_string()
}
