/**
 * Built-in synth drums, one set per rack row so each row has its own
 * volume and pan. Placeholders until real one-shots arrive.
 */
import * as Tone from "tone";

export interface Voice {
  /** velocity 0-1 */
  trigger: (time: number, velocity: number) => void;
  dispose: () => void;
}

type Maker = (out: Tone.ToneAudioNode) => Voice;

const noise = (decay: number, filter: Tone.Filter | null, out: Tone.ToneAudioNode, vol: number): Voice => {
  const synth = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay, sustain: 0 } });
  synth.volume.value = vol;
  if (filter) synth.chain(filter, out);
  else synth.connect(out);
  return {
    trigger: (t, v) => synth.triggerAttackRelease(decay, t, v),
    dispose: () => { synth.dispose(); filter?.dispose(); },
  };
};

const MAKERS: Record<string, Maker> = {
  "builtin:kick": (out) => {
    const s = new Tone.MembraneSynth({ octaves: 6, pitchDecay: 0.05, envelope: { attack: 0.001, decay: 0.4, sustain: 0 } }).connect(out);
    return { trigger: (t, v) => s.triggerAttackRelease("C1", "8n", t, v), dispose: () => s.dispose() };
  },
  "builtin:snare": (out) => noise(0.18, new Tone.Filter(1800, "bandpass"), out, -2),
  "builtin:clap": (out) => noise(0.12, new Tone.Filter(1200, "bandpass"), out, 0),
  "builtin:hat": (out) => noise(0.04, new Tone.Filter(8000, "highpass"), out, -8),
  "builtin:openhat": (out) => noise(0.3, new Tone.Filter(7000, "highpass"), out, -10),
  "builtin:rim": (out) => {
    const s = new Tone.MembraneSynth({ octaves: 1, pitchDecay: 0.005, envelope: { attack: 0.001, decay: 0.05, sustain: 0 } }).connect(out);
    return { trigger: (t, v) => s.triggerAttackRelease("G4", "32n", t, v), dispose: () => s.dispose() };
  },
  "builtin:tom": (out) => {
    const s = new Tone.MembraneSynth({ octaves: 3, pitchDecay: 0.08, envelope: { attack: 0.001, decay: 0.3, sustain: 0 } }).connect(out);
    return { trigger: (t, v) => s.triggerAttackRelease("G2", "8n", t, v), dispose: () => s.dispose() };
  },
  "builtin:808": (out) => {
    const s = new Tone.MembraneSynth({ octaves: 2, pitchDecay: 0.02, envelope: { attack: 0.001, decay: 1.2, sustain: 0.1, release: 0.4 } }).connect(out);
    return { trigger: (t, v) => s.triggerAttackRelease("A0", "4n", t, v), dispose: () => s.dispose() };
  },
};

/** Makes a voice for a sound, or null if this browser can't play it yet. */
export function makeVoice(soundId: string, out: Tone.ToneAudioNode): Voice | null {
  return MAKERS[soundId]?.(out) ?? null;
}

const previews = new Map<string, Voice>();

/** Plays a sound once, right now, for auditioning. Only you hear it. */
export function previewSound(soundId: string) {
  let v = previews.get(soundId);
  if (!v) {
    const made = makeVoice(soundId, Tone.getDestination());
    if (!made) return;
    v = made;
    previews.set(soundId, v);
  }
  v.trigger(Tone.now() + 0.01, 0.9);
}
