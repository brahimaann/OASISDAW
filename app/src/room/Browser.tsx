/**
 * The browser, on the left. Sounds you can click to hear and drag onto the
 * rack, and the project's takes. Collapses to a thin vertical tab so the
 * playlist gets the room.
 */
import { useState } from "react";
import type * as Y from "yjs";
import { newId } from "@/doc/ids";
import { BUILTIN_SOUNDS, getPatterns, getTakes, listPatterns, newPatternFrom, readMeta, setBpm, type Take } from "@/doc/schema";
import { addStarterPattern, STARTER_PATTERNS } from "@/doc/starterPatterns";
import { serverNow } from "@/sync/clock";
import { previewTake } from "@/engine/takes";
import { unlockAudio } from "@/engine/transport";
import { previewSound } from "@/engine/voices";
import { useY } from "@/sync/useY";
import { useUi, type BrowserTab } from "@/ui/store";
import { cn } from "@/lib/utils";

/** Drag-and-drop type for a sound dragged out of the browser. */
export const SOUND_MIME = "application/x-oasis-sound";
/** Drag-and-drop type for a pattern dragged onto the playlist. */
export const PATTERN_MIME = "application/x-oasis-pattern";

const GROUPS: { name: string; ids: string[] }[] = [
  { name: "Drums", ids: ["builtin:kick", "builtin:snare", "builtin:clap", "builtin:rim", "builtin:tom"] },
  { name: "Hats", ids: ["builtin:hat", "builtin:openhat"] },
  { name: "Bass", ids: ["builtin:808"] },
];

