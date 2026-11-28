# OASIS app

Vite + React + TypeScript + Tailwind. See the root `CLAUDE.md` for the plan and how to run it.

- `src/doc` — the shared Yjs schema (versioned) and its helpers
- `src/sync` — Hocuspocus connection, presence, server clock offset
- `src/engine` — Tone.js transport that follows the shared play state
- `src/room` — room UI: transport, presence, chat, audio/ui test
- `src/components/audio-ui` — copied-in audio/ui components (MIT, Ouest Labs)
