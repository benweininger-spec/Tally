import React from 'react';
import { View } from 'react-native';
import { PulseTach } from '../../components/signature/PulseTach';
import { ConnectMoment } from '../../components/signature/ConnectMoment';
import { MediaWidget } from '../../components/MediaWidget';
import { CompassCard } from '../../components/CompassCard';
import { EcoCard, WarmupCard } from '../../components/HomeGlance';
import { FuelTankCard } from '../../components/HomeLog';
import { GearBadge } from '../../components/GearBadge';

/**
 * HOME — the calm default face. Speed + drive pulse as the hero, and a few glances:
 * now playing, fuel economy with the ECO zone, engine warm-up, heading. Everything
 * dense (attitude, traction, full engine data) lives one swipe away on DRIVE / ENGINE.
 * Stage coordinates; content between header and dock.
 */
export const HomeFace = React.memo(function HomeFace() {
  return (
    <>
      <View style={{ position: 'absolute', left: 120, top: 116 }}>
        <PulseTach size={860} />
        <ConnectMoment size={860} />
        <GearBadge size={860} />
      </View>

      {/* glance column, vertically centered in the face area (92 → 1000) */}
      <View style={{ position: 'absolute', left: 1120, width: 780, top: 92, height: 908, justifyContent: 'center', gap: 24 }}>
        <MediaWidget />
        <View style={{ flexDirection: 'row', gap: 24, height: 262 }}>
          <View style={{ flex: 1.62 }}>
            <EcoCard />
          </View>
          <View style={{ flex: 1 }}>
            <WarmupCard />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 24, height: 190 }}>
          <View style={{ flex: 1 }}>
            <CompassCard compact />
          </View>
          <View style={{ flex: 1.25 }}>
            <FuelTankCard />
          </View>
        </View>
      </View>
    </>
  );
});
