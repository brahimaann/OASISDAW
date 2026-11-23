/**
 * Plays the channel rack on the local Transport. Reads the shared doc at
 * each step, so anyone's edit is heard on the next pass. Each row gets its
 * own volume + pan strip. Nothing here goes through React.
 */
import * as Tone from "tone";
import type * as Y from "yjs";
import { getPatterns, listRows, MAIN_PATTERN_ID } from "@/doc/schema";
import { STEPS_PER_BAR } from "@/engine/transport";
import { makeVoice, type Voice } from "@/engine/voices";

interface Strip {
  soundId: string;
  vol: Tone.Volume;
  pan: Tone.Panner;
  voice: Voice | null;
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

  const id = transport.scheduleRepeat((time) => {
    const rows = listRows(getPatterns(doc).get(MAIN_PATTERN_ID));
    const step = Math.round(transport.getTicksAtTime(time) / (transport.PPQ / 4)) % STEPS_PER_BAR;
    const anySolo = rows.some(({ row }) => row.get("solo"));
    const live = new Set<string>();
    for (const { id: rowId, row } of rows) {
      live.add(rowId);
      const s = stripFor(rowId, row.get("soundId") ?? "");
      s.vol.volume.setValueAtTime(Tone.gainToDb(row.get("gain") ?? 0.8), time);
      s.pan.pan.setValueAtTime((row.get("pan") ?? 0.5) * 2 - 1, time);
      const audible = anySolo ? row.get("solo") : !row.get("mute");
      const v = row.get("steps")?.get(String(step)) ?? 0;
      if (audible && v > 0) s.voice?.trigger(time, v);
    }
    // Clean up rows someone deleted.
    for (const [rowId, s] of strips) {
      if (!live.has(rowId)) {
        strips.delete(rowId);
        // Let any tail ring out before disposing.
        setTimeout(() => disposeStrip(s), 2000);
      }
    }
  }, "16n", 0);

  return () => {
    transport.clear(id);
    for (const s of strips.values()) disposeStrip(s);
    strips.clear();
  };
}
