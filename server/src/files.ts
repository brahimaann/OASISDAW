/**
 * Audio files: resumable uploads (tus) into a content-addressed pool.
 *
 * - POST/PATCH/HEAD /uploads/...  tus protocol, chunked, resumable after a drop.
 * - GET/HEAD /files/<sha256>      the finished file, cached forever (it can't change).
 *
 * The client sends the file's SHA-256 as tus metadata. When the upload
 * finishes, the server checks the hash and moves the file into the pool as
 * <hash>.wav. A file that's already in the pool is never uploaded twice.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { FileStore } from "@tus/file-store";
import { Server as TusServer } from "@tus/server";

const HASH = /^[0-9a-f]{64}$/;
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB, about 90 minutes of 48 kHz float mono

export interface FilesOptions {
  dir: string;
  /** Throws if the request isn't allowed to upload. */
  authorize: (authorization: string | null) => Promise<void>;
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

export async function createFiles({ dir, authorize }: FilesOptions) {
  const incoming = path.join(dir, "incoming");
  const pool = path.join(dir, "pool");
  await mkdir(incoming, { recursive: true });
  await mkdir(pool, { recursive: true });

  const poolPath = (hash: string) => path.join(pool, `${hash}.wav`);
  const exists = async (p: string) => !!(await stat(p).catch(() => null))?.isFile();

  const tus = new TusServer({
    path: "/uploads",
    datastore: new FileStore({ directory: incoming }),
    maxSize: MAX_BYTES,
    relativeLocation: true,
    respectForwardedHeaders: true,
    async onIncomingRequest(req) {
      try {
        await authorize(req.headers.get("authorization"));
      } catch {
        throw { status_code: 401, body: "Unauthorized\n" };
      }
    },
    async onUploadCreate(_req, upload) {
      const hash = upload.metadata?.hash ?? "";
      if (!HASH.test(hash)) throw { status_code: 400, body: "Missing or bad hash\n" };
      return {};
    },
    async onUploadFinish(_req, upload) {
      const hash = upload.metadata?.hash ?? "";
      const file = path.join(incoming, upload.id);
      const actual = await sha256(file);
      if (actual !== hash) {
        await rm(file, { force: true });
        await rm(`${file}.json`, { force: true });
        throw { status_code: 422, body: "Hash mismatch\n" };
      }
      if (await exists(poolPath(hash))) await rm(file, { force: true });
      else await rename(file, poolPath(hash));
      await rm(`${file}.json`, { force: true });
      return {};
    },
  });

  /** Returns true if it answered the request. */
  return async function handleFiles(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url ?? "";
    if (url.startsWith("/uploads")) {
      await tus.handle(req, res);
      return true;
    }
    const m = /^\/files\/([0-9a-f]{64})(?:\.wav)?(?:\?.*)?$/.exec(url);
    if (!m || (req.method !== "GET" && req.method !== "HEAD")) return false;
    const file = poolPath(m[1]);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found\n");
      return true;
    }
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Content-Length": info.size,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
    return true;
  };
}
