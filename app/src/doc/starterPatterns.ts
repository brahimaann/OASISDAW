/**
 * Starter drum patterns, from Brahima's "Pattern breakdowns" sheet (Boroma
 * Studios x Sanktuary, Nov 2026): step grids read off public drum-programming
 * videos. A step may be off by one. Long notes (808, bass) are kept as their
 * start step only; pitch, slides and off-grid rolls are not (the rack has no
 * pitch per step yet). Melodic rows (chords, piano, lead, vox) are left out.
 *
 * Steps are 1-based, as on the sheet. Bar 2 continues at 17.
 */

import type * as Y from "yjs";
import { addRow, createPattern, setStep } from "@/doc/schema";

type Sound = "kick" | "snare" | "clap" | "hat" | "openhat" | "rim" | "tom" | "808";

export interface StarterRow { name: string; sound: Sound; steps: number[]; gain?: number }
export interface StarterPattern { id: string; name: string; bpm: number; bars: 1 | 2; rows: StarterRow[] }

const eighths = [1, 3, 5, 7, 9, 11, 13, 15];
const all16 = Array.from({ length: 16 }, (_, i) => i + 1);
const bar2 = (steps: number[]) => steps.map((s) => s + 16);

export const STARTER_PATTERNS: StarterPattern[] = [
  { id: "ll-01", name: "Reggaeton", bpm: 95, bars: 1, rows: [
    { name: "Kick", sound: "kick", steps: [1, 5, 9, 13] },
    { name: "Snare", sound: "snare", steps: [4, 8, 12, 16] },
    { name: "Hat", sound: "hat", steps: [3, 7, 11, 15] },
  ] },
  { id: "ll-02", name: "Afrobeats", bpm: 100, bars: 1, rows: [
    { name: "Kick", sound: "kick", steps: [1, 11] },
    { name: "Snare", sound: "snare", steps: [5, 13] },
    { name: "Hat", sound: "hat", steps: [1, 4, 7, 9, 12, 15] },
  ] },
  { id: "ll-03", name: "Neo soul", bpm: 85, bars: 1, rows: [
    { name: "Kick", sound: "kick", steps: [1, 7, 11] },
    { name: "Snare", sound: "snare", steps: [5, 13] },
    { name: "Hat", sound: "hat", steps: eighths },
  ] },
  { id: "ll-04", name: "Boom bap", bpm: 80, bars: 1, rows: [
    { name: "Kick", sound: "kick", steps: [1, 7, 9] },
    { name: "Snare", sound: "snare", steps: [5, 13] },
    { name: "Hat", sound: "hat", steps: eighths },
  ] },
  { id: "ll-05", name: "City pop", bpm: 100, bars: 2, rows: [
    { name: "Kick", sound: "kick", steps: [1, 7, 14, 16, ...bar2([8, 11, 16])] },
    { name: "Snare", sound: "snare", steps: [5, 13, ...bar2([5, 13])] },
    { name: "Hat", sound: "hat", steps: [...all16, ...bar2(all16)], gain: 0.6 },
  ] },
  { id: "ll-06", name: "Alt R&B", bpm: 136, bars: 2, rows: [
    { name: "Kick", sound: "kick", steps: [1, 16, ...bar2([1, 5, 15])] },
    { name: "Snare", sound: "snare", steps: [9, ...bar2([9])] },
    { name: "Hat", sound: "hat", steps: [...eighths, ...bar2([1, 2, 3, 4, 5, 7, 9, 11, 13, 15])] },
  ] },
  { id: "ll-07", name: "Disco", bpm: 116, bars: 2, rows: [
    { name: "Kick", sound: "kick", steps: [1, 5, 9, 13, 16, ...bar2([1, 5, 9, 13])] },
    { name: "Snare", sound: "snare", steps: [5, 12, 13, 15, ...bar2([5, 13, 15])] },
    { name: "Hat", sound: "hat", steps: [...eighths, ...bar2(eighths)] },
  ] },
  { id: "ll-08", name: "UK garage", bpm: 132, bars: 2, rows: [
    { name: "Kick", sound: "kick", steps: [1, 16, ...bar2([1, 11])] },
    { name: "Snare", sound: "snare", steps: [5, 13, ...bar2([5, 8, 13])] },
    { name: "Hat", sound: "hat", steps: [3, 7, 11, 15, ...bar2([3, 7, 11, 15])] },
  ] },
  { id: "ll-09", name: "Slow jam", bpm: 85, bars: 2, rows: [
    { name: "Kick", sound: "kick", steps: [1, 15, ...bar2([1])] },
    { name: "Snare", sound: "snare", steps: [9, ...bar2([9, 15])] },
    { name: "Hat", sound: "hat", steps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 15, ...bar2([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 14, 15, 16])], gain: 0.6 },
  ] },
  { id: "ll-10", name: "Trap", bpm: 140, bars: 1, rows: [
    { name: "Kick", sound: "kick", steps: [1, 11, 15] },
    { name: "Snare", sound: "snare", steps: [9] },
    { name: "Hat", sound: "hat", steps: [1, 3, 4, 5, 7, 9, 11, 12, 13, 15] },
  ] },
  { id: "ll-11", name: "Boom bap", bpm: 90, bars: 1, rows: [
    { name: "Kick", sound: "kick", steps: [1, 7, 11, 15] },
    { name: "Snare", sound: "snare", steps: [5, 13] },
    { name: "Hat", sound: "hat", steps: [...eighths, 16] },
  ] },
  { id: "ll-12", name: "R&B", bpm: 68, bars: 1, rows: [
    { name: "Kick", sound: "kick", steps: [1, 7, 11, 15] },
    { name: "Snare", sound: "snare", steps: [5, 13] },
    { name: "Hat", sound: "hat", steps: all16, gain: 0.6 },
  ] },
  { id: "dp-01", name: "Jerk drill", bpm: 151, bars: 2, rows: [
    { name: "Snare", sound: "snare", steps: [1, 7, 13, ...bar2([5, 11, 15])] },
    { name: "Snare 2", sound: "clap", steps: [1, 7, ...bar2([1, 5, 7, 9, 12, 15])] },
    { name: "808", sound: "808", steps: [1, 13, ...bar2([3, 5, 11])] },
    { name: "Rims", sound: "rim", steps: [9, ...bar2([13])] },
    { name: "Open hat", sound: "openhat", steps: [9, 10, 15, 16, ...bar2([3, 4, 5, 6, 7, 8])] },
    { name: "Hat rolls", sound: "hat", steps: bar2([9, 10, 13, 14, 15]) },
  ] },
  { id: "br-01", name: "Jersey club", bpm: 145, bars: 1, rows: [
    { name: "Kick", sound: "kick", steps: [1, 5, 9, 12, 15] },
    { name: "Snap", sound: "clap", steps: [11, 13] },
    { name: "Shaker", sound: "hat", steps: [15, 16], gain: 0.6 },
  ] },
  { id: "tpc-01", name: "Chicago drill", bpm: 140, bars: 1, rows: [
    { name: "Kick", sound: "kick", steps: [1, 4, 11] },
    { name: "Clap", sound: "clap", steps: [9] },
    { name: "Hats", sound: "hat", steps: [1, 3, 5, 7, 9, 11, 13, 14, 15, 16] },
  ] },
  { id: "dp-02", name: "UK funky", bpm: 130, bars: 2, rows: [
    { name: "Hat", sound: "hat", steps: [3, 7, 11, 15, ...bar2([3, 7, 11, 15])] },
    { name: "Kick", sound: "kick", steps: [1, 5, 9, 13, ...bar2([1, 5, 9, 13])] },
    { name: "Snare", sound: "snare", steps: [1, 4, 8, 11, 14, 15, ...bar2([1, 4, 7, 9, 11, 14, 15])], gain: 0.6 },
    { name: "Accents", sound: "rim", steps: [3, ...bar2([4, 11])] },
    { name: "Shaker", sound: "hat", steps: [1, 4, 7, 9, 12, 13, ...bar2([1, 4, 7, 9, 12, 13])], gain: 0.45 },
    { name: "Bongo", sound: "tom", steps: [12, ...bar2([14])] },
    { name: "Bass", sound: "808", steps: [1, 3, 5, 9, 10, 11, 13, 15, ...bar2([1, 3, 5, 9, 11, 13, 15])] },
  ] },
  { id: "dp-03", name: "Hypnotic techno", bpm: 138, bars: 1, rows: [
    { name: "Kick", sound: "kick", steps: [1, 5, 9, 13] },
    { name: "Rumble", sound: "808", steps: [1, 5, 9, 13], gain: 0.5 },
    { name: "Tom low", sound: "tom", steps: [2, 4, 10, 12, 14] },
    { name: "Tom high", sound: "rim", steps: [3, 5, 8, 11, 16] },
    { name: "Tom loop", sound: "tom", steps: all16, gain: 0.35 },
    { name: "Closed hat", sound: "hat", steps: [1, 5, 9, 13] },
    { name: "Open hat", sound: "openhat", steps: [3, 7, 11, 15] },
    { name: "Tamb", sound: "hat", steps: [3, 7, 11, 15], gain: 0.5 },
    { name: "Ride", sound: "openhat", steps: [3, 7, 11, 15], gain: 0.4 },
  ] },
  { id: "dp-04", name: "Trance", bpm: 137, bars: 1, rows: [
    { name: "Kick", sound: "kick", steps: [1, 5, 9, 13] },
    { name: "Snare", sound: "snare", steps: [5, 13] },
    { name: "Hat loop", sound: "hat", steps: [1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15, 16], gain: 0.6 },
    { name: "Bass", sound: "808", steps: [3, 7, 11, 15] },
  ] },
  { id: "dp-05", name: "R&B bounce", bpm: 100, bars: 2, rows: [
    { name: "Kick", sound: "kick", steps: [1, 7, ...bar2([1, 7])] },
    { name: "Clap", sound: "clap", steps: [5, 13, ...bar2([5, 13])] },
    { name: "Hats", sound: "hat", steps: [4, ...bar2([4, 11])] },
    { name: "808", sound: "808", steps: [1, 4, 7, 9, 15, ...bar2([1, 4, 7, 9])] },
  ] },
  { id: "dp-06", name: "Drum and bass", bpm: 174, bars: 1, rows: [
    { name: "Kick", sound: "kick", steps: [1, 7] },
    { name: "Snare", sound: "snare", steps: [5, 13] },
    { name: "Hats", sound: "hat", steps: eighths },
    { name: "Open hats", sound: "openhat", steps: [2, 4, 5, 6, 8, 10, 11, 12, 14, 16], gain: 0.45 },
    { name: "Perc (bongo)", sound: "tom", steps: [2, 9, 13, 14, 15, 16], gain: 0.6 },
  ] },
  { id: "dp-07", name: "Afrobeats (rim ramps)", bpm: 112, bars: 1, rows: [
    { name: "Kick", sound: "kick", steps: [1, 4, 11] },
    { name: "Snare", sound: "snare", steps: [1, 4, 7, 11, 13] },
    { name: "Rim", sound: "rim", steps: [1, 3, 4, 5, 11, 12, 13, 15, 16] },
    { name: "Shakers", sound: "hat", steps: [3, 4, 7, 8, 11, 12, 15, 16], gain: 0.5 },
    { name: "Percs", sound: "tom", steps: [4, 5, 7] },
  ] },
  { id: "dp-08", name: "Drum and bass (two-step)", bpm: 174, bars: 1, rows: [
    { name: "Kick", sound: "kick", steps: [1, 11] },
    { name: "Sub", sound: "808", steps: eighths, gain: 0.6 },
    { name: "Snare", sound: "snare", steps: [5, 13] },
    { name: "Closed hat", sound: "hat", steps: [3, 7, 11, 15] },
    { name: "Open hat", sound: "openhat", steps: [9] },
  ] },
  { id: "dp-09", name: "Trap (half-time)", bpm: 140, bars: 2, rows: [
    { name: "Kick", sound: "kick", steps: [1, 7, 11, ...bar2([1, 4, 10, 15])] },
    { name: "808", sound: "808", steps: [1, 7, 11, ...bar2([1, 4, 10, 15])] },
    { name: "Snare", sound: "snare", steps: [9, ...bar2([9])] },
    { name: "Hats", sound: "hat", steps: [1, 3, 5, 7, 8, 9, 11, 12, 13, 15, 16, ...bar2([1, 3, 5, 7, 8, 9, 11, 13, 14, 16])] },
  ] },
];

/** Adds a starter as a new pattern ("Boom bap 80"), returns its id. Doesn't touch the BPM. */
export function addStarterPattern(doc: Y.Doc, preset: StarterPattern, makeId: () => string): string {
  const id = makeId();
  doc.transact(() => {
    const pattern = createPattern(doc, id, `${preset.name} ${preset.bpm}`, preset.bars === 2 ? 32 : 16);
    for (const r of preset.rows) {
      const row = addRow(pattern, makeId(), `builtin:${r.sound}`, r.name);
      if (r.gain !== undefined) row.set("gain", r.gain);
      for (const s of r.steps) setStep(row, s - 1, 1);
    }
  });
  return id;
}
