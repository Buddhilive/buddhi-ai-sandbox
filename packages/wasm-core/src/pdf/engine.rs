use edgeparse_core::api::config::{ImageOutput, ProcessingConfig, TableMethod};
use edgeparse_core::convert_bytes;
use edgeparse_core::models::content::ContentElement;
use edgeparse_core::output::markdown::to_markdown;

use crate::error::SandboxError;
use crate::pdf::models::{
    BoundingBox, DocumentBlock, DocumentMetadata, ExtractedDocument, ExtractedTable,
    ExtractionConfig, PageData, TableOfContentsItem,
};
use crate::pdf::progress::ProgressReporter;

pub struct PdfEngine;

impl PdfEngine {
    pub fn extract(
        data: &[u8],
        config: &ExtractionConfig,
        progress: &ProgressReporter,
    ) -> Result<ExtractedDocument, SandboxError> {
        if data.is_empty() {
            return Err(SandboxError::InvalidPdf("PDF data is empty".to_string()));
        }

        // Basic magic bytes check
        if data.len() < 4 || &data[0..4] != b"%PDF" {
            return Err(SandboxError::InvalidPdf(
                "Provided data does not begin with %PDF magic bytes".to_string(),
            ));
        }

        let doc_id = config
            .document_id
            .clone()
            .unwrap_or_else(|| format!("doc_{}", data.len()));

        progress.report("loading", 0, 0, 10.0, "Parsing PDF structure from bytes");

        let mut edge_config = ProcessingConfig::default();
        if config.extract_tables {
            edge_config.table_method = TableMethod::Cluster;
        }
        if config.extract_images {
            edge_config.image_output = ImageOutput::Embedded;
        } else {
            edge_config.image_output = ImageOutput::Off;
        }

        progress.report(
            "extracting_pages",
            0,
            0,
            30.0,
            "Extracting content elements across pages",
        );

        let doc = convert_bytes(data, &doc_id, &edge_config)
            .map_err(|e| SandboxError::PdfExtractionError(e.to_string()))?;

        let total_pages = doc.number_of_pages.max(1);

        progress.report(
            "detecting_tables",
            1,
            total_pages,
            60.0,
            "Analyzing layouts and tables",
        );

        progress.report(
            "generating_markdown",
            1,
            total_pages,
            80.0,
            "Synthesizing Markdown representation",
        );

        let markdown = to_markdown(&doc)
            .unwrap_or_else(|_| "# Document\n\n(Extracted text)".to_string());

        progress.report(
            "structuring",
            1,
            total_pages,
            90.0,
            "Structuring document AST and bounding boxes",
        );

        let mut pages: Vec<PageData> = Vec::with_capacity(total_pages as usize);
        for page_num in 1..=total_pages {
            pages.push(PageData {
                page_number: page_num,
                width: 612.0, // Standard letter default
                height: 792.0,
                blocks: Vec::new(),
                tables: Vec::new(),
            });
        }

        let mut toc: Vec<TableOfContentsItem> = Vec::new();
        let mut block_counter: usize = 0;

        for element in &doc.kids {
            block_counter += 1;
            let page_num = element.page_number().unwrap_or(1).max(1);
            let page_idx = (page_num - 1) as usize;

            let bbox = {
                let b = element.bbox();
                BoundingBox {
                    x: b.left_x as f32,
                    y: b.bottom_y as f32,
                    width: ((b.right_x - b.left_x).abs() as f32).max(0.0),
                    height: ((b.top_y - b.bottom_y).abs() as f32).max(0.0),
                }
            };

            match element {
                ContentElement::Heading(h) => {
                    let text = h.base.base.value().trim().to_string();
                    if !text.is_empty() {
                        let level = h.heading_level.unwrap_or(1).clamp(1, 6) as u8;
                        let block_id = format!("block_h_{}", block_counter);

                        toc.push(TableOfContentsItem {
                            title: text.clone(),
                            level,
                            page_number: page_num,
                            block_id: Some(block_id.clone()),
                        });

                        if page_idx < pages.len() {
                            pages[page_idx].blocks.push(DocumentBlock {
                                id: block_id,
                                block_type: "heading".to_string(),
                                text,
                                level: Some(level),
                                page_number: page_num,
                                bbox: Some(bbox),
                            });
                        }
                    }
                }
                ContentElement::NumberHeading(nh) => {
                    let text = nh.base.base.base.value().trim().to_string();
                    if !text.is_empty() {
                        let level = nh.base.heading_level.unwrap_or(1).clamp(1, 6) as u8;
                        let block_id = format!("block_nh_{}", block_counter);

                        toc.push(TableOfContentsItem {
                            title: text.clone(),
                            level,
                            page_number: page_num,
                            block_id: Some(block_id.clone()),
                        });

                        if page_idx < pages.len() {
                            pages[page_idx].blocks.push(DocumentBlock {
                                id: block_id,
                                block_type: "heading".to_string(),
                                text,
                                level: Some(level),
                                page_number: page_num,
                                bbox: Some(bbox),
                            });
                        }
                    }
                }
                ContentElement::Paragraph(p) => {
                    let text = p.base.value().trim().to_string();
                    if !text.is_empty() && page_idx < pages.len() {
                        pages[page_idx].blocks.push(DocumentBlock {
                            id: format!("block_p_{}", block_counter),
                            block_type: "paragraph".to_string(),
                            text,
                            level: None,
                            page_number: page_num,
                            bbox: Some(bbox),
                        });
                    }
                }
                ContentElement::Table(t) => {
                    if page_idx < pages.len() {
                        let table_id = format!("tbl_{}", block_counter);
                        let mut rows = Vec::new();
                        let headers = Vec::new();

                        for row in &t.table_border.rows {
                            let row_vals: Vec<String> = row
                                .cells
                                .iter()
                                .map(|c| {
                                    c.content
                                        .iter()
                                        .map(|token| token.base.value.clone())
                                        .collect::<Vec<_>>()
                                        .join(" ")
                                })
                                .collect();
                            if !row_vals.is_empty() {
                                rows.push(row_vals);
                            }
                        }

                        pages[page_idx].tables.push(ExtractedTable {
                            id: table_id.clone(),
                            page_number: page_num,
                            headers,
                            rows,
                            markdown: String::new(),
                            bbox: Some(bbox.clone()),
                        });

                        pages[page_idx].blocks.push(DocumentBlock {
                            id: format!("block_tbl_{}", block_counter),
                            block_type: "table".to_string(),
                            text: format!("[Table on Page {}]", page_num),
                            level: None,
                            page_number: page_num,
                            bbox: Some(bbox),
                        });
                    }
                }
                ContentElement::Formula(f) => {
                    if page_idx < pages.len() {
                        pages[page_idx].blocks.push(DocumentBlock {
                            id: format!("block_eq_{}", block_counter),
                            block_type: "equation".to_string(),
                            text: f.latex.clone(),
                            level: None,
                            page_number: page_num,
                            bbox: Some(bbox),
                        });
                    }
                }
                ContentElement::Figure(_) => {
                    if page_idx < pages.len() {
                        pages[page_idx].blocks.push(DocumentBlock {
                            id: format!("block_fig_{}", block_counter),
                            block_type: "figure".to_string(),
                            text: format!("[Figure on Page {}]", page_num),
                            level: None,
                            page_number: page_num,
                            bbox: Some(bbox),
                        });
                    }
                }
                ContentElement::TextBlock(tb) => {
                    let text = tb.value().trim().to_string();
                    if !text.is_empty() && page_idx < pages.len() {
                        pages[page_idx].blocks.push(DocumentBlock {
                            id: format!("block_tb_{}", block_counter),
                            block_type: "paragraph".to_string(),
                            text,
                            level: None,
                            page_number: page_num,
                            bbox: Some(bbox),
                        });
                    }
                }
                _ => {}
            }
        }

        let metadata = DocumentMetadata {
            title: doc.title,
            authors: doc.author.map(|a| vec![a]),
            total_pages,
            creation_date: doc.creation_date,
            producer: None,
        };

        progress.report(
            "completed",
            total_pages,
            total_pages,
            100.0,
            "Extraction completed successfully",
        );

        Ok(ExtractedDocument {
            id: doc_id,
            metadata,
            markdown,
            pages,
            toc,
        })
    }
}
