import type { GameState } from './state';

export type Role = 'operator' | 'display' | 'audience';

/**
 * Audience-safe projection of the game state. Crucially strips the answer keys
 * (`isLie` / `lieIndex`) that must never reach a voter's device, and omits
 * everyone's raw votes and voter scores. Statement *text* is preserved because
 * the audience needs it to vote. The audience client tracks its own vote
 * locally (from the vote ack), so no per-user vote data is broadcast.
 */
export interface AudienceGameState {
  phase: GameState['phase'];
  players: { id: number; name: string; photo: string; score: number }[];
  warmup: {
    statements: { statement: string }[];
    currentIndex: number;
    audienceVotingOpen: boolean;
    showResult: boolean;
  };
  segment1: {
    statements: { playerId: number; playerName: string; statement: string }[];
    currentStorytellerId: number | null;
    audienceVotingOpen: boolean;
    showResult: boolean;
    statementShown: boolean;
  };
  segment2: {
    statements: { playerId: number; playerName: string; statements: string[] }[];
    currentStorytellerId: number | null;
    audienceVotingOpen: boolean;
    showResult: boolean;
    revealedStatements: number[];
  };
  segment3: {
    audienceVotingOpen: boolean;
    showResult: boolean;
    winnerId: number | null;
  };
}

export function audienceView(gs: GameState): AudienceGameState {
  return {
    phase: gs.phase,
    players: gs.players.map((p) => ({ id: p.id, name: p.name, photo: p.photo, score: p.score })),
    warmup: {
      statements: gs.warmup.statements.map((s) => ({ statement: s.statement })),
      currentIndex: gs.warmup.currentIndex,
      audienceVotingOpen: gs.warmup.audienceVotingOpen,
      showResult: gs.warmup.showResult,
    },
    segment1: {
      statements: gs.segment1.statements.map((s) => ({
        playerId: s.playerId,
        playerName: s.playerName,
        statement: s.statement,
      })),
      currentStorytellerId: gs.segment1.currentStorytellerId,
      audienceVotingOpen: gs.segment1.audienceVotingOpen,
      showResult: gs.segment1.showResult,
      statementShown: gs.segment1.statementShown ?? false,
    },
    segment2: {
      statements: gs.segment2.statements.map((s) => ({
        playerId: s.playerId,
        playerName: s.playerName,
        statements: s.statements,
      })),
      currentStorytellerId: gs.segment2.currentStorytellerId,
      audienceVotingOpen: gs.segment2.audienceVotingOpen,
      showResult: gs.segment2.showResult,
      revealedStatements: gs.segment2.revealedStatements ?? [],
    },
    segment3: {
      audienceVotingOpen: gs.segment3.audienceVotingOpen,
      showResult: gs.segment3.showResult,
      winnerId: gs.segment3.winnerId,
    },
  };
}

/**
 * Operator and display are trusted with the full state (the display needs the
 * answers to show results on the big screen; the operator drives the show).
 */
export function fullView(gs: GameState): GameState {
  return gs;
}

export function viewFor(role: Role, gs: GameState): GameState | AudienceGameState {
  return role === 'audience' ? audienceView(gs) : fullView(gs);
}
