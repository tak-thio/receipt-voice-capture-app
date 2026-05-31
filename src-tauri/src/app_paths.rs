use std::path::PathBuf;

const APP_DIR_NAME: &str = "com.tak.receiptvoicecapture";

pub fn app_config_dir() -> PathBuf {
    if cfg!(target_os = "windows") {
        if let Ok(app_data) = std::env::var("APPDATA") {
            return PathBuf::from(app_data).join(APP_DIR_NAME);
        }
    }

    if cfg!(target_os = "macos") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(APP_DIR_NAME);
        }
    }

    if let Ok(config_home) = std::env::var("XDG_CONFIG_HOME") {
        return PathBuf::from(config_home).join(APP_DIR_NAME);
    }

    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".config").join(APP_DIR_NAME);
    }

    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(APP_DIR_NAME)
}

pub fn resolve_storage_root(storage_root: Option<&str>) -> PathBuf {
    let Some(root) = storage_root
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return app_config_dir();
    };

    let path = PathBuf::from(root);
    if path.is_absolute() {
        path
    } else {
        app_config_dir().join(path)
    }
}
