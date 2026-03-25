use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub struct SessionRepository;

impl SessionRepository {
    pub fn base_dir(storage_root: Option<&str>) -> PathBuf {
        match storage_root {
            Some(root) if !root.is_empty() => PathBuf::from(root),
            _ => std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        }
    }

    pub fn session_dir(storage_root: Option<&str>, session_id: &str) -> PathBuf {
        Self::base_dir(storage_root).join(session_id)
    }

    pub fn session_file(storage_root: Option<&str>, session_id: &str) -> PathBuf {
        Self::session_dir(storage_root, session_id).join("session.json")
    }

    pub fn create_directories(storage_root: Option<&str>, session_id: &str) -> Result<(), String> {
        let session_dir = Self::session_dir(storage_root, session_id);
        fs::create_dir_all(session_dir.join("audio")).map_err(|error| error.to_string())?;
        fs::create_dir_all(session_dir.join("captures")).map_err(|error| error.to_string())?;
        fs::create_dir_all(session_dir.join("exports")).map_err(|error| error.to_string())?;
        fs::create_dir_all(session_dir.join("logs")).map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn load(storage_root: Option<&str>, session_id: &str) -> Result<Option<Value>, String> {
        let file_path = Self::session_file(storage_root, session_id);
        if !file_path.exists() {
            return Ok(None);
        }

        let raw = fs::read_to_string(file_path).map_err(|error| error.to_string())?;
        serde_json::from_str(&raw)
            .map(Some)
            .map_err(|error| error.to_string())
    }

    pub fn save(storage_root: Option<&str>, session_id: &str, session: &Value) -> Result<Value, String> {
        Self::create_directories(storage_root, session_id)?;
        let file_path = Self::session_file(storage_root, session_id);
        let json = serde_json::to_string_pretty(session).map_err(|error| error.to_string())?;
        fs::write(file_path, json).map_err(|error| error.to_string())?;
        Ok(session.clone())
    }

    pub fn captures_dir(storage_root: Option<&str>, session_id: &str) -> PathBuf {
        Self::session_dir(storage_root, session_id).join("captures")
    }

    pub fn audio_dir(storage_root: Option<&str>, session_id: &str) -> PathBuf {
        Self::session_dir(storage_root, session_id).join("audio")
    }

    pub fn exports_dir(storage_root: Option<&str>, session_id: &str) -> PathBuf {
        Self::session_dir(storage_root, session_id).join("exports")
    }

    pub fn ensure_parent(path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}
