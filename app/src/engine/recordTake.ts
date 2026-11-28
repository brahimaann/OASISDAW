/**
 * The record flow: capture raw audio against local playback, save it to
 * IndexedDB as it comes in, then put the take on the playlist and upload it
 * in the background. "Play locally, record locally, send the file."
 */
import type * as Y from "yjs";
import { concat, Recorder } from "@/audio/recorder";
import { dropAudio, getChunks, getWav, listTakes, putChunk, putTake, putWav, updateTake, type LocalTake } from "@/audio/takeStore";
import { encodeWav, sha256Hex } from "@/audio/wav";
import { newId } from "@/doc/ids";
import { addRecordedTake, getTakes, play, readMeta, secondsPerBar, setTakeUploaded, START_LEAD_MS, stop } from "@/doc/schema";
import { audioContext } from "@/engine/audioContext";
import { putLocalBuffer } from "@/engine/takes";
import { countInClicks, currentBpm, transportStartCtxTime, transportSecondsAt, transportVersion } from "@/engine/transport";
import { serverNow } from "@/sync/clock";
import { uploadToPool } from "@/sync/upload";

export interface RecordOptions {
  doc: Y.Doc;
  roomId: string;
  userId: string;
  userName: string;
  stream: MediaStream;
  latencyMs: number;
  getToken: () => Promise<string>;
  onUploadProgress?: (takeId: string, fraction: number) => void;
  /** Bars of count-in clicks before bar 1. The mic is already rolling during them. */
  countInBars?: number;
}

export interface TakeInProgress {
  takeId: string;
  stop: () => Promise<void>;
}

const trackIdFor = (userId: string) => `vox-${userId.replace(/[^A-Za-z0-9_-]/g, "")}`;

export async function startRecording(o: RecordOptions): Promise<TakeInProgress> {
  const ctx = audioContext();
  const takeId = newId();
  const clipId = newId();
  const bpm = currentBpm();
  const local: LocalTake = {
    takeId,
    clipId,
    roomId: o.roomId,
    trackId: trackIdFor(o.userId),
    recordedBy: o.userId,
    sampleRate: ctx.sampleRate,
    latencyMs: o.latencyMs,
    startBeat: null,
    bpm,
    state: "recording",
    createdAt: Date.now(),
  };
  await putTake(local);

  let firstTime: number | null = null;
  // Recording restarts the shared transport. Ignore the old start, if it was playing.
  const versionAtStart = transportVersion();
  /** Playlist beat of the first sample, with the latency taken out. */
  const startBeat = () => {
    if (firstTime === null || transportVersion() <= versionAtStart) return null;
    const s = transportSecondsAt(firstTime - o.latencyMs / 1000);
    return s === null ? null : (s * currentBpm()) / 60;
  };

  const rec = new Recorder(ctx, o.stream);
  rec.onFirstSample = (t) => (firstTime = t);
  rec.onChunk = (samples, i) => {
    void putChunk(takeId, i, samples);
    // Save the position as soon as we know it, so a crash can still place the take.
    if (local.startBeat === null) {
      const b = startBeat();
      if (b !== null) {
        local.startBeat = b;
        void updateTake(takeId, { startBeat: b, bpm: currentBpm() });
      }
    }
  };
  await rec.start();
  // Everyone hears the beat; the performer records against it. A count-in
  // pushes the shared start later and clicks only in the performer's ears.
  const { timeSig } = readMeta(o.doc);
  const countInS = (o.countInBars ?? 0) * secondsPerBar(bpm, timeSig);
  play(o.doc, serverNow(), START_LEAD_MS + countInS * 1000);
  if (countInS > 0) {
    // followDoc has already applied the new start (local Yjs changes fire at once).
    const bar1 = transportStartCtxTime() ?? ctx.currentTime + START_LEAD_MS / 1000 + countInS;
    countInClicks(bar1, o.countInBars!, bpm, timeSig[0]);
  }

  return {
    takeId,
    stop: async () => {
      const cap = await rec.stop();
      stop(o.doc, serverNow());
      const beat = local.startBeat ?? startBeat() ?? 0;
      await finishTake(o, { ...local, startBeat: beat, bpm: currentBpm() }, cap.samples);
    },
  };
}

/** Encodes, places and uploads a take. Also used to rescue takes after a crash. */
async function finishTake(o: Pick<RecordOptions, "doc" | "userName" | "getToken" | "onUploadProgress">, t: LocalTake, samples: Float32Array) {
  const secPerBeat = 60 / t.bpm;
  let startBeat = t.startBeat ?? 0;
  let trimIn = 0;
  if (startBeat < 0) {
    // Audio captured before bar 1: keep it in the file, but start the clip at bar 1.
    trimIn = -startBeat * secPerBeat;
    startBeat = 0;
  }
  const wav = encodeWav(samples, t.sampleRate);
  const hash = await sha256Hex(wav);
  await putWav(t.takeId, wav);
  await updateTake(t.takeId, { state: "recorded", hash, startBeat: t.startBeat });

  const ctx = audioContext();
  const buffer = ctx.createBuffer(1, Math.max(1, samples.length), t.sampleRate);
  buffer.getChannelData(0).set(samples);
  putLocalBuffer(hash, buffer);

  if (!getTakes(o.doc).has(t.takeId)) {
    addRecordedTake(o.doc, {
      trackId: t.trackId,
      trackName: `${o.userName} vox`,
      takeId: t.takeId,
      clipId: t.clipId,
      take: { hash, url: "", peaksUrl: "", recordedBy: t.recordedBy, latencyCompMs: t.latencyMs, uploadState: "uploading" },
      clip: {
        startBeat,
        lengthBeats: Math.max(0, buffer.duration - trimIn) / secPerBeat,
        trimIn,
        nudgeMs: 0,
        gain: 1,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        mute: false,
      },
    });
  }
  await upload(o, t.takeId, wav, hash);
}

async function upload(o: Pick<RecordOptions, "doc" | "getToken" | "onUploadProgress">, takeId: string, wav: Blob, hash: string) {
  const url = await uploadToPool(wav, hash, o.getToken, (f) => o.onUploadProgress?.(takeId, f));
  setTakeUploaded(o.doc, takeId, url);
  await updateTake(takeId, { state: "uploaded" });
  await dropAudio(takeId);
}

/**
 * Finds takes from this room that never finished uploading (refresh, crash,
 * lost Wi-Fi) and finishes them. Returns how many it picked up.
 */
export async function resumePendingTakes(o: Pick<RecordOptions, "doc" | "roomId" | "userName" | "getToken" | "onUploadProgress">): Promise<number> {
  const pending = (await listTakes()).filter((t) => t.roomId === o.roomId && t.state !== "uploaded");
  for (const t of pending) {
    try {
      if (t.state === "recorded" && t.hash) {
        const wav = await getWav(t.takeId);
        if (wav) await upload(o, t.takeId, wav, t.hash);
      } else {
        const samples = concat(await getChunks(t.takeId));
        if (samples.length > 0) await finishTake(o, t, samples);
      }
    } catch (err) {
      console.warn("[oasis] could not resume take", t.takeId, err);
    }
  }
  return pending.length;
}
