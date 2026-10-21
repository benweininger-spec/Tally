/**
 * App drawer — the launcher's "all apps" surface. Full-stage grid (6×3 = 18 per page
 * at 2000×1200), paged with big ‹ › targets or a horizontal swipe. Tap opens the app;
 * long-press pins/unpins it to the dock. Mounted inside the Stage above every face and
 * renders nothing while closed, so it costs nothing on the home face.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Press } from '../components/ui/Press';
import { useTheme } from '../theme/ThemeProvider';
import { STAGE_W, useStageScale } from '../components/Stage';
import { launchTarget, useAppDrawer, useApps, type AppInfo } from '../apps/AppsProvider';
import { useDock } from '../dock/DockConfig';
import { MAX_DOCK_TILES, dockLabel, findPinned } from '../dock/defaults';
import type { Theme } from '../theme/themes';

const COLS = 6;
const ROWS = 3;
const PER_PAGE = COLS * ROWS;
const MARGIN_X = 80;
const GAP_X = 32;
const GAP_Y = 28;
const TILE_W = (STAGE_W - 2 * MARGIN_X - (COLS - 1) * GAP_X) / COLS; // 280
const TILE_H = 280;
const GRID_TOP = 150;
const SWIPE_PX = 140; // stage px

export function AppDrawer() {
  const { open } = useAppDrawer();
  return open ? <DrawerBody /> : null;
}

function DrawerBody() {
  const t = useTheme();
  const { setOpen } = useAppDrawer();
  const { apps, loaded, available } = useApps();
  const { tiles, togglePin } = useDock();
  const scale = useStageScale();
  const [page, setPage] = useState(0);
  const [toast, setToast] = useState<{ msg: string; warn?: boolean } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pages = Math.max(1, Math.ceil(apps.length / PER_PAGE));
  const cur = Math.min(page, pages - 1);
  const visible = apps.slice(cur * PER_PAGE, (cur + 1) * PER_PAGE);
  const go = (dir: -1 | 1) => setPage((p) => Math.max(0, Math.min(pages - 1, Math.min(p, pages - 1) + dir)));
  const goRef = useRef(go);
  goRef.current = go;

  const close = () => setOpen(false);

  // hardware back closes the drawer instead of leaving the launcher
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [setOpen]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const flash = (msg: string, warn?: boolean) => {
    setToast({ msg, warn });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const onOpen = (app: AppInfo) => {
    launchTarget({ package: app.package, activity: app.activity })
      .then(close) // coming back home should land on the face, not the drawer
      .catch(() => {
        setFailed(app.activity);
        flash(`COULDN'T OPEN ${dockLabel(app.label)}`, true);
      });
  };

  const onPin = (app: AppInfo) => {
    const r = togglePin({ package: app.package, activity: app.activity, label: app.label });
    const name = dockLabel(app.label);
    if (r === 'pinned') flash(`PINNED ${name} TO DOCK`);
    else if (r === 'unpinned') flash(`REMOVED ${name} FROM DOCK`);
    else flash(`DOCK FULL · ${MAX_DOCK_TILES} MAX — HOLD A PINNED APP TO UNPIN`, true);
  };

  // horizontal swipe pages the grid (deltas arrive in window px → convert to stage px)
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderRelease: (_, g) => {
          const dx = g.dx / (scale || 1);
          if (dx <= -SWIPE_PX || g.vx < -0.6) goRef.current(1);
          else if (dx >= SWIPE_PX || g.vx > 0.6) goRef.current(-1);
        },
      }),
    [scale]
  );

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }]}>
      {/* header */}
      <View style={[styles.header, { borderBottomColor: t.hairline }]}>
        <View style={styles.headLeft}>
          <Text style={[styles.title, { color: t.accent }]}>APPS</Text>
          <Text style={[styles.count, { color: t.textFaint }]}>
            {loaded ? `${apps.length} INSTALLED` : 'LOADING…'}
          </Text>
        </View>
        <Press onPress={close} style={[styles.closeBtn, { borderColor: t.panelBorder }]} hitSlop={8}>
          <Text style={[styles.closeText, { color: t.textDim }]}>CLOSE ✕</Text>
        </Press>
      </View>

      {/* grid */}
      <View style={styles.grid} {...pan.panHandlers}>
        {loaded && apps.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: t.textDim }]}>NO APPS FOUND</Text>
            <Text style={[styles.emptyHint, { color: t.textFaint }]}>
              {available
                ? 'Package visibility may be blocked — rebuild with plugins/withLauncherQueries.'
                : 'This build is missing the app-list module — prebuild + rebuild the dev client.'}
            </Text>
          </View>
        ) : (
          visible.map((app) => (
            <AppTile
              key={`${app.package}/${app.activity}`}
              app={app}
              t={t}
              pinned={findPinned(tiles, app.package, app.activity) >= 0}
              failed={failed === app.activity}
              onPress={() => onOpen(app)}
              onLongPress={() => onPin(app)}
            />
          ))
        )}
      </View>

      {/* footer: hint · pager · toast */}
      <View style={styles.footer}>
        <Text style={[styles.hint, { color: toast ? (toast.warn ? t.warn : t.accent) : t.textFaint }]}>
          {toast ? toast.msg : 'TAP TO OPEN · HOLD TO PIN TO DOCK'}
        </Text>
        {pages > 1 && (
          <View style={styles.pager}>
            <PageBtn t={t} label="‹" disabled={cur === 0} onPress={() => go(-1)} />
            <View style={styles.dots}>
              {Array.from({ length: pages }).map((_, i) => (
                <View key={i} style={[styles.dot, { backgroundColor: i === cur ? t.accent : t.panelBorder }]} />
              ))}
            </View>
            <PageBtn t={t} label="›" disabled={cur === pages - 1} onPress={() => go(1)} />
          </View>
        )}
      </View>
    </View>
  );
}

