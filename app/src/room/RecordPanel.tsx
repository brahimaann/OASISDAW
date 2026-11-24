/**
 * Vocal recording: pick a mic, confirm headphones, check latency once per
 * device, then record against the beat. Takes save locally while recording
 * and upload in the background.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { useMe } from "@/auth/auth";
import { deviceKey, estimateLatencyMs, loadLatency, looksBluetooth, measureLatency, saveLatency } from "@/audio/latency";
import { openMic } from "@/audio/recorder";
import { readMeta } from "@/doc/schema";
import { audioContext } from "@/engine/audioContext";
import { resumePendingTakes, startRecording, type TakeInProgress } from "@/engine/recordTake";
import { unlockAudio } from "@/engine/transport";
import { useY } from "@/sync/useY";
import { useUi } from "@/ui/store";

type Phase = "idle" | "opening" | "checking" | "recording" | "saving";

export function RecordPanel({ doc, roomId }: { doc: Y.Doc; roomId: string }) {
  const me = useMe();
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputLabel, setOutputLabel] = useState("");
  const [deviceId, setDeviceId] = useState<string>("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [headphones, setHeadphones] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [latency, setLatency] = useState<{ ms: number; measured: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const take = useRef<TakeInProgress | null>(null);
  const { playState } = useY(doc.getMap("meta"), () => readMeta(doc));

  const inputLabel = inputs.find((d) => d.deviceId === deviceId)?.label ?? stream?.getAudioTracks()[0]?.label ?? "";
  const key = deviceKey(inputLabel, outputLabel);
  const bluetooth = looksBluetooth(inputLabel) || looksBluetooth(outputLabel);

  const onUploadProgress = useCallback((id: string, f: number) => setUploads((u) => {
    const next = { ...u, [id]: f };
    if (f >= 1) delete next[id];
    return next;
  }), []);

  // Pick up takes that didn't finish uploading last time (refresh, crash, Wi-Fi).
  useEffect(() => {
    void resumePendingTakes({ doc, roomId, userName: me.name, getToken: me.getToken, onUploadProgress }).then((n) => {
      if (n > 0) setNote(`Recovered ${n} take${n > 1 ? "s" : ""} from last time and sent ${n > 1 ? "them" : "it"} up.`);
    });
  }, [doc, roomId, me.name, me.getToken, onUploadProgress]);

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    setInputs(all.filter((d) => d.kind === "audioinput"));
    setOutputLabel(all.find((d) => d.kind === "audiooutput" && d.deviceId === "default")?.label ?? all.find((d) => d.kind === "audiooutput")?.label ?? "");
  }, []);

  useEffect(() => {
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  // Latency for this device: measured before, or the browser's estimate.
  useEffect(() => {
    if (!stream) return;
    const saved = loadLatency(key);
    setLatency(saved !== null ? { ms: saved, measured: true } : { ms: estimateLatencyMs(audioContext(), stream), measured: false });
  }, [stream, key]);

  const ensureMic = async (id = deviceId) => {
    if (stream && (!id || stream.getAudioTracks()[0]?.getSettings().deviceId === id)) return stream;
    setPhase("opening");
    try {
      stream?.getTracks().forEach((t) => t.stop());
      const s = await openMic(id || undefined);
      setStream(s);
      setDeviceId(s.getAudioTracks()[0]?.getSettings().deviceId ?? id);
      await refreshDevices();
      return s;
    } catch {
      setNote("Couldn't open the mic. Check the browser's mic permission for this site.");
      return null;
    } finally {
      setPhase("idle");
    }
  };

  const check = async () => {
    await unlockAudio();
    const s = await ensureMic();
    if (!s) return;
    setPhase("checking");
    setNote(null);
    const r = await measureLatency(audioContext(), undefined, s).catch(() => null);
    setPhase("idle");
    if (!r) {
      setNote("Couldn't hear the clicks. Turn the volume up and hold your headphones to the mic (or play through speakers), then try again.");
      return;
    }
    saveLatency(key, r.latencyMs);
    setLatency({ ms: r.latencyMs, measured: true });
    setNote(`Measured ${Math.round(r.latencyMs)} ms (${r.heard} of ${r.total} clicks heard). Takes will be moved earlier by that much.`);
  };

  const toggleRecord = async () => {
    if (take.current) {
      setPhase("saving");
      const t = take.current;
      take.current = null;
      await t.stop().catch((e) => setNote(`Saving the take failed: ${String(e)}. It's kept on this computer and will retry.`));
      setPhase("idle");
      return;
    }
    await unlockAudio();
    const s = await ensureMic();
    if (!s) return;
    const lat = latency ?? { ms: estimateLatencyMs(audioContext(), s), measured: false };
    take.current = await startRecording({
      doc, roomId, userId: me.id, userName: me.name, stream: s, latencyMs: lat.ms, getToken: me.getToken, onUploadProgress,
      countInBars: useUi.getState().countInBars,
    });
    setPhase("recording");
  };

  // Someone pressed Stop on the transport: end the take too.
  useEffect(() => {
    if (!playState.playing && take.current && phase === "recording") void toggleRecord();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playState.playing]);

  const recording = phase === "recording";
  useEffect(() => useUi.getState().set({ recording }), [recording]);
  const { recordOpen, set: setUi } = useUi();
  const uploading = Object.values(uploads);

  return (
    <section
      aria-label="Record vocals"
      className="absolute top-2 left-2 z-40 flex w-[min(640px,calc(100%-16px))] flex-col gap-3 rounded-lg border border-white/15 bg-card p-4 shadow-2xl"
      data-testid="record-panel"
      hidden={!recordOpen}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Record vocals</h2>
        <span className="text-xs text-muted-foreground">Recorded on your computer at full quality, then sent up. The call is never the take.</span>
        <button aria-label="Close record panel" className="ml-auto size-6 rounded text-muted-foreground hover:bg-muted" onClick={() => setUi({ recordOpen: false })}>✕</button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select
          aria-label="Microphone"
          className="input h-8 max-w-56 text-xs"
          onChange={(e) => void ensureMic(e.target.value)}
          onFocus={() => { if (!stream) void ensureMic(); }}
          value={deviceId}
        >
          {inputs.length === 0 && <option value="">Choose a mic…</option>}
          {inputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>)}
        </select>

        <label className="flex items-center gap-2 text-xs">
          <input checked={headphones} data-testid="headphones" onChange={(e) => setHeadphones(e.target.checked)} type="checkbox" />
          I'm on headphones
        </label>

        <span className="text-xs text-muted-foreground" data-testid="latency">
          Latency: {latency ? `${Math.round(latency.ms)} ms ${latency.measured ? "(measured)" : "(estimate)"}` : "not checked"}
        </span>
        <button className="btn h-8 text-xs" disabled={phase !== "idle"} onClick={check}>
          {phase === "checking" ? "Listening…" : "Check latency"}
        </button>

        <button
          className={recording ? "btn h-9 border-rose-500 bg-rose-600 text-white hover:bg-rose-500" : "btn h-9 text-rose-400"}
          data-testid="record"
          disabled={!headphones || phase === "opening" || phase === "checking" || phase === "saving"}
          onClick={toggleRecord}
          title={headphones ? "" : "Put headphones on first, so the beat doesn't leak into your take"}
        >
          {recording ? "■ Stop recording" : phase === "saving" ? "Saving…" : "● Record"}
        </button>
      </div>

      {bluetooth && (
        <p className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          This looks like a Bluetooth device. Bluetooth adds a lot of delay that also drifts, so takes can land late. Use wired headphones and a wired mic if you can.
        </p>
      )}
      {latency && !latency.measured && stream && (
        <p className="text-xs text-muted-foreground">Run "Check latency" once on this setup so takes land exactly on the beat. It takes about 4 seconds.</p>
      )}
      {note && <p className="text-xs text-muted-foreground" data-testid="record-note">{note}</p>}
      {uploading.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="uploads">
          Sending {uploading.length} take{uploading.length > 1 ? "s" : ""} up: {Math.round(Math.min(...uploading) * 100)}%. You can keep working.
        </p>
      )}
    </section>
  );
}
