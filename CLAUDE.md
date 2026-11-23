# OASIS: Collaborative Browser DAW (project brief)

> Last updated: 2026-11-22 (Sun). Full plan doc: https://claude.ai/artifact/AjxECy8YQy83iD5U1YBEUr

---

## 1. Who I am and how to work with me

- **Brahima Ann (artist name HIMA):** musician, producer, mixing engineer and videographer in Minneapolis. I have a CS degree (UST '24) and build with TypeScript/React/Next.js and C++/JUCE (VST3). I produce in Ableton Live.
- **Solo build with AI help.** Claude Code writes, runs and tests. I review.
- **Working style:** question me and pick ideas apart before building, then plan together. When there's a choice, give **three ranked options with your pick**. Explain jargon in plain words. Keep replies short.
- Never commit secrets (API keys, tokens, Clerk/LiveKit keys) to the repo. Use `.env` files, and keep them out of git.

## 2. What OASIS is

A **browser-first collaborative DAW**. Open a link and you're in the same session. It combines an **FL Studio-style channel rack** (16-step grid, one row per sound) with **audio tracks for vocals**, live text chat and calls. It should be as easy as BandLab.

**Use cases:**
1. **Two producers in different cities** on one beat, one on melody and one on drums. *This is the first one we build.*
2. Two singer-songwriters laying down vocals together.
3. **Me engineering artists remotely:** they hop on, I capture their vocals, I mix.

**The pain it fixes:** Prince (a producer in my circle) makes great beats, but when I'm out of town or there's no studio, we send files back and forth. So do the producers he works with.

**The gap (from the research):** no product pairs an FL-style channel rack with engineer-grade remote vocal capture in a browser. The closest rival is SoundBridge v3 Virtual Collaboration, which is desktop-only and has no rack.

**First users:** my circle (Prince, Gibby, MALIK, MRND/Sanktuary creatives), then Twin Cities artists.

## 3. Locked decisions (2026-11-22)

| Decision | Choice |
| --- | --- |
| Collaboration model | **A + B:** a shared project with live edits, plus the host streaming the mix and talkback. **Not** live jamming in sync |
| Platform | Browser first, then desktop (Tauri + JUCE) and a plugin later |
| VST plugins | Not in v1. They come with the desktop version |
| Ships first if the week runs short | **Producer room:** shared channel rack + stem export |
| Communication | Room text chat + voice call (video optional) |
| Hosting | **My home server** (the Sanktuary OS machine), except calls |
| Engine standard | Web Audio + AudioWorklet. Tone.js for week 1, then WebAssembly DSP from week 2 |
| Business model | Not decided. The research leans "host pays, guests always free" |
| Week 1 deadline | Usable in a real session on **Sun 2026-11-29** |

## 4. Core architecture: "Play locally, sync the edits, record locally, send the file"

- **Each browser runs the whole audio engine and plays the project itself.** Only edits travel over the internet (for example "row 3, step 7, on"), so internet lag never touches the music.
- **Vocals are recorded on the performer's machine** against their own local playback, as raw PCM in an AudioWorklet. Takes upload losslessly in the background.
- **The call is only for hearing and talking.** It's never the recorded take.
- **One-shots and samples are stored once by content hash** (SHA-256), uploaded once to the server's sample pool, and referenced from the project by ID. Each browser downloads and caches every sound once. Changing pitch, trim or volume only edits settings.

## 5. Stack

| Layer | Pick |
| --- | --- |
| App | **Vite + React + TypeScript + Tailwind**. A single-page app served by my home server |
| UI kit | **audio/ui by Ouest Labs** (https://www.audio-ui.dev, `ouestlabs/audio-ui`, MIT, shadcn-style copy-in). Test its Sequencer and Knob on day 1. Fallback: our own grid + `HowdyMoto/Knobs` (MIT) |
| Screen-only state | Zustand (zoom, selection). **Project data lives in Yjs, not Zustand** |
| Audio engine | Web Audio + **Tone.js** (Transport, Sampler). Playhead and step lights drawn on a canvas with requestAnimationFrame, **outside React renders** |
| Shared project | **Yjs** + **Hocuspocus** sync server (SQLite persistence) on the home server. Presence via Yjs awareness |
| Undo | `Y.UndoManager` scoped to the local client's edits, so each person only undoes their own work |
| Sign-in | **Clerk** (already running on Sanktuary OS). Hocuspocus `onAuthenticate` verifies the token |
| Files | Home server drives (Seagate 5TB), behind the Cloudflare Tunnel. **tus** resumable chunked uploads |
| Calls | **LiveKit Cloud** (WebRTC). The tunnel can't carry UDP call traffic, so calls don't run on the home server |
| MIDI keyboards | Web MIDI API |
| Export | OfflineAudioContext / `Tone.Offline`, rendered per track for stems, then a WAV encoder |
| Later engine | AudioWorklet + C++/Rust → WebAssembly. Evaluate **Elementary Audio** (one DSP graph for both AudioWorklet and JUCE). Check its license first |

**Home server context:** Sanktuary OS runs at https://sanktuary.studio. It's a Node server on 127.0.0.1:3080, exposed through a Cloudflare Tunnel (Docker). Auto-deploy pulls from `main`, tests, builds, swaps and restarts. Team files are on external drives. **Watch out for:** home upload speed, the PC staying on, a backup drive (one drive isn't a backup), and Cloudflare's per-request upload cap (so uploads go in chunks).

## 6. Project schema (lock on Monday, engine-agnostic)

```
Y.Doc
├─ meta      Y.Map   { bpm, timeSig, swing, name, version, playState: { playing, startedAtServerMs, bar } }
├─ sounds    Y.Map   soundId -> { hash, name, url, durationS, sampleRate }
├─ patterns  Y.Map   patternId -> Y.Map { name, length (16|32|64), rows: Y.Map rowId -> Y.Map { soundId, steps: Y.Map stepIndex -> velocity 0-1 (missing = off), pitch, gain 0-1, pan 0-1, mute, solo } }
├─ tracks    Y.Map   trackId -> { kind: 'audio', name, clips: Y.Map clipId -> { takeId, startBeat, trimIn, trimOut, gain, nudgeMs } }
├─ takes     Y.Map   takeId -> { hash, url, peaksUrl, recordedBy, latencyCompMs, uploadState }
├─ mixer     Y.Map   channelId -> { gain 0-1, pan 0-1, mute, solo, fx: [] }
└─ chat      Y.Array { id, userId, name, text, ts, atBeat? }
```

Rules:
- Every row, step, clip, sound and take has its **own ID**, so concurrent edits never collide.
- Parameters are normalized to 0–1.
- **No audio bytes in Yjs.** Store only hashes and URLs.
- Version the schema from day 1 so a future JUCE engine can read the same document.
- Steps are a Y.Map keyed by step index, not a Y.Array: two people toggling the same step at once must end with one value (a Y.Array delete+insert would leave two). Changed 2026-11-23.
- The code lives in `app/src/doc/schema.ts` (SCHEMA_VERSION = 1). Change both together.

## 7. Week 1 build plan (Shape Up: the time is fixed and the scope bends)

1. **Mon 11/23: Room + clock.** Vite app, Clerk sign-in, a Hocuspocus server on the home server, `/room/:id` links, presence (who's in), shared play/stop/BPM, room text chat. Lock the schema. Test audio/ui. *Done when two tabs play and stop together.*
2. **Tue 11/24: Channel rack + one-shots.** A 16-step grid, a starter drum kit, drag-in samples (hash → upload once → cache), per-row volume and mute. *Done when edits in one tab show and play in the other.*
3. **Wed 11/25: Vocal capture.** AudioWorklet raw-PCM recording against the beat, a 3-second loopback calibration wizard per device, a Bluetooth warning, a ±50 ms nudge, chunks saved to IndexedDB/OPFS during the take, a tus resumable upload, takes on a timeline, and audio loop drop-in. *Done when a take recorded in tab A lines up in tab B.*
4. **Thu 11/26: Thanksgiving.** Off, or catch up.
5. **Fri 11/27: Live room.** LiveKit with two channels: **Talkback** (voice-tuned) and **Studio reference** (stereo, 256 kbps Opus, `echoCancellation/noiseSuppression/autoGainControl: false`). Add a **"Follow host"** transport toggle using an NTP-style clock offset (start at server time + 150 ms). *Done when I can talk someone through a take.*
6. **Sat 11/28: Mixer + export.** Volume, pan, mute and solo per track. Stems plus a full WAV bounce. Deploy to the real URL.
7. **Sun 11/29: Real sessions.** One beat session with Prince and another producer, and one vocal session with an artist. Log every annoyance.

**Circuit breaker:** if a day runs over, cut from that day's list. Cut Shoulds first, then the live stream. Stem export alone already beats sending files.

**Scope after week 1:** a piano roll + built-in synth, patterns + a playlist (FL-style arranging), mixer FX (EQ, compressor, reverb), version snapshots, accounts and a project library. Later: take comping, punch-in, timeline comments, a phone listen/comment view. **Won't (v1):** VSTs, live jamming, the DAW plugin.

## 8. Reference code map (read 2026-11-22)

| Day | Repo → file | What to take |
| --- | --- | --- |
| Mon | `ueberdosis/hocuspocus` → `playground/backend/src/default.ts`, `packages/server/src/types.ts`, `packages/provider` | A roughly 15-line SQLite-backed server. The `onAuthenticate`, `onLoadDocument` and `onStoreDocument` hooks. Awareness for presence |
| Tue | `stevekinney/socket-synth` → `index.js` | The anti-pattern: it resends the whole pattern on every click |
| Tue | `KGAudioLab/K.G.Studio` → `src/core/audio-interface/KGToneBuffersPool.ts` | Load each sound once, with a map of in-flight loads |
| Wed | `naomiaro/waveform-playlist` → `packages/worklets/src/worklet/recording-processor.worklet.ts`, `packages/core/src/utils/latency.ts`, `packages/dawcore/src/controllers/recording-controller.ts`, `packages/webaudio-peaks` | Raw PCM recording, latency offset, the record flow, waveform peaks (MIT) |
| Wed | `gilpanal/weblatencytest` | Loopback calibration by cross-correlation |
| Sat | K.G.Studio → `KGOfflineRenderer.ts`, `KGTrackFXChain.ts`, `KGAudioBus.ts` | Faster-than-real-time bounce, FX/bus routing |
| Sat | waveform-playlist → `packages/browser/src/utils/wavEncoder.ts`, `hooks/useExportWav.ts` | WAV encoding |
| Later | `ryohey/signal` (MIT) | Piano roll |
| Later | `andremichelle/openDAW` (AGPL, **ideas only**) | Rust/Wasm engine, .wclap plugins |
| Desktop v2 | `nota-daw/nota` (AGPL, **ideas only**; desktop C#/.NET + C++20, about 765 stars, active Nov 2026) | Blueprint for the future desktop OASIS: a portable C++ engine behind one narrow C ABI, with JUCE isolated to VST3/AU hosting only. Also "Nota Remote" (a Svelte phone app over one WebSocket, a model for our phone listen/comment view) and an MCP server so AI can drive the DAW |

**UX references:** FL Studio's channel rack, BandLab Studio, GridSound (live app only; its engine repo is private).

**Licenses:**
- **Code we can reuse (MIT/Apache):** waveform-playlist, Hocuspocus, Yjs, Signal, audio/ui, Knobs, g200kg controls.
- **K.G.Studio** (Apache 2.0 + extra terms): if we use its code, show "Powered by K.G.Studio, © 2025-2026 Xiaohan Tian" on an About screen.
- **Ideas only, no copying:** openDAW and GridSound (AGPL), cutoff AudioUI (GPL/paid), RapiDAW and studio-online (no license).

## 9. Known risks and their fixes

| Risk | Fix |
| --- | --- |
| Takes land late (browser/USB/Bluetooth latency) | Calibration wizard per device, Bluetooth warning, manual nudge |
| Feedback and echo | Headphones required, with a check when you enter the room |
| React re-renders starve the audio clock | Canvas playhead with rAF, audio state outside React |
| A take is lost to a Wi-Fi drop or refresh | Local chunk storage + tus resumable upload |
| Safari/iOS quirks | Desktop Chrome/Edge is the v1 studio. Phones are listen/comment only |
| Home PC goes offline | Browsers keep working locally and resync. Add a backup drive |
| One week is tight | The circuit breaker (see section 7) |

## 10. Open questions

- [ ] Final product name (working name: **OASIS**)
- [ ] Who's in Sunday's sessions besides Prince: which producer, and which artist for vocals?
- [ ] Is it a Sanktuary or MRND product, or its own brand?
- [ ] Business model (lean: host pays, guests free; session passes as an add-on)
- [ ] My home internet upload speed (sets how fast collaborators load sounds)

## 11. Research on file

- Plan doc (living): https://claude.ai/artifact/AjxECy8YQy83iD5U1YBEUr. It also holds the reusable deep-research prompt.
- "Collaborative Browser DAW Architecture Study" (15-page PDF, Nov 2026): market table, latency and calibration methods, Yjs schema/undo, WebRTC music settings, cost projections, business models. Its sources weren't independently verified.

## 12. First prompt for Claude Code (Monday)

```
Read CLAUDE.md. Then scaffold OASIS in this repo:
1. Vite + React + TypeScript + Tailwind app in /app; Hocuspocus server (SQLite) in /server.
2. Add the Yjs schema from section 6 as typed helpers in /app/src/doc (versioned).
3. Clerk sign-in; Hocuspocus onAuthenticate verifies the Clerk token.
4. /room/:id route: presence list (awareness), shared play/stop/BPM via meta.playState, Tone.js Transport started locally on change, room chat.
5. Install audio/ui and render a test Sequencer + Knob; report whether it fits.
6. Add COOP/COEP headers (needed for SharedArrayBuffer later).
Done when two browser tabs play and stop together and chat syncs. Give me three ranked options at any real decision point.
```

## 13. Running it locally

```
npm install                 # from the repo root (npm workspaces: app + server)
npm run dev:server          # Hocuspocus on :1234, SQLite in server/data/
npm run dev:app             # Vite on :5173, proxies /sync and /time to the server
npm run e2e                 # two-tab smoke test (both dev servers running, DEV mode)
npm start                   # production: builds the app, server serves it + /sync + /time
```

- **Hosting (decided 2026-11-22):** `oasis.sanktuary.studio`, its own process on port 3090 beside the Sanktuary OS site, one more Cloudflare Tunnel hostname. Steps: `docs/DEPLOY.md`.

- No Clerk keys = DEV mode: you type a name, and the server lets anyone in. Set `VITE_CLERK_PUBLISHABLE_KEY` (app/.env.local) and `CLERK_SECRET_KEY` (server/.env) to turn sign-in on.
- The browser only talks to one origin: `/sync` (WebSocket) and `/time` (clock offset) are proxied to the server. Production should do the same behind the tunnel.
- COOP/COEP use `credentialless` (not `require-corp`) so Clerk's scripts and avatars still load.
- audio/ui components are copied into `app/src/components/audio-ui` from the `base-nova` style of `ouestlabs/audio-ui` (MIT). Its site is the shadcn registry, so re-copy from there to update.
