use crate::services::api_keys::{
    gemini_api_key_is_configured, openai_api_key_is_configured, resolve_gemini_api_key,
    resolve_openai_api_key,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Clone)]
pub struct AiFormatterRequest {
    pub raw_text: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub reference_date: Option<String>,
    pub dictionaries: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiFormattedFieldsPayload {
    pub date: String,
    pub vendor: String,
    pub tax_mode: String,
    pub amount: Option<f64>,
    pub payment_method: String,
    pub description_raw: String,
    pub account_category_candidate: String,
    pub account_category_final: String,
    pub summary: String,
    pub invoice_number: String,
    pub memo: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiFormatterResponsePayload {
    pub records: Vec<AiFormattedFieldsPayload>,
    pub warnings: Vec<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiDiagnosticsPayload {
    pub openai_key_configured: bool,
    pub gemini_key_configured: bool,
    pub openai_env_var: String,
    pub gemini_env_var: String,
}

pub struct AiFormatterService;

impl AiFormatterService {
    pub fn format(request: AiFormatterRequest) -> Result<AiFormatterResponsePayload, String> {
        match request.provider.as_deref().unwrap_or("openai") {
            "gemini" => format_with_gemini(&request),
            _ => format_with_openai(&request),
        }
    }

    pub fn diagnostics() -> AiDiagnosticsPayload {
        AiDiagnosticsPayload {
            openai_key_configured: openai_api_key_is_configured(),
            gemini_key_configured: gemini_api_key_is_configured(),
            openai_env_var: "OPENAI_API_KEY".to_string(),
            gemini_env_var: "GEMINI_API_KEY".to_string(),
        }
    }
}

fn format_with_openai(request: &AiFormatterRequest) -> Result<AiFormatterResponsePayload, String> {
    let api_key = resolve_openai_api_key()?;
    let model = request
        .model
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("gpt-4o-mini");
    let body = build_request_body(model, &request);

    let response = reqwest::blocking::Client::new()
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .map_err(|error| format!("OpenAI formatter request failed: {}", error))?;

    let status = response.status();
    let response_text = response
        .text()
        .map_err(|error| format!("OpenAI formatter response read failed: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "OpenAI formatter returned {}: {}",
            status, response_text
        ));
    }

    let value: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|error| format!("OpenAI formatter response was not JSON: {}", error))?;
    let output_text = extract_output_text(&value)
        .ok_or_else(|| "OpenAI formatter response did not include output text.".to_string())?;

    let mut parsed: AiFormatterResponsePayload = serde_json::from_str(&output_text)
        .map_err(|error| format!("OpenAI formatter output did not match schema: {}", error))?;
    parsed.source = "openai-structured-output".to_string();
    Ok(parsed)
}

fn format_with_gemini(request: &AiFormatterRequest) -> Result<AiFormatterResponsePayload, String> {
    let api_key = resolve_gemini_api_key()?;
    let model = request
        .model
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("gemini-2.5-flash");
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model
    );
    let body = build_gemini_request_body(request);

    let response = reqwest::blocking::Client::new()
        .post(url)
        .header("x-goog-api-key", api_key)
        .json(&body)
        .send()
        .map_err(|error| format!("Gemini formatter request failed: {}", error))?;

    let status = response.status();
    let response_text = response
        .text()
        .map_err(|error| format!("Gemini formatter response read failed: {}", error))?;

    if !status.is_success() {
        return Err(format!(
            "Gemini formatter returned {}: {}",
            status, response_text
        ));
    }

    let value: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|error| format!("Gemini formatter response was not JSON: {}", error))?;
    let output_text = extract_gemini_text(&value)
        .ok_or_else(|| "Gemini formatter response did not include output text.".to_string())?;

    let mut parsed: AiFormatterResponsePayload = serde_json::from_str(&output_text)
        .map_err(|error| format!("Gemini formatter output did not match schema: {}", error))?;
    parsed.source = "gemini-structured-output".to_string();
    Ok(parsed)
}

