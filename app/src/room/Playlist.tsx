/**
 * The playlist, in the middle of the screen: tracks on a bar ruler, clips
 * placed by beat. It holds recorded takes now; pattern clips come Wednesday.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import * as Tone from "tone";
import type * as Y from "yjs";
import { getTakes, getTracks, listTracks, readMeta, removeClip, updateClip, type AudioClip, type Clip } from "@/doc/schema";
import { onBuffersChange, peaksFor, playTakes } from "@/engine/takes";
import { useY } from "@/sync/useY";
import { cn } from "@/lib/utils";
import { snapBeat, useUi } from "@/ui/store";

const PX_PER_BEAT = 24;
const HEADER_W = 140;
const ROW_H = 64;
const NUDGE_LIMIT = 50;

let bufferVersion = 0;
onBuffersChange(() => bufferVersion++);
const useBufferVersion = () => useSyncExternalStore((cb) => { const off = onBuffersChange(cb); return () => { off(); }; }, () => bufferVersion);

interface ClipView { trackId: string; clipId: string; clip: Clip }

export function Playlist({ doc }: { doc: Y.Doc }) {
  useEffect(() => playTakes(doc), [doc]);
  useBufferVersion();

  const tracks = getTracks(doc);
  const takes = getTakes(doc);
  const view = useY(tracks, () =>
    listTracks(doc).map(({ id, track }) => {
      const clips: ClipView[] = [];
      track.get("clips")?.forEach((clip: Clip, clipId: string) => clips.push({ trackId: id, clipId, clip }));
      return { id, name: track.get("name") ?? "Track", clips };
    }),
  );
  const takeStates = useY(takes, () => Object.fromEntries([...takes.entries()].map(([id, t]) => [id, t])));
  const { timeSig } = useY(doc.getMap("meta"), () => readMeta(doc));
  const beatsPerBar = timeSig[0];

  const lastBeat = Math.max(0, ...view.flatMap((t) => t.clips.map((c) => c.clip.startBeat + c.clip.lengthBeats)));
  const bars = Math.max(16, Math.ceil(lastBeat / beatsPerBar) + 4);
  const width = bars * beatsPerBar * PX_PER_BEAT;

  const [selected, setSelected] = useState<{ trackId: string; clipId: string } | null>(null);
  const sel = selected && view.find((t) => t.id === selected.trackId)?.clips.find((c) => c.clipId === selected.clipId);

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="playlist">
      <div className="flex min-h-9 flex-wrap items-center gap-2 border-b border-border bg-card/60 px-3 py-1">
        <h2 className="text-sm font-semibold">Playlist <span className="text-[10px] font-normal text-muted-foreground">F5</span></h2>
        {sel && sel.clip.kind === "audio" ? (
          <ClipTools
            clip={sel.clip}
            onChange={(patch) => updateClip(doc, sel.trackId, sel.clipId, patch)}
            onDelete={() => { removeClip(doc, sel.trackId, sel.clipId); setSelected(null); }}
          />
        ) : (
          <span className="text-xs text-muted-foreground">Drag a clip to move it (it lands on the Snap grid). Click it to nudge or delete.</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ width: HEADER_W + width }}>
          {/* Ruler */}
          <div className="sticky top-0 z-10 flex h-6 border-b border-border bg-card text-[10px] text-muted-foreground">
            <div className="sticky left-0 z-20 shrink-0 border-r border-border bg-card" style={{ width: HEADER_W }} />
            {Array.from({ length: bars }, (_, i) => (
              <div className="shrink-0 border-l border-border/60 pl-1 leading-6" key={i} style={{ width: beatsPerBar * PX_PER_BEAT }}>{i + 1}</div>
            ))}
          </div>

          {view.length === 0 ? (
            <div className="flex h-16 items-center px-3 text-sm text-muted-foreground">Record a take and it shows up here, on the beat, for everyone.</div>
          ) : (
            view.map((t) => (
              <div className="flex border-b border-border/60" key={t.id} style={{ height: ROW_H }}>
                <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-border bg-card px-2 text-xs font-medium" style={{ width: HEADER_W }}>
                  <span className="truncate">{t.name}</span>
                </div>
                <div className="relative flex-1" style={{ backgroundImage: `repeating-linear-gradient(to right, transparent 0 ${beatsPerBar * PX_PER_BEAT - 1}px, var(--border) ${beatsPerBar * PX_PER_BEAT - 1}px ${beatsPerBar * PX_PER_BEAT}px)` }}>
                  {t.clips.map((c) => {
                    if (c.clip.kind !== "audio") return null;
                    const take = takeStates[c.clip.takeId];
                    return (
                      <AudioClipView
                        clip={c.clip}
                        hash={take?.hash}
                        key={c.clipId}
                        beatsPerBar={beatsPerBar}
                        onMove={(startBeat) => updateClip(doc, c.trackId, c.clipId, { startBeat })}
                        onSelect={() => setSelected({ trackId: c.trackId, clipId: c.clipId })}
                        selected={selected?.clipId === c.clipId}
                        status={!take ? "missing" : take.uploadState === "uploaded" ? "ready" : "uploading"}
                      />
                    );
                  })}
                </div>
              </div>
            ))
          )}
          <Playhead />
        </div>
      </div>
    </section>
  );
}

