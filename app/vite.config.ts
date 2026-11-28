import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Cross-origin isolation, so SharedArrayBuffer (audio worklet ring buffers) works later.
// "credentialless" instead of "require-corp" so Clerk's scripts and images still load.
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

const syncTarget = process.env.OASIS_SYNC_URL ?? "http://localhost:1234";

// The browser talks to one origin. /sync (WebSocket) and /time go to the Hocuspocus server.
const proxy = {
  "/sync": { target: syncTarget, ws: true, rewrite: (p: string) => p.replace(/^\/sync/, "") },
  "/time": { target: syncTarget },
  "/uploads": { target: syncTarget },
  "/files": { target: syncTarget },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: { headers: isolationHeaders, proxy },
  preview: { headers: isolationHeaders, proxy },
});
