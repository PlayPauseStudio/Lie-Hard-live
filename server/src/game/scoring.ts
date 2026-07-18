import type { GameState, Player, VoterScore } from './state';
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

  // Operator-adjustable per-round value; falls back to the segment default.
  const points = seg.points ?? (segNum === 1 ? SEG1_POINTS : SEG2_POINTS);

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

/**
 * Per-player score delta to apply when a seg1/seg2 answer changes from
 * `oldChoice` to `newChoice`, given the player votes that were used to award the
 * round. Reverses the old award and reapplies the new one in a single pass:
 * a voter who was correct and is now wrong loses `points` (which shift to the
 * storyteller), and vice-versa. Returns 0s when the answer is unchanged.
 */
export function answerSwapDelta(
  players: Player[],
  storytellerId: number,
  votes: Record<number, string | null>,
  oldChoice: string,
  newChoice: string,
  points: number,
): Record<number, number> {
  const delta: Record<number, number> = Object.fromEntries(players.map((p) => [p.id, 0]));
  if (oldChoice === newChoice) return delta;
  for (const p of players) {
    if (p.id === storytellerId) continue;
    const vote = votes[p.id];
    if (!vote) continue;
    // Voter earned `points` iff they voted the correct answer.
    delta[p.id] += (vote === newChoice ? points : 0) - (vote === oldChoice ? points : 0);
    // Storyteller earned `points` for each voter who was wrong.
    delta[storytellerId] += (vote !== newChoice ? points : 0) - (vote !== oldChoice ? points : 0);
  }
  return delta;
}

/**
 * Re-tally the audience voterScores for one round when its correct answer
 * changes from `oldChoice` to `newChoice`: uids who voted the new answer gain a
 * correct, uids who voted the old answer lose one (never below zero). Audience
 * votes for a revealed round are frozen, so this is an exact reversal+reapply.
 */
export function voterScoreSwap(
  gs: GameState,
  votingRound: string,
  oldChoice: string,
  newChoice: string,
): { [uid: string]: VoterScore } {
  if (oldChoice === newChoice) return gs.voterScores;
  const next: { [uid: string]: VoterScore } = { ...gs.voterScores };
  for (const [uid, v] of Object.entries(gs.audienceVotes)) {
    if (v.votingRound !== votingRound) continue;
    const d = (v.choice === newChoice ? 1 : 0) - (v.choice === oldChoice ? 1 : 0);
    if (d === 0) continue;
    const cur = next[uid]?.correctCount ?? 0;
    next[uid] = { name: v.displayName ?? uid, correctCount: Math.max(0, cur + d) };
  }
  return next;
}
