/**
 * Web stub for the AppList module: a fixed fake app list (more than one drawer page,
 * so paging is exercised) with generated monogram icons, and a no-op launch. Keeps the
 * browser preview of the drawer + dock pinning fully interactive.
 */
export interface AppInfo {
  package: string;
  activity: string;
  label: string;
  iconDataUri: string | null;
}

export const appListAvailable = true;

// third-party brand-ish colors for the fake icons only — not theme tokens
const FAKE: [label: string, pkg: string, color: string][] = [
  ['Waze', 'com.waze', '#33CCFF'],
  ['Spotify', 'com.spotify.music', '#1DB954'],
  ['Maps', 'com.google.android.apps.maps', '#4285F4'],
  ['YouTube Music', 'com.google.android.apps.youtube.music', '#FF0000'],
  ['Pandora', 'com.pandora.android', '#3668FF'],
  ['Pocket Casts', 'au.com.shiftyjelly.pocketcasts', '#F43E37'],
  ['Audible', 'com.audible.application', '#F8991C'],
  ['Chrome', 'com.android.chrome', '#FBBC05'],
  ['Camera', 'com.android.camera2', '#8E8E93'],
  ['Gallery', 'com.android.gallery3d', '#AF52DE'],
  ['Files', 'com.android.documentsui', '#5AC8FA'],
  ['Weather', 'com.weather.Weather', '#2A6CB5'],
  ['Clock', 'com.android.deskclock', '#636366'],
  ['Calculator', 'com.android.calculator2', '#FF9500'],
  ['Torque Pro', 'org.prowl.torque', '#C0392B'],
  ['OBD Fusion', 'com.ocetnik.obdfusion', '#16A085'],
  ['Play Store', 'com.android.vending', '#01875F'],
  ['Settings', 'com.android.settings', '#48484A'],
  ['ZLink', 'com.zjinnova.zlink', '#0A84FF'],
  ['Bluetooth Music', 'com.syu.bt', '#007AFF'],
  ['Radio', 'com.syu.radio', '#D35400'],
  ['Gaia GPS', 'com.trailbehind.android.gaiagps.pro', '#2E7D32'],
];

const monogram = (label: string, color: string) => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<rect width="96" height="96" rx="22" fill="${color}"/>` +
    `<text x="48" y="62" font-family="Arial, sans-serif" font-size="44" font-weight="700" ` +
    `fill="#fff" text-anchor="middle">${label[0]}</text></svg>`;
  // base64 (not `utf8,`): RN-web's Image never resolves the utf8 form
  return `data:image/svg+xml;base64,${btoa(svg)}`;
};

const APPS: AppInfo[] = FAKE.map(([label, pkg, color]) => ({
  package: pkg,
  activity: `${pkg}.MainActivity`,
  label,
  iconDataUri: monogram(label, color),
})).sort((a, b) => a.label.localeCompare(b.label));

export async function listApps(): Promise<AppInfo[]> {
  return APPS;
}

export async function launchApp(pkg: string, _activity?: string | null): Promise<void> {
  console.log(`[AppList web stub] launch ${pkg}`);
}
