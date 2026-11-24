"use client";

/**
 * Show export: one .xlsx workbook, one sheet per kind of data.
 *
 *   Summary           when, how many, who won
 *   Players           final standings and points per segment
 *   Rounds            every audience vote: statement, answer, votes per option
 *   Contestant Votes  each Segment 1/2/3 round as awarded (contestants' votes)
 *   Score Log         every change to a contestant's score and what caused it
 *   Audience          one row per person: name, phone, sign-up, each round's vote
 *   Raw Votes         one row per person per round
 *
 * The live state gives the statements, answers and scores; the server adds
 * what no screen holds (op:exportData): every vote per round, the score and
 * round logs, and the voter sign-ups (name + phone).
 */

import writeXlsxFile from "write-excel-file/browser";
import type { Row } from "write-excel-file/browser";

// ── Inputs ─────────────────────────────────────────────────────────────────

interface ShowState {
  phase: string;
  players: { id: number; name: string; score: number }[];
  warmup: { statements: { statement: string; isLie: boolean }[] };
  segment1: { statements: { playerId: number; playerName: string; statement: string; isLie: boolean }[] };
  segment2: { statements: { playerId: number; playerName: string; statements: string[]; lieIndex: number }[] };
  segment3: { photoTitle?: string | null; winnerId: number | null; showResult?: boolean };
  imposter?: { title: string; contestants: { id: number; name: string }[]; imposterId: number | null };
  voterScores: { [uid: string]: { name: string; correctCount: number } };
  audienceVotes: { [uid: string]: unknown };
}

