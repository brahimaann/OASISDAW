/**
 * Synth drums for the UI kit test pattern. Placeholder until Tuesday's
 * sample-based kit. Reads the doc at play time, so edits from anyone are heard.
 */
import * as Tone from "tone";
import type * as Y from "yjs";
import { getPatterns, type RowFields, type TypedMap } from "@/doc/schema";
import { STEPS_PER_BAR } from "@/engine/transport";

export const TEST_PATTERN_ID = "uikit-test";
export const TEST_ROWS = [
  { id: "uikit-kick", label: "Kick", soundId: "synth:kick" },
  { id: "uikit-snare", label: "Snare", soundId: "synth:snare" },
  { id: "uikit-hat", label: "Hat", soundId: "synth:hat" },
] as const;

type Voice = (time: number, velocity: number) => void;

let voices: Record<string, Voice> | null = null;

function makeVoices(): Record<string, Voice> {
  const kick = new Tone.MembraneSynth({ octaves: 6, pitchDecay: 0.05 }).toDestination();
  const snare = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.15, sustain: 0 } }).toDestination();
  const hat = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.03, sustain: 0 } });
  hat.connect(new Tone.Filter(8000, "highpass").toDestination());
  snare.volume.value = -8;
  hat.volume.value = -14;
  return {
    "synth:kick": (t, v) => kick.triggerAttackRelease("C1", "8n", t, v),
    "synth:snare": (t, v) => snare.triggerAttackRelease("16n", t, v),
    "synth:hat": (t, v) => hat.triggerAttackRelease("32n", t, v),
  };
}

/** Plays the test pattern on the local Transport. Returns a stop function. */
export function playTestPattern(doc: Y.Doc): () => void {
  voices ??= makeVoices();
  const transport = Tone.getTransport();
  const id = transport.scheduleRepeat((time) => {
    const pattern = getPatterns(doc).get(TEST_PATTERN_ID);
    const rows = pattern?.get("rows");
    if (!rows) return;
    const step = Math.round(transport.getTicksAtTime(time) / (transport.PPQ / 4)) % STEPS_PER_BAR;
    rows.forEach((row: Y.Map<unknown>) => {
      const r = row as TypedMap<RowFields>;
      if (r.get("mute")) return;
      const v = r.get("steps")?.get(String(step)) ?? 0;
      const voice = voices?.[r.get("soundId") ?? ""];
      if (v > 0 && voice) voice(time, v * (r.get("gain") ?? 1));
    });
  }, "16n", 0);
  return () => {
    transport.clear(id);
  };
}
