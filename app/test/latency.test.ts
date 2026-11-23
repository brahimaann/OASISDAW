// Run: npx tsx app/test/latency.test.ts
import assert from "node:assert/strict";
import { analyse, makeBurst } from "../src/audio/latencyMath.ts";

const sr = 48000;
const burst = makeBurst(sr);
const recStart = 10.0; // context time of recorded[0]
const recorded = new Float32Array(sr * 5);
// Room noise.
let seed = 7;
for (let i = 0; i < recorded.length; i++) {
  seed = (seed * 16807) % 2147483647;
  recorded[i] = ((seed / 2147483647) * 2 - 1) * 0.02;
}
const trueLatencyMs = 37.5;
const times = [10.4, 11.0, 11.6, 12.2, 12.8, 13.4];
for (const t of times) {
  const at = Math.round((t - recStart + trueLatencyMs / 1000) * sr);
  // Quieter and smeared a bit, like a real speaker into a mic.
  for (let i = 0; i < burst.length; i++) recorded[at + i] += burst[i] * 0.3 + (burst[i - 1] ?? 0) * 0.1;
}
const result = analyse(recorded, recStart, sr, times, burst);
assert.ok(result, "should hear the bursts");
assert.ok(Math.abs(result.latencyMs - trueLatencyMs) < 0.1, `got ${result.latencyMs} ms`);
assert.equal(result.heard, 6);

// Silence: nothing heard, so no result rather than a wrong one.
assert.equal(analyse(new Float32Array(sr * 5), recStart, sr, times, burst), null);
console.log(`latency test ok (${result.latencyMs} ms)`);

// A steady tone (like a fake mic's beep, or hum) must not pass as the clicks.
const tone = new Float32Array(sr * 5);
for (let i = 0; i < tone.length; i++) tone[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr) * (Math.floor(i / sr) % 2);
assert.equal(analyse(tone, recStart, sr, times, burst), null, "a tone is not the clicks");
console.log("tone rejected ok");
