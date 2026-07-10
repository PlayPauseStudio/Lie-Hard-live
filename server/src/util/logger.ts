import pino from 'pino';
import { isProd } from '../config/env';

// Plain JSON logging to stdout — no transport worker (keeps tsx + Docker simple).
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  base: undefined,
});
