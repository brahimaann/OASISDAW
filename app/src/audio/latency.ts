/**
 * Round-trip latency check: play short noise bursts out of the speakers or
 * headphones, record them back through the mic, and find how late they
 * arrive by cross-correlation. That delay (output + input) is how far a
 * take must be moved earlier to line up with the beat.
 */
import { openMic, Recorder } from "./recorder";

import { analyse, BURSTS, makeBurst, MAX_LAG_S, SPACING_S, type LatencyResult } from "./latencyMath";

export type { LatencyResult };

/** Runs the 3-second check. Needs the mic to hear the output. */
export async function measureLatency(ctx: AudioContext, deviceId?: string, stream?: MediaStream): Promise<LatencyResult | null> {
  const mic = stream ?? (await openMic(deviceId));
  const rec = new Recorder(ctx, mic);
  await rec.start();
  const burst = makeBurst(ctx.sampleRate);
  const buffer = ctx.createBuffer(1, burst.length, ctx.sampleRate);
  buffer.getChannelData(0).set(burst);
  const t0 = ctx.currentTime + 0.4;
  const times: number[] = [];
  for (let i = 0; i < BURSTS; i++) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.8;
    src.connect(gain).connect(ctx.destination);
    const t = t0 + i * SPACING_S;
    src.start(t);
    times.push(t);
  }
  await new Promise((r) => setTimeout(r, (0.4 + BURSTS * SPACING_S + MAX_LAG_S + 0.2) * 1000));
  const cap = await rec.stop();
  if (!stream) mic.getTracks().forEach((t) => t.stop());
  return analyse(cap.samples, cap.startTime, cap.sampleRate, times, burst);
}

/* ---------- per-device memory (this browser only) ---------- */

const KEY = "oasis.latency";

export function deviceKey(inputLabel: string, outputLabel: string) {
  return `${inputLabel || "default-in"} -> ${outputLabel || "default-out"}`;
}

export function loadLatency(key: string): number | null {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>;
    return typeof all[key] === "number" ? all[key] : null;
  } catch {
    return null;
  }
}

export function saveLatency(key: string, ms: number) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>;
    all[key] = ms;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* storage blocked: the value just won't be remembered */ }
}

/** A guess for when there's no measurement yet: what the browser reports, plus a little. */
export function estimateLatencyMs(ctx: AudioContext, stream?: MediaStream): number {
  const track = stream?.getAudioTracks()[0];
  const inLatency = (track?.getSettings() as { latency?: number } | undefined)?.latency ?? 0.01;
  return ((ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0) + inLatency) * 1000;
}

/** Bluetooth adds 100-300 ms that also drifts. Warn when the device name looks like it. */
export function looksBluetooth(label: string): boolean {
  return /bluetooth|airpods|buds|beats|hands-?free|\bbt\b|wh-1000|bose|jabra|headset \(/i.test(label);
}
