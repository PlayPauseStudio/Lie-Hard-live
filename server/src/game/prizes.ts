import type { GameState } from './state';

/**
 * Audience prizes: Round 1 (Segment 1), Round 2 (Segment 2) and Top (Segments
 * 1–3 combined). Everyone is ranked by correct answers, then by the least total
 * time on those correct answers (time = from the round's voting first opening
 * to the person's final vote), then by whose last correct vote came in first.
 *
 * The boards are derived from the vote history after every operator action, so
 * edits, resets and late reveals are always reflected. They go to the operator
 * and big screen only; phones never see them.
 */

export type PrizeKey = 'round1' | 'round2' | 'overall';
/** Order prizes are given out in; "skip earlier winners" looks back along it. */
export const PRIZE_ORDER: PrizeKey[] = ['round1', 'round2', 'overall'];

export interface PrizeSetting {
  /** Pass over anyone in an earlier prize's top 3 (default: repeats allowed). */
  skipEarlier: boolean;
  /** People the operator passed over (not present, unreachable, …). */
  skipped: string[];
  /** Optional freeze of the top 3 (uids, in podium order). */
  confirmed: { uid: string; name: string; correct: number }[] | null;
}

export interface PrizeState {
  /** Which prize's podium is on the big screen (with showTopVoters). */
  shown: PrizeKey | null;
  settings: Record<PrizeKey, PrizeSetting>;
}

export interface PrizeRow {
  uid: string;
  name: string;
  correct: number;
  /** Total ms across correct answers. */
  totalMs: number;
  /** Average ms per correct answer. */
  avgMs: number;
  /** 500 per correct answer + up to 500 more for answering within 30 s. */
  speedPoints: number;
  /** Rank among eligible people on the official list; null if passed over. */
  rank: number | null;
  status: 'ok' | 'skipped' | 'won-earlier';
  /** For won-earlier: which prize. */
  wonIn?: PrizeKey;
}

export interface RoundFastest {
  round: string;
  label: string;
  rows: { uid: string; name: string; ms: number }[];
}

export interface PrizeBoard {
  /** Revealed rounds that count towards this prize. */
  rounds: number;
  /** Everyone with at least one correct answer. */
  people: number;
  /** Official order (big screen): top 10 eligible, plus anyone passed over among them. */
  official: PrizeRow[];
  bySpeedPoints: PrizeRow[];
  byAverage: PrizeRow[];
  fastestPerRound: RoundFastest[];
  /** The podium: confirmed top 3 if frozen, else the official top 3. */
  winners: { uid: string; name: string; correct: number }[];
  confirmed: boolean;
}

export type PrizeBoards = Record<PrizeKey, PrizeBoard>;

export const SPEED_WINDOW_MS = 30_000;
const TOP = 10;

export function initialPrizes(): PrizeState {
  const s = (): PrizeSetting => ({ skipEarlier: false, skipped: [], confirmed: null });
  return { shown: null, settings: { round1: s(), round2: s(), overall: s() } };
}

const PRIZE_SEGMENTS: Record<PrizeKey, string[]> = {
  round1: ['seg1-'],
  round2: ['seg2-'],
  overall: ['seg1-', 'seg2-', 'seg3'],
};

/** Every revealed Segment 1–3 round, with its correct answer and a label. */
export function scoredRounds(gs: GameState): { round: string; answer: string; label: string }[] {
  const out: { round: string; answer: string; label: string }[] = [];
  const name = (id: number) => gs.players.find((p) => p.id === id)?.name ?? `Player ${id}`;
  const s1 = gs.segment1;
  for (const st of s1.statements) {
    const done = s1.completedStorytellers.includes(st.playerId) || (s1.currentStorytellerId === st.playerId && s1.showResult);
    if (done) out.push({ round: `seg1-${st.playerId}`, answer: st.isLie ? 'LIE' : 'TRUTH', label: `Round 1 · ${name(st.playerId)}` });
  }
  const s2 = gs.segment2;
  for (const st of s2.statements) {
    const done = s2.completedStorytellers.includes(st.playerId) || (s2.currentStorytellerId === st.playerId && s2.showResult);
    if (done) out.push({ round: `seg2-${st.playerId}`, answer: `STATEMENT_${st.lieIndex}`, label: `Round 2 · ${name(st.playerId)}` });
  }
  const s3 = gs.segment3;
  if (s3.showResult && s3.winnerId != null) out.push({ round: 'seg3', answer: String(s3.winnerId), label: 'Round 3' });
  return out;
}

