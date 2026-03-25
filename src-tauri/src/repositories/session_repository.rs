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
        match Self::load_current_session_id(storage_root) {
            Ok(Some(session_id)) => match Self::load(storage_root, &session_id)? {
                Some(session) => Ok(Some(session)),
                None => Self::recover_latest_as_current(storage_root),
            },
            Ok(None) => Ok(None),
            Err(_) => Self::recover_latest_as_current(storage_root),
        }
    }

    pub fn load_latest(storage_root: Option<&str>) -> Result<Option<Value>, String> {
        let sessions = Self::list_summaries(storage_root)?;
        let Some(latest_session_id) = sessions
            .first()
            .and_then(|session| session.get("id"))
            .and_then(|value| value.as_str())
        else {
            return Ok(None);
        };

        Self::load(storage_root, latest_session_id)
    }

    pub fn list_summaries(storage_root: Option<&str>) -> Result<Vec<Value>, String> {
        let base_dir = Self::base_dir(storage_root);
        if !base_dir.exists() {
            return Ok(vec![]);
        }

        let mut sessions = Vec::new();

        for entry in fs::read_dir(base_dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();

            if !path.is_dir() {
                continue;
            }

            let Some(session_id) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };

            let Some(session) = Self::load(storage_root, session_id)? else {
                continue;
            };

            let created_at = session
                .get("createdAt")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            let updated_at = session
                .get("updatedAt")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            let record_count = session
                .get("records")
                .and_then(|value| value.as_array())
                .map(|records| records.len())
                .unwrap_or(0);

            sessions.push(serde_json::json!({
                "id": session_id,
                "createdAt": created_at,
                "updatedAt": updated_at,
                "recordCount": record_count
            }));
        }

        sessions.sort_by(|left, right| {
            let left_updated = left
                .get("updatedAt")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            let right_updated = right
                .get("updatedAt")
                .and_then(|value| value.as_str())
                .unwrap_or_default();

            right_updated.cmp(left_updated)
        });

        Ok(sessions)
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

    fn recover_latest_as_current(storage_root: Option<&str>) -> Result<Option<Value>, String> {
        let latest = Self::load_latest(storage_root)?;
        if let Some(session) = latest.as_ref() {
            if let Some(session_id) = session.get("id").and_then(|value| value.as_str()) {
                Self::save_current_session_id(storage_root, session_id)?;
            }
        }

        Ok(latest)
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

    #[test]
    fn lists_sessions_sorted_by_updated_at() {
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
            "updatedAt": "2026-03-25T00:02:00.000Z",
            "settingsSnapshot": {},
            "records": [{ "id": "record-1" }]
        });

        SessionRepository::save(Some(&root), "session-first", &first)
            .expect("first session should save");
        SessionRepository::save(Some(&root), "session-second", &second)
            .expect("second session should save");

        let summaries = SessionRepository::list_summaries(Some(&root))
            .expect("session summaries should load");

        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0].get("id").and_then(|value| value.as_str()), Some("session-second"));
        assert_eq!(summaries[0].get("recordCount").and_then(|value| value.as_u64()), Some(1));

        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn falls_back_to_latest_when_current_pointer_is_missing_target() {
        let root = temp_root();
        let latest = json!({
            "id": "session-latest",
            "createdAt": "2026-03-25T00:01:00.000Z",
            "updatedAt": "2026-03-25T00:02:00.000Z",
            "settingsSnapshot": {},
            "records": []
        });

        SessionRepository::save(Some(&root), "session-latest", &latest)
            .expect("latest session should save");
        SessionRepository::save_current_session_id(Some(&root), "session-missing")
            .expect("broken pointer should save");

        let loaded = SessionRepository::load_current(Some(&root))
            .expect("current session should recover")
            .expect("recovered session should exist");

        assert_eq!(
            loaded.get("id").and_then(|value| value.as_str()),
            Some("session-latest")
        );

        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn falls_back_to_latest_when_current_pointer_file_is_invalid() {
        let root = temp_root();
        let latest = json!({
            "id": "session-latest",
            "createdAt": "2026-03-25T00:01:00.000Z",
            "updatedAt": "2026-03-25T00:02:00.000Z",
            "settingsSnapshot": {},
            "records": []
        });

        SessionRepository::save(Some(&root), "session-latest", &latest)
            .expect("latest session should save");
        let pointer_file = SessionRepository::current_session_pointer_file(Some(&root));
        SessionRepository::ensure_parent(&pointer_file).expect("pointer parent should exist");
        std::fs::write(pointer_file, "{ invalid json").expect("broken pointer should write");

        let loaded = SessionRepository::load_current(Some(&root))
            .expect("current session should recover")
            .expect("recovered session should exist");

        assert_eq!(
            loaded.get("id").and_then(|value| value.as_str()),
            Some("session-latest")
        );

        std::fs::remove_dir_all(root).ok();
    }
}
