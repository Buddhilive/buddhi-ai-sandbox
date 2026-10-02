use buddhilive_sandbox_core::rlm::index::DocumentIndex;
use buddhilive_sandbox_core::rlm::source::MemSource;

#[test]
fn test_index_chunk_alignment_and_utf8() {
    // Generate text with emoji and CJK multi-byte characters repeated across ~20 KB
    let mut sample_text = String::new();
    for i in 0..200 {
        sample_text.push_str(&format!(
            "Line {}: Quantum entanglement 🔬 宇宙 is a physical phenomenon. 🌟\n",
            i
        ));
    }

    let source = MemSource::from_str(&sample_text);
    let index = DocumentIndex::build(&source, 4096).expect("Index build should succeed");

    assert!(index.chunk_count() >= 3);
    assert_eq!(index.total_bytes, sample_text.len() as u64);

    // Verify every chunk's start and end byte boundaries are strictly valid UTF-8 boundaries
    for chunk in &index.chunks {
        let chunk_slice = &sample_text[chunk.start_byte as usize..chunk.end_byte as usize];
        assert!(!chunk_slice.is_empty());
        // Verify reading chunk via index API matches slice
        let read_str = index
            .read_chunk(&source, chunk.chunk_index)
            .expect("Chunk read should succeed");
        assert_eq!(read_str, chunk_slice);
    }
}

#[test]
fn test_read_range_bounds_and_clamping() {
    let text = "Hello world! This is a test document with multiple sentences.\nLine 2.\nLine 3.";
    let source = MemSource::from_str(text);
    let index = DocumentIndex::build(&source, 1024).expect("Index build should succeed");

    // Read middle range
    let slice1 = index
        .read_range(&source, 0, 5)
        .expect("Read should succeed");
    assert_eq!(slice1, "Hello");

    // Read with length exceeding total length (clamps to EOF)
    let slice_eof = index
        .read_range(&source, 0, 10000)
        .expect("Read at EOF should clamp");
    assert_eq!(slice_eof, text);

    // Read past EOF should return empty string without error
    let slice_past = index
        .read_range(&source, 5000, 100)
        .expect("Read past EOF should return empty");
    assert_eq!(slice_past, "");

    // Read with offset landing on multi-byte emoji
    let emoji_text = "Emoji: 🎉🎊🎈!";
    let emoji_source = MemSource::from_str(emoji_text);
    let emoji_index = DocumentIndex::build(&emoji_source, 1024).unwrap();

    // Byte 7 is in the middle of 🎉 (F0 9F 8E 89)
    let safe_slice = emoji_index
        .read_range(&emoji_source, 7, 8)
        .expect("Should safely sanitize UTF-8 boundaries");
    assert!(!safe_slice.is_empty());
}

#[test]
fn test_index_bounded_search_and_patterns() {
    let mut doc = String::new();
    for i in 0..50 {
        if i == 10 {
            doc.push_str("Here is the secret keyword: ALGORITHM_ALPHA in line 10.\n");
        } else if i == 30 {
            doc.push_str("Another reference to algorithm_alpha occurred in line 30.\n");
        } else {
            doc.push_str(&format!("Ordinary filler text line {} with no key.\n", i));
        }
    }

    let source = MemSource::from_str(&doc);
    let index = DocumentIndex::build(&source, 1024).expect("Index build should succeed");

    // Exact search
    let matches_exact = index
        .search(&source, "ALGORITHM_ALPHA", 5)
        .expect("Search should succeed");
    assert_eq!(matches_exact.len(), 1);
    assert!(matches_exact[0].snippet.contains("ALGORITHM_ALPHA"));

    // Case-insensitive search
    let matches_ci = index
        .search(&source, "(?i)algorithm_alpha", 5)
        .expect("Search should succeed");
    assert_eq!(matches_ci.len(), 2);

    // Wildcard search
    let matches_wc = index
        .search(&source, "secret*ALGORITHM", 5)
        .expect("Wildcard search should succeed");
    assert_eq!(matches_wc.len(), 1);

    // Max matches limit
    let matches_limited = index
        .search(&source, "filler", 1)
        .expect("Search should succeed");
    assert_eq!(matches_limited.len(), 1);
}

#[test]
fn test_benchmark_10mb_indexing_and_slicing() {
    use std::time::Instant;

    // Create a 10MB synthetic corpus
    let line = "This is a benchmark line for out-of-core OPFS and Rust WASM indexing performance testing.\n";
    let repeat_count = (10 * 1024 * 1024) / line.len();
    let text = line.repeat(repeat_count);

    let source = MemSource::from_str(&text);

    let start_index = Instant::now();
    let index = DocumentIndex::build(&source, 8192).expect("Index build should succeed");
    let index_duration = start_index.elapsed();

    println!("10MB indexing completed in {:?}", index_duration);
    assert!(
        index_duration.as_millis() < 500,
        "10MB indexing took {}ms, expected < 500ms",
        index_duration.as_millis()
    );

    // Random byte-range reads
    let start_read = Instant::now();
    for i in 0..100 {
        let offset = ((i * 98765) % (text.len() - 500)) as u64;
        let slice = index
            .read_range(&source, offset, 200)
            .expect("Read should succeed");
        assert_eq!(slice.len(), 200);
    }
    let total_read_duration = start_read.elapsed();
    let avg_read_micros = total_read_duration.as_micros() / 100;
    println!(
        "100 random reads took {:?} (avg {} µs/read)",
        total_read_duration, avg_read_micros
    );
    assert!(avg_read_micros < 10000);
}
