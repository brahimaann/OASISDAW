/**
 * Estimates this browser's clock offset to the sync server, NTP-style:
 * ask the server for its time a few times and trust the fastest round trip.
 * serverNow() = Date.now() + offset.
 */
let offsetMs = 0;
let bestRttMs = Infinity;

export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function clockStats() {
  return { offsetMs, rttMs: bestRttMs };
}

async function sampleOnce() {
  const t0 = Date.now();
  const res = await fetch("/time", { cache: "no-store" });
  const { now } = (await res.json()) as { now: number };
  const t1 = Date.now();
  const rtt = t1 - t0;
  if (rtt < bestRttMs) {
    bestRttMs = rtt;
    offsetMs = now - (t0 + rtt / 2);
  }
}

/** Takes `samples` measurements. Safe to call again later to refine. */
export async function syncClock(samples = 8) {
  for (let i = 0; i < samples; i++) {
    try {
      await sampleOnce();
    } catch (err) {
      console.warn("[oasis] clock sample failed", err);
    }
  }
  return clockStats();
}
