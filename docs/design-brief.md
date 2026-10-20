# Custom Head Unit Launcher — Design Brief

A design brief for a custom Android launcher / live dashboard that replaces the stock home screen on an aftermarket head unit in a 2016 Toyota Tacoma. The look is intentionally left open. This document defines what the surface must do, what data it can draw on, and the constraints it lives inside. The visual language is yours to invent.

---

## 0. Before you start — ask me for references

Do **not** produce any visuals yet. Open by asking me for references and inspiration, then wait for my reply before designing. Prompt me across these categories so I have something concrete to react to:

- **Visual / mood:** album art, film and title design, posters, photography, color and material moods, textures.
- **Instruments & dashboards:** gauge clusters, cockpits, watch faces, synth and audio gear, anything with a dial or readout I admire.
- **UI / product:** interfaces, apps, or products whose layout, typography, or restraint I like.
- **Type & graphic language:** typefaces, grids, data-viz, generative or motion work.
- **Anti-references:** what I want to avoid. (Starting point: stock aftermarket car launchers, AGAMA, clip-art gauges, faux-chrome — confirm and add to this.)

Ask for links, image drops, or just names. Once I've given you references, reflect back the direction you're hearing in a sentence or two, then take your first visual pass.

---

## 1. Context & device target

- **Vehicle:** 2016 Toyota Tacoma (base SR, 2.7L 2TR-FE four-cylinder, naturally aspirated, automatic). Daily driver, also used on trails.
- **Head unit:** Dasaita Vivid13, 11.6" 2K IPS, **2000 x 1200 landscape**, Android 13, Qualcomm 665 octa-core, 8GB/256GB. Wireless CarPlay via a built-in module.
- **Role:** This is the device **home screen / launcher**. It is the first thing seen on power-up and what every "home" press returns to.
- **Primary job in one sentence:** Give an at-a-glance, beautiful, glanceable-while-driving instrument surface that also routes quickly into CarPlay, media, and navigation.

---

## 2. Hard constraints (non-negotiable)

- **Landscape, 2000 x 1200.** Design to that aspect ratio. Assume rotation is locked.
- **Glanceable while driving.** Anything safety-relevant (speed, nav prompt, media transport) must be readable in under a second and operable with a single large touch target. No tiny controls, no deep menus on the home surface.
- **Day and night legibility.** Must stay readable in direct desert sun and at night without glare. Plan a dark theme as primary and a high-contrast daylight treatment.
- **Performance budget.** Qualcomm 665, not a flagship. Animations must hold a smooth frame rate; avoid heavy real-time effects that would stutter. The signature animation should be GPU-light.
- **Touch, not mouse.** Finger targets, generous spacing, forgiving hit areas. No hover-dependent affordances.
- **Graceful with missing data.** Most inputs below are optional. The surface must look intentional and complete when an OBD dongle is absent and only GPS, sensors, and media are live. No empty gauges or error spew.

---

## 3. Data inputs (tiered by availability)

Design assuming a clean internal data layer that abstracts these sources. Tiers A and B are live now with zero added hardware. **Tier C (OBD2) is planned — a dongle is on order — so design it in fully now and let each field populate the moment the dongle connects.** Tier D is visible on the unit's own screens but effectively walled off from a custom app. The design should degrade gracefully: complete and intentional on Tiers A and B alone, richer as C comes online.

### Tier A — available now, no hardware (GPS + onboard sensors + system)
- **Speed** (GPS-derived)
- **Heading / bearing / compass**
- **Altitude / elevation**
- **Longitudinal & lateral g-force** (accelerometer) — acceleration, braking, cornering load
- **Pitch / roll** (gyroscope) — confirmed exposed on this unit (it drives the built-in off-road inclinometer)
- **Trip distance, moving time, average speed** (derived from GPS)
- **Time, date, day/night state** (sunrise/sunset or ambient light if exposed)
- **Connectivity status** (WiFi, 4G LTE signal)
- **Battery / system voltage** — available now. The unit self-measures its 12V power feed (not from CAN), so it tracks the battery closely but reads the unit's input voltage rather than a precise terminal value. Good enough for a live battery gauge.

