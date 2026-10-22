/**
 * The app-wide drive recorder instance + the invisible component that feeds it from
 * the telemetry stream (mounted once, renders nothing, never re-renders). The Signal
 * Library instruments (G-Scope, Speed Record) read this in their own loops.
 */
import { useTelemetryListener } from './DataSourceProvider';
import { createDriveRecorder, recordTick } from '../lib/driveRecorder';

export const driveRecorder = createDriveRecorder();

const nowS = () => {
  const p = (globalThis as any).performance;
  return (p && typeof p.now === 'function' ? p.now() : Date.now()) / 1000;
};

export function DriveRecorderFeed() {
  useTelemetryListener((d) => {
    const m = d.motion;
    recordTick(
      driveRecorder,
      {
        lat: m.latG.status !== 'absent' ? m.latG.value : null,
        long: m.longG.status !== 'absent' ? m.longG.value : null,
        speedMph: m.speedMph.value,
        rpm: d.obd.connected && d.obd.rpm.status !== 'absent' ? d.obd.rpm.value : null,
      },
      nowS()
    );
  });
  return null;
}
