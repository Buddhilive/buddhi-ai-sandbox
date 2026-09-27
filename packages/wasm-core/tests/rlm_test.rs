use buddhilive_sandbox_core::rlm::{
    chunker::Chunker,
    context_store::ContextStore,
    extract_parenthesized_argument,
    strip_outer_quotes,
    variable_store::VariableStore,
    ChunkStrategy,
    RlmConfig,
    RlmSession,
    RlmStepResult,
};

#[test]
fn test_context_store_crud_and_search() {
    let mut store = ContextStore::new();
    assert_eq!(store.len(), 0);
    assert!(store.is_empty());

    store.push_chunk("First chunk of document discussing quantum computing.".to_string());
    store.push_chunk("Second chunk detailing error correction in qubits.".to_string());
    store.push_chunk("Third chunk presenting experimental benchmark data.".to_string());

    assert_eq!(store.len(), 3);
    assert!(!store.is_empty());

    assert_eq!(
        store.get(1),
        Some("Second chunk detailing error correction in qubits.")
    );
    assert_eq!(store.get(99), None);

    // Literal search
    let matches = store.search("quantum", 5);
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].chunk_index, 0);

    // Case-insensitive search with (?i)
    let matches_ci = store.search("(?i)QUANTUM", 5);
    assert_eq!(matches_ci.len(), 1);
    assert_eq!(matches_ci[0].chunk_index, 0);

    // Wildcard pattern search
    let matches_wildcard = store.search("error*qubits", 5);
    assert_eq!(matches_wildcard.len(), 1);
    assert_eq!(matches_wildcard[0].chunk_index, 1);

    // Clear
    store.clear();
    assert_eq!(store.len(), 0);
}

#[test]
fn test_variable_store_operations() {
    let mut vars = VariableStore::new();
    assert_eq!(vars.len(), 0);

    vars.set("query", "What is the speed of light?");
    vars.set("buffer", "Initial notes");

    assert!(vars.has("query"));
    assert_eq!(vars.get("query"), Some("What is the speed of light?"));
    assert_eq!(vars.get("buffer"), Some("Initial notes"));
    assert_eq!(vars.get("nonexistent"), None);

    // Overwrite
    vars.set("buffer", "Updated notes with more details");
    assert_eq!(vars.get("buffer"), Some("Updated notes with more details"));

    // State summary
    let summary = vars.format_state_summary();
    assert!(summary.contains("query"));
    assert!(summary.contains("buffer"));

    // Remove
    vars.remove("buffer");
    assert!(!vars.has("buffer"));

    vars.clear();
    assert_eq!(vars.len(), 0);
}

#[test]
fn test_parentheses_parser() {
    // Basic FINAL
    let text1 = "After reviewing the paper, FINAL(Quantum speedup is verified.)";
    assert_eq!(
        extract_parenthesized_argument(text1, "FINAL"),
        Some("Quantum speedup is verified.")
    );

    // Nested parentheses
    let text2 = "Here is the result: FINAL(The value is 42 (measured at 300K).)";
    assert_eq!(
        extract_parenthesized_argument(text2, "FINAL"),
        Some("The value is 42 (measured at 300K).")
    );

    // Quoted FINAL argument
    let text3 = "FINAL(\"Answer with quotes (nested)\")";
    let arg3 = extract_parenthesized_argument(text3, "FINAL").unwrap();
    assert_eq!(strip_outer_quotes(arg3), "Answer with quotes (nested)");

    // FINAL_VAR
    let text4 = "Thinking complete. FINAL_VAR(buffer)";
    assert_eq!(
        extract_parenthesized_argument(text4, "FINAL_VAR"),
        Some("buffer")
    );
}

#[test]
fn test_rlm_session_step_transitions() {
    let mut config = RlmConfig::default();
    config.max_depth = 3;
    let mut session = RlmSession::new("s1".to_string(), config);
    session.set_query("Explain entanglement");

    // Add context chunks
    session
        .context_store
        .push_chunk("Chunk 0: Entanglement is a physical phenomenon.".to_string());

    // Turn 1 step
    let step1 = session.step();
    match step1 {
        RlmStepResult::NeedsLlm {
            turn_id,
            prompt,
            iteration,
        } => {
            assert_eq!(iteration, 1);
            assert!(prompt.contains("Explain entanglement"));
            assert_eq!(turn_id, "turn_s1_1");

            // Turn 1 response: intermediate reasoning into buffer
            let step2 = session.feed_response(
                &turn_id,
                "Examining context...\nbuffer = \"Entanglement links quantum states.\"",
            );

            // Should automatically yield turn 2
            match step2 {
                RlmStepResult::NeedsLlm {
                    turn_id: turn2_id,
                    prompt: prompt2,
                    iteration: iter2,
                } => {
                    assert_eq!(iter2, 2);
                    assert!(prompt2.contains("buffer ="));

                    // Turn 2 response: emit FINAL
                    let final_step = session.feed_response(
                        &turn2_id,
                        "FINAL(Entanglement is a phenomenon where quantum states are correlated.)",
                    );

                    match final_step {
                        RlmStepResult::Done {
                            answer,
                            iterations,
                            terminated_by,
                            ..
                        } => {
                            assert_eq!(terminated_by, "FINAL");
                            assert_eq!(iterations, 2);
                            assert_eq!(
                                answer,
                                "Entanglement is a phenomenon where quantum states are correlated."
                            );
                        }
                        _ => panic!("Expected Done from FINAL"),
                    }
                }
                _ => panic!("Expected NeedsLlm for turn 2"),
            }
        }
        _ => panic!("Expected NeedsLlm for turn 1"),
    }
}

