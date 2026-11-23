# Deploying OASIS at oasis.sanktuary.studio

OASIS runs as its own process next to the Sanktuary OS site. One Node process
serves the app, the sync WebSocket (`/sync`) and the clock (`/time`) on one port.
The Cloudflare Tunnel gets one more hostname that points at it.

```
browser ──https/wss──> Cloudflare ──tunnel──> 127.0.0.1:3090  (OASIS)
                                      └─────> 127.0.0.1:3080  (Sanktuary OS, unchanged)
```

## 1. Get the code and keys on the home server

```
git clone https://github.com/brahimaann/OASISDAW.git ~/oasis
cd ~/oasis
npm install
```

Create `server/.env` (never commit it):

```
PORT=3090
HOST=127.0.0.1
CLERK_SECRET_KEY=sk_live_...        # same Clerk instance as Sanktuary OS
OASIS_DB=/path/on/the/big/drive/oasis/oasis.sqlite
OASIS_FILES=/path/on/the/big/drive/oasis/files   # takes and samples, by SHA-256
```

Create `app/.env.local` (never commit it):

```
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
```

Use the same Clerk production instance as sanktuary.studio. Clerk sessions work
across subdomains of the same root domain, so people who are signed in to the
site are signed in to OASIS too.

## 2. Start it

```
npm start        # builds the app, then runs the server with NODE_ENV=production
```

Check it: `curl -I http://127.0.0.1:3090/` should answer `200` with
`Cross-Origin-Opener-Policy: same-origin`. Without `CLERK_SECRET_KEY` the server
refuses to start in production, so a room can't end up open to everyone.

Keep it running the same way you keep Sanktuary OS running (pm2, systemd or a
Docker service). With pm2, for example: `pm2 start npm --name oasis -- start`.

## 3. Add the tunnel route

Point `oasis.sanktuary.studio` at port 3090, written **the same way your existing
route writes 3080** (for example `http://localhost:3090`, or
`http://host.docker.internal:3090` if cloudflared runs in Docker without host networking).

- **Tunnel managed in the Cloudflare dashboard:** Zero Trust → Networks → Tunnels →
  your tunnel → Public Hostname → Add. Subdomain `oasis`, domain `sanktuary.studio`,
  service `HTTP` + the address above. Cloudflare creates the DNS record.
- **Tunnel managed by a `config.yml`:** add this above the catch-all rule, then
  restart cloudflared, and run `cloudflared tunnel route dns <tunnel> oasis.sanktuary.studio`.

  ```yaml
  ingress:
    - hostname: oasis.sanktuary.studio
      service: http://localhost:3090
    - hostname: sanktuary.studio
      service: http://localhost:3080
    - service: http_status:404
  ```

WebSockets go through the tunnel with no extra settings.

## 4. Smoke test

Open `https://oasis.sanktuary.studio` in two browsers (or one normal and one
private window), sign in, open the same room link, press Play in one. Both
should play and stop together, and chat should show in both.

## Notes

- The SQLite file holds every room, and `OASIS_FILES` holds every take. Put both on a drive that gets backed up.
- Uploads go in 8 MB chunks (tus), under Cloudflare's per-request cap, and resume after a dropped connection.
- If `HOST=127.0.0.1` and cloudflared runs in a Docker container without host
  networking, the container can't reach it. Use `HOST=0.0.0.0` only if your
  firewall blocks port 3090 from outside.
