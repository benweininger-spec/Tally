import React from 'react';
import { View } from 'react-native';
import { PulseTach } from '../../components/signature/PulseTach';
import { ConnectMoment } from '../../components/signature/ConnectMoment';
import { MediaWidget } from '../../components/MediaWidget';
import { CompassCard } from '../../components/CompassCard';

/**
 * HOME — the calm default face. Speed + drive pulse as the hero, and a glance or two
 * (now playing, heading). Everything dense (attitude, traction, vehicle, telemetry)
 * lives one swipe away on DRIVE. Stage coordinates; content between header and dock.
 */
export const HomeFace = React.memo(function HomeFace() {
  return (
    <>
      <View style={{ position: 'absolute', left: 120, top: 116 }}>
        <PulseTach size={860} />
        <ConnectMoment size={860} />
      </View>

      {/* glance column, vertically centered in the face area (92 → 1000) */}
      <View style={{ position: 'absolute', left: 1120, width: 780, top: 92, height: 908, justifyContent: 'center', gap: 24 }}>
        <MediaWidget />
        <CompassCard />
      </View>
    </>
  );
});
