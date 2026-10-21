/**
 * Which signature "moment" is playing (boot sweep, OBD-connect sweep). Module-level on
 * purpose: one per process, readable from PulseTach's own loop without React props or
 * re-renders. Whoever starts a moment calls startSweep(); every mounted PulseTach
 * evaluates the matching pure timeline (src/lib/sweep.ts) against `t0` and the first
 * one to see it finish clears it. A face mounted late just sees an expired sweep.
 */
export type SweepKind = 'boot' | 'connect';

export interface ActiveSweep {
  kind: SweepKind;
  /** performance-clock ms when the moment began */
  t0: number;
  /** ring position when it began (filled by the first PulseTach that sees it) */
  from: number | null;
}

let active: ActiveSweep | null = null;

export const nowMs = (): number => {
  const p = (globalThis as any).performance;
  return p && typeof p.now === 'function' ? p.now() : Date.now();
};

export function startSweep(kind: SweepKind): void {
  active = { kind, t0: nowMs(), from: null };
}

export function activeSweep(): ActiveSweep | null {
  return active;
}

export function endSweep(s: ActiveSweep): void {
  if (active === s) active = null;
}
