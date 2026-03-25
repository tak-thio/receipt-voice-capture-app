use crate::models::SavedAudioClipMeta;
use crate::repositories::session_repository::SessionRepository;
use base64::Engine;
use std::fs;

#[tauri::command]
pub fn save_audio_clip(
    session_id: String,
    audio_data_url: String,
    mime_type: String,
    size: usize,
    started_at: String,
    ended_at: String,
    suggested_file_name: Option<String>,
    storage_root: Option<String>,
) -> Result<SavedAudioClipMeta, String> {
    SessionRepository::create_directories(storage_root.as_deref(), &session_id)?;

    let extension = if mime_type.contains("mp4") || mime_type.contains("mpeg") {
        "m4a"
    } else if mime_type.contains("wav") {
        "wav"
    } else {
        "webm"
    };

    let audio_dir = SessionRepository::audio_dir(storage_root.as_deref(), &session_id);
    let file_name = suggested_file_name
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("audio-{}.{}", chrono::Utc::now().timestamp_millis(), extension));
    let file_path = audio_dir.join(file_name);

    let base64_payload = audio_data_url
        .split(',')
        .nth(1)
        .ok_or_else(|| "invalid audio data url".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_payload)
        .map_err(|error| error.to_string())?;

    SessionRepository::ensure_parent(&file_path)?;
    fs::write(&file_path, bytes).map_err(|error| error.to_string())?;

    Ok(SavedAudioClipMeta {
        audio_path: file_path.to_string_lossy().to_string(),
        mime_type,
        size,
        started_at,
        ended_at,
    })
}
