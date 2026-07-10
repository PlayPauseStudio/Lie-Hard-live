/**
 * Tiny in-memory token-bucket rate limiter keyed by an arbitrary string
 * (e.g. a Firebase uid). Enough to blunt vote spamming from a single client;
 * not a distributed limiter (one server instance per show).
 */
interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class TokenBucketLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {}

  /** Returns true if the action is allowed (and consumes a token). */
  take(key: string, cost = 1): boolean {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };
    const elapsedSec = (now - b.updatedAt) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsedSec * this.refillPerSec);
    b.updatedAt = now;
    if (b.tokens < cost) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= cost;
    this.buckets.set(key, b);
    return true;
  }

  /** Periodically drop idle buckets to bound memory. */
  sweep(maxIdleMs = 5 * 60_000): void {
    const now = Date.now();
    for (const [key, b] of this.buckets) {
      if (now - b.updatedAt > maxIdleMs) this.buckets.delete(key);
    }
  }
}
