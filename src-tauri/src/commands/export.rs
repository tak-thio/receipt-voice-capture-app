use crate::repositories::session_repository::SessionRepository;
use serde_json::Value;
use std::fs;

#[tauri::command]
pub fn export_csv(
    target: String,
    #[allow(non_snake_case)] fileName: String,
    #[allow(non_snake_case)] csvContent: String,
    #[allow(non_snake_case)] sessionId: Option<String>,
    #[allow(non_snake_case)] storageRoot: Option<String>,
    #[allow(non_snake_case)] destinationPath: Option<String>,
) -> Result<Value, String> {
    let export_path = match destinationPath {
        Some(path) if !path.is_empty() => std::path::PathBuf::from(path),
        _ => match sessionId {
            Some(session_id) => {
                SessionRepository::create_directories(storageRoot.as_deref(), &session_id)?;
                SessionRepository::exports_dir(storageRoot.as_deref(), &session_id).join(&fileName)
            }
            None => SessionRepository::base_dir(storageRoot.as_deref()).join(&fileName),
        },
    };

    SessionRepository::ensure_parent(&export_path)?;
    fs::write(&export_path, csvContent.as_bytes()).map_err(|error| error.to_string())?;

    Ok(serde_json::json!({
        "target": target,
        "fileName": fileName,
        "savedTo": export_path.to_string_lossy(),
        "csvContent": csvContent,
        "headers": [],
        "rows": []
    }))
}

#[cfg(test)]
mod tests {
    use super::export_csv;
    use uuid::Uuid;

    #[test]
    fn exports_csv_with_camel_case_command_args() {
        let destination = std::env::temp_dir()
            .join(format!("receipt-export-{}.csv", Uuid::new_v4()))
            .to_string_lossy()
            .to_string();

        let result = export_csv(
            "mas".to_string(),
            "mas.csv".to_string(),
            "伝票日付,金額\n2026-03-24,1158\n".to_string(),
            None,
            None,
            Some(destination.clone()),
        )
        .expect("export should succeed");

        assert_eq!(
            result.get("savedTo").and_then(|value| value.as_str()),
            Some(destination.as_str())
        );
        assert!(std::fs::read_to_string(&destination)
            .expect("csv should be written")
            .contains("1158"));

        std::fs::remove_file(destination).ok();
    }
}