fn build_request_body(model: &str, request: &AiFormatterRequest) -> serde_json::Value {
    json!({
        "model": model,
        "input": [
            {
                "role": "system",
                "content": build_system_prompt()
            },
            {
                "role": "user",
                "content": json!({
                    "rawText": request.raw_text,
                    "referenceDate": request.reference_date,
                    "dictionaries": request.dictionaries
                }).to_string()
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "receipt_voice_records",
                "strict": true,
                "schema": build_response_schema()
            }
        }
    })
}

fn build_gemini_request_body(request: &AiFormatterRequest) -> serde_json::Value {
    json!({
        "contents": [{
            "role": "user",
            "parts": [{
                "text": format!(
                    "{}\n\nInput JSON:\n{}",
                    build_system_prompt(),
                    json!({
                        "rawText": request.raw_text,
                        "referenceDate": request.reference_date,
                        "dictionaries": request.dictionaries
                    })
                )
            }]
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": build_gemini_response_schema()
        }
    })
}

fn build_system_prompt() -> &'static str {
    "あなたは領収書音声入力を会計CSV用の固定フィールドへ整形するエンジンです。\
    入力は日本語の音声文字起こしです。次/次へを区切りとしてレコード化してください。\
    但書(descriptionRaw)は読み上げられた語を改変せず保存してください。\
    勘定項目は但書とは別管理し、明示されていれば採用、なければ辞書から推定、無理なら空欄にしてください。\
    日付はYYYY-MM-DD、年がない場合はreferenceDateの年で補完してください。\
    税区分はinclusive/exclusive/unknown、金額は数値またはnullにしてください。\
    空欄に「なし」などの代替語を入れないでください。"
}

fn build_response_schema() -> serde_json::Value {
    let field_schema = json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "date",
            "vendor",
            "taxMode",
            "amount",
            "paymentMethod",
            "descriptionRaw",
            "accountCategoryCandidate",
            "accountCategoryFinal",
            "summary",
            "invoiceNumber",
            "memo"
        ],
        "properties": {
            "date": { "type": "string" },
            "vendor": { "type": "string" },
            "taxMode": { "type": "string", "enum": ["inclusive", "exclusive", "unknown"] },
            "amount": { "type": ["number", "null"] },
            "paymentMethod": { "type": "string" },
            "descriptionRaw": { "type": "string" },
            "accountCategoryCandidate": { "type": "string" },
            "accountCategoryFinal": { "type": "string" },
            "summary": { "type": "string" },
            "invoiceNumber": { "type": "string" },
            "memo": { "type": "string" }
        }
    });

    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["records", "warnings", "source"],
        "properties": {
            "records": {
                "type": "array",
                "items": field_schema
            },
            "warnings": {
                "type": "array",
                "items": { "type": "string" }
            },
            "source": { "type": "string" }
        }
    })
}

fn build_gemini_response_schema() -> serde_json::Value {
    let field_schema = json!({
        "type": "object",
        "required": [
            "date",
            "vendor",
            "taxMode",
            "amount",
            "paymentMethod",
            "descriptionRaw",
            "accountCategoryCandidate",
            "accountCategoryFinal",
            "summary",
            "invoiceNumber",
            "memo"
        ],
        "properties": {
            "date": { "type": "string" },
            "vendor": { "type": "string" },
            "taxMode": { "type": "string", "enum": ["inclusive", "exclusive", "unknown"] },
            "amount": { "type": ["number", "null"] },
            "paymentMethod": { "type": "string" },
            "descriptionRaw": { "type": "string" },
            "accountCategoryCandidate": { "type": "string" },
            "accountCategoryFinal": { "type": "string" },
            "summary": { "type": "string" },
            "invoiceNumber": { "type": "string" },
            "memo": { "type": "string" }
        }
    });

    json!({
        "type": "object",
        "required": ["records", "warnings", "source"],
        "properties": {
            "records": {
                "type": "array",
                "items": field_schema
            },
            "warnings": {
                "type": "array",
                "items": { "type": "string" }
            },
            "source": { "type": "string" }
        }
    })
}

