# 2TR-FE — Tacoma Dash

A custom Android launcher / live instrument dashboard for a Dasaita Vivid13 head
unit in a 2016 Toyota Tacoma. Built sim-first: the whole UI runs on simulated
telemetry today and swaps to live GPS / sensors / OBD without a UI rewrite.

## Quick start

```bash
npm install
npm run web      # 2000×1200 dashboard in the browser (sim), scaled to your window
npm run verify   # logic checks: signature geometry, sim, units, IMU, ELM327, derived
```

**Live data on the head unit** (GPS + sensors now, OBD when the dongle's paired):
build an Expo dev client and sideload via ADB — see **`docs/M2-LIVE-BUILD.md`**.
In-app, **SET → DATA SOURCE → LIVE** flips sim↔live at runtime.

## What you're looking at

The **clean-hybrid home face**: ground speed front-and-center inside the
**PulseTach** signature (a longitudinal-g oscilloscope wrapped by a ring that reads
speed now / RPM once an OBD dongle is connected), a media + compass + vehicle rail,
and an app dock with a CarPlay launch tile. All values are live-simulated.

## Where things are

```
App.tsx                     providers + web font loading
src/data/                   data abstraction (interface, simulator, provider, settings)
src/data/live/              LiveDataSource + GPS/IMU/OBD/media providers (native only)
src/theme/                  amber tokens (themeable) + day/night
src/lib/                    pure, unit-tested math: pulse, units, imu, elm327, derive
src/components/             header, media, compass, vehicle, dock, Stage
src/components/signature/   PulseTach — the signature element
src/settings/               app-level settings overlay (source mode + live controls)
src/screens/HomeScreen.tsx  the 2000×1200 layout
native/media-bridge/        staged Kotlin module for Tier-B now-playing (opt-in)
plugins/                    Expo config plugin (Bluetooth permissions)
scripts/verify.ts           Node logic checks (no native deps)
docs/                       design brief, architecture, decisions, M2 build guide
```

Start with **`CLAUDE.md`** — it's the project's central brain (state, architecture,
decisions, roadmap).
