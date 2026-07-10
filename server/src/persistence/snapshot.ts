import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../util/logger';
import type { Snapshot } from '../game/store';

const KEY = 'lie-hard:snapshot';

/**
 * Crash-recovery snapshot store. When REDIS_URL is set, the full game state is
 * periodically saved to Redis and restored on boot, so restarting the Railway
 * service mid-show does not lose scores/votes. Without REDIS_URL it degrades to
 * a no-op (in-memory only).
 */
export class SnapshotStore {
  private redis: Redis | null = null;

  constructor() {
    if (env.REDIS_URL) {
      this.redis = new Redis(env.REDIS_URL, {
        lazyConnect: false,
        maxRetriesPerRequest: 2,
      });
      this.redis.on('error', (e) => logger.warn({ err: e.message }, 'Redis error'));
      logger.info('Snapshot store: Redis');
    } else {
      logger.warn('Snapshot store: disabled (no REDIS_URL) — state is in-memory only.');
    }
  }

  get enabled(): boolean {
    return this.redis !== null;
  }

  async save(snap: Snapshot): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(KEY, JSON.stringify(snap));
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : e }, 'Snapshot save failed');
    }
  }

  async load(): Promise<Snapshot | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(KEY);
      if (!raw) return null;
      const snap = JSON.parse(raw) as Snapshot;
      logger.info({ version: snap.version }, 'Restored snapshot from Redis');
      return snap;
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : e }, 'Snapshot load failed');
      return null;
    }
  }

  async close(): Promise<void> {
    if (this.redis) await this.redis.quit();
  }
}
