import type { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useRef, useState } from "react";
import type { PresenceUser } from "@/sync/useRoom";

export type PresentUser = PresenceUser & { clientId: number; me: boolean };

export function usePresence(provider: HocuspocusProvider) {
  const [users, setUsers] = useState<PresentUser[]>([]);
  useEffect(() => {
    const awareness = provider.awareness;
    if (!awareness) return;
    const update = () => {
      const list: PresentUser[] = [];
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
  return users;
}

function Avatar({ u, overlap }: { u: PresentUser; overlap?: boolean }) {
  return (
    <span
      className="flex size-6 items-center justify-center rounded-full border-2 border-card text-[11px] font-bold text-black"
      style={{ background: u.color, marginLeft: overlap ? -6 : 0 }}
      title={u.name}
    >
      {u.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** "Who's here": stacked faces in the top bar, the full list on click. */
export function PresenceButton({ provider }: { provider: HocuspocusProvider }) {
  const users = usePresence(provider);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        aria-label="Who's here"
        className="flex h-8 items-center gap-1.5 rounded-full border border-border pr-2.5 pl-1 text-xs text-muted-foreground hover:bg-accent"
        data-testid="presence-button"
        onClick={() => setOpen(!open)}
      >
        <span className="flex">{users.slice(0, 4).map((u, i) => <Avatar key={u.clientId} overlap={i > 0} u={u} />)}</span>
        <span data-testid="presence-count">{users.length} here</span>
      </button>
      {open && (
        <div className="absolute top-10 right-0 z-50 w-56 rounded-lg border border-border bg-card p-3 shadow-xl">
          <h2 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">In the room</h2>
          <ul className="flex flex-col gap-1.5" data-testid="presence">
            {users.map((u) => (
              <li className="flex items-center gap-2 text-sm" key={u.clientId}>
                <span className="size-2.5 rounded-full" style={{ background: u.color }} />
                {u.name}
                {u.me && <span className="text-xs text-muted-foreground">(you)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
