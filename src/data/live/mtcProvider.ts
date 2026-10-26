/**
 * Microntek head-unit events (Tier D-ish, but it's a public broadcast, not CAN):
 * headlights, ignition (ACC), power, OBD state, periodic CAN sync. Backed by the
 * local Kotlin module `modules/mtc-events`; degrades to "unknown" (null) if the
 * module isn't compiled in or the unit isn't a Microntek board.
 *
 * FACT (2026-10-21, Dasaita Vivid13 / MTCHS_HA4Z): flipping the headlights emits
 *   action=com.microntek.report.event  extras { type: "headlight", value: true|false }
 * and the raw MCU form  com.microntek.biglight.state { state: int }.
 */
import { requireNativeModule } from 'expo';

interface MtcNative {
  last(action: string): Record<string, unknown> | null;
  radioCommand?(cmd: 'seek_up' | 'seek_down' | 'tune_up' | 'tune_down'): boolean;
  radioSetFreq?(hz: number): boolean;
  radioRequestState?(): boolean;
  addListener(event: string, cb: (p: MtcEvent) => void): { remove: () => void };
}
export interface MtcEvent {
  action: string;
  extras: Record<string, unknown>;
  at: number;
}

let native: MtcNative | null | undefined;
function mod(): MtcNative | null {
  if (native === undefined) {
    try {
      native = requireNativeModule('MtcEvents') as MtcNative;
    } catch {
      native = null;
    }
  }
  return native;
}

export interface MtcState {
  available: boolean;
  /** true = headlights on. null = never heard from the unit. */
  headlights: boolean | null;
  headlightsAt: number | null;
  /** ignition/ACC if the unit reports it; null = unknown */
  acc: boolean | null;
  /** head-unit 12V input via CarManager "battery" (tenths→volts); null = unknown */
  voltage: number | null;
  voltageAt: number | null;
  handbrake: boolean | null;
  /** REVERSE (the camera trigger), from report.event type "backview"; null = never heard */
  reverse: boolean | null;
  reverseAt: number | null;
  /** the factory radio service's state report: Hz, band limits + step (null until heard) */
  radio: { freqHz: number; minHz: number; maxHz: number; stepHz: number; fm: boolean; at: number } | null;
  /** most recent raw event per action, for diagnostics */
  lastByAction: Record<string, Record<string, unknown>>;
}

const truthy = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';

export class MtcProvider {
  private sub: { remove: () => void } | null = null;
  private state: MtcState = { available: false, headlights: null, headlightsAt: null, acc: null, voltage: null, voltageAt: null, handbrake: null, reverse: null, reverseAt: null, radio: null, lastByAction: {} };

  start(): void {
    const m = mod();
    if (!m) return;
    this.state.available = true;
    // seed from anything the module already saw
    const seed = m.last('com.microntek.report.event');
    if (seed && seed.type === 'headlight') this.applyHeadlight(seed.value, Date.now());
    if (seed && seed.type === 'backview') this.applyReverse(seed.value, Date.now());
    const bat = m.last('carmanager.battery');
    if (bat && Number(bat.value) > 0) { this.state.voltage = Number(bat.value) / 10; this.state.voltageAt = Date.now(); }
    this.sub = m.addListener('onMtcEvent', (e) => this.onEvent(e));
  }

  stop(): void {
    this.sub?.remove();
    this.sub = null;
  }

  getSnapshot(): MtcState {
    return this.state;
  }

  /** Seek / tune on the MCU (whitelisted in Kotlin). false = not available on this build/unit. */
  radioCommand(cmd: 'seek_up' | 'seek_down' | 'tune_up' | 'tune_down'): boolean {
    try {
      return !!mod()?.radioCommand?.(cmd);
    } catch {
      return false;
    }
  }

  radioSetFreq(hz: number): boolean {
    try {
      return !!mod()?.radioSetFreq?.(Math.round(hz));
    } catch {
      return false;
    }
  }

  radioRequestState(): void {
    try {
      mod()?.radioRequestState?.();
    } catch {
      /* optional */
    }
  }

  private applyHeadlight(v: unknown, at: number) {
    this.state.headlights = truthy(v);
    this.state.headlightsAt = at;
  }

  /**
   * Reverse = the MCU's "backview" state (from the decompiled MicrontekServer: it broadcasts
   * REPORT_EVENT {type: "backview", value} exactly like the verified headlight event).
   */
  private applyReverse(v: unknown, at: number) {
    this.state.reverse = truthy(v);
    this.state.reverseAt = at;
  }

  private onEvent(e: MtcEvent) {
    this.state.lastByAction[e.action] = e.extras;
    switch (e.action) {
      case 'com.microntek.report.event':
        if (e.extras.type === 'headlight') this.applyHeadlight(e.extras.value, e.at);
        if (e.extras.type === 'backview') this.applyReverse(e.extras.value, e.at);
        break;
      case 'com.microntek.biglight.state':
      case 'com.microntek.carlight':
        if ('state' in e.extras) this.applyHeadlight(e.extras.state, e.at);
        break;
      case 'carmanager.battery': {
        const v = Number(e.extras.value);
        if (Number.isFinite(v) && v > 0) { this.state.voltage = v / 10; this.state.voltageAt = e.at; }
        break;
      }
      case 'com.microntek.radio.report':
        if (e.extras.type === 'content') {
          // freq = (band << 28) | Hz
          const raw = Number(e.extras.freq);
          const hz = Number.isFinite(raw) ? raw & 0x0fffffff : NaN;
          const step = Number(e.extras.freqstep);
          if (hz > 0) {
            this.state.radio = {
              freqHz: hz,
              minHz: Number(e.extras.freqmin) || 87_500_000,
              maxHz: Number(e.extras.freqmax) || 107_900_000,
              stepHz: step > 0 ? step : 200_000,
              fm: e.extras.isfm !== false,
              at: e.at,
            };
          }
        }
        break;
      case 'carmanager.handbrake':
        this.state.handbrake = truthy(e.extras.value);
        break;
      case 'com.microntek.acc':
      case 'com.microntek.systemacc': {
        const v = e.extras.state ?? e.extras.acc ?? e.extras.value;
        if (v !== undefined) this.state.acc = truthy(v);
        break;
      }
    }
  }
}
