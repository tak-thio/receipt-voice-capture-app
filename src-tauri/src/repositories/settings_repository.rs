use crate::app_paths::app_config_dir;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

pub struct SettingsRepository;

impl SettingsRepository {
    fn settings_path(storage_root: Option<&str>) -> PathBuf {
        storage_root
            .map(|root| crate::app_paths::resolve_storage_root(Some(root)))
            .unwrap_or_else(app_config_dir)
            .join("settings.json")
    }

    pub fn load(storage_root: Option<&str>) -> Result<Option<Value>, String> {
        let path = Self::settings_path(storage_root);
        if !path.exists() {
            return Ok(None);
        }

        let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
        serde_json::from_str(&raw)
            .map(Some)
            .map_err(|error| error.to_string())
    }

    pub fn save(storage_root: Option<&str>, settings: &Value) -> Result<Value, String> {
        let path = Self::settings_path(storage_root);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let json = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
        fs::write(path, json).map_err(|error| error.to_string())?;
        Ok(settings.clone())
    }
}
