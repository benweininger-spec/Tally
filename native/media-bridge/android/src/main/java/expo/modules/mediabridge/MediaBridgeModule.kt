package expo.modules.mediabridge

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
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

    AsyncFunction("getNowPlaying") { pickDisplay(controllers())?.let { controllerToBundle(it) } }
    /** All active sessions (diagnostics / pickers). */
    AsyncFunction("getSessions") { controllers().map { controllerToBundle(it) } }
    /** The tuner's session, if the unit publishes one (only when it has a frequency to show). */
    AsyncFunction("getRadio") { radioSession(controllers())?.takeIf { realTitle(it) }?.let { controllerToBundle(it) } }
    /** Transport on the tuner session: play/pause switches the unit to/from FM; next/previous = seek. */
    AsyncFunction("radioTransport") { cmd: String -> transportOn(radioSession(controllers()), cmd) }

    /**
     * The tuner's favourites: its session QUEUE ("Playing List", 4 items on this unit —
     * FACT, dumpsys 2026-10-23) with each station's logo, the same tiles the stock
     * launcher shows. Tuning = skipToQueueItem (the session advertises that action;
     * it has no play-from-frequency).
     */
    AsyncFunction("getRadioPresets") {
      val c = radioSession(controllers()) ?: return@AsyncFunction emptyList<Bundle>()
      val active = c.playbackState?.activeQueueItemId ?: -1L
      (c.queue ?: emptyList()).take(8).map { q ->
        val d = q.description
        bundleOf(
          "id" to q.queueId.toDouble(),
          "title" to (d.title?.toString() ?: ""),
          "subtitle" to (d.subtitle?.toString() ?: ""),
          "art" to imageUri(d.iconBitmap, d.iconUri),
          "active" to (q.queueId == active)
        )
      }
    }
    AsyncFunction("radioPlayPreset") { id: Double ->
      radioSession(controllers())?.transportControls?.skipToQueueItem(id.toLong())
    }
    /** The session's own "Favorite" custom action (adds the current station to its list). */
    AsyncFunction("radioFavorite") {
      val c = radioSession(controllers()) ?: return@AsyncFunction false
      val ca = c.playbackState?.customActions?.firstOrNull {
        it.name?.toString()?.contains("favorite", true) == true || it.action.contains("favorite", true)
      } ?: return@AsyncFunction false
      c.transportControls.sendCustomAction(ca.action, ca.extras)
      true
    }
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
   * Which session is which on this unit (FACT, `dumpsys media_session`, 2026-10-23): the
   * stock Telenav launcher owns three, told apart by their session TAG —
   *   BluetoothMediaService              → the PHONE's music over the unit's BT module
   *                                        (play/pause/next/prev; e.g. "Four · Children of Strife")
   *   radioServerRadioMediaBrowserService → the FM/AM tuner (title "102.30", album "FM", presets)
   *   LocalMediaService                   → USB / local files
   * Android's own com.android.bluetooth session sits idle ("Bluetooth audio disconnected").
   * The old picker skipped EVERY launcher session, which hid the phone's music entirely.
   */
  private val LAUNCHER_PKG = "com.telenav.scout.launcher"
  private fun titleOf(c: MediaController) = c.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)?.trim()
  private fun realTitle(c: MediaController): Boolean {
    val t = titleOf(c) ?: return false
    return t.isNotBlank() && !t.equals("Not Playing", true) && !t.equals("Unknown", true)
  }
  private fun playing(c: MediaController) = c.playbackState?.state == PlaybackState.STATE_PLAYING
  private fun tagOf(c: MediaController): String = try { c.tag ?: "" } catch (_: Throwable) { "" }

  private fun isRadio(c: MediaController): Boolean {
    if (tagOf(c).contains("radio", ignoreCase = true)) return true
    val album = c.metadata?.getString(MediaMetadata.METADATA_KEY_ALBUM)?.trim()?.uppercase()
    return album == "FM" || album == "AM" || Regex("^\\d{2,4}\\.\\d{1,2}$").matches(titleOf(c) ?: "")
  }

  /** the phone over Bluetooth: the launcher's BT session first (it's the live one here) */
  private fun phoneBt(list: List<MediaController>): MediaController? =
    list.firstOrNull { it.packageName == LAUNCHER_PKG && tagOf(it).contains("bluetooth", true) }
      ?: list.firstOrNull { it.packageName == "com.microntek.btmusic" }
      ?: list.firstOrNull { it.packageName == "com.android.bluetooth" && realTitle(it) }

  /** What the BLUETOOTH/app card shows: playing with a title → the phone's BT track → any titled non-radio. */
  private fun pickDisplay(list: List<MediaController>): MediaController? {
    val media = list.filter { !isRadio(it) }
    return media.firstOrNull { playing(it) && realTitle(it) }
      ?: phoneBt(media)?.takeIf { realTitle(it) }
      ?: media.firstOrNull { realTitle(it) }
  }

  /** What ▶ / ‹‹ / ›› drive: the shown session, else the phone's BT session (so ▶ can resume it). */
  private fun pickTransport(list: List<MediaController>): MediaController? =
    pickDisplay(list) ?: phoneBt(list.filter { !isRadio(it) })

  /** The FM/AM tuner session — found even with no title, so PLAY can switch the unit to FM. */
  private fun radioSession(list: List<MediaController>): MediaController? = list.firstOrNull { isRadio(it) }

  private fun transportOn(c: MediaController?, cmd: String) {
    val tc = c?.transportControls ?: return
    when (cmd) {
      "play" -> tc.play(); "pause" -> tc.pause(); "next" -> tc.skipToNext(); "previous" -> tc.skipToPrevious()
      "toggle" -> if (playing(c)) tc.pause() else tc.play()
    }
  }


  private fun readActive(): MediaController? = pickTransport(controllers())

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
    val top = pickDisplay(list) ?: pickTransport(list)
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
      "tag" to tagOf(c),
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

  /** Album art / station logo: a bitmap if the session sent one, else its art URI. */
  private fun artToDataUri(md: MediaMetadata?): String? {
    if (md == null) return null
    val bmp = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
      ?: md.getBitmap(MediaMetadata.METADATA_KEY_ART)
      ?: md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
    val uri = (md.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI)
      ?: md.getString(MediaMetadata.METADATA_KEY_ART_URI)
      ?: md.getString(MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI))?.let { Uri.parse(it) }
    return imageUri(bmp, uri)
  }

  // Encoded images, keyed by bitmap identity (a session hands back the SAME Bitmap until
  // its metadata changes) or by URI — so the 2–3 s polls don't re-encode JPEGs.
  private val imageCache = object : LinkedHashMap<String, String>(32, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 24
  }

  /** data: URI for a bitmap, or for a content:// / android.resource:// URI we can open; http(s) passes through. */
  private fun imageUri(bmp: Bitmap?, uri: Uri?): String? {
    if (bmp != null) {
      val key = "b${System.identityHashCode(bmp)}:${bmp.generationId}"
      imageCache[key]?.let { return it }
      return encode(bmp).also { if (it != null) imageCache[key] = it }
    }
    if (uri == null) return null
    val key = "u$uri"
    imageCache[key]?.let { return it }
    val scheme = uri.scheme?.lowercase()
    if (scheme == "http" || scheme == "https") return uri.toString()
    val decoded = try {
      context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
    } catch (_: Throwable) {
      null // another app's provider we can't read — no logo, no crash
    }
    return decoded?.let { encode(it) }?.also { imageCache[key] = it }
  }

  private fun encode(bmp: Bitmap, max: Int = 256, quality: Int = 80): String? = try {
    val scaled = if (bmp.width > max || bmp.height > max) {
      val r = max.toFloat() / maxOf(bmp.width, bmp.height)
      Bitmap.createScaledBitmap(bmp, (bmp.width * r).toInt().coerceAtLeast(1), (bmp.height * r).toInt().coerceAtLeast(1), true)
    } else {
      bmp
    }
    val out = ByteArrayOutputStream()
    // PNG keeps logo transparency; JPEG is fine (and smaller) for photos
    val png = bmp.hasAlpha()
    scaled.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, quality, out)
    (if (png) "data:image/png;base64," else "data:image/jpeg;base64,") + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  } catch (_: Throwable) {
    null
  }
}
