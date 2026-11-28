/**
 * Bounce: renders the song (or one loop of a pattern) faster than real time
 * in an offline audio context, as a full mix and/or one file per stem.
 * Every browser has the same sounds, so anyone can export the same result.
 *
 * Stems: one per rack sound (by name, across all patterns: "Kick", "808")
 * and one per playlist track that holds audio ("Hima vox").
 */
import * as Tone from "tone";
import type * as Y from "yjs";
import { encodeWavPcm } from "@/audio/wav";
import { getPatterns, getTakes, getTracks, listRows, readMeta, type Clip } from "@/doc/schema";
import { bufferFor } from "@/engine/takes";
import { makeVoice } from "@/engine/voices";

export type ExportRange = { kind: "song" } | { kind: "pattern"; patternId: string };

interface Hit { stem: string; rowId: string; soundId: string; time: number; velocity: number; gain: number; pan: number }
interface AudioPart { stem: string; buffer: AudioBuffer; time: number; offset: number; duration: number; gain: number; fadeIn: number; fadeOut: number }

export interface RenderPlan {
  hits: Hit[];
  audio: AudioPart[];
  /** Seconds of music, before the tail. */
  length: number;
  /** Extra seconds so reverb-free synth tails (808s) ring out. 0 for a loop. */
  tail: number;
  stems: string[];
  /** Takes on the playlist this browser hasn't downloaded yet. */
  missingTakes: number;
}

/** Works out every hit and audio clip in the range, in seconds from the start. */
export function planRender(doc: Y.Doc, range: ExportRange): RenderPlan {
  const { bpm } = readMeta(doc);
  const sixteenth = 15 / bpm;
  const beat = 60 / bpm;
  const patterns = getPatterns(doc);
  const hits: Hit[] = [];
  const audio: AudioPart[] = [];
  let missingTakes = 0;

  const playPattern = (patternId: string, fromStep: number, toStep: number, startStepInPattern: number, atStep: number) => {
    const pattern = patterns.get(patternId);
    const len = pattern?.get("length") ?? 16;
    const rows = listRows(pattern);
    const anySolo = rows.some(({ row }) => row.get("solo"));
    for (let s = fromStep; s < toStep; s++) {
      const inPattern = (s - fromStep + startStepInPattern) % len;
      for (const { id, row } of rows) {
        if (anySolo ? !row.get("solo") : row.get("mute")) continue;
        const v = row.get("steps")?.get(String(inPattern)) ?? 0;
        if (v <= 0) continue;
        hits.push({
          stem: row.get("name") ?? "Sound",
          rowId: id,
          soundId: row.get("soundId") ?? "",
          time: (s - atStep) * sixteenth,
          velocity: v,
          gain: row.get("gain") ?? 0.8,
          pan: row.get("pan") ?? 0.5,
        });
      }
    }
  };

  let length: number;
  if (range.kind === "pattern") {
    const len = patterns.get(range.patternId)?.get("length") ?? 16;
    playPattern(range.patternId, 0, len, 0, 0);
    length = len * sixteenth;
  } else {
    let endBeat = 0;
    const takes = getTakes(doc);
    getTracks(doc).forEach((track) => {
      const trackName = track.get("name") ?? "Track";
      track.get("clips")?.forEach((clip: Clip) => {
        if (clip.mute) return;
        endBeat = Math.max(endBeat, clip.startBeat + clip.lengthBeats);
        if (clip.kind === "pattern") {
          const start = Math.round(clip.startBeat * 4);
          playPattern(clip.patternId, start, start + Math.round(clip.lengthBeats * 4), Math.round(clip.offsetBeats * 4), 0);
          return;
        }
        const take = takes.get(clip.takeId);
        const buffer = take ? bufferFor(take) : null;
        if (!buffer) { missingTakes++; return; }
        const time = clip.startBeat * beat + clip.nudgeMs / 1000;
        audio.push({
          stem: trackName,
          buffer,
          time: Math.max(0, time),
          offset: clip.trimIn + Math.max(0, -time),
          duration: Math.max(0, Math.min(clip.lengthBeats * beat, buffer.duration - clip.trimIn)),
          gain: clip.gain,
          fadeIn: clip.fadeInBeats * beat,
          fadeOut: clip.fadeOutBeats * beat,
        });
      });
    });
    length = endBeat * beat;
  }

  const stems = [...new Set([...hits.map((h) => h.stem), ...audio.map((a) => a.stem)])];
  return { hits, audio, length, tail: range.kind === "pattern" ? 0 : 2, stems, missingTakes };
}

/** Renders the plan (or only one stem of it) to a stereo buffer. */
export async function renderPlan(plan: RenderPlan, onlyStem?: string, sampleRate = 44100): Promise<AudioBuffer> {
  const duration = Math.max(0.1, plan.length + plan.tail);
  const rendered = await Tone.Offline(() => {
    // Built inside the offline context. Keep this synchronous: Tone swaps its
    // global context back as soon as this returns.
    const strips = new Map<string, ReturnType<typeof makeVoice>>();
    for (const h of plan.hits) {
      if (onlyStem && h.stem !== onlyStem) continue;
      let voice = strips.get(h.rowId);
      if (voice === undefined) {
        const pan = new Tone.Panner(h.pan * 2 - 1).toDestination();
        const vol = new Tone.Volume(Tone.gainToDb(h.gain)).connect(pan);
        voice = makeVoice(h.soundId, vol);
        strips.set(h.rowId, voice);
      }
      voice?.trigger(h.time, h.velocity);
    }
    for (const a of plan.audio) {
      if (onlyStem && a.stem !== onlyStem) continue;
      const p = new Tone.Player(a.buffer).toDestination();
      p.volume.value = Tone.gainToDb(Math.max(1e-4, a.gain));
      p.fadeIn = a.fadeIn;
      p.fadeOut = a.fadeOut;
      if (a.duration > 0) p.start(a.time, a.offset, a.duration);
    }
  }, duration, 2, sampleRate);
  return rendered.get() as AudioBuffer;
}

/** "Late night - 140bpm - Fmin" style names, safe for every OS. */
export function fileBase(name: string, bpm: number, key: string) {
  const parts = [name.trim() || "Untitled beat", `${Math.round(bpm)}bpm`];
  if (key.trim()) parts.push(key.trim());
  return parts.join(" - ").replace(/[\\/:*?"<>|]+/g, "").slice(0, 120);
}

export function bufferToWav(buf: AudioBuffer): Blob {
  return encodeWavPcm(Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)), buf.sampleRate);
}

/** Highest absolute sample, to warn about clipping. */
export function peakOf(buf: AudioBuffer): number {
  let m = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > m) m = a;
    }
  }
  return m;
}
