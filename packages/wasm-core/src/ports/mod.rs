pub mod http;

use std::collections::HashMap;
use crate::error::{Result, SandboxError};

#[derive(Debug, Clone)]
pub struct PortEntry {
    pub port: u16,
    pub listening: bool,
}

pub struct PortManager {
    ports: HashMap<u16, PortEntry>,
}

impl PortManager {
    pub fn new() -> Self {
        Self {
            ports: HashMap::new(),
        }
    }

    pub fn listen(&mut self, port: u16) -> Result<()> {
        if let Some(entry) = self.ports.get(&port) {
            if entry.listening {
                return Err(SandboxError::AlreadyExists(format!("Port {} already in use", port)));
            }
        }

        self.ports.insert(port, PortEntry { port, listening: true });
        Ok(())
    }

    pub fn close(&mut self, port: u16) -> Result<()> {
        let entry = self.ports.get_mut(&port).ok_or_else(|| {
            SandboxError::NotFound(format!("Port {} not listening", port))
        })?;
        entry.listening = false;
        self.ports.remove(&port);
        Ok(())
    }

    pub fn is_listening(&self, port: u16) -> bool {
        self.ports.get(&port).map(|p| p.listening).unwrap_or(false)
    }

    pub fn active_ports(&self) -> Vec<u16> {
        self.ports.keys().copied().collect()
    }
}
