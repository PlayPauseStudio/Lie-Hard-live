import type { RoomStore } from '../game/store';
import type { Patch } from '../game/reducers';
import type { AudienceVote, GameState } from '../game/state';
import { audienceView } from '../game/redact';
import { SRV } from '../protocol/events';
import { type AppServer, type AppSocket, ROOM_FULL, ROOM_AUDIENCE } from './types';

/**
 * Owns all server→client emission and role-based redaction.
 *
 * - Operator + display (ROOM_FULL) receive full-fidelity state (they need the
 *   answers to render results) via `state:patch` deltas. Player photos only
 *   change at Start Show (a `state:full`), so patches leave them out and the
 *   client keeps the ones it has.
 * - Audience (ROOM_AUDIENCE) receive a redacted `audienceView` as `state:full`,
 *   but only when it actually changed — timer ticks, score edits and display
 *   toggles don't touch it, and with hundreds of phones each skipped send counts.
 * - Audience votes are NOT broadcast to audience; new votes are streamed to
 *   ROOM_FULL as a throttled `votes:delta` (only the uids that voted since the
 *   last flush, not the whole map).
 */
export class Broadcaster {
  private pendingVotes = new Set<string>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private lastAudienceJson = '';

  constructor(
    private readonly io: AppServer,
    private readonly store: RoomStore,
  ) {}

  /** Start the throttled vote flusher (operator/display bars). */
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
    // The patch carries the whole vote map; queued deltas are already in it.
    if (changed.audienceVotes) this.pendingVotes.clear();
    const slim: Partial<GameState> = changed.players
      ? { ...changed, players: changed.players.map(({ photo: _photo, ...p }) => p as GameState['players'][number]) }
      : changed;
    this.io.to(ROOM_FULL).emit(SRV.STATE_PATCH, { version, changed: slim });
    this.sendAudience(version, false);
  }

  /** Broadcast a full replacement (start show / reset) to everyone. */
  broadcastFull(): void {
    const version = this.store.version;
    const state = this.store.getState();
    this.pendingVotes.clear();
    this.io.to(ROOM_FULL).emit(SRV.STATE_FULL, { version, state });
    this.sendAudience(version, true);
  }

  /** Queue a recorded vote; the flusher sends it to ROOM_FULL. */
  markVote(uid: string): void {
    this.pendingVotes.add(uid);
  }

  /** Push the audience view to phones, skipping it when nothing they see changed. */
  private sendAudience(version: number, force: boolean): void {
    const view = audienceView(this.store.getState());
    const json = JSON.stringify(view);
    if (!force && json === this.lastAudienceJson) return;
    this.lastAudienceJson = json;
    this.io.to(ROOM_AUDIENCE).emit(SRV.STATE_FULL, { version, state: view });
  }

  private flushVotes(): void {
    if (this.pendingVotes.size === 0) return;
    const all = this.store.getState().audienceVotes;
    const votes: Record<string, AudienceVote> = {};
    for (const uid of this.pendingVotes) if (all[uid]) votes[uid] = all[uid];
    this.pendingVotes.clear();
    this.io.to(ROOM_FULL).emit(SRV.VOTES_DELTA, { version: this.store.version, votes });
  }
}
