# lie-hard-server

Authoritative WebSocket backend for the **Lie Hard** live game show. Replaces the
old "every client writes Firestore directly" model with a single server that owns
game state, enforces roles, and validates every message.

- **Express** — HTTP layer: operator login (`POST /auth/operator/login`) and `GET /healthz`.
- **Socket.IO** — realtime layer (rooms, reconnection, heartbeat), attached to the same HTTP server.
- **In-memory game state** with an optional Redis crash-recovery snapshot.
- **Firebase Admin** verifies audience ID tokens; a signed **JWT** authenticates the operator.

## Roles & authority

| Role | Auth | Can do |
|------|------|--------|
| operator | JWT from `/auth/operator/login` | emit every `op:*` control event |
| audience | Firebase ID token (verified server-side) | `aud:register`, `aud:vote` (own vote, only while a round is open) |
| display | none (read-only) | receive state |

The server derives the open voting round, dedupes votes per uid, timestamps them,
and computes all tallies and voter/player scores. Clients never send scores.
Audience payloads are redacted — statement answers (`isLie`/`lieIndex`) and other
users' votes never reach a phone.

## Local dev

```bash
cp .env.example .env         # defaults work without Firebase/Redis
npm install
npm run dev                  # http://localhost:8080
npm run smoke                # end-to-end security checks (server must be running)
```

Without `FIREBASE_SERVICE_ACCOUNT_B64`, audience "tokens" are treated as raw uids
(dev only). Without `REDIS_URL`, state is in-memory only. The operator password in
dev is `OPERATOR_PASSWORD` (`letmein`); in prod set `OPERATOR_PASSWORD_HASH` (bcrypt).

## Deploy (Railway)

Docker build is provided. Set env vars: `JWT_SECRET`, `OPERATOR_PASSWORD_HASH`,
`FIREBASE_SERVICE_ACCOUNT_B64` (base64 of the service-account JSON), `ALLOWED_ORIGINS`,
`REDIS_URL` (Railway Redis add-on), `SNAPSHOT_INTERVAL_MS`. Railway injects `PORT`.
Health check path: `/healthz`.

The static frontend (Firebase Hosting) connects via `NEXT_PUBLIC_WS_URL=wss://<railway-url>`
and `NEXT_PUBLIC_WS_HTTP_URL=https://<railway-url>`.

## Event protocol

See `src/protocol/events.ts`. Operator control events map 1:1 to the reducers in
`src/game/reducers.ts` (ported from the original operator page). Server→client:
`state:full` (on join / audience updates), `state:patch` (operator/display deltas).
