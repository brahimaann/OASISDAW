/**
 * Local audio clock. Every browser plays the project itself; only the shared
 * playState travels over the network. This follows meta.playState and bpm
 * and drives Tone's Transport. Nothing here goes through React.
 */
import * as Tone from "tone";
import type * as Y from "yjs";
import { getMeta, readMeta, secondsPerBar, type MetaFields } from "@/doc/schema";
import { serverNow } from "@/sync/clock";

export const STEPS_PER_BAR = 16;

let click: Tone.MembraneSynth | null = null;
let clickEnabled = true;

export function setClickEnabled(on: boolean) {
  clickEnabled = on;
}

function ensureClick() {
  if (click) return;
  click = new Tone.MembraneSynth({ pitchDecay: 0.008, octaves: 2, envelope: { attack: 0.001, decay: 0.08, sustain: 0 } }).toDestination();
  click.volume.value = -10;
  const transport = Tone.getTransport();
  transport.scheduleRepeat((time) => {
    if (!clickEnabled || !click) return;
    // Beat number within the bar, from transport time, so every browser agrees.
    const beat = Math.round(transport.getTicksAtTime(time) / transport.PPQ) % (transport.timeSignature as number);
    click.triggerAttackRelease(beat === 0 ? "C6" : "C5", "32n", time);
  }, "4n", 0);
}

/** Applies the shared state to the local Transport. */
function apply(meta: MetaFields) {
  const transport = Tone.getTransport();
  const { bpm, timeSig, playState } = meta;
  transport.stop();
  transport.bpm.value = bpm;
  transport.timeSignature = timeSig[0];
  if (!playState.playing) return;

  ensureClick();
  // Where the shared clock says the music is, in seconds from bar 0.
  const startOffsetS = playState.bar * secondsPerBar(bpm, timeSig);
  const delayS = (playState.startedAtServerMs - serverNow()) / 1000;
  const now = Tone.now();
  if (delayS >= 0) {
    transport.start(now + delayS, startOffsetS);
  } else {
    // We joined (or heard about it) late: jump in where everyone else is.
    const catchUp = 0.05;
    transport.start(now + catchUp, startOffsetS - delayS + catchUp);
  }
}

/** Starts following a room's doc. Returns a function that stops following. */
export function followDoc(doc: Y.Doc): () => void {
  const meta = getMeta(doc);
  let last = "";
  const onChange = () => {
    const m = readMeta(doc);
    const key = JSON.stringify([m.bpm, m.timeSig, m.playState]);
    if (key === last) return;
    last = key;
    apply(m);
  };
  meta.observe(onChange);
  onChange();
  // If audio gets unlocked after the room started playing, catch up.
  const ctx = Tone.getContext().rawContext as AudioContext;
  const onState = () => {
    if (ctx.state === "running") {
      last = "";
      onChange();
    }
  };
  ctx.addEventListener("statechange", onState);
  return () => {
    meta.unobserve(onChange);
    ctx.removeEventListener("statechange", onState);
    Tone.getTransport().stop();
  };
}

/** Browsers block audio until a click. Call from any click handler. */
export async function unlockAudio() {
  if (Tone.getContext().state !== "running") await Tone.start();
}

export function audioUnlocked() {
  return Tone.getContext().state === "running";
}

/** Current position in steps, for drawing. -1 when stopped. */
export function currentStep(): number {
  const transport = Tone.getTransport();
  if (transport.state !== "started") return -1;
  const stepS = 60 / transport.bpm.value / 4;
  const s = transport.seconds;
  return s < 0 ? -1 : Math.floor(s / stepS) % STEPS_PER_BAR;
}

/** Debug hook so tests (and you, in the console) can read the clock. */
export function debugClock() {
  const transport = Tone.getTransport();
  return { state: transport.state, seconds: transport.seconds, bpm: transport.bpm.value, step: currentStep(), serverNow: serverNow() };
}
