import { Router } from 'express';

/** Liveness endpoint for Railway health checks. */
export function healthRouter(getVersion: () => number): Router {
  const router = Router();
  router.get('/healthz', (_req, res) => {
    res.json({ ok: true, version: getVersion(), uptime: process.uptime() });
  });
  return router;
}
