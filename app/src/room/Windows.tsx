/**
 * The rack, piano roll and mixer live in one window that either floats over
 * the playlist (FL style) or sits in a bottom dock (Ableton style). The dock
 * can be squashed to a strip so the playlist gets the whole screen.
 */
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type * as Y from "yjs";
import { useUi, type WindowId } from "@/ui/store";
import { cn } from "@/lib/utils";
import { ChannelRack } from "./ChannelRack";

const TITLES: Record<WindowId, string> = { rack: "Channel rack", piano: "Piano roll", mixer: "Mixer" };

function WindowBody({ doc }: { doc: Y.Doc }) {
  const w = useUi((s) => s.window);
  if (w === "rack") return <ChannelRack doc={doc} />;
  if (w === "mixer") return <Placeholder>Each track's volume, pan, mute and solo are on its header in the playlist. The full mixer, with Reverb, Delay and Vox buses and sends, comes next week.</Placeholder>;
  return <Placeholder>Piano roll and built-in synth come after week 1.</Placeholder>;
}

function Placeholder({ children }: { children: ReactNode }) {
  return <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-sm text-muted-foreground">{children}</div>;
}

/** Floats over the playlist. Drag it by its title bar. */
export function FloatingWindow({ doc }: { doc: Y.Doc }) {
  const ui = useUi();
  const ref = useRef<HTMLElement>(null);
  if (!ui.windowOpen || ui.windowMode !== "floating") return null;

  const startDrag = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    // Keep the press point under the pointer.
    const ox = e.clientX - el.offsetLeft;
    const oy = e.clientY - el.offsetTop;
    const move = (ev: PointerEvent) => {
      el.style.left = `${Math.max(0, Math.min(parent.clientWidth - 120, ev.clientX - ox))}px`;
      el.style.top = `${Math.max(0, Math.min(parent.clientHeight - 40, ev.clientY - oy))}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      ui.set({ floatPos: { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0 } });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <section
      aria-label={`${TITLES[ui.window]} window`}
      className="absolute z-30 flex max-h-[calc(100%-16px)] w-[min(860px,calc(100%-16px))] flex-col overflow-hidden rounded-xl border border-white/15 bg-[oklch(0.22_0.012_260)] shadow-[0_20px_48px_rgba(0,0,0,0.55)]"
      data-testid="floating-window"
      ref={ref}
      /* A saved spot can be off screen on a smaller window: keep the title bar reachable. */
      style={{ left: `min(${ui.floatPos.x}px, calc(100% - 160px))`, top: `min(${ui.floatPos.y}px, calc(100% - 48px))` }}
    >
      <div className="flex cursor-move items-center gap-2 bg-white/5 px-3 py-1.5 select-none" onPointerDown={startDrag}>
        <span className="text-sm font-semibold">{TITLES[ui.window]}</span>
        <button className="btn ml-auto h-6 px-2 text-xs" onClick={() => ui.set({ windowMode: "docked", dockSquashed: false })}>Dock to bottom</button>
        <button aria-label="Close window" className="size-6 rounded text-muted-foreground hover:bg-muted" onClick={() => ui.set({ windowOpen: false })}>✕</button>
      </div>
      <div className="overflow-auto p-3">
        <WindowBody doc={doc} />
      </div>
    </section>
  );
}

/** The bottom dock: tabs for each window, squash, pop out, and a drag edge to resize. */
export function Dock({ doc }: { doc: Y.Doc }) {
  const ui = useUi();
  if (!ui.windowOpen || ui.windowMode !== "docked") return null;

  const resize = (e: ReactPointerEvent) => {
    const startY = e.clientY;
    const startH = ui.dockHeight;
    const move = (ev: PointerEvent) => ui.set({ dockHeight: Math.max(140, Math.min(window.innerHeight * 0.75, startH + startY - ev.clientY)) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <section
      aria-label={TITLES[ui.window]}
      className="relative flex shrink-0 flex-col border-t border-white/15 bg-card"
      data-testid="dock"
      style={{ height: ui.dockSquashed ? undefined : ui.dockHeight }}
    >
      {!ui.dockSquashed && <div aria-hidden className="absolute -top-1 right-0 left-0 h-2 cursor-ns-resize" onPointerDown={resize} />}
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        {(Object.keys(TITLES) as WindowId[]).map((id) => (
          <button
            aria-pressed={ui.window === id}
            className={cn("h-6 rounded px-2.5 text-xs", ui.window === id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
            key={id}
            onClick={() => ui.set({ window: id, dockSquashed: false })}
          >
            {TITLES[id]}
          </button>
        ))}
        <button className="btn ml-auto h-6 px-2 text-xs" data-testid="squash" onClick={() => ui.set({ dockSquashed: !ui.dockSquashed })}>
          {ui.dockSquashed ? "Expand" : "Squash"}
        </button>
        <button className="btn h-6 px-2 text-xs" onClick={() => ui.set({ windowMode: "floating" })}>Pop out</button>
        <button aria-label="Close dock" className="size-6 rounded text-muted-foreground hover:bg-muted" onClick={() => ui.set({ windowOpen: false })}>✕</button>
      </div>
      {!ui.dockSquashed && (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <WindowBody doc={doc} />
        </div>
      )}
    </section>
  );
}
