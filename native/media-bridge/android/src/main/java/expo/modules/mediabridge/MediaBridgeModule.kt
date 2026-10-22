package expo.modules.mediabridge

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream

private const val ON_TRACK_CHANGED = "onTrackChanged"
private const val ON_PLAYBACK_CHANGED = "onPlaybackChanged"

/**
 * Reads the active media session's now-playing metadata + transport, exposed to JS
 * via the Expo Modules API. Requires the user to enable the companion
 * NotificationListenerService (Settings → Notification access). Maps to
 * media.nowPlaying in the DataSource contract — see src/data/live/mediaBridge.ts.
 */
class MediaBridgeModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "No React context" }

  private val handler = Handler(Looper.getMainLooper())
  private var sessionsListener: MediaSessionManager.OnActiveSessionsChangedListener? = null
  private var watched: MediaController? = null
  private var controllerCallback: MediaController.Callback? = null

  private fun manager() =
    context.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager

  private fun listenerComponent() =
    ComponentName(context, MediaBridgeNotificationListenerService::class.java)

  private fun isEnabled(): Boolean {
    val flat = listenerComponent().flattenToString()
    val enabled =
      Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: ""
    return enabled.split(":").any { it.equals(flat, ignoreCase = true) }
  }

  override fun definition() = ModuleDefinition {
    Name("MediaBridge")
    Events(ON_TRACK_CHANGED, ON_PLAYBACK_CHANGED)

    Function("hasNotificationAccess") { isEnabled() }

    Function("openListenerSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        intent.putExtra(
          Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
          listenerComponent().flattenToString()
        )
      } catch (_: Throwable) {
      }
      val activity = appContext.activityProvider?.currentActivity
      (activity ?: context).startActivity(intent)
    }

    AsyncFunction("getNowPlaying") { readActive()?.let { controllerToBundle(it) } }
    /** All active sessions (diagnostics / pickers). */
    AsyncFunction("getSessions") { controllers().map { controllerToBundle(it) } }
    /** The tuner's session, if the unit publishes one. */
    AsyncFunction("getRadio") { radioSession(controllers())?.let { controllerToBundle(it) } }
    /** Transport on the tuner session: next/previous = seek station on this unit. */
    AsyncFunction("radioTransport") { cmd: String -> transportOn(radioSession(controllers()), cmd) }
    AsyncFunction("toggle") { transportOn(readActive(), "toggle") }

    AsyncFunction("play") { transport { it.play() } }
    AsyncFunction("pause") { transport { it.pause() } }
    AsyncFunction("next") { transport { it.skipToNext() } }
    AsyncFunction("previous") { transport { it.skipToPrevious() } }

    OnStartObserving { handler.post { startWatching() } }
    OnStopObserving { handler.post { stopWatching() } }
  }

  private fun controllers(): List<MediaController> =
    try {
      if (isEnabled()) manager().getActiveSessions(listenerComponent()) else emptyList()
    } catch (_: SecurityException) {
      emptyList()
    }

  /**
   * Pick the session that matters. FYT/Dasaita units keep several EMPTY sessions open
   * (the stock Telenav launcher holds three), so "first" is usually a blank one. Prefer:
   * playing + has a title → any with a title → the Bluetooth A2DP/AVRCP session → first.
   */
  /** The stock Telenav launcher keeps 3 sessions open on this unit; one is the FM tuner
   *  (title "102.30", artist = RDS text, album "FM") that stays STATE_PLAYING forever,
   *  another is literally titled "Not Playing". Treat them as the RADIO source, never as
   *  the Bluetooth/app source. */
  private val LAUNCHER_PKG = "com.telenav.scout.launcher"
  private fun titleOf(c: MediaController) = c.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)?.trim()
  private fun realTitle(c: MediaController): Boolean {
    val t = titleOf(c) ?: return false
    return t.isNotBlank() && !t.equals("Not Playing", true) && !t.equals("Unknown", true)
  }
  private fun playing(c: MediaController) = c.playbackState?.state == PlaybackState.STATE_PLAYING
  private fun isLauncher(c: MediaController) = c.packageName == LAUNCHER_PKG

  private fun pick(list: List<MediaController>): MediaController? =
    list.firstOrNull { !isLauncher(it) && playing(it) && realTitle(it) }
      ?: list.firstOrNull { !isLauncher(it) && realTitle(it) }
      ?: list.firstOrNull { it.packageName == "com.android.bluetooth" && realTitle(it) }
      ?: null

  /** The FM/AM tuner session (launcher-owned, album == "FM"/"AM" or a frequency title). */
  private fun radioSession(list: List<MediaController>): MediaController? =
    list.firstOrNull { c ->
      val album = c.metadata?.getString(MediaMetadata.METADATA_KEY_ALBUM)?.trim()?.uppercase()
      val t = titleOf(c) ?: ""
      (album == "FM" || album == "AM" || Regex("^\\d{2,4}\\.\\d$").matches(t)) && realTitle(c)
    }

  private fun transportOn(c: MediaController?, cmd: String) {
    val tc = c?.transportControls ?: return
    when (cmd) {
      "play" -> tc.play(); "pause" -> tc.pause(); "next" -> tc.skipToNext(); "previous" -> tc.skipToPrevious()
      "toggle" -> if (playing(c)) tc.pause() else tc.play()
    }
  }


  private fun readActive(): MediaController? = pick(controllers())

  private inline fun transport(block: (MediaController.TransportControls) -> Unit) {
    readActive()?.transportControls?.let(block)
  }

  // ---- live watching --------------------------------------------------------
  private fun startWatching() {
    if (sessionsListener != null) return
    val l = MediaSessionManager.OnActiveSessionsChangedListener { list -> attach(list ?: emptyList()) }
    sessionsListener = l
    try {
      manager().addOnActiveSessionsChangedListener(l, listenerComponent(), handler)
      attach(controllers())
    } catch (_: SecurityException) {
      // listener not yet enabled — JS will prompt the user to grant access
    }
  }

  private fun stopWatching() {
    sessionsListener?.let { manager().removeOnActiveSessionsChangedListener(it) }
    sessionsListener = null
    detach()
  }

  private fun attach(list: List<MediaController>) {
    val top = pick(list)
    if (top === watched) return
    detach()
    if (top == null) return
    watched = top
    val cb = object : MediaController.Callback() {
      override fun onMetadataChanged(metadata: MediaMetadata?) = emitTrack(top)
      override fun onPlaybackStateChanged(state: PlaybackState?) {
        sendEvent(
          ON_PLAYBACK_CHANGED,
          bundleOf(
            "playing" to (state?.state == PlaybackState.STATE_PLAYING),
            "positionMs" to (state?.position ?: 0L)
          )
        )
      }
    }
    controllerCallback = cb
    top.registerCallback(cb, handler)
    emitTrack(top)
  }

  private fun detach() {
    controllerCallback?.let { cb -> watched?.unregisterCallback(cb) }
    controllerCallback = null
    watched = null
  }

  private fun emitTrack(c: MediaController) = sendEvent(ON_TRACK_CHANGED, controllerToBundle(c))

  private fun controllerToBundle(c: MediaController): Bundle {
    val md = c.metadata
    val ps = c.playbackState
    return bundleOf(
      "package" to c.packageName,
      "playing" to playing(c),
      "title" to md?.getString(MediaMetadata.METADATA_KEY_TITLE),
      "artist" to md?.getString(MediaMetadata.METADATA_KEY_ARTIST),
      "album" to md?.getString(MediaMetadata.METADATA_KEY_ALBUM),
      "durationMs" to (md?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L),
      "positionMs" to (ps?.position ?: 0L),
      "playing" to (ps?.state == PlaybackState.STATE_PLAYING),
      "artUri" to artToDataUri(md)
    )
  }

  private fun artToDataUri(md: MediaMetadata?, max: Int = 256, quality: Int = 80): String? {
    val bmp = md?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
      ?: md?.getBitmap(MediaMetadata.METADATA_KEY_ART)
      ?: md?.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
      ?: return null
    val scaled = if (bmp.width > max || bmp.height > max) {
      val r = max.toFloat() / maxOf(bmp.width, bmp.height)
      Bitmap.createScaledBitmap(bmp, (bmp.width * r).toInt(), (bmp.height * r).toInt(), true)
    } else {
      bmp
    }
    val out = ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
    return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }
}
