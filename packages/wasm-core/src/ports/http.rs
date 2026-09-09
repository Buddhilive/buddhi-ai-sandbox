use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualHttpRequest {
    pub id: String,
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualHttpResponse {
    pub id: String,
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: Option<Vec<u8>>,
}

impl VirtualHttpResponse {
    pub fn new(id: String, status: u16, status_text: &str) -> Self {
        Self {
            id,
            status,
            status_text: status_text.to_string(),
            headers: HashMap::new(),
            body: None,
        }
    }

    pub fn not_found(id: String) -> Self {
        Self::new(id, 404, "Not Found")
    }

    pub fn service_unavailable(id: String) -> Self {
        Self::new(id, 503, "Service Unavailable")
    }
}
