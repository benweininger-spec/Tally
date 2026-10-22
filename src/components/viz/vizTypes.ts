/**
 * The contract between a Signal Library instrument and its renderer. An instrument
 * declares STYLED LAYERS once (color, width, glow…) and then, from its own loop,
 * pushes only the changing SVG path strings (+ an optional rotation) through a
 * channel. The renderer — Skia on the unit (shared values, zero React work per frame)
 * or SVG on web / as the fallback — subscribes to the channel.
 */

export interface VizLayer {
  id: string;
  /** static path; omit to take `paths[id]` from the channel each frame */
  d?: string;
  stroke?: string;
  fill?: string;
  width?: number;
  opacity?: number;
  dash?: [number, number];
  /** Signal Library glow: three strokes, ×5 @13%, ×2.2 @30%, ×1 @100% — no blur */
  glow?: boolean;
  /** rotate with the channel's `rotation` (radians) about the surface origin */
  spin?: boolean;
}

export interface VizFrame {
  paths: Record<string, string>;
  rotation: number;
}

export interface VizChannel {
  set(paths: Record<string, string>, rotation?: number): void;
  get(): VizFrame;
  subscribe(cb: () => void): () => void;
}

export function createVizChannel(): VizChannel {
  let frame: VizFrame = { paths: {}, rotation: 0 };
  const subs = new Set<() => void>();
  return {
    set(paths, rotation) {
      frame = { paths, rotation: rotation ?? frame.rotation };
      subs.forEach((cb) => cb());
    },
    get: () => frame,
    subscribe(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}

export interface VizSurfaceProps {
  width: number;
  height: number;
  layers: VizLayer[];
  channel: VizChannel;
  /** rotation centre for `spin` layers */
  origin?: [number, number];
}

/** a valid, invisible path (Skia throws on '' / malformed strings) */
export const EMPTY_PATH = 'M 0 0';
export const safePath = (d: string | undefined) => (d && d.length > 4 && !/NaN|Infinity|undefined/.test(d) ? d : EMPTY_PATH);

/** circle as an SVG path (dots: beam, pen tip) */
export const dot = (x: number, y: number, r: number) =>
  Number.isFinite(x) && Number.isFinite(y)
    ? `M ${(x - r).toFixed(1)} ${y.toFixed(1)} A ${r} ${r} 0 1 0 ${(x + r).toFixed(1)} ${y.toFixed(1)} A ${r} ${r} 0 1 0 ${(x - r).toFixed(1)} ${y.toFixed(1)} Z`
    : EMPTY_PATH;
