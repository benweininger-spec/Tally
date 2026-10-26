/**
 * Logbook store: fill-ups, service history and the odometer estimate (pure model in
 * src/lib/logbook.ts), persisted like the MPG log. Fed by the MPG recorder's own
 * mile / gallon deltas (mpgLogStore calls `usage`), so the two never disagree.
 *
 * SIM mode gets a separate, never-persisted demo logbook (a fill-up three days ago, an
 * oil change coming due) so the preview shows every state without touching real data.
 * `useLogbook(selector)` subscribes here (≤ 1 notify / s), never to telemetry.
 */
import { useRef, useSyncExternalStore } from 'react';
import { loadLogbookRaw, saveLogbookRaw, type SourceMode } from './settings';
import {
  addFill,
  addService,
  emptyLogbook,
  normalizeLogbook,
  onUsage,
  removeFill,
  removeService,
  setOdometer,
  type FillInput,
  type Logbook,
  type ServiceInput,
} from '../lib/logbook';

const SAVE_DEBOUNCE_MS = 30_000;
const NOTIFY_EVERY_MS = 1000;
const DAY = 86_400_000;

function demoLogbook(now: number): Logbook {
  // odometer ≈ 84,210 today: a 79,400 reading 40 days ago + the miles logged since
  const lb = emptyLogbook();
  addService(lb, { at: now - 300 * DAY, odometer: 75_400, types: ['oil', 'rotate'], note: 'Toyota dealer, 0W-20', cost: 89 });
  addService(lb, { at: now - 300 * DAY, odometer: 75_400, types: ['airFilter', 'cabinFilter'], note: 'did it myself', cost: 38 });
  addService(lb, { at: now - 200 * DAY, odometer: 79_350, types: ['rotate'], note: '', cost: null });
  setOdometer(lb, 79_400, now - 40 * DAY);
  onUsage(lb, 4_648, 0);
  addFill(lb, { at: now - 3 * DAY, gallons: 15.2, full: true, pricePerGal: 4.59, odometer: null });
  onUsage(lb, 162, 8.1); // since the fill: 13.0 gal left, rotation due in ~140 mi
  return lb;
}

class LogbookStore {
  private real: Logbook = emptyLogbook();
  private sim: Logbook | null = null;
  private mode: SourceMode = 'sim';
  private loaded = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastNotify = 0;
  private pending = false;
  private listeners = new Set<() => void>();
  version = 0;

  active(): Logbook {
    if (this.mode === 'sim') {
      if (!this.sim) this.sim = demoLogbook(Date.now());
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
      this.pending = true;
      return;
    }
    this.lastNotify = now;
    this.pending = false;
    this.version++;
    this.listeners.forEach((l) => l());
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    const lb = normalizeLogbook(await loadLogbookRaw());
    // keep usage that arrived during the load window
    onUsage(lb, this.real.milesLogged, this.real.usedSinceFill);
    this.real = lb;
    this.notify(true);
  }

  setMode(mode: SourceMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.notify(true);
  }

  private save(now = false) {
    if (this.mode !== 'live' || !this.loaded) return; // the sim logbook is never persisted
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(
      () => {
        this.saveTimer = null;
        void saveLogbookRaw(this.real);
      },
      now ? 0 : SAVE_DEBOUNCE_MS
    );
  }

  /** Called by the MPG recorder with each tick's miles + MAF gallons. */
  usage(dMiles: number, dGal: number) {
    if (!(dMiles > 0) && !(dGal > 0)) {
      if (this.pending) this.notify();
      return;
    }
    onUsage(this.active(), dMiles, dGal);
    this.notify();
    this.save();
  }

  // ---- edits from the UI (saved immediately) ----------------------------------
  fill(f: FillInput) {
    addFill(this.active(), f);
    this.notify(true);
    this.save(true);
  }
  deleteFill(id: string) {
    removeFill(this.active(), id);
    this.notify(true);
    this.save(true);
  }
  service(s: ServiceInput) {
    addService(this.active(), s);
    this.notify(true);
    this.save(true);
  }
  deleteService(id: string) {
    removeService(this.active(), id);
    this.notify(true);
    this.save(true);
  }
  odometer(miles: number) {
    setOdometer(this.active(), miles, Date.now());
    this.notify(true);
    this.save(true);
  }
}

export const logbookStore = new LogbookStore();

/** Select from the logbook; re-renders only when `isEqual` says the selection changed. */
export function useLogbook<T>(selector: (lb: Logbook, now: number) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const cache = useRef<{ v: number; val: T } | null>(null);
  const sel = useRef(selector);
  sel.current = selector;
  const get = () => {
    const v = logbookStore.version;
    const c = cache.current;
    if (c && c.v === v) return c.val;
    const val = sel.current(logbookStore.active(), Date.now());
    if (c && isEqual(c.val, val)) {
      c.v = v;
      return c.val;
    }
    cache.current = { v, val };
    return val;
  };
  return useSyncExternalStore(logbookStore.subscribe, get, get);
}
