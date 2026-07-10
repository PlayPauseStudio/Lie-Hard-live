import express, { type Express } from 'express';
import cors from 'cors';
import { env } from './config/env';
import { logger } from './util/logger';
import { healthRouter } from './http/health';
import { operatorLoginRouter } from './http/operatorLogin';

/**
 * Build the Express app (HTTP layer). Socket.IO attaches to the same underlying
 * http.Server in index.ts; this only handles plain HTTP routes.
 */
export function buildApp(getVersion: () => number): Express {
  const app = express();

  app.set('trust proxy', 1); // behind Railway's proxy

  app.use(
    cors({
      origin(origin, callback) {
        // Allow same-origin / non-browser (no Origin header) and the allowlist.
        if (!origin || env.ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ''))) {
          return callback(null, true);
        }
        logger.warn({ origin }, 'Blocked HTTP origin');
        return callback(new Error('origin_not_allowed'));
      },
    }),
  );

  app.use(express.json({ limit: '1mb' }));

  app.use(healthRouter(getVersion));
  app.use(operatorLoginRouter());

  return app;
}
