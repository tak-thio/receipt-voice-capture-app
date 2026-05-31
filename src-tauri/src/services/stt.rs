use crate::services::api_keys::{resolve_gemini_api_key, resolve_openai_api_key};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
pub enum SttMode {
    Mock,
    Local,
    Openai,
    Gemini,
}

#[derive(Debug, Clone)]
pub struct SttTranscriptionRequest {
    pub mode: SttMode,
    pub audio_path: Option<String>,
    pub audio_duration_ms: Option<u64>,
    pub seed_text: Option<String>,
    pub stt_model: Option<String>,
    pub stt_device: Option<String>,
    pub stt_compute_type: Option<String>,
    pub stt_language: Option<String>,
    pub stt_beam_size: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SttInputEventPayload {
    pub id: String,
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SttTranscriptionPayload {
    pub events: Vec<SttInputEventPayload>,
    pub source: String,
    pub detected_language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SttDiagnosticsPayload {
    pub ready: bool,
    pub python_executable: Option<String>,
    pub sidecar_script: Option<String>,
    pub local_venv_python: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SidecarSttRequest {
    audio_path: Option<String>,
    audio_duration_ms: Option<u64>,
    seed_text: Option<String>,
    stt_model: Option<String>,
    stt_device: Option<String>,
    stt_compute_type: Option<String>,
    stt_language: Option<String>,
    stt_beam_size: Option<u32>,
}

trait SttAdapter {
    fn transcribe(
        &self,
        request: &SttTranscriptionRequest,
    ) -> Result<SttTranscriptionPayload, String>;
}

struct MockBackendSttAdapter;

impl SttAdapter for MockBackendSttAdapter {
    fn transcribe(
        &self,
        request: &SttTranscriptionRequest,
    ) -> Result<SttTranscriptionPayload, String> {
        let events = build_events_from_seed_text(
            request.seed_text.as_deref().unwrap_or(""),
            request.audio_duration_ms,
        );

        Ok(SttTranscriptionPayload {
            events,
            source: "mock-backend".to_string(),
            detected_language: None,
        })
    }
}

struct LocalPythonSidecarSttAdapter;
struct OpenAiSttAdapter;
struct GeminiSttAdapter;

impl SttAdapter for LocalPythonSidecarSttAdapter {
    fn transcribe(
        &self,
        request: &SttTranscriptionRequest,
    ) -> Result<SttTranscriptionPayload, String> {
        let python_executable = resolve_python_executable()?;
        let sidecar_script = resolve_sidecar_script_path()?;
        let payload = build_sidecar_request(request);

        run_python_sidecar(&python_executable, &sidecar_script, &payload)
    }
}

impl SttAdapter for OpenAiSttAdapter {
    fn transcribe(
        &self,
        request: &SttTranscriptionRequest,
    ) -> Result<SttTranscriptionPayload, String> {
        if let Some(seed_text) = request
            .seed_text
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            return Ok(SttTranscriptionPayload {
                events: build_events_from_seed_text(seed_text, request.audio_duration_ms),
                source: "openai-transcribe".to_string(),
                detected_language: request.stt_language.clone(),
            });
        }

        let audio_path = request
            .audio_path
            .as_ref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "OpenAI STT requires audioPath or seedText.".to_string())?;

        run_openai_transcription(request, audio_path)
    }
}

impl SttAdapter for GeminiSttAdapter {
    fn transcribe(
        &self,
        request: &SttTranscriptionRequest,
    ) -> Result<SttTranscriptionPayload, String> {
        if let Some(seed_text) = request
            .seed_text
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            return Ok(SttTranscriptionPayload {
                events: build_events_from_seed_text(seed_text, request.audio_duration_ms),
                source: "gemini-audio".to_string(),
                detected_language: request.stt_language.clone(),
            });
        }

        let audio_path = request
            .audio_path
            .as_ref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                "Gemini audio transcription requires audioPath or seedText.".to_string()
            })?;

        run_gemini_audio_transcription(request, audio_path)
    }
}

pub struct SttService;

impl SttService {
    pub fn transcribe(request: SttTranscriptionRequest) -> Result<SttTranscriptionPayload, String> {
        match request.mode {
            SttMode::Mock => MockBackendSttAdapter.transcribe(&request),
            SttMode::Local => LocalPythonSidecarSttAdapter.transcribe(&request),
            SttMode::Openai => OpenAiSttAdapter.transcribe(&request),
            SttMode::Gemini => GeminiSttAdapter.transcribe(&request),
        }
    }

