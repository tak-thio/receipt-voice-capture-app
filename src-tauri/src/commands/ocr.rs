use crate::services::ocr::{OcrDiagnosticsPayload, OcrRequest, OcrResponsePayload, OcrService};

#[tauri::command]
pub fn extract_ocr_from_image(
    image_path: String,
    mock_raw_text: Option<String>,
) -> Result<OcrResponsePayload, String> {
    OcrService::extract(OcrRequest {
        image_path,
        mock_raw_text,
    })
}

#[tauri::command]
pub fn get_ocr_diagnostics() -> OcrDiagnosticsPayload {
    OcrService::diagnostics()
}
