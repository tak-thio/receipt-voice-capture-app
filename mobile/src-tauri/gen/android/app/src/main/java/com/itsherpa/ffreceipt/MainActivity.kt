package com.itsherpa.ffreceipt

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
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
