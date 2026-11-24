import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as Y from "yjs";
import { useMe } from "@/auth/auth";
import { newId } from "@/doc/ids";
import { ensureMainPattern, getPatterns, getTracks, play, readMeta, stop } from "@/doc/schema";
import { playRack } from "@/engine/rack";
import { debugClock, followDoc, unlockAudio } from "@/engine/transport";
import { serverNow, syncClock } from "@/sync/clock";
import { useRoom, type PresenceUser } from "@/sync/useRoom";
import { useUi } from "@/ui/store";
import { Browser } from "@/room/Browser";
import { ChatDrawer } from "@/room/Chat";
import { Playlist } from "@/room/Playlist";
import { RecordPanel } from "@/room/RecordPanel";
import { SoundBanner, TopBar } from "@/room/TopBar";
import { Dock, FloatingWindow } from "@/room/Windows";

const COLORS = ["#22d3ee", "#f472b6", "#a3e635", "#fbbf24", "#a78bfa", "#fb7185", "#34d399", "#60a5fa"];

function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function RoomPage() {
  const { id = "" } = useParams();
  const me = useMe();
  const user = useMemo<PresenceUser>(() => ({ id: me.id, name: me.name, color: colorFor(me.id) }), [me.id, me.name]);
  const { room, status, synced } = useRoom(id, user, me.getToken);
  const [clockReady, setClockReady] = useState(false);

  useEffect(() => {
    let alive = true;
    syncClock().then(() => alive && setClockReady(true));
    // Re-measure now and then; offsets drift a little.
    const t = setInterval(() => syncClock(4), 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!room || !synced || !clockReady) return;
    return followDoc(room.doc);
  }, [room, synced, clockReady]);

  // The rack plays whether or not its window is open.
  useEffect(() => {
    if (!room || !synced) return;
    ensureMainPattern(room.doc, newId);
    return playRack(room.doc);
  }, [room, synced]);

  useEffect(() => {
    if (room) Object.assign(window, { __oasisDoc: room.doc, __oasisClock: debugClock });
  }, [room]);

  useShortcuts(room?.doc ?? null);

  if (status === "denied") {
    return <div className="p-8 text-center">You don't have access to this room. <Link className="underline" to="/">Go home</Link></div>;
  }

  if (!room || !synced) {
    return <div className="flex h-dvh items-center justify-center text-muted-foreground">Joining room…</div>;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar doc={room.doc} provider={room.provider} roomId={id} status={status} />
      <SoundBanner />
      <div className="flex min-h-0 flex-1">
        <Browser doc={room.doc} />
        <main className="relative flex min-w-0 flex-1 flex-col">
          <Playlist doc={room.doc} />
          <FloatingWindow doc={room.doc} />
          <RecordPanel doc={room.doc} roomId={id} />
          <ChatDrawer doc={room.doc} />
        </main>
      </div>
      <Dock doc={room.doc} />
    </div>
  );
}

/**
 * FL keys: Space play/stop, F5 playlist (closes the floating window),
 * F6 rack, F7 piano roll, F9 mixer, Alt+F8 browser. Ctrl/Cmd+Z undoes only
 * your own edits; Shift adds redo.
 */
function useShortcuts(doc: Y.Doc | null) {
  const undo = useMemo(() => (doc ? new Y.UndoManager([getPatterns(doc), getTracks(doc)], { captureTimeout: 400 }) : null), [doc]);
  useEffect(() => () => undo?.destroy(), [undo]);

  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest("input, textarea, select, [contenteditable]");
      const ui = useUi.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) undo?.redo();
        else undo?.undo();
        return;
      }
      if (e.key === " " && !typing && !target?.closest("button")) {
        e.preventDefault();
        void unlockAudio().then(() => (readMeta(doc).playState.playing ? stop(doc, serverNow()) : play(doc, serverNow())));
        return;
      }
      if (e.key === "F8" && e.altKey) { e.preventDefault(); ui.set({ browserOpen: !ui.browserOpen }); return; }
      if (e.key === "F5") { e.preventDefault(); if (ui.windowMode === "floating") ui.set({ windowOpen: false }); return; }
      if (e.key === "F6") { e.preventDefault(); ui.toggleWindow("rack"); return; }
      if (e.key === "F7") { e.preventDefault(); ui.toggleWindow("piano"); return; }
      if (e.key === "F9") { e.preventDefault(); ui.toggleWindow("mixer"); return; }
      if (e.key === "Escape") ui.set({ chatOpen: false, recordOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, undo]);
}