/** Response time for one vote: from the round's first opening to the final vote. */
function responseMs(gs: GameState, round: string, ts: number): number {
  const opened = gs.roundOpenedAt[round];
  return opened ? Math.max(0, ts - opened) : 0;
}

/** Points for one correct answer (the "speed points" view). */
export function speedPointsFor(ms: number): number {
  return 500 + Math.round(500 * Math.max(0, 1 - ms / SPEED_WINDOW_MS));
}

interface Stat {
  uid: string;
  name: string;
  correct: number;
  totalMs: number;
  speedPoints: number;
  lastCorrectTs: number;
}

/** Official order: most correct, then least total time, then earliest last correct vote. */
export function officialCompare(a: Stat, b: Stat): number {
  return (
    b.correct - a.correct ||
    a.totalMs - b.totalMs ||
    a.lastCorrectTs - b.lastCorrectTs ||
    (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)
  );
}

function voterName(gs: GameState, uid: string): string {
  return gs.voteHistory[uid]?.name || gs.voterScores[uid]?.name || gs.audienceVotes[uid]?.displayName || 'Audience member';
}

export function computePrizeBoards(gs: GameState): PrizeBoards {
  const all = scoredRounds(gs);
  const claimed = new Map<string, PrizeKey>();
  const boards = {} as PrizeBoards;

  for (const key of PRIZE_ORDER) {
    const setting = gs.prizes.settings[key];
    const rounds = all.filter((r) => PRIZE_SEGMENTS[key].some((p) => r.round.startsWith(p)));
    const stats: Stat[] = [];
    const fastest: RoundFastest[] = rounds.map((r) => ({ round: r.round, label: r.label, rows: [] }));

    for (const [uid, h] of Object.entries(gs.voteHistory)) {
      const st: Stat = { uid, name: voterName(gs, uid), correct: 0, totalMs: 0, speedPoints: 0, lastCorrectTs: 0 };
      rounds.forEach((r, i) => {
        const v = h.votes[r.round];
        if (!v || v.choice !== r.answer) return;
        const ms = responseMs(gs, r.round, v.ts);
        st.correct++;
        st.totalMs += ms;
        st.speedPoints += speedPointsFor(ms);
        st.lastCorrectTs = Math.max(st.lastCorrectTs, v.ts);
        fastest[i].rows.push({ uid, name: st.name, ms });
      });
      if (st.correct > 0) stats.push(st);
    }

    stats.sort(officialCompare);
    const skipped = new Set(setting.skipped);
    const toRow = (s: Stat, rank: number | null, status: PrizeRow['status'], wonIn?: PrizeKey): PrizeRow => ({
      uid: s.uid,
      name: s.name,
      correct: s.correct,
      totalMs: s.totalMs,
      avgMs: Math.round(s.totalMs / s.correct),
      speedPoints: s.speedPoints,
      rank,
      status,
      ...(wonIn ? { wonIn } : {}),
    });
    const statusOf = (uid: string): { status: PrizeRow['status']; wonIn?: PrizeKey } => {
      if (skipped.has(uid)) return { status: 'skipped' };
      const won = claimed.get(uid);
      if (setting.skipEarlier && won) return { status: 'won-earlier', wonIn: won };
      return { status: 'ok' };
    };

    const official: PrizeRow[] = [];
    let rank = 0;
    for (const s of stats) {
      if (rank >= TOP) break;
      const { status, wonIn } = statusOf(s.uid);
      official.push(toRow(s, status === 'ok' ? ++rank : null, status, wonIn));
    }

    const others = (sorted: Stat[]) =>
      sorted.slice(0, TOP).map((s) => {
        const { status, wonIn } = statusOf(s.uid);
        return toRow(s, null, status, wonIn);
      });

    const winners =
      setting.confirmed ??
      official.filter((r) => r.status === 'ok').slice(0, 3).map((r) => ({ uid: r.uid, name: r.name, correct: r.correct }));
    for (const w of winners) if (!claimed.has(w.uid)) claimed.set(w.uid, key);

    boards[key] = {
      rounds: rounds.length,
      people: stats.length,
      official,
      bySpeedPoints: others(
        [...stats].sort((a, b) => b.speedPoints - a.speedPoints || officialCompare(a, b)),
      ),
      byAverage: others(
        [...stats].sort((a, b) => a.totalMs / a.correct - b.totalMs / b.correct || officialCompare(a, b)),
      ),
      fastestPerRound: fastest.map((f) => ({ ...f, rows: f.rows.sort((a, b) => a.ms - b.ms).slice(0, 3) })),
      winners,
      confirmed: setting.confirmed != null,
    };
  }
  return boards;
}
