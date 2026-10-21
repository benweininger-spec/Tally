/**
 * Reactive ambient field — native entry: the continuous-motion Skia version, with the
 * stepped SVG version as the crash-free fallback (skiaFallback.tsx). Web never loads
 * this file (ReactiveBackground.web.tsx → SVG).
 */
import React from 'react';
import { ReactiveBackground as ReactiveBackgroundSvg } from './ReactiveBackgroundSvg';
import { skiaWithFallback } from './skiaFallback';

const Impl = skiaWithFallback<object>(
  'ReactiveBackground',
  () => require('./ReactiveBackgroundSkia').ReactiveBackground,
  ReactiveBackgroundSvg
);

export const ReactiveBackground = React.memo(function ReactiveBackground() {
  return <Impl />;
});
