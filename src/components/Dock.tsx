import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from './ui/Press';
import { useTheme } from '../theme/ThemeProvider';
import { useOpenSettings } from '../settings/SettingsUI';
import { useDock } from '../dock/DockConfig';
import { launchTarget, useAppDrawer } from '../apps/AppsProvider';
import { launchCarPlay } from '../carplay/launchCarPlay';

/**
 * App dock. CarPlay is a static LAUNCH tile (left) — it renders full-screen from the
 * phone over Apple's encrypted pipeline and exposes no API, so it's a destination,
 * never an embed (design-brief §9). The middle tiles are user-pinned apps (long-press
 * in the APPS drawer; edited in SET → DOCK; persisted) that launch by package, falling
 * back to a deep link. APPS (drawer) and SET are pinned on the right so both are always
 * reachable.
 */
export const Dock = React.memo(function Dock() {
  const t = useTheme();
  const openSettings = useOpenSettings();
  const { setOpen: setDrawerOpen } = useAppDrawer();
  const { tiles } = useDock();
  // id of the tile that just failed to launch ('carplay' for the CarPlay tile)
  const [failed, setFailed] = useState<string | null>(null);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (errTimer.current) clearTimeout(errTimer.current);
  }, []);

  const fail = (id: string) => {
    setFailed(id);
    if (errTimer.current) clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setFailed(null), 3500);
  };

  const openCarPlay = () => {
    launchCarPlay()
      .then(() => setFailed(null))
      .catch(() => fail('carplay'));
  };

  const cpErr = failed === 'carplay';
  return (
    <View style={styles.row}>
      <Press
        onPress={openCarPlay}
        style={[styles.carplay, { borderColor: cpErr ? t.warn : t.accent, backgroundColor: t.panel }]}
      >
        <Text style={[styles.cpTitle, { color: cpErr ? t.warn : t.accent }]}>CarPlay</Text>
        <Text style={[styles.cpSub, { color: t.textDim }]}>
          {cpErr ? 'APP NOT FOUND' : 'WIRELESS · LAUNCH'}
        </Text>
      </Press>

      {tiles.map((tile) => {
        const err = failed === tile.id;
        const empty = !tile.package && !tile.url;
        return (
          <Press
            key={tile.id}
            onPress={() => {
              if (!empty) launchTarget(tile).catch(() => fail(tile.id));
            }}
            style={[styles.tile, { borderColor: err ? t.warn : t.panelBorder }]}
          >
            <Text numberOfLines={1} style={[styles.tileText, { color: err ? t.warn : empty ? t.absent : t.textDim }]}>
              {tile.label || '—'}
            </Text>
            {err && <Text style={[styles.tileSub, { color: t.warn }]}>NOT INSTALLED</Text>}
          </Press>
        );
      })}

      <Press onPress={() => setDrawerOpen(true)} style={[styles.tile, { borderColor: t.panelBorder }]}>
        <Text style={[styles.tileText, { color: t.accentSoft }]}>APPS</Text>
      </Press>

      <Press onPress={openSettings} style={[styles.tile, { borderColor: t.panelBorder }]}>
        <Text style={[styles.tileText, { color: t.textDim }]}>SET</Text>
      </Press>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 24, height: 132 },
  carplay: { flex: 1.6, borderWidth: 1, borderRadius: 6, justifyContent: 'center', paddingHorizontal: 26 },
  cpTitle: { fontFamily: 'Oxanium', fontSize: 26, fontWeight: '700' },
  cpSub: { fontFamily: 'JetBrains Mono', fontSize: 16, letterSpacing: 2 },
  tile: { flex: 1, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  tileText: { fontFamily: 'JetBrains Mono', fontSize: 17, letterSpacing: 3 },
  tileSub: { fontFamily: 'JetBrains Mono', fontSize: 15, letterSpacing: 1, marginTop: 6 },
});
