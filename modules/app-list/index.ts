/**
 * JS face of the local AppList Kotlin module (NATIVE variant; `index.web.ts` is the
 * browser preview's fake list). Resolved optionally, so a dev client built before the
 * module existed degrades to an empty drawer + URL-only dock instead of crashing.
 */
import { requireOptionalNativeModule } from 'expo';

export interface AppInfo {
  package: string;
  /** launcher activity class — launch targets it explicitly (skips multi-activity choosers) */
  activity: string;
  label: string;
  /** ≤96 px PNG data URI; null = render a monogram tile */
  iconDataUri: string | null;
}

interface AppListNative {
  listApps(): Promise<AppInfo[]>;
  launch(pkg: string, activity: string | null): void;
}

const native = requireOptionalNativeModule<AppListNative>('AppList');

/** True when the module is compiled into this build. */
export const appListAvailable = native != null;

export async function listApps(): Promise<AppInfo[]> {
  if (!native) return [];
  return native.listApps();
}

/** Open an app by package (+ optional explicit activity). Throws if it can't launch. */
export async function launchApp(pkg: string, activity?: string | null): Promise<void> {
  if (!native) throw new Error('AppList module not in this build');
  native.launch(pkg, activity ?? null);
}