    pub fn diagnostics() -> SttDiagnosticsPayload {
        let local_venv_python = local_venv_python_path();
        let python_executable = resolve_python_executable().ok();
        let sidecar_script = resolve_sidecar_script_path()
            .ok()
            .map(|path| path.to_string_lossy().to_string());

        let error = if python_executable.is_none() {
            resolve_python_executable().err()
        } else if sidecar_script.is_none() {
            resolve_sidecar_script_path().err()
        } else {
            None
        };

        SttDiagnosticsPayload {
            ready: error.is_none(),
            python_executable,
            sidecar_script,
            local_venv_python,
            error,
        }
    }
}

fn run_openai_transcription(
    request: &SttTranscriptionRequest,
    audio_path: &str,
) -> Result<SttTranscriptionPayload, String> {
    if !Path::new(audio_path).exists() {
        return Err(format!(
            "OpenAI STT audio file was not found: {}",
            audio_path
        ));
    }

    let api_key = resolve_openai_api_key()?;
    let model = request
        .stt_model
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("gpt-4o-mini-transcribe");

    let mut form = reqwest::blocking::multipart::Form::new()
        .text("model", model.to_string())
        .text("response_format", "json".to_string())
        .file("file", audio_path)
        .map_err(|error| format!("Failed to attach audio file: {}", error))?;

    if let Some(language) = request
        .stt_language
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        form = form.text("language", language.clone());
    }

    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| format!("OpenAI STT client setup failed: {}", error))?
        .post("https://api.openai.com/v1/audio/transcriptions")
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .map_err(|error| format!("OpenAI STT request failed: {}", error))?;

    let status = response.status();
    let response_text = response
        .text()
        .map_err(|error| format!("OpenAI STT response read failed: {}", error))?;

    if !status.is_success() {
        return Err(format!("OpenAI STT returned {}: {}", status, response_text));
    }

    let payload: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|error| format!("OpenAI STT response was not JSON: {}", error))?;
    let transcript = payload
        .get("text")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim();

    Ok(SttTranscriptionPayload {
        events: build_events_from_seed_text(transcript, request.audio_duration_ms),
        source: "openai-transcribe".to_string(),
        detected_language: payload
            .get("language")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
            .or_else(|| request.stt_language.clone()),
    })
}

fn run_gemini_audio_transcription(
    request: &SttTranscriptionRequest,
    audio_path: &str,
) -> Result<SttTranscriptionPayload, String> {
    let path = Path::new(audio_path);
    if !path.exists() {
        return Err(format!("Gemini audio file was not found: {}", audio_path));
    }

    let api_key = resolve_gemini_api_key()?;
    let model = request
        .stt_model
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("gemini-2.5-flash");
    let audio_bytes =
        fs::read(path).map_err(|error| format!("Failed to read audio file: {}", error))?;
    let audio_base64 = base64::engine::general_purpose::STANDARD.encode(audio_bytes);
    let mime_type = infer_audio_mime_type(path);
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model
    );
    let body = serde_json::json!({
        "contents": [{
            "role": "user",
            "parts": [
                {
                    "text": "この音声を日本語で正確に文字起こししてください。領収書入力の区切り語である「次」「次へ」は、聞こえた場合そのまま残してください。説明や要約は不要です。文字起こし本文だけを返してください。"
                },
                {
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": audio_base64
                    }
                }
            ]
        }]
    });

    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| format!("Gemini audio client setup failed: {}", error))?
        .post(url)
        .header("x-goog-api-key", api_key)
        .json(&body)
        .send()
        .map_err(|error| format!("Gemini audio request failed: {}", error))?;

    let status = response.status();
    let response_text = response
        .text()
        .map_err(|error| format!("Gemini audio response read failed: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "Gemini audio returned {}: {}",
            status, response_text
        ));
    }

    let payload: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|error| format!("Gemini audio response was not JSON: {}", error))?;
    let transcript = extract_gemini_text(&payload)
        .ok_or_else(|| "Gemini audio response did not include transcript text.".to_string())?;

    Ok(SttTranscriptionPayload {
        events: build_events_from_seed_text(transcript.trim(), request.audio_duration_ms),
        source: "gemini-audio".to_string(),
        detected_language: request.stt_language.clone(),
    })
}

