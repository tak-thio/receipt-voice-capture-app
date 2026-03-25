use crate::services::stt::{SttMode, SttService, SttTranscriptionPayload, SttTranscriptionRequest};
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
    })
}
