/**
 * Track strips: one Tone channel (volume + pan) per playlist track, set from
 * the shared mixer map. Takes and the pattern clips on a track play through
 * its strip. Mute and solo are worked out here, not in Tone, so the rack's
 * PAT mode and previews are never silenced by a soloed track.
 */
import * as Tone from "tone";
import type * as Y from "yjs";
import { audibleTracks, faderToDb, getMixer, getTracks, readChannel } from "@/doc/schema";

interface Strip { vol: Tone.Volume; pan: Tone.Panner }

let current: { doc: Y.Doc; strips: Map<string, Strip>; audible: Set<string> } | null = null;

function apply(doc: Y.Doc, id: string, s: Strip, audible: Set<string>) {
  const c = readChannel(doc, id);
  s.vol.volume.rampTo(audible.has(id) ? faderToDb(c.gain) : -Infinity, 0.02);
  s.pan.pan.rampTo(c.pan * 2 - 1, 0.02);
}

/** The strip a track's audio goes into. Created on first use. */
export function trackInput(trackId: string): Tone.ToneAudioNode {
  if (!current) return Tone.getDestination();
  let s = current.strips.get(trackId);
  if (!s) {
    const pan = new Tone.Panner(0).toDestination();
    const vol = new Tone.Volume(0).connect(pan);
    s = { vol, pan };
    current.strips.set(trackId, s);
    apply(current.doc, trackId, s, current.audible);
  }
  return s.vol;
}

export function runMixer(doc: Y.Doc): () => void {
  const strips = new Map<string, Strip>();
  current = { doc, strips, audible: audibleTracks(doc) };
  const sync = () => {
    if (!current) return;
    current.audible = audibleTracks(doc);
    for (const [id, s] of strips) apply(doc, id, s, current.audible);
  };
  const mixer = getMixer(doc);
  const tracks = getTracks(doc);
  mixer.observe(sync);
  tracks.observe(sync);
  return () => {
    mixer.unobserve(sync);
    tracks.unobserve(sync);
    for (const s of strips.values()) { s.vol.dispose(); s.pan.dispose(); }
    strips.clear();
    current = null;
  };
}
