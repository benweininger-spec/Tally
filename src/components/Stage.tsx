import React, { createContext, useContext } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export const STAGE_W = 2000;
export const STAGE_H = 1200;

const StageScaleContext = createContext(1);

/** Window px per stage px. Gesture deltas arrive in window px — divide by this. */
export const useStageScale = () => useContext(StageScaleContext);

/**
 * Renders children on a fixed 2000x1200 canvas (the Dasaita Vivid13 panel) and
 * scales it to fit whatever window it runs in, letterboxed. Design once at native
 * resolution; preview anywhere.
 */
export function Stage({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  const t = useTheme();
  const scale = Math.min(width / STAGE_W, height / STAGE_H);

  return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: STAGE_W,
          height: STAGE_H,
          backgroundColor: t.bg,
          transform: [{ scale }],
          overflow: 'hidden',
        }}
      >
        <StageScaleContext.Provider value={scale}>{children}</StageScaleContext.Provider>
      </View>
    </View>
  );
}
