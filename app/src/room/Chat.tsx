import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { useMe } from "@/auth/auth";
import { newId } from "@/doc/ids";
import { getChat, sendChat } from "@/doc/schema";
import { serverNow } from "@/sync/clock";
import { useY } from "@/sync/useY";
import { useUi } from "@/ui/store";

/** Chat button for the top bar, with a dot for unread messages. */
export function ChatButton({ doc }: { doc: Y.Doc }) {
  const chat = getChat(doc);
  const count = useY(chat, () => chat.length);
  const { chatOpen, set } = useUi();
  const [seen, setSeen] = useState(count);
  useEffect(() => { if (chatOpen) setSeen(count); }, [chatOpen, count]);
  const unread = Math.max(0, count - seen);

  return (
    <button
      aria-pressed={chatOpen}
      className="relative flex h-8 items-center rounded-full border border-border px-3 text-xs hover:bg-accent aria-pressed:bg-accent"
      data-testid="chat-button"
      onClick={() => set({ chatOpen: !chatOpen })}
    >
      Chat
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground" data-testid="chat-unread">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}

/** The chat drawer. It stays mounted so the draft and scroll survive closing it. */
export function ChatDrawer({ doc }: { doc: Y.Doc }) {
  const me = useMe();
  const chat = getChat(doc);
  const messages = useY(chat, () => chat.toArray().slice(-200));
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const { chatOpen, set } = useUi();

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, chatOpen]);

  return (
    <aside
      aria-label="Chat"
      className="absolute top-2 right-2 bottom-2 z-40 flex w-72 flex-col rounded-lg border border-border bg-card p-3 shadow-2xl"
      hidden={!chatOpen}
    >
      <div className="mb-2 flex items-center">
        <h2 className="text-sm font-semibold">Chat</h2>
        <button aria-label="Close chat" className="ml-auto size-6 rounded text-muted-foreground hover:bg-muted" onClick={() => set({ chatOpen: false })}>✕</button>
      </div>
      <ol className="flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm" data-testid="chat" ref={listRef}>
        {messages.length === 0 && <li className="text-muted-foreground">No messages yet.</li>}
        {messages.map((m) => (
          <li key={m.id}>
            <span className="font-semibold">{m.name}</span>{" "}
            <span className="text-xs text-muted-foreground">{new Date(m.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            <div className="break-words">{m.text}</div>
          </li>
        ))}
      </ol>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          sendChat(doc, { id: newId(), userId: me.id, name: me.name, text: draft, ts: serverNow() });
          setDraft("");
        }}
      >
        <input aria-label="Message" className="input min-w-0 flex-1" maxLength={2000} onChange={(e) => setDraft(e.target.value)} placeholder="Say something" value={draft} />
        <button className="btn" type="submit">Send</button>
      </form>
    </aside>
  );
}
