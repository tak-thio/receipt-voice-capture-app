//! FCM(Phase D)。Kotlin の FcmPlugin(FirebaseMessaging.getToken)を登録し、アプリの
//! コマンド get_fcm_token から run_mobile_plugin で呼ぶ。Android 以外はエラー(JS側で分岐)。

use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "android")]
struct NativeFcm<R: Runtime>(PluginHandle<R>);

#[derive(Debug, Serialize, Deserialize)]
pub struct FcmToken {
    pub token: String,
}

#[tauri::command]
pub fn get_fcm_token<R: Runtime>(app: AppHandle<R>) -> Result<FcmToken, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<NativeFcm<R>>();
        state
            .0
            .run_mobile_plugin::<FcmToken>("getToken", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("FCM は Android のみ対応です".into())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nativefcm")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("com.itsherpa.ffreceipt", "FcmPlugin")?;
                _app.manage(NativeFcm(handle));
            }
            Ok(())
        })
        .build()
}