fn infer_audio_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("m4a") => "audio/mp4",
        Some("aac") => "audio/aac",
        Some("ogg") | Some("oga") => "audio/ogg",
        Some("flac") => "audio/flac",
        Some("webm") => "audio/webm",
        _ => "audio/webm",
    }
}

fn extract_gemini_text(value: &serde_json::Value) -> Option<String> {
    value
        .get("candidates")
        .and_then(|candidates| candidates.as_array())
        .into_iter()
        .flatten()
        .flat_map(|candidate| {
            candidate
                .get("content")
                .and_then(|content| content.get("parts"))
                .and_then(|parts| parts.as_array())
                .into_iter()
                .flatten()
        })
        .find_map(|part| {
            part.get("text")
                .and_then(|text| text.as_str())
                .map(|text| text.to_string())
        })
}

fn build_sidecar_request(request: &SttTranscriptionRequest) -> SidecarSttRequest {
    SidecarSttRequest {
        audio_path: request.audio_path.clone(),
        audio_duration_ms: request.audio_duration_ms,
        seed_text: request.seed_text.clone(),
        stt_model: request.stt_model.clone(),
        stt_device: request.stt_device.clone(),
        stt_compute_type: request.stt_compute_type.clone(),
        stt_language: request.stt_language.clone(),
        stt_beam_size: request.stt_beam_size,
    }
}

fn resolve_python_executable() -> Result<String, String> {
    if let Ok(executable) = std::env::var("RECEIPT_STT_PYTHON") {
        let trimmed = executable.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    if let Some(local_venv_python) = local_venv_python_path() {
        return Ok(local_venv_python);
    }

    for candidate in ["python3", "python"] {
        let status = Command::new(candidate)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        if matches!(status, Ok(value) if value.success()) {
            return Ok(candidate.to_string());
        }
    }

    Err("Python executable was not found. Set RECEIPT_STT_PYTHON or install python3.".to_string())
}

fn local_venv_python_path() -> Option<String> {
    let venv_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../.venv-stt");
    let candidates = [
        venv_root.join("bin/python"),
        venv_root.join("Scripts/python.exe"),
        venv_root.join("Scripts/python"),
    ];

    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    None
}

fn resolve_sidecar_script_path() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("RECEIPT_STT_SIDECAR") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let candidate = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/stt_sidecar.py");
    if candidate.exists() {
        return Ok(candidate);
    }

    Err(format!(
        "STT sidecar script was not found at {}",
        candidate.to_string_lossy()
    ))
}

fn run_python_sidecar(
    python_executable: &str,
    sidecar_script: &Path,
    payload: &SidecarSttRequest,
) -> Result<SttTranscriptionPayload, String> {
    let request_json = serde_json::to_vec(payload).map_err(|error| error.to_string())?;

    let mut child = Command::new(python_executable)
        .arg(sidecar_script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!(
                "Failed to launch python sidecar `{}`: {}",
                sidecar_script.to_string_lossy(),
                error
            )
        })?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(&request_json)
            .map_err(|error| format!("Failed to send request to python sidecar: {}", error))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed to wait for python sidecar: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Python sidecar execution failed.".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|error| format!("Invalid UTF-8 in python sidecar output: {}", error))?;

    serde_json::from_str::<SttTranscriptionPayload>(&stdout)
        .map_err(|error| format!("Failed to parse python sidecar response: {}", error))
}

fn build_events_from_seed_text(
    seed_text: &str,
    duration_ms: Option<u64>,
) -> Vec<SttInputEventPayload> {
    let lines: Vec<String> = seed_text
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .flat_map(split_text_by_boundary)
        .collect();

    if lines.is_empty() {
        return vec![];
    }

    let segment_duration = match duration_ms {
        Some(duration) if duration > 0 => std::cmp::max(duration / lines.len() as u64, 1),
        _ => 1200,
    };

    lines
        .iter()
        .enumerate()
        .map(|(index, line)| {
            let start_ms = index as u64 * segment_duration;
            let end_ms = (index as u64 + 1) * segment_duration;

            SttInputEventPayload {
                id: format!("evt-{}", uuid::Uuid::new_v4()),
                text: line.to_string(),
                start_ms,
                end_ms,
            }
        })
        .collect()
}

