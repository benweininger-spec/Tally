package expo.modules.jskeepalive

import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Keeps JS timers running while another screen is in front.
 *
 * React Native pauses every JS timer when the activity pauses (JavaTimerManager.onHostPause)
 * — unless a headless JS task is active. On the head unit that froze OBD polling, MPG
 * logging and the auto-connect retries whenever CarPlay, the stock Telenav launcher (which
 * pops itself up when Bluetooth connects) or even a half-second permission screen was on
 * top (FACT, logcat 2026-10-23). Holding one never-ending headless task keeps
 * `isRunningTasks` true, so timers keep firing in the background.
 *
 * The JS side registers the task (`AppRegistry.registerHeadlessTask`) as a promise that
 * never settles; `stop()` finishes it. Everything is try/caught — we're the launcher.
 */
class JsKeepAliveModule : Module() {
  private var taskId: Int? = null
  private var ctx: ReactContext? = null

  /** The ReactContext the timer manager listens on: the host's current context first. */
  private fun reactContext(): ReactContext? {
    val app = appContext.currentActivity?.application ?: appContext.reactContext?.applicationContext
    val fromHost = (app as? ReactApplication)?.reactHost?.currentReactContext
    return fromHost ?: (appContext.reactContext as? ReactContext)
  }

  override fun definition() = ModuleDefinition {
    Name("JsKeepAlive")

    AsyncFunction("start") {
      if (taskId != null) return@AsyncFunction true
      val rc = reactContext() ?: return@AsyncFunction false
      try {
        // timeout 0 = never times out; allowed in foreground (we start it while visible)
        taskId = HeadlessJsTaskContext.getInstance(rc).startTask(
          HeadlessJsTaskConfig(TASK, Arguments.createMap(), 0, true)
        )
        ctx = rc
        Log.i(TAG, "keep-alive task $taskId started")
        true
      } catch (t: Throwable) {
        Log.w(TAG, "keep-alive unavailable: ${t.message}")
        false
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") {
      val id = taskId ?: return@AsyncFunction false
      try {
        ctx?.let { HeadlessJsTaskContext.getInstance(it).finishTask(id) }
      } catch (_: Throwable) {
      }
      taskId = null
      ctx = null
      Log.i(TAG, "keep-alive task $id finished")
      true
    }.runOnQueue(Queues.MAIN)

    Function("isActive") { taskId != null }
  }

  companion object {
    const val TASK = "TacomaKeepAlive"
    const val TAG = "JsKeepAlive"
  }
}
