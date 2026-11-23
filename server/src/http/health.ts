import { Router } from 'express';

/**
 * Liveness endpoint for Railway health checks. `snapshots` says whether a
 * restart right now would come back with the show (connected = Redis backup
 * working); `savedAgoS` is how long since the last save reached Redis.
 */
export function healthRouter(getVersion: () => number, getBackup: () => Record<string, unknown>): Router {
  const router = Router();
  router.get('/healthz', (_req, res) => {
    res.json({ ok: true, version: getVersion(), uptime: process.uptime(), ...getBackup() });
  });
  return router;
}
