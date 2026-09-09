use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMeta {
    pub mode: u32,
    pub size: u64,
    pub mtime_ms: f64,
    pub ctime_ms: f64,
}

pub fn current_time_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0)
    }
}

impl FileMeta {
    pub fn new_file(mode: u32) -> Self {
        let now = current_time_ms();
        Self {
            mode,
            size: 0,
            mtime_ms: now,
            ctime_ms: now,
        }
    }

    pub fn new_dir(mode: u32) -> Self {
        let now = current_time_ms();
        Self {
            mode,
            size: 4096,
            mtime_ms: now,
            ctime_ms: now,
        }
    }

    pub fn new_symlink() -> Self {
        let now = current_time_ms();
        Self {
            mode: 0o777,
            size: 0,
            mtime_ms: now,
            ctime_ms: now,
        }
    }
}

#[derive(Debug, Clone)]
pub enum INodeKind {
    File { data: Vec<u8> },
    Directory { children: std::collections::BTreeMap<String, u64> },
    Symlink { target: String },
}

#[derive(Debug, Clone)]
pub struct INode {
    pub id: u64,
    pub meta: FileMeta,
    pub kind: INodeKind,
}

impl INode {
    pub fn is_file(&self) -> bool {
        matches!(self.kind, INodeKind::File { .. })
    }

    pub fn is_dir(&self) -> bool {
        matches!(self.kind, INodeKind::Directory { .. })
    }

    pub fn is_symlink(&self) -> bool {
        matches!(self.kind, INodeKind::Symlink { .. })
    }
}
