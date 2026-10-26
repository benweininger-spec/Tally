package expo.modules.mtcevents

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.util.Log
import java.lang.reflect.Method
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Listens to the Microntek (MTC) head-unit broadcasts and forwards them to JS.
 *
 * Verified on the Dasaita Vivid13 (MTCHS_HA4Z MCU, decompiled android.microntek.service):
 *   com.microntek.report.event   extras type="headlight", value=<bool>   ← headlights (ILLUMI wire)
 *   com.microntek.biglight.state extras state=<int>                        ← same signal, raw MCU form
 *   com.microntek.acc / com.microntek.systemacc / com.microntek.power      ← ignition / power state
 *   com.microntek.obd            extras connect=<int>
 *   com.microntek.sync           (from android.microntek.canbus, periodic CAN state)
 * Every received intent is also logged as "MtcEvents: <action> {k=v,...}" so unknown
 * payloads can be read off `adb logcat` without rebuilding.
 */
class MtcEventsModule : Module() {
  companion object {
    private const val TAG = "MtcEvents"
    private const val EVENT = "onMtcEvent"
    val ACTIONS = listOf(
      "com.microntek.report.event",
      "com.microntek.biglight.state",
      "com.microntek.carlight",
      "com.microntek.acc",
      "com.microntek.systemacc",
      "com.microntek.power",
      "com.microntek.obd",
      "com.microntek.obdstatechange",
      "com.microntek.carstatechange",
      "com.microntek.sync",
      "com.microntek.canbusdisplay",
      // the factory radio service's own state report (freq / min / max / step) — see radioCommand
      "com.microntek.radio.report",
    )
    /**
     * MCU radio commands, from the decompiled com.microntek.radio RadioService (its IRadioService
     * sSearchNext/Prev + sTuneRight/Left call CarManager.setParameters with exactly these). The
     * stock launcher's media session only exposes "next/previous" = next FAVOURITE once any
     * favourite exists, which is why seek used to get stuck on one station (2026-10-26).
     * Whitelisted: nothing else can reach setParameters from JS.
     */
    private val RADIO_CMDS = mapOf(
      "seek_up" to "ctl_radio_seek=up",
      "seek_down" to "ctl_radio_seek=down",
      "tune_up" to "ctl_radio_tune=up",
      "tune_down" to "ctl_radio_tune=down",
    )
  }

  private val context: Context get() = appContext.reactContext ?: throw IllegalStateException("no context")
  private var receiver: BroadcastReceiver? = null
  private val last = HashMap<String, Map<String, Any?>>()
  private var carManager: Any? = null
  private var syncLogged = false

  /**
   * android.microntek.CarManager is a hidden framework class on MTC units (the stock
   * status bar uses it: attach(Handler, "CarEvent") → Message.obj=="CarEvent",
   * data{type:"battery", value:<tenths of a volt>} / {type:"handbrake", value}).
   * Reached by reflection; absent → silently skipped.
   */
  /**
   * android.microntek.CarManager is a hidden (non-SDK) class: on API 28+ plain reflection
   * on it throws NoSuchMethodException (FACT on this unit). Exempt ourselves the standard way
   * (VMRuntime.setHiddenApiExemptions via meta-reflection) before touching it. Harmless if
   * it fails — attachCarManager then just logs "unavailable".
   */
  private fun exemptHiddenApis() {
    try {
      val forName = Class::class.java.getDeclaredMethod("forName", String::class.java)
      val getDeclaredMethod = Class::class.java.getDeclaredMethod(
        "getDeclaredMethod", String::class.java, arrayOf<Class<*>>()::class.java
      )
      val vmRuntime = forName.invoke(null, "dalvik.system.VMRuntime") as Class<*>
      val getRuntime = getDeclaredMethod.invoke(vmRuntime, "getRuntime", null) as Method
      val setExemptions = getDeclaredMethod.invoke(
        vmRuntime, "setHiddenApiExemptions", arrayOf<Class<*>>(Array<String>::class.java)
      ) as Method
      setExemptions.invoke(getRuntime.invoke(null), arrayOf("L"))
    } catch (e: Throwable) {
      Log.w(TAG, "hidden-api exemption failed: $e")
    }
  }

