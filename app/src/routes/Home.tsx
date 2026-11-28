import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AccountButton, useMe } from "@/auth/auth";
import { newId } from "@/doc/ids";

export function Home() {
  const me = useMe();
  const navigate = useNavigate();
  const [join, setJoin] = useState("");

  const joinRoom = () => {
    // Accept a full link or a bare room id.
    const id = join.trim().split("/room/").pop()?.replace(/[^A-Za-z0-9_-]/g, "");
    if (id) navigate(`/room/${id}`);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">OASIS</h1>
        <AccountButton />
      </div>
      <p className="text-muted-foreground">Hi {me.name}. Start a room and send the link.</p>
      <button className="btn-primary h-11" onClick={() => navigate(`/room/${newId(10)}`)}>
        New room
      </button>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); joinRoom(); }}>
        <input aria-label="Room link or id" className="input flex-1" onChange={(e) => setJoin(e.target.value)} placeholder="Paste a room link" value={join} />
        <button className="btn" type="submit">Join</button>
      </form>
    </div>
  );
}
