import { Server } from "@hocuspocus/server";
import { SQLite } from "@hocuspocus/extension-sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyToken } from "@clerk/backend";
import { serveStatic } from "./static.ts";

const port = Number(process.env.PORT ?? 1234);
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const dbFile = process.env.OASIS_DB ?? "data/oasis.sqlite";
// Built app to serve. Set OASIS_STATIC=off to serve only /sync and /time (dev uses Vite instead).
const staticDir =
  process.env.OASIS_STATIC === "off"
    ? null
    : path.resolve(process.env.OASIS_STATIC ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/dist"));

if (!clerkSecretKey && process.env.NODE_ENV === "production") {
  // Never run an open server on the real URL by accident.
  console.error("[oasis] CLERK_SECRET_KEY is required when NODE_ENV=production.");
  process.exit(1);
}
if (!clerkSecretKey) {
  console.warn(
    "[oasis] CLERK_SECRET_KEY is not set: running in DEV mode, anyone can join any room.",
  );
}

const server = new Server({
  name: "oasis-sync",
  port,
  // Only reachable through the tunnel / reverse proxy on this machine.
  address: process.env.HOST ?? "127.0.0.1",
  quiet: true,
  extensions: [new SQLite({ database: dbFile })],

  // Room names look like "room:<id>". Reject anything else.
  async onAuthenticate({ token, documentName }) {
    if (!/^room:[A-Za-z0-9_-]{1,64}$/.test(documentName)) {
      throw new Error("Bad room name");
    }
    if (!clerkSecretKey) return { userId: "dev", dev: true };
    const claims = await verifyToken(token, { secretKey: clerkSecretKey });
    return { userId: claims.sub };
  },

  // Tiny HTTP endpoint so browsers can estimate their clock offset to the server.
  async onRequest({ request, response }) {
    if (request.url?.startsWith("/time")) {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ now: Date.now() }));
      // An empty rejection stops Hocuspocus' default response.
      throw null;
    }
    if (staticDir && (await serveStatic(staticDir, request, response))) {
      throw null;
    }
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
    throw null;
  },
});

server.listen().then(() => {
  console.log(`[oasis] listening on http://localhost:${port} (db: ${dbFile}, app: ${staticDir ?? "not served"})`);
});
