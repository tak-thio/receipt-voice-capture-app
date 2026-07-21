//! Android / iOS のアプリ内課金プラグインを Tauri コマンドとして公開する。

use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "ios")]
use std::fs::{create_dir_all, OpenOptions};
#[cfg(target_os = "ios")]
use std::io::Write;

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg(any(target_os = "android", target_os = "ios"))]
struct SubscribeArgs {
    #[serde(skip_serializing_if = "Option::is_none")]
    app_account_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg(target_os = "ios")]
struct UnfinishedResult {
    transactions: Vec<SubscribeResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg(target_os = "ios")]
struct FinishArgs {
    transaction_id: String,
}

#[derive(Debug, Deserialize)]
#[cfg(target_os = "ios")]
struct FinishResult {
    #[allow(dead_code)]
    finished: bool,
}

#[cfg(target_os = "ios")]
const IOS_BILLING_DIAGNOSTIC_EVENTS: &[&str] = &[
    "upgrade.started",
    "purchase-context.started",
    "purchase-context.completed",
    "native-subscribe.started",
    "native-subscribe.completed",
    "verify.started",
    "verify.completed",
    "upgrade.failed",
];

#[tauri::command]
pub fn native_billing_diagnostic<R: Runtime>(
    app: AppHandle<R>,
    event: String,
) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        if !IOS_BILLING_DIAGNOSTIC_EVENTS.contains(&event.as_str()) {
            return Err("不明な課金診断イベントです".into());
        }
        let documents = app.path().document_dir().map_err(|error| error.to_string())?;
        create_dir_all(&documents).map_err(|error| error.to_string())?;
        let reset = event == "upgrade.started";
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(reset)
            .append(!reset)
            .open(documents.join("billing-diagnostics.log"))
            .map_err(|error| error.to_string())?;
        writeln!(file, "[billing-debug][frontend] {event}").map_err(|error| error.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, event);
        Ok(())
    }
}

#[tauri::command]
pub async fn native_subscribe<R: Runtime>(
    app: AppHandle<R>,
    app_account_token: Option<String>,
) -> Result<SubscribeResult, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let state = app.state::<NativeBilling<R>>();
        state
            .0
            .run_mobile_plugin::<SubscribeResult>(
                "subscribe",
                SubscribeArgs { app_account_token },
            )
            .map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = (app, app_account_token);
        Err("アプリ内課金は Android または iOS のみ対応です".into())
    }
}

#[tauri::command]
pub async fn native_restore_subscription<R: Runtime>(
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

#[tauri::command]
pub async fn native_unfinished_transactions<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<SubscribeResult>, String> {
    #[cfg(target_os = "ios")]
    {
        let state = app.state::<NativeBilling<R>>();
        state
            .0
            .run_mobile_plugin::<UnfinishedResult>("unfinished", ())
            .map(|result| result.transactions)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Err("未完了取引の取得は iOS のみ対応です".into())
    }
}

#[tauri::command]
pub async fn native_finish_transaction<R: Runtime>(
    app: AppHandle<R>,
    transaction_id: String,
) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let state = app.state::<NativeBilling<R>>();
        state
            .0
            .run_mobile_plugin::<FinishResult>("finish", FinishArgs { transaction_id })
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, transaction_id);
        Err("取引の完了は iOS のみ対応です".into())
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
