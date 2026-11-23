/**
 * Serves the built app (app/dist) from the sync server, so production is one
 * process on one port: the page, /sync (WebSocket) and /time share an origin.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

/** Cross-origin isolation, for SharedArrayBuffer later. Same as the Vite dev server. */
export const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

async function fileAt(p: string) {
  try {
    const s = await stat(p);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

/** Returns true if it answered the request. */
export async function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const url = new URL(req.url ?? "/", "http://x");
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  const target = path.resolve(root, `.${rel}`);
  if (!target.startsWith(path.resolve(root))) return false; // no ../ escapes

  let file = target;
  let info = await fileAt(file);
  if (!info) {
    // Client-side routes like /room/abc get the app shell. Missing assets 404.
    if (path.extname(rel)) return false;
    file = path.join(root, "index.html");
    info = await fileAt(file);
    if (!info) return false;
  }

  const ext = path.extname(file);
  const hashed = rel.startsWith("/assets/");
  res.writeHead(200, {
    ...ISOLATION_HEADERS,
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Content-Length": info.size,
    "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
  return true;
}
