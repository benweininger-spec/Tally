/**
 * Persisted, editable dock configuration. The Dock renders these tiles between the
 * static CarPlay tile (left) and the pinned SET tile (right). The settings sheet
 * edits them (label + launch URL, reorder, add/remove, reset).
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { loadDock, saveDock } from '../data/settings';
import { DEFAULT_DOCK, MAX_DOCK_TILES, type DockTile } from './defaults';

interface DockCtx {
  tiles: DockTile[];
  setTiles: (tiles: DockTile[]) => void;
  reset: () => void;
}

const Ctx = createContext<DockCtx | null>(null);

export function DockProvider({ children }: { children: React.ReactNode }) {
  const [tiles, setTilesState] = useState<DockTile[]>(DEFAULT_DOCK);

  useEffect(() => {
    let alive = true;
    loadDock().then((saved) => {
      // null = never saved (keep defaults); [] = user intentionally cleared (honor it)
      if (alive && saved) setTilesState(saved);
    });
    return () => {
      alive = false;
    };
  }, []);

  const setTiles = (next: DockTile[]) => {
    const capped = next.slice(0, MAX_DOCK_TILES);
    setTilesState(capped);
    void saveDock(capped);
  };
  const reset = () => setTiles(DEFAULT_DOCK);

  return <Ctx.Provider value={{ tiles, setTiles, reset }}>{children}</Ctx.Provider>;
}

export function useDock(): DockCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDock must be used inside <DockProvider>');
  return ctx;
}
