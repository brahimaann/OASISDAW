/**
 * The playlist, in the middle of the screen: tracks on a bar ruler, clips
 * placed by beat. Tracks hold recorded takes and pattern clips, FL-style.
 * Click an empty spot to paint the pattern open in the rack; drag a pattern
 * from the browser; double-click a pattern clip to open it.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import * as Tone from "tone";
import type * as Y from "yjs";
import { newId } from "@/doc/ids";
import {
  addPatternClip, addTrack, faderToDb, getMixer, getPatterns, readChannel, setChannel, type Channel, getTakes, getTracks, listPatterns, listTracks, readMeta, removeClip, updateClip,
  type AudioClip, type Clip, type PatternClip,
} from "@/doc/schema";
import { onBuffersChange, peaksFor } from "@/engine/takes";
import { Knob } from "@/components/audio-ui/knob";
import { useY } from "@/sync/useY";
import { cn } from "@/lib/utils";
import { snapBeat, useUi } from "@/ui/store";
import { PATTERN_MIME, patternColor } from "./Browser";

const PX_PER_BEAT = 24;
const HEADER_W = 210;
const ROW_H = 64;
const NUDGE_LIMIT = 50;

let bufferVersion = 0;
onBuffersChange(() => bufferVersion++);
const useBufferVersion = () => useSyncExternalStore((cb) => { const off = onBuffersChange(cb); return () => { off(); }; }, () => bufferVersion);

interface ClipView { trackId: string; clipId: string; clip: Clip }

/** Where a click or drop lands, in beats, rounded down to the snap grid so a clip starts in the cell you clicked. */
function beatAt(e: { clientX: number }, lane: HTMLElement, beatsPerBar: number) {
  const x = e.clientX - lane.getBoundingClientRect().left;
  const beat = Math.max(0, x / PX_PER_BEAT);
  const { snap } = useUi.getState();
  if (!snap) return beat;
  const grid = snap === 4 ? beatsPerBar : snap;
  return Math.floor(beat / grid) * grid;
}

