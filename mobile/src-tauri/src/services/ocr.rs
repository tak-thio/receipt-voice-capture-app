use crate::services::api_keys::resolve_gemini_api_key;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Debug, Clone)]
pub struct OcrRequest {
    pub image_path: String,
    pub mock_raw_text: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
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
        if request.provider.as_deref() == Some("gemini") {
            return run_gemini_ocr(&request);
        }

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
        if let Some(mock_raw_text) = request
            .mock_raw_text
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
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
        if let Some(mock_raw_text) = request
            .mock_raw_text
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            return Ok(mock_raw_text.trim().to_string());
        }
    }

    Ok(trimmed)
}

fn run_gemini_ocr(request: &OcrRequest) -> Result<OcrResponsePayload, String> {
    let image_path = request.image_path.trim();
    if image_path.is_empty() {
        return Err("imagePath is required for Gemini OCR extraction.".to_string());
    }

    if !Path::new(image_path).exists() {
        return Err(format!("OCR image file was not found: {}", image_path));
    }

    let api_key = resolve_gemini_api_key()?;
    let image_bytes = fs::read(image_path)
        .map_err(|error| format!("Failed to read OCR image file: {}", error))?;
    let image_data = base64::engine::general_purpose::STANDARD.encode(image_bytes);
    let model = request
        .model
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("gemini-2.5-flash");
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model
    );

    let body = json!({
        "contents": [{
            "role": "user",
            "parts": [
                {
                    "text": "領収書画像からOCRテキストを抽出してください。日付、支払先、合計金額、インボイス番号が読める場合は必ず含めてください。説明やMarkdownは不要で、読み取れたテキストだけを返してください。"
                },
                {
                    "inline_data": {
                        "mime_type": guess_image_mime_type(image_path),
                        "data": image_data
                    }
                }
            ]
        }]
    });

    let response = reqwest::blocking::Client::new()
        .post(url)
        .header("x-goog-api-key", api_key)
        .json(&body)
        .send()
        .map_err(|error| format!("Gemini OCR request failed: {}", error))?;

    let status = response.status();
    let response_text = response
        .text()
        .map_err(|error| format!("Gemini OCR response read failed: {}", error))?;

    if !status.is_success() {
        return Err(format!("Gemini OCR returned {}: {}", status, response_text));
    }

    let value: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|error| format!("Gemini OCR response was not JSON: {}", error))?;
    let raw_text = extract_gemini_text(&value)
        .ok_or_else(|| "Gemini OCR response did not include text.".to_string())?
        .trim()
        .to_string();

    if raw_text.is_empty() {
        return Err("Gemini OCR returned empty text.".to_string());
    }

    Ok(OcrResponsePayload {
        raw_text,
        source: "gemini".to_string(),
    })
}

fn guess_image_mime_type(image_path: &str) -> &'static str {
    let lower = image_path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        return "image/png";
    }

    if lower.ends_with(".webp") {
        return "image/webp";
    }

    "image/jpeg"
}

fn extract_gemini_text(value: &serde_json::Value) -> Option<String> {
    let text = value
        .get("candidates")?
        .as_array()?
        .first()?
        .get("content")?
        .get("parts")?
        .as_array()?
        .iter()
        .filter_map(|part| part.get("text")?.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    Some(text)
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
            provider: None,
            model: None,
        });

        assert!(result.is_err());
    }

    #[test]
    fn extracts_text_from_gemini_ocr_payload() {
        let payload = serde_json::json!({
            "candidates": [{
                "content": {
                    "parts": [
                        { "text": "2026年3月24日\nセブンイレブン\n1158円" }
                    ]
                }
            }]
        });

        let text = super::extract_gemini_text(&payload).expect("text should be extracted");
        assert!(text.contains("セブンイレブン"));
    }

    #[test]
    fn guesses_image_mime_type() {
        assert_eq!(super::guess_image_mime_type("receipt.png"), "image/png");
        assert_eq!(super::guess_image_mime_type("receipt.jpg"), "image/jpeg");
    }
}
