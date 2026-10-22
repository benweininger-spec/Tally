/**
 * Wires a DataSource into React. Components subscribe to the telemetry stream with
 * a SELECTOR (useTelemetry) and re-render only when their own slice changes — the
 * ~30fps tick no longer re-renders the whole tree (that was the 100%-jank cause;
 * see the audit). They never know whether the bytes came from a simulator, GPS, or
 * an OBD dongle.
 *
 * Two channels, deliberately split:
 *   • ControlsContext — slow, stable: the active source + mode + live controls.
 *     Its value identity only changes on a source/mode swap, so consuming it does
 *     NOT couple a component to the per-frame stream.
 *   • Telemetry store — fast: a tiny external store (useSyncExternalStore) that
 *     always holds the latest snapshot and survives source swaps. useTelemetry
 *     selects a slice and bails out via an equality check, so a widget wakes only
 *     when the value it cares about actually changes.
 *
 * The active source is chosen from a persisted SourceMode ('sim' | 'live') and can
 * be flipped at runtime from the settings sheet — no rebuild. LiveDataSource is
 * dynamic-imported only on native + live, so the web design preview never bundles
 * a native module and keeps running in sim exactly as before.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Platform } from 'react-native';
import type { DashboardData, DataSource, History } from './types';
import { SimulatedDataSource } from './SimulatedDataSource';
import { loadSourceMode, saveSourceMode, type SourceMode } from './settings';
import type { LiveControls } from './live/LiveDataSource';

/**
 * Stable external store: always reflects the latest snapshot and survives source
 * swaps (its identity never changes, so subscriptions don't need re-wiring).
 */
interface TelemetryStore {
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => DashboardData;
  set: (d: DashboardData) => void;
}

function createStore(initial: DashboardData): TelemetryStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getSnapshot() {
      return current;
    },
    set(d) {
      current = d;
      listeners.forEach((l) => l());
    },
  };
}

interface Controls {
  source: DataSource;
  mode: SourceMode;
  setMode: (mode: SourceMode) => void;
  /** present only when the live source is active (drives the settings sheet) */
  live: LiveControls | null;
  /** true while a switch to live mode is in flight (source not yet attached) */
  livePending: boolean;
}

const StoreContext = createContext<TelemetryStore | null>(null);
const ControlsContext = createContext<Controls | null>(null);

