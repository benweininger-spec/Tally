/**
 * Long-term MPG log: the persisted store, the non-rendering recorder that feeds it, and
 * the hook the ENGINE face reads it through.
 *
 *  • Recorder (`<MpgLogFeed/>`, mounted beside DriveRecorderFeed): every telemetry tick
 *    it diffs `trip.distanceMi` and `trip.fuelGallons` against the last values seen
 *    (either going backwards = the source reset → re-baseline, no delta), adds the
 *    delta to today's bucket and the current trip, and starts a trip on the first
 *    motion / ends it after 10 min below 1 mph. Gallons (MAF-derived) only count while
 *    `obd.connected`; miles without them are stored but not scored.
 *  • Persistence: AsyncStorage (web: localStorage) via settings.ts, debounced 30 s,
 *    immediate on trip end; capped at 400 days / 200 trips. A trip still open in
 *    storage at launch (the app was killed) is closed then.
 *  • SIM mode writes to a separate, never-persisted log seeded with a synthetic 30 days,
 *    so the preview demos the ridgeline without polluting the real history.
 *  • `useMpgLog(selector)` subscribes to THIS store (≤ 1 notify / s), never to the
 *    telemetry stream.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { DashboardData } from './types';
import { useSourceControls, useTelemetryListener } from './DataSourceProvider';
import { loadMpgLogRaw, saveMpgLogRaw, type SourceMode } from './settings';
import {
  addDelta,
  dateKey,
  emptyLog,
  normalizeLog,
  syntheticLog,
  tripEnd,
  tripStart,
  tripUpdate,
  type MpgLog,
} from '../lib/mpgLog';

const TRIP_IDLE_END_MS = 10 * 60_000;
const SAVE_DEBOUNCE_MS = 30_000;
const NOTIFY_EVERY_MS = 1000;
const MAX_TICK_MILES = 1; // a bigger jump in one tick is a reset, not driving
const MAX_TICK_GALLONS = 0.2;

class MpgLogStore {
  private real: MpgLog = emptyLog();
  private sim: MpgLog | null = null;
  private mode: SourceMode = 'sim';
  private loaded = false;
  private lastDist: number | null = null;
  private lastGal: number | null = null;
  private lastMovingAt = 0;
  private lastNotify = 0;
  private pendingNotify = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  version = 0;

  active(): MpgLog {
    if (this.mode === 'sim') {
      if (!this.sim) this.sim = syntheticLog(Date.now());
      return this.sim;
    }
    return this.real;
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  private notify(force = false) {
    const now = Date.now();
    if (!force && now - this.lastNotify < NOTIFY_EVERY_MS) {
      this.pendingNotify = true;
      return;
    }
    this.lastNotify = now;
    this.pendingNotify = false;
    this.version++;
    this.listeners.forEach((l) => l());
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    const log = normalizeLog(await loadMpgLogRaw());
    // a trip still open means the app was killed mid-trip: close it now
    if (log.current) tripEnd(log, Date.now());
    // keep anything recorded during the load window
    for (const d of this.real.days) addDelta(log, d.date, d.miles, d.gallons, d.fuelMiles > 0);
    this.real = log;
    this.notify(true);
  }

  setMode(mode: SourceMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    // the new source has its own odometer / fuel counters: re-baseline
    this.lastDist = null;
    this.lastGal = null;
    this.notify(true);
  }

  private scheduleSave(now = false) {
    if (this.mode !== 'live' || !this.loaded) return; // the sim log is never persisted
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(
      () => {
        this.saveTimer = null;
        void saveMpgLogRaw(this.real);
      },
      now ? 0 : SAVE_DEBOUNCE_MS
    );
  }

  onTick(d: DashboardData) {
    const log = this.active();
    const now = d.system.now;
    const dist = d.trip.distanceMi.status !== 'absent' ? d.trip.distanceMi.value : null;
    const measuring = d.obd.connected && d.trip.fuelGallons.status === 'live' && d.trip.fuelGallons.value != null;
    const gal = measuring ? (d.trip.fuelGallons.value as number) : null;
    const speed = d.motion.speedMph.value ?? 0;

    let dMi = 0;
    if (dist != null) {
      if (this.lastDist != null) {
        const x = dist - this.lastDist;
        if (x > 0 && x < MAX_TICK_MILES) dMi = x;
      }
      this.lastDist = dist; // backwards / jump → just re-baseline
    }
    let dGal = 0;
    if (gal != null) {
      if (this.lastGal != null) {
        const g = gal - this.lastGal;
        if (g > 0 && g < MAX_TICK_GALLONS) dGal = g;
      }
      this.lastGal = gal;
    } else this.lastGal = null;

    let changed = false;
    if (speed >= 1) {
      this.lastMovingAt = now;
      if (!log.current) {
        tripStart(log, now);
        changed = true;
      }
    } else if (log.current && now - this.lastMovingAt > TRIP_IDLE_END_MS) {
      tripEnd(log, this.lastMovingAt);
      this.notify(true);
      this.scheduleSave(true);
      return;
    }
    if (dMi > 0 || dGal > 0) {
      addDelta(log, dateKey(now), dMi, dGal, measuring);
      tripUpdate(log, dMi, dGal, measuring);
      changed = true;
    }
    if (changed) {
      this.notify();
      this.scheduleSave();
    } else if (this.pendingNotify) this.notify();
  }
}

export const mpgLogStore = new MpgLogStore();

/** Invisible feeder: mounted once inside DataSourceProvider; renders nothing. */
export function MpgLogFeed() {
  const { mode } = useSourceControls();
  useEffect(() => {
    void mpgLogStore.load();
  }, []);
  useEffect(() => {
    mpgLogStore.setMode(mode);
  }, [mode]);
  useTelemetryListener((d) => mpgLogStore.onTick(d));
  return null;
}

/**
 * Select from the MPG log. Re-runs the selector only when the store notifies (≤ 1/s)
 * and re-renders only when `isEqual` says the selection changed.
 */
export function useMpgLog<T>(selector: (log: MpgLog, now: number) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const cache = useRef<{ v: number; val: T } | null>(null);
  const sel = useRef(selector);
  sel.current = selector;
  const get = () => {
    const v = mpgLogStore.version;
    const c = cache.current;
    if (c && c.v === v) return c.val;
    const val = sel.current(mpgLogStore.active(), Date.now());
    if (c && isEqual(c.val, val)) {
      c.v = v;
      return c.val;
    }
    cache.current = { v, val };
    return val;
  };
  return useSyncExternalStore(mpgLogStore.subscribe, get, get);
}
