pub mod error;
pub mod pdf;
pub mod ports;
pub mod process;
pub mod rlm;
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
pub fn pdf_extract_bytes(
    data: &[u8],
    config_js: JsValue,
    on_progress: Option<js_sys::Function>,
) -> Result<JsValue, JsValue> {
    let config: crate::pdf::ExtractionConfig = if config_js.is_undefined() || config_js.is_null() {
        crate::pdf::ExtractionConfig::default()
    } else {
        serde_wasm_bindgen::from_value(config_js)
            .map_err(|e| JsValue::from_str(&format!("Invalid extraction config: {}", e)))?
    };

    let reporter = crate::pdf::ProgressReporter::new(on_progress.as_ref());
    let doc = crate::pdf::PdfEngine::extract(data, &config, &reporter)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    serde_wasm_bindgen::to_value(&doc)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {}", e)))
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

#[wasm_bindgen]
pub fn rlm_session_create(session_id: &str, config_js: JsValue) -> Result<String, JsValue> {
    let config: crate::rlm::RlmConfig = if config_js.is_undefined() || config_js.is_null() {
        crate::rlm::RlmConfig::default()
    } else {
        serde_wasm_bindgen::from_value(config_js)
            .map_err(|e| JsValue::from_str(&format!("Invalid RLM config: {}", e)))?
    };

    crate::rlm::create_session(session_id.to_string(), config);
    Ok(session_id.to_string())
}

#[wasm_bindgen]
pub fn rlm_session_push_context(session_id: &str, text: &str) -> Result<usize, JsValue> {
    crate::rlm::push_context(session_id, text)
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn rlm_session_init_query(session_id: &str, query: &str) -> Result<(), JsValue> {
    crate::rlm::run_session_init(session_id, query)
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn rlm_session_step(session_id: &str) -> Result<JsValue, JsValue> {
    let step_res = crate::rlm::session_step(session_id)
        .map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&step_res)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

#[wasm_bindgen]
pub fn rlm_session_feed_response(
    session_id: &str,
    turn_id: &str,
    response: &str,
) -> Result<JsValue, JsValue> {
    let step_res = crate::rlm::session_feed_response(session_id, turn_id, response)
        .map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&step_res)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

#[wasm_bindgen]
pub fn rlm_session_cancel(session_id: &str) -> Result<bool, JsValue> {
    crate::rlm::session_cancel(session_id)
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn rlm_session_destroy(session_id: &str) -> bool {
    crate::rlm::session_destroy(session_id)
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn rlm_session_attach_opfs(
    session_id: &str,
    handle: web_sys::FileSystemSyncAccessHandle,
) -> Result<usize, JsValue> {
    crate::rlm::session_attach_opfs(session_id, handle)
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn rlm_session_attach_text(session_id: &str, text: &str) -> Result<usize, JsValue> {
    crate::rlm::session_attach_text(session_id, text)
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn rlm_session_read_range(
    session_id: &str,
    offset: f64,
    length: f64,
) -> Result<String, JsValue> {
    crate::rlm::session_read_range(session_id, offset as u64, length as u64)
        .map_err(|e| JsValue::from_str(&e))
}
