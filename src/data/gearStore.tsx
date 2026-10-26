/**
 * Gear + park tracker (pure logic in src/lib/gear.ts), fed from telemetry by a
 * non-rendering <GearFeed/> like the drive recorder. Notifies only when what's SHOWN
 * changes (the gear letter, parked, the summary prompt) — a few times per drive, not
 * per tick. `useGear(selector)` subscribes here, never to the telemetry stream.
 */
import { useRef, useSyncExternalStore } from 'react';
import { useTelemetryListener } from './DataSourceProvider';
import { has } from './types';
import { createGearState, gearStep, summaryPromptDue, type GearShown } from '../lib/gear';

export interface GearView {
  shown: GearShown;
  parked: boolean;
  parkSeq: number;
  /** parked, or stopped long enough to offer the trip summary */
  prompt: boolean;
}

class GearStore {
  private st = createGearState();
  private view: GearView = { shown: '—', parked: false, parkSeq: 0, prompt: false };
  private listeners = new Set<() => void>();

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };
  get = () => this.view;

  feed(now: number, mph: number | null, rpm: number | null, reverse: boolean | null) {
    gearStep(this.st, { now, mph, rpm, reverse });
    const v = this.view;
    const prompt = summaryPromptDue(this.st, now);
    if (v.shown !== this.st.shown || v.parked !== this.st.parked || v.parkSeq !== this.st.parkSeq || v.prompt !== prompt) {
      this.view = { shown: this.st.shown, parked: this.st.parked, parkSeq: this.st.parkSeq, prompt };
      this.listeners.forEach((l) => l());
    }
  }
}

export const gearStore = new GearStore();

/** Invisible feeder (renders nothing, never re-renders). */
export function GearFeed() {
  useTelemetryListener((d) => {
    // ECU speed shares rpm's timing (GPS lags ~1 s), so prefer it for the ratio
    const mph = has(d.obd.ecuSpeedMph) ? d.obd.ecuSpeedMph.value : has(d.motion.speedMph) ? d.motion.speedMph.value : null;
    const rpm = d.obd.connected && has(d.obd.rpm) ? d.obd.rpm.value : null;
    const reverse = has(d.body.reverseGear) ? d.body.reverseGear.value : null;
    gearStore.feed(d.system.now, mph, rpm, reverse);
  });
  return null;
}

export function useGear<T>(selector: (v: GearView) => T): T {
  const sel = useRef(selector);
  sel.current = selector;
  return useSyncExternalStore(gearStore.subscribe, () => sel.current(gearStore.get()), () => sel.current(gearStore.get()));
}
