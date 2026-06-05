use crate::repositories::session_repository::SessionRepository;
use serde_json::Value;

#[tauri::command]
pub fn create_session(
    app: tauri::AppHandle,
    settings_snapshot: Value,
    storage_root: Option<String>,
) -> Result<Value, String> {
    let storage_root = crate::commands::resolve_storage_root(&app, storage_root)?;
    let now = chrono::Utc::now().to_rfc3339();
    let session_id = format!("session-{}", chrono::Utc::now().timestamp_millis());
    let session = serde_json::json!({
        "id": session_id,
        "createdAt": now,
        "updatedAt": now,
        "settingsSnapshot": settings_snapshot,
        "records": []
    });

    let session_id = session
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "session id generation failed".to_string())?;

    SessionRepository::save(storage_root.as_deref(), session_id, &session)
}

#[tauri::command]
pub fn load_session(
    app: tauri::AppHandle,
    session_id: String,
    storage_root: Option<String>,
) -> Result<Option<Value>, String> {
    let storage_root = crate::commands::resolve_storage_root(&app, storage_root)?;
    SessionRepository::load(storage_root.as_deref(), &session_id)
}

#[tauri::command]
pub fn load_current_session(
    app: tauri::AppHandle,
    storage_root: Option<String>,
) -> Result<Option<Value>, String> {
    let storage_root = crate::commands::resolve_storage_root(&app, storage_root)?;
    SessionRepository::load_current(storage_root.as_deref())
}

#[tauri::command]
pub fn load_latest_session(
    app: tauri::AppHandle,
    storage_root: Option<String>,
) -> Result<Option<Value>, String> {
    let storage_root = crate::commands::resolve_storage_root(&app, storage_root)?;
    SessionRepository::load_latest(storage_root.as_deref())
}

#[tauri::command]
pub fn list_sessions(
    app: tauri::AppHandle,
    storage_root: Option<String>,
) -> Result<Vec<Value>, String> {
    let storage_root = crate::commands::resolve_storage_root(&app, storage_root)?;
    SessionRepository::list_summaries(storage_root.as_deref())
}

#[tauri::command]
pub fn save_session(
    app: tauri::AppHandle,
    session: Value,
    storage_root: Option<String>,
) -> Result<Value, String> {
    let storage_root = crate::commands::resolve_storage_root(&app, storage_root)?;
    let session_id = session
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "session.id is required".to_string())?;

    SessionRepository::save(storage_root.as_deref(), session_id, &session)
}
