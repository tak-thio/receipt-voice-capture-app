use crate::repositories::settings_repository::SettingsRepository;
use serde_json::Value;

#[tauri::command]
pub fn load_settings(storage_root: Option<String>) -> Result<Option<Value>, String> {
    SettingsRepository::load(storage_root.as_deref())
}

#[tauri::command]
pub fn save_settings(settings: Value, storage_root: Option<String>) -> Result<Value, String> {
    SettingsRepository::save(storage_root.as_deref(), &settings)
}
