/**
 * OASIS project document, schema version 1.
 *
 * The Y.Doc is the source of truth for everything shared in a room. Keep it
 * engine-agnostic: a future JUCE engine should be able to read the same doc.
 *
 * Rules (see CLAUDE.md section 6):
 * - Every row, step, clip, sound and take has its own ID.
 * - Parameters are normalized to 0-1.
 * - No audio bytes in Yjs. Only hashes and URLs.
 */
import * as Y from "yjs";

export const SCHEMA_VERSION = 1;

/* ---------- plain value types ---------- */

export type TimeSig = [beatsPerBar: number, beatUnit: number];

/**
 * The shared clock. At server time `startedAtServerMs` the transport is at
 * `bar` (fractional bars allowed). Each browser plays locally from that.
 * Written as one object so play/stop/position always change together.
 */
export interface PlayState {
  playing: boolean;
  startedAtServerMs: number;
  bar: number;
}

export interface Sound {
  hash: string; // SHA-256 of the file, hex
  name: string;
  url: string;
  durationS: number;
  sampleRate: number;
}

/** A row in the channel rack. Lives as a Y.Map so fields edit independently. */
export interface RowFields {
  /** A key in `sounds`, or a built-in sound like "builtin:kick" (see BUILTIN_SOUNDS). */
  soundId: string;
  /** Display name, e.g. "Kick". */
  name: string;
  /** Sort key for the rack. Rows are a map, so order lives here. */
  order: number;
  /**
   * Step index ("0".."63") -> velocity 0-1. A missing key means off.
   * A Y.Map, not a Y.Array: two people toggling the same step at once must
   * end with one value, and a Y.Array delete+insert would end with two.
   */
  steps: Y.Map<number>;
  pitch: number; // semitones
  gain: number; // 0-1
  pan: number; // 0-1, 0.5 = center
  mute: boolean;
  solo: boolean;
}

export type PatternLength = 16 | 32 | 64;

export interface PatternFields {
  name: string;
  length: PatternLength;
  rows: Y.Map<Y.Map<unknown>>;
}

/**
 * A block on the playlist. Either a recorded take (audio) or a rack pattern.
 * Editing length, trims and fades only changes these numbers, never the audio.
 */
interface ClipBase {
  startBeat: number; // where it sits on the playlist
  lengthBeats: number; // how long it plays (drag the right edge)
  gain: number; // 0-1
  fadeInBeats: number;
  fadeOutBeats: number;
  mute: boolean;
}

export interface AudioClip extends ClipBase {
  kind: "audio";
  takeId: string;
  trimIn: number; // seconds cut from the start of the take (drag the left edge)
  nudgeMs: number; // fine timing fix, +/- 50 ms
}

export interface PatternClip extends ClipBase {
  kind: "pattern";
  patternId: string;
  offsetBeats: number; // start partway into the pattern (drag the left edge)
}

export type Clip = AudioClip | PatternClip;

export interface TrackFields {
  /** Playlist rows hold any clip kind, FL-style. */
  kind: "playlist";
  name: string;
  order: number;
  clips: Y.Map<Clip>;
}

export type UploadState = "local" | "uploading" | "uploaded" | "failed";

export interface Take {
  hash: string;
  url: string;
  peaksUrl: string;
  recordedBy: string;
  latencyCompMs: number;
  uploadState: UploadState;
}

export interface Channel {
  gain: number; // 0-1
  pan: number; // 0-1
  mute: boolean;
  solo: boolean;
  fx: unknown[];
}

export interface ChatMessage {
  id: string;
  userId: string;
  name: string;
  text: string;
  ts: number; // server time, ms
  atBeat?: number;
}

export interface MetaFields {
  version: number;
  name: string;
  bpm: number;
  timeSig: TimeSig;
  swing: number; // 0-1
  playState: PlayState;
}

export const DEFAULT_META: MetaFields = {
  version: SCHEMA_VERSION,
  name: "Untitled session",
  bpm: 140,
  timeSig: [4, 4],
  swing: 0,
  playState: { playing: false, startedAtServerMs: 0, bar: 0 },
};

/* ---------- typed accessors for the top-level maps ---------- */

