/** Lossless WAV (32-bit float, mono) and SHA-256 helpers. */

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 4;
  const dataLen = samples.length * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true); // IEEE float
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * bytesPerSample, true);
  v.setUint16(32, bytesPerSample, true);
  v.setUint16(34, 32, true);
  str(36, "data");
  v.setUint32(40, dataLen, true);
  new Float32Array(buf, 44).set(samples);
  return new Blob([buf], { type: "audio/wav" });
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Max absolute value per bucket, for drawing a waveform. */
export function computePeaks(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  const per = Math.max(1, Math.floor(samples.length / buckets));
  for (let b = 0; b < buckets; b++) {
    let m = 0;
    const end = Math.min(samples.length, (b + 1) * per);
    for (let i = b * per; i < end; i++) {
      const a = Math.abs(samples[i]);
      if (a > m) m = a;
    }
    out[b] = m;
  }
  return out;
}
