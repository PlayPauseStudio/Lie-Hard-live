import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../util/logger';
import type { Snapshot } from '../game/store';

const KEY = 'lie-hard:snapshot';

/** How many times boot retries reading the snapshot before starting empty. */
const LOAD_ATTEMPTS = 6;
const LOAD_RETRY_MS = 2000;

export type SnapshotStatus = 'disabled' | 'connected' | 'connecting' | 'down';

/**
 * Crash-recovery snapshot store. When REDIS_URL is set, the full game state is
 * periodically saved to Redis and restored on boot, so restarting the Railway
 * service mid-show does not lose scores/votes. Without REDIS_URL it degrades to
 * a no-op (in-memory only).
 */
export class SnapshotStore {
  private redis: Redis | null = null;
  /** When the last snapshot reached Redis (ms), or null. */
  lastSavedAt: number | null = null;

  constructor() {
    if (env.REDIS_URL) {
      this.redis = new Redis(env.REDIS_URL, {
        lazyConnect: false,
        maxRetriesPerRequest: 2,
        // Railway's private network (redis.railway.internal) resolves over
        // IPv6; ioredis defaults to IPv4 only and would never connect, so every
        // redeploy would start blank. 0 lets it use either.
        family: 0,
      });
      this.redis.on('error', (e) => logger.warn({ err: e.message }, 'Redis error'));
      this.redis.on('ready', () => logger.info('Redis connected'));
      logger.info('Snapshot store: Redis');
    } else {
      logger.warn('Snapshot store: disabled (no REDIS_URL) — state is in-memory only.');
    }
  }

  get enabled(): boolean {
    return this.redis !== null;
  }

  /** Redis link health, for the operator's status strip. */
  get status(): SnapshotStatus {
    if (!this.redis) return 'disabled';
    if (this.redis.status === 'ready') return 'connected';
    if (this.redis.status === 'connecting' || this.redis.status === 'connect' || this.redis.status === 'reconnecting')
      return 'connecting';
    return 'down';
  }

  /** Save the show; false if it didn't reach Redis (the caller retries). */
  async save(snap: Snapshot): Promise<boolean> {
    if (!this.redis) return true;
    try {
      await this.redis.set(KEY, JSON.stringify(snap));
      this.lastSavedAt = Date.now();
      return true;
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : e }, 'Snapshot save failed');
      return false;
    }
  }

  /**
   * Read the saved show. A Redis that is merely slow to come up is retried: if
   * boot gave up and started empty, the next save would overwrite the real show
   * with a blank one. Only "nothing saved" returns null straight away.
   */
  async load(): Promise<Snapshot | null> {
    if (!this.redis) return null;
    for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt++) {
      try {
        const raw = await this.redis.get(KEY);
        if (!raw) {
          logger.info('No snapshot in Redis: starting a fresh show');
          return null;
        }
        const snap = JSON.parse(raw) as Snapshot;
        logger.info({ version: snap.version }, 'Restored snapshot from Redis');
        return snap;
      } catch (e) {
        logger.warn(
          { attempt, err: e instanceof Error ? e.message : e },
          attempt < LOAD_ATTEMPTS ? 'Snapshot load failed: retrying' : 'Snapshot load failed: starting empty',
        );
        if (attempt < LOAD_ATTEMPTS) await new Promise((r) => setTimeout(r, LOAD_RETRY_MS));
      }
    }
    return null;
  }

  async close(): Promise<void> {
    if (this.redis) await this.redis.quit();
  }
}