/** A Y.Map whose keys are typed by a fields interface. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TypedMap<T> = Y.Map<any> & {
  get<K extends keyof T & string>(key: K): T[K] | undefined;
  set<K extends keyof T & string>(key: K, value: T[K]): T[K];
};

export const getMeta = (doc: Y.Doc) => doc.getMap("meta") as TypedMap<MetaFields>;
export const getSounds = (doc: Y.Doc) => doc.getMap<Sound>("sounds");
export const getPatterns = (doc: Y.Doc) =>
  doc.getMap("patterns") as Y.Map<TypedMap<PatternFields>>;
export const getTracks = (doc: Y.Doc) => doc.getMap("tracks") as Y.Map<TypedMap<TrackFields>>;
export const getTakes = (doc: Y.Doc) => doc.getMap<Take>("takes");
export const getMixer = (doc: Y.Doc) => doc.getMap<Channel>("mixer");
export const getChat = (doc: Y.Doc) => doc.getArray<ChatMessage>("chat");

/** Reads meta with defaults filled in, so callers never see undefined. */
export function readMeta(doc: Y.Doc): MetaFields {
  const meta = getMeta(doc);
  return {
    version: meta.get("version") ?? DEFAULT_META.version,
    name: meta.get("name") ?? DEFAULT_META.name,
    bpm: meta.get("bpm") ?? DEFAULT_META.bpm,
    timeSig: meta.get("timeSig") ?? DEFAULT_META.timeSig,
    swing: meta.get("swing") ?? DEFAULT_META.swing,
    playState: meta.get("playState") ?? DEFAULT_META.playState,
  };
}

/**
 * Fills in any missing meta fields. Call once after the first sync with the
 * server, so we never overwrite a room that already exists. If two people
 * open a brand-new room at once they both write the same defaults, which is harmless.
 */
export function initDoc(doc: Y.Doc) {
  const meta = getMeta(doc);
  const version = meta.get("version");
  if (version !== undefined && version > SCHEMA_VERSION) {
    console.warn(`[oasis] room uses schema v${version}, this app knows v${SCHEMA_VERSION}`);
  }
  doc.transact(() => {
    for (const [key, value] of Object.entries(DEFAULT_META) as [keyof MetaFields, unknown][]) {
      if (!meta.has(key)) meta.set(key, value as never);
    }
  });
}

/* ---------- clock math ---------- */

export function secondsPerBar(bpm: number, timeSig: TimeSig): number {
  return (60 / bpm) * timeSig[0] * (4 / timeSig[1]);
}

/** Where the transport is (in bars) at a given server time. */
export function barAt(state: PlayState, bpm: number, timeSig: TimeSig, serverMs: number): number {
  if (!state.playing) return state.bar;
  return state.bar + (serverMs - state.startedAtServerMs) / 1000 / secondsPerBar(bpm, timeSig);
}

/* ---------- mutations ---------- */

/** How far ahead a shared start is scheduled, so every browser hears it in time. */
export const START_LEAD_MS = 150;

export function play(doc: Y.Doc, serverNow: number) {
  getMeta(doc).set("playState", {
    playing: true,
    startedAtServerMs: serverNow + START_LEAD_MS,
    bar: 0,
  });
}

export function stop(doc: Y.Doc, serverNow: number) {
  getMeta(doc).set("playState", { playing: false, startedAtServerMs: serverNow, bar: 0 });
}

/** Changes tempo. While playing, re-anchors the clock so nobody jumps. */
export function setBpm(doc: Y.Doc, bpm: number, serverNow: number) {
  const clamped = Math.min(300, Math.max(20, Math.round(bpm)));
  const { bpm: oldBpm, timeSig, playState } = readMeta(doc);
  doc.transact(() => {
    const meta = getMeta(doc);
    if (playState.playing) {
      const at = serverNow + START_LEAD_MS;
      meta.set("playState", {
        playing: true,
        startedAtServerMs: at,
        bar: barAt(playState, oldBpm, timeSig, at),
      });
    }
    meta.set("bpm", clamped);
  });
}

export function sendChat(doc: Y.Doc, msg: ChatMessage) {
  const text = msg.text.trim().slice(0, 2000);
  if (!text) return;
  getChat(doc).push([{ ...msg, text }]);
}

