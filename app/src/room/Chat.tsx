import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { useMe } from "@/auth/auth";
import { newId } from "@/doc/ids";
import { getChat, sendChat } from "@/doc/schema";
import { serverNow } from "@/sync/clock";
import { useY } from "@/sync/useY";

export function Chat({ doc }: { doc: Y.Doc }) {
  const me = useMe();
  const chat = getChat(doc);
  const messages = useY(chat, () => chat.toArray().slice(-200));
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  return (
    <section className="panel flex min-h-80 flex-col">
      <h2 className="mb-2 text-sm font-semibold">Chat</h2>
      <ol className="flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm" data-testid="chat" ref={listRef} style={{ maxHeight: 360 }}>
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
          sendChat(doc, { id: newId(), userId: me.id, name: me.name, text: draft, ts: serverNow() });
          setDraft("");
        }}
      >
        <input aria-label="Message" className="input min-w-0 flex-1" maxLength={2000} onChange={(e) => setDraft(e.target.value)} placeholder="Say something" value={draft} />
        <button className="btn" type="submit">Send</button>
      </form>
    </section>
  );
}
