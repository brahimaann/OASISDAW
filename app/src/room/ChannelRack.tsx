/**
 * The channel rack: one row per sound, 1 to 8 bars of 16th steps, one
 * pattern at a time (pick it at the top). Built on the audio/ui
 * Sequencer and Knob. Every click sends only the cells that changed.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type * as Y from "yjs";
import { Knob } from "@/components/audio-ui/knob";
import { createSource } from "@/components/audio-ui/primitive";
import { Sequencer } from "@/components/audio-ui/sequencer";
import { newId } from "@/doc/ids";
import {
  addRow, BUILTIN_SOUNDS, getPatterns, listPatterns, listRows, MAIN_PATTERN_ID, newPatternFrom, PATTERN_LENGTHS,
  readSteps, setPatternLength, setStep, type PatternLength, type RowFields, type TypedMap,
} from "@/doc/schema";
import { playingStep } from "@/engine/rack";
import { STEPS_PER_BAR, unlockAudio } from "@/engine/transport";
import { useUi } from "@/ui/store";
import { previewSound } from "@/engine/voices";
import { useY } from "@/sync/useY";
import { SOUND_MIME } from "./Browser";
import { cn } from "@/lib/utils";

interface RowView {
  id: string;
  row: TypedMap<RowFields>;
  name: string;
  soundId: string;
  gain: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  steps: number[];
}

export function ChannelRack({ doc }: { doc: Y.Doc }) {
  const patterns = getPatterns(doc);
  const wanted = useUi((u) => u.patternId);
  const setUi = useUi((u) => u.set);
  const list = useY(patterns, () => listPatterns(doc).map(({ id, name, length }) => ({ id, name, length })));
  // Fall back to the first pattern if yours was deleted, or you're new here.
  const patternId = list.some((p) => p.id === wanted) ? wanted : (list[0]?.id ?? MAIN_PATTERN_ID);
  const current = list.find((p) => p.id === patternId);
  const length = current?.length ?? 16;
  const bars = length / STEPS_PER_BAR;

  const rows = useY(patterns, (): RowView[] =>
    listRows(patterns.get(patternId)).map(({ id, row }) => ({
      id,
      row,
      name: row.get("name") ?? "Sound",
      soundId: row.get("soundId") ?? "",
      gain: row.get("gain") ?? 0.8,
      pan: row.get("pan") ?? 0.5,
      mute: row.get("mute") ?? false,
      solo: row.get("solo") ?? false,
      steps: readSteps(row, length),
    })),
    [patternId, length],
  );
  const value = useMemo(() => rows.map((r) => r.steps.map((v) => v > 0)), [rows]);
  const velocities = useMemo(() => rows.map((r) => r.steps.map((v) => (v > 0 ? v : 1))), [rows]);
  const [showVelocity, setShowVelocity] = useState(false);
  const [dropping, setDropping] = useState(false);

  // The playing column, pushed every frame without re-rendering React.
  const [source] = useState(() => createSource(-1));
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const s = playingStep(doc, patternId);
      if (source.getSnapshot() !== s) source.set(s);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [source, doc, patternId]);

  const onValueChange = (next: boolean[][]) => {
    doc.transact(() => {
      next.forEach((cells, ri) => {
        const r = rows[ri];
        if (!r) return;
        cells.forEach((on, si) => {
          if (on !== (r.steps[si] > 0)) setStep(r.row, si, on ? 1 : 0);
        });
      });
    });
  };

  const onVelocityChange = (next: number[][]) => {
    doc.transact(() => {
      next.forEach((vels, ri) => {
        const r = rows[ri];
        if (!r) return;
        vels.forEach((v, si) => {
          // Only steps that are on carry a velocity.
          if (r.steps[si] > 0 && Math.abs(v - r.steps[si]) > 0.001) setStep(r.row, si, Math.max(0.05, v));
        });
      });
    });
  };

  const addSound = (soundId: string) => {
    const pattern = patterns.get(patternId);
    const sound = BUILTIN_SOUNDS.find((s) => s.id === soundId);
    if (pattern && sound) addRow(pattern, newId(), sound.id, sound.name);
  };

  const setLength = (l: PatternLength) => setPatternLength(doc, patternId, l);

  // FL's steps handle: drag the grid's right edge to add or remove bars.
  const [dragBars, setDragBars] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragEdge = (e: ReactPointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const barPx = Math.max(160, (gridRef.current?.clientWidth ?? 640) / bars);
    const options = PATTERN_LENGTHS.map((l) => l / STEPS_PER_BAR);
    let target = bars;
    const move = (ev: PointerEvent) => {
      const want = bars + (ev.clientX - x0) / barPx;
      // The closest allowed length: 1, 2, 4 or 8 bars.
      target = options.reduce((best, o) => (Math.abs(o - want) < Math.abs(best - want) ? o : best), options[0]);
      setDragBars(target);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragBars(null);
      if (target !== bars) setLength((target * STEPS_PER_BAR) as PatternLength);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <section
      className={cn("flex flex-col gap-3 rounded-md", dropping && "ring-2 ring-primary")}
      data-testid="rack"
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false); }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SOUND_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDrop={(e) => {
        setDropping(false);
        const id = e.dataTransfer.getData(SOUND_MIME);
        if (!id) return;
        e.preventDefault();
        addSound(id);
      }}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button aria-label="Previous pattern (−)" className="btn h-7 w-7 px-0" onClick={() => setUi({ patternId: stepPattern(list, patternId, -1) })} title="Previous pattern (−)">‹</button>
        <select
          aria-label="Pattern"
          className="input h-7 max-w-40 px-2 text-xs font-semibold"
          data-testid="pattern-picker"
          onChange={(e) => setUi({ patternId: e.target.value })}
          value={patternId}
        >
          {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button aria-label="Next pattern (+)" className="btn h-7 w-7 px-0" onClick={() => setUi({ patternId: stepPattern(list, patternId, 1) })} title="Next pattern (+)">›</button>
        <button className="btn h-7 px-2 text-xs" data-testid="new-pattern" onClick={() => setUi({ patternId: newPatternFrom(doc, patternId, newId) })} title="A new empty pattern with the same sounds">+ New</button>
        <button className="btn h-7 px-2 text-xs" onClick={() => setUi({ patternId: newPatternFrom(doc, patternId, newId, true) })} title="A copy of this pattern, steps and all">Clone</button>
        <label className="ml-2 flex items-center gap-1.5 text-muted-foreground">
          Length
          <select aria-label="Pattern length" className="input h-7 px-1.5 text-xs text-foreground" data-testid="pattern-length" onChange={(e) => setLength(Number(e.target.value) as PatternLength)} value={length}>
            {PATTERN_LENGTHS.map((l) => <option key={l} value={l}>{l / STEPS_PER_BAR} bar{l > STEPS_PER_BAR ? "s" : ""}</option>)}
          </select>
        </label>
        <label className="ml-auto flex items-center gap-2 text-muted-foreground">
          <input checked={showVelocity} onChange={(e) => setShowVelocity(e.target.checked)} type="checkbox" />
          Velocity
        </label>
      </div>

      {rows.length > 0 ? (
        <div className="flex items-stretch overflow-x-auto" data-testid="sequencer">
          <div className="shrink-0 grow" ref={gridRef} style={{ minWidth: 300 + length * (length > 32 ? 26 : 22) }}>
            <Sequencer
              aria-label="Channel rack"
              beatEvery={4}
              onValueChange={onValueChange}
              onVelocityChange={onVelocityChange}
              renderCell={(_, step) => (step > 0 && step % STEPS_PER_BAR === 0 ? <span className="pointer-events-none opacity-60">{step / STEPS_PER_BAR + 1}</span> : null)}
              renderRowLabel={(i) => rows[i] && <RowControls doc={doc} r={rows[i]} />}
              rowLabels={rows.map((r) => r.name)}
              shadeByVelocity
              showVelocity={showVelocity}
              size="sm"
              source={source}
              value={value}
              velocities={velocities}
            />
          </div>
          <div
            aria-label="Drag to change the pattern length"
            className="sticky right-0 ml-1 flex w-4 shrink-0 cursor-ew-resize items-center justify-center rounded bg-secondary text-[10px] text-muted-foreground hover:bg-primary/40"
            data-testid="length-handle"
            onPointerDown={dragEdge}
            role="separator"
            title="Drag to add or remove bars"
          >
            {dragBars !== null ? dragBars : "⋮"}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No sounds yet. Add one below.</p>
      )}

      <div className="flex items-center gap-2">
        <select
          aria-label="Add a sound"
          className="input h-8 text-xs"
          data-testid="add-sound"
          onChange={(e) => {
            if (e.target.value) addSound(e.target.value);
            e.target.value = "";
          }}
          value=""
        >
          <option value="">+ Add sound</option>
          {BUILTIN_SOUNDS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">Or drag a sound from the browser onto the rack, or onto a row to swap it. Ctrl/Cmd+Z undoes only your edits.</span>
      </div>
    </section>
  );
}

/** The pattern before or after this one in the picker, wrapping around. */
export function stepPattern(list: { id: string }[], id: string, dir: 1 | -1): string {
  if (list.length === 0) return id;
  const i = Math.max(0, list.findIndex((p) => p.id === id));
  return list[(i + dir + list.length) % list.length].id;
}

