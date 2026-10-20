# Design decisions — kickoff session

Context: the brief (`design-brief.md`) and the HTML mockups (`../Design Directions/`)
came out of a ChatGPT thread that started on GTO speakers and ended on this
launcher. They produced a strong, coherent direction but left the actual choices
open. This log records what we locked and why.

## The critique that drove the decisions

- **Five candidate signatures = no signature.** The mockups offered ridgeline,
  oscilloscope pulse, terrain mesh, radar scope, friction circle, and twin pods.
  The brief wants one soul element. We had to pick.
- **The prettiest signatures were the least informative.** Ridgeline/terrain/scope
  are ambient mood, not readouts — they fail the brief's own "readable at a glance"
  test. The friction circle is precise but only meaningful when driving hard.
- **Three "faces" were actually modes.** Grip, Trail, Scope read as sport/off-road
  alternates, not a default home. Only Cluster and Ridgeline read as "home."
- **Two self-contradictions with the hard constraints:** (1) "AWAIT OBD —" dashes
  on a day-one no-dongle screen violate "no empty gauges"; (2) every mockup is dark
  amber-on-black, the worst case for the "readable in direct desert sun" constraint,
  and the daylight treatment was undesigned.

## Decisions

1. **Default home face = clean hybrid.** A single surface "home" always returns to:
   speed-centric hero signature + media/nav/vehicle rail + dock. Grip/Trail/Scope
   become alternate mode faces in a later milestone.

2. **Signature = PulseTach** (Tesla Model S energy-graph model, per
   `../REFERENCES/model s example.jpg`). A scrolling, filled **longitudinal-g
   waveform** wrapped by a **radial ring**. The ring reads **ground speed before
   OBD** and **engine RPM (with redline) once the dongle connects** — the dash
   "levels up" on connect. The **center number is always ground speed** (the safety
   glance). Three distinct signals (speed, ring, g-pulse); no number shown twice.
   This resolves the risk-vs-information tension: the ring gives a precise readable
   value while the waveform carries the mood.

3. **Amber is the shipped theme.** The references vote overwhelmingly for amber VFD.
   The system is tokenized/themeable, but we ship one theme — building the mono /
   teal / red directions now would be wasted motion.

4. **SVG now, Skia later.** Milestone 1 uses `react-native-svg` so it runs on web
   and Expo Go on first launch. Geometry lives in `src/lib/pulse.ts`; the Skia port
   for Snapdragon-665 performance is milestone 2 and won't touch data wiring.

5. **Vehicle panel reads complete without OBD.** Tier-A data (voltage, trip, avg,
   altitude) fills it today; OBD replaces those with coolant/fuel/MPG on connect.
   No empty dashes, ever.

6. **Build sim-first.** The first milestone is the data abstraction + simulator +
   one live screen, no native. This de-risks everything: the design gets locked
   against fake data before any launcher/native-module/Bluetooth work begins.

## Live-data session (M2) — decisions

7. **All live math is pure + in `src/lib`; providers are thin.** Conversions, IMU
   frame rotation, the ELM327 parser, and derived metrics live in unit-tested,
   import-free modules so `npm run verify` covers the risky logic. `LiveDataSource`
   and `src/data/live/**` only do wiring + native I/O. This is what lets us trust
   OBD/IMU code we can't run on hardware here.

8. **Live source is dynamic-imported; web stays sim-only.** `LiveDataSource` is
   `import()`-ed only on native + live mode, so the web bundle never includes a
   native module (verified: Metro splits it into its own chunk). `settings.web.ts`
   uses `localStorage`; native uses async-storage. Acceptance: web runs unchanged.

9. **OBD behind a swappable `ObdTransport`.** Classic SPP (`react-native-bluetooth-classic`)
   for the cheap ELM327 clones now; a BLE transport (OBDLink MX+) drops in behind the
   same interface later without touching any PID logic — the `DataSource` philosophy
   one layer down. Pair once + connect by MAC to skip the scan/location prompt.

10. **In live mode, `system.voltage` is OBD-only.** Per the live-data brief: the
    unit's 12V input has no clean Android API and isn't on CAN, so voltage stays
    `absent` until OBD control-module voltage (PID 42). The sim still fakes a Tier-A
    voltage. (Revisit if a Dasaita/MCU serial route turns up.)

11. **One sanctioned component touch: the SET tile.** The "no component edits" rule is
    about proving a data-source swap changes zero components — it does. To satisfy
    "wire the SET dock tile to a settings sheet," the sheet is an **app-level overlay**
    (`src/settings/`), and the only component change is wrapping SET in a `Pressable`.
    No data rendering changed. `types.ts` gained one *optional* `obd.zeroToSixtySec`.

12. **MPG constant corrected to 11.428** (not the often-quoted 710.7, which is for
    other units and gives absurd MPG with MAF in g/s). Derived from AFR 14.7 + 6.17
    lb/gal; unit-tested. The 0–60 timer is GPS-armed (smoother than OBD speed).

13. **Tier B (media) is staged, not active.** The Kotlin module lives in `native/`
    (not autolinked) so it can't break the first Tier-A build; activate per
    `native/media-bridge/README.md`. The JS degrades to `absent` if it's not built in.

## Still open / to revisit

- **Daylight (desert-sun) treatment.** `amberDay` exists but is unproven on the
  actual panel in direct sun. Treat as a real requirement, not polish.
- **Signature center pre-OBD.** Speed is the center number always; confirm this still
  feels right once RPM is live and speed has to share the hero with it.
- **Which modes ship, and the gesture to switch faces.** Deferred to M4.
- **Font loading on native.** Web uses CDN; native needs `expo-font`.