### Tier B — phone & media (Bluetooth + app launching)
- **Now playing** when audio is over Bluetooth or from an app on the head unit: track title, artist, album, **album art**
- **Transport controls:** play / pause / next / previous / seek
- **Volume**
- **App shortcuts / launcher tiles:** Maps, Waze, Spotify, settings, any installed app
- **CarPlay shortcut:** a tile that launches the CarPlay module (see Section 9 for the boundary)
- **Incoming call info** (stretch, via Bluetooth HFP)

### Tier C — full OBD2 (Bluetooth ELM327 / OBDLink dongle — on order, design for it fully)
This is planned, not hypothetical. Design every readout below as a first-class part of the UI, each with an explicit **present / absent** state so it populates the instant the dongle connects and sits gracefully empty until then. All standard Mode 01 live PIDs on this truck. Group as the design sees fit.

- **Powertrain:** engine RPM, vehicle speed, throttle position, accelerator pedal position, calculated engine load, timing advance, MAF, MAP, intake air temp
- **Temperatures:** coolant temp, intake air temp, oil temp (if supported), ambient air temp, catalyst temp
- **Electrical:** **control module / system voltage (battery voltage)** — key health readout
- **Fuel & economy:** fuel level, fuel rate, short/long-term fuel trims, derived **instant and average MPG** (from MAF + speed)
- **Run data:** run time since start, distance since codes cleared, barometric pressure
- **Derived/computed:** estimated horsepower & torque (RPM + load), **0–60 / quarter-mile timers**, live efficiency
- **Diagnostics:** read/clear trouble codes (DTCs), pending codes, freeze-frame, readiness monitors, VIN

> Note: this truck is naturally aspirated, so there is no boost/turbo data. Don't design a boost gauge.

