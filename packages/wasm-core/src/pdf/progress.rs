use wasm_bindgen::prelude::*;
use crate::pdf::models::ExtractionProgress;

pub struct ProgressReporter<'a> {
    callback: Option<&'a js_sys::Function>,
}

impl<'a> ProgressReporter<'a> {
    pub fn new(callback: Option<&'a js_sys::Function>) -> Self {
        Self { callback }
    }

    pub fn report(
        &self,
        stage: &str,
        page_current: u32,
        page_total: u32,
        percent: f32,
        message: &str,
    ) {
        if let Some(cb) = self.callback {
            let progress = ExtractionProgress {
                stage: stage.to_string(),
                page_current,
                page_total,
                percent,
                message: message.to_string(),
            };
            if let Ok(js_val) = serde_wasm_bindgen::to_value(&progress) {
                let _ = cb.call1(&JsValue::NULL, &js_val);
            }
        }
    }
}