#[test]
fn test_rlm_session_max_depth_capping() {
    let mut config = RlmConfig::default();
    config.max_depth = 2;
    let mut session = RlmSession::new("s2".to_string(), config);

    let step1 = session.step();
    let turn1 = match step1 {
        RlmStepResult::NeedsLlm { turn_id, .. } => turn_id,
        _ => panic!("Expected NeedsLlm"),
    };

    let step2 = session.feed_response(&turn1, "Still thinking... no final yet.");
    let turn2 = match step2 {
        RlmStepResult::NeedsLlm { turn_id, .. } => turn_id,
        _ => panic!("Expected NeedsLlm for turn 2"),
    };

    let step3 = session.feed_response(&turn2, "Still thinking again...");
    match step3 {
        RlmStepResult::Done {
            terminated_by,
            iterations,
            ..
        } => {
            assert_eq!(terminated_by, "max_depth");
            assert_eq!(iterations, 2);
        }
        _ => panic!("Expected Done with max_depth"),
    }
}

#[test]
fn test_rlm_session_cancellation() {
    let config = RlmConfig::default();
    let mut session = RlmSession::new("s3".to_string(), config);
    session.cancel();

    let step = session.step();
    match step {
        RlmStepResult::Done { terminated_by, .. } => {
            assert_eq!(terminated_by, "cancelled");
        }
        _ => panic!("Expected Done with cancelled"),
    }
}

#[test]
fn test_chunking_strategies() {
    // 1. FixedChar strategy
    let text = "012345678901234567890123456789"; // 30 chars
    let fixed_chunks = Chunker::chunk(text, &ChunkStrategy::FixedChar(10));
    assert_eq!(fixed_chunks.len(), 3);
    assert_eq!(fixed_chunks[0], "0123456789");
    assert_eq!(fixed_chunks[1], "0123456789");
    assert_eq!(fixed_chunks[2], "0123456789");

    // FixedChar with multi-byte UTF-8 emojis/characters
    let utf8_text = "🦀 Rust is great! 🚀 WebAssembly is fast! ⚡";
    let utf8_chunks = Chunker::chunk(utf8_text, &ChunkStrategy::FixedChar(15));
    assert!(utf8_chunks.len() >= 2);
    // Ensure all chunks are valid UTF-8 strings (no panic)
    for c in &utf8_chunks {
        assert!(!c.is_empty());
    }

    // 2. Paragraph strategy (CRLF & LF)
    let para_text = "Paragraph 1: Introduction.\r\n\r\nParagraph 2: Methods and approaches.\n\nParagraph 3: Results.";
    let para_chunks = Chunker::chunk(para_text, &ChunkStrategy::Paragraph);
    assert_eq!(para_chunks.len(), 3);
    assert_eq!(para_chunks[0], "Paragraph 1: Introduction.");
    assert_eq!(para_chunks[1], "Paragraph 2: Methods and approaches.");
    assert_eq!(para_chunks[2], "Paragraph 3: Results.");

    // 3. Sentence strategy
    let sentence_text = "First sentence here. Second sentence starts! Does third sentence ask a question? Yes it does.";
    let sentence_chunks = Chunker::chunk(sentence_text, &ChunkStrategy::Sentence);
    assert_eq!(sentence_chunks.len(), 4);
    assert_eq!(sentence_chunks[0], "First sentence here.");
    assert_eq!(sentence_chunks[1], "Second sentence starts!");
    assert_eq!(sentence_chunks[2], "Does third sentence ask a question?");
    assert_eq!(sentence_chunks[3], "Yes it does.");
}

#[test]
fn test_bm25_search() {
    let mut store = ContextStore::new();
    store.push_chunk("Deep learning architectures and neural networks for vision.".to_string());
    store.push_chunk("Quantum entanglement and quantum computing superposition theory.".to_string());
    store.push_chunk("Relational databases, indexing strategies, and SQL optimization.".to_string());
    store.push_chunk("Quantum error correction codes in fault-tolerant quantum computers.".to_string());

    let results = store.bm25_search("quantum computing", 3);
    assert!(!results.is_empty());
    // The top results should be the quantum-related chunks (index 1 and 3)
    let top_idx = results[0].0;
    assert!(top_idx == 1 || top_idx == 3);

    // Empty / non-matching query returns empty
    let non_matching = store.bm25_search("astronomy astrophysics telescope", 3);
    assert!(non_matching.is_empty());
}

#[test]
fn test_rlm_session_final_buffer_resolution() {
    let mut config = RlmConfig::default();
    config.max_depth = 3;
    let mut session = RlmSession::new("s_buffer_test".to_string(), config);
    session.set_query("Summarize the paper");

    let step1 = session.step();
    let turn1 = match step1 {
        RlmStepResult::NeedsLlm { turn_id, .. } => turn_id,
        _ => panic!("Expected NeedsLlm"),
    };

    // Case 1: Model outputs buffer = "..." and FINAL(buffer) in turn 1
    let step2 = session.feed_response(
        &turn1,
        "Here are my findings:\nbuffer = \"This paper introduces a fast transformer architecture.\"\nFINAL(buffer)",
    );

    match step2 {
        RlmStepResult::Done { answer, terminated_by, iterations, .. } => {
            assert_eq!(terminated_by, "FINAL");
            assert_eq!(iterations, 1);
            assert_eq!(answer, "This paper introduces a fast transformer architecture.");
            assert_ne!(answer, "buffer");
        }
        _ => panic!("Expected Done with resolved buffer"),
    }
}

