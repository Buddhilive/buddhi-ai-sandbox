pub mod error;
pub mod ports;
pub mod process;
pub mod vfs;

use std::sync::Mutex;
use wasm_bindgen::prelude::*;
use crate::ports::PortManager;
use crate::process::ProcessManager;
use crate::vfs::VirtualFS;

static RUNTIME: Mutex<Option<SandboxRuntime>> = Mutex::new(None);

pub struct SandboxRuntime {
    pub vfs: VirtualFS,
    pub processes: ProcessManager,
    pub ports: PortManager,
}

impl SandboxRuntime {
    pub fn new() -> Self {
        Self {
            vfs: VirtualFS::new(),
            processes: ProcessManager::new(),
            ports: PortManager::new(),
        }
    }
}

#[wasm_bindgen]
pub fn sandbox_init() -> bool {
    let mut rt = RUNTIME.lock().unwrap();
    *rt = Some(SandboxRuntime::new());
    true
}

#[wasm_bindgen]
pub fn sandbox_core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[wasm_bindgen]
pub fn vfs_write_file(path: &str, data: &[u8]) -> Result<(), JsValue> {
    let mut lock = RUNTIME.lock().unwrap();
    let rt = lock.as_mut().ok_or_else(|| JsValue::from_str("Runtime not initialized"))?;
    rt.vfs.write_file(path, data).map_err(|e| JsValue::from(e))
}

#[wasm_bindgen]
pub fn vfs_read_file(path: &str) -> Result<Vec<u8>, JsValue> {
    let lock = RUNTIME.lock().unwrap();
    let rt = lock.as_ref().ok_or_else(|| JsValue::from_str("Runtime not initialized"))?;
    rt.vfs.read_file(path).map_err(|e| JsValue::from(e))
}

#[wasm_bindgen]
pub fn vfs_mkdir(path: &str, recursive: bool) -> Result<(), JsValue> {
    let mut lock = RUNTIME.lock().unwrap();
    let rt = lock.as_mut().ok_or_else(|| JsValue::from_str("Runtime not initialized"))?;
    rt.vfs.mkdir(path, recursive).map_err(|e| JsValue::from(e))
}

#[wasm_bindgen]
pub fn vfs_readdir(path: &str) -> Result<JsValue, JsValue> {
    let lock = RUNTIME.lock().unwrap();
    let rt = lock.as_ref().ok_or_else(|| JsValue::from_str("Runtime not initialized"))?;
    let entries = rt.vfs.readdir(path).map_err(|e| JsValue::from(e))?;
    serde_wasm_bindgen::to_value(&entries).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn vfs_rm(path: &str, recursive: bool) -> Result<(), JsValue> {
    let mut lock = RUNTIME.lock().unwrap();
    let rt = lock.as_mut().ok_or_else(|| JsValue::from_str("Runtime not initialized"))?;
    rt.vfs.rm(path, recursive).map_err(|e| JsValue::from(e))
}

#[wasm_bindgen]
pub fn vfs_stat(path: &str) -> Result<JsValue, JsValue> {
    let lock = RUNTIME.lock().unwrap();
    let rt = lock.as_ref().ok_or_else(|| JsValue::from_str("Runtime not initialized"))?;
    let stat = rt.vfs.stat(path).map_err(|e| JsValue::from(e))?;
    serde_wasm_bindgen::to_value(&stat).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn vfs_symlink(target: &str, path: &str) -> Result<(), JsValue> {
    let mut lock = RUNTIME.lock().unwrap();
    let rt = lock.as_mut().ok_or_else(|| JsValue::from_str("Runtime not initialized"))?;
    rt.vfs.symlink(target, path).map_err(|e| JsValue::from(e))
}

#[wasm_bindgen]
pub fn process_spawn(command: &str, args: Vec<String>) -> Result<u32, JsValue> {
    let mut lock = RUNTIME.lock().unwrap();
    let rt = lock.as_mut().ok_or_else(|| JsValue::from_str("Runtime not initialized"))?;
    let pid = rt.processes.spawn(command.to_string(), args);
    Ok(pid)
}

#[wasm_bindgen]
pub fn process_kill(pid: u32) -> Result<(), JsValue> {
    let mut lock = RUNTIME.lock().unwrap();
    let rt = lock.as_mut().ok_or_else(|| JsValue::from_str("Runtime not initialized"))?;
    rt.processes.kill(pid).map_err(|e| JsValue::from(e))
}
