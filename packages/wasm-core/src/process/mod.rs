pub mod io;

use std::collections::HashMap;
use crate::error::{Result, SandboxError};

#[derive(Debug)]
pub struct ProcessEntry {
    pub pid: u32,
    pub command: String,
    pub args: Vec<String>,
    pub running: bool,
    pub exit_code: Option<i32>,
}

pub struct ProcessManager {
    processes: HashMap<u32, ProcessEntry>,
    next_pid: u32,
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            processes: HashMap::new(),
            next_pid: 1000,
        }
    }

    pub fn spawn(&mut self, command: String, args: Vec<String>) -> u32 {
        let pid = self.next_pid;
        self.next_pid += 1;

        let entry = ProcessEntry {
            pid,
            command,
            args,
            running: true,
            exit_code: None,
        };
        self.processes.insert(pid, entry);
        pid
    }

    pub fn kill(&mut self, pid: u32) -> Result<()> {
        let proc = self.processes.get_mut(&pid).ok_or(SandboxError::ProcessNotFound(pid))?;
        proc.running = false;
        proc.exit_code = Some(130); // SIGINT / termination code
        Ok(())
    }

    pub fn set_exit_code(&mut self, pid: u32, code: i32) -> Result<()> {
        let proc = self.processes.get_mut(&pid).ok_or(SandboxError::ProcessNotFound(pid))?;
        proc.running = false;
        proc.exit_code = Some(code);
        Ok(())
    }

    pub fn get(&self, pid: u32) -> Option<&ProcessEntry> {
        self.processes.get(&pid)
    }
}
