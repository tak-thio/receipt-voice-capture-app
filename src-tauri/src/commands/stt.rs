use crate::services::stt::{
    SttDiagnosticsPayload, SttMode, SttService, SttTranscriptionPayload,
    SttTranscriptionRequest,
};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SttModeInput {
    Mock,
    Local,
}

#[tauri::command]
pub fn transcribe_audio(
    mode: SttModeInput,
    audio_path: Option<String>,
    audio_duration_ms: Option<u64>,
    seed_text: Option<String>,
    stt_model: Option<String>,
    stt_device: Option<String>,
    stt_compute_type: Option<String>,
    stt_language: Option<String>,
    stt_beam_size: Option<u32>,
) -> Result<SttTranscriptionPayload, String> {
    let mode = match mode {
        SttModeInput::Mock => SttMode::Mock,
        SttModeInput::Local => SttMode::Local,
    };

    SttService::transcribe(SttTranscriptionRequest {
        mode,
        audio_path,
        audio_duration_ms,
        seed_text,
        stt_model,
        stt_device,
        stt_compute_type,
        stt_language,
        stt_beam_size,
    })
}

#[tauri::command]
pub fn get_stt_diagnostics() -> SttDiagnosticsPayload {
    SttService::diagnostics()
}