fn extract_output_text(value: &serde_json::Value) -> Option<String> {
    value
        .get("output")
        .and_then(|output| output.as_array())
        .into_iter()
        .flatten()
        .flat_map(|item| {
            item.get("content")
                .and_then(|content| content.as_array())
                .into_iter()
                .flatten()
        })
        .find_map(|content| {
            if content.get("type").and_then(|kind| kind.as_str()) == Some("output_text") {
                content
                    .get("text")
                    .and_then(|text| text.as_str())
                    .map(|text| text.to_string())
            } else {
                None
            }
        })
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

#[cfg(test)]
mod tests {
    use super::{
        build_gemini_request_body, extract_gemini_text, extract_output_text, AiFormatterRequest,
        AiFormatterResponsePayload,
    };

    #[test]
    fn extracts_output_text_from_responses_payload() {
        let payload = serde_json::json!({
            "output": [{
                "content": [{
                    "type": "output_text",
                    "text": "{\"records\":[],\"warnings\":[],\"source\":\"test\"}"
                }]
            }]
        });

        assert_eq!(
            extract_output_text(&payload),
            Some("{\"records\":[],\"warnings\":[],\"source\":\"test\"}".to_string())
        );
    }

    #[test]
    fn parses_formatter_payload_shape() {
        let payload = serde_json::json!({
            "records": [{
                "date": "2026-03-24",
                "vendor": "セブンイレブン",
                "taxMode": "inclusive",
                "amount": 1158,
                "paymentMethod": "現金",
                "descriptionRaw": "文具代",
                "accountCategoryCandidate": "消耗品費",
                "accountCategoryFinal": "消耗品費",
                "summary": "",
                "invoiceNumber": "",
                "memo": ""
            }],
            "warnings": [],
            "source": "openai-structured-output"
        });
        let parsed: AiFormatterResponsePayload = serde_json::from_value(payload).unwrap();

        assert_eq!(parsed.records[0].vendor, "セブンイレブン");
        assert_eq!(parsed.records[0].amount, Some(1158.0));
    }

    #[test]
    fn extracts_text_from_gemini_payload() {
        let payload = serde_json::json!({
            "candidates": [{
                "content": {
                    "parts": [{
                        "text": "{\"records\":[],\"warnings\":[],\"source\":\"test\"}"
                    }]
                }
            }]
        });

        assert_eq!(
            extract_gemini_text(&payload),
            Some("{\"records\":[],\"warnings\":[],\"source\":\"test\"}".to_string())
        );
    }

    #[test]
    fn builds_current_gemini_structured_output_shape() {
        let request = AiFormatterRequest {
            raw_text: "3月24日 セブンイレブン 税込1158円 現金 文具代 次へ".to_string(),
            provider: Some("gemini".to_string()),
            model: Some("gemini-2.5-flash".to_string()),
            reference_date: Some("2026-05-18T00:00:00+09:00".to_string()),
            dictionaries: serde_json::json!({}),
        };
        let body = build_gemini_request_body(&request);

        assert_eq!(
            body.pointer("/generationConfig/responseMimeType"),
            Some(&serde_json::json!("application/json"))
        );
        assert_eq!(
            body.pointer("/generationConfig/responseJsonSchema/type"),
            Some(&serde_json::json!("object"))
        );
    }

    #[test]
    fn builds_ai_diagnostics_without_exposing_key_values() {
        let diagnostics = super::AiFormatterService::diagnostics();

        assert_eq!(diagnostics.openai_env_var, "OPENAI_API_KEY");
        assert_eq!(diagnostics.gemini_env_var, "GEMINI_API_KEY");
    }
}
