/**
 * The top bar: everything that's global to the song. Transport, tempo,
 * metronome, count-in, snap, the window buttons, and the people.
 */
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import * as Tone from "tone";
import type * as Y from "yjs";
import { AccountButton } from "@/auth/auth";
import { getMeta, play, readMeta, setBpm, stop } from "@/doc/schema";
import { audioUnlocked, setClickEnabled, unlockAudio } from "@/engine/transport";
import { serverNow } from "@/sync/clock";
import { useY } from "@/sync/useY";
import { SNAP_OPTIONS, useUi, type Snap, type WindowId } from "@/ui/store";
import { cn } from "@/lib/utils";
import { ChatButton } from "./Chat";
import { PresenceButton } from "./Presence";

export function TopBar({ doc, provider, roomId, status }: { doc: Y.Doc; provider: HocuspocusProvider; roomId: string; status: string }) {
  const meta = getMeta(doc);
  const { bpm, timeSig, playState } = useY(meta, () => readMeta(doc));
  const [bpmDraft, setBpmDraft] = useState(String(bpm));
  const ui = useUi();

  useEffect(() => setBpmDraft(String(bpm)), [bpm]);
  useEffect(() => setClickEnabled(ui.clickOn), [ui.clickOn]);

  const togglePlay = async () => {
    await unlockAudio();
    if (playState.playing) stop(doc, serverNow());
    else play(doc, serverNow());
  };

  const commitBpm = () => {
    const n = Number(bpmDraft);
    if (Number.isFinite(n) && n > 0) setBpm(doc, n, serverNow());
    else setBpmDraft(String(bpm));
  };

  const [copied, setCopied] = useState(false);
  const invite = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
      <div className="mr-1 flex items-baseline gap-2">
        <Link className="text-[15px] font-bold tracking-wide" to="/">OASIS</Link>
        <span className="font-mono text-xs text-muted-foreground">{roomId}</span>
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1">
        <button
          aria-label={playState.playing ? "Stop (Space)" : "Play (Space)"}
          className={cn("h-8 w-11 rounded-md font-bold", playState.playing ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
          data-testid="play"
          onClick={togglePlay}
          title="Play / Stop (Space). Everyone in the room plays and stops together."
        >
          {playState.playing ? "■" : "▶"}
        </button>
        <button
          aria-label="Record"
          aria-pressed={ui.recordOpen || ui.recording}
          className={cn("flex h-8 w-9 items-center justify-center rounded-md text-rose-400", ui.recording ? "animate-pulse bg-rose-600 text-white" : ui.recordOpen ? "bg-accent" : "hover:bg-accent")}
          data-testid="record-toggle"
          onClick={() => ui.set({ recordOpen: !ui.recordOpen })}
          title="Record vocals"
        >
          <svg aria-hidden height="14" viewBox="0 0 24 24" width="14"><circle cx="12" cy="12" fill="currentColor" r="8" /></svg>
        </button>
        <Position beatsPerBar={timeSig[0]} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <label className="flex items-center gap-1.5">
          BPM
          <input
            aria-label="BPM"
            className="input h-8 w-14 px-2 text-foreground tabular-nums"
            data-testid="bpm"
            inputMode="numeric"
            onBlur={commitBpm}
            onChange={(e) => setBpmDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            value={bpmDraft}
          />
        </label>
        <span className="rounded-md border border-border px-2 py-1.5 text-foreground">{timeSig[0]}/{timeSig[1]}</span>
        <button
          aria-label="Metronome"
          aria-pressed={ui.clickOn}
          className={cn("flex size-8 items-center justify-center rounded-md border border-border text-foreground", ui.clickOn ? "bg-accent text-primary" : "opacity-60 hover:opacity-100")}
          data-testid="metronome"
          onClick={() => ui.set({ clickOn: !ui.clickOn })}
          title={ui.clickOn ? "Metronome on (only you hear it)" : "Metronome off"}
        >
          <svg aria-hidden fill="none" height="15" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="15"><path d="M9 3h6l4 18H5zM12 17l5-9" /></svg>
        </button>
        <label className="flex items-center gap-1.5" title="Clicks before a recording starts. Only the person recording hears them.">
          Count-in
          <select aria-label="Count-in before recording" className="input h-8 px-1.5 text-foreground" onChange={(e) => ui.set({ countInBars: Number(e.target.value) as 0 | 1 | 2 })} value={ui.countInBars}>
            <option value={0}>Off</option>
            <option value={1}>1 bar</option>
            <option value={2}>2 bars</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5" title="Snap: clips you move land on this grid">
          <svg aria-hidden fill="none" height="14" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="14"><path d="M6 3v8a6 6 0 0 0 12 0V3M6 3h4v8a2 2 0 0 0 4 0V3h4" /></svg>
          Snap
          <select aria-label="Snap to grid" className="input h-8 w-24 px-1.5 text-foreground" onChange={(e) => ui.set({ snap: Number(e.target.value) as Snap })} value={ui.snap}>
            {SNAP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>

      <div aria-label="Windows" className="flex items-center gap-0.5 rounded-lg border border-border p-0.5" role="toolbar">
        <WindowButton id="rack" keyLabel="F6">Rack</WindowButton>
        <WindowButton id="piano" keyLabel="F7">Piano roll</WindowButton>
        <WindowButton id="mixer" keyLabel="F9">Mixer</WindowButton>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span
          aria-label={`Connection: ${status}`}
          className={cn("size-2 rounded-full", status === "connected" ? "bg-emerald-400" : "animate-pulse bg-amber-400")}
          data-status={status}
          data-testid="status"
          title={status === "connected" ? "Connected to the room" : "Reconnecting… your edits are kept and sync when it's back"}
        />
        <PresenceButton provider={provider} />
        <ChatButton doc={doc} />
        <button className="h-8 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90" onClick={invite} title="Copy the room link">
          {copied ? "Link copied" : "Invite"}
        </button>
        <AccountButton />
      </div>
    </header>
  );
}

function WindowButton({ id, keyLabel, children }: { id: WindowId; keyLabel: string; children: ReactNode }) {
  const { window: w, windowOpen, windowMode, dockSquashed, toggleWindow } = useUi();
  const showing = windowOpen && w === id && !(windowMode === "docked" && dockSquashed);
  return (
    <button
      aria-pressed={showing}
      className={cn("h-7 rounded-md px-2 text-xs", showing ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
      data-testid={`window-${id}`}
      onClick={() => toggleWindow(id)}
    >
      {children} <span className="text-[10px] opacity-60">{keyLabel}</span>
    </button>
  );
}

/** Bar.beat readout, updated every frame outside React. */
function Position({ beatsPerBar }: { beatsPerBar: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    let last = "";
    const tick = () => {
      const t = Tone.getTransport();
      let text = "1.1";
      if (t.state === "started") {
        const beats = (t.seconds * t.bpm.value) / 60;
        text = beats < 0 ? `-${Math.ceil(-beats)}` : `${Math.floor(beats / beatsPerBar) + 1}.${Math.floor(beats % beatsPerBar) + 1}`;
      }
      if (text !== last && ref.current) ref.current.textContent = last = text;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [beatsPerBar]);
  return <span className="w-14 px-2 text-center text-[15px] tabular-nums" data-testid="position" ref={ref}>1.1</span>;
}

/** Browsers keep audio off until a click. A slim bar under the top bar until then. */
export function SoundBanner() {
  const [unlocked, setUnlocked] = useState(audioUnlocked());
  useEffect(() => {
    const ctx = Tone.getContext().rawContext as AudioContext;
    const on = () => setUnlocked(ctx.state === "running");
    ctx.addEventListener("statechange", on);
    return () => ctx.removeEventListener("statechange", on);
  }, []);
  if (unlocked) return null;
  return (
    <button className="w-full border-b border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-left text-xs text-amber-200" onClick={async () => { await unlockAudio(); setUnlocked(true); }}>
      Click here to turn on sound. Browsers keep audio off until you click.
    </button>
  );
}