fn split_text_by_boundary(text: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut remaining = text.trim();

    while !remaining.is_empty() {
        let Some(boundary_end) = find_boundary_end(remaining) else {
            parts.push(remaining.to_string());
            break;
        };

        let (current, rest) = remaining.split_at(boundary_end);
        let current = current.trim();
        if !current.is_empty() {
            parts.push(current.to_string());
        }
        remaining = rest.trim();
    }

    parts
}

fn find_boundary_end(text: &str) -> Option<usize> {
    ["次へ", "終了", "次"]
        .iter()
        .filter_map(|boundary| {
            text.find(boundary)
                .map(|start| (start, start + boundary.len()))
        })
        .min_by(|left, right| left.0.cmp(&right.0).then_with(|| right.1.cmp(&left.1)))
        .map(|(_, end)| end)
}

#[cfg(test)]
mod tests {
    use super::{
        build_events_from_seed_text, build_sidecar_request, resolve_sidecar_script_path,
        SidecarSttRequest, SttMode, SttService, SttTranscriptionPayload, SttTranscriptionRequest,
    };

    #[test]
    fn builds_events_from_seed_text_for_mock_mode() {
        let result = SttService::transcribe(SttTranscriptionRequest {
            mode: SttMode::Mock,
            audio_path: None,
            audio_duration_ms: Some(4000),
            seed_text: Some("一件目\n次\n二件目".to_string()),
            stt_model: None,
            stt_device: None,
            stt_compute_type: None,
            stt_language: None,
            stt_beam_size: None,
        })
        .expect("mock mode should succeed");

        assert_eq!(result.source, "mock-backend");
        assert_eq!(result.events.len(), 3);
        assert_eq!(result.events[0].text, "一件目");
        assert_eq!(result.events[1].start_ms, 1333);
    }

    #[test]
    fn splits_inline_transcript_by_receipt_boundary() {
        let events = build_events_from_seed_text(
            "5月29日 セブンイレブン 現金 800円 消耗品 次へ 5月29日 タイムズ博多 500円 駐車場代 終了",
            Some(4000),
        );

        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0].text,
            "5月29日 セブンイレブン 現金 800円 消耗品 次へ"
        );
        assert_eq!(events[1].text, "5月29日 タイムズ博多 500円 駐車場代 終了");
        assert_eq!(events[1].start_ms, 2000);
    }

    #[test]
    fn builds_sidecar_request_payload() {
        let payload = build_sidecar_request(&SttTranscriptionRequest {
            mode: SttMode::Local,
            audio_path: Some("/tmp/audio.webm".to_string()),
            audio_duration_ms: Some(2000),
            seed_text: Some("一件目\n次へ".to_string()),
            stt_model: Some("small".to_string()),
            stt_device: Some("cpu".to_string()),
            stt_compute_type: Some("int8".to_string()),
            stt_language: Some("ja".to_string()),
            stt_beam_size: Some(5),
        });

        assert_eq!(
            payload,
            SidecarSttRequest {
                audio_path: Some("/tmp/audio.webm".to_string()),
                audio_duration_ms: Some(2000),
                seed_text: Some("一件目\n次へ".to_string()),
                stt_model: Some("small".to_string()),
                stt_device: Some("cpu".to_string()),
                stt_compute_type: Some("int8".to_string()),
                stt_language: Some("ja".to_string()),
                stt_beam_size: Some(5),
            }
        );
    }

    #[test]
    fn parses_python_sidecar_payload_shape() {
        let payload = serde_json::json!({
            "events": [
                {
                    "id": "evt-1",
                    "text": "一件目",
                    "startMs": 0,
                    "endMs": 1000
                }
            ],
            "source": "local-python-sidecar"
        });

        let parsed: SttTranscriptionPayload =
            serde_json::from_value(payload).expect("sidecar response should parse");

        assert_eq!(parsed.source, "local-python-sidecar");
        assert_eq!(parsed.detected_language, None);
        assert_eq!(parsed.events.len(), 1);
        assert_eq!(parsed.events[0].text, "一件目");
    }

    #[test]
    fn resolves_default_sidecar_script_path() {
        let sidecar_path = resolve_sidecar_script_path().expect("sidecar script should exist");
        assert!(sidecar_path.exists());
        assert!(sidecar_path
            .to_string_lossy()
            .ends_with("scripts/stt_sidecar.py"));
    }

    #[test]
    fn builds_diagnostics_payload() {
        let diagnostics = SttService::diagnostics();

        assert!(diagnostics.sidecar_script.is_some());
        assert!(diagnostics.ready || diagnostics.error.is_some());
    }
}
