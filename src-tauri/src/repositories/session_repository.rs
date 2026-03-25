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

    pub fn current_session_pointer_file(storage_root: Option<&str>) -> PathBuf {
        Self::base_dir(storage_root).join("current-session.json")
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

    pub fn save(
        storage_root: Option<&str>,
        session_id: &str,
        session: &Value,
    ) -> Result<Value, String> {
        Self::create_directories(storage_root, session_id)?;
        let file_path = Self::session_file(storage_root, session_id);
        let json = serde_json::to_string_pretty(session).map_err(|error| error.to_string())?;
        fs::write(file_path, json).map_err(|error| error.to_string())?;
        Self::save_current_session_id(storage_root, session_id)?;
        Ok(session.clone())
    }

    pub fn load_current(storage_root: Option<&str>) -> Result<Option<Value>, String> {
        let Some(session_id) = Self::load_current_session_id(storage_root)? else {
            return Ok(None);
        };

        Self::load(storage_root, &session_id)
    }

    pub fn load_current_session_id(storage_root: Option<&str>) -> Result<Option<String>, String> {
        let pointer_file = Self::current_session_pointer_file(storage_root);
        if !pointer_file.exists() {
            return Ok(None);
        }

        let raw = fs::read_to_string(pointer_file).map_err(|error| error.to_string())?;
        let payload: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;

        Ok(payload
            .get("sessionId")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()))
    }

    pub fn save_current_session_id(
        storage_root: Option<&str>,
        session_id: &str,
    ) -> Result<(), String> {
        let pointer_file = Self::current_session_pointer_file(storage_root);
        Self::ensure_parent(&pointer_file)?;
        let payload = serde_json::json!({ "sessionId": session_id });
        let json = serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?;
        fs::write(pointer_file, json).map_err(|error| error.to_string())?;
        Ok(())
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

#[cfg(test)]
mod tests {
    use super::SessionRepository;
    use serde_json::json;
    use uuid::Uuid;

    fn temp_root() -> String {
        std::env::temp_dir()
            .join(format!("receipt-app-test-{}", Uuid::new_v4()))
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn saves_and_loads_current_session_pointer() {
        let root = temp_root();
        SessionRepository::save_current_session_id(Some(&root), "session-123")
            .expect("pointer should save");

        let loaded =
            SessionRepository::load_current_session_id(Some(&root)).expect("pointer should load");

        assert_eq!(loaded.as_deref(), Some("session-123"));

        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn saves_and_loads_current_session_value() {
        let root = temp_root();
        let session = json!({
            "id": "session-456",
            "createdAt": "2026-03-25T00:00:00.000Z",
            "updatedAt": "2026-03-25T00:00:00.000Z",
            "settingsSnapshot": {
                "storageRoot": root,
                "preferredCameraId": "",
                "preferredMicrophoneId": "",
                "sttMode": "mock",
                "ocrEnabled": true,
                "ocrMode": "mock",
                "exportTargetDefault": "generic"
            },
            "records": []
        });

        SessionRepository::save(Some(&root), "session-456", &session)
            .expect("session should save");

        let loaded = SessionRepository::load_current(Some(&root))
            .expect("session should load")
            .expect("current session should exist");

        assert_eq!(loaded.get("id").and_then(|value| value.as_str()), Some("session-456"));

        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn latest_saved_session_becomes_current_pointer() {
        let root = temp_root();
        let first = json!({
            "id": "session-first",
            "createdAt": "2026-03-25T00:00:00.000Z",
            "updatedAt": "2026-03-25T00:00:00.000Z",
            "settingsSnapshot": {},
            "records": []
        });
        let second = json!({
            "id": "session-second",
            "createdAt": "2026-03-25T00:01:00.000Z",
            "updatedAt": "2026-03-25T00:01:00.000Z",
            "settingsSnapshot": {},
            "records": []
        });

        SessionRepository::save(Some(&root), "session-first", &first)
            .expect("first session should save");
        SessionRepository::save(Some(&root), "session-second", &second)
            .expect("second session should save");

        let loaded = SessionRepository::load_current(Some(&root))
            .expect("current session should load")
            .expect("current session should exist");

        assert_eq!(
            loaded.get("id").and_then(|value| value.as_str()),
            Some("session-second")
        );

        std::fs::remove_dir_all(root).ok();
    }
}
