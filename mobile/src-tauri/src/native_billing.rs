//! Android / iOS のアプリ内課金プラグインを Tauri コマンドとして公開する。

use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Runtime};

#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(any(target_os = "android", target_os = "ios"))]
struct NativeBilling<R: Runtime>(PluginHandle<R>);

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_nativebilling);

fn default_google_platform() -> String {
    "google".into()
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeResult {
    #[serde(default = "default_google_platform")]
    pub platform: String,
    pub product_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchase_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_transaction_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signed_transaction_info: Option<String>,
}

#[tauri::command]
pub fn native_subscribe<R: Runtime>(app: AppHandle<R>) -> Result<SubscribeResult, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let state = app.state::<NativeBilling<R>>();
        state
            .0
            .run_mobile_plugin::<SubscribeResult>("subscribe", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = app;
        Err("アプリ内課金は Android または iOS のみ対応です".into())
    }
}

#[tauri::command]
pub fn native_restore_subscription<R: Runtime>(
    app: AppHandle<R>,
) -> Result<SubscribeResult, String> {
    #[cfg(target_os = "ios")]
    {
        let state = app.state::<NativeBilling<R>>();
        state
            .0
            .run_mobile_plugin::<SubscribeResult>("restore", ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Err("購入の復元は iOS のみ対応です".into())
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
            #[cfg(target_os = "ios")]
            {
                let handle = _api.register_ios_plugin(init_plugin_nativebilling)?;
                _app.manage(NativeBilling(handle));
            }
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::SubscribeResult;

    #[test]
    fn android_payload_without_platform_defaults_to_google() {
        let result: SubscribeResult = serde_json::from_value(serde_json::json!({
            "purchaseToken": "play-token",
            "productId": "pro_monthly"
        }))
        .expect("Android payload should deserialize");

        assert_eq!(result.platform, "google");
        assert_eq!(result.purchase_token.as_deref(), Some("play-token"));
        assert_eq!(result.product_id, "pro_monthly");
    }

    #[test]
    fn apple_payload_preserves_transaction_fields() {
        let result = SubscribeResult {
            platform: "apple".into(),
            product_id: "pro_monthly".into(),
            purchase_token: None,
            transaction_id: Some("transaction-id".into()),
            original_transaction_id: Some("original-transaction-id".into()),
            signed_transaction_info: Some("signed-transaction".into()),
        };

        let value = serde_json::to_value(result).expect("Apple payload should serialize");

        assert_eq!(value["platform"], "apple");
        assert_eq!(value["transactionId"], "transaction-id");
        assert_eq!(value["originalTransactionId"], "original-transaction-id");
        assert_eq!(value["signedTransactionInfo"], "signed-transaction");
        assert!(value.get("purchaseToken").is_none());
    }
}
