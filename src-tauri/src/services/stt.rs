use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
pub enum SttMode {
    Mock,
    Local,
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
        })
    }
}

struct LocalPythonSidecarSttAdapter;

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

pub struct SttService;

impl SttService {
    pub fn transcribe(request: SttTranscriptionRequest) -> Result<SttTranscriptionPayload, String> {
        match request.mode {
            SttMode::Mock => MockBackendSttAdapter.transcribe(&request),
            SttMode::Local => LocalPythonSidecarSttAdapter.transcribe(&request),
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
    let local_venv_python = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.venv-stt/bin/python");
    if local_venv_python.exists() {
        Some(local_venv_python.to_string_lossy().to_string())
    } else {
        None
    }
}

fn resolve_sidecar_script_path() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("RECEIPT_STT_SIDECAR") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let candidate = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../scripts/stt_sidecar.py");
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
    let lines: Vec<&str> = seed_text
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
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
                text: (*line).to_string(),
                start_ms,
                end_ms,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        build_sidecar_request, resolve_sidecar_script_path, SidecarSttRequest, SttMode,
        SttService, SttTranscriptionPayload, SttTranscriptionRequest,
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
        assert_eq!(parsed.events.len(), 1);
        assert_eq!(parsed.events[0].text, "一件目");
    }

    #[test]
    fn resolves_default_sidecar_script_path() {
        let sidecar_path = resolve_sidecar_script_path().expect("sidecar script should exist");
        assert!(sidecar_path.exists());
        assert!(sidecar_path.to_string_lossy().ends_with("scripts/stt_sidecar.py"));
    }

    #[test]
    fn builds_diagnostics_payload() {
        let diagnostics = SttService::diagnostics();

        assert!(diagnostics.sidecar_script.is_some());
        assert!(diagnostics.ready || diagnostics.error.is_some());
    }
}
