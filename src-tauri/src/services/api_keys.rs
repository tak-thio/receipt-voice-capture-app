use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiKeySettings {
    openai_api_key: Option<String>,
    gemini_api_key: Option<String>,
}

pub fn resolve_openai_api_key() -> Result<String, String> {
    resolve_api_key("OPENAI_API_KEY", "openaiApiKey")
}

pub fn resolve_gemini_api_key() -> Result<String, String> {
    resolve_api_key("GEMINI_API_KEY", "geminiApiKey")
}

pub fn openai_api_key_is_configured() -> bool {
    resolve_openai_api_key().is_ok()
}

pub fn gemini_api_key_is_configured() -> bool {
    resolve_gemini_api_key().is_ok()
}

fn resolve_api_key(env_var_name: &str, settings_key_name: &str) -> Result<String, String> {
    if let Some(value) = read_env_api_key(env_var_name) {
        return Ok(value);
    }

    read_settings_api_key(settings_key_name).ok_or_else(|| {
        format!(
            "{} is not set. Add it to the environment or save {} in app settings.",
            env_var_name, settings_key_name
        )
    })
}

fn read_env_api_key(env_var_name: &str) -> Option<String> {
    std::env::var(env_var_name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn read_settings_api_key(settings_key_name: &str) -> Option<String> {
    settings_file_candidates()
        .into_iter()
        .find_map(|path| read_settings_api_key_from_path(&path, settings_key_name))
}

fn read_settings_api_key_from_path(path: &Path, settings_key_name: &str) -> Option<String> {
    if !path.exists() {
        return None;
    }

    let raw = fs::read_to_string(path).ok()?;
    let settings = serde_json::from_str::<ApiKeySettings>(&raw).ok()?;
    let value = match settings_key_name {
        "openaiApiKey" => settings.openai_api_key,
        "geminiApiKey" => settings.gemini_api_key,
        _ => None,
    }?;

    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn settings_file_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("settings.json"));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("settings.json"));
    candidates.push(manifest_dir.join("../settings.json"));

    candidates
}
