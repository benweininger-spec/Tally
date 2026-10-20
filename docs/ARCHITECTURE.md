# Architecture

## The one rule

The render tree never imports a concrete data source. It depends only on the
`DataSource` interface and the `DashboardData` shape (`src/data/types.ts`).

```
GPS / sensors / OBD / media  ─┐
                              ├─►  DataSource  ─►  DataSourceProvider  ─►  components
SimulatedDataSource  ─────────┘     (interface)      (React context)        (UI)
```

Swapping the simulator for live hardware is a one-line change at the provider:

```tsx
<DataSourceProvider source={new LiveDataSource()}>
```

No component knows or cares where the bytes came from. This is what lets the whole
design be built and judged today on fake data, then go live without a UI rewrite.

## Signals: present / absent is first-class

Every readout is a `Signal<T>`:

```ts
interface Signal<T> { value: T | null; status: 'live' | 'stale' | 'absent'; updatedAt: number | null; }
```

`status: 'absent'` is a normal, designed state — not an error. The UI inspects it
with `has(signal)` and chooses to show the value, dim it, or offer a connect
affordance. This is how the dashboard stays "complete and intentional" with no OBD
dongle (design brief §2), and how every Tier-C field can exist in the layout now
and light up the instant the dongle connects (design brief §3 Tier C).

## Data tiers → where they come from

| Tier | Source | Status today | Lives in |
|------|--------|--------------|----------|
| A | GPS, accelerometer, gyro, system voltage | live (simulated now; `expo-location`/`expo-sensors` later) | `motion`, `trip`, `system` |
| B | Bluetooth A2DP/AVRCP, app launching | live (simulated now; MediaSession later) | `media` |
| C | OBD2 ELM327/OBDLink (dongle on order) | absent until connected | `obd` |
| D | head-unit CAN body signals | walled off, no API | `body` (supported:false) |

## High-frequency path

The signature waveform needs frequent samples. The source owns fixed-length ring
buffers (`History.longG`, `History.speed`) and exposes a cheap `getHistory()`.
The provider ticks the snapshot (~30fps in the sim); components read history fresh
each render. Milestone 2 should move the waveform onto Skia and, if needed,
decouple its sampling from React state to keep the 665 smooth.

## Render-engine independence

The signature's *geometry* (arc paths, ticks, waveform path) is pure and lives in
`src/lib/pulse.ts` with no React/SVG/Skia imports. `PulseTach.tsx` is just the SVG
binding. The milestone-2 Skia version consumes the same `src/lib/pulse.ts` output,
so swapping renderers does not touch data flow or geometry.

## Testability

`src/lib/*` and `SimulatedDataSource` are runtime-self-contained (type-only
relative imports). `npm run verify` runs them in Node via `--experimental-strip-types`
— no Metro, no native, no install beyond dev deps. Keep them that way.
