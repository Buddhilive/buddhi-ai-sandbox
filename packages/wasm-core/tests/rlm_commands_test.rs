use buddhilive_sandbox_core::rlm::{
    commands::{parse_command, RlmCommand},
    RlmConfig, RlmMode, RlmSession, RlmStepResult, LlmRole,
};

#[test]
fn test_commands_parser_keyword_and_json_and_fences() {
    // 1. Keyword form
    let cmd1 = parse_command("PEEK 100 500").unwrap();
    assert_eq!(cmd1, RlmCommand::Peek { offset: 100, length: 500 });

    let cmd2 = parse_command("SEARCH \"encryption key\"").unwrap();
    assert_eq!(cmd2, RlmCommand::Search { pattern: "encryption key".to_string(), max_matches: 5 });

    let cmd3 = parse_command("LINES 10 25").unwrap();
    assert_eq!(cmd3, RlmCommand::Lines { start_line: 10, end_line: 25 });

    let cmd4 = parse_command("SET summary = \"This is a summary note\"").unwrap();
    assert_eq!(cmd4, RlmCommand::Set { name: "summary".to_string(), value: "This is a summary note".to_string() });

    let cmd5 = parse_command("GET summary").unwrap();
    assert_eq!(cmd5, RlmCommand::Get { name: "summary".to_string() });

    let cmd6 = parse_command("SUBQUERY 50 150 \"What is the secret?\" -> note1").unwrap();
    assert_eq!(cmd6, RlmCommand::SubQuery {
        start_offset: 50,
        end_offset: 150,
        prompt: "What is the secret?".to_string(),
        target_var: Some("note1".to_string()),
    });

    // 2. JSON argument form
    let json_peek = parse_command(r#"PEEK {"offset": 1024, "length": 2048}"#).unwrap();
    assert_eq!(json_peek, RlmCommand::Peek { offset: 1024, length: 2048 });

    let json_search = parse_command(r#"SEARCH {"pattern": "secret_token", "max": 3}"#).unwrap();
    assert_eq!(json_search, RlmCommand::Search { pattern: "secret_token".to_string(), max_matches: 3 });

    let json_batch = parse_command(r#"SUBQUERY_BATCH {"slices": [[0, 100], [200, 300]], "prompt": "extract data", "target_var": "batch_res"}"#).unwrap();
    match json_batch {
        RlmCommand::SubQueryBatch { slices, prompt, target_var } => {
            assert_eq!(slices, vec![(0, 100), (200, 300)]);
            assert_eq!(prompt, "extract data");
            assert_eq!(target_var, Some("batch_res".to_string()));
        }
        _ => panic!("Expected SubQueryBatch"),
    }

    // 3. Leading conversational chatter & markdown code fences
    let chatter = r#"
Sure! Let me inspect the document to find the algorithm details.
```rlm
SEARCH "QuantumEntanglement"
```
Hope this helps!
"#;
    let cmd_chatter = parse_command(chatter).unwrap();
    assert_eq!(cmd_chatter, RlmCommand::Search { pattern: "QuantumEntanglement".to_string(), max_matches: 5 });

    // 4. Malformed input error
    let malformed = "I am not providing any command, just chatting away.";
    assert!(parse_command(malformed).is_err());
}

#[test]
fn test_explore_mode_execution_cycle() {
    let mut config = RlmConfig::default();
    config.mode = RlmMode::Explore;
    config.max_turns = 5;

    let mut session = RlmSession::new("test_explore_1".to_string(), config);
    let sample_doc = "Header: Title\nLine 2: Important secret key is ALPHA_99.\nLine 3: End of file.\n";
    session.attach_mem_source(sample_doc).unwrap();
    session.set_query("What is the secret key?");

    // Turn 1: Step emits root prompt
    let step1 = session.step();
    let turn1_id = match step1 {
        RlmStepResult::NeedsLlm { turn_id, prompt, role, .. } => {
            assert_eq!(role, LlmRole::Root);
            assert!(prompt.contains("Available Commands"));
            turn_id
        }
        _ => panic!("Expected NeedsLlm for turn 1"),
    };

    // Root model runs SEARCH command
    let step2 = session.feed_response(&turn1_id, "SEARCH \"secret key\"");
    let turn2_id = match step2 {
        RlmStepResult::NeedsLlm { turn_id, prompt, role, .. } => {
            assert_eq!(role, LlmRole::Root);
            assert!(prompt.contains("ALPHA_99")); // Observation fed back in prompt
            turn_id
        }
        _ => panic!("Expected NeedsLlm with observation for turn 2"),
    };

    // Root model saves findings into note and issues FINAL
    let step3 = session.feed_response(&turn2_id, "FINAL(\"The secret key is ALPHA_99\")");
    match step3 {
        RlmStepResult::Done { answer, terminated_by, iterations, .. } => {
            assert_eq!(answer, "The secret key is ALPHA_99");
            assert_eq!(terminated_by, "FINAL");
            assert_eq!(iterations, 2);
        }
        _ => panic!("Expected Done from FINAL"),
    }
}

#[test]
fn test_subquery_dispatch_and_variable_store() {
    let mut config = RlmConfig::default();
    config.mode = RlmMode::Explore;
    config.max_sub_queries = 2;

    let mut session = RlmSession::new("test_sub_1".to_string(), config);
    let doc = "0123456789 The hidden password is PASSWORD123 in slice 1. 0123456789";
    session.attach_mem_source(doc).unwrap();
    session.set_query("Find password");

    let step1 = session.step();
    let turn1_id = match step1 {
        RlmStepResult::NeedsLlm { turn_id, .. } => turn_id,
        _ => panic!("Expected NeedsLlm"),
    };

    // Root issues SUBQUERY
    let step2 = session.feed_response(
        &turn1_id,
        "SUBQUERY 10 60 \"Extract the password\" -> found_pwd",
    );

    // Should emit NeedsLlm with role: Sub!
    let (sub_turn_id, sub_prompt) = match step2 {
        RlmStepResult::NeedsLlm { turn_id, prompt, role, sub_id, .. } => {
            assert_eq!(role, LlmRole::Sub);
            assert!(sub_id.is_some());
            assert!(prompt.contains("Extract the password"));
            assert!(prompt.contains("PASSWORD123"));
            (turn_id, prompt)
        }
        _ => panic!("Expected NeedsLlm with role Sub"),
    };
    assert!(!sub_prompt.is_empty());

    // Submodel responds
    let step3 = session.feed_response(&sub_turn_id, "The extracted password is PASSWORD123");

    // Returns back to Root turn with observation
    let turn2_id = match step3 {
        RlmStepResult::NeedsLlm { turn_id, prompt, role, .. } => {
            assert_eq!(role, LlmRole::Root);
            assert!(prompt.contains("Subquery completed"));
            assert!(prompt.contains("found_pwd"));
            turn_id
        }
        _ => panic!("Expected NeedsLlm for Root turn"),
    };

    // Verify variable store received the subquery output
    assert_eq!(
        session.variable_store.get("found_pwd"),
        Some("The extracted password is PASSWORD123")
    );

    // Root concludes with FINAL_VAR
    let step4 = session.feed_response(&turn2_id, "FINAL_VAR(found_pwd)");
    match step4 {
        RlmStepResult::Done { answer, terminated_by, .. } => {
            assert_eq!(answer, "The extracted password is PASSWORD123");
            assert_eq!(terminated_by, "FINAL_VAR");
        }
        _ => panic!("Expected Done from FINAL_VAR"),
    }
}

#[test]
fn test_subquery_batch_order_and_execution() {
    let mut config = RlmConfig::default();
    config.mode = RlmMode::Explore;
    config.max_sub_queries = 5;

    let mut session = RlmSession::new("test_sub_batch".to_string(), config);
    let doc = "Section A: Apple. Section B: Banana. Section C: Cherry.";
    session.attach_mem_source(doc).unwrap();
    session.set_query("Identify fruits");

    let turn1_id = match session.step() {
        RlmStepResult::NeedsLlm { turn_id, .. } => turn_id,
        _ => panic!("Expected NeedsLlm"),
    };

    // Issue SUBQUERY_BATCH with 2 slices
    let step2 = session.feed_response(
        &turn1_id,
        r#"SUBQUERY_BATCH {"slices": [[0, 18], [19, 37]], "prompt": "What fruit?", "target_var": "fruit"}"#,
    );

    // Subquery 0 (Section A: Apple)
    let sub0_id = match step2 {
        RlmStepResult::NeedsLlm { turn_id, prompt, role, .. } => {
            assert_eq!(role, LlmRole::Sub);
            assert!(prompt.contains("Apple"));
            turn_id
        }
        _ => panic!("Expected subquery 0"),
    };

    // Submodel 0 answers
    let step3 = session.feed_response(&sub0_id, "Apple");

    // Subquery 1 (Section B: Banana)
    let sub1_id = match step3 {
        RlmStepResult::NeedsLlm { turn_id, prompt, role, .. } => {
            assert_eq!(role, LlmRole::Sub);
            assert!(prompt.contains("Banana"));
            turn_id
        }
        _ => panic!("Expected subquery 1"),
    };

    // Submodel 1 answers
    let step4 = session.feed_response(&sub1_id, "Banana");

    // Returns back to Root
    let turn2_id = match step4 {
        RlmStepResult::NeedsLlm { turn_id, role, .. } => {
            assert_eq!(role, LlmRole::Root);
            turn_id
        }
        _ => panic!("Expected Root turn after batch"),
    };

    assert_eq!(session.variable_store.get("fruit_0"), Some("Apple"));
    assert_eq!(session.variable_store.get("fruit_1"), Some("Banana"));

    let done = session.feed_response(&turn2_id, "FINAL(\"Apple and Banana\")");
    match done {
        RlmStepResult::Done { answer, .. } => assert_eq!(answer, "Apple and Banana"),
        _ => panic!("Expected Done"),
    }
}

#[test]
fn test_budget_exhaustion_forces_synthesis() {
    let mut config = RlmConfig::default();
    config.mode = RlmMode::Explore;
    config.max_turns = 2; // Very short turn budget

    let mut session = RlmSession::new("test_budget_synth".to_string(), config);
    session.attach_mem_source("Doc with facts.").unwrap();
    session.set_query("Summarize facts");

    let turn1_id = match session.step() {
        RlmStepResult::NeedsLlm { turn_id, .. } => turn_id,
        _ => panic!("Expected NeedsLlm"),
    };

    // Turn 1 response: sets note into variable
    let step2 = session.feed_response(&turn1_id, "SET notes = \"Fact A gathered\"");
    let turn2_id = match step2 {
        RlmStepResult::NeedsLlm { turn_id, .. } => turn_id,
        _ => panic!("Expected NeedsLlm"),
    };

    // Turn 2 response: does a peek (reaching max_turns = 2)
    let step3 = session.feed_response(&turn2_id, "PEEK 0 10");

    // Next step must be forced synthesis prompt!
    let synth_turn_id = match step3 {
        RlmStepResult::NeedsLlm { turn_id, prompt, role, .. } => {
            assert_eq!(role, LlmRole::Root);
            assert!(prompt.contains("Budget limit reached"));
            assert!(prompt.contains("Fact A gathered"));
            turn_id
        }
        _ => panic!("Expected forced synthesis NeedsLlm step"),
    };

    // Synthesizer finishes
    let final_step = session.feed_response(&synth_turn_id, "FINAL(\"Synthesized: Fact A\")");
    match final_step {
        RlmStepResult::Done { answer, terminated_by, .. } => {
            assert_eq!(answer, "Synthesized: Fact A");
            assert_eq!(terminated_by, "budget");
        }
        _ => panic!("Expected Done with terminated_by = budget"),
    }
}
