/**
 * Authoritative game state — ported from lie-hard/src/app/operator/page.tsx
 * (interface GameState + initialGameState). The server is the single owner
 * of this shape; clients receive redacted projections of it.
 */

export interface Player {
  id: number;
  name: string;
  score: number;
  photo: string;
}

export interface WarmupStatement {
  statement: string;
  isLie: boolean;
}

export interface Segment1Statement {
  playerId: number;
  playerName: string;
  statement: string;
  isLie: boolean;
}

export interface Segment2Statement {
  playerId: number;
  playerName: string;
  statements: string[];
  lieIndex: number; // 0-based index of the lie statement
}

export type Phase = 'SETUP' | 'WARMUP' | 'SEGMENT1' | 'SEGMENT2' | 'SEGMENT3' | 'FINAL';

export interface AudienceVote {
  choice: string;
  votingRound: string;
  displayName?: string;
  ts: number; // server timestamp (epoch ms)
}

export interface VoterScore {
  name: string;
  correctCount: number;
}

export interface BanterTimer {
  totalSeconds: number;
  startedAt: number | null; // epoch ms — null when not running
  running: boolean;
}

export interface GameState {
  phase: Phase;
  players: Player[];
  showScoreboard: boolean;
  showLeaderboardModal: boolean;
  showTopVoters: boolean;
  showScorePopup: boolean;
  showVoteBars: boolean;
  showLogo: boolean;
  scorePopupDeltas: { name: string; delta: number }[];
  banterTimer: BanterTimer;
  warmup: {
    statements: WarmupStatement[];
    currentIndex: number;
    audienceVotingOpen: boolean;
    showResult: boolean;
  };
  segment1: {
    statements: Segment1Statement[];
    currentStorytellerId: number | null;
    playerVotes: { [playerId: number]: 'TRUTH' | 'LIE' | null };
    audienceVotingOpen: boolean;
    showResult: boolean;
    completedStorytellers: number[];
    // Operator toggles whether the statement text is on the display during voting.
    statementShown: boolean;
    // Points this round is played for (operator-adjustable; resets to default per storyteller).
    points: number;
  };
  segment2: {
    statements: Segment2Statement[];
    currentStorytellerId: number | null;
    playerVotes: { [playerId: number]: string | null };
    audienceVotingOpen: boolean;
    showResult: boolean;
    completedStorytellers: number[];
    revealedStatements: number[];
    // Points this round is played for (operator-adjustable; resets to default per storyteller).
    points: number;
  };
  segment3: {
    photoUrl: string | null;
    photoTitle: string | null;
    audienceVotingOpen: boolean;
    showResult: boolean;
    winnerId: number | null;
    // Operator-written live summary of each player's claim, keyed by player id.
    playerStatements: { [playerId: number]: string };
    // Player ids whose statement the operator has revealed on the display.
    shownStatements: number[];
    // Points the winner is awarded (operator-adjustable).
    points: number;
  };
  audienceVotes: { [uid: string]: AudienceVote };
  voterScores: { [uid: string]: VoterScore };
}

/** Points awarded to the Segment 3 winner (single source of truth). */
export const SEG3_POINTS = 50;
/** Points per correct/incorrect vote in Segments 1 and 2. */
export const SEG1_POINTS = 10;
export const SEG2_POINTS = 20;

export function initialGameState(): GameState {
  return {
    phase: 'SETUP',
    players: [
      { id: 1, name: 'Player 1', score: 0, photo: '/player1.png' },
      { id: 2, name: 'Player 2', score: 0, photo: '/player2.png' },
      { id: 3, name: 'Player 3', score: 0, photo: '/player3.png' },
    ],
    showScoreboard: true,
    showLeaderboardModal: false,
    showTopVoters: false,
    showScorePopup: false,
    // Vote bars default OFF each round; the operator turns them on when wanted.
    showVoteBars: false,
    showLogo: false,
    scorePopupDeltas: [],
    banterTimer: { totalSeconds: 60, startedAt: null, running: false },
    warmup: { statements: [], currentIndex: 0, audienceVotingOpen: false, showResult: false },
    segment1: {
      statements: [],
      currentStorytellerId: null,
      playerVotes: { 1: null, 2: null, 3: null },
      audienceVotingOpen: false,
      showResult: false,
      completedStorytellers: [],
      statementShown: false,
      points: SEG1_POINTS,
    },
    segment2: {
      statements: [],
      currentStorytellerId: null,
      playerVotes: { 1: null, 2: null, 3: null },
      audienceVotingOpen: false,
      showResult: false,
      completedStorytellers: [],
      revealedStatements: [],
      points: SEG2_POINTS,
    },
    segment3: { photoUrl: null, photoTitle: null, audienceVotingOpen: false, showResult: false, winnerId: null, playerStatements: {}, shownStatements: [], points: SEG3_POINTS },
    audienceVotes: {},
    voterScores: {},
  };
}
