pub mod ai_formatter;
pub mod audio;
pub mod capture;
pub mod export;
pub mod ocr;
pub mod session;
pub mod settings;
pub mod stt;

/// Resolves the storage root for file-backed commands.
///
/// An explicit non-empty `storage_root` always wins (absolute paths, power users,
/// and the repository unit tests). When none is provided:
/// - On mobile there is no user-writable cwd, so storage is anchored under the
///   app data dir (e.g. `<app_data_dir>/receipt-sessions`).
/// - On desktop the original behaviour is preserved: `None` flows through to the
///   repositories, which fall back to the current working directory.
pub fn resolve_storage_root(
    app: &tauri::AppHandle,
    storage_root: Option<String>,
) -> Result<Option<String>, String> {
    if matches!(storage_root.as_deref(), Some(root) if !root.is_empty()) {
        return Ok(storage_root);
    }

    #[cfg(mobile)]
    {
        use tauri::Manager;
        let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
        Ok(Some(
            dir.join("receipt-sessions").to_string_lossy().to_string(),
        ))
    }

    #[cfg(not(mobile))]
    {
        let _ = app;
        Ok(storage_root)
    }
}
