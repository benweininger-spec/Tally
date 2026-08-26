# Tally — home of Qamar, a night studio

A personal, self-contained browser instrument with no build step. Formerly developed on a branch of the town-hall repo; this repo is now its home.

Open `index.html` directly in a browser (or serve the folder statically). Everything is synthesized live with the Web Audio API; nothing is recorded or sent anywhere. Patterns save to the browser's localStorage.

What's inside:

- A 16-step sequencer over 4 bars: four synthesized drum voices (kick, clap, hat, perc), a mono bass grid, a chord track driven by a progression, and a lead melody grid.
- A patch bank (Deep Sub, Acid Pluck, Warm Pad, Glass Keys, Oud Pluck, Ney Breath, Night Bell, Rhaita Horn, Dusk Strings). Each patch carries a "pairs well with" hint and a Build Around This button that sets the other tracks, scale, and progression to match it.
- Macro controls instead of dial farms: each voice has an XY character pad (dark to bright, soft to plucky) that drives six synth parameters at once, plus motion (LFO rate and depth) and space (delay and reverb sends) macros. A global atmosphere pad (dry to vast, dusk to neon) reshapes the whole mix. The full parameter set stays available under a fine-controls fold.
- Pattern generators: riff writes a new melody with chord tones pinned to strong beats so it stays inside the harmony, groove writes basslines, new beat rolls drum patterns, vary nudges what is there, and an evolve toggle mutates the melody a little every four bars while playing.
- Scale and maqam theory built in: Western modes plus Hijaz, Rast, Bayati, and Saba, with quarter tones rendered exactly because pitch is computed in cents. Each scale and progression carries a short explainer.
- Chord progressions built by stacking scale thirds, one chord per bar, with pad, stab, and arp styles. Bass can follow the chord roots.
- Scale pads playable from the computer keyboard. Space bar toggles transport.
- Tempo-synced delay, generated-impulse reverb, drive, and a compressor on the master bus.
- An outrun night scene behind everything: a scanlined sun whose color follows the notes, a mountain ridge lifted by the live spectrum, a perspective grid that pulses on the kick, and melodic notes streaking as comets colored by pitch. A Scene button fades the panels away for full-screen listening.

Three scene presets show the range: Deep House (Dorian, i–VI–III–VII, 122 BPM), Desert Night (Hijaz over a drone, maqsum-flavored percussion), and Study Flow (major pentatonic, slow arp, 76 BPM).
