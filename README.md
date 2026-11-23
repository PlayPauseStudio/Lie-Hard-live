# Lie Hard — Live (server-backed) edition

The **primary**, server-backed version of the Lie Hard game show. This repo holds
both halves of the system:

```
web/     Next.js frontend (operator / display / audience) — static export → Firebase Hosting
server/  Express + Socket.IO backend — the authority for game state → Railway
```

- `web/` connects to `server/` over WebSocket (`wss://…`) and uses Firebase **Auth**
  only (audience sign-in). Game state lives on the server, not in Firestore.
- Full backend docs: [`server/README.md`](server/README.md).

This is the only version you run the show on. The old no-server backup (`lie-hard/`)
is retired: nothing here connects to it any more.

## Firebase project

`web/` targets a **dedicated Firebase project** (`lie-hard-live`). Create it in the console, enable Google + Email/Password
auth, then fill `web/.env.production` from `web/.env.example`.

## Deploy

**Backend (`server/`) → Railway**

- Root directory: `server`. Dockerfile build. Health check: `/healthz`.
- Env: `JWT_SECRET`, `OPERATOR_PASSWORD_HASH` (bcrypt), `FIREBASE_SERVICE_ACCOUNT_B64`
  (base64 of the `lie-hard-live` service-account JSON), `ALLOWED_ORIGINS` (the web
  hosting URL + `http://localhost:3000`), `REDIS_URL` (add a Railway Redis).

**Frontend (`web/`) → Firebase Hosting**

- `web/.env.production`: `lie-hard-live` `NEXT_PUBLIC_FIREBASE_*` + `NEXT_PUBLIC_WS_URL=wss://lie-hard-api.playpause.studio`
  - `NEXT_PUBLIC_WS_HTTP_URL=https://lie-hard-api.playpause.studio`. That domain is a Cloudflare-proxied
  CNAME to the Railway server (Jio blocks `*.up.railway.app`).
- From `web/`: `npm run deploy:prod` (builds with `.env.production` and deploys hosting + Firestore rules).

## Local dev

- Backend: `cd server && cp .env.example .env` (set `OPERATOR_PASSWORD`), `npm install`, `npm run dev` (:8080). `npm run smoke` runs the 12 security checks.
- Frontend: `cd web`, add `.env.local` with Firebase config + `NEXT_PUBLIC_WS_URL=http://localhost:8080`, `npm install`, `npm run dev` (:3000). Open `/operator`, `/display`, `/audience`.

## Show-day health

The operator panel's header has a **status strip** (polls `op:status` every 2 s): server
link + round-trip time, big screen connected, phones online / voted, votes in the open
round, server load (worst event-loop stall in the last 10 s) and the Redis backup.
If the server restarts, Redis restores the game; refresh open pages if they don't
reconnect on their own.
