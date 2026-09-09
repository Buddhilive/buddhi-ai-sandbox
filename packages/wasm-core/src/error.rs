use wasm_bindgen::prelude::*;
use std::fmt;

#[derive(Debug)]
pub enum SandboxError {
    NotFound(String),
    AlreadyExists(String),
    NotADirectory(String),
    IsADirectory(String),
    DirectoryNotEmpty(String),
    InvalidPath(String),
    TooManyLinks,
    IOError(String),
    ProcessNotFound(u32),
    OutOfMemory,
    ExecutionFailed(String),
}

impl fmt::Display for SandboxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SandboxError::NotFound(p) => write!(f, "ENOENT: no such file or directory, '{}'", p),
            SandboxError::AlreadyExists(p) => write!(f, "EEXIST: file already exists, '{}'", p),
            SandboxError::NotADirectory(p) => write!(f, "ENOTDIR: not a directory, '{}'", p),
            SandboxError::IsADirectory(p) => write!(f, "EISDIR: illegal operation on a directory, '{}'", p),
            SandboxError::DirectoryNotEmpty(p) => write!(f, "ENOTEMPTY: directory not empty, '{}'", p),
            SandboxError::InvalidPath(p) => write!(f, "EINVAL: invalid path, '{}'", p),
            SandboxError::TooManyLinks => write!(f, "ELOOP: too many levels of symbolic links"),
            SandboxError::IOError(msg) => write!(f, "EIO: i/o error: {}", msg),
            SandboxError::ProcessNotFound(pid) => write!(f, "ESRCH: no such process, PID {}", pid),
            SandboxError::OutOfMemory => write!(f, "ENOMEM: out of memory"),
            SandboxError::ExecutionFailed(msg) => write!(f, "Execution error: {}", msg),
        }
    }
}

impl std::error::Error for SandboxError {}

impl From<SandboxError> for JsValue {
    fn from(err: SandboxError) -> Self {
        JsValue::from_str(&err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, SandboxError>;