### Tier D — head unit CAN bus (visible on the unit, walled off from a custom app)
The unit's CAN box decodes a set of **body / comfort** signals (not powertrain) and shows them in the firmware's own apps. Confirmed or expected on this Tacoma: **all four doors independently** (including the Access Cab's rear half-doors), **A/C status**, **reverse gear**, **parking radar / sensors**, **steering wheel controls**, and **camera triggers**. **Tire pressure is uncertain** — the factory TPMS may appear in the unit's Vehicle Info / Tire Info app (in kPa) if the box decodes it, or the base truck may only broadcast a warning light. **Speed, RPM, fuel, and coolant are NOT on this list** — those are powertrain signals the Tacoma CAN box does not decode, so they come from Tier C (OBD2).

Critical: all of the above is displayed by firmware apps with **no public API**. Pulling any of it into the custom launcher means reverse-engineering the MCU serial protocol. Treat Tier D as "nice that it exists on the stock screens," not a data source the design depends on.

---

## 4. Functional zones (what the surface must let you do)

The arrangement is open. These are the jobs, not a layout.

1. **Primary motion readout** — speed front and center, instantly legible.
2. **The signature live element** — a data-reactive visualization that is the soul of the screen (Section 5).
3. **Media** — now-playing with album art and transport controls, when audio is on Bluetooth or a local app.
4. **Navigation entry** — quick launch into Maps / Waze, and ideally a compact next-turn or compass cue.
5. **CarPlay entry** — a prominent shortcut tile.
6. **App dock / launcher** — a small set of pinned apps, editable.
7. **Vehicle status** — a discreet area for battery voltage (available now), plus coolant, fuel, and any warning state (these populate when the OBD dongle is connected).
8. **Camera selector** — on-demand front and rear camera views, selectable at any time, with the rear camera continuing to auto-trigger on reverse. (Mechanism in Section 8.)
9. **Off-road mode (stretch)** — an inclinometer / pitch-roll view using the gyro, as an alternate face.

---

## 5. The signature element (open-ended)

This is where to spend the boldness. The brief is a **data-reactive instrument** that makes the act of driving feel alive, not a static gauge cluster. It should respond to real inputs (speed, g-force, RPM/load when available).

Reference moods, offered as starting points and explicitly **not mandates** — feel free to leave all of them behind:
- A Joy Division *Unknown Pleasures* ridgeline that erupts with acceleration (one prototype direction already explored).
- Tesla-style fluid speed/power visualizations.
- Seismograph / oscilloscope / waveform language.
- Something architectural, typographic, or generative that nobody associates with car dashboards.

Constraints on the signature: it must stay glanceable (the data it encodes should be readable at a glance, not just pretty), GPU-light for the 665, and legible day and night. Map at least speed and longitudinal g-force to it; design it to optionally fold in RPM and engine load when OBD is connected.

Take one real aesthetic risk and justify it. The thing to beat is the stock aftermarket launcher look: cluttered grids, clip-art gauges, faux-chrome. Aim for premium, intentional, and unmistakably custom.

---

## 6. Interaction & states

- **Home behavior:** this is the launcher; "home" always lands here.
- **Driving vs parked:** consider a calmer, more information-dense parked state and a stripped, glanceable moving state. (Driving state simpler, not busier.)
- **Day / night:** automatic switch, with night as the hero treatment.
- **No-OBD state:** the default. Must feel complete on GPS + sensors + media alone.
- **CarPlay coexistence:** dash is home, CarPlay is a full-screen app launched from a tile; they switch, they don't composite (Section 9).
- **Quality floor:** large focus/touch targets, reduced-motion respected, no layout shift on data updates.

---

## 7. Creative latitude

The visual identity is wide open: palette, typography, layout, motion, the signature element — all yours to define for this specific brief. The only guardrails are the hard constraints in Section 2 and glanceability in Section 5. Don't default to a generic dark-screen-with-one-accent template just because it's a car; ground the choices in this truck and this driver (a builder/designer who finds stock launchers ugly and wants something with a real point of view). Spend boldness on the signature, keep everything around it quiet and disciplined.

---

## 8. Technical target (for the eventual build)

- **Stack:** Expo / React Native, with **react-native-skia** for the signature visualization (the prototype's per-frame path drawing maps almost 1:1 to Skia's Canvas + Path).
- **Data:** `expo-location` (speed/heading/altitude), `expo-sensors` (accelerometer/gyro), an OBD2 library over Bluetooth for Tier C, Android MediaSession / AVRCP for media metadata and control.
- **Launcher:** add the `CATEGORY_HOME` intent filter via an Expo config plugin + prebuild so it can be set as the device home.
- **Architecture ask:** build a single data-source abstraction so the visualization runs on **simulated data today** and swaps to **live data** (GPS, sensors, OBD) without touching the render layer. Design the UI against that interface.
- **OBD readiness:** expose every Tier C field through that data layer with an explicit present/absent state, so the UI binds to all of them now and each lights up the moment the dongle connects.
- **Camera selector:** camera views are handled by the head unit's built-in front-camera app (unlocked in factory settings, password `126`), which switches the video source between the front and rear inputs. The launcher's selector triggers or launches that view rather than rendering the feed in a custom viewport. Adding the front camera requires a physical camera wired to the unit's F-Cam input; the rear continues to auto-trigger on reverse.
- **Delivery:** sideload via ADB to the head unit. Design for the 2000 x 1200 landscape panel.

---

## 9. CarPlay integration boundary (read before designing media/nav)

- **Launching CarPlay:** supported and easy — a tile fires the CarPlay module via intent.
- **Embedding CarPlay UI:** not possible. It renders full-screen from the phone over Apple's encrypted pipeline; it can't be windowed inside the dash.
- **Reading CarPlay now-playing / nav data:** not possible. That data never leaves the CarPlay module; there is no API.
- **Therefore:** the media widget and any now-playing UI must be driven by the **Bluetooth / local-app** path (Section 3, Tier B). Design the now-playing widget for that source, and treat CarPlay purely as a launch destination, not a data source.
