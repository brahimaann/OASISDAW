/**
 * One native AudioContext for the whole app, handed to Tone. Recording needs
 * the native object (AudioWorklet + mic source), not Tone's wrapper.
 */
import * as Tone from "tone";

let native: AudioContext | null = null;

export function setupAudio() {
  if (native) return;
  native = new AudioContext({ latencyHint: "interactive" });
  Tone.setContext(native);
}

export function audioContext(): AudioContext {
  setupAudio();
  return native!;
}
