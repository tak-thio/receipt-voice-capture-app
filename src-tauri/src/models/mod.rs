use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureImageMeta {
    pub image_path: String,
    pub captured_at: String,
    pub width: u32,
    pub height: u32,
}
