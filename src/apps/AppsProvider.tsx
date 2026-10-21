/**
 * Installed-app list for the launcher (drawer + dock), loaded once from the AppList
 * native module (web: a fake list) and memoized. Slow data by nature — it changes only
 * when apps are installed/removed — so it lives in plain context, never per-frame.
 *
 * Two contexts so opening/closing the drawer doesn't re-render list consumers and
 * vice versa. The list is re-queried each time the drawer opens (icons are cached
 * natively, so this is cheap) to pick up newly installed apps.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, Linking } from 'react-native';
import { appListAvailable, launchApp, listApps, type AppInfo } from '../../modules/app-list';

export type { AppInfo };

interface AppsCtx {
  apps: AppInfo[];
  /** first query finished (so an empty list means "none", not "loading") */
  loaded: boolean;
  /** the native module is compiled into this build */
  available: boolean;
  refresh: () => void;
}

interface DrawerCtx {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const AppsContext = createContext<AppsCtx | null>(null);
const DrawerContext = createContext<DrawerCtx | null>(null);

export function AppsProvider({ children }: { children: React.ReactNode }) {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);

  const refresh = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    listApps()
      .then((list) => {
        if (alive.current) setApps(list);
      })
      .catch((e) => console.warn('[AppList] listApps failed:', e))
      .finally(() => {
        inFlight.current = false;
        if (alive.current) setLoaded(true);
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    // after first paint: the home face must never wait on PackageManager
    const task = InteractionManager.runAfterInteractions(refresh);
    return () => {
      alive.current = false;
      task.cancel();
    };
  }, [refresh]);

  const setDrawerOpen = useCallback(
    (next: boolean) => {
      if (next) refresh();
      setOpen(next);
    },
    [refresh]
  );

  const appsValue = useMemo(() => ({ apps, loaded, available: appListAvailable, refresh }), [apps, loaded, refresh]);
  const drawerValue = useMemo(() => ({ open, setOpen: setDrawerOpen }), [open, setDrawerOpen]);

  return (
    <AppsContext.Provider value={appsValue}>
      <DrawerContext.Provider value={drawerValue}>{children}</DrawerContext.Provider>
    </AppsContext.Provider>
  );
}

export function useApps(): AppsCtx {
  const c = useContext(AppsContext);
  if (!c) throw new Error('useApps must be used inside <AppsProvider>');
  return c;
}

export function useAppDrawer(): DrawerCtx {
  const c = useContext(DrawerContext);
  if (!c) throw new Error('useAppDrawer must be used inside <AppsProvider>');
  return c;
}

/**
 * Launch a dock tile or drawer entry: installed package first (explicit activity when
 * known), then the deep-link URL fallback. Rejects only if nothing worked, so callers
 * can flash a "not installed" state.
 */
export async function launchTarget(t: { package?: string; activity?: string; url?: string }): Promise<void> {
  if (t.package) {
    try {
      await launchApp(t.package, t.activity);
      return;
    } catch {
      // fall through to the URL
    }
  }
  if (t.url) {
    await Linking.openURL(t.url);
    return;
  }
  throw new Error('nothing to launch');
}
