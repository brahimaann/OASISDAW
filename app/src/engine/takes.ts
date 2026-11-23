/**
 * Plays the playlist's audio clips on the local Transport. Each browser
 * downloads every take once (by hash) and keeps it in memory. A clip edit
 * only rebuilds that clip's player.
 */
import * as Tone from "tone";
import type * as Y from "yjs";
import { getTakes, getTracks, type AudioClip, type Take } from "@/doc/schema";
import { audioContext } from "@/engine/audioContext";
import { computePeaks } from "@/audio/wav";

/* ---------- buffers, loaded once per hash ---------- */

const buffers = new Map<string, Promise<AudioBuffer>>();
const ready = new Map<string, AudioBuffer>();
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/** Subscribe to "a buffer finished loading". */
export function onBuffersChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The recorder's own browser has the take before it's uploaded. */
export function putLocalBuffer(hash: string, buffer: AudioBuffer) {
  buffers.set(hash, Promise.resolve(buffer));
  ready.set(hash, buffer);
  notify();
}

export function bufferFor(take: Take): AudioBuffer | null {
  const have = ready.get(take.hash);
  if (have) return have;
  if (take.uploadState !== "uploaded" || !take.url || buffers.has(take.hash)) return null;
  const p = fetch(take.url)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} loading ${take.url}`);
      return r.arrayBuffer();
    })
    .then((data) => audioContext().decodeAudioData(data))
    .then((buf) => {
      ready.set(take.hash, buf);
      notify();
      return buf;
    });
  p.catch((err) => {
    console.warn("[oasis] take failed to load", err);
    buffers.delete(take.hash); // let a later change retry
  });
  buffers.set(take.hash, p);
  return null;
}

const peakCache = new Map<string, Float32Array>();
export function peaksFor(hash: string, buckets = 2000): Float32Array | null {
  const buf = ready.get(hash);
  if (!buf) return null;
  let p = peakCache.get(hash);
  if (!p) {
    p = computePeaks(buf.getChannelData(0), buckets);
    peakCache.set(hash, p);
  }
  return p;
}

/* ---------- players ---------- */

interface Live {
  key: string;
  player: Tone.Player;
}

export function playTakes(doc: Y.Doc): () => void {
  const live = new Map<string, Live>();
  const tracks = getTracks(doc);
  const takes = getTakes(doc);
  const bus = new Tone.Volume(0).toDestination();

  const sync = () => {
    const transport = Tone.getTransport();
    const bpm = transport.bpm.value;
    const secPerBeat = 60 / bpm;
    const seen = new Set<string>();

    tracks.forEach((track) => {
      const clips = track.get("clips") as Y.Map<AudioClip> | undefined;
      clips?.forEach((clip, clipId) => {
        if (clip.kind !== "audio") return;
        const take = takes.get(clip.takeId);
        if (!take) return;
        const buffer = bufferFor(take);
        if (!buffer || clip.mute) return;
        seen.add(clipId);
        const key = JSON.stringify([clip, take.hash, bpm]);
        const existing = live.get(clipId);
        if (existing?.key === key) return;
        existing?.player.dispose();

        const player = new Tone.Player(buffer).connect(bus);
        player.volume.value = Tone.gainToDb(clip.gain);
        player.fadeIn = clip.fadeInBeats * secPerBeat;
        player.fadeOut = clip.fadeOutBeats * secPerBeat;
        // Position in ticks, so it stays on its beat if the tempo changes.
        const ticks = Math.round((clip.startBeat + clip.nudgeMs / 1000 / secPerBeat) * transport.PPQ);
        const duration = Math.max(0, Math.min(clip.lengthBeats * secPerBeat, buffer.duration - clip.trimIn));
        player.sync().start(`${Math.max(0, ticks)}i`, clip.trimIn, duration);
        live.set(clipId, { key, player });
      });
    });

    for (const [clipId, l] of live) {
      if (!seen.has(clipId)) {
        l.player.dispose();
        live.delete(clipId);
      }
    }
  };

  tracks.observeDeep(sync);
  takes.observe(sync);
  const off = onBuffersChange(sync);
  const bpmTimer = setInterval(sync, 1000); // cheap: only rebuilds when something changed
  sync();

  return () => {
    tracks.unobserveDeep(sync);
    takes.unobserve(sync);
    off();
    clearInterval(bpmTimer);
    for (const l of live.values()) l.player.dispose();
    live.clear();
    bus.dispose();
  };
}
