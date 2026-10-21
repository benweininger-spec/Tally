/**
 * Skia with an SVG safety net (native only). Crash-free is a hard requirement for a
 * HOME launcher, so every Skia surface ships with its SVG twin and falls back when:
 *   • Skia can't load in this build (an older dev client without the native module —
 *     the lazy require throws), or
 *   • a Skia component throws while rendering (error boundary).
 * One failure flips every Skia surface to SVG for the rest of the session.
 */
import React from 'react';

let skiaBroken = false;

export function skiaWithFallback<P extends object>(
  name: string,
  loadSkia: () => React.ComponentType<P>,
  Svg: React.ComponentType<P>
): React.ComponentType<P> {
  let Skia: React.ComponentType<P> | null = null;
  let loaded = false;
  const resolve = () => {
    if (loaded) return Skia;
    loaded = true;
    try {
      Skia = loadSkia();
    } catch (e) {
      skiaBroken = true;
      console.warn(`[${name}] Skia unavailable, using SVG:`, e);
    }
    return Skia;
  };

  class Boundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
    state = { failed: skiaBroken };
    static getDerivedStateFromError() {
      skiaBroken = true;
      return { failed: true };
    }
    componentDidCatch(e: unknown) {
      console.warn(`[${name}] Skia render failed, falling back to SVG:`, e);
    }
    render() {
      return this.state.failed ? this.props.fallback : this.props.children;
    }
  }

  function WithFallback(props: P) {
    const Impl = resolve();
    if (!Impl || skiaBroken) return <Svg {...props} />;
    return (
      <Boundary fallback={<Svg {...props} />}>
        <Impl {...props} />
      </Boundary>
    );
  }
  WithFallback.displayName = `${name}(skia→svg)`;
  return WithFallback;
}
