/**
 * Local audio clock. Every browser plays the project itself; only the shared
 * playState travels over the network. This follows meta.playState and bpm
 * and drives Tone's Transport. Nothing here goes through React.
 */
import * as Tone from "tone";
import type * as Y from "yjs";
import { getMeta, readMeta, secondsPerBar, type MetaFields } from "@/doc/schema";
import { serverNow } from "@/sync/clock";
import { audioContext } from "@/engine/audioContext";

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

/**
 * Count-in clicks for the performer only, before the shared start.
 * `startCtxTime` is when bar 1 lands in this browser.
 */
export function countInClicks(startCtxTime: number, bars: number, bpm: number, beatsPerBar: number) {
  ensureClick();
  const beat = 60 / bpm;
  const n = bars * beatsPerBar;
  for (let i = 0; i < n; i++) {
    const t = startCtxTime - (n - i) * beat;
    if (t > Tone.now()) click!.triggerAttackRelease(i % beatsPerBar === 0 ? "C6" : "C5", "32n", t);
  }
}

/** Context time at which the Transport will next (or did last) hit its start, if known. */
export function transportStartCtxTime(): number | null {
  return anchor ? anchor.ctxTime - anchor.offsetS : null;
}

/**
 * Where the local Transport was last started: at context time `ctxTime` it
 * was at `offsetS` seconds from bar 0, at `bpm`. Used to place recorded audio.
 */
let anchor: { ctxTime: number; offsetS: number; bpm: number } | null = null;
let anchorVersion = 0;

/** Goes up every time the Transport is (re)started. */
export function transportVersion() {
  return anchorVersion;
}

/** Transport position (seconds from bar 0) at a context time, or null if not playing.
 * Negative means before the start (count-in, or audio captured before Play landed). */
export function transportSecondsAt(ctxTime: number): number | null {
  if (!anchor) return null;
  return anchor.offsetS + (ctxTime - anchor.ctxTime);
}

export function currentBpm() {
  return Tone.getTransport().bpm.value;
}

/** Applies the shared state to the local Transport. */
function apply(meta: MetaFields) {
  const transport = Tone.getTransport();
  const { bpm, timeSig, playState } = meta;
  transport.stop();
  anchor = null;
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
    anchor = { ctxTime: now + delayS, offsetS: startOffsetS, bpm };
    anchorVersion++;
  } else {
    // We joined (or heard about it) late: jump in where everyone else is.
    const catchUp = 0.05;
    transport.start(now + catchUp, startOffsetS - delayS + catchUp);
    anchor = { ctxTime: now + catchUp, offsetS: startOffsetS - delayS + catchUp, bpm };
    anchorVersion++;
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
  const ctx = audioContext();
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
