package com.itsherpa.ffreceipt

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

// ネイティブ録音(MediaRecorder→m4a/AAC)。WebViewのMediaRecorderより反応が速く確実。
// 権限(RECORD_AUDIO)はManifest宣言済み。未許可なら要求し、その回は中断する。
@TauriPlugin
class AudioRecorderPlugin(private val activity: Activity) : Plugin(activity) {
    private var recorder: MediaRecorder? = null
    private var outFile: File? = null

    @Command
    fun startRecording(invoke: Invoke) {
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 4001)
            invoke.reject("マイクの権限を許可してから、もう一度録音してください")
            return
        }
        try {
            recorder?.let {
                try { it.release() } catch (_: Exception) {}
            }
            val file = File(activity.cacheDir, "rec_${System.currentTimeMillis()}.m4a")
            @Suppress("DEPRECATION")
            val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                MediaRecorder(activity) else MediaRecorder()
            rec.setAudioSource(MediaRecorder.AudioSource.MIC)
            rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            rec.setAudioEncodingBitRate(96000)
            rec.setAudioSamplingRate(44100)
            rec.setOutputFile(file.absolutePath)
            rec.prepare()
            rec.start()
            recorder = rec
            outFile = file
            invoke.resolve()
        } catch (e: Exception) {
            recorder = null
            outFile = null
            invoke.reject("録音を開始できませんでした: ${e.message}")
        }
    }

    @Command
    fun stopRecording(invoke: Invoke) {
        val rec = recorder
        val file = outFile
        recorder = null
        outFile = null
        if (rec == null || file == null) {
            invoke.reject("録音していません")
            return
        }
        try {
            rec.stop()
        } catch (_: Exception) {
            // 短すぎる等で stop が失敗してもファイルがあれば返す
        }
        try { rec.release() } catch (_: Exception) {}
        try {
            val bytes = file.readBytes()
            val ret = JSObject()
            ret.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
            ret.put("mime", "audio/mp4")
            ret.put("size", bytes.size)
            invoke.resolve(ret)
        } catch (e: Exception) {
            invoke.reject("録音ファイルの読み込みに失敗: ${e.message}")
        } finally {
            try { file.delete() } catch (_: Exception) {}
        }
    }
}
