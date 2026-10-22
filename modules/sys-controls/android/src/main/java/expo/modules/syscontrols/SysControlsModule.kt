package expo.modules.syscontrols

import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Bundle
import android.provider.Settings
import androidx.core.os.bundleOf
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.roundToInt

private class NoWriteSettingsException :
  CodedException("ERR_WRITE_SETTINGS", "Modify-system-settings access not granted", null)

/**
 * The few system controls a launcher needs so Android Settings is rarely seen:
 * screen brightness + screen-off timeout (Settings.System, behind the user-granted
 * WRITE_SETTINGS special access), media volume (AudioManager, no permission), and
 * READ-ONLY Bluetooth / Wi-Fi state — apps can't toggle radios on API 33, so the JS
 * side deep-links to the system pages for that.
 */
class SysControlsModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "No React context" }

  private fun audio() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private fun canWrite() = Settings.System.canWrite(context)
  private fun requireWrite() {
    if (!canWrite()) throw NoWriteSettingsException()
  }

  override fun definition() = ModuleDefinition {
    Name("SysControls")

    /** Everything the SET sheet shows, in one bridge call. */
    Function("getState") { state() }

    Function("requestWriteSettings") {
      val intent = Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + context.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      (appContext.activityProvider?.currentActivity ?: context).startActivity(intent)
    }

    Function("setBrightness") { value: Double ->
      requireWrite()
      val cr = context.contentResolver
      Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
      Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, (value.coerceIn(0.0, 1.0) * 255).roundToInt().coerceAtLeast(1))
    }

    Function("setVolume") { value: Double ->
      val a = audio()
      val max = a.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      // flags = 0: no system volume HUD (part of "make Android invisible")
      a.setStreamVolume(AudioManager.STREAM_MUSIC, (value.coerceIn(0.0, 1.0) * max).roundToInt(), 0)
      // Microntek units: the amplifier is MCU-driven and ignores the Android stream.
      // The MCU service accepts com.microntek.VOLUME_SET { volume: percent 0..100 }
      // (FACT, decompiled MicrontekServer: vol = KEY_VOLMAX * volume / 100).
      try {
        context.sendBroadcast(
          Intent("com.microntek.VOLUME_SET").putExtra("volume", (value.coerceIn(0.0, 1.0) * 100).roundToInt())
        )
      } catch (_: Throwable) {}
    }

    /** Android's global font scale (Settings.System.FONT_SCALE). RN text honours it live;
     *  MainActivity declares fontScale in configChanges so the app doesn't restart. */
    Function("setFontScale") { scale: Double ->
      requireWrite()
      Settings.System.putFloat(context.contentResolver, Settings.System.FONT_SCALE, scale.coerceIn(0.8, 1.6).toFloat())
    }

    Function("setScreenTimeout") { ms: Int ->
      requireWrite()
      Settings.System.putInt(context.contentResolver, Settings.System.SCREEN_OFF_TIMEOUT, ms)
    }
  }

  private fun state(): Bundle {
    val cr = context.contentResolver
    val a = audio()
    val max = a.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
    return bundleOf(
      "canWriteSettings" to canWrite(),
      "brightness" to Settings.System.getInt(cr, Settings.System.SCREEN_BRIGHTNESS, 128) / 255.0,
      "volume" to a.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / max,
      "volumeSteps" to max,
      "screenTimeoutMs" to Settings.System.getInt(cr, Settings.System.SCREEN_OFF_TIMEOUT, 60_000),
      "fontScale" to Settings.System.getFloat(cr, Settings.System.FONT_SCALE, 1f).toDouble(),
      "bluetoothOn" to bluetoothOn(),
      "wifiOn" to wifiOn()
    )
  }

  private fun bluetoothOn(): Boolean =
    try {
      (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter?.isEnabled == true
    } catch (_: Throwable) {
      false
    }

  private fun wifiOn(): Boolean =
    try {
      (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)?.isWifiEnabled == true
    } catch (_: Throwable) {
      false
    }
}
