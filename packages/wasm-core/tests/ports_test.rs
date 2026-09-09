use buddhilive_sandbox_core::ports::http::{VirtualHttpRequest, VirtualHttpResponse};
use buddhilive_sandbox_core::ports::PortManager;
use std::collections::HashMap;

#[test]
fn test_port_manager_listen_and_close() {
    let mut pm = PortManager::new();

    pm.listen(3000).expect("Listen on 3000");
    assert!(pm.is_listening(3000));
    assert_eq!(pm.active_ports(), vec![3000]);

    // Listening again on same port should return error (already in use)
    let err = pm.listen(3000);
    assert!(err.is_err());

    // Close port
    pm.close(3000).expect("Close 3000");
    assert!(!pm.is_listening(3000));
    assert!(pm.active_ports().is_empty());
}

#[test]
fn test_virtual_http_request_response() {
    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());

    let req = VirtualHttpRequest {
        id: "req_123".to_string(),
        method: "GET".to_string(),
        url: "/api/users".to_string(),
        headers: headers.clone(),
        body: None,
    };

    assert_eq!(req.method, "GET");
    assert_eq!(req.url, "/api/users");

    let res_ok = VirtualHttpResponse::new("req_123".to_string(), 200, "OK");
    assert_eq!(res_ok.status, 200);

    let res_503 = VirtualHttpResponse::service_unavailable("req_456".to_string());
    assert_eq!(res_503.status, 503);
    assert_eq!(res_503.status_text, "Service Unavailable");
}