  private fun attachCarManager() {
    if (carManager != null) return
    exemptHiddenApis()
    try {
      val cls = Class.forName("android.microntek.CarManager")
      val cm = cls.getConstructor().newInstance()
      val handler = object : Handler(Looper.getMainLooper()) {
        override fun handleMessage(msg: Message) {
          val tag = msg.obj as? String ?: return
          if (tag != "CarEvent") return
          val d = msg.data ?: return
          val type = d.getString("type") ?: return
          val extras = bundleToMap(d)
          val action = "carmanager.$type"
          last[action] = extras
          Log.i(TAG, "$action $extras")
          sendEvent(EVENT, mapOf("action" to action, "extras" to extras, "at" to System.currentTimeMillis()))
        }
      }
      cls.getMethod("attach", Handler::class.java, String::class.java).invoke(cm, handler, "CarEvent")
      carManager = cm
      Log.i(TAG, "CarManager attached")
      // seed synchronous states if the API offers them
      runCatching {
        val v = cls.getMethod("getIntState", String::class.java).invoke(cm, "battery") as? Int
        if (v != null && v > 0) {
          val extras = mapOf("type" to "battery", "value" to v)
          last["carmanager.battery"] = extras
          sendEvent(EVENT, mapOf("action" to "carmanager.battery", "extras" to extras, "at" to System.currentTimeMillis()))
        }
      }
    } catch (e: Throwable) {
      Log.w(TAG, "CarManager unavailable: $e")
    }
  }

  private fun bundleToMap(b: Bundle?): Map<String, Any?> {
    val m = HashMap<String, Any?>()
    if (b == null) return m
    for (k in b.keySet()) {
      val v = b.get(k)
      m[k] = when (v) {
        null -> null
        is Boolean, is Int, is Long, is Float, is Double, is String -> v
        else -> v.toString()
      }
    }
    return m
  }

  override fun definition() = ModuleDefinition {
    Name("MtcEvents")
    Events(EVENT)

    Function("last") { action: String -> last[action] }

    /** Seek / tune the FM tuner directly on the MCU. false = CarManager unavailable. */
    Function("radioCommand") { cmd: String ->
      val para = RADIO_CMDS[cmd] ?: return@Function false
      if (carManager == null) attachCarManager()
      val cm = carManager ?: return@Function false
      try {
        cm.javaClass.getMethod("setParameters", String::class.java).invoke(cm, para)
        Log.i(TAG, "radio $para")
        true
      } catch (e: Throwable) {
        Log.w(TAG, "radio $para failed: $e")
        false
      }
    }

    /** Tune to an exact frequency (Hz) through the radio service's own exported receiver. */
    Function("radioSetFreq") { hz: Int ->
      context.sendBroadcast(Intent("hct.radio.bar.move").putExtra("FREQ", hz))
      true
    }

    /** Ask the radio service to broadcast its state (com.microntek.radio.report type=content). */
    Function("radioRequestState") {
      context.sendBroadcast(Intent("hct.radio.request.data"))
      true
    }

    OnStartObserving {
      if (receiver != null) return@OnStartObserving
      val r = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
          val action = intent?.action ?: return
          val extras = bundleToMap(intent.extras)
          last[action] = extras
          // com.microntek.sync fires ~3x/s with an opaque byte[]; keep it off the JS bridge
          // and out of the log (first one only) until someone decodes it.
          if (action == "com.microntek.sync") {
            if (syncLogged) return
            syncLogged = true
          }
          Log.i(TAG, "$action $extras")
          sendEvent(EVENT, mapOf("action" to action, "extras" to extras, "at" to System.currentTimeMillis()))
        }
      }
      val f = IntentFilter().apply { ACTIONS.forEach { addAction(it) } }
      // vendor system broadcasts; exported receiver is required on API 33+
      context.registerReceiver(r, f, Context.RECEIVER_EXPORTED)
      receiver = r
      attachCarManager()
    }

    OnStopObserving {
      receiver?.let { runCatching { context.unregisterReceiver(it) } }
      receiver = null
    }
  }
}
