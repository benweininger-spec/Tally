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
    source: t.package ? `BLUETOOTH · ${t.package}` : 'BLUETOOTH A2DP',
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
