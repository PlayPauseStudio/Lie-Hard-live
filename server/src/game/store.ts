import type { GameState, AudienceVote } from './state';
import { initialGameState, initialImposter } from './state';
import { recordVoteHistory } from './history';
import type { Patch } from './reducers';

export interface Snapshot {
  version: number;
  state: GameState;
}

/**
 * Authoritative in-memory store for a single show room. Holds the current
 * GameState plus a monotonic version counter used by clients to order patches
 * and detect gaps after a reconnect.
 */
export class RoomStore {
  private state: GameState;
  private _version = 0;

  constructor(
    public readonly roomId: string,
    initial?: GameState,
  ) {
    this.state = initial ?? initialGameState();
  }

  get version(): number {
    return this._version;
  }

  getState(): GameState {
    return this.state;
  }

  /** Shallow-merge changed top-level slices and bump the version. */
  applyPatch(patch: Patch): number {
    this.state = { ...this.state, ...patch };
    return ++this._version;
  }

  /** Full replacement (start show / reset) and bump the version. */
  replace(next: GameState): number {
    this.state = next;
    return ++this._version;
  }

  /**
   * Record (or overwrite) a single audience vote. Idempotent per uid+round.
   * Mutates the vote map in place: copying it per vote made a burst of N votes
   * cost O(N²). Nothing holds an older reference expecting it unchanged.
   */
  recordVote(uid: string, vote: AudienceVote): number {
    this.state.audienceVotes[uid] = vote;
    recordVoteHistory(this.state, uid, vote.votingRound, vote.choice, vote.displayName, vote.ts);
    return ++this._version;
  }

  snapshot(): Snapshot {
    return { version: this._version, state: this.state };
  }

  restore(snap: Snapshot): void {
    // Snapshots from before episodes existed: 0 signs nobody out.
    this.state = {
      ...snap.state,
      episodeStartedAt: snap.state.episodeStartedAt ?? 0,
      // Snapshots from before the export history existed.
      voteHistory: snap.state.voteHistory ?? {},
      scoreLog: snap.state.scoreLog ?? [],
      roundLog: snap.state.roundLog ?? [],
      // Snapshots from before the Imposter round existed.
      imposter: snap.state.imposter ?? initialImposter(),
    };
    this._version = snap.version;
  }
}
