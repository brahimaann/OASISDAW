/**
 * Plays the channel rack on the local Transport. Reads the shared doc at
 * each 16th, so anyone's edit is heard on the next pass. Each row gets its
 * own volume + pan strip. Nothing here goes through React.
 *
 * PAT mode loops the pattern open in your rack. SONG mode plays the pattern
 * clips on the playlist where they sit. The mode is per person.
 */
import * as Tone from "tone";
import type * as Y from "yjs";
import { getPatterns, getTracks, listRows, type Clip, type PatternClip, type PatternFields, type TypedMap } from "@/doc/schema";
import { makeVoice, type Voice } from "@/engine/voices";
import { useUi } from "@/ui/store";

interface Strip {
  soundId: string;
  vol: Tone.Volume;
  pan: Tone.Panner;
  voice: Voice | null;
}

const lengthOf = (p: TypedMap<PatternFields> | undefined) => p?.get("length") ?? 16;

/** The pattern clips playing at a 16th (absolute step from bar 1), and the step inside each. */
function songHits(doc: Y.Doc, absStep: number): { patternId: string; step: number }[] {
  const out: { patternId: string; step: number }[] = [];
  const patterns = getPatterns(doc);
  getTracks(doc).forEach((track) => {
    track.get("clips")?.forEach((clip: Clip) => {
      if (clip.kind !== "pattern" || clip.mute) return;
      const start = Math.round(clip.startBeat * 4);
      const end = start + Math.round(clip.lengthBeats * 4);
      if (absStep < start || absStep >= end) return;
      const len = lengthOf(patterns.get(clip.patternId));
      out.push({ patternId: clip.patternId, step: (absStep - start + Math.round((clip as PatternClip).offsetBeats * 4)) % len });
    });
  });
  return out;
}

/** The 16th the transport is on now, counted from bar 1. -1 when stopped or in a count-in. */
function absStepNow(): number {
  const transport = Tone.getTransport();
  if (transport.state !== "started" || transport.seconds < 0) return -1;
  return Math.floor((transport.seconds * transport.bpm.value) / 15);
}

/** Which step of a pattern is sounding right now for this person, for the rack's light. -1 if none. */
export function playingStep(doc: Y.Doc, patternId: string): number {
  const abs = absStepNow();
  if (abs < 0) return -1;
  if (useUi.getState().playMode === "pat") {
    return patternId === useUi.getState().patternId ? abs % lengthOf(getPatterns(doc).get(patternId)) : -1;
  }
  return songHits(doc, abs).find((h) => h.patternId === patternId)?.step ?? -1;
}

export function playRack(doc: Y.Doc): () => void {
  const strips = new Map<string, Strip>();
  const transport = Tone.getTransport();

  const stripFor = (rowId: string, soundId: string): Strip => {
    let s = strips.get(rowId);
    if (s && s.soundId !== soundId) {
      s.voice?.dispose();
      s.voice = makeVoice(soundId, s.vol);
      s.soundId = soundId;
    }
    if (!s) {
      const pan = new Tone.Panner(0).toDestination();
      const vol = new Tone.Volume(0).connect(pan);
      s = { soundId, vol, pan, voice: makeVoice(soundId, vol) };
      strips.set(rowId, s);
    }
    return s;
  };

  const disposeStrip = (s: Strip) => {
    s.voice?.dispose();
    s.vol.dispose();
    s.pan.dispose();
  };

  const playPatternStep = (patternId: string, step: number, time: number) => {
    const rows = listRows(getPatterns(doc).get(patternId));
    const anySolo = rows.some(({ row }) => row.get("solo"));
    for (const { id: rowId, row } of rows) {
      const s = stripFor(rowId, row.get("soundId") ?? "");
      s.vol.volume.setValueAtTime(Tone.gainToDb(row.get("gain") ?? 0.8), time);
      s.pan.pan.setValueAtTime((row.get("pan") ?? 0.5) * 2 - 1, time);
      const audible = anySolo ? row.get("solo") : !row.get("mute");
      const v = row.get("steps")?.get(String(step)) ?? 0;
      if (audible && v > 0) s.voice?.trigger(time, v);
    }
  };

  const id = transport.scheduleRepeat((time) => {
    const abs = Math.round(transport.getTicksAtTime(time) / (transport.PPQ / 4));
    const { playMode, patternId } = useUi.getState();
    if (playMode === "pat") {
      const pattern = getPatterns(doc).get(patternId) ? patternId : "main";
      playPatternStep(pattern, abs % lengthOf(getPatterns(doc).get(pattern)), time);
    } else {
      for (const h of songHits(doc, abs)) playPatternStep(h.patternId, h.step, time);
    }
  }, "16n", 0);

  // Clean up strips for rows someone deleted (checked now and then, off the audio path).
  const sweep = setInterval(() => {
    const live = new Set<string>();
    getPatterns(doc).forEach((p) => p.get("rows")?.forEach((_: unknown, rowId: string) => live.add(rowId)));
    for (const [rowId, s] of strips) {
      if (!live.has(rowId)) {
        strips.delete(rowId);
        // Let any tail ring out before disposing.
        setTimeout(() => disposeStrip(s), 2000);
      }
    }
  }, 2000);

  return () => {
    transport.clear(id);
    clearInterval(sweep);
    for (const s of strips.values()) disposeStrip(s);
    strips.clear();
  };
}
