/**
 * Reduced-motion preference (SET → MOTION), persisted. Gates the decorative moments —
 * the cold-start sweep, the OBD-connect sweep — never the live instruments themselves.
 * `reduced` is null until the stored value has loaded, so the boot sweep can wait for
 * it instead of starting and then being cancelled.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadReducedMotion, saveReducedMotion } from '../data/settings';

interface MotionCtx {
  reduced: boolean | null;
  setReduced: (r: boolean) => void;
}

const Ctx = createContext<MotionCtx>({ reduced: false, setReduced: () => {} });

export function MotionPrefProvider({ children }: { children: React.ReactNode }) {
  const [reduced, setState] = useState<boolean | null>(null);
  const userSet = useRef(false);

  useEffect(() => {
    let alive = true;
    loadReducedMotion().then((r) => {
      if (alive && !userSet.current) setState(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  const setReduced = useCallback((r: boolean) => {
    userSet.current = true;
    setState(r);
    void saveReducedMotion(r);
  }, []);

  const value = useMemo(() => ({ reduced, setReduced }), [reduced, setReduced]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useMotionPref = () => useContext(Ctx);
