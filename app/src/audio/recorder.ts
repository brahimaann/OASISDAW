/**
 * Mic input + raw PCM recording through an AudioWorklet. The mic's own
 * processing (echo cancel, noise suppression, auto gain) is turned off:
 * the take is the studio take, not a call.
 */
import workletUrl from "./recorder.worklet.js?url";

const loaded = new WeakSet<BaseAudioContext>();

async function ensureWorklet(ctx: AudioContext) {
  if (loaded.has(ctx)) return;
  await ctx.audioWorklet.addModule(workletUrl);
  loaded.add(ctx);
}

export async function openMic(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });
}

export interface Captured {
  samples: Float32Array;
  /** Context time (seconds) of samples[0]. */
  startTime: number;
  sampleRate: number;
}

export class Recorder {
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private firstFrame = -1;
  /** Called for each batch as it arrives, e.g. to save it to IndexedDB. */
  onChunk?: (samples: Float32Array, index: number) => void;
  /** Called once, with the context time of the first sample. */
  onFirstSample?: (time: number) => void;
  private stopped: (() => void) | null = null;

  private ctx: AudioContext;
  private stream: MediaStream;

  constructor(ctx: AudioContext, stream: MediaStream) {
    this.ctx = ctx;
    this.stream = stream;
  }

  async start() {
    await ensureWorklet(this.ctx);
    this.chunks = [];
    this.firstFrame = -1;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "oasis-recorder", { numberOfInputs: 1, numberOfOutputs: 0 });
    this.node.port.onmessage = (e) => {
      const msg = e.data as { type: "data"; startFrame: number; samples: Float32Array } | { type: "stopped" };
      if (msg.type === "data") {
        if (this.firstFrame < 0) {
          this.firstFrame = msg.startFrame;
          this.onFirstSample?.(msg.startFrame / this.ctx.sampleRate);
        }
        this.chunks.push(msg.samples);
        this.onChunk?.(msg.samples, this.chunks.length - 1);
      } else {
        this.stopped?.();
      }
    };
    this.source.connect(this.node);
    this.node.port.postMessage("start");
  }

  get recording() {
    return this.node !== null;
  }

  async stop(): Promise<Captured> {
    const node = this.node;
    if (!node) throw new Error("not recording");
    await new Promise<void>((resolve) => {
      this.stopped = resolve;
      node.port.postMessage("stop");
    });
    this.source?.disconnect();
    node.disconnect();
    this.node = null;
    this.source = null;
    return {
      samples: concat(this.chunks),
      startTime: Math.max(0, this.firstFrame) / this.ctx.sampleRate,
      sampleRate: this.ctx.sampleRate,
    };
  }
}

export function concat(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
