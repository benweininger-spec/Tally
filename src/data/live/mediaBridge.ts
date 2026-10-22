/**
 * Tier B — now-playing + transport via the local Kotlin module `MediaBridge`
 * (modules/media-bridge), which reads MediaSessionManager behind Notification
 * Listener access. Resolved by name at runtime, so if the module isn't compiled
 * into the current dev client (or access isn't granted), this degrades to
 * "absent" instead of crashing. Native only — reached through LiveDataSource.
 */
import { requireNativeModule } from 'expo';
import type { NowPlaying } from '../types';

interface NativeTrack {
  title?: string;
  artist?: string;
  album?: string;
  artUri?: string | null;
  durationMs?: number;
  positionMs?: number;
  playing?: boolean;
  package?: string;
}

interface MediaBridgeNative {
  hasNotificationAccess(): boolean;
  getNowPlaying(): Promise<NativeTrack | null>;
  play(): Promise<void>;
  pause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  openListenerSettings(): void;
  addListener(event: string, cb: (payload: any) => void): { remove: () => void };
}

/** Friendly source name for the now-playing card. The FM/AM tuner on this Microntek
 *  unit publishes its MediaSession through the stock Telenav launcher (FACT, on-device),
 *  so that package means "the radio", not Bluetooth. Unknown packages fall back to a
 *  trimmed name rather than the raw id. */
const SOURCE_NAMES: Record<string, string> = {
  'com.telenav.scout.launcher': 'FM RADIO',
  'com.microntek.radio': 'FM RADIO',
  'com.microntek.btmusic': 'BLUETOOTH A2DP',
  'com.android.bluetooth': 'BLUETOOTH A2DP',
  'com.spotify.music': 'SPOTIFY',
  'com.google.android.apps.youtube.music': 'YOUTUBE MUSIC',
  'com.apple.android.music': 'APPLE MUSIC',
  'com.pandora.android': 'PANDORA',
  'com.audible.application': 'AUDIBLE',
  'au.com.shiftyjelly.pocketcasts': 'POCKET CASTS',
  'com.zjinnova.zlink': 'CARPLAY',
};
export function sourceLabel(pkg?: string | null): string {
  if (!pkg) return 'BLUETOOTH A2DP';
  if (SOURCE_NAMES[pkg]) return SOURCE_NAMES[pkg];
  const tail = pkg.split('.').filter((x) => !['com','android','org','net','app','apps','free'].includes(x)).pop() ?? pkg;
  return tail.toUpperCase();
}

let native: MediaBridgeNative | null | undefined;
function mod(): MediaBridgeNative | null {
  if (native === undefined) {
    try {
      native = requireNativeModule('MediaBridge') as MediaBridgeNative;
    } catch {
      native = null; // module not built into this dev client
    }
  }
  return native;
}

function toNowPlaying(t: NativeTrack): NowPlaying {
  return {
    title: t.title || 'Unknown',
    artist: t.artist || '',
    album: t.album || '',
    artUri: t.artUri ?? null,
    isPlaying: t.playing ?? false,
    positionMs: t.positionMs ?? 0,
    durationMs: t.durationMs ?? 0,
    source: sourceLabel(t.package),
  };
}

export interface MediaState {
  /** native module compiled into this build */
  available: boolean;
  /** notification-listener access granted by the user */
  hasAccess: boolean;
  nowPlaying: NowPlaying | null;
}

export class MediaBridgeProvider {
  private subs: { remove: () => void }[] = [];
  private current: NowPlaying | null = null;

  start(): void {
    const m = mod();
    if (!m) return;
    this.subs.push(
      m.addListener('onTrackChanged', (t: NativeTrack) => {
        this.current = toNowPlaying(t);
      })
    );
    this.subs.push(
      m.addListener('onPlaybackChanged', (p: { playing: boolean; positionMs: number }) => {
        if (this.current) {
          this.current = { ...this.current, isPlaying: p.playing, positionMs: p.positionMs };
        }
      })
    );
    void this.refresh();
  }

  stop(): void {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
  }

  async refresh(): Promise<void> {
    const m = mod();
    if (!m || !this.hasAccess()) return;
    try {
      const t = await m.getNowPlaying();
      this.current = t ? toNowPlaying(t) : null;
    } catch {
      /* leave prior */
    }
  }

  hasAccess(): boolean {
    const m = mod();
    if (!m) return false;
    try {
      return m.hasNotificationAccess();
    } catch {
      return false;
    }
  }

  openSettings(): void {
    try {
      mod()?.openListenerSettings();
    } catch {
      /* settings activity may be missing on odd ROMs */
    }
  }

  play() {
    void mod()?.play();
  }
  pause() {
    void mod()?.pause();
  }
  next() {
    void mod()?.next();
  }
  previous() {
    void mod()?.previous();
  }

  getSnapshot(): MediaState {
    return { available: mod() !== null, hasAccess: this.hasAccess(), nowPlaying: this.current };
  }
}
