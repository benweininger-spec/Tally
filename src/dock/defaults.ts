/**
 * Dock tile model + defaults. Pure (no imports) so settings + UI can share it.
 *
 * A tile launches an installed app by PACKAGE (picked from the app drawer — long-press
 * any app to pin it). `url` is the fallback for deep links (geo:, waze://…) and for
 * tiles saved before the drawer existed; tapping tries the package first, then the URL.
 * CarPlay (static), APPS (drawer) and SET (settings) are NOT in this list — they're
 * pinned tiles rendered by the Dock so they can't be removed.
 */
export interface DockTile {
  id: string;
  label: string;
  /** installed app to launch; absent = URL-only tile */
  package?: string;
  /** explicit launcher activity (multi-activity apps like ZLink) */
  activity?: string;
  /** deep-link / scheme fallback; empty = no-op placeholder */
  url?: string;
}

export const DEFAULT_DOCK: DockTile[] = [
  { id: 'maps', label: 'MAPS', package: 'com.google.android.apps.maps', url: 'geo:0,0' },
  { id: 'waze', label: 'WAZE', package: 'com.waze', url: 'waze://' },
  { id: 'spotify', label: 'SPOTIFY', package: 'com.spotify.music', url: 'spotify://' },
  { id: 'camera', label: 'CAMERA', url: '' },
];

export const MAX_DOCK_TILES = 6;
const MAX_LABEL = 12;

/** Dock label from an app's display name: upper-case, trimmed to fit a tile. */
export function dockLabel(appLabel: string): string {
  const s = appLabel.trim().toUpperCase();
  return s.length > MAX_LABEL ? s.slice(0, MAX_LABEL - 1).trimEnd() + '…' : s;
}

/**
 * Coerce whatever was persisted into valid tiles. v1 tiles were `{id,label,url}` —
 * still valid (URL-only); anything malformed is dropped rather than crashing the dock.
 */
export function normalizeDock(raw: unknown): DockTile[] | null {
  if (!Array.isArray(raw)) return null;
  const out: DockTile[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const t = r as Record<string, unknown>;
    if (typeof t.id !== 'string') continue;
    const tile: DockTile = { id: t.id, label: typeof t.label === 'string' ? t.label : '' };
    if (typeof t.package === 'string' && t.package) tile.package = t.package;
    if (typeof t.activity === 'string' && t.activity) tile.activity = t.activity;
    if (typeof t.url === 'string') tile.url = t.url;
    out.push(tile);
  }
  return out.slice(0, MAX_DOCK_TILES);
}

/** Is this app (package, and activity when given) pinned? */
export function findPinned(tiles: DockTile[], pkg: string, activity?: string): number {
  return tiles.findIndex((t) => t.package === pkg && (!t.activity || !activity || t.activity === activity));
}
