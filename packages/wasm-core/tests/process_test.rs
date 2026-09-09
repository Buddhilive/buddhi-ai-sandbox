use buddhilive_sandbox_core::process::ProcessManager;

#[test]
fn test_process_lifecycle() {
    let mut pm = ProcessManager::new();

    let pid1 = pm.spawn("node".to_string(), vec!["/workspace/app.js".to_string()]);
    let pid2 = pm.spawn("node".to_string(), vec!["/workspace/worker.js".to_string()]);

    assert_ne!(pid1, pid2);

    let p1 = pm.get(pid1).expect("Process 1 exists");
    assert!(p1.running);
    assert_eq!(p1.command, "node");

    pm.set_exit_code(pid1, 0).expect("Exit process 1");
    let p1_after = pm.get(pid1).unwrap();
    assert!(!p1_after.running);
    assert_eq!(p1_after.exit_code, Some(0));

    pm.kill(pid2).expect("Kill process 2");
    let p2_after = pm.get(pid2).unwrap();
    assert!(!p2_after.running);
    assert_eq!(p2_after.exit_code, Some(130)); // SIGINT termination code
}
