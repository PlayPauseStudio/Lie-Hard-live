import type { GameState } from './state';

/**
 * Show history for the Excel export. None of it is sent to any screen (see
 * redact.fullView); it only leaves the server in the op:exportData ack.
 *
 * Everything is appended in place: the arrays/maps belong to the current
 * episode and a reset or soft refresh swaps in fresh ones.
 */

/** Every vote a phone cast, per round (audienceVotes only keeps the latest). */
export interface VoteHistoryEntry {
  name: string;
  votes: Record<string, { choice: string; ts: number }>;
}

/** One change to a contestant's score, with what caused it. */
export interface ScoreLogEntry {
  ts: number;
  event: string;
  phase: string;
  player: string;
  delta: number;
  score: number;
}

/** A Segment 1/2/3 round as it was awarded: answer, contestant votes, points. */
export interface RoundLogEntry {
  ts: number;
  segment: 'Segment 1' | 'Segment 2' | 'Segment 3' | 'Imposter';
  storyteller: string;
  statement: string;
  answer: string;
  points: number;
  /** Contestant name -> what they voted (Segments 1/2) or claim text (Segment 3). */
  votes: Record<string, string>;
}

/** Operator events, in words, for the score log. */
const EVENT_TEXT: Record<string, string> = {
  'op:awardSegment': 'Round awarded',
  'op:awardSegment3': 'Segment 3 winner awarded',
  'op:adjustScore': 'Manual score change',
  'op:editSeg1': 'Segment 1 answer edited (re-scored)',
  'op:editSeg2': 'Segment 2 answer edited (re-scored)',
  'op:awardImposter': 'Imposter round awarded',
  'op:imposterSet': 'Imposter changed (re-scored)',
  'op:imposterPick': 'Imposter pick changed (re-scored)',
};

export function recordVoteHistory(gs: GameState, uid: string, round: string, choice: string, name: string | undefined, ts: number): void {
  const h = (gs.voteHistory[uid] ??= { name: name ?? '', votes: {} });
  if (name && !h.name) h.name = name;
  h.votes[round] = { choice, ts };
}

/** Log every contestant whose score moved between two states. */
export function logScoreChanges(before: GameState, after: GameState, event: string): void {
  const prev = new Map(before.players.map((p) => [p.id, p.score]));
  const ts = Date.now();
  for (const p of after.players) {
    const old = prev.get(p.id);
    if (old === undefined || old === p.score) continue;
    after.scoreLog.push({
      ts,
      event: EVENT_TEXT[event] ?? event,
      phase: after.phase,
      player: p.name,
      delta: p.score - old,
      score: p.score,
    });
  }
}

const choiceText = (c: string | null | undefined): string => {
  if (!c) return '';
  const m = /^STATEMENT_(\d+)$/.exec(c);
  return m ? `Statement ${Number(m[1]) + 1}` : c;
};

/** Snapshot a Segment 1/2 round at the moment it is awarded. */
export function logSegmentRound(gs: GameState, segment: 'segment1' | 'segment2'): void {
  const seg = gs[segment];
  const id = seg.currentStorytellerId;
  if (id == null) return;
  const name = (pid: number) => gs.players.find((p) => p.id === pid)?.name ?? `Player ${pid}`;
  const votes: Record<string, string> = {};
  for (const p of gs.players) if (p.id !== id) votes[p.name] = choiceText(seg.playerVotes[p.id]) || '(no vote)';
  let statement = '';
  let answer = '';
  if (segment === 'segment1') {
    const s = gs.segment1.statements.find((x) => x.playerId === id);
    statement = s?.statement ?? '';
    answer = s ? (s.isLie ? 'LIE' : 'TRUTH') : '';
  } else {
    const s = gs.segment2.statements.find((x) => x.playerId === id);
    statement = s ? s.statements.map((t, i) => `${i + 1}. ${t}`).join('  ') : '';
    answer = s ? `Statement ${s.lieIndex + 1} is the lie` : '';
  }
  gs.roundLog.push({
    ts: Date.now(),
    segment: segment === 'segment1' ? 'Segment 1' : 'Segment 2',
    storyteller: name(id),
    statement,
    answer,
    points: seg.points,
    votes,
  });
}

/** Snapshot Segment 3 when the winner is awarded. */
export function logSegment3Round(gs: GameState, winnerId: number): void {
  const s3 = gs.segment3;
  const votes: Record<string, string> = {};
  for (const p of gs.players) votes[p.name] = s3.playerStatements?.[p.id] ?? '';
  gs.roundLog.push({
    ts: Date.now(),
    segment: 'Segment 3',
    storyteller: gs.players.find((p) => p.id === winnerId)?.name ?? `Player ${winnerId}`,
    statement: s3.photoTitle ?? '',
    answer: `Winner: ${gs.players.find((p) => p.id === winnerId)?.name ?? winnerId}`,
    points: s3.points,
    votes,
  });
}

/** Snapshot the Imposter round when the panel's points are awarded. */
export function logImposterRound(gs: GameState): void {
  const im = gs.imposter;
  const name = (id: number | null | undefined) =>
    id == null ? '' : (im.contestants.find((c) => c.id === id)?.name ?? `Person ${id}`);
  const votes: Record<string, string> = {};
  for (const p of gs.players) votes[p.name] = name(im.playerVotes[p.id]) || '(no vote)';
  gs.roundLog.push({
    ts: Date.now(),
    segment: 'Imposter',
    storyteller: name(im.imposterId),
    statement: `${im.title}: ${im.contestants.map((c) => c.name).join(', ')}`,
    answer: `Imposter: ${name(im.imposterId)}`,
    points: im.points,
    votes,
  });
}
