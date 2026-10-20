import React, { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { useOpenSettings } from '../settings/SettingsUI';
import { useDock } from '../dock/DockConfig';
import { launchCarPlay } from '../carplay/launchCarPlay';

/**
 * App dock. CarPlay is a static LAUNCH tile (left) — it renders full-screen from the
 * phone over Apple's encrypted pipeline and exposes no API, so it's a destination,
 * never an embed (design-brief §9). The middle app tiles are user-customizable
 * (label + launch URL, edited in SET → DOCK; persisted). SET is pinned on the right
 * so settings is always reachable. Tapping a tile deep-links into the app.
 */
export function Dock() {
  const t = useTheme();
  const openSettings = useOpenSettings();
  const { tiles } = useDock();
  const [cpErr, setCpErr] = useState(false);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const launch = (url: string) => {
    if (url) Linking.openURL(url).catch(() => {});
  };

  const openCarPlay = () => {
    launchCarPlay()
      .then(() => setCpErr(false))
      .catch(() => {
        setCpErr(true);
        if (errTimer.current) clearTimeout(errTimer.current);
        errTimer.current = setTimeout(() => setCpErr(false), 3500);
      });
  };

  return (
    <View style={styles.row}>
      <Pressable
        onPress={openCarPlay}
        style={[styles.carplay, { borderColor: cpErr ? t.warn : t.accent, backgroundColor: t.panel }]}
      >
        <Text style={[styles.cpTitle, { color: cpErr ? t.warn : t.accent }]}>CarPlay</Text>
        <Text style={[styles.cpSub, { color: t.textDim }]}>
          {cpErr ? 'APP NOT FOUND' : 'WIRELESS · LAUNCH'}
        </Text>
      </Pressable>

      {tiles.map((tile) => (
        <Pressable
          key={tile.id}
          onPress={() => launch(tile.url)}
          style={[styles.tile, { borderColor: t.panelBorder }]}
        >
          <Text style={[styles.tileText, { color: t.textDim }]}>{tile.label || '—'}</Text>
        </Pressable>
      ))}

      <Pressable onPress={openSettings} style={[styles.tile, { borderColor: t.panelBorder }]}>
        <Text style={[styles.tileText, { color: t.textDim }]}>SET</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 24, height: 132 },
  carplay: { flex: 1.6, borderWidth: 1, borderRadius: 6, justifyContent: 'center', paddingHorizontal: 26 },
  cpTitle: { fontFamily: 'Oxanium', fontSize: 26, fontWeight: '700' },
  cpSub: { fontFamily: 'JetBrains Mono', fontSize: 13, letterSpacing: 2 },
  tile: { flex: 1, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontFamily: 'JetBrains Mono', fontSize: 17, letterSpacing: 3 },
});
