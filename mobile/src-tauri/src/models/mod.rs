use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureImageMeta {
    pub image_path: String,
    pub captured_at: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAudioClipMeta {
    pub audio_path: String,
    pub mime_type: String,
    pub size: usize,
    pub started_at: String,
    pub ended_at: String,
}