export function Playlist({ doc }: { doc: Y.Doc }) {
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
  const patternInfo = useY(getPatterns(doc), () => Object.fromEntries(listPatterns(doc).map((p) => [p.id, { name: p.name }])));
  const { timeSig } = useY(doc.getMap("meta"), () => readMeta(doc));
  const beatsPerBar = timeSig[0];

  const lastBeat = Math.max(0, ...view.flatMap((t) => t.clips.map((c) => c.clip.startBeat + c.clip.lengthBeats)));
  const bars = Math.max(16, Math.ceil(lastBeat / beatsPerBar) + 4);
  const width = bars * beatsPerBar * PX_PER_BEAT;

  const selected = useUi((u) => u.selectedClip);
  const setUi = useUi((u) => u.set);
  const setSelected = (sel: { trackId: string; clipId: string } | null) => setUi({ selectedClip: sel });
  const sel = selected && view.find((t) => t.id === selected.trackId)?.clips.find((c) => c.clipId === selected.clipId);

  // Delete / Backspace removes the clip you clicked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return;
      const s = useUi.getState().selectedClip;
      if (!s) return;
      e.preventDefault();
      removeClip(doc, s.trackId, s.clipId);
      setUi({ selectedClip: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, setUi]);

  /** Paints a pattern at a beat. `trackId` null = the empty lane at the bottom: make a new track. */
  const place = (trackId: string | null, patternId: string, beat: number) => {
    if (!getPatterns(doc).has(patternId)) return;
    doc.transact(() => {
      const t = trackId ?? addTrack(doc, newId);
      const clipId = newId();
      addPatternClip(doc, t, clipId, patternId, beat);
      setSelected({ trackId: t, clipId });
    });
  };

  const currentPattern = () => {
    const id = useUi.getState().patternId;
    return getPatterns(doc).has(id) ? id : (listPatterns(doc)[0]?.id ?? "main");
  };

  const laneProps = (trackId: string | null) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || e.target !== e.currentTarget) return; // clicks on clips are theirs
      place(trackId, currentPattern(), beatAt(e, e.currentTarget, beatsPerBar));
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes(PATTERN_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      const id = e.dataTransfer.getData(PATTERN_MIME);
      if (!id) return;
      e.preventDefault();
      place(trackId, id, beatAt(e, e.currentTarget, beatsPerBar));
    },
  });

  const grid = { backgroundImage: `repeating-linear-gradient(to right, transparent 0 ${beatsPerBar * PX_PER_BEAT - 1}px, var(--border) ${beatsPerBar * PX_PER_BEAT - 1}px ${beatsPerBar * PX_PER_BEAT}px)` };

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
          <span className="text-xs text-muted-foreground">
            Click an empty spot to paint the pattern open in the rack. Drag clips to move them. Double-click a pattern to open it. Right-click or Delete removes one.
          </span>
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

          {view.map((t) => (
            <div className="flex border-b border-border/60" data-track={t.name} key={t.id} style={{ height: ROW_H }}>
              <TrackHeader doc={doc} name={t.name} trackId={t.id} />
              <div className="relative flex-1 cursor-copy" data-testid="lane" style={grid} {...laneProps(t.id)}>
                {t.clips.map((c) => {
                  const common = {
                    beatsPerBar,
                    onMove: (startBeat: number) => updateClip(doc, c.trackId, c.clipId, { startBeat }),
                    onSelect: () => setSelected({ trackId: c.trackId, clipId: c.clipId }),
                    onRemove: () => { removeClip(doc, c.trackId, c.clipId); setSelected(null); },
                    selected: selected?.clipId === c.clipId,
                  };
                  if (c.clip.kind === "pattern") {
                    const pid = c.clip.patternId;
                    return (
                      <PatternClipView
                        {...common}
                        clip={c.clip}
                        key={c.clipId}
                        name={patternInfo[pid]?.name ?? "Missing pattern"}
                        onOpen={() => { setUi({ patternId: pid }); useUi.getState().showWindow("rack"); }}
                      />
                    );
                  }
                  const take = takeStates[c.clip.takeId];
                  return (
                    <AudioClipView
                      {...common}
                      clip={c.clip}
                      hash={take?.hash}
                      key={c.clipId}
                      status={!take ? "missing" : take.uploadState === "uploaded" ? "ready" : "uploading"}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {/* An empty lane at the bottom: paint or drop here for a new track. */}
          <div className="flex border-b border-border/40" style={{ height: ROW_H }}>
            <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-border bg-card/50 px-2 text-xs text-muted-foreground" style={{ width: HEADER_W }}>
              + New track
            </div>
            <div className="relative flex-1 cursor-copy" data-testid="new-lane" style={grid} {...laneProps(null)}>
              {view.length === 0 && (
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                  Click here to place the pattern from the rack, or record a take.
                </span>
              )}
            </div>
          </div>
          <Playhead />
        </div>
      </div>
    </section>
  );
}

/**
 * Drag to move. The clip follows the pointer locally and sends one change
 * on release. Returns whether the last press was a drag, so it isn't also a click.
 */
function useClipDrag(startBeat: number, beatsPerBar: number, onMove: (b: number) => void) {
  const moved = useRef(false);
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const el = e.currentTarget;
    const x0 = e.clientX;
    const snap = useUi.getState().snap;
    moved.current = false;
    let beat = startBeat;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 3) moved.current = true;
      if (!moved.current) return;
      beat = Math.max(0, snapBeat(startBeat + dx / PX_PER_BEAT, snap, beatsPerBar));
      el.style.transform = `translateX(${(beat - startBeat) * PX_PER_BEAT}px)`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.style.transform = "";
      if (moved.current && beat !== startBeat) onMove(beat);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return { moved, onPointerDown };
}

interface CommonClipProps {
  selected: boolean;
  beatsPerBar: number;
  onSelect: () => void;
  onMove: (startBeat: number) => void;
  onRemove: () => void;
}

function PatternClipView({ clip, name, selected, beatsPerBar, onSelect, onMove, onRemove, onOpen }: CommonClipProps & { clip: PatternClip; name: string; onOpen: () => void }) {
  const { moved, onPointerDown } = useClipDrag(clip.startBeat, beatsPerBar, onMove);
  const color = patternColor(clip.patternId);
  return (
    <button
      className={cn("absolute top-1 flex flex-col overflow-hidden rounded-md border text-left text-black", selected ? "border-white" : "border-black/20", clip.mute && "opacity-40")}
      data-pattern={clip.patternId}
      data-start-beat={clip.startBeat.toFixed(4)}
      data-testid="pattern-clip"
      onClick={() => { if (!moved.current) onSelect(); }}
      onContextMenu={(e: ReactMouseEvent) => { e.preventDefault(); onRemove(); }}
      onDoubleClick={onOpen}
      onPointerDown={onPointerDown}
      style={{ left: clip.startBeat * PX_PER_BEAT, width: Math.max(4, clip.lengthBeats * PX_PER_BEAT), height: ROW_H - 8, background: color, touchAction: "none" }}
      title={`${name}: double-click to open in the rack, right-click to remove`}
    >
      <span className="truncate px-1.5 text-[10px] leading-4 font-semibold">{name}</span>
      <span aria-hidden className="mx-1.5 mb-1 flex-1 rounded-sm bg-black/15" />
    </button>
  );
}

function AudioClipView({ clip, hash, selected, status, beatsPerBar, onSelect, onMove, onRemove }: CommonClipProps & { clip: AudioClip; hash?: string; status: "ready" | "uploading" | "missing" }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { moved, onPointerDown } = useClipDrag(clip.startBeat, beatsPerBar, onMove);
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
      onContextMenu={(e) => { e.preventDefault(); onRemove(); }}
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

/** BandLab / Ableton-style strip on each track: mute, solo, volume, pan. Shared with everyone. */
function TrackHeader({ doc, trackId, name }: { doc: Y.Doc; trackId: string; name: string }) {
  const ch = useY(getMixer(doc), () => readChannel(doc, trackId), [trackId]);
  // Faders move locally while you drag and send one change when you let go.
  const [gain, setGain] = useState(ch.gain);
  const [pan, setPan] = useState(ch.pan);
  useEffect(() => setGain(ch.gain), [ch.gain]);
  useEffect(() => setPan(ch.pan), [ch.pan]);
  const set = (patch: Partial<Channel>) => setChannel(doc, trackId, patch);
  const db = faderToDb(gain);

  return (
    <div className="sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1 border-r border-border bg-card px-2" data-track-header={name} style={{ width: HEADER_W }}>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={name}>{name}</span>
        <button aria-label={`Mute ${name}`} aria-pressed={ch.mute} className={cn("h-5 w-5 rounded border text-[10px] font-bold", ch.mute ? "border-amber-400 bg-amber-400 text-black" : "text-muted-foreground hover:bg-muted")} onClick={() => set({ mute: !ch.mute })}>M</button>
        <button aria-label={`Solo ${name}`} aria-pressed={ch.solo} className={cn("h-5 w-5 rounded border text-[10px] font-bold", ch.solo ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")} onClick={() => set({ solo: !ch.solo })}>S</button>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          aria-label={`${name} volume`}
          className="h-1 min-w-0 flex-1 accent-primary"
          max={1}
          min={0}
          onChange={(e) => setGain(Number(e.target.value))}
          onDoubleClick={() => { setGain(0.8); set({ gain: 0.8 }); }}
          onPointerUp={() => set({ gain })}
          onKeyUp={() => set({ gain })}
          step={0.01}
          title={`Volume ${Number.isFinite(db) ? `${db > 0 ? "+" : ""}${db.toFixed(1)} dB` : "off"} (double-click for 0 dB)`}
          type="range"
          value={gain}
        />
        <span className="w-9 text-right text-[10px] text-muted-foreground tabular-nums">{Number.isFinite(db) ? `${db > 0 ? "+" : ""}${db.toFixed(0)}dB` : "-∞"}</span>
        <Knob
          anchor={0.5}
          aria-label={`${name} pan`}
          formatValue={(v) => (Math.abs(v - 0.5) < 0.01 ? "C" : v < 0.5 ? `L${Math.round((0.5 - v) * 200)}` : `R${Math.round((v - 0.5) * 200)}`)}
          max={1}
          min={0}
          onValueChange={setPan}
          onValueCommitted={(v) => set({ pan: v })}
          size="xs"
          step={0.01}
          value={pan}
          valueLabel="hidden"
        />
      </div>
    </div>
  );
}
