/**
 * Persisted, editable dock configuration. The Dock renders these tiles between the
 * static CarPlay tile (left) and the pinned APPS + SET tiles (right). The app drawer
 * pins/unpins apps (long-press); the settings sheet edits labels, reorders, removes,
 * adds deep-link tiles, and resets.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadDock, saveDock } from '../data/settings';
import { DEFAULT_DOCK, MAX_DOCK_TILES, dockLabel, findPinned, normalizeDock, type DockTile } from './defaults';

export type PinResult = 'pinned' | 'unpinned' | 'full';

interface DockCtx {
  tiles: DockTile[];
  setTiles: (tiles: DockTile[]) => void;
  reset: () => void;
  /** pin an installed app to the dock, or unpin it if it's already there */
  togglePin: (app: { package: string; activity?: string; label: string }) => PinResult;
}

const Ctx = createContext<DockCtx | null>(null);

export function DockProvider({ children }: { children: React.ReactNode }) {
  const [tiles, setTilesState] = useState<DockTile[]>(DEFAULT_DOCK);
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;

  useEffect(() => {
    let alive = true;
    loadDock().then((saved) => {
      // null = never saved (keep defaults); [] = user intentionally cleared (honor it)
      const tiles = normalizeDock(saved);
      if (alive && tiles) setTilesState(tiles);
    });
    return () => {
      alive = false;
    };
  }, []);

  const setTiles = useCallback((next: DockTile[]) => {
    const capped = next.slice(0, MAX_DOCK_TILES);
    tilesRef.current = capped;
    setTilesState(capped);
    void saveDock(capped);
  }, []);
  const reset = useCallback(() => setTiles(DEFAULT_DOCK), [setTiles]);

  const togglePin = useCallback<DockCtx['togglePin']>(
    (app) => {
      const cur = tilesRef.current;
      const i = findPinned(cur, app.package, app.activity);
      if (i >= 0) {
        setTiles(cur.filter((_, idx) => idx !== i));
        return 'unpinned';
      }
      if (cur.length >= MAX_DOCK_TILES) return 'full';
      setTiles([
        ...cur,
        {
          id: `app-${app.package}-${Date.now()}`,
          label: dockLabel(app.label),
          package: app.package,
          activity: app.activity,
        },
      ]);
      return 'pinned';
    },
    [setTiles]
  );

  const value = useMemo(() => ({ tiles, setTiles, reset, togglePin }), [tiles, setTiles, reset, togglePin]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDock(): DockCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDock must be used inside <DockProvider>');
  return ctx;
}
