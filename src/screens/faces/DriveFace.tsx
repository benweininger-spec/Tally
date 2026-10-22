import React from 'react';
import { View } from 'react-native';
import { PulseTach } from '../../components/signature/PulseTach';
import { ConnectMoment } from '../../components/signature/ConnectMoment';
import { TelemetryStrip } from '../../components/TelemetryStrip';
import { GyroCard } from '../../components/GyroCard';
import { GScopeCard } from '../../components/GScopeCard';
import { MediaWidget } from '../../components/MediaWidget';
import { CompassCard } from '../../components/CompassCard';
import { VehiclePanel } from '../../components/VehiclePanel';

/**
 * DRIVE — the dense instrument face (the original milestone-1 home layout): signature
 * + telemetry strip, attitude + traction column, media / heading / vehicle rail.
 * Header, dock and ambient background are shared and rendered by HomeScreen.
 * Stage coordinates (2000×1200); content lives between the header (92) and dock (1018).
 */
export const DriveFace = React.memo(function DriveFace() {
  return (
    <>
      {/* hero signature — centered in the space left of the attitude box so the
          left margin (116) equals the gap to the attitude box: (952 - 720) / 2. */}
      <View style={{ position: 'absolute', left: 116, top: 150 }}>
        <PulseTach size={720} />
        <ConnectMoment size={720} />
      </View>

      {/* live telemetry strip beneath the signature (Tier A, glanceable) */}
      <View style={{ position: 'absolute', left: 116, top: 892, width: 720 }}>
        <TelemetryStrip />
      </View>

      {/* center column: attitude on top, G-Scope (g-g + grip envelope) below — both Tier A */}
      <View style={{ position: 'absolute', left: 952, top: 124, width: 332 }}>
        <GyroCard />
      </View>
      <View style={{ position: 'absolute', left: 952, top: 606, width: 332 }}>
        <GScopeCard />
      </View>

      {/* right rail */}
      <View style={{ position: 'absolute', left: 1300, top: 124, width: 652, gap: 24 }}>
        <MediaWidget />
        <CompassCard />
        <VehiclePanel />
      </View>
    </>
  );
});
