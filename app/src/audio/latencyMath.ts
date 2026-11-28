/** Pure math for the latency check (no browser APIs, so it can be unit-tested). */

export const BURST_S = 0.01;
export const BURSTS = 6;
// Spacing must be longer than MAX_LAG_S, or a late burst gets mistaken for the next one.
export const SPACING_S = 0.6;
export const MAX_LAG_S = 0.45;

/** The same pseudo-random burst every time, so we know what to look for. */
export function makeBurst(sampleRate: number): Float32Array {
  const n = Math.round(BURST_S * sampleRate);
  const out = new Float32Array(n);
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return out;
}

/**
 * Finds where `ref` best matches inside `signal[from, from + maxLag)`, by
 * normalized cross-correlation. Returns the lag in samples and how well it
 * matched (0-1). A tone, hum or speech scores near 0; the burst itself near 1.
 */
export function findLag(signal: Float32Array, ref: Float32Array, from: number, maxLag: number) {
  let refEnergy = 0;
  for (let i = 0; i < ref.length; i++) refEnergy += ref[i] * ref[i];
  let best = -1;
  let bestScore = 0;
  for (let lag = 0; lag < maxLag; lag++) {
    const start = from + lag;
    if (start < 0 || start + ref.length > signal.length) continue;
    let acc = 0;
    let segEnergy = 0;
    for (let i = 0; i < ref.length; i++) {
      const x = signal[start + i];
      acc += x * ref[i];
      segEnergy += x * x;
    }
    const denom = Math.sqrt(refEnergy * segEnergy);
    const score = denom > 0 ? Math.abs(acc) / denom : 0;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return { lag: best, match: bestScore };
}

export interface LatencyResult {
  latencyMs: number;
  /** How many of the bursts were heard clearly. */
  heard: number;
  total: number;
}

/** Median of the lags we could hear clearly, or null if too few were heard. */
export function analyse(
  recorded: Float32Array,
  recordedStartTime: number,
  sampleRate: number,
  burstTimes: number[],
  burst: Float32Array,
): LatencyResult | null {
  const lags: number[] = [];
  const maxLag = Math.round(MAX_LAG_S * sampleRate);
  for (const t of burstTimes) {
    const from = Math.round((t - recordedStartTime) * sampleRate);
    const { lag, match } = findLag(recorded, burst, from, maxLag);
    if (lag >= 0 && match > 0.4) lags.push((lag / sampleRate) * 1000);
  }
  if (lags.length < Math.ceil(burstTimes.length / 2)) return null;
  lags.sort((a, b) => a - b);
  return { latencyMs: lags[Math.floor(lags.length / 2)], heard: lags.length, total: burstTimes.length };
}

