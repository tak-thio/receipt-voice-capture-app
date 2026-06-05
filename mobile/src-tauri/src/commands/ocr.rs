use crate::services::ocr::{OcrDiagnosticsPayload, OcrRequest, OcrResponsePayload, OcrService};

#[tauri::command]
pub fn extract_ocr_from_image(
    #[allow(non_snake_case)] imagePath: String,
    #[allow(non_snake_case)] mockRawText: Option<String>,
    provider: Option<String>,
    model: Option<String>,
) -> Result<OcrResponsePayload, String> {
    OcrService::extract(OcrRequest {
        image_path: imagePath,
        mock_raw_text: mockRawText,
        provider,
        model,
    })
}

#[tauri::command]
pub fn get_ocr_diagnostics() -> OcrDiagnosticsPayload {
    OcrService::diagnostics()
}
