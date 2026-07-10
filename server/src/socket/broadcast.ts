import type { RoomStore } from '../game/store';
import type { Patch } from '../game/reducers';
import { audienceView } from '../game/redact';
import { SRV } from '../protocol/events';
import { type AppServer, type AppSocket, ROOM_FULL, ROOM_AUDIENCE } from './types';

/**
 * Owns all server→client emission and role-based redaction.
 *
 * - Operator + display (ROOM_FULL) receive full-fidelity state (they need the
 *   answers to render results) via `state:patch` deltas.
 * - Audience (ROOM_AUDIENCE) receive a redacted `audienceView` as `state:full`
 *   after every operator mutation (mutations are infrequent, so full sends are
 *   cheap and avoid delta-merge bugs on phones).
 * - Audience votes are NOT broadcast to audience; the tally is streamed to
 *   ROOM_FULL as a throttled `state:patch { audienceVotes }`.
 */
export class Broadcaster {
  private votesDirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly io: AppServer,
    private readonly store: RoomStore,
  ) {}

  /** Start the throttled vote-tally flusher (operator/display bars). */
  start(intervalMs = 250): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flushVotes(), intervalMs);
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  /** Send the appropriate full state to a single freshly-connected socket. */
  sendFullTo(socket: AppSocket): void {
    const version = this.store.version;
    const state = this.store.getState();
    if (socket.data.role === 'audience') {
      socket.emit(SRV.STATE_FULL, { version, state: audienceView(state) });
    } else {
      socket.emit(SRV.STATE_FULL, { version, state });
    }
  }

  /** Broadcast changed slices after an operator mutation. */
  broadcastPatch(changed: Patch): void {
    const version = this.store.version;
    this.io.to(ROOM_FULL).emit(SRV.STATE_PATCH, { version, changed });
    this.io
      .to(ROOM_AUDIENCE)
      .emit(SRV.STATE_FULL, { version, state: audienceView(this.store.getState()) });
  }

  /** Broadcast a full replacement (start show / reset) to everyone. */
  broadcastFull(): void {
    const version = this.store.version;
    const state = this.store.getState();
    this.io.to(ROOM_FULL).emit(SRV.STATE_FULL, { version, state });
    this.io.to(ROOM_AUDIENCE).emit(SRV.STATE_FULL, { version, state: audienceView(state) });
  }

  /** Mark votes changed; the flusher emits an audienceVotes patch to ROOM_FULL. */
  markVotesDirty(): void {
    this.votesDirty = true;
  }

  private flushVotes(): void {
    if (!this.votesDirty) return;
    this.votesDirty = false;
    this.io.to(ROOM_FULL).emit(SRV.STATE_PATCH, {
      version: this.store.version,
      changed: { audienceVotes: this.store.getState().audienceVotes },
    });
  }
}
