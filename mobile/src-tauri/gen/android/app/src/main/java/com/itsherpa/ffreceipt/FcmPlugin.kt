package com.itsherpa.ffreceipt

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.firebase.messaging.FirebaseMessaging

// FCM(Phase D): 端末のFCM登録トークンを取得する。Android 13+ は通知権限(POST_NOTIFICATIONS)も要求。
@TauriPlugin
class FcmPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun getToken(invoke: Invoke) {
        // Android 13+ はランタイム許可が無いと通知が表示されない。ダイアログ中でもトークンは取れるので続行。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4002)
        }
        FirebaseMessaging.getInstance().token
            .addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    val ret = JSObject()
                    ret.put("token", task.result ?: "")
                    invoke.resolve(ret)
                } else {
                    invoke.reject("FCMトークン取得に失敗: ${task.exception?.message}")
                }
            }
    }
}
