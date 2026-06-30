//! アプリ内課金(IAP / ⑤)。Kotlin の BillingPlugin(Google Play Billing で pro_monthly を購入)を
//! 登録し、アプリのコマンド native_subscribe から run_mobile_plugin で呼ぶ。購入が完了すると
//! purchaseToken を返すので、JS 側がサーバの /billing/google/verify に渡して検証→pro 付与する。
//! Android 以外はエラー(JS側で分岐)。

use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "android")]
struct NativeBilling<R: Runtime>(PluginHandle<R>);

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeResult {
    pub purchase_token: String,
    pub product_id: String,
}

#[tauri::command]
pub fn native_subscribe<R: Runtime>(app: AppHandle<R>) -> Result<SubscribeResult, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<NativeBilling<R>>();
        state
            .0
            .run_mobile_plugin::<SubscribeResult>("subscribe", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("アプリ内課金は Android のみ対応です".into())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nativebilling")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin("com.itsherpa.ffreceipt", "BillingPlugin")?;
                _app.manage(NativeBilling(handle));
            }
            Ok(())
        })
        .build()
}
