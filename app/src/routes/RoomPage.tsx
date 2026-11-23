import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AccountButton, useMe } from "@/auth/auth";
import { followDoc } from "@/engine/transport";
import { syncClock } from "@/sync/clock";
import { useRoom, type PresenceUser } from "@/sync/useRoom";
import { Chat } from "@/room/Chat";
import { Presence } from "@/room/Presence";
import { TransportBar } from "@/room/TransportBar";
import { UiKitTest } from "@/room/UiKitTest";

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

  useEffect(() => {
    if (room) (window as unknown as Record<string, unknown>).__oasisDoc = room.doc;
  }, [room]);

  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  if (status === "denied") {
    return <div className="p-8 text-center">You don't have access to this room. <Link className="underline" to="/">Go home</Link></div>;
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <Link className="text-xl font-bold tracking-tight" to="/">OASIS</Link>
        <span className="font-mono text-sm text-muted-foreground">room {id}</span>
        <button className="btn h-7 text-xs" onClick={copyLink}>{copied ? "Copied" : "Copy invite link"}</button>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span data-testid="status">{synced ? status : "syncing"}</span>
          <AccountButton />
        </span>
      </header>

      {!room || !synced ? (
        <div className="panel text-muted-foreground">Joining room…</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            <TransportBar doc={room.doc} />
            <UiKitTest doc={room.doc} />
          </div>
          <aside className="flex flex-col gap-4">
            <Presence provider={room.provider} />
            <Chat doc={room.doc} />
          </aside>
        </div>
      )}
    </div>
  );
}
