import type { GameState, AudienceVote } from './state';
import { initialGameState } from './state';
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

  /** Record (or overwrite) a single audience vote. Idempotent per uid+round. */
  recordVote(uid: string, vote: AudienceVote): number {
    this.state = { ...this.state, audienceVotes: { ...this.state.audienceVotes, [uid]: vote } };
    return ++this._version;
  }

  snapshot(): Snapshot {
    return { version: this._version, state: this.state };
  }

  restore(snap: Snapshot): void {
    this.state = snap.state;
    this._version = snap.version;
  }
}