function AppTile({
  app,
  t,
  pinned,
  failed,
  onPress,
  onLongPress,
}: {
  app: AppInfo;
  t: Theme;
  pinned: boolean;
  failed: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const border = failed ? t.warn : pinned ? t.accent : t.panelBorder;
  return (
    <Press
      radius={8}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
      style={[styles.tile, { borderColor: border, backgroundColor: t.panel }]}
    >
      {app.iconDataUri ? (
        <Image source={{ uri: app.iconDataUri }} style={styles.icon} />
      ) : (
        <View style={[styles.icon, styles.monogram, { borderColor: t.accent }]}>
          <Text style={[styles.monoText, { color: t.accent }]}>{app.label.slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
      <Text numberOfLines={2} style={[styles.label, { color: t.text }]}>
        {app.label}
      </Text>
      {pinned && (
        <View style={[styles.badge, { borderColor: t.accent }]}>
          <Text style={[styles.badgeText, { color: t.accent }]}>DOCK</Text>
        </View>
      )}
    </Press>
  );
}

function PageBtn({ t, label, disabled, onPress }: { t: Theme; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      style={[styles.pageBtn, { borderColor: disabled ? t.hairline : t.panelBorder }]}
    >
      <Text style={[styles.pageBtnText, { color: disabled ? t.absent : t.accent }]}>{label}</Text>
    </Press>
  );
}

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    paddingHorizontal: MARGIN_X,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  headLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 28 },
  title: { fontFamily: 'Oxanium', fontSize: 40, fontWeight: '800', letterSpacing: 4 },
  count: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 3 },
  closeBtn: { height: 96, minWidth: 200, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: 'JetBrains Mono', fontSize: 18, letterSpacing: 3 },
  grid: {
    position: 'absolute',
    top: GRID_TOP,
    left: MARGIN_X,
    width: STAGE_W - 2 * MARGIN_X,
    height: ROWS * TILE_H + (ROWS - 1) * GAP_Y,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: GAP_X,
    rowGap: GAP_Y,
    alignContent: 'flex-start',
  },
  tile: {
    width: TILE_W,
    height: TILE_H,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    gap: 22,
  },
  icon: { width: 112, height: 112, borderRadius: 24 },
  monogram: { borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  monoText: { fontFamily: 'Oxanium', fontSize: 56, fontWeight: '700' },
  label: { fontFamily: 'Oxanium', fontSize: 22, fontWeight: '600', textAlign: 'center', lineHeight: 27, minHeight: 54 },
  badge: { position: 'absolute', top: 14, right: 14, borderWidth: 1, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontFamily: 'JetBrains Mono', fontSize: 12, letterSpacing: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: 260 },
  emptyTitle: { fontFamily: 'Oxanium', fontSize: 34, fontWeight: '700', letterSpacing: 3 },
  emptyHint: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 1 },
  footer: {
    position: 'absolute',
    left: MARGIN_X,
    right: MARGIN_X,
    top: GRID_TOP + ROWS * TILE_H + (ROWS - 1) * GAP_Y + 24,
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hint: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 3 },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  pageBtn: { width: 120, height: 96, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  pageBtnText: { fontFamily: 'Oxanium', fontSize: 48, fontWeight: '700', lineHeight: 54 },
  dots: { flexDirection: 'row', gap: 12 },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
