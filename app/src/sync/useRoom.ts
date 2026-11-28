import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { initDoc } from "@/doc/schema";

export interface PresenceUser {
  id: string;
  name: string;
  color: string;
}

export interface Room {
  doc: Y.Doc;
  provider: HocuspocusProvider;
}

export type RoomStatus = "connecting" | "connected" | "disconnected" | "denied";

function syncUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/sync`;
}

/** Joins a room: one Y.Doc per room, synced through Hocuspocus. */
export function useRoom(roomId: string, user: PresenceUser, getToken: () => Promise<string>) {
  const [room, setRoom] = useState<Room | null>(null);
  const [status, setStatus] = useState<RoomStatus>("connecting");
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: syncUrl(),
      name: `room:${roomId}`,
      document: doc,
      token: getToken,
      onStatus: ({ status }) => setStatus(status as RoomStatus),
      onAuthenticationFailed: () => setStatus("denied"),
      onSynced: () => {
        initDoc(doc);
        setSynced(true);
      },
    });
    setRoom({ doc, provider });
    return () => {
      provider.destroy();
      doc.destroy();
      setRoom(null);
      setSynced(false);
    };
    // getToken is stable per signed-in user; re-joining on every render would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Presence: who's here.
  useEffect(() => {
    room?.provider.setAwarenessField("user", user);
  }, [room, user]);

  return { room, status, synced };
}
