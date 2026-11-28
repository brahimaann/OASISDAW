/**
 * Export: the full mix as a WAV, stems as a zip of WAVs, and a share link
 * for the mix. Rendered in this browser, faster than real time.
 */
import { zipSync } from "fflate";
import { useState } from "react";
import * as Tone from "tone";
import type * as Y from "yjs";
import { useMe } from "@/auth/auth";
import { sha256Hex } from "@/audio/wav";
import { getMeta, getPatterns, readMeta } from "@/doc/schema";
import { bufferToWav, fileBase, peakOf, planRender, renderPlan, type ExportRange } from "@/engine/export";
import { uploadToPool } from "@/sync/upload";
import { useY } from "@/sync/useY";
import { useUi } from "@/ui/store";

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

export function ExportButton({ doc }: { doc: Y.Doc }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="h-8 rounded-full border border-border px-3 text-xs hover:bg-accent" data-testid="export-button" onClick={() => setOpen(true)} title="Bounce the mix or stems to WAV">
        Export
      </button>
      {open && <ExportDialog doc={doc} onClose={() => setOpen(false)} />}
    </>
  );
}

function ExportDialog({ doc, onClose }: { doc: Y.Doc; onClose: () => void }) {
  const me = useMe();
  const meta = useY(getMeta(doc), () => readMeta(doc));
  const patternId = useUi((u) => u.patternId);
  const patternName = useY(getPatterns(doc), () => getPatterns(doc).get(patternId)?.get("name") ?? "Pattern 1", [patternId]);
  const hasArrangement = useY(doc.getMap("tracks"), () => planRender(doc, { kind: "song" }).length > 0);

  const [name, setName] = useState(meta.name || "");
  const [key, setKey] = useState(() => getMeta(doc).get("key") ?? "");
  const [range, setRange] = useState<"song" | "pattern">(hasArrangement ? "song" : "pattern");
  const [mix, setMix] = useState(true);
  const [stems, setStems] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [mixWav, setMixWav] = useState<{ blob: Blob; base: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const go = async () => {
    if (Tone.getTransport().state === "started") {
      setNote("Stop playback first, then export.");
      return;
    }
    // Name and key are the project's, so the next export (by anyone) starts with them.
    doc.transact(() => {
      if (name.trim() && name.trim() !== meta.name) getMeta(doc).set("name", name.trim());
      if (key.trim() !== (getMeta(doc).get("key") ?? "")) getMeta(doc).set("key", key.trim());
    });
    const r: ExportRange = range === "song" ? { kind: "song" } : { kind: "pattern", patternId };
    const plan = planRender(doc, r);
    if (plan.length <= 0) {
      setNote("Nothing to export yet. Put patterns or takes on the playlist, or export the open pattern.");
      return;
    }
    const base = fileBase(name || meta.name, meta.bpm, key) + (range === "pattern" ? ` - ${patternName}` : "");
    const notes: string[] = [];
    if (plan.missingTakes) notes.push(`${plan.missingTakes} take${plan.missingTakes > 1 ? "s" : ""} hadn't finished downloading and ${plan.missingTakes > 1 ? "were" : "was"} left out.`);
    try {
      if (mix) {
        setBusy("Rendering the mix…");
        const buf = await renderPlan(plan);
        if (peakOf(buf) > 1) notes.push("The mix clips (goes over 0 dB). Turn some rows down and export again.");
        const blob = bufferToWav(buf);
        setMixWav({ blob, base });
        setLink(null);
        download(blob, `${base}.wav`);
      }
      if (stems) {
        const files: Record<string, Uint8Array> = {};
        for (const [i, stem] of plan.stems.entries()) {
          setBusy(`Rendering stem ${i + 1} of ${plan.stems.length}: ${stem}…`);
          const buf = await renderPlan(plan, stem);
          files[`${base} - ${stem.replace(/[\\/:*?"<>|]+/g, "")}.wav`] = new Uint8Array(await bufferToWav(buf).arrayBuffer());
        }
        setBusy("Zipping…");
        // WAVs barely compress: store them, it's much faster.
        download(new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${base} - stems.zip`);
      }
      notes.unshift(`Done: ${[mix && "mix", stems && `${plan.stems.length} stems`].filter(Boolean).join(" and ")}, ${(plan.length + plan.tail).toFixed(1)} s, 24-bit WAV, 44.1 kHz.`);
    } catch (e) {
      notes.unshift(`Export failed: ${String(e)}`);
    } finally {
      setBusy(null);
      setNote(notes.join(" "));
    }
  };

  const share = async () => {
    if (!mixWav) return;
    setBusy("Uploading the mix…");
    try {
      const hash = await sha256Hex(mixWav.blob);
      const url = await uploadToPool(mixWav.blob, hash, me.getToken);
      const full = `${location.origin}${url}?dl=${encodeURIComponent(mixWav.base)}`;
      setLink(full);
      await navigator.clipboard.writeText(full).catch(() => {});
    } catch (e) {
      setNote(`Upload failed: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section aria-label="Export" className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-white/15 bg-card p-5 shadow-2xl" data-testid="export-dialog" role="dialog">
        <div className="flex items-center">
          <h2 className="font-semibold">Export</h2>
          <button aria-label="Close export" className="ml-auto size-6 rounded text-muted-foreground hover:bg-muted" disabled={!!busy} onClick={onClose}>✕</button>
        </div>

        <div className="grid grid-cols-[1fr_96px] gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Beat name
            <input aria-label="Beat name" className="input text-foreground" onChange={(e) => setName(e.target.value)} placeholder="Untitled beat" value={name} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Key
            <input aria-label="Key" className="input text-foreground" onChange={(e) => setKey(e.target.value)} placeholder="Fmin" value={key} />
          </label>
        </div>

        <fieldset className="flex flex-col gap-1.5 text-sm">
          <legend className="mb-1 text-xs text-muted-foreground">What to bounce</legend>
          <label className="flex items-center gap-2">
            <input checked={range === "song"} disabled={!hasArrangement} name="range" onChange={() => setRange("song")} type="radio" />
            The song (the playlist)
            {!hasArrangement && <span className="text-xs text-muted-foreground">nothing on it yet</span>}
          </label>
          <label className="flex items-center gap-2">
            <input checked={range === "pattern"} name="range" onChange={() => setRange("pattern")} type="radio" />
            {patternName}, one loop
          </label>
        </fieldset>

        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2"><input checked={mix} data-testid="export-mix" onChange={(e) => setMix(e.target.checked)} type="checkbox" /> Full mix</label>
          <label className="flex items-center gap-2"><input checked={stems} data-testid="export-stems" onChange={(e) => setStems(e.target.checked)} type="checkbox" /> Stems (zip)</label>
        </div>

        <p className="text-xs text-muted-foreground">
          File name: <span className="text-foreground">{fileBase(name || meta.name, meta.bpm, key)}{range === "pattern" ? ` - ${patternName}` : ""}.wav</span>
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" data-testid="export-go" disabled={!!busy || (!mix && !stems)} onClick={go}>{busy ? "Working…" : "Export"}</button>
          {mixWav && (
            <button className="btn" data-testid="export-share" disabled={!!busy} onClick={share} title="Upload the mix and copy a link anyone can download from">
              {link ? "Link copied" : "Copy share link"}
            </button>
          )}
        </div>
        {busy && <p className="text-xs text-muted-foreground" data-testid="export-busy">{busy}</p>}
        {note && <p className="text-xs text-muted-foreground" data-testid="export-note">{note}</p>}
        {link && <input aria-label="Share link" className="input text-xs" data-testid="export-link" onFocus={(e) => e.currentTarget.select()} readOnly value={link} />}
      </section>
    </div>
  );
}
