import type { GameState } from './state';

/**
 * Derive the currently-open voting round from authoritative state.
 * Ported from lie-hard/src/app/audience/page.tsx getCurrentVotingRound().
 * Returns null when no round is open. The server — never the client — decides
 * which round a vote belongs to.
 */
export function getCurrentVotingRound(gs: GameState): string | null {
  if (gs.warmup.audienceVotingOpen) return `warmup-${gs.warmup.currentIndex}`;
  if (gs.segment1.audienceVotingOpen && gs.segment1.currentStorytellerId != null) {
    return `seg1-${gs.segment1.currentStorytellerId}`;
  }
  if (gs.segment2.audienceVotingOpen && gs.segment2.currentStorytellerId != null) {
    return `seg2-${gs.segment2.currentStorytellerId}`;
  }
  if (gs.segment3.audienceVotingOpen) return 'seg3';
  return null;
}

/**
 * Validate that `choice` is a legal option for the currently-open round.
 * Returns the reason string if invalid, or null if valid.
 */
export function validateChoice(gs: GameState, round: string, choice: string): string | null {
  if (round.startsWith('warmup-')) {
    return choice === 'TRUTH' || choice === 'LIE' ? null : 'invalid_choice';
  }
  if (round.startsWith('seg1-')) {
    return choice === 'TRUTH' || choice === 'LIE' ? null : 'invalid_choice';
  }
  if (round.startsWith('seg2-')) {
    const seg = gs.segment2;
    const stmt = seg.statements.find((s) => s.playerId === seg.currentStorytellerId);
    if (!stmt) return 'no_statement';
    // Audience may only vote once every statement has been revealed (matches UI gating).
    if ((seg.revealedStatements?.length ?? 0) < stmt.statements.length) return 'not_all_revealed';
    const m = /^STATEMENT_(\d+)$/.exec(choice);
    if (!m) return 'invalid_choice';
    const idx = Number(m[1]);
    return idx >= 0 && idx < stmt.statements.length ? null : 'invalid_choice';
  }
  if (round === 'seg3') {
    const id = Number(choice);
    return gs.players.some((p) => p.id === id) ? null : 'invalid_choice';
  }
  return 'unknown_round';
}

/** Tally votes for a given round across a fixed option set. */
export function tally(gs: GameState, round: string, options: string[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(options.map((o) => [o, 0]));
  for (const v of Object.values(gs.audienceVotes)) {
    if (v.votingRound === round && counts[v.choice] !== undefined) counts[v.choice]++;
  }
  return counts;
}
