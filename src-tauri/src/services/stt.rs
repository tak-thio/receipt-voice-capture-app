use serde::{Deserialize, Serialize};

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

trait SttAdapter {
    fn transcribe(&self, request: &SttTranscriptionRequest) -> Result<SttTranscriptionPayload, String>;
}

struct MockBackendSttAdapter;

impl SttAdapter for MockBackendSttAdapter {
    fn transcribe(&self, request: &SttTranscriptionRequest) -> Result<SttTranscriptionPayload, String> {
        let events = build_events_from_seed_text(request.seed_text.as_deref().unwrap_or(""), request.audio_duration_ms);

        Ok(SttTranscriptionPayload {
            events,
            source: "mock-backend".to_string(),
        })
    }
}

struct LocalScaffoldSttAdapter;

impl SttAdapter for LocalScaffoldSttAdapter {
    fn transcribe(&self, request: &SttTranscriptionRequest) -> Result<SttTranscriptionPayload, String> {
        if let Some(seed_text) = request.seed_text.as_deref() {
            let trimmed = seed_text.trim();
            if !trimmed.is_empty() {
                return Ok(SttTranscriptionPayload {
                    events: build_events_from_seed_text(trimmed, request.audio_duration_ms),
                    source: "local".to_string(),
                });
            }
        }

        let path = request.audio_path.clone().unwrap_or_default();
        Err(format!(
            "Local STT adapter is not connected yet. Captured audio is available at: {}",
            path
        ))
    }
}

pub struct SttService;

impl SttService {
    pub fn transcribe(request: SttTranscriptionRequest) -> Result<SttTranscriptionPayload, String> {
        match request.mode {
            SttMode::Mock => MockBackendSttAdapter.transcribe(&request),
            SttMode::Local => LocalScaffoldSttAdapter.transcribe(&request),
        }
    }
}

fn build_events_from_seed_text(seed_text: &str, duration_ms: Option<u64>) -> Vec<SttInputEventPayload> {
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
    use super::{SttMode, SttService, SttTranscriptionRequest};

    #[test]
    fn builds_events_from_seed_text_for_mock_mode() {
        let result = SttService::transcribe(SttTranscriptionRequest {
            mode: SttMode::Mock,
            audio_path: None,
            audio_duration_ms: Some(4000),
            seed_text: Some("一件目\n次\n二件目".to_string()),
        })
        .expect("mock mode should succeed");

        assert_eq!(result.source, "mock-backend");
        assert_eq!(result.events.len(), 3);
        assert_eq!(result.events[0].text, "一件目");
        assert_eq!(result.events[1].start_ms, 1333);
    }

    #[test]
    fn returns_local_scaffold_error_without_seed_text() {
        let result = SttService::transcribe(SttTranscriptionRequest {
            mode: SttMode::Local,
            audio_path: Some("/tmp/audio.webm".to_string()),
            audio_duration_ms: Some(2000),
            seed_text: None,
        });

        let error = result.expect_err("local mode should fail until adapter is connected");
        assert!(error.contains("/tmp/audio.webm"));
    }

    #[test]
    fn uses_seed_text_for_local_scaffold() {
        let result = SttService::transcribe(SttTranscriptionRequest {
            mode: SttMode::Local,
            audio_path: Some("/tmp/audio.webm".to_string()),
            audio_duration_ms: Some(2000),
            seed_text: Some("一件目\n次へ".to_string()),
        })
        .expect("local scaffold should accept seed text");

        assert_eq!(result.source, "local");
        assert_eq!(result.events.len(), 2);
        assert_eq!(result.events[1].text, "次へ");
    }
}
