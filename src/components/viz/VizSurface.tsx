/**
 * VizSurface — native entry: Skia (zero React work per frame) with the SVG renderer
 * as the crash-free fallback (skiaFallback.tsx). Web never loads this file.
 */
import { VizSurface as VizSurfaceSvg } from './VizSurfaceSvg';
import { skiaWithFallback } from '../skiaFallback';
import type { VizSurfaceProps } from './vizTypes';

export const VizSurface = skiaWithFallback<VizSurfaceProps>(
  'VizSurface',
  () => require('./VizSurfaceSkia').VizSurface,
  VizSurfaceSvg
);
