/**
 * Keeps takes in IndexedDB while they're recorded and until they're
 * uploaded, so a refresh, crash or Wi-Fi drop never loses a take.
 */
export type LocalTakeState = "recording" | "recorded" | "uploaded";

export interface LocalTake {
  takeId: string;
  roomId: string;
  trackId: string;
  clipId: string;
  recordedBy: string;
  sampleRate: number;
  latencyMs: number;
  /** Where the first sample lands on the playlist, after the latency fix. Null until known. */
  startBeat: number | null;
  /** Beats per second when recorded (to turn samples into beats). */
  bpm: number;
  state: LocalTakeState;
  hash?: string;
  createdAt: number;
}

const DB = "oasis-takes";
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore("takes", { keyPath: "takeId" });
      d.createObjectStore("chunks"); // key: [takeId, index]
      d.createObjectStore("wavs"); // key: takeId
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export const putTake = (t: LocalTake) => run("takes", "readwrite", (s) => s.put(t));
export const getTake = (id: string) => run<LocalTake | undefined>("takes", "readonly", (s) => s.get(id));
export const listTakes = () => run<LocalTake[]>("takes", "readonly", (s) => s.getAll());

export async function updateTake(id: string, patch: Partial<LocalTake>) {
  const t = await getTake(id);
  if (t) await putTake({ ...t, ...patch });
}

export const putChunk = (id: string, index: number, samples: Float32Array) =>
  run("chunks", "readwrite", (s) => s.put(samples, [id, index]));

export async function getChunks(id: string): Promise<Float32Array[]> {
  const range = IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
  return run<Float32Array[]>("chunks", "readonly", (s) => s.getAll(range));
}

export const putWav = (id: string, wav: Blob) => run("wavs", "readwrite", (s) => s.put(wav, id));
export const getWav = (id: string) => run<Blob | undefined>("wavs", "readonly", (s) => s.get(id));

/** Frees the space once the server has the take. Keeps the small record. */
export async function dropAudio(id: string) {
  await run("chunks", "readwrite", (s) => s.delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])));
  await run("wavs", "readwrite", (s) => s.delete(id));
}
