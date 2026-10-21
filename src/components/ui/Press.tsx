/**
 * Pressable with tactile feedback for every tap target: the box depresses (scale
 * 1 → 0.985, ≈1–2 px on a dock tile) and a soft amber under-glow fades in around it,
 * 120 ms in / 180 ms out. Transform + opacity only, on the native driver — no layout
 * animation and no JS work per frame, so mashing the dock can't drop frames.
 *
 * The glow is a pointer-transparent underlay drawn behind the children with a static
 * CSS-style box-shadow (accent at 35%); only its opacity animates.
 */
import React, { useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { formatColor, parseColor } from '../../theme/themes';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const NATIVE = Platform.OS !== 'web';
const DEPRESS = 0.985;
const GLOW_ALPHA = 0.35; // halo around the box
const TINT_ALPHA = 0.12; // faint fill under the label — text stays readable

export type PressProps = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  /** corner radius of the glow (match the box's borderRadius) */
  radius?: number;
  /** skip the under-glow (depress only) */
  noGlow?: boolean;
};

export function Press({ style, children, radius = 6, noGlow, onPressIn, onPressOut, disabled, ...rest }: PressProps) {
  const t = useTheme();
  const p = useRef(new Animated.Value(0)).current;
  const scale = useMemo(() => p.interpolate({ inputRange: [0, 1], outputRange: [1, DEPRESS] }), [p]);
  const { halo, tint } = useMemo(() => {
    const c = parseColor(t.accent);
    return c
      ? { halo: formatColor([c[0], c[1], c[2], GLOW_ALPHA]), tint: formatColor([c[0], c[1], c[2], TINT_ALPHA]) }
      : { halo: t.accentGlow, tint: 'transparent' };
  }, [t.accent, t.accentGlow]);

  const to = (v: number, ms: number) =>
    Animated.timing(p, { toValue: v, duration: ms, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }).start();

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e: GestureResponderEvent) => {
        if (!disabled) to(1, 120);
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        to(0, 180);
        onPressOut?.(e);
      }}
      style={[style, { transform: [{ scale }] }]}
    >
      {!noGlow && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.glow,
            { borderRadius: radius, opacity: p, boxShadow: `0px 0px 18px 3px ${halo}`, backgroundColor: tint },
          ]}
        />
      )}
      {children}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  glow: { pointerEvents: 'none' },
});
