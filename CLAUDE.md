# Tally — Qamar night studio

Ben's personal music project. This repo was an empty shell ("Tally v1") and was deliberately repurposed for this on 2026-08-26. The app began life on the `claude/modular-music-synthesizer-e61t3c` branch of `benweininger-spec/town-hall` (history preserved there); this repo is now the canonical home.

## What this is

`index.html` is the entire app: **Qamar**, a self-contained Web Audio instrument. No build step, no dependencies, no server. Open it in a browser or serve the folder statically. Live artifact copy: https://claude.ai/code/artifact/a97ffbad-e235-455d-a81c-f176cf1159d0 (republish from the session that owns it, or pass its URL when publishing from elsewhere).

Feature summary is in README.md. Architecture, in one paragraph: a lookahead scheduler (25ms tick, 0.13s horizon) drives a 64-step (4-bar) loop; pitch is computed in **cents from a root midi note**, which is what makes quarter-tone maqamat (Rast, Bayati, Saba) work; melodic tracks are patch objects whose parameters are written through by macro controls (XY "character" pad sets cutoff, attack, release, filter env, env speed, resonance together; motion sets LFO; space sets sends; a global atmosphere pad scales every voice's cutoff and sends at play time); generators (`genLeadSteps`, `genBassSteps`, `genDrumSteps`, `varyMel`) are scale-constrained with chord tones pinned to strong beats; the outrun canvas scene (sun, spectrum ridge, kick-pulsed grid, pitch-colored comets) reads the analyser and a `vizQ` event queue. State persists to localStorage key `qamar-v2`.

## Conventions

- Keep it one self-contained file. Resist splitting until there is a real reason.
- Do not remove the iOS audio-unlock block (silent looping media element + AudioContext resume on touch/visibility). Without it the app is silent on iPhones with the ring switch on silent.
- Smoke-test changes headlessly before pushing: Playwright + Chromium, click play, drive the UI, assert no page errors. Prior test scripts lived in the cloud session scratchpad; recreate as needed (load page via file://, `--autoplay-policy=no-user-gesture-required`).
- Copy style: plain language, no mid-sentence em dashes.

## Roadmap (agreed with Ben)

1. **Genre presets**: a genre picker seeding BPM, drum template, swing, scale, and patch kit (house, lo-fi, synthwave, DnB, reggaeton, phonk, bossa, ambient...). Idiomatic BPM/key/character data can be adapted from the claude-music repo's `references/genre-recipes.md` (see below).
2. **Song sections**: A/B patterns per track plus an arrangement lane (intro / groove / breakdown / drop). Biggest structural upgrade; currently one 4-bar loop.
3. **ACE-Step on Ben's Mac** (M1 Max, 32-core GPU, 64GB unified memory, no CUDA):
   - Install ACE-Step 1.5 (https://github.com/ace-step/ACE-Step-1.5). It supports Apple Silicon via MPS/MLX; use its macOS launch scripts (`start_gradio_ui_macos.sh`, `start_api_server_macos.sh`) or the portable macOS package. 64GB is ample; expect generation to take minutes, not the advertised seconds (those are CUDA numbers).
   - Optional: the claude-music Claude Code plugin (https://github.com/AgriciDaniel/claude-music) wraps ACE-Step with `/music` skills. Vetted at commit 5aa0173 (2026-08-26): clean, no telemetry, localhost-only dashboard, real threat model. **But it is CUDA-only as shipped**: `scripts/music_engine.py` hardcodes `device="cuda"`, `detect_gpu.sh`/`check_deps.sh` gate on `nvidia-smi`, and the default config enables flash attention. To use on the Mac, patch device selection to fall back to `mps`, bypass the nvidia-smi gates, and disable flash attention; consider offering the patch upstream as a PR.

## Working locally vs in the cloud

Cloud sessions cannot run ACE-Step (no GPU) and cannot hear audio; they can build and headless-test the web app. Anything involving ACE-Step installation, audio quality judgment, or LoRA training has to happen in a local session on the Mac.
