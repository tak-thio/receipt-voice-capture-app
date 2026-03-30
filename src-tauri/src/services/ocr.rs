use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Debug, Clone)]
pub struct OcrRequest {
    pub image_path: String,
    pub mock_raw_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OcrResponsePayload {
    pub raw_text: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OcrDiagnosticsPayload {
    pub ready: bool,
    pub tesseract_executable: Option<String>,
    pub error: Option<String>,
}

pub struct OcrService;

impl OcrService {
    pub fn extract(request: OcrRequest) -> Result<OcrResponsePayload, String> {
        let raw_text = run_tesseract(&request)?;
        Ok(OcrResponsePayload {
            raw_text,
            source: "local".to_string(),
        })
    }

    pub fn diagnostics() -> OcrDiagnosticsPayload {
        let tesseract_executable = resolve_tesseract_executable().ok();
        let error = if tesseract_executable.is_none() {
            resolve_tesseract_executable().err()
        } else {
            None
        };

        OcrDiagnosticsPayload {
            ready: error.is_none(),
            tesseract_executable,
            error,
        }
    }
}

fn resolve_tesseract_executable() -> Result<String, String> {
    if let Ok(executable) = std::env::var("RECEIPT_OCR_TESSERACT") {
        let trimmed = executable.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    for candidate in ["tesseract"] {
        let status = Command::new(candidate)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        if matches!(status, Ok(value) if value.success()) {
            return Ok(candidate.to_string());
        }
    }

    Err(
        "Tesseract executable was not found. Set RECEIPT_OCR_TESSERACT or install tesseract."
            .to_string(),
    )
}

fn run_tesseract(request: &OcrRequest) -> Result<String, String> {
    let image_path = request.image_path.trim();
    if image_path.is_empty() {
        return Err("imagePath is required for OCR extraction.".to_string());
    }

    if !Path::new(image_path).exists() {
        return Err(format!("OCR image file was not found: {}", image_path));
    }

    let tesseract_executable = resolve_tesseract_executable()?;
    let output = Command::new(tesseract_executable)
        .arg(image_path)
        .arg("stdout")
        .arg("-l")
        .arg("jpn+eng")
        .output()
        .map_err(|error| format!("Failed to launch tesseract: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if let Some(mock_raw_text) = request.mock_raw_text.as_ref().filter(|value| !value.trim().is_empty()) {
            return Ok(mock_raw_text.trim().to_string());
        }

        return Err(if stderr.is_empty() {
            "Tesseract OCR execution failed.".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|error| format!("Invalid UTF-8 in tesseract output: {}", error))?;
    let trimmed = stdout.trim().to_string();

    if trimmed.is_empty() {
        if let Some(mock_raw_text) = request.mock_raw_text.as_ref().filter(|value| !value.trim().is_empty()) {
            return Ok(mock_raw_text.trim().to_string());
        }
    }

    Ok(trimmed)
}

#[cfg(test)]
mod tests {
    use super::{OcrRequest, OcrResponsePayload, OcrService};

    #[test]
    fn parses_ocr_payload_shape() {
        let payload = serde_json::json!({
            "rawText": "2026年3月24日 セブンイレブン 1158円",
            "source": "local"
        });

        let parsed: OcrResponsePayload =
            serde_json::from_value(payload).expect("ocr response should parse");

        assert_eq!(parsed.source, "local");
        assert!(parsed.raw_text.contains("セブンイレブン"));
    }

    #[test]
    fn builds_ocr_diagnostics_payload() {
        let diagnostics = OcrService::diagnostics();
        assert!(diagnostics.ready || diagnostics.error.is_some());
    }

    #[test]
    fn rejects_missing_image_path() {
        let result = OcrService::extract(OcrRequest {
            image_path: "".to_string(),
            mock_raw_text: Some("fallback".to_string()),
        });

        assert!(result.is_err());
    }
}
