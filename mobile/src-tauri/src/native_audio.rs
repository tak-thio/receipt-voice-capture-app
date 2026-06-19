//! ネイティブ録音(Android)。Kotlin の AudioRecorderPlugin(MediaRecorder→m4a)を登録し、
//! アプリ自身のコマンド(start/stop)から run_mobile_plugin で呼ぶ。JS からはアプリコマンドを
//! invoke するだけ(プラグインACL不要)。Android 以外はエラーを返す(呼び出し側が WebView 録音に分岐)。

use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "android")]
struct NativeAudio<R: Runtime>(PluginHandle<R>);

#[derive(Debug, Serialize, Deserialize)]
pub struct NativeAudioClip {
    pub base64: String,
    pub mime: String,
    #[serde(default)]
    pub size: i64,
}

#[tauri::command]
pub fn native_start_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<NativeAudio<R>>();
        state
            .0
            .run_mobile_plugin::<()>("startRecording", ())
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("ネイティブ録音は Android のみ対応です".into())
    }
}

#[tauri::command]
pub fn native_stop_recording<R: Runtime>(app: AppHandle<R>) -> Result<NativeAudioClip, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<NativeAudio<R>>();
        state
            .0
            .run_mobile_plugin::<NativeAudioClip>("stopRecording", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("ネイティブ録音は Android のみ対応です".into())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nativeaudio")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api
                    .register_android_plugin("com.itsherpa.ffreceipt", "AudioRecorderPlugin")?;
                _app.manage(NativeAudio(handle));
            }
            Ok(())
        })
        .build()
}
