package com.itsherpa.ffreceipt

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  // 以前は enableEdgeToEdge() で常に画面端まで描画していたが、Android 14 以下の WebView は
  // env(safe-area-inset-bottom) にナビゲーションバーの高さを返さず、下部メニューがナビバーに
  // かぶってしまう。enableEdgeToEdge を外すと、旧 Android では OS がシステムバーの内側に
  // コンテンツを収める(=かぶらない)。Android 15+ は強制エッジ to エッジのままで、CSS の
  // env(safe-area-inset-*) 側でタブバーを持ち上げる(index.css 参照)。
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    requestMediaPermissions()
  }

  // getUserMedia in the WebView only succeeds once the app holds the dangerous
  // CAMERA / RECORD_AUDIO runtime permissions, so request them up front.
  private fun requestMediaPermissions() {
    val required = arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
    val missing = required.filter {
      ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
    }
    if (missing.isNotEmpty()) {
      ActivityCompat.requestPermissions(this, missing.toTypedArray(), MEDIA_PERMISSION_REQUEST)
    }
  }

  companion object {
    private const val MEDIA_PERMISSION_REQUEST = 1001
  }
}
