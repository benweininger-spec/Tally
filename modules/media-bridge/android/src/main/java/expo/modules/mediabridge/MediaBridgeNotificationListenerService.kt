package expo.modules.mediabridge

import android.service.notification.NotificationListenerService

/**
 * Empty by design. Its only job is to exist and be enabled by the user, which is
 * what grants MediaSessionManager.getActiveSessions() access to other apps' media
 * sessions (Spotify, the BT A2DP source, etc.). onListenerConnected() firing is a
 * reliable "media reads are now permitted" signal if we ever need it.
 */
class MediaBridgeNotificationListenerService : NotificationListenerService()