interface ClipProps {
  clip: AudioClip;
  hash?: string;
  selected: boolean;
  status: "ready" | "uploading" | "missing";
  beatsPerBar: number;
  onSelect: () => void;
  onMove: (startBeat: number) => void;
}

function AudioClipView({ clip, hash, selected, status, beatsPerBar, onSelect, onMove }: ClipProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const moved = useRef(false);

  // Drag to move. The clip follows the pointer locally and sends one change on release.
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const x0 = e.clientX;
    const snap = useUi.getState().snap;
    moved.current = false;
    let beat = clip.startBeat;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 3) moved.current = true;
      if (!moved.current) return;
      beat = Math.max(0, snapBeat(clip.startBeat + dx / PX_PER_BEAT, snap, beatsPerBar));
      el.style.transform = `translateX(${(beat - clip.startBeat) * PX_PER_BEAT}px)`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.style.transform = "";
      if (moved.current && beat !== clip.startBeat) onMove(beat);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const peaks = hash ? peaksFor(hash) : null;
  const left = (clip.startBeat + clip.nudgeMs / 1000 / (60 / Tone.getTransport().bpm.value)) * PX_PER_BEAT;
  const w = Math.max(4, clip.lengthBeats * PX_PER_BEAT);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !peaks || !hash) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = (ROW_H - 22) * dpr;
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, ROW_H);
    g.fillStyle = "rgba(255,255,255,0.75)";
    // Peaks cover the whole file. Show only the part the clip plays.
    const totalBeats = clip.lengthBeats + clip.trimIn / (60 / Tone.getTransport().bpm.value);
    const fromFrac = 1 - clip.lengthBeats / Math.max(totalBeats, 1e-6);
    const h = ROW_H - 22;
    for (let x = 0; x < w; x++) {
      const i = Math.floor((fromFrac + (x / w) * (1 - fromFrac)) * peaks.length);
      const amp = Math.min(1, (peaks[i] ?? 0) * 1.5) * (h / 2);
      g.fillRect(x, h / 2 - amp, 1, Math.max(1, amp * 2));
    }
  }, [peaks, hash, w, clip.lengthBeats, clip.trimIn]);

  return (
    <button
      className={cn(
        "absolute top-1 flex flex-col overflow-hidden rounded-md border text-left",
        selected ? "border-white bg-rose-500/70" : "border-rose-300/40 bg-rose-500/50 hover:bg-rose-500/60",
        clip.mute && "opacity-40",
      )}
      data-start-beat={clip.startBeat.toFixed(4)}
      data-status={status}
      data-testid="clip"
      data-waveform={peaks ? "drawn" : "none"}
      onClick={() => { if (!moved.current) onSelect(); }}
      onPointerDown={onPointerDown}
      style={{ left, width: w, height: ROW_H - 8, touchAction: "none" }}
    >
      <span className="truncate px-1.5 text-[10px] leading-4 font-medium">
        {status === "uploading" ? "Take · uploading…" : status === "missing" ? "Take missing" : "Take"}
      </span>
      <canvas className="pointer-events-none" ref={canvas} style={{ width: w, height: ROW_H - 22 }} />
    </button>
  );
}

function ClipTools({ clip, onChange, onDelete }: { clip: AudioClip; onChange: (p: Partial<AudioClip>) => void; onDelete: () => void }) {
  const nudge = (ms: number) => onChange({ nudgeMs: Math.max(-NUDGE_LIMIT, Math.min(NUDGE_LIMIT, clip.nudgeMs + ms)) });
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Nudge</span>
      <button aria-label="Nudge earlier" className="btn h-7 px-2" onClick={() => nudge(-5)}>−5 ms</button>
      <span className="w-14 text-center tabular-nums" data-testid="nudge">{clip.nudgeMs > 0 ? "+" : ""}{clip.nudgeMs} ms</span>
      <button aria-label="Nudge later" className="btn h-7 px-2" onClick={() => nudge(5)}>+5 ms</button>
      <button className="btn h-7 px-2" onClick={() => onChange({ mute: !clip.mute })}>{clip.mute ? "Unmute" : "Mute"}</button>
      <button className="btn h-7 px-2 text-destructive" onClick={onDelete}>Delete</button>
    </div>
  );
}

/** Moves with the music every frame, outside React. */
function Playhead() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const el = ref.current;
      const transport = Tone.getTransport();
      if (el) {
        if (transport.state === "started" && transport.seconds >= 0) {
          const beats = (transport.seconds * transport.bpm.value) / 60;
          el.style.transform = `translateX(${HEADER_W + beats * PX_PER_BEAT}px)`;
          el.style.opacity = "1";
        } else {
          el.style.opacity = "0";
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div aria-hidden className="pointer-events-none absolute top-0 bottom-0 left-0 z-30 w-px bg-primary" ref={ref} style={{ opacity: 0 }} />;
}
