use crate::models::CaptureImageMeta;
use crate::repositories::session_repository::SessionRepository;
use base64::Engine;
use std::fs;

#[tauri::command]
pub fn save_capture_image(
    app: tauri::AppHandle,
    session_id: String,
    image_data_url: String,
    width: u32,
    height: u32,
    suggested_file_name: Option<String>,
    storage_root: Option<String>,
) -> Result<CaptureImageMeta, String> {
    let storage_root = crate::commands::resolve_storage_root(&app, storage_root)?;
    SessionRepository::create_directories(storage_root.as_deref(), &session_id)?;

    let captures_dir = SessionRepository::captures_dir(storage_root.as_deref(), &session_id);
    let file_name = suggested_file_name
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("capture-{}.jpg", chrono::Utc::now().timestamp_millis()));
    let file_path = captures_dir.join(file_name);

    let base64_payload = image_data_url
        .split(',')
        .nth(1)
        .ok_or_else(|| "invalid image data url".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_payload)
        .map_err(|error| error.to_string())?;

    SessionRepository::ensure_parent(&file_path)?;
    fs::write(&file_path, bytes).map_err(|error| error.to_string())?;

    Ok(CaptureImageMeta {
        image_path: file_path.to_string_lossy().to_string(),
        captured_at: chrono::Utc::now().to_rfc3339(),
        width,
        height,
    })
}