function RowControls({ doc, r }: { doc: Y.Doc; r: RowView }) {
  // Knobs move locally while you drag and send one change when you let go.
  const [gain, setGain] = useState(r.gain);
  const [pan, setPan] = useState(r.pan);
  const [over, setOver] = useState(false);
  useEffect(() => setGain(r.gain), [r.gain]);
  useEffect(() => setPan(r.pan), [r.pan]);

  const set = <K extends keyof RowFields & string>(key: K, value: RowFields[K]) => r.row.set(key, value);

  return (
    <div
      className={cn("flex items-center gap-1 rounded pr-2", over && "bg-primary/25")}
      data-row={r.name}
      onDragLeave={() => setOver(false)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SOUND_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDrop={(e) => {
        setOver(false);
        const s = BUILTIN_SOUNDS.find((x) => x.id === e.dataTransfer.getData(SOUND_MIME));
        if (!s) return;
        e.preventDefault();
        e.stopPropagation();
        doc.transact(() => { set("soundId", s.id); set("name", s.name); });
      }}
    >
      <button
        aria-label={`Play ${r.name}`}
        className="h-6 w-5 rounded text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={async () => { await unlockAudio(); previewSound(r.soundId); }}
        title="Play this sound"
      >
        ▶
      </button>
      <select
        aria-label={`${r.name} sound`}
        className="h-6 w-16 cursor-pointer truncate appearance-none rounded bg-transparent px-1 text-xs hover:bg-muted"
        onChange={(e) => {
          const s = BUILTIN_SOUNDS.find((x) => x.id === e.target.value);
          if (s) doc.transact(() => { set("soundId", s.id); set("name", s.name); });
        }}
        title="Change sound"
        value={r.soundId}
      >
        {BUILTIN_SOUNDS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <ToggleButton label="Mute" on={r.mute} onClick={() => set("mute", !r.mute)} text="M" tone="amber" />
      <ToggleButton label="Solo" on={r.solo} onClick={() => set("solo", !r.solo)} text="S" tone="primary" />
      <Knob
        aria-label={`${r.name} volume`}
        formatValue={(v) => `${Math.round(v * 100)}%`}
        max={1}
        min={0}
        onValueChange={setGain}
        onValueCommitted={(v) => set("gain", v)}
        size="xs"
        step={0.01}
        value={gain}
        valueLabel="hidden"
      />
      <Knob
        anchor={0.5}
        aria-label={`${r.name} pan`}
        formatValue={(v) => (Math.abs(v - 0.5) < 0.01 ? "C" : v < 0.5 ? `L${Math.round((0.5 - v) * 200)}` : `R${Math.round((v - 0.5) * 200)}`)}
        max={1}
        min={0}
        onValueChange={setPan}
        onValueCommitted={(v) => set("pan", v)}
        size="xs"
        step={0.01}
        value={pan}
        valueLabel="hidden"
      />
      <button
        aria-label={`Remove ${r.name}`}
        className="h-6 w-6 rounded text-xs text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
        onClick={() => (r.row.parent as Y.Map<unknown> | null)?.delete(r.id)}
        title="Remove row"
      >
        ✕
      </button>
    </div>
  );
}

function ToggleButton({ label, on, onClick, text, tone }: { label: string; on: boolean; onClick: () => void; text: string; tone: "amber" | "primary" }) {
  return (
    <button
      aria-label={label}
      aria-pressed={on}
      className={cn(
        "h-6 w-6 rounded border text-[10px] font-bold",
        on ? (tone === "amber" ? "border-amber-400 bg-amber-400 text-black" : "border-primary bg-primary text-primary-foreground") : "text-muted-foreground hover:bg-muted",
      )}
      onClick={onClick}
    >
      {text}
    </button>
  );
}
