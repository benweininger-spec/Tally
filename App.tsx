import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Oxanium_700Bold } from '@expo-google-fonts/oxanium';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { DataSourceProvider } from './src/data/DataSourceProvider';
import { ThemeProvider } from './src/theme/ThemeProvider';
import { DockProvider } from './src/dock/DockConfig';
import { AppsProvider } from './src/apps/AppsProvider';
import { MotionPrefProvider } from './src/settings/MotionPref';
import { RadioProvider } from './src/radio/RadioProvider';
import { SettingsUIProvider } from './src/settings/SettingsUI';
import { HomeScreen } from './src/screens/HomeScreen';
import { DriveRecorderFeed } from './src/data/driveRecorder';
import { MpgLogFeed } from './src/data/mpgLogStore';

const FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Oxanium:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap';

/** Native: load the design typefaces under the SAME family names the styles use
 *  ('Oxanium' / 'JetBrains Mono'), one weight each — RN synthesizes the rest. Without
 *  this the unit rendered the whole design in the system fallback font (Phase A fix). */
function useNativeFonts(): boolean {
  const [loaded] = useFonts(
    Platform.OS === 'web' ? {} : { Oxanium: Oxanium_700Bold, 'JetBrains Mono': JetBrainsMono_500Medium }
  );
  return Platform.OS === 'web' || loaded;
}

/** Load the display fonts on web via Google Fonts CSS. */
function useWebFonts() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (document.getElementById('dash-fonts')) return;
    const link = document.createElement('link');
    link.id = 'dash-fonts';
    link.rel = 'stylesheet';
    link.href = FONT_LINK;
    document.head.appendChild(link);
  }, []);
}

export default function App() {
  useWebFonts();
  const fontsReady = useNativeFonts();
  if (!fontsReady) return null; // splash covers the ~100ms load; avoids a fallback-font flash
  return (
    <DataSourceProvider>
      <ThemeProvider>
        <MotionPrefProvider>
          <DockProvider>
            <AppsProvider>
              <RadioProvider>
                <SettingsUIProvider>
                  <StatusBar hidden />
                  {/* always-on history for the Signal Library instruments (renders nothing) */}
                  <DriveRecorderFeed />
                  {/* long-term MPG log: day buckets + trips, persisted (renders nothing) */}
                  <MpgLogFeed />
                  <HomeScreen />
                </SettingsUIProvider>
              </RadioProvider>
            </AppsProvider>
          </DockProvider>
        </MotionPrefProvider>
      </ThemeProvider>
    </DataSourceProvider>
  );
}
