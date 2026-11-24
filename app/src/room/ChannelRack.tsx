/**
 * The channel rack: one row per sound, 16 steps. Built on the audio/ui
 * Sequencer and Knob. Every click sends only the cells that changed.
 */
import { useEffect, useMemo, useState } from "react";
import type * as Y from "yjs";
import { Knob } from "@/components/audio-ui/knob";
import { createSource } from "@/components/audio-ui/primitive";
import { Sequencer } from "@/components/audio-ui/sequencer";
import { newId } from "@/doc/ids";
import {
  addRow, BUILTIN_SOUNDS, getPatterns, listRows, MAIN_PATTERN_ID,
  readSteps, removeRow, setStep, type RowFields, type TypedMap,
} from "@/doc/schema";
import { currentStep, STEPS_PER_BAR, unlockAudio } from "@/engine/transport";
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
  const rows = useY(patterns, (): RowView[] =>
    listRows(patterns.get(MAIN_PATTERN_ID)).map(({ id, row }) => ({
      id,
      row,
      name: row.get("name") ?? "Sound",
      soundId: row.get("soundId") ?? "",
      gain: row.get("gain") ?? 0.8,
      pan: row.get("pan") ?? 0.5,
      mute: row.get("mute") ?? false,
      solo: row.get("solo") ?? false,
      steps: readSteps(row, STEPS_PER_BAR),
    })),
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
      const s = currentStep();
      if (source.getSnapshot() !== s) source.set(s);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [source]);

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
    const pattern = patterns.get(MAIN_PATTERN_ID);
    const sound = BUILTIN_SOUNDS.find((s) => s.id === soundId);
    if (pattern && sound) addRow(pattern, newId(), sound.id, sound.name);
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
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Pattern 1 · Edits show and play for everyone. Ctrl/Cmd+Z undoes only yours.</span>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input checked={showVelocity} onChange={(e) => setShowVelocity(e.target.checked)} type="checkbox" />
          Velocity
        </label>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto" data-testid="sequencer">
          <div className="min-w-[640px]">
            <Sequencer
              aria-label="Channel rack"
              onValueChange={onValueChange}
              onVelocityChange={onVelocityChange}
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
        <span className="text-xs text-muted-foreground">Or drag a sound from the browser onto the rack, or onto a row to swap it.</span>
      </div>
    </section>
  );
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
        onClick={() => {
          const pattern = getPatterns(doc).get(MAIN_PATTERN_ID);
          if (pattern) removeRow(pattern, r.id);
        }}
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
