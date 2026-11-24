/**
 * Audience prizes — mirrors server/src/game/prizes.ts. The server ranks
 * everyone (correct answers, then least total time on them) and sends these
 * boards to the operator and the big screen.
 */

export type PrizeKey = "round1" | "round2" | "overall";
export const PRIZE_ORDER: PrizeKey[] = ["round1", "round2", "overall"];

/** Big-screen copy. */
export const PRIZE_TITLE: Record<PrizeKey, string> = {
  round1: "Round 1 Audience Winners",
  round2: "Round 2 Audience Winners",
  overall: "Top Audience Winners",
};

export const PRIZE_ROUNDS: Record<PrizeKey, string> = {
  round1: "Segment 1",
  round2: "Segment 2",
  overall: "Segments 1, 2 and 3 combined",
};

export interface PrizeSetting {
  skipEarlier: boolean;
  skipped: string[];
  confirmed: PrizeWinner[] | null;
}

export interface PrizeState {
  shown: PrizeKey | null;
  settings: Record<PrizeKey, PrizeSetting>;
}

export interface PrizeWinner {
  uid: string;
  name: string;
  correct: number;
}

export interface PrizeRow {
  uid: string;
  name: string;
  correct: number;
  totalMs: number;
  avgMs: number;
  speedPoints: number;
  rank: number | null;
  status: "ok" | "skipped" | "won-earlier";
  wonIn?: PrizeKey;
}

export interface RoundFastest {
  round: string;
  label: string;
  rows: { uid: string; name: string; ms: number }[];
}

export interface PrizeBoard {
  rounds: number;
  people: number;
  official: PrizeRow[];
  bySpeedPoints: PrizeRow[];
  byAverage: PrizeRow[];
  fastestPerRound: RoundFastest[];
  winners: PrizeWinner[];
  confirmed: boolean;
}

export type PrizeBoards = Record<PrizeKey, PrizeBoard>;

/** 1234 ms → "1.23s" (two decimals: close calls are often under 0.1s apart). */
export function secs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}
