use buddhilive_sandbox_core::pdf::{ExtractionConfig, PdfEngine, ProgressReporter};
use pdf_cos::dictionary;

fn create_valid_test_pdf() -> Vec<u8> {
    let mut doc = pdf_cos::Document::with_version("1.4");
    let pages_id = doc.new_object_id();
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });
    let content_id = doc.add_object(pdf_cos::Stream::new(
        dictionary! {},
        b"BT /F1 14 Tf 72 720 Td (Research Paper Title) Tj 0 -24 Td (Abstract: This is a test paper.) Tj ET".to_vec(),
    ));
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "Contents" => content_id,
        "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        "Resources" => dictionary! {
            "Font" => dictionary! {
                "F1" => font_id,
            },
        },
    });
    let pages = dictionary! {
        "Type" => "Pages",
        "Kids" => vec![page_id.into()],
        "Count" => 1,
    };
    doc.set_object(pages_id, pages);
    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);

    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    bytes
}

#[test]
fn test_rejects_empty_data() {
    let reporter = ProgressReporter::new(None);
    let config = ExtractionConfig::default();
    let result = PdfEngine::extract(&[], &config, &reporter);
    assert!(result.is_err());
}

#[test]
fn test_rejects_non_pdf_magic_bytes() {
    let reporter = ProgressReporter::new(None);
    let config = ExtractionConfig::default();
    let result = PdfEngine::extract(b"Not a PDF file", &config, &reporter);
    assert!(result.is_err());
}

#[test]
fn test_extracts_minimal_pdf() {
    let reporter = ProgressReporter::new(None);
    let mut config = ExtractionConfig::default();
    config.document_id = Some("test_doc_001".to_string());

    let pdf_bytes = create_valid_test_pdf();
    let result = PdfEngine::extract(&pdf_bytes, &config, &reporter);
    assert!(result.is_ok(), "Extraction failed: {:?}", result.err());

    let doc = result.unwrap();
    assert_eq!(doc.id, "test_doc_001");
    assert_eq!(doc.metadata.total_pages, 1);
    assert!(!doc.markdown.is_empty());
}
