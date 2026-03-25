use crate::repositories::session_repository::SessionRepository;
use serde_json::Value;
use std::fs;

#[tauri::command]
pub fn export_csv(
    target: String,
    file_name: String,
    csv_content: String,
    session_id: Option<String>,
    storage_root: Option<String>,
    destination_path: Option<String>,
) -> Result<Value, String> {
    let export_path = match destination_path {
        Some(path) if !path.is_empty() => std::path::PathBuf::from(path),
        _ => match session_id {
            Some(session_id) => {
                SessionRepository::create_directories(storage_root.as_deref(), &session_id)?;
                SessionRepository::exports_dir(storage_root.as_deref(), &session_id)
                    .join(&file_name)
            }
            None => SessionRepository::base_dir(storage_root.as_deref()).join(&file_name),
        },
    };

    SessionRepository::ensure_parent(&export_path)?;
    fs::write(&export_path, csv_content.as_bytes()).map_err(|error| error.to_string())?;

    Ok(serde_json::json!({
        "target": target,
        "fileName": file_name,
        "savedTo": export_path.to_string_lossy(),
        "csvContent": csv_content,
        "headers": [],
        "rows": []
    }))
}
