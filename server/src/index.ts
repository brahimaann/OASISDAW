import { Server } from "@hocuspocus/server";
import { SQLite } from "@hocuspocus/extension-sqlite";
import { verifyToken } from "@clerk/backend";

const port = Number(process.env.PORT ?? 1234);
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const dbFile = process.env.OASIS_DB ?? "data/oasis.sqlite";

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
  },
});

server.listen().then(() => {
  console.log(`[oasis] sync server on ws://localhost:${port} (db: ${dbFile})`);
});
