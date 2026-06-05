use crate::repositories::settings_repository::SettingsRepository;
use serde_json::Value;

#[tauri::command]
pub fn load_settings(
    app: tauri::AppHandle,
    storage_root: Option<String>,
) -> Result<Option<Value>, String> {
    let storage_root = crate::commands::resolve_storage_root(&app, storage_root)?;
    SettingsRepository::load(storage_root.as_deref())
}

#[tauri::command]
pub fn save_settings(
    app: tauri::AppHandle,
    settings: Value,
    storage_root: Option<String>,
) -> Result<Value, String> {
    let storage_root = crate::commands::resolve_storage_root(&app, storage_root)?;
    SettingsRepository::save(storage_root.as_deref(), &settings)
}
