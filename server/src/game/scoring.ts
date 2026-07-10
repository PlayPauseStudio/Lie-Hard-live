import type { GameState, VoterScore } from './state';
import { SEG1_POINTS, SEG2_POINTS } from './state';

/**
 * Recompute the voterScores map after a round is revealed. Every audience vote
 * for `votingRound` whose choice equals `correctChoice` earns +1 correctCount.
 * Ported from operator/page.tsx awardVoterScores(), but returns a full new map
 * (the server owns it) instead of dot-path updates.
 */
export function awardVoterScores(
  gs: GameState,
  votingRound: string,
  correctChoice: string,
): { [uid: string]: VoterScore } {
  const next: { [uid: string]: VoterScore } = { ...gs.voterScores };
  for (const [uid, v] of Object.entries(gs.audienceVotes)) {
    if (v.votingRound === votingRound && v.choice === correctChoice) {
      next[uid] = {
        name: v.displayName ?? uid,
        correctCount: (gs.voterScores[uid]?.correctCount ?? 0) + 1,
      };
    }
  }
  return next;
}

export interface SegmentAward {
  totals: Record<number, number>;
  deltas: { name: string; delta: number }[];
}

/**
 * Compute Segment 1 / Segment 2 point awards from the operator-logged player
 * votes. Mirrors calcSeg1Points/calcSeg2Points + awardSegXPoints in the client,
 * but as one authoritative pure computation.
 *
 * Rule: each non-storyteller who voted the correct answer earns `points`;
 * each who voted wrong hands `points` to the storyteller.
 */
export function computeSegmentAward(gs: GameState, segNum: 1 | 2): SegmentAward {
  const players = gs.players;
  const totals: Record<number, number> = Object.fromEntries(players.map((p) => [p.id, 0]));

  const seg = segNum === 1 ? gs.segment1 : gs.segment2;
  const storytellerId = seg.currentStorytellerId;
  if (storytellerId == null) return { totals, deltas: [] };

  const points = segNum === 1 ? SEG1_POINTS : SEG2_POINTS;

  let correctAnswer: string;
  if (segNum === 1) {
    const stmt = gs.segment1.statements.find((s) => s.playerId === storytellerId);
    if (!stmt) return { totals, deltas: [] };
    correctAnswer = stmt.isLie ? 'LIE' : 'TRUTH';
  } else {
    const stmt = gs.segment2.statements.find((s) => s.playerId === storytellerId);
    if (!stmt) return { totals, deltas: [] };
    correctAnswer = `STATEMENT_${stmt.lieIndex}`;
  }

  for (const player of players) {
    if (player.id === storytellerId) continue;
    const vote = seg.playerVotes[player.id];
    if (vote === correctAnswer) {
      totals[player.id] += points;
    } else if (vote) {
      totals[storytellerId] += points;
    }
  }

  const deltas = players
    .filter((p) => totals[p.id] > 0)
    .map((p) => ({ name: p.name, delta: totals[p.id] }));

  return { totals, deltas };
}
