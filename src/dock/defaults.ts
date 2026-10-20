/**
 * Dock tile model + defaults. Pure (no imports) so settings + UI can share it.
 *
 * A tile launches an app by deep-link URL/scheme (Linking.openURL). Schemes are the
 * reliable, no-native-module way to open installed apps on the head unit; the user
 * can edit the label + URL per tile. CarPlay (static) and SET (settings) are NOT in
 * this list — they're pinned bookends rendered by the Dock so they can't be removed.
 * Full install-an-app picker (launch by package) is M4 launcher work.
 */
export interface DockTile {
  id: string;
  label: string;
  /** deep-link / scheme launched on tap; empty = no-op (placeholder tile) */
  url: string;
}

export const DEFAULT_DOCK: DockTile[] = [
  { id: 'maps', label: 'MAPS', url: 'geo:0,0' },
  { id: 'waze', label: 'WAZE', url: 'waze://' },
  { id: 'spotify', label: 'SPOTIFY', url: 'spotify://' },
  { id: 'camera', label: 'CAMERA', url: '' },
];

export const MAX_DOCK_TILES = 6;