export function DataSourceProvider({
  children,
  source: override,
}: {
  children: React.ReactNode;
  /** force a specific source (tests / storybook); skips the mode machinery */
  source?: DataSource;
}) {
  const sourceRef = useRef<DataSource>(override ?? new SimulatedDataSource());
  const unsubRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const storeRef = useRef<TelemetryStore | null>(null);
  if (!storeRef.current) storeRef.current = createStore(sourceRef.current.getSnapshot());
  const store = storeRef.current;

  const [mode, setModeState] = useState<SourceMode>('sim');
  const [live, setLive] = useState<LiveControls | null>(null);
  const [livePending, setLivePending] = useState(false);
  // bumped on every attach so `controls` (and useDataSource/useHistory) always
  // resolve to the CURRENT source, even when the mode value is unchanged.
  const [srcVersion, setSrcVersion] = useState(0);

  // detach the current source and attach a new one (re-subscribe + restart)
  const attach = useCallback(
    (src: DataSource) => {
      unsubRef.current?.();
      sourceRef.current.stop();
      sourceRef.current = src;
      store.set(src.getSnapshot());
      unsubRef.current = src.subscribe((d) => store.set(d));
      src.start();
      setSrcVersion((v) => v + 1);
    },
    [store]
  );

  const switchTo = useCallback(
    async (next: SourceMode) => {
      if (next === 'live' && Platform.OS !== 'web') {
        setLivePending(true); // tells dependents (e.g. the radio tuner) live is incoming
        try {
          const { LiveDataSource } = await import('./live/LiveDataSource');
          if (!mountedRef.current) return;
          const src = new LiveDataSource();
          await src.hydrate();
          if (!mountedRef.current) {
            src.stop();
            return;
          }
          attach(src);
          setLive(src as unknown as LiveControls);
          setModeState('live');
          setLivePending(false);
          await saveSourceMode('live'); // persist only after the live source is up
          return;
        } catch (e) {
          // fall back to sim if the live stack fails to load (e.g. missing deps)
          console.warn('[DataSource] live mode unavailable, staying on sim:', e);
        }
      }
      if (!mountedRef.current) return;
      attach(new SimulatedDataSource());
      setLive(null);
      setLivePending(false);
      setModeState('sim');
      await saveSourceMode('sim'); // persisted mode reflects the source actually running
    },
    [attach]
  );

  useEffect(() => {
    mountedRef.current = true;
    const teardown = () => {
      mountedRef.current = false;
      unsubRef.current?.();
      sourceRef.current.stop(); // stops whatever source is attached at unmount time
    };
    if (override) {
      attach(override);
      return teardown;
    }
    // first paint on sim immediately, then honor the persisted mode
    attach(sourceRef.current);
    (async () => {
      const persisted = await loadSourceMode();
      if (!mountedRef.current) return;
      if (persisted === 'live' && Platform.OS !== 'web') await switchTo('live');
      else setModeState(persisted === 'live' ? 'sim' : persisted); // live unsupported on web → sim
    })();
    return teardown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMode = useCallback(
    (m: SourceMode) => {
      void switchTo(m);
    },
    [switchTo]
  );

  const controls = useMemo<Controls>(
    () => ({ source: sourceRef.current, mode, setMode, live, livePending }),
    [mode, setMode, live, livePending, srcVersion]
  );

  return (
    <StoreContext.Provider value={store}>
      <ControlsContext.Provider value={controls}>{children}</ControlsContext.Provider>
    </StoreContext.Provider>
  );
}

function useStore(): TelemetryStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('hook must be used inside <DataSourceProvider>');
  return s;
}

function useControls(): Controls {
  const c = useContext(ControlsContext);
  if (!c) throw new Error('hook must be used inside <DataSourceProvider>');
  return c;
}

/** Shallow object equality — pass to useTelemetry when a selector returns an object. */
export function shallowEqual(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

/**
 * Subscribe to a SLICE of the telemetry stream. Re-renders only when the selected
 * value changes by `isEqual` (Object.is by default). Select primitives, or an
 * object slice with `shallowEqual`. This is the hook every hot widget should use.
 */
export function useTelemetry<T>(
  selector: (d: DashboardData) => T,
  isEqual: (a: T, b: T) => boolean = Object.is
): T {
  const store = useStore();
  const last = useRef<{ has: boolean; val: T }>({ has: false, val: undefined as unknown as T });
  // getSnapshot MUST return a cached identity when the value is unchanged, or
  // useSyncExternalStore loops forever. We cache the last selected value and
  // return it when isEqual holds, so React can bail out of the re-render.
  const getSel = () => {
    const next = selector(store.getSnapshot());
    const prev = last.current;
    if (prev.has && isEqual(prev.val, next)) return prev.val;
    last.current = { has: true, val: next };
    return next;
  };
  return useSyncExternalStore(store.subscribe, getSel, getSel);
}

/**
 * Run `cb` on every telemetry tick WITHOUT re-rendering — for recorders that accumulate
 * history (g envelope, speed record) regardless of which face is on screen.
 */
export function useTelemetryListener(cb: (d: DashboardData) => void): void {
  const store = useStore();
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => store.subscribe(() => ref.current(store.getSnapshot())), [store]);
}

/**
 * Full snapshot — RE-RENDERS EVERY TICK. Prefer useTelemetry(selector) in any widget
 * that stays mounted while data streams. Kept for completeness / rare full reads.
 */
export function useDashboard(): DashboardData {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Live history buffers for the signature element. Read fresh (not reactive). */
export function useHistory(): History {
  return useControls().source.getHistory();
}

export function useDataSource(): DataSource {
  return useControls().source;
}

/** Source-mode control + live-tier controls, for the settings sheet. */
export function useSourceControls(): {
  mode: SourceMode;
  setMode: (m: SourceMode) => void;
  live: LiveControls | null;
  livePending: boolean;
} {
  const { mode, setMode, live, livePending } = useControls();
  return { mode, setMode, live, livePending };
}