export function Browser({ doc }: { doc: Y.Doc }) {
  const { browserOpen, browserTab, set } = useUi();

  if (!browserOpen) {
    return (
      <button
        aria-label="Open browser"
        className="w-7 shrink-0 border-r border-border bg-card text-[11px] tracking-widest text-muted-foreground uppercase hover:text-foreground"
        data-testid="browser-tab"
        onClick={() => set({ browserOpen: true })}
        style={{ writingMode: "vertical-rl" }}
        title="Open the browser (Alt+F8)"
      >
        Browser
      </button>
    );
  }

  return (
    <aside aria-label="Browser" className="flex w-56 shrink-0 flex-col border-r border-border bg-card" data-testid="browser">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {(["sounds", "patterns", "takes"] as BrowserTab[]).map((t) => (
          <button
            aria-pressed={browserTab === t}
            className={cn("h-6 rounded px-2 text-xs capitalize", browserTab === t ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
            key={t}
            onClick={() => set({ browserTab: t })}
          >
            {t}
          </button>
        ))}
        <button aria-label="Collapse browser" className="ml-auto size-6 rounded text-muted-foreground hover:bg-muted" onClick={() => set({ browserOpen: false })} title="Collapse (Alt+F8)">«</button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {browserTab === "sounds" ? <SoundList /> : browserTab === "patterns" ? <PatternList doc={doc} /> : <TakeList doc={doc} />}
      </div>
      <p className="border-t border-border p-2 text-[11px] leading-snug text-muted-foreground">
        {browserTab === "sounds"
          ? "Click to hear a sound. Drag it onto the rack for a new row, or onto a row to swap its sound."
          : browserTab === "patterns"
            ? "Click a pattern to open it in the rack. Drag it onto the playlist to place it."
            : "Every take recorded in this project. Click to hear it."}
      </p>
    </aside>
  );
}

function SoundList() {
  return (
    <div className="flex flex-col gap-3" data-testid="sound-list">
      {GROUPS.map((g) => (
        <div key={g.name}>
          <h3 className="mb-1 px-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{g.name}</h3>
          <ul>
            {g.ids.map((id) => {
              const s = BUILTIN_SOUNDS.find((x) => x.id === id)!;
              return (
                <li key={id}>
                  <button
                    className="flex w-full cursor-grab items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent active:cursor-grabbing"
                    data-sound={id}
                    draggable
                    onClick={async () => { await unlockAudio(); previewSound(id); }}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(SOUND_MIME, id);
                      e.dataTransfer.setData("text/plain", s.name);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    title={`${s.name}: click to hear, drag to use`}
                  >
                    <span aria-hidden className="text-[10px] text-muted-foreground">▶</span>
                    {s.name}
                    <span className="ml-auto text-[10px] text-muted-foreground">synth</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <p className="rounded border border-dashed border-border px-2 py-2 text-[11px] text-muted-foreground">
        Your own one-shots and loops show up here once they're added.
      </p>
    </div>
  );
}

function PatternList({ doc }: { doc: Y.Doc }) {
  const patterns = getPatterns(doc);
  const list = useY(patterns, () => listPatterns(doc).map(({ id, name, length }) => ({ id, name, length })));
  const { patternId, set, showWindow } = useUi();
  return (
    <div className="flex flex-col gap-1">
      <ul data-testid="pattern-list">
        {list.map((p) => (
          <li key={p.id}>
            <button
              aria-current={p.id === patternId}
              className="flex w-full cursor-grab items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent active:cursor-grabbing aria-current:bg-accent"
              data-pattern={p.id}
              draggable
              onClick={() => { set({ patternId: p.id }); showWindow("rack"); }}
              onDragStart={(e) => {
                e.dataTransfer.setData(PATTERN_MIME, p.id);
                e.dataTransfer.setData("text/plain", p.name);
                e.dataTransfer.effectAllowed = "copy";
              }}
              title={`${p.name}: click to open, drag onto the playlist`}
            >
              <span aria-hidden className="size-2.5 rounded-sm" style={{ background: patternColor(p.id) }} />
              {p.name}
              <span className="ml-auto text-[10px] text-muted-foreground">{p.length / 16} bar{p.length > 16 ? "s" : ""}</span>
            </button>
          </li>
        ))}
      </ul>
      <button className="btn h-7 text-xs" onClick={() => { set({ patternId: newPatternFrom(doc, patternId, newId) }); showWindow("rack"); }}>+ New pattern</button>
      <StarterList doc={doc} />
    </div>
  );
}

/** Drum grids from the pattern breakdowns sheet. Click adds a copy; the tempo button sets the room's BPM. */
function StarterList({ doc }: { doc: Y.Doc }) {
  const { set, showWindow } = useUi();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button aria-expanded={open} className="flex w-full items-center gap-1 px-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground" data-testid="starter-toggle" onClick={() => setOpen(!open)}>
        <span aria-hidden>{open ? "▾" : "▸"}</span> Starter patterns
      </button>
      {open && (
        <ul className="mt-1" data-testid="starter-list">
          {STARTER_PATTERNS.map((p) => (
            <li className="flex items-center gap-1" key={p.id}>
              <button
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent"
                data-starter={p.id}
                onClick={() => { set({ patternId: addStarterPattern(doc, p, newId) }); showWindow("rack"); }}
                title={`Add "${p.name}" as a new pattern`}
              >
                <span className="truncate">{p.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{p.bars} bar{p.bars > 1 ? "s" : ""}</span>
              </button>
              <button
                className="shrink-0 rounded px-1.5 py-1 text-[10px] text-muted-foreground tabular-nums hover:bg-accent hover:text-foreground"
                data-starter-bpm={p.id}
                onClick={() => setBpm(doc, p.bpm, serverNow())}
                title={readMeta(doc).bpm === p.bpm ? "The room is already at this tempo" : `Set the room to ${p.bpm} BPM`}
              >
                {p.bpm}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A steady colour per pattern, so its clips are easy to spot on the playlist. */
export function patternColor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `oklch(0.72 0.13 ${h % 360})`;
}

function TakeList({ doc }: { doc: Y.Doc }) {
  const takes = getTakes(doc);
  const list = useY(takes, () => [...takes.entries()].map(([id, t]) => ({ id, t })));
  if (list.length === 0) return <p className="px-1 text-sm text-muted-foreground">No takes yet.</p>;
  return (
    <ul data-testid="take-list">
      {list.map(({ id, t }, i) => (
        <li key={id}>
          <TakeItem n={i + 1} take={t} />
        </li>
      ))}
    </ul>
  );
}

function TakeItem({ take, n }: { take: Take; n: number }) {
  return (
    <button
      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent"
      onClick={async () => { await unlockAudio(); previewTake(take); }}
    >
      <span aria-hidden className="text-[10px] text-muted-foreground">▶</span>
      Take {n}
      <span className="ml-auto text-[10px] text-muted-foreground">{take.uploadState === "uploaded" ? "" : "uploading"}</span>
    </button>
  );
}
