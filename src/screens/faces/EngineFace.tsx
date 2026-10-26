import React from 'react';
import { View } from 'react-native';
import { CoolantCard, FuelRateTile, LoadThrottleCard, RpmCard } from '../../components/engine/EngineHero';
import { EngineGrid } from '../../components/engine/EngineGrid';
import { MpgCard } from '../../components/engine/MpgCard';
import { CheckEngineCard } from '../../components/engine/CheckEngineCard';
import { PerfTiles } from '../../components/engine/PerfTiles';

/**
 * ENGINE — everything the OBD2 dongle knows, on one face: RPM / coolant / load hero on
 * the left, every remaining PID as a tile in the middle, fuel economy (live + 30-day
 * history), trouble codes and performance on the right. Tier C: with no dongle every
 * block renders complete in its absent state. Header, dock and ambient background are
 * shared (HomeScreen). Stage coordinates (2000×1200); content between y 116 and 1002.
 */
const TOP = 116;
const H = 886;

export const EngineFace = React.memo(function EngineFace() {
  return (
    <>
      <View style={{ position: 'absolute', left: 48, top: TOP, width: 600, height: H, gap: 16 }}>
        <RpmCard />
        <CoolantCard />
        <LoadThrottleCard />
        <FuelRateTile />
      </View>

      <View style={{ position: 'absolute', left: 672, top: TOP, width: 600, height: H }}>
        <EngineGrid />
      </View>

      <View style={{ position: 'absolute', left: 1296, top: TOP, width: 656, height: H, gap: 16 }}>
        <MpgCard />
        <CheckEngineCard />
        <PerfTiles />
      </View>
    </>
  );
});
