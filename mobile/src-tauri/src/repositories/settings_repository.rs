use serde_json::Value;
use std::fs;
use std::path::PathBuf;

pub struct SettingsRepository;

impl SettingsRepository {
    fn settings_path(storage_root: Option<&str>) -> PathBuf {
        let base = match storage_root {
            Some(root) if !root.is_empty() => PathBuf::from(root),
            _ => std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        };

        base.join("settings.json")
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
