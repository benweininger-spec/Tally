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
  /** MediaSession tag — on this unit it's what tells the launcher's BT / radio / USB apart */
  tag?: string;
}

interface MediaBridgeNative {
  hasNotificationAccess(): boolean;
  getNowPlaying(): Promise<NativeTrack | null>;
  play(): Promise<void>;
  pause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  toggle(): Promise<void>;
  getSessions(): Promise<NativeTrack[]>;
  getRadio(): Promise<NativeTrack | null>;
  radioTransport(cmd: 'play' | 'pause' | 'next' | 'previous' | 'toggle'): Promise<void>;
  getRadioPresets?(): Promise<RadioPreset[]>;
  radioPlayPreset?(id: number): Promise<void>;
  radioFavorite?(): Promise<boolean>;
  openListenerSettings(): void;
  addListener(event: string, cb: (payload: any) => void): { remove: () => void };
}

/** Friendly source name for the now-playing card. The stock Telenav launcher owns THREE
 *  sessions on this unit (FACT, 2026-10-23) — the phone's Bluetooth music, the FM tuner and
 *  USB — so for that package the session tag decides, not the package. Unknown packages
 *  fall back to a trimmed name rather than the raw id. */
const SOURCE_NAMES: Record<string, string> = {
  'com.telenav.scout.launcher': 'HEAD UNIT',
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
export function sourceLabel(pkg?: string | null, tag?: string | null): string {
  const tg = (tag ?? '').toLowerCase();
  if (tg.includes('bluetooth')) return 'BLUETOOTH';
  if (tg.includes('radio')) return 'FM RADIO';
  if (tg.includes('localmedia')) return 'USB / LOCAL';
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
    source: sourceLabel(t.package, t.tag),
  };
}

/** One of the tuner's favourites (its session queue) — logo when the unit provides one. */
export interface RadioPreset {
  id: number;
  title: string;
  subtitle: string;
  art: string | null;
  active: boolean;
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
  private poll: ReturnType<typeof setInterval> | null = null;

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
    // the native side follows ONE session's callbacks; a different session starting (phone
    // music resuming while the radio was shown, an app taking over) isn't an event, so
    // re-read every 3 s — a cheap binder call, and paused with the app in the background
    this.poll = setInterval(() => void this.refresh(), 3000);
  }

  stop(): void {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
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
  toggle() {
    void mod()?.toggle();
  }
  /** The head unit's FM/AM tuner session (FACT: published by the stock launcher). */
  async radio(): Promise<NowPlaying | null> {
    const m = mod();
    if (!m || !this.hasAccess()) return null;
    try {
      const t = await m.getRadio();
      return t ? toNowPlaying(t) : null;
    } catch {
      return null;
    }
  }
  radioSeek(dir: 1 | -1) {
    void mod()?.radioTransport(dir > 0 ? 'next' : 'previous');
  }
  /** play/pause the tuner session — PLAY is how the unit switches its audio to FM */
  radioToggle() {
    void mod()?.radioTransport('toggle');
  }
  async radioPresets(): Promise<RadioPreset[]> {
    const m = mod();
    if (!m?.getRadioPresets || !this.hasAccess()) return [];
    try {
      return (await m.getRadioPresets()) ?? [];
    } catch {
      return [];
    }
  }
  radioPlayPreset(id: number) {
    void mod()?.radioPlayPreset?.(id);
  }
  async radioFavorite(): Promise<boolean> {
    try {
      return (await mod()?.radioFavorite?.()) ?? false;
    } catch {
      return false;
    }
  }

  getSnapshot(): MediaState {
    return { available: mod() !== null, hasAccess: this.hasAccess(), nowPlaying: this.current };
  }
}
