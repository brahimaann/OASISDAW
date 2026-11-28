// Records raw PCM (mono, float32) from the mic input with no processing.
// Sends batches to the main thread with the context frame of their first sample,
// so the app knows exactly when each sample was captured.
const BATCH = 4096;

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.buf = new Float32Array(BATCH);
    this.fill = 0;
    this.bufStartFrame = 0;
    this.port.onmessage = (e) => {
      if (e.data === "start") {
        this.recording = true;
        this.fill = 0;
      } else if (e.data === "stop") {
        this.flush();
        this.recording = false;
        this.port.postMessage({ type: "stopped" });
      }
    };
  }

  flush() {
    if (this.fill === 0) return;
    const out = this.buf.slice(0, this.fill);
    this.port.postMessage({ type: "data", startFrame: this.bufStartFrame, samples: out }, [out.buffer]);
    this.fill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!this.recording || !input || input.length === 0) return true;
    const ch = input[0];
    // Downmix to mono if the device gave us more than one channel.
    const n = ch.length;
    for (let i = 0; i < n; i++) {
      if (this.fill === 0) this.bufStartFrame = currentFrame + i;
      let s = ch[i];
      if (input.length > 1) {
        for (let c = 1; c < input.length; c++) s += input[c][i];
        s /= input.length;
      }
      this.buf[this.fill++] = s;
      if (this.fill === BATCH) this.flush();
    }
    return true;
  }
}

registerProcessor("oasis-recorder", RecorderProcessor);