export interface ExportData {
  exportedAt: number;
  episodeStartedAt: number;
  voters: { uid: string; name: string; phone: string; registeredAt: number }[];
  votersError: boolean;
  voteHistory: { [uid: string]: { name: string; votes: { [round: string]: { choice: string; ts: number } } } };
  scoreLog: { ts: number; event: string; phase: string; player: string; delta: number; score: number }[];
  roundLog: {
    ts: number;
    segment: string;
    storyteller: string;
    statement: string;
    answer: string;
    points: number;
    votes: { [player: string]: string };
  }[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

const HEADER = { fontWeight: "bold" as const, backgroundColor: "#FDE68A" };
const head = (...titles: string[]): Row => titles.map((value) => ({ value, type: String, ...HEADER }));
const s = (value: string | null | undefined) => ({ value: value ?? "", type: String });
const n = (value: number | null | undefined) => ({ value: value ?? undefined, type: Number });
const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString("en-IN") : "");
const clock = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleTimeString("en-IN", { hour12: false }) : "";

const PHASE_NAME: Record<string, string> = {
  SETUP: "Setup",
  WARMUP: "Warm-up",
  SEGMENT1: "Segment 1",
  IMPOSTER: "Imposter",
  SEGMENT2: "Segment 2",
  SEGMENT3: "Segment 3",
  FINAL: "Final",
};

/** One audience voting round, as the server keys it (warmup-0, seg1-2, seg3…). */
interface Round {
  key: string;
  segment: string;
  title: string;
  statement: string;
  options: string[];
  /** Correct choice, or null when it isn't decided (Segment 3 / Imposter before the answer). */
  answer: string | null;
}

function rounds(gs: ShowState): Round[] {
  const out: Round[] = [];
  gs.warmup.statements.forEach((st, i) =>
    out.push({
      key: `warmup-${i}`,
      segment: "Warm-up",
      title: `Warm-up ${i + 1}`,
      statement: st.statement,
      options: ["TRUTH", "LIE"],
      answer: st.isLie ? "LIE" : "TRUTH",
    }),
  );
  for (const st of gs.segment1.statements)
    out.push({
      key: `seg1-${st.playerId}`,
      segment: "Segment 1",
      title: `Segment 1: ${st.playerName}`,
      statement: st.statement,
      options: ["TRUTH", "LIE"],
      answer: st.isLie ? "LIE" : "TRUTH",
    });
  if (gs.imposter)
    out.push({
      key: "imposter",
      segment: "Imposter",
      title: gs.imposter.title,
      statement: gs.imposter.contestants.map((c) => c.name).join(", "),
      options: gs.imposter.contestants.map((c) => String(c.id)),
      answer: gs.imposter.imposterId != null ? String(gs.imposter.imposterId) : null,
    });
  for (const st of gs.segment2.statements)
    out.push({
      key: `seg2-${st.playerId}`,
      segment: "Segment 2",
      title: `Segment 2: ${st.playerName}`,
      statement: st.statements.map((t, i) => `${i + 1}. ${t}`).join("  "),
      options: st.statements.map((_, i) => `STATEMENT_${i}`),
      answer: `STATEMENT_${st.lieIndex}`,
    });
  out.push({
    key: "seg3",
    segment: "Segment 3",
    title: "Segment 3",
    statement: gs.segment3.photoTitle ?? "",
    options: gs.players.map((p) => String(p.id)),
    answer: gs.segment3.winnerId != null ? String(gs.segment3.winnerId) : null,
  });
  return out;
}

function choiceLabel(gs: ShowState, round: string, choice: string): string {
  const m = /^STATEMENT_(\d+)$/.exec(choice);
  if (m) return `Statement ${Number(m[1]) + 1}`;
  if (round === "seg3") return gs.players.find((p) => String(p.id) === choice)?.name ?? choice;
  if (round === "imposter") return gs.imposter?.contestants.find((c) => String(c.id) === choice)?.name ?? choice;
  return choice;
}

// ── Sheets ─────────────────────────────────────────────────────────────────

function summarySheet(gs: ShowState, d: ExportData, list: Round[]): Row[] {
  const voted = Object.keys(d.voteHistory).length;
  const totalVotes = Object.values(d.voteHistory).reduce((a, h) => a + Object.keys(h.votes).length, 0);
  const played = list.filter((r) => Object.values(d.voteHistory).some((h) => h.votes[r.key])).length;
  const ranked = [...gs.players].sort((a, b) => b.score - a.score);
  const topVoter = Object.values(gs.voterScores).sort((a, b) => b.correctCount - a.correctCount)[0];
  const rows: [string, string | number][] = [
    ["Exported at", when(d.exportedAt)],
    ["Episode started", when(d.episodeStartedAt)],
    ["Show stage at export", PHASE_NAME[gs.phase] ?? gs.phase],
    ["Contestants", gs.players.length],
    ["Leader", ranked[0] ? `${ranked[0].name} (${ranked[0].score})` : ""],
    ["Audience signed up", d.votersError ? "couldn't be read" : d.voters.length],
    ["Audience who voted", voted],
    ["Votes cast (all rounds)", totalVotes],
    ["Audience rounds with votes", played],
    ["Top voter", topVoter ? `${topVoter.name} (${topVoter.correctCount} correct)` : ""],
  ];
  return [head("Item", "Value"), ...rows.map(([k, v]) => [s(k), typeof v === "number" ? n(v) : s(v)])];
}

function playersSheet(gs: ShowState, d: ExportData): Row[] {
  const phases = ["WARMUP", "SEGMENT1", "IMPOSTER", "SEGMENT2", "SEGMENT3", "FINAL"];
  const byPlayer = new Map<string, Record<string, number>>();
  for (const e of d.scoreLog) {
    const row = byPlayer.get(e.player) ?? {};
    row[e.phase] = (row[e.phase] ?? 0) + e.delta;
    byPlayer.set(e.player, row);
  }
  const ranked = [...gs.players].sort((a, b) => b.score - a.score);
  return [
    head("Rank", "Contestant", "Final score", ...phases.map((p) => `${PHASE_NAME[p]} points`)),
    ...ranked.map((p, i) => [
      n(i + 1),
      s(p.name),
      n(p.score),
      ...phases.map((ph) => n(byPlayer.get(p.name)?.[ph] ?? 0)),
    ]),
  ];
}

function roundsSheet(gs: ShowState, d: ExportData, list: Round[]): Row[] {
  const maxOptions = Math.max(...list.map((r) => r.options.length), 2);
  const rows: Row[] = [
    head(
      "Round",
      "Segment",
      "Statement / object",
      "Correct answer",
      "Votes",
      "Correct votes",
      "% correct",
      ...Array.from({ length: maxOptions }, (_, i) => `Option ${i + 1}`),
      ...Array.from({ length: maxOptions }, (_, i) => `Option ${i + 1} votes`),
    ),
  ];
  for (const r of list) {
    const counts: Record<string, number> = Object.fromEntries(r.options.map((o) => [o, 0]));
    for (const h of Object.values(d.voteHistory)) {
      const v = h.votes[r.key];
      if (v && counts[v.choice] !== undefined) counts[v.choice]++;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const right = r.answer ? counts[r.answer] ?? 0 : 0;
    rows.push([
      s(r.title),
      s(r.segment),
      s(r.statement),
      s(r.answer ? choiceLabel(gs, r.key, r.answer) : "not decided"),
      n(total),
      n(r.answer ? right : undefined),
      s(r.answer && total ? `${Math.round((right / total) * 100)}%` : ""),
      ...Array.from({ length: maxOptions }, (_, i) => s(r.options[i] ? choiceLabel(gs, r.key, r.options[i]) : "")),
      ...Array.from({ length: maxOptions }, (_, i) => n(r.options[i] ? counts[r.options[i]] : undefined)),
    ]);
  }
  return rows;
}

function contestantSheet(gs: ShowState, d: ExportData): Row[] {
  const names = gs.players.map((p) => p.name);
  return [
    head("Time", "Segment", "Storyteller / winner", "Statement / object", "Answer", "Points", ...names),
    ...d.roundLog.map((r) => [
      s(clock(r.ts)),
      s(r.segment),
      s(r.storyteller),
      s(r.statement),
      s(r.answer),
      n(r.points),
      ...names.map((name) => s(r.votes[name] ?? "")),
    ]),
  ];
}

function scoreLogSheet(d: ExportData): Row[] {
  return [
    head("Time", "Stage", "What happened", "Contestant", "Change", "Score after"),
    ...d.scoreLog.map((e) => [
      s(clock(e.ts)),
      s(PHASE_NAME[e.phase] ?? e.phase),
      s(e.event),
      s(e.player),
      n(e.delta),
      n(e.score),
    ]),
  ];
}

/** Everyone who signed up or voted, keyed by uid. */
function people(gs: ShowState, d: ExportData) {
  const map = new Map<string, { name: string; phone: string; registeredAt: number | null }>();
  for (const v of d.voters) map.set(v.uid, { name: v.name, phone: v.phone, registeredAt: v.registeredAt });
  for (const [uid, h] of Object.entries(d.voteHistory))
    if (!map.has(uid))
      map.set(uid, { name: h.name || gs.voterScores[uid]?.name || "", phone: "", registeredAt: null });
  return map;
}

function audienceSheet(gs: ShowState, d: ExportData, list: Round[]): Row[] {
  const played = list.filter((r) => Object.values(d.voteHistory).some((h) => h.votes[r.key]));
  const rows: Row[] = [
    head("Name", "Phone", "Signed up", "Rounds voted", "Correct (scored)", "User ID", ...played.map((r) => r.title)),
  ];
  const list2 = [...people(gs, d).entries()].sort(
    (a, b) => (gs.voterScores[b[0]]?.correctCount ?? 0) - (gs.voterScores[a[0]]?.correctCount ?? 0),
  );
  for (const [uid, p] of list2) {
    const votes = d.voteHistory[uid]?.votes ?? {};
    rows.push([
      s(p.name),
      s(p.phone),
      s(when(p.registeredAt)),
      n(Object.keys(votes).length),
      n(gs.voterScores[uid]?.correctCount ?? 0),
      s(uid),
      ...played.map((r) => {
        const v = votes[r.key];
        if (!v) return s("");
        const mark = r.answer ? (v.choice === r.answer ? " ✓" : " ✗") : "";
        return s(choiceLabel(gs, r.key, v.choice) + mark);
      }),
    ]);
  }
  return rows;
}

function rawVotesSheet(gs: ShowState, d: ExportData, list: Round[]): Row[] {
  const byKey = new Map(list.map((r) => [r.key, r]));
  const who = people(gs, d);
  const rows: { ts: number; row: Row }[] = [];
  for (const [uid, h] of Object.entries(d.voteHistory)) {
    for (const [key, v] of Object.entries(h.votes)) {
      const r = byKey.get(key);
      const p = who.get(uid);
      rows.push({
        ts: v.ts,
        row: [
          s(clock(v.ts)),
          s(p?.name || h.name),
          s(p?.phone ?? ""),
          s(r?.title ?? key),
          s(choiceLabel(gs, key, v.choice)),
          s(r?.answer ? (v.choice === r.answer ? "Yes" : "No") : ""),
          s(uid),
        ],
      });
    }
  }
  rows.sort((a, b) => a.ts - b.ts);
  return [head("Time", "Name", "Phone", "Round", "Vote", "Correct", "User ID"), ...rows.map((x) => x.row)];
}

// ── Download ───────────────────────────────────────────────────────────────

const widths = (...w: number[]) => w.map((width) => ({ width }));

/** Build and download the workbook. Returns the filename. */
export async function downloadShowWorkbook(gs: ShowState, d: ExportData): Promise<string> {
  const list = rounds(gs);
  const stamp = new Date(d.exportedAt).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `lie-hard-${stamp}.xlsx`;
  const playedCount = list.filter((r) => Object.values(d.voteHistory).some((h) => h.votes[r.key])).length;

  await writeXlsxFile([
    { sheet: "Summary", data: summarySheet(gs, d, list), columns: widths(28, 40), stickyRowsCount: 1 },
    { sheet: "Players", data: playersSheet(gs, d), columns: widths(7, 24, 12, 16, 16, 16, 16, 14), stickyRowsCount: 1 },
    { sheet: "Rounds", data: roundsSheet(gs, d, list), columns: widths(26, 12, 60, 18, 8, 13, 10, 16, 16, 16, 16, 16, 16), stickyRowsCount: 1 },
    { sheet: "Contestant Votes", data: contestantSheet(gs, d), columns: widths(10, 12, 22, 60, 26, 8, ...gs.players.map(() => 20)), stickyRowsCount: 1 },
    { sheet: "Score Log", data: scoreLogSheet(d), columns: widths(10, 12, 34, 22, 9, 11), stickyRowsCount: 1 },
    { sheet: "Audience", data: audienceSheet(gs, d, list), columns: widths(24, 14, 20, 12, 15, 30, ...Array(playedCount).fill(18)), stickyRowsCount: 1 },
    { sheet: "Raw Votes", data: rawVotesSheet(gs, d, list), columns: widths(10, 24, 14, 26, 18, 9, 30), stickyRowsCount: 1 },
  ]).toFile(fileName);

  return fileName;
}
