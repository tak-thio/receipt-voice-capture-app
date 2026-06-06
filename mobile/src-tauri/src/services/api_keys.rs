use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiKeySettings {
    openai_api_key: Option<String>,
    gemini_api_key: Option<String>,
}

// アプリ保存設定(モバイルは app_data_dir の settings.json)から取り込んだ API キーの
// プロセスキャッシュ。モバイルにはシェル環境変数が無く、api_keys 側は app_data_dir を
// 直接解決できないため、load_settings/save_settings がここへキーを流し込み、AI 呼び出し
// (STT/OCR/整形/画像抽出)から参照できるようにする。
static OPENAI_KEY: RwLock<Option<String>> = RwLock::new(None);
static GEMINI_KEY: RwLock<Option<String>> = RwLock::new(None);

/// 設定 JSON から openaiApiKey / geminiApiKey を取り出してキャッシュへ反映する。
pub fn cache_api_keys_from_settings(settings: &serde_json::Value) {
    cache_single(
        &OPENAI_KEY,
        settings.get("openaiApiKey").and_then(|value| value.as_str()),
    );
    cache_single(
        &GEMINI_KEY,
        settings.get("geminiApiKey").and_then(|value| value.as_str()),
    );
}

fn cache_single(slot: &RwLock<Option<String>>, value: Option<&str>) {
    if let Ok(mut guard) = slot.write() {
        *guard = value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string());
    }
}

fn cached_key(slot: &RwLock<Option<String>>) -> Option<String> {
    slot.read().ok().and_then(|guard| guard.clone())
}

pub fn resolve_openai_api_key() -> Result<String, String> {
    resolve_api_key(cached_key(&OPENAI_KEY), "OPENAI_API_KEY", "openaiApiKey")
}

pub fn resolve_gemini_api_key() -> Result<String, String> {
    resolve_api_key(cached_key(&GEMINI_KEY), "GEMINI_API_KEY", "geminiApiKey")
}

pub fn openai_api_key_is_configured() -> bool {
    resolve_openai_api_key().is_ok()
}

pub fn gemini_api_key_is_configured() -> bool {
    resolve_gemini_api_key().is_ok()
}

fn resolve_api_key(
    cached: Option<String>,
    env_var_name: &str,
    settings_key_name: &str,
) -> Result<String, String> {
    if let Some(value) = read_env_api_key(env_var_name) {
        return Ok(value);
    }

    if let Some(value) = cached
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return Ok(value);
    }

    read_settings_api_key(settings_key_name).ok_or_else(|| {
        format!(
            "{} is not set. Save {} in the app settings screen (or set the environment variable).",
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
