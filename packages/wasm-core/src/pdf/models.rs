use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoundingBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentBlock {
    pub id: String,
    #[serde(rename = "type")]
    pub block_type: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<u8>,
    pub page_number: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bbox: Option<BoundingBox>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedTable {
    pub id: String,
    pub page_number: u32,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub markdown: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bbox: Option<BoundingBox>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageData {
    pub page_number: u32,
    pub width: f32,
    pub height: f32,
    pub blocks: Vec<DocumentBlock>,
    pub tables: Vec<ExtractedTable>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authors: Option<Vec<String>>,
    pub total_pages: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creation_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub producer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableOfContentsItem {
    pub title: String,
    pub level: u8,
    pub page_number: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedDocument {
    pub id: String,
    pub metadata: DocumentMetadata,
    pub markdown: String,
    pub pages: Vec<PageData>,
    pub toc: Vec<TableOfContentsItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionProgress {
    pub stage: String,
    pub page_current: u32,
    pub page_total: u32,
    pub percent: f32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExtractionConfig {
    #[serde(default)]
    pub extract_tables: bool,
    #[serde(default)]
    pub extract_images: bool,
    #[serde(default)]
    pub document_id: Option<String>,
}
