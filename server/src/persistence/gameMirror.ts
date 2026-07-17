import { getFirestore } from '../auth/firebaseAdmin';
import { logger } from '../util/logger';
import type { GameState } from '../game/state';

/**
 * Mirrors the authoritative in-memory game state to Firestore `gameState/live`
 * (via the Admin SDK) so the no-server BACKUP app can resume the exact
 * scores/rounds if the crew switches to it mid-show.
 *
 * Writes are throttled/coalesced (at most one per window) and fire-and-forget:
 * a slow or failing Firestore can never block or slow the live game. Disabled
 * automatically when Firebase Admin isn't configured (local dev).
 *
 * NOTE: this exposes the full state (including answers) in Firestore under the
 * shared project's open gameState rules — an accepted trade for full carryover.
 * Firestore documents cap at ~1 MB; oversized player photos will make the write
 * fail (logged, non-fatal) — the live show is unaffected.
 */
export class GameMirror {
  private pending: GameState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing = false;
  private paused = false;

  constructor(private readonly throttleMs = 1000) {}

  get enabled(): boolean {
    return getFirestore() !== null;
  }

  /**
   * Pause/resume mirroring. While paused, this server stops overwriting
   * gameState/live so the no-server BACKUP operator can take over as the
   * authority (failover). Driven by the control/mode.backupMode flag.
   */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.pending = null;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    }
    logger.info({ paused }, paused ? 'Game mirror paused (backup mode)' : 'Game mirror resumed (server in control)');
  }

  /** Queue a mirror write; bursts coalesce to one write per throttle window. */
  write(state: GameState): void {
    if (!this.enabled || this.paused) return;
    this.pending = state;
    this.schedule();
  }

  private schedule(): void {
    if (this.timer || this.writing || !this.pending) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.throttleMs);
    this.timer.unref?.();
  }

  /** Write the latest pending state now (also used on graceful shutdown). */
  async flush(): Promise<void> {
    const fs = getFirestore();
    if (!fs || this.writing || !this.pending || this.paused) return;
    const state = this.pending;
    this.pending = null;
    this.writing = true;
    try {
      await fs.collection('gameState').doc('live').set(state as unknown as Record<string, unknown>);
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : e }, 'Game mirror write failed');
    } finally {
      this.writing = false;
      this.schedule(); // if new state arrived while writing, write again
    }
  }
}
