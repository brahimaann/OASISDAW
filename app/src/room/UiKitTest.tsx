/**
 * Day-1 test of the audio/ui kit (ouestlabs/audio-ui, MIT): its Sequencer
 * bound to a shared test pattern, and its Knob bound to the shared BPM.
 */
import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { Knob } from "@/components/audio-ui/knob";
import { createSource } from "@/components/audio-ui/primitive";
import { Sequencer } from "@/components/audio-ui/sequencer";
import { addRow, createPattern, getPatterns, readMeta, readSteps, setBpm, setStep, type RowFields, type TypedMap } from "@/doc/schema";
import { playTestPattern, TEST_PATTERN_ID, TEST_ROWS } from "@/engine/testDrums";
import { currentStep, STEPS_PER_BAR } from "@/engine/transport";
import { serverNow } from "@/sync/clock";
import { useY } from "@/sync/useY";

function ensureTestPattern(doc: Y.Doc) {
  doc.transact(() => {
    const pattern = getPatterns(doc).get(TEST_PATTERN_ID) ?? createPattern(doc, TEST_PATTERN_ID, "UI kit test");
    const rows = pattern.get("rows");
    for (const r of TEST_ROWS) if (!rows?.has(r.id)) addRow(pattern, r.id, r.soundId);
  });
}

export function UiKitTest({ doc }: { doc: Y.Doc }) {
  useEffect(() => ensureTestPattern(doc), [doc]);
  useEffect(() => playTestPattern(doc), [doc]);

  const patterns = getPatterns(doc);
  const grid = useY(patterns, () => {
    const rows = patterns.get(TEST_PATTERN_ID)?.get("rows");
    return TEST_ROWS.map((r) => readSteps((rows?.get(r.id) as TypedMap<RowFields> | undefined) ?? (new Y.Map() as TypedMap<RowFields>), STEPS_PER_BAR));
  });
  const value = useMemo(() => grid.map((row) => row.map((v) => v > 0)), [grid]);

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
    const rows = patterns.get(TEST_PATTERN_ID)?.get("rows");
    if (!rows) return;
    doc.transact(() => {
      next.forEach((cells, ri) => {
        const row = rows.get(TEST_ROWS[ri].id) as TypedMap<RowFields> | undefined;
        if (!row) return;
        cells.forEach((on, si) => {
          // Only send the cells that changed.
          if (on !== value[ri]?.[si]) setStep(row, si, on ? 1 : 0);
        });
      });
    });
  };

  const meta = useY(doc.getMap("meta"), () => readMeta(doc));
  const [knobBpm, setKnobBpm] = useState(meta.bpm);
  useEffect(() => setKnobBpm(meta.bpm), [meta.bpm]);

  return (
    <section className="panel flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">UI kit test: audio/ui Sequencer + Knob</h2>
        <span className="text-xs text-muted-foreground">Shared. Edits show in every tab.</span>
      </div>
      <div data-testid="sequencer">
        <Sequencer aria-label="Test drum pattern" onValueChange={onValueChange} rowLabels={TEST_ROWS.map((r) => r.label)} source={source} value={value} />
      </div>
      <div className="flex items-center gap-4">
        <Knob
          aria-label="Tempo"
          max={200}
          min={60}
          onValueChange={(v) => setKnobBpm(Math.round(v))}
          onValueCommitted={(v) => setBpm(doc, Math.round(v), serverNow())}
          step={1}
          value={knobBpm}
          valueLabel="always"
        />
        <span className="text-sm text-muted-foreground">Tempo knob (drag up or down)</span>
      </div>
    </section>
  );
}