/** Creates an empty pattern. Used from Tuesday on (channel rack). */
export function createPattern(doc: Y.Doc, id: string, name: string, length: PatternLength = 16) {
  const pattern = new Y.Map<unknown>() as TypedMap<PatternFields>;
  doc.transact(() => {
    pattern.set("name", name);
    pattern.set("length", length);
    pattern.set("rows", new Y.Map<Y.Map<unknown>>());
    getPatterns(doc).set(id, pattern);
  });
  return pattern;
}

/** Adds a row to a pattern, with all steps off, at the bottom of the rack. */
export function addRow(pattern: TypedMap<PatternFields>, rowId: string, soundId: string, name = soundId) {
  const row = new Y.Map<unknown>() as TypedMap<RowFields>;
  const rows = pattern.get("rows");
  let maxOrder = 0;
  rows?.forEach((r: Y.Map<unknown>) => (maxOrder = Math.max(maxOrder, (r.get("order") as number) ?? 0)));
  row.set("soundId", soundId);
  row.set("name", name);
  row.set("order", maxOrder + 1);
  row.set("steps", new Y.Map<number>());
  row.set("pitch", 0);
  row.set("gain", 0.8);
  row.set("pan", 0.5);
  row.set("mute", false);
  row.set("solo", false);
  pattern.get("rows")?.set(rowId, row);
  return row;
}

/** Sets one step's velocity (0 = off). Sends only that one change, not the whole pattern. */
export function setStep(row: TypedMap<RowFields>, index: number, velocity: number) {
  const steps = row.get("steps");
  if (!steps || !Number.isInteger(index) || index < 0 || index >= 64) return;
  const v = Math.min(1, Math.max(0, velocity));
  if (v === 0) steps.delete(String(index));
  else steps.set(String(index), v);
}

/** Reads a row's steps as a plain array of velocities. */
export function readSteps(row: TypedMap<RowFields>, length: number): number[] {
  const steps = row.get("steps");
  return Array.from({ length }, (_, i) => steps?.get(String(i)) ?? 0);
}

/** A pattern's rows in rack order. */
export function listRows(pattern: TypedMap<PatternFields> | undefined): { id: string; row: TypedMap<RowFields> }[] {
  const out: { id: string; row: TypedMap<RowFields> }[] = [];
  pattern?.get("rows")?.forEach((row: Y.Map<unknown>, id: string) => out.push({ id, row: row as TypedMap<RowFields> }));
  return out.sort((a, b) => (a.row.get("order") ?? 0) - (b.row.get("order") ?? 0) || a.id.localeCompare(b.id));
}

export function removeRow(pattern: TypedMap<PatternFields>, rowId: string) {
  pattern.get("rows")?.delete(rowId);
}

/* ---------- built-in sounds ---------- */

/**
 * Synth sounds every browser can make with no download. They stand in for
 * one-shots until real samples arrive. Row soundIds use "builtin:<id>".
 */
export const BUILTIN_SOUNDS = [
  { id: "builtin:kick", name: "Kick" },
  { id: "builtin:snare", name: "Snare" },
  { id: "builtin:clap", name: "Clap" },
  { id: "builtin:hat", name: "Hat" },
  { id: "builtin:openhat", name: "Open hat" },
  { id: "builtin:rim", name: "Rim" },
  { id: "builtin:tom", name: "Tom" },
  { id: "builtin:808", name: "808" },
] as const;

export const MAIN_PATTERN_ID = "main";

/**
 * Makes sure the room has its main pattern with a starter kit. If two people
 * open a new room at once, one whole pattern wins, so rows never double up.
 */
export function ensureMainPattern(doc: Y.Doc, makeId: () => string) {
  if (getPatterns(doc).has(MAIN_PATTERN_ID)) return;
  doc.transact(() => {
    const pattern = createPattern(doc, MAIN_PATTERN_ID, "Pattern 1");
    for (const s of BUILTIN_SOUNDS.slice(0, 4)) addRow(pattern, makeId(), s.id, s.name);
  }, "init"); // not "null", so nobody's undo removes the starter kit
}
