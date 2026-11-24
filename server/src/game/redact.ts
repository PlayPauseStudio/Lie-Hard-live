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
  // No photos: the phones never show them, and they're tens of KB each.
  players: { id: number; name: string; score: number }[];
  // Operator-pushed link button (rides the socket so it's as reliable as votes).
  showAudienceLink: boolean;
  audienceLink: string;
  audienceLinkLabel: string;
  // Headings: the phones show the Round 3 and Imposter questions.
  screenText: GameState['screenText'];
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
  // No statements or panel picks, and the answer only after the reveal.
  imposter: {
    title: string;
    contestants: { id: number; name: string }[];
    audienceVotingOpen: boolean;
    showResult: boolean;
    imposterId: number | null;
  };
  // Phones signed in before this sign out (soft refresh / full reset).
  episodeStartedAt: number;
  // A segment was reset: phones forget their vote in it.
  votesResetAt: number;
}

export function audienceView(gs: GameState): AudienceGameState {
  return {
    phase: gs.phase,
    players: gs.players.map((p) => ({ id: p.id, name: p.name, score: p.score })),
    showAudienceLink: gs.showAudienceLink ?? false,
    audienceLink: gs.audienceLink ?? '',
    audienceLinkLabel: gs.audienceLinkLabel ?? '',
    screenText: gs.screenText,
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
    imposter: {
      title: gs.imposter.title,
      contestants: gs.imposter.contestants,
      audienceVotingOpen: gs.imposter.audienceVotingOpen,
      showResult: gs.imposter.showResult,
      imposterId: gs.imposter.showResult ? gs.imposter.imposterId : null,
    },
    episodeStartedAt: gs.episodeStartedAt ?? 0,
    votesResetAt: gs.votesResetAt ?? 0,
  };
}

/** Export-only history and the reset ledger, which no screen needs. */
export type FullView = Omit<GameState, 'voteHistory' | 'scoreLog' | 'roundLog' | 'segmentLedger'>;

/**
 * Operator and display are trusted with the full state (the display needs the
 * answers to show results on the big screen; the operator drives the show),
 * minus the export history and reset ledger, which only goes out in op:exportData.
 */
export function fullView(gs: GameState): FullView {
  const { voteHistory: _v, scoreLog: _s, roundLog: _r, segmentLedger: _l, ...rest } = gs;
  return rest;
}

export function viewFor(role: Role, gs: GameState): FullView | AudienceGameState {
  return role === 'audience' ? audienceView(gs) : fullView(gs);
}
