use crate::repositories::settings_repository::SettingsRepository;
use serde_json::Value;

#[tauri::command]
pub fn load_settings(
    app: tauri::AppHandle,
    storage_root: Option<String>,
) -> Result<Option<Value>, String> {
    let storage_root = crate::commands::resolve_storage_root(&app, storage_root)?;
    let loaded = SettingsRepository::load(storage_root.as_deref())?;
    if let Some(ref settings) = loaded {
        crate::services::api_keys::cache_api_keys_from_settings(settings);
    }
    Ok(loaded)
}

#[tauri::command]
pub fn save_settings(
    app: tauri::AppHandle,
    settings: Value,
    storage_root: Option<String>,
) -> Result<Value, String> {
    let storage_root = crate::commands::resolve_storage_root(&app, storage_root)?;
    let saved = SettingsRepository::save(storage_root.as_deref(), &settings)?;
    crate::services::api_keys::cache_api_keys_from_settings(&saved);
    Ok(saved)
}
