use crate::services::ai_formatter::{
    AiDiagnosticsPayload, AiFormatterRequest, AiFormatterResponsePayload, AiFormatterService,
    ImageVoiceExtractRequest,
};
use serde_json::Value;

#[tauri::command]
pub fn format_receipt_text(
    raw_text: String,
    provider: Option<String>,
    model: Option<String>,
    reference_date: Option<String>,
    dictionaries: Value,
) -> Result<AiFormatterResponsePayload, String> {
    AiFormatterService::format(AiFormatterRequest {
        raw_text,
        provider,
        model,
        reference_date,
        dictionaries,
    })
}

#[tauri::command]
pub fn extract_receipt_from_image_and_voice(
    image_path: String,
    transcript: String,
    model: Option<String>,
    reference_date: Option<String>,
    dictionaries: Value,
) -> Result<AiFormatterResponsePayload, String> {
    AiFormatterService::extract_from_image_and_voice(ImageVoiceExtractRequest {
        image_path,
        transcript,
        model,
        reference_date,
        dictionaries,
    })
}

#[tauri::command]
pub fn get_ai_diagnostics() -> AiDiagnosticsPayload {
    AiFormatterService::diagnostics()
}
