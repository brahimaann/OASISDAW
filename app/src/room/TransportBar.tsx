import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { getMeta, play, readMeta, setBpm, stop } from "@/doc/schema";
import { audioUnlocked, currentStep, setClickEnabled, STEPS_PER_BAR, unlockAudio } from "@/engine/transport";
import { serverNow } from "@/sync/clock";
import { useY } from "@/sync/useY";
import { useUi } from "@/ui/store";

export function TransportBar({ doc }: { doc: Y.Doc }) {
  const meta = getMeta(doc);
  const { bpm, playState } = useY(meta, () => readMeta(doc));
  const [bpmDraft, setBpmDraft] = useState(String(bpm));
  const [unlocked, setUnlocked] = useState(audioUnlocked());
  const { clickOn, setClickOn } = useUi();

  useEffect(() => setBpmDraft(String(bpm)), [bpm]);
  useEffect(() => setClickEnabled(clickOn), [clickOn]);

  const unlock = async () => {
    await unlockAudio();
    setUnlocked(true);
  };

  const togglePlay = async () => {
    await unlock();
    if (playState.playing) stop(doc, serverNow());
    else play(doc, serverNow());
  };

  const commitBpm = () => {
    const n = Number(bpmDraft);
    if (Number.isFinite(n) && n > 0) setBpm(doc, n, serverNow());
    else setBpmDraft(String(bpm));
  };

  return (
    <section className="panel flex flex-col gap-3">
      {!unlocked && (
        <button className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-left text-sm text-amber-200" onClick={unlock}>
          Click here to turn on sound. Browsers keep audio off until you click.
        </button>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button aria-label={playState.playing ? "Stop" : "Play"} className="btn-primary w-24" data-testid="play" onClick={togglePlay}>
          {playState.playing ? "■ Stop" : "▶ Play"}
        </button>
        <label className="flex items-center gap-2 text-sm">
          BPM
          <input
            aria-label="BPM"
            className="input w-20 tabular-nums"
            data-testid="bpm"
            inputMode="numeric"
            onBlur={commitBpm}
            onChange={(e) => setBpmDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            value={bpmDraft}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input checked={clickOn} onChange={(e) => setClickOn(e.target.checked)} type="checkbox" />
          Click
        </label>
        <span className="text-xs text-muted-foreground">Everyone in the room plays and stops together.</span>
      </div>
      <StepLights />
    </section>
  );
}

/** 16 lights for the current step, drawn on a canvas every frame, outside React. */
function StepLights() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const style = getComputedStyle(document.documentElement);
    const on = style.getPropertyValue("--primary").trim() || "#22d3ee";
    const off = style.getPropertyValue("--muted").trim() || "#333";
    const beat = style.getPropertyValue("--secondary").trim() || "#444";
    let frame = 0;
    let lastStep = -2;
    let lastW = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const step = currentStep();
      if (step !== lastStep || w !== lastW) {
        lastStep = step;
        lastW = w;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const gap = 4;
        const cell = (w - gap * (STEPS_PER_BAR - 1)) / STEPS_PER_BAR;
        for (let i = 0; i < STEPS_PER_BAR; i++) {
          ctx.fillStyle = i === step ? on : i % 4 === 0 ? beat : off;
          ctx.beginPath();
          ctx.roundRect(i * (cell + gap), 0, cell, h, 3);
          ctx.fill();
        }
        canvas.dataset.step = String(step);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas aria-hidden className="h-3 w-full" data-testid="step-lights" ref={ref} />;
}
