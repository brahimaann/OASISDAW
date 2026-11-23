import type { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import type { PresenceUser } from "@/sync/useRoom";

export function Presence({ provider }: { provider: HocuspocusProvider }) {
  const [users, setUsers] = useState<(PresenceUser & { clientId: number; me: boolean })[]>([]);

  useEffect(() => {
    const awareness = provider.awareness;
    if (!awareness) return;
    const update = () => {
      const list: (PresenceUser & { clientId: number; me: boolean })[] = [];
      awareness.getStates().forEach((state, clientId) => {
        const u = state.user as PresenceUser | undefined;
        if (u) list.push({ ...u, clientId, me: clientId === awareness.clientID });
      });
      list.sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
      setUsers(list);
    };
    awareness.on("change", update);
    update();
    return () => awareness.off("change", update);
  }, [provider]);

  return (
    <section className="panel">
      <h2 className="mb-2 text-sm font-semibold">In the room ({users.length})</h2>
      <ul className="flex flex-col gap-1.5" data-testid="presence">
        {users.map((u) => (
          <li className="flex items-center gap-2 text-sm" key={u.clientId}>
            <span className="size-2.5 rounded-full" style={{ background: u.color }} />
            {u.name}
            {u.me && <span className="text-xs text-muted-foreground">(you)</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
