/**
 * THE SIGNATURE — native entry: the Skia port (PulseTachSkia, zero React re-renders
 * per frame), with the SVG renderer as the crash-free fallback (skiaFallback.tsx).
 * Web never loads this file (PulseTach.web.tsx → SVG).
 */
import React from 'react';
import { PulseTach as PulseTachSvg } from './PulseTachSvg';
import { skiaWithFallback } from '../skiaFallback';

type Props = { size?: number };

const Impl = skiaWithFallback<Props>('PulseTach', () => require('./PulseTachSkia').PulseTach, PulseTachSvg);

export const PulseTach = React.memo(function PulseTach({ size = 720 }: Props) {
  return <Impl size={size} />;
});
