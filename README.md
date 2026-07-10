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

This is the version you run the show on. The **no-server backup** is the separate
`lie-hard/` repo (original direct-Firestore app) — see "Show-day fallback" below.

## Firebase project

`web/` targets a **dedicated Firebase project** (`lie-hard-live`) — separate from the
backup's `lie-hard` project. Create it in the console, enable Google + Email/Password
auth, then fill `web/.env.production` from `web/.env.example`.

## Deploy

**Backend (`server/`) → Railway**

- Root directory: `server`. Dockerfile build. Health check: `/healthz`.
- Env: `JWT_SECRET`, `OPERATOR_PASSWORD_HASH` (bcrypt), `FIREBASE_SERVICE_ACCOUNT_B64`
  (base64 of the `lie-hard-live` service-account JSON), `ALLOWED_ORIGINS` (the web
  hosting URL + `http://localhost:3000`), `REDIS_URL` (add a Railway Redis).

**Frontend (`web/`) → Firebase Hosting**

- `web/.env.production`: `lie-hard-live` `NEXT_PUBLIC_FIREBASE_*` + `NEXT_PUBLIC_WS_URL=wss://<railway-url>`
  - `NEXT_PUBLIC_WS_HTTP_URL=https://<railway-url>`.
- From `web/`: `npm run deploy:prod` (builds with `.env.production` and deploys hosting + Firestore rules).

## Local dev

- Backend: `cd server && cp .env.example .env` (set `OPERATOR_PASSWORD`), `npm install`, `npm run dev` (:8080). `npm run smoke` runs the 12 security checks.
- Frontend: `cd web`, add `.env.local` with Firebase config + `NEXT_PUBLIC_WS_URL=http://localhost:8080`, `npm install`, `npm run dev` (:3000). Open `/operator`, `/display`, `/audience`.

## Show-day fallback (if the server/Railway fails)

There are **two independent deployments** on **two Firebase projects + two URLs**:

|             | Repo                   | Firebase project | Needs server?         |
| ----------- | ---------------------- | ---------------- | --------------------- |
| **Primary** | `lie-hard-live` (this) | `lie-hard-live`  | Yes (Railway)         |
| **Backup**  | `lie-hard`             | `lie-hard`       | No (direct Firestore) |

If the server goes down mid-show: **open the backup URL** on the operator, display,
and audience devices. The operator re-runs setup (upload CSVs, set current scores —
data does not carry across projects) and continues; voting/reveal/scoring work
identically. **Before the show, dry-run the backup URL with the server stopped.**
