"use client";

import { useState, useEffect, useRef, ChangeEvent } from "react";
import Papa from "papaparse";
import { useControlAccess } from "@/contexts/ControlAccessContext";
import { useGameState } from "@/lib/useGameState";
import { OP } from "@/lib/realtime";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// ── Types ──────────────────────────────────────────────────────────────────

interface Player {
  id: number;
  name: string;
  score: number;
  photo: string;
}

interface WarmupStatement {
  statement: string;
  isLie: boolean;
}

interface Segment1Statement {
  playerId: number;
  playerName: string;
  statement: string;
  isLie: boolean;
}

interface Segment2Statement {
  playerId: number;
  playerName: string;
  statements: string[];
  lieIndex: number; // 0-based index of the lie statement
}

interface GameState {
  phase: "SETUP" | "WARMUP" | "SEGMENT1" | "SEGMENT2" | "SEGMENT3" | "FINAL";
  players: Player[];
  showScoreboard: boolean;
  showLeaderboardModal: boolean;
  showTopVoters: boolean;
  showScorePopup: boolean;
  showVoteBars: boolean;
  showLogo?: boolean;
  scorePopupDeltas: { name: string; delta: number }[];
  banterTimer: {
    totalSeconds: number;
    startedAt: number | null; // epoch ms — null when not running
    running: boolean;
  };
  warmup: {
    statements: WarmupStatement[];
    currentIndex: number;
    audienceVotingOpen: boolean;
    showResult: boolean;
  };
  segment1: {
    statements: Segment1Statement[];
    currentStorytellerId: number | null;
    playerVotes: { [playerId: number]: "TRUTH" | "LIE" | null };
    audienceVotingOpen: boolean;
    showResult: boolean;
    completedStorytellers: number[];
    statementShown?: boolean;
    points?: number;
  };
  segment2: {
    statements: Segment2Statement[];
    currentStorytellerId: number | null;
    playerVotes: { [playerId: number]: string | null };
    audienceVotingOpen: boolean;
    showResult: boolean;
    completedStorytellers: number[];
    revealedStatements: number[];
    points?: number;
  };
  segment3: {
    photoUrl: string | null;
    photoTitle: string | null;
    audienceVotingOpen: boolean;
    showResult: boolean;
    winnerId: number | null;
    playerStatements?: { [playerId: number]: string };
    shownStatements?: number[];
    points?: number;
  };
  audienceVotes: {
    [uid: string]: {
      choice: string;
      votingRound: string;
      displayName?: string;
    };
  };
  voterScores: {
    [uid: string]: { name: string; correctCount: number };
  };
}

// Initial/authoritative game state now lives on the server (lie-hard-server).

// ── Constants ──────────────────────────────────────────────────────────────

const PHASE_ORDER: GameState["phase"][] = [
  "SETUP",
  "WARMUP",
  "SEGMENT1",
  "SEGMENT2",
  "SEGMENT3",
  "FINAL",
];
const PHASE_LABELS: Record<GameState["phase"], string> = {
  SETUP: "Setup",
  WARMUP: "Warmup",
  SEGMENT1: "Seg 1",
  SEGMENT2: "Seg 2",
  SEGMENT3: "Seg 3",
  FINAL: "Final",
};

// ── Module-level components (fixes remount bug from inner definitions) ─────

/**
 * Operator control to set the points this round is played for. Local input state
 * stays authoritative while focused (so server echoes never fight the caret);
 * on blur it re-syncs to the authoritative value.
 */
function SegmentPointsInput({
  points,
  onSet,
}: {
  points: number;
  onSet: (p: number) => void;
}) {
  const [val, setVal] = useState(String(points));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setVal(String(points));
  }, [points]);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-zinc-400">
        Points this round
      </span>
      <input
        type="number"
        min={0}
        value={val}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setVal(String(points));
        }}
        onChange={(e) => {
          setVal(e.target.value);
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n) && n >= 0) onSet(n);
        }}
        className="w-20 rounded border border-amber-500/40 bg-zinc-800 px-2 py-1 text-center text-white tabular-nums focus:border-amber-500 focus:outline-none"
      />
    </div>
  );
}

function VoteBars({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const colorMap: Record<string, string> = {
    TRUTH: "#4ade80",
    LIE: "#f87171",
  };
  const STATEMENT_PALETTE = [
    "#fbbf24",
    "#a78bfa",
    "#34d399",
    "#60a5fa",
    "#f472b6",
  ];
  Object.keys(counts).forEach((key, i) => {
    if (key.startsWith("STATEMENT_"))
      colorMap[key] = STATEMENT_PALETTE[i % STATEMENT_PALETTE.length];
  });
  return (
    <div
      className="space-y-3 rounded-lg p-4"
      style={{ backgroundColor: "#0d0d0f", border: "1px solid #27272a" }}
    >
      {Object.entries(counts).map(([label, count]) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const color = colorMap[label] ?? "#71717a";
        return (
          <div key={label} className="flex items-center gap-3">
            <span
              className="w-32 font-mono text-sm font-bold shrink-0"
              style={{ color: "#a1a1aa" }}
            >
              {label}
            </span>
            <div
              className="flex-1 h-4 rounded-full overflow-hidden"
              style={{ backgroundColor: "#27272a" }}
            >
              <div
                className="h-4 rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
            <span
              className="font-mono text-sm w-24 text-right shrink-0 font-bold"
              style={{ color: "#e4e4e7" }}
            >
              {count} · {pct}%
            </span>
          </div>
        );
      })}
      <p className="font-mono text-sm pt-1" style={{ color: "#52525b" }}>
        TOTAL VOTES: {total}
      </p>
    </div>
  );
}

interface SectionCardProps {
  id: GameState["phase"];
  title: string;
  currentPhase: GameState["phase"];
  render: () => React.ReactNode;
}

function SectionCard({ id, title, currentPhase, render }: SectionCardProps) {
  const isActive = currentPhase === id;
  if (!isActive) return null;

  return (
    <div
      className="mb-4 rounded-xl overflow-hidden"
      style={{ border: "2px solid #f59e0b" }}
    >
      <div className="px-6 py-3" style={{ backgroundColor: "#130f00" }}>
        <span
          className="font-mono text-sm font-bold uppercase tracking-widest"
          style={{ color: "#f59e0b" }}
        >
          ▶ {title}
        </span>
      </div>
      <div className="p-6">{render()}</div>
    </div>
  );
}

// ── Vote/open button pair ──────────────────────────────────────────────────

// ── Top Voters Panel ───────────────────────────────────────────────────────

function TopVotersPanel({
  voterScores,
}: {
  voterScores: GameState["voterScores"];
}) {
  const sorted = Object.entries(voterScores)
    .sort(([, a], [, b]) => b.correctCount - a.correctCount)
    .slice(0, 3);

  if (sorted.length === 0) {
    return (
      <p className="font-mono text-xs px-1 pt-1" style={{ color: "#3f3f46" }}>
        No data yet
      </p>
    );
  }

  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div
      className="rounded-lg p-3 space-y-2"
      style={{ backgroundColor: "#0d0d0f", border: "1px solid #27272a" }}
    >
      {sorted.map(([uid, data], rank) => (
        <div key={uid} className="flex items-center gap-2">
          <span className="text-base shrink-0">{medals[rank]}</span>
          <span
            className="font-mono text-sm flex-1 truncate"
            style={{ color: "#e4e4e7" }}
          >
            {data.name}
          </span>
          <span
            className="font-mono text-sm font-bold shrink-0"
            style={{ color: "#f59e0b" }}
          >
            {data.correctCount} ✓
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function OperatorPage() {
  const { isAuthenticated, authenticate, getToken } = useControlAccess();
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const success = await authenticate(authPassword);
    if (!success) {
      setAuthError("Incorrect password. Please try again.");
      setAuthPassword("");
    }
  };

  // Authoritative game state over WebSocket (operator role; JWT-gated).
  const { gameState, emit } = useGameState<GameState>("operator", {
    getToken,
    enabled: isAuthenticated,
  });
  /** Fire-and-forget operator control event. */
  const send = (event: string, payload?: unknown) => {
    void emit(event, payload);
  };

  const [playerCount, setPlayerCount] = useState(0);
  const [playerNames, setPlayerNames] = useState<string[]>([]);
  const [playerPhotos, setPlayerPhotos] = useState<string[]>([]);
  const [warmupData, setWarmupData] = useState<WarmupStatement[]>([]);
  const [seg1Data, setSeg1Data] = useState<Segment1Statement[]>([]);
  const [seg2Data, setSeg2Data] = useState<Segment2Statement[]>([]);
  const [seg3Title, setSeg3Title] = useState<string>("");
  const [seg3Photo, setSeg3Photo] = useState<string>("");

  const [warmupVoteLocked, setWarmupVoteLocked] = useState(false);
  const [scoreInputs, setScoreInputs] = useState<Record<number, string>>({});

  // Timer input + local display (computed from Firestore banterTimer)
  const [timerInput, setTimerInput] = useState("60");
  const [timerDisplaySeconds, setTimerDisplaySeconds] = useState(60);
  const timerTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [seg1Preview, setSeg1Preview] = useState<{
    lines: string[];
    totals: Record<number, number>;
  } | null>(null);
  const [seg1Awarded, setSeg1Awarded] = useState(false);
  const [seg2Preview, setSeg2Preview] = useState<{
    lines: string[];
    totals: Record<number, number>;
  } | null>(null);
  const [seg2Awarded, setSeg2Awarded] = useState(false);

  const [seg3ManualWinnerId, setSeg3ManualWinnerId] = useState<number | null>(
    null,
  );

  // Live content editing — fix a statement / answer / object mid-show.
  const [editSeg1, setEditSeg1] = useState(false);
  const [seg1Draft, setSeg1Draft] = useState<{
    statement: string;
    isLie: boolean;
  }>({ statement: "", isLie: false });
  const [editSeg2, setEditSeg2] = useState(false);
  const [seg2Draft, setSeg2Draft] = useState<{
    statements: string[];
    lieIndex: number;
  }>({ statements: [], lieIndex: 0 });
  const [editSeg3, setEditSeg3] = useState(false);
  const [seg3EditPhoto, setSeg3EditPhoto] = useState<string>("");
  const [seg3EditTitle, setSeg3EditTitle] = useState<string>("");

  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Failover: control/mode.backupMode (shared with the backup app). When true the
  // backup operator owns the show and the audience votes over Firestore.
  const [backupMode, setBackupMode] = useState(false);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "control", "mode"), (snap) => {
      setBackupMode(snap.exists() ? Boolean(snap.data()?.backupMode) : false);
    });
    return () => unsub();
  }, []);
  const setAudienceBackupMode = (backup: boolean) => {
    void setDoc(
      doc(db, "control", "mode"),
      { backupMode: backup },
      { merge: true },
    );
  };

  // Resize player name/photo arrays when count changes
  useEffect(() => {
    setPlayerNames((prev) =>
      Array.from(
        { length: playerCount },
        (_, i) => prev[i] ?? `Player ${i + 1}`,
      ),
    );
    setPlayerPhotos((prev) =>
      Array.from({ length: playerCount }, (_, i) => prev[i] ?? ""),
    );
  }, [playerCount]);

  useEffect(() => {
    setSeg1Preview(null);
    setSeg1Awarded(false);
    setEditSeg1(false);
  }, [gameState?.segment1?.currentStorytellerId]);

  useEffect(() => {
    setSeg2Preview(null);
    setSeg2Awarded(false);
    setEditSeg2(false);
  }, [gameState?.segment2?.currentStorytellerId]);

  // Keep the points breakdown in sync if the answer is edited after the reveal.
  useEffect(() => {
    if (
      gameState?.phase === "SEGMENT1" &&
      gameState.segment1.showResult &&
      seg1Preview &&
      !seg1Awarded
    ) {
      calcSeg1Points();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.segment1?.statements, gameState?.segment1?.points]);

  useEffect(() => {
    if (
      gameState?.phase === "SEGMENT2" &&
      gameState.segment2.showResult &&
      seg2Preview &&
      !seg2Awarded
    ) {
      calcSeg2Points();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.segment2?.statements, gameState?.segment2?.points]);

  // Compute local display seconds from Firestore timer state
  useEffect(() => {
    const bt = gameState?.banterTimer;
    if (!bt) return;
    if (timerTickRef.current) clearInterval(timerTickRef.current);
    if (bt.running && bt.startedAt !== null) {
      const tick = () => {
        const remaining = Math.max(
          0,
          bt.totalSeconds - Math.floor((Date.now() - bt.startedAt!) / 1000),
        );
        setTimerDisplaySeconds(remaining);
      };
      tick();
      timerTickRef.current = setInterval(tick, 250);
    } else {
      setTimerDisplaySeconds(bt.totalSeconds);
    }
    return () => {
      if (timerTickRef.current) clearInterval(timerTickRef.current);
    };
  }, [
    gameState?.banterTimer?.running,
    gameState?.banterTimer?.startedAt,
    gameState?.banterTimer?.totalSeconds,
  ]);

  // Voter scores are now computed authoritatively on the server at reveal time.

  // ── Vote count helper ──────────────────────────────────────────────────────

  function getVoteCounts(
    votingRound: string,
    options: string[],
  ): Record<string, number> {
    const counts = Object.fromEntries(options.map((o) => [o, 0]));
    Object.values(gameState?.audienceVotes ?? {}).forEach((v) => {
      if (v.votingRound === votingRound && counts[v.choice] !== undefined)
        counts[v.choice]++;
    });
    return counts;
  }

  // ── CSV parsers ────────────────────────────────────────────────────────────

  // The CSV `answer` column holds the on-screen answer for the statement:
  // "TRUTH" or "LIE" (case-insensitive) — shown exactly as typed, never flipped.
  // Falls back to the legacy `is_lie` column (TRUE = lie) so old CSVs still load.
  function rowIsLie(row: Record<string, string>): boolean {
    const answer = (row.answer ?? "").trim().toUpperCase();
    if (answer === "LIE") return true;
    if (answer === "TRUTH") return false;
    return (row.is_lie ?? "").trim().toUpperCase() === "TRUE";
  }

  function parseWarmupCsv(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      comments: "#",
      complete: (results) => {
        setWarmupData(
          (results.data as Record<string, string>[]).map((row) => ({
            statement: row.statement,
            isLie: rowIsLie(row),
          })),
        );
      },
      error: (err) => alert(`CSV error: ${err.message}`),
    });
  }

  function parseSeg1Csv(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      comments: "#",
      complete: (results) => {
        setSeg1Data(
          (results.data as Record<string, string>[]).map((row) => ({
            playerId: parseInt(row.player_id, 10),
            playerName: row.player_name,
            statement: row.statement,
            isLie: rowIsLie(row),
          })),
        );
      },
      error: (err) => alert(`CSV error: ${err.message}`),
    });
  }

  function parseSeg2Csv(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      comments: "#",
      complete: (results) => {
        const rows = results.data as Record<string, string>[];
        // Group rows by player_id; each row has: player_id, player_name, statement, answer.
        // The row whose answer is LIE marks that player's lie.
        const byPlayer: Record<
          number,
          { playerName: string; statements: string[]; lieIndex: number }
        > = {};
        rows.forEach((row) => {
          const id = parseInt(row.player_id, 10);
          if (!byPlayer[id])
            byPlayer[id] = {
              playerName: row.player_name,
              statements: [],
              lieIndex: 0,
            };
          const idx = byPlayer[id].statements.length;
          byPlayer[id].statements.push(row.statement);
          if (rowIsLie(row)) byPlayer[id].lieIndex = idx;
        });
        setSeg2Data(
          Object.entries(byPlayer).map(([id, data]) => ({
            playerId: parseInt(id, 10),
            playerName: data.playerName,
            statements: data.statements,
            lieIndex: data.lieIndex,
          })),
        );
      },
      error: (err) => alert(`CSV error: ${err.message}`),
    });
  }

  function loadPhotoAsBase64(file: File, onDone: (b64: string) => void) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 400;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      onDone(canvas.toDataURL("image/jpeg", 0.75));
    };
    img.src = url;
  }

  // ── Setup: pre-populate from existing game state (used when going back to setup) ─

  function populateSetupFromGameState(gs: GameState) {
    const count = gs.players.length;
    setPlayerCount(count);
    setPlayerNames(gs.players.map((p) => p.name));
    setPlayerPhotos(
      gs.players.map((p) => (p.photo.startsWith("data:") ? p.photo : "")),
    );
    setWarmupData(gs.warmup.statements);
    setSeg1Data(gs.segment1.statements);
    setSeg2Data(gs.segment2.statements);
    if (gs.segment3.photoTitle) setSeg3Title(gs.segment3.photoTitle);
    setSeg3Photo(gs.segment3.photoUrl ?? "");
  }

  // ── CSV Export ─────────────────────────────────────────────────────────────

  function downloadCsv() {
    if (!gameState) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `lie-hard-session-${timestamp}.csv`;
    const rows: string[][] = [];

    rows.push(["PLAYER SCORES"]);
    rows.push(["rank", "name", "score"]);
    [...gameState.players]
      .sort((a, b) => b.score - a.score)
      .forEach((p, i) => rows.push([String(i + 1), p.name, String(p.score)]));

    rows.push([]);

    rows.push(["AUDIENCE VOTER SCORES"]);
    rows.push(["name", "correctVotes"]);
    Object.values(gameState.voterScores ?? {})
      .sort((a, b) => b.correctCount - a.correctCount)
      .forEach((v) => rows.push([v.name, String(v.correctCount)]));

    rows.push([]);

    rows.push(["RAW AUDIENCE VOTES"]);
    rows.push(["uid", "displayName", "choice", "votingRound"]);
    Object.entries(gameState.audienceVotes ?? {}).forEach(([uid, v]) =>
      rows.push([uid, v.displayName ?? "", v.choice, v.votingRound]),
    );

    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // ── Setup: validate & start ────────────────────────────────────────────────

  function validateAndStart() {
    const errors: string[] = [];
    if (playerCount < 2) errors.push("Need at least 2 players.");
    if (playerCount > 10) errors.push("Maximum 10 players allowed.");
    if (playerNames.some((n) => !n.trim()))
      errors.push(`All ${playerCount} player names must be filled.`);
    if (warmupData.length < 1)
      errors.push("Warmup CSV must have at least 1 row.");
    if (seg1Data.length !== playerCount)
      errors.push(
        `Segment 1 CSV must have exactly ${playerCount} rows (one per player).`,
      );
    if (seg2Data.length < 1)
      errors.push("Segment 2 CSV must have at least 1 row.");
    if (errors.length > 0) {
      alert(errors.join("\n"));
      return;
    }

    // Send setup to the server, which builds the authoritative starting state.
    emit(OP.START_SHOW, {
      players: playerNames.map((name, i) => ({
        id: i + 1,
        name: name.trim(),
        photo: playerPhotos[i] || "",
      })),
      warmup: warmupData,
      segment1: seg1Data,
      segment2: seg2Data,
      segment3: { photoUrl: seg3Photo || null, photoTitle: seg3Title || null },
    }).then((ack) => {
      alert(
        ack.ok
          ? "Show started! Phase set to WARMUP."
          : `Error starting show: ${ack.error ?? "unknown"}`,
      );
    });
  }

  // ── Segment 1 scoring ──────────────────────────────────────────────────────

  function calcSeg1Points() {
    if (!gameState) return;
    const { players, segment1 } = gameState;
    const stmtObj = segment1.statements.find(
      (s) => s.playerId === segment1.currentStorytellerId,
    );
    if (!stmtObj) return;
    const storytellerId = segment1.currentStorytellerId!;
    const pts = segment1.points ?? 10;
    const correctAnswer = stmtObj.isLie ? "LIE" : "TRUTH";
    const nonStorytellers = players.filter((p) => p.id !== storytellerId);
    const totals: Record<number, number> = Object.fromEntries(
      players.map((p) => [p.id, 0]),
    );
    const storytellerName =
      players.find((p) => p.id === storytellerId)?.name ?? "Storyteller";
    const lines: string[] = [];
    nonStorytellers.forEach((player) => {
      const vote = segment1.playerVotes[player.id];
      if (vote === correctAnswer) {
        totals[player.id] += pts;
        lines.push(
          `${player.name} voted ${vote} → CORRECT → ${player.name} +${pts} pts`,
        );
      } else if (vote) {
        totals[storytellerId] += pts;
        lines.push(
          `${player.name} voted ${vote} → WRONG → ${storytellerName} +${pts} pts`,
        );
      } else {
        lines.push(`${player.name} did not vote`);
      }
    });
    setSeg1Preview({ lines, totals });
  }

  async function awardSeg1Points() {
    if (!gameState || !seg1Preview) return;
    // Server recomputes the award authoritatively from the logged player votes.
    await emit(OP.AWARD_SEGMENT, { segment: "segment1" });
    setSeg1Awarded(true);
  }

  // ── Segment 2 scoring ──────────────────────────────────────────────────────

  function calcSeg2Points() {
    if (!gameState) return;
    const { players, segment2 } = gameState;
    const stmtObj = segment2.statements.find(
      (s) => s.playerId === segment2.currentStorytellerId,
    );
    if (!stmtObj) return;
    const storytellerId = segment2.currentStorytellerId!;
    const pts = segment2.points ?? 20;
    const correctAnswer = "STATEMENT_" + stmtObj.lieIndex;
    const nonStorytellers = players.filter((p) => p.id !== storytellerId);
    const totals: Record<number, number> = Object.fromEntries(
      players.map((p) => [p.id, 0]),
    );
    const storytellerName =
      players.find((p) => p.id === storytellerId)?.name ?? "Storyteller";
    const lines: string[] = [];
    nonStorytellers.forEach((player) => {
      const vote = segment2.playerVotes[player.id];
      if (vote === correctAnswer) {
        totals[player.id] += pts;
        lines.push(
          `${player.name} voted ${vote} → CORRECT → ${player.name} +${pts} pts`,
        );
      } else if (vote) {
        totals[storytellerId] += pts;
        lines.push(
          `${player.name} voted ${vote} → WRONG → ${storytellerName} +${pts} pts`,
        );
      } else {
        lines.push(`${player.name} did not vote`);
      }
    });
    setSeg2Preview({ lines, totals });
  }

  async function awardSeg2Points() {
    if (!gameState || !seg2Preview) return;
    // Server recomputes the award authoritatively from the logged player votes.
    await emit(OP.AWARD_SEGMENT, { segment: "segment2" });
    setSeg2Awarded(true);
  }

  // ── Segment 3 winner ───────────────────────────────────────────────────────

  function getSeg3Winner() {
    if (!gameState) return null;
    const { players } = gameState;
    const counts: Record<number, number> = Object.fromEntries(
      players.map((p) => [p.id, 0]),
    );
    Object.values(gameState.audienceVotes ?? {}).forEach((v) => {
      if (v.votingRound === "seg3") {
        const id = parseInt(v.choice, 10);
        if (counts[id] !== undefined) counts[id]++;
      }
    });
    const maxCount = Math.max(...Object.values(counts));
    const winners = players.filter((p) => counts[p.id] === maxCount);
    return { counts, winners, isTie: winners.length > 1, maxCount };
  }

  async function awardSeg3Points(winnerId: number) {
    if (!gameState) return;
    // Server applies the winner's points and tallies audience voter scores.
    await emit(OP.AWARD_SEGMENT3, { winnerId });
  }

  // ── Render helpers (plain functions, NOT component definitions) ────────────

  async function deleteUserData() {
    if (
      !confirm(
        "Delete all audience voter data? This removes all voter profiles and votes. This cannot be undone.",
      )
    )
      return;
    if (
      !confirm(
        "FINAL CONFIRMATION: All voter accounts and votes will be permanently deleted. Continue?",
      )
    )
      return;
    // Server clears voter records (Admin SDK) and resets votes/voterScores.
    const ack = await emit(OP.DELETE_USER_DATA);
    alert(
      ack.ok
        ? "Deleted all voter accounts and cleared all votes."
        : `Error: ${ack.error ?? "unknown"}`,
    );
  }

  function applyScore(playerId: number, sign: 1 | -1) {
    if (!gameState) return;
    const val = parseInt(scoreInputs[playerId] ?? "", 10);
    if (!val || val <= 0) return;
    send(OP.ADJUST_SCORE, { playerId, delta: sign * val });
    setScoreInputs((prev) => ({ ...prev, [playerId]: "" }));
  }

  function renderBanterTimer() {
    const bt = gameState?.banterTimer;
    const isRunning = bt?.running ?? false;
    const mins = Math.floor(timerDisplaySeconds / 60);
    const secs = String(timerDisplaySeconds % 60).padStart(2, "0");
    const isUrgent = timerDisplaySeconds <= 10 && timerDisplaySeconds > 0;
    const isDone = timerDisplaySeconds === 0;
    const parsedInput = Math.max(1, parseInt(timerInput) || 60);

    return (
      <div
        className="rounded-xl p-4"
        style={{ backgroundColor: "#0d0d0f", border: "1px solid #27272a" }}
      >
        <p
          className="font-mono text-xs uppercase tracking-widest mb-3"
          style={{ color: "#52525b" }}
        >
          Banter Timer
        </p>
        <div className="flex items-center gap-4 mb-4">
          <span
            className="font-mono text-5xl font-bold tabular-nums"
            style={{
              color: isDone ? "#f87171" : isUrgent ? "#fbbf24" : "#fafafa",
            }}
          >
            {mins}:{secs}
          </span>
          {isRunning && (
            <span className="font-mono text-sm" style={{ color: "#4ade80" }}>
              <span
                className="inline-block w-2 h-2 rounded-full mr-1.5 animate-pulse"
                style={{ backgroundColor: "#4ade80" }}
              />
              RUNNING
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mb-3">
          <input
            type="number"
            min={1}
            max={600}
            value={timerInput}
            onChange={(e) => setTimerInput(e.target.value)}
            disabled={isRunning}
            className="w-24 px-3 py-2 rounded font-mono text-sm outline-none disabled:opacity-40"
            style={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              color: "#fafafa",
            }}
            placeholder="60"
          />
          <span className="font-mono text-xs" style={{ color: "#52525b" }}>
            seconds
          </span>
        </div>
        <div className="flex gap-2">
          <button
            disabled={isRunning || (isDone && !bt?.startedAt)}
            onClick={() => send(OP.TIMER_START, { totalSeconds: parsedInput })}
            className="px-4 py-2.5 rounded font-mono text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
          >
            START
          </button>
          <button
            disabled={!isRunning}
            onClick={() => send(OP.TIMER_STOP)}
            className="px-4 py-2.5 rounded font-mono text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            style={{
              backgroundColor: "#27272a",
              color: "#a1a1aa",
              border: "1px solid #3f3f46",
            }}
          >
            STOP
          </button>
          <button
            onClick={() => send(OP.TIMER_RESET, { totalSeconds: parsedInput })}
            className="px-4 py-2.5 rounded font-mono text-sm font-bold transition-colors"
            style={{
              backgroundColor: "#27272a",
              color: "#a1a1aa",
              border: "1px solid #3f3f46",
            }}
          >
            RESET
          </button>
        </div>
      </div>
    );
  }

  function renderRightPanel() {
    if (!gameState) return null;

    // Determine current vote context
    type VoteCtx = {
      isOpen: boolean;
      onOpen: () => void;
      onLock: () => void;
      label: string;
    } | null;
    const voteCtx: VoteCtx = (() => {
      switch (currentPhase) {
        case "WARMUP":
          return {
            isOpen: gameState.warmup.audienceVotingOpen,
            onOpen: () => send(OP.OPEN_VOTE, { segment: "warmup" }),
            onLock: () => {
              setWarmupVoteLocked(true);
              send(OP.LOCK_VOTE, { segment: "warmup" });
            },
            label: "WARMUP VOTE",
          };
        case "SEGMENT1":
          if (!gameState.segment1.currentStorytellerId) return null;
          return {
            isOpen: gameState.segment1.audienceVotingOpen,
            onOpen: () => send(OP.OPEN_VOTE, { segment: "segment1" }),
            onLock: () => send(OP.LOCK_VOTE, { segment: "segment1" }),
            label: "AUDIENCE VOTE",
          };
        case "SEGMENT2":
          if (!gameState.segment2.currentStorytellerId) return null;
          return {
            isOpen: gameState.segment2.audienceVotingOpen,
            onOpen: () => send(OP.OPEN_VOTE, { segment: "segment2" }),
            onLock: () => send(OP.LOCK_VOTE, { segment: "segment2" }),
            label: "AUDIENCE VOTE",
          };
        case "SEGMENT3":
          return {
            isOpen: gameState.segment3.audienceVotingOpen,
            onOpen: () => send(OP.OPEN_VOTE, { segment: "segment3" }),
            onLock: () => send(OP.LOCK_VOTE, { segment: "segment3" }),
            label: "AUDIENCE VOTE",
          };
        default:
          return null;
      }
    })();

    const logoEnabled = gameState.showLogo ?? false;

    const panelBtn = (
      label: string,
      onClick: () => void,
      style: React.CSSProperties,
      disabled = false,
    ) => (
      <button
        onClick={onClick}
        disabled={disabled}
        className="w-full px-4 py-3 rounded-lg font-mono text-sm font-bold text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={style}
      >
        {label}
      </button>
    );

    return (
      <aside
        className="w-56 shrink-0 sticky self-start overflow-y-auto"
        style={{
          top: "73px",
          height: "calc(100vh - 73px)",
          borderLeft: "1px solid #27272a",
          backgroundColor: "#0a0a0c",
        }}
      >
        <div className="p-4 space-y-6">
          {/* Live vote count */}
          <div
            className="rounded-lg px-4 py-3 text-center"
            style={{ backgroundColor: "#0d0d0f", border: "1px solid #27272a" }}
          >
            <p
              className="font-mono text-xs uppercase tracking-widest mb-1"
              style={{ color: "#52525b" }}
            >
              Total Votes
            </p>
            <p
              className="font-display font-black text-3xl"
              style={{ color: "#f59e0b" }}
            >
              {Object.keys(gameState.audienceVotes ?? {}).length}
            </p>
          </div>

          <div style={{ borderTop: "1px solid #27272a" }} />

          {/* Audience Vote */}
          {voteCtx ? (
            <div className="space-y-2">
              <p
                className="font-mono text-xs uppercase tracking-widest"
                style={{ color: "#52525b" }}
              >
                {voteCtx.label}
              </p>
              {panelBtn(
                "OPEN VOTE",
                voteCtx.onOpen,
                {
                  backgroundColor: voteCtx.isOpen ? "#1a1a1a" : "#052e16",
                  color: voteCtx.isOpen ? "#3f3f46" : "#4ade80",
                  border: `1px solid ${voteCtx.isOpen ? "#27272a" : "#166534"}`,
                },
                voteCtx.isOpen,
              )}
              {panelBtn(
                "LOCK VOTE",
                voteCtx.onLock,
                {
                  backgroundColor: !voteCtx.isOpen ? "#1a1a1a" : "#450a0a",
                  color: !voteCtx.isOpen ? "#3f3f46" : "#f87171",
                  border: `1px solid ${!voteCtx.isOpen ? "#27272a" : "#7f1d1d"}`,
                },
                !voteCtx.isOpen,
              )}
              {voteCtx.isOpen && (
                <div className="flex items-center gap-2 px-1 py-1">
                  <span
                    className="w-2 h-2 rounded-full animate-pulse shrink-0"
                    style={{ backgroundColor: "#4ade80" }}
                  />
                  <span
                    className="font-mono text-sm"
                    style={{ color: "#4ade80" }}
                  >
                    VOTING LIVE
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p
                className="font-mono text-xs uppercase tracking-widest"
                style={{ color: "#52525b" }}
              >
                AUDIENCE VOTE
              </p>
              <p className="font-mono text-xs" style={{ color: "#3f3f46" }}>
                No active vote in this phase
              </p>
            </div>
          )}

          <div style={{ borderTop: "1px solid #27272a" }} />

          {/* Display controls */}
          <div className="space-y-2">
            <p
              className="font-mono text-xs uppercase tracking-widest"
              style={{ color: "#52525b" }}
            >
              DISPLAY
            </p>
            {panelBtn(
              gameState.showScoreboard ? "● Scoreboard ON" : "○ Scoreboard OFF",
              () =>
                send(OP.TOGGLE_DISPLAY, {
                  key: "showScoreboard",
                  value: !gameState.showScoreboard,
                }),
              {
                border: "1px solid #27272a",
                backgroundColor: "transparent",
                color: gameState.showScoreboard ? "#4ade80" : "#52525b",
              },
            )}
            {panelBtn(
              gameState.showLeaderboardModal
                ? "● Leaderboard ON"
                : "○ Leaderboard OFF",
              () =>
                send(OP.TOGGLE_DISPLAY, {
                  key: "showLeaderboardModal",
                  value: !gameState.showLeaderboardModal,
                }),
              {
                border: "1px solid #27272a",
                backgroundColor: "transparent",
                color: gameState.showLeaderboardModal ? "#4ade80" : "#52525b",
              },
            )}
            {panelBtn(
              gameState.showScorePopup
                ? "● Score Popup ON"
                : "○ Score Popup OFF",
              () =>
                send(OP.TOGGLE_DISPLAY, {
                  key: "showScorePopup",
                  value: !gameState.showScorePopup,
                }),
              {
                border: "1px solid #27272a",
                backgroundColor: "transparent",
                color: gameState.showScorePopup ? "#4ade80" : "#52525b",
              },
              (gameState.scorePopupDeltas ?? []).length === 0,
            )}
            {panelBtn(
              (gameState.showVoteBars ?? true)
                ? "● Vote Bars ON"
                : "○ Vote Bars OFF",
              () =>
                send(OP.TOGGLE_DISPLAY, {
                  key: "showVoteBars",
                  value: !(gameState.showVoteBars ?? true),
                }),
              {
                border: "1px solid #27272a",
                backgroundColor: "transparent",
                color: (gameState.showVoteBars ?? true) ? "#4ade80" : "#52525b",
              },
            )}
            {panelBtn(
              logoEnabled ? "● Logo ON" : "○ Logo OFF",
              () =>
                send(OP.TOGGLE_DISPLAY, {
                  key: "showLogo",
                  value: !logoEnabled,
                }),
              {
                border: "1px solid #27272a",
                backgroundColor: "transparent",
                color: logoEnabled ? "#4ade80" : "#52525b",
              },
            )}
          </div>

          <div style={{ borderTop: "1px solid #27272a" }} />

          {/* Top Voters */}
          <div className="space-y-2">
            <p
              className="font-mono text-xs uppercase tracking-widest"
              style={{ color: "#52525b" }}
            >
              AUDIENCE
            </p>
            {panelBtn(
              gameState.showTopVoters ? "● Top Voters ON" : "○ Top Voters OFF",
              () =>
                send(OP.TOGGLE_DISPLAY, {
                  key: "showTopVoters",
                  value: !gameState.showTopVoters,
                }),
              {
                border: "1px solid #27272a",
                backgroundColor: "transparent",
                color: gameState.showTopVoters ? "#4ade80" : "#52525b",
              },
            )}
            {gameState.showTopVoters && (
              <TopVotersPanel voterScores={gameState.voterScores ?? {}} />
            )}
          </div>

          <div style={{ borderTop: "1px solid #27272a" }} />

          {/* Back to setup */}
          {currentPhase !== "SETUP" && (
            <div className="space-y-2">
              <p
                className="font-mono text-xs uppercase tracking-widest"
                style={{ color: "#52525b" }}
              >
                SETUP
              </p>
              {panelBtn(
                "← BACK TO SETUP",
                () => {
                  if (
                    confirm(
                      "Go back to setup? The game will pause. You can fix names, photos, or CSVs and restart.",
                    )
                  ) {
                    populateSetupFromGameState(gameState);
                    send(OP.GOTO_PHASE, { phase: "SETUP" });
                  }
                },
                {
                  backgroundColor: "#0f0f12",
                  color: "#a1a1aa",
                  border: "1px solid #3f3f46",
                },
              )}
            </div>
          )}

          <div style={{ borderTop: "1px solid #27272a" }} />

          {/* Data export */}
          <div className="space-y-2">
            <p
              className="font-mono text-xs uppercase tracking-widest"
              style={{ color: "#52525b" }}
            >
              DATA
            </p>
            {panelBtn("↓ DOWNLOAD CSV", downloadCsv, {
              backgroundColor: "#0d0d0f",
              color: "#a1a1aa",
              border: "1px solid #3f3f46",
            })}
          </div>

          <div style={{ borderTop: "1px solid #27272a" }} />

          {/* Reset */}
          <div className="space-y-2">
            <p
              className="font-mono text-xs uppercase tracking-widest"
              style={{ color: "#52525b" }}
            >
              DANGER
            </p>
            {panelBtn(
              "RESET GAME",
              () => {
                if (confirm("Reset the entire game? This cannot be undone.")) {
                  downloadCsv();
                  send(OP.RESET_GAME);
                }
              },
              {
                backgroundColor: "#1c0000",
                color: "#f87171",
                border: "1px solid #7f1d1d",
              },
            )}
            {panelBtn("DELETE USER DATA", deleteUserData, {
              backgroundColor: "#1c0000",
              color: "#f87171",
              border: "1px solid #7f1d1d",
            })}
          </div>
        </div>
      </aside>
    );
  }

  function renderSetup() {
    const countReady = playerCount >= 2;

    return (
      <div className="space-y-8">
        {/* Step 1: Number of players */}
        <div className="space-y-3">
          <p
            className="font-mono text-xs uppercase tracking-widest"
            style={{ color: "#52525b" }}
          >
            Step 1 — How many players?
          </p>
          <input
            type="text"
            inputMode="numeric"
            placeholder="e.g. 4"
            value={playerCount === 0 ? "" : playerCount}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                setPlayerCount(0);
                return;
              }
              const v = parseInt(raw);
              if (!isNaN(v)) setPlayerCount(Math.min(10, Math.max(0, v)));
            }}
            onBlur={() => {
              if (playerCount > 0)
                setPlayerCount((c) => Math.min(10, Math.max(2, c)));
            }}
            className="w-32 px-4 py-3 rounded-lg font-mono text-xl outline-none"
            style={{
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              color: "#fafafa",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#f59e0b")}
          />
          <p className="font-mono text-xs" style={{ color: "#52525b" }}>
            2–10 players (max 10).
          </p>
          {playerCount === 1 && (
            <p className="font-mono text-sm" style={{ color: "#f87171" }}>
              Need at least 2 players.
            </p>
          )}
        </div>

        {/* Step 2: Player names + photos (appears once count is valid) */}
        {countReady && (
          <div className="space-y-3">
            <p
              className="font-mono text-xs uppercase tracking-widest"
              style={{ color: "#52525b" }}
            >
              Step 2 — Player names & photos
            </p>
            <div className="space-y-3">
              {Array.from({ length: playerCount }, (_, i) => i).map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <span
                    className="font-mono text-sm w-6 shrink-0"
                    style={{ color: "#52525b" }}
                  >
                    P{i + 1}
                  </span>
                  <input
                    type="text"
                    value={playerNames[i] ?? ""}
                    onChange={(e) =>
                      setPlayerNames((prev) => {
                        const n = [...prev];
                        n[i] = e.target.value;
                        return n;
                      })
                    }
                    placeholder={`Player ${i + 1} name`}
                    className="flex-1 px-4 py-3 rounded-lg text-base outline-none transition-colors font-mono"
                    style={{
                      backgroundColor: "#18181b",
                      border: "1px solid #3f3f46",
                      color: "#fafafa",
                    }}
                    onFocus={(e) => (e.target.style.borderColor = "#f59e0b")}
                    onBlur={(e) => (e.target.style.borderColor = "#3f3f46")}
                  />
                  <label
                    className="cursor-pointer px-4 py-3 rounded-lg font-mono text-sm transition-colors shrink-0"
                    style={{ border: "1px solid #3f3f46", color: "#71717a" }}
                  >
                    Photo
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          loadPhotoAsBase64(file, (b64) =>
                            setPlayerPhotos((prev) => {
                              const p = [...prev];
                              p[i] = b64;
                              return p;
                            }),
                          );
                      }}
                    />
                  </label>
                  {playerPhotos[i] && (
                    <img
                      src={playerPhotos[i]}
                      className="w-11 h-11 rounded-full object-cover shrink-0"
                      style={{
                        outline: "2px solid #f59e0b",
                        outlineOffset: "2px",
                      }}
                      alt=""
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: CSV uploads + photo (appears once count is valid) */}
        {countReady && (
          <div className="space-y-4">
            <p
              className="font-mono text-xs uppercase tracking-widest"
              style={{ color: "#52525b" }}
            >
              Step 3 — Upload CSVs & segment 3 photo
            </p>
            <div className="grid grid-cols-2 gap-4">
              {[
                {
                  label: "WARMUP CSV",
                  sample: "/warmup_sample.csv",
                  onChange: parseWarmupCsv,
                  count: warmupData.length,
                  preview: warmupData.map((r) => r.statement),
                },
                {
                  label: "SEGMENT 1 CSV",
                  sample: "/segment1_sample.csv",
                  onChange: parseSeg1Csv,
                  count: seg1Data.length,
                  preview: seg1Data.map(
                    (r) => `${r.playerName}: ${r.statement}`,
                  ),
                },
                {
                  label: "SEGMENT 2 CSV",
                  sample: "/segment2_sample.csv",
                  onChange: parseSeg2Csv,
                  count: seg2Data.length,
                  preview: seg2Data.map(
                    (r) =>
                      `${r.playerName}: ${r.statements.length} statement(s)`,
                  ),
                },
              ].map(({ label, sample, onChange, count, preview }) => (
                <div
                  key={label}
                  className="rounded-lg p-4"
                  style={{
                    backgroundColor: "#0d0d0f",
                    border: "1px solid #27272a",
                  }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span
                      className="font-mono text-sm font-bold uppercase tracking-widest"
                      style={{ color: "#a1a1aa" }}
                    >
                      {label}
                    </span>
                    <div className="flex items-center gap-3">
                      {count > 0 && (
                        <span
                          className="font-mono text-sm"
                          style={{ color: "#4ade80" }}
                        >
                          ✓ {count} row{count !== 1 ? "s" : ""}
                        </span>
                      )}
                      <a
                        href={sample}
                        download
                        className="font-mono text-sm underline"
                        style={{ color: "#f59e0b" }}
                      >
                        sample
                      </a>
                    </div>
                  </div>
                  <label className="cursor-pointer inline-flex">
                    <span
                      className="px-4 py-2 rounded font-mono text-sm"
                      style={{ border: "1px solid #3f3f46", color: "#71717a" }}
                    >
                      Choose file
                    </span>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={onChange}
                      className="hidden"
                    />
                  </label>
                  {count > 0 && (
                    <div className="mt-2 space-y-0.5 max-h-16 overflow-y-auto">
                      {preview.map((line, i) => (
                        <p
                          key={i}
                          className="font-mono text-sm truncate"
                          style={{ color: "#52525b" }}
                        >
                          {i + 1}. {line}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              <div
                className="rounded-lg p-4"
                style={{
                  backgroundColor: "#0d0d0f",
                  border: "1px solid #27272a",
                }}
              >
                <p
                  className="font-mono text-sm font-bold uppercase tracking-widest mb-3"
                  style={{ color: "#a1a1aa" }}
                >
                  SEGMENT 3 OBJECT PHOTO
                </p>
                <label className="cursor-pointer inline-flex">
                  <span
                    className="px-4 py-2 rounded font-mono text-sm"
                    style={{ border: "1px solid #3f3f46", color: "#71717a" }}
                  >
                    Choose photo
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) loadPhotoAsBase64(file, setSeg3Photo);
                    }}
                  />
                </label>
                {seg3Photo && (
                  <img
                    src={seg3Photo}
                    alt="Object preview"
                    className="h-24 rounded-lg object-cover mt-3"
                    style={{ border: "1px solid #3f3f46" }}
                  />
                )}
              </div>

              <div
                className="rounded-lg p-4"
                style={{
                  backgroundColor: "#0d0d0f",
                  border: "1px solid #27272a",
                }}
              >
                <p
                  className="font-mono text-sm font-bold uppercase tracking-widest mb-3"
                  style={{ color: "#a1a1aa" }}
                >
                  SEGMENT 3 PHOTO TITLE{" "}
                  <span style={{ color: "#52525b" }}>(optional)</span>
                </p>
                <input
                  type="text"
                  value={seg3Title}
                  onChange={(e) => setSeg3Title(e.target.value)}
                  placeholder="e.g. The Mystery Object"
                  className="w-full px-3 py-2 rounded font-mono text-sm focus:outline-none"
                  style={{
                    backgroundColor: "#09090b",
                    border: "1px solid #3f3f46",
                    color: "#fafafa",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Validate & start */}
        {countReady && (
          <button
            onClick={validateAndStart}
            className="w-full py-4 rounded-xl font-mono text-base font-bold uppercase tracking-widest transition-colors"
            style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
          >
            VALIDATE &amp; START SHOW →
          </button>
        )}
      </div>
    );
  }

  function renderWarmup() {
    if (!gameState) return null;
    const { warmup } = gameState;
    const stmt = warmup.statements[warmup.currentIndex];
    const counts = getVoteCounts(`warmup-${warmup.currentIndex}`, [
      "TRUTH",
      "LIE",
    ]);

    const goTo = (newIndex: number) => {
      setWarmupVoteLocked(false);
      send(OP.WARMUP_NAV, { index: newIndex });
    };

    return (
      <div className="grid grid-cols-2 gap-6">
        {/* Left: statement + nav */}
        <div className="space-y-5">
          <div
            className="rounded-xl p-5"
            style={{ backgroundColor: "#0d0d0f", border: "1px solid #27272a" }}
          >
            <p
              className="font-mono text-sm uppercase tracking-widest mb-3"
              style={{ color: "#52525b" }}
            >
              STATEMENT {warmup.currentIndex + 1} OF {warmup.statements.length}
            </p>
            <p className="text-lg leading-relaxed" style={{ color: "#fafafa" }}>
              {stmt?.statement}
            </p>
            <div
              className="mt-4 pt-4"
              style={{ borderTop: "1px solid #27272a" }}
            >
              <span
                className="font-mono text-sm font-bold px-3 py-1 rounded"
                style={{
                  backgroundColor: stmt?.isLie ? "#450a0a" : "#052e16",
                  color: stmt?.isLie ? "#f87171" : "#4ade80",
                }}
              >
                ANSWER: {stmt?.isLie ? "LIE" : "TRUTH"}
              </span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              disabled={warmup.currentIndex === 0}
              onClick={() => goTo(warmup.currentIndex - 1)}
              className="px-6 py-3 rounded-lg font-mono text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              style={{ border: "1px solid #3f3f46", color: "#a1a1aa" }}
            >
              ← PREV
            </button>
            <button
              disabled={warmup.currentIndex >= warmup.statements.length - 1}
              onClick={() => goTo(warmup.currentIndex + 1)}
              className="px-6 py-3 rounded-lg font-mono text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              style={{ border: "1px solid #3f3f46", color: "#a1a1aa" }}
            >
              NEXT →
            </button>
          </div>

          <div className="pt-4" style={{ borderTop: "1px solid #27272a" }}>
            <button
              onClick={() => send(OP.GOTO_PHASE, { phase: "SEGMENT1" })}
              className="w-full py-4 rounded-xl font-mono text-base font-bold uppercase tracking-widest transition-colors"
              style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
            >
              MOVE TO SEGMENT 1 →
            </button>
          </div>
        </div>

        {/* Right: vote bars + reveal */}
        <div className="space-y-5">
          <VoteBars counts={counts} />
          {!warmup.showResult && (
            <button
              onClick={() => {
                send(OP.REVEAL, { segment: "warmup" });
                setWarmupVoteLocked(true);
              }}
              className="w-full py-4 rounded-xl font-mono text-base font-bold uppercase tracking-widest transition-colors"
              style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
            >
              REVEAL ANSWER
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderStorytellersGrid(
    players: Player[],
    completedStorytellers: number[],
    currentStorytellerId: number | null,
    onSelect: (id: number) => void,
  ) {
    return (
      <div>
        <p
          className="font-mono text-sm uppercase tracking-widest mb-4"
          style={{ color: "#52525b" }}
        >
          Select Storyteller
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(players.length, 5)}, minmax(0, 1fr))`,
            gap: "12px",
          }}
        >
          {players.map((player) => {
            const isDone = completedStorytellers.includes(player.id);
            const isSelected = currentStorytellerId === player.id;
            return (
              <button
                key={player.id}
                disabled={isDone}
                onClick={() => onSelect(player.id)}
                className="flex flex-col items-center gap-3 p-5 rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  border: isSelected
                    ? "2px solid #f59e0b"
                    : "1px solid #3f3f46",
                  backgroundColor: isSelected ? "#130f00" : "#18181b",
                }}
              >
                {player.photo && (
                  <img
                    src={player.photo}
                    className="w-16 h-16 rounded-full object-cover"
                    alt=""
                  />
                )}
                <span
                  className="font-mono text-base font-bold"
                  style={{ color: isSelected ? "#f59e0b" : "#a1a1aa" }}
                >
                  {player.name}
                </span>
                {isDone && (
                  <span
                    className="font-mono text-sm"
                    style={{ color: "#4ade80" }}
                  >
                    ✓ DONE
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderSeg1() {
    if (!gameState) return null;
    const { segment1, players } = gameState;
    const stmtObj = segment1.statements.find(
      (s) => s.playerId === segment1.currentStorytellerId,
    );
    const nonStorytellers = players.filter(
      (p) => p.id !== segment1.currentStorytellerId,
    );
    const counts = getVoteCounts(`seg1-${segment1.currentStorytellerId}`, [
      "TRUTH",
      "LIE",
    ]);
    const allDone = segment1.completedStorytellers.length === players.length;

    return (
      <div className="space-y-6">
        {renderStorytellersGrid(
          players,
          segment1.completedStorytellers,
          segment1.currentStorytellerId,
          (id) =>
            send(OP.SELECT_STORYTELLER, { segment: "segment1", playerId: id }),
        )}

        {stmtObj && (
          <div className="grid grid-cols-2 gap-6">
            {/* Left col: statement + player votes */}
            <div className="space-y-5">
              <div
                className="rounded-xl p-5"
                style={{
                  backgroundColor: "#0d0d0f",
                  border: "1px solid #27272a",
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <p
                    className="font-mono text-xs uppercase tracking-widest"
                    style={{ color: "#52525b" }}
                  >
                    STATEMENT
                  </p>
                  {!editSeg1 && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => send(OP.TOGGLE_SEG1_STATEMENT)}
                        className="font-mono text-xs font-bold px-2 py-1 rounded transition-colors"
                        style={{
                          backgroundColor: segment1.statementShown
                            ? "#052e16"
                            : "#1a1a1a",
                          color: segment1.statementShown
                            ? "#4ade80"
                            : "#71717a",
                          border: `1px solid ${segment1.statementShown ? "#166534" : "#3f3f46"}`,
                        }}
                      >
                        {segment1.statementShown ? "SHOWN" : "SHOW"}
                      </button>
                      <button
                        onClick={() => {
                          setSeg1Draft({
                            statement: stmtObj.statement,
                            isLie: stmtObj.isLie,
                          });
                          setEditSeg1(true);
                        }}
                        className="font-mono text-xs font-bold px-2 py-1 rounded transition-colors"
                        style={{
                          backgroundColor: "#1a1a1a",
                          color: "#f59e0b",
                          border: "1px solid #78350f",
                        }}
                      >
                        ✎ EDIT
                      </button>
                    </div>
                  )}
                </div>
                {!editSeg1 ? (
                  <>
                    <p
                      className="text-lg leading-relaxed"
                      style={{ color: "#fafafa" }}
                    >
                      {stmtObj.statement}
                    </p>
                    <div
                      className="mt-4 pt-4"
                      style={{ borderTop: "1px solid #27272a" }}
                    >
                      <span
                        className="font-mono text-sm font-bold px-3 py-1 rounded"
                        style={{
                          backgroundColor: stmtObj.isLie
                            ? "#450a0a"
                            : "#052e16",
                          color: stmtObj.isLie ? "#f87171" : "#4ade80",
                        }}
                      >
                        ANSWER: {stmtObj.isLie ? "LIE" : "TRUTH"}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <textarea
                      value={seg1Draft.statement}
                      onChange={(e) =>
                        setSeg1Draft((d) => ({
                          ...d,
                          statement: e.target.value,
                        }))
                      }
                      rows={3}
                      className="w-full px-3 py-2 rounded font-mono text-sm focus:outline-none resize-none"
                      style={{
                        backgroundColor: "#09090b",
                        border: "1px solid #3f3f46",
                        color: "#fafafa",
                      }}
                    />
                    <div className="flex gap-2">
                      {(["TRUTH", "LIE"] as const).map((opt) => {
                        const isLieOpt = opt === "LIE";
                        const active = seg1Draft.isLie === isLieOpt;
                        return (
                          <button
                            key={opt}
                            onClick={() =>
                              setSeg1Draft((d) => ({ ...d, isLie: isLieOpt }))
                            }
                            className="flex-1 py-2 rounded-lg font-mono text-sm font-bold transition-colors"
                            style={{
                              backgroundColor: active
                                ? isLieOpt
                                  ? "#450a0a"
                                  : "#052e16"
                                : "#27272a",
                              color: active
                                ? isLieOpt
                                  ? "#f87171"
                                  : "#4ade80"
                                : "#71717a",
                              border: `1px solid ${active ? (isLieOpt ? "#7f1d1d" : "#166534") : "#3f3f46"}`,
                            }}
                          >
                            ANSWER: {opt}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => {
                          send(OP.EDIT_SEG1, {
                            playerId: segment1.currentStorytellerId!,
                            statement: seg1Draft.statement.trim(),
                            isLie: seg1Draft.isLie,
                          });
                          setEditSeg1(false);
                        }}
                        className="flex-1 py-2 rounded-lg font-mono text-sm font-bold uppercase tracking-widest"
                        style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditSeg1(false)}
                        className="px-4 py-2 rounded-lg font-mono text-sm font-bold"
                        style={{
                          backgroundColor: "#27272a",
                          color: "#a1a1aa",
                          border: "1px solid #3f3f46",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <p
                  className="font-mono text-sm uppercase tracking-widest mb-4"
                  style={{ color: "#52525b" }}
                >
                  Log Player Votes
                </p>
                <div className="space-y-3">
                  {nonStorytellers.map((player) => (
                    <div key={player.id} className="flex items-center gap-3">
                      <span
                        className="font-mono text-base font-semibold w-28 shrink-0"
                        style={{ color: "#e4e4e7" }}
                      >
                        {player.name}
                      </span>
                      {(["TRUTH", "LIE"] as const).map((vote) => {
                        const selected =
                          segment1.playerVotes[player.id] === vote;
                        const isLie = vote === "LIE";
                        return (
                          <button
                            key={vote}
                            onClick={() =>
                              send(OP.SET_PLAYER_VOTE, {
                                segment: "segment1",
                                playerId: player.id,
                                vote,
                              })
                            }
                            className="flex-1 py-3 rounded-lg font-mono text-sm font-bold transition-colors"
                            style={{
                              backgroundColor: selected
                                ? isLie
                                  ? "#450a0a"
                                  : "#052e16"
                                : "#27272a",
                              color: selected
                                ? isLie
                                  ? "#f87171"
                                  : "#4ade80"
                                : "#71717a",
                              border: `1px solid ${selected ? (isLie ? "#7f1d1d" : "#166534") : "#3f3f46"}`,
                            }}
                          >
                            {vote}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right col: timer + vote bars + reveal + points */}
            <div className="space-y-5">
              {renderBanterTimer()}
              <VoteBars counts={counts} />

              {segment1.currentStorytellerId != null && (
                <SegmentPointsInput
                  points={segment1.points ?? 10}
                  onSet={(p) =>
                    send(OP.SET_SEGMENT_POINTS, {
                      segment: "segment1",
                      points: p,
                    })
                  }
                />
              )}

              {!segment1.showResult && (
                <button
                  onClick={() => {
                    send(OP.REVEAL, { segment: "segment1" });
                    calcSeg1Points();
                  }}
                  className="w-full py-4 rounded-xl font-mono text-base font-bold uppercase tracking-widest transition-colors"
                  style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
                >
                  REVEAL TRUTH / LIE
                </button>
              )}

              {seg1Preview && !seg1Awarded && (
                <div
                  className="rounded-xl p-5 space-y-3"
                  style={{
                    backgroundColor: "#0d0d0f",
                    border: "1px solid #78350f",
                  }}
                >
                  <p
                    className="font-mono text-sm font-bold uppercase tracking-widest"
                    style={{ color: "#f59e0b" }}
                  >
                    POINTS BREAKDOWN
                  </p>
                  {seg1Preview.lines.map((line, i) => (
                    <p
                      key={i}
                      className="font-mono text-sm"
                      style={{ color: "#a1a1aa" }}
                    >
                      {line}
                    </p>
                  ))}
                  <p
                    className="font-mono text-sm font-bold"
                    style={{ color: "#fafafa" }}
                  >
                    TOTAL:{" "}
                    {players
                      .map((p) =>
                        seg1Preview.totals[p.id]
                          ? `${p.name} +${seg1Preview.totals[p.id]}`
                          : null,
                      )
                      .filter(Boolean)
                      .join(", ") || "No changes"}
                  </p>
                  <button
                    onClick={awardSeg1Points}
                    className="w-full py-4 rounded-xl font-mono text-base font-bold uppercase tracking-widest transition-colors"
                    style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
                  >
                    CONFIRM &amp; AWARD POINTS
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="pt-4" style={{ borderTop: "1px solid #27272a" }}>
          {allDone ? (
            <button
              onClick={() => send(OP.GOTO_PHASE, { phase: "SEGMENT2" })}
              className="w-full py-4 rounded-xl font-mono text-base font-bold uppercase tracking-widest transition-colors"
              style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
            >
              MOVE TO SEGMENT 2 →
            </button>
          ) : (
            <p className="font-mono text-sm" style={{ color: "#52525b" }}>
              {segment1.completedStorytellers.length} OF {players.length}{" "}
              STORYTELLERS DONE
            </p>
          )}
        </div>
      </div>
    );
  }

  function renderSeg2() {
    if (!gameState) return null;
    const { segment2, players } = gameState;
    const stmtObj = segment2.statements.find(
      (s) => s.playerId === segment2.currentStorytellerId,
    );
    const nonStorytellers = players.filter(
      (p) => p.id !== segment2.currentStorytellerId,
    );
    const voteOptions = stmtObj
      ? stmtObj.statements.map((_, i) => `STATEMENT_${i}`)
      : ["STATEMENT_0", "STATEMENT_1"];
    const counts = getVoteCounts(
      `seg2-${segment2.currentStorytellerId}`,
      voteOptions,
    );
    const allDone = segment2.completedStorytellers.length === players.length;

    return (
      <div className="space-y-6">
        {renderStorytellersGrid(
          players,
          segment2.completedStorytellers,
          segment2.currentStorytellerId,
          (id) =>
            send(OP.SELECT_STORYTELLER, { segment: "segment2", playerId: id }),
        )}

        {stmtObj && (
          <div className="grid grid-cols-2 gap-6">
            {/* Left col: statements + player votes */}
            <div className="space-y-5">
              {!editSeg2 ? (
                <>
                  {(() => {
                    const STMT_PALETTE = [
                      "#fbbf24",
                      "#a78bfa",
                      "#34d399",
                      "#60a5fa",
                      "#f472b6",
                    ];
                    const revealed = segment2.revealedStatements ?? [];
                    return (
                      <div className="grid grid-cols-2 gap-3">
                        {stmtObj.statements.map((stmt, i) => {
                          const color = STMT_PALETTE[i % STMT_PALETTE.length];
                          const isRevealed = revealed.includes(i);
                          return (
                            <div
                              key={i}
                              className="rounded-xl p-4 space-y-3"
                              style={{
                                border: `1px solid ${isRevealed ? color + "66" : "#3f3f46"}`,
                                backgroundColor: "#0d0d0f",
                              }}
                            >
                              <div className="flex items-center justify-between">
                                <p
                                  className="font-mono text-sm font-bold"
                                  style={{ color }}
                                >{`STATEMENT ${i + 1}${i === stmtObj.lieIndex ? " ★ LIE" : ""}`}</p>
                                <button
                                  onClick={() => {
                                    send(OP.TOGGLE_STATEMENT, { index: i });
                                  }}
                                  className="font-mono text-xs font-bold px-2 py-1 rounded transition-colors"
                                  style={{
                                    backgroundColor: isRevealed
                                      ? "#052e16"
                                      : "#1a1a1a",
                                    color: isRevealed ? "#4ade80" : "#71717a",
                                    border: `1px solid ${isRevealed ? "#166534" : "#3f3f46"}`,
                                  }}
                                >
                                  {isRevealed ? "SHOWN" : "SHOW"}
                                </button>
                              </div>
                              <p
                                className="text-base leading-relaxed"
                                style={{ color: "#fafafa" }}
                              >
                                {stmt}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span
                      className="font-mono text-sm font-bold px-3 py-1.5 rounded inline-block"
                      style={{
                        backgroundColor: "#1c0a00",
                        color: "#f59e0b",
                        border: "1px solid #78350f",
                      }}
                    >
                      LIE IS STATEMENT {stmtObj.lieIndex + 1}
                    </span>
                    <button
                      onClick={() => {
                        setSeg2Draft({
                          statements: [...stmtObj.statements],
                          lieIndex: stmtObj.lieIndex,
                        });
                        setEditSeg2(true);
                      }}
                      className="font-mono text-xs font-bold px-2 py-1 rounded transition-colors"
                      style={{
                        backgroundColor: "#1a1a1a",
                        color: "#f59e0b",
                        border: "1px solid #78350f",
                      }}
                    >
                      ✎ EDIT STATEMENTS
                    </button>
                  </div>
                </>
              ) : (
                <div
                  className="rounded-xl p-4 space-y-3"
                  style={{
                    border: "1px solid #78350f",
                    backgroundColor: "#0d0d0f",
                  }}
                >
                  <p
                    className="font-mono text-xs uppercase tracking-widest"
                    style={{ color: "#f59e0b" }}
                  >
                    EDIT STATEMENTS
                  </p>
                  {seg2Draft.statements.map((s, i) => (
                    <div key={i} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span
                          className="font-mono text-xs font-bold"
                          style={{ color: "#71717a" }}
                        >
                          STATEMENT {i + 1}
                        </span>
                        <button
                          onClick={() =>
                            setSeg2Draft((d) => ({ ...d, lieIndex: i }))
                          }
                          className="font-mono text-xs font-bold px-2 py-1 rounded transition-colors"
                          style={{
                            backgroundColor:
                              seg2Draft.lieIndex === i ? "#1c0a00" : "#27272a",
                            color:
                              seg2Draft.lieIndex === i ? "#f59e0b" : "#71717a",
                            border: `1px solid ${seg2Draft.lieIndex === i ? "#78350f" : "#3f3f46"}`,
                          }}
                        >
                          {seg2Draft.lieIndex === i
                            ? "★ THE LIE"
                            : "MARK AS LIE"}
                        </button>
                      </div>
                      <textarea
                        value={s}
                        onChange={(e) =>
                          setSeg2Draft((d) => ({
                            ...d,
                            statements: d.statements.map((x, j) =>
                              j === i ? e.target.value : x,
                            ),
                          }))
                        }
                        rows={2}
                        className="w-full px-3 py-2 rounded font-mono text-sm focus:outline-none resize-none"
                        style={{
                          backgroundColor: "#09090b",
                          border: "1px solid #3f3f46",
                          color: "#fafafa",
                        }}
                      />
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => {
                        send(OP.EDIT_SEG2, {
                          playerId: segment2.currentStorytellerId!,
                          statements: seg2Draft.statements.map((s) => s.trim()),
                          lieIndex: seg2Draft.lieIndex,
                        });
                        setEditSeg2(false);
                      }}
                      className="flex-1 py-2 rounded-lg font-mono text-sm font-bold uppercase tracking-widest"
                      style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditSeg2(false)}
                      className="px-4 py-2 rounded-lg font-mono text-sm font-bold"
                      style={{
                        backgroundColor: "#27272a",
                        color: "#a1a1aa",
                        border: "1px solid #3f3f46",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div>
                <p
                  className="font-mono text-sm uppercase tracking-widest mb-4"
                  style={{ color: "#52525b" }}
                >
                  Log Player Votes
                </p>
                <div className="space-y-3">
                  {nonStorytellers.map((player) => (
                    <div key={player.id} className="flex items-center gap-3">
                      <span
                        className="font-mono text-base font-semibold w-28 shrink-0"
                        style={{ color: "#e4e4e7" }}
                      >
                        {player.name}
                      </span>
                      {stmtObj.statements.map((_, i) => {
                        const STMT_PALETTE = [
                          "#fbbf24",
                          "#a78bfa",
                          "#34d399",
                          "#60a5fa",
                          "#f472b6",
                        ];
                        const value = `STATEMENT_${i}`;
                        const color = STMT_PALETTE[i % STMT_PALETTE.length];
                        const selected =
                          segment2.playerVotes[player.id] === value;
                        return (
                          <button
                            key={value}
                            onClick={() =>
                              send(OP.SET_PLAYER_VOTE, {
                                segment: "segment2",
                                playerId: player.id,
                                vote: value,
                              })
                            }
                            className="flex-1 py-2 rounded-lg font-mono text-xs font-bold transition-colors"
                            style={{
                              backgroundColor: selected ? "#1a1a1a" : "#27272a",
                              color: selected ? color : "#71717a",
                              border: `1px solid ${selected ? color : "#3f3f46"}`,
                            }}
                          >
                            {`STMT ${i + 1}`}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right col: timer + vote bars + reveal + points */}
            <div className="space-y-5">
              {renderBanterTimer()}
              <VoteBars counts={counts} />

              {segment2.currentStorytellerId != null && (
                <SegmentPointsInput
                  points={segment2.points ?? 20}
                  onSet={(p) =>
                    send(OP.SET_SEGMENT_POINTS, {
                      segment: "segment2",
                      points: p,
                    })
                  }
                />
              )}

              {/* Statement reveal progress + reveal truth/lie */}
              {!segment2.showResult &&
                (() => {
                  const revealed = segment2.revealedStatements ?? [];
                  const total = stmtObj.statements.length;
                  const allRevealed = revealed.length >= total;
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between px-1">
                        <span
                          className="font-mono text-xs uppercase tracking-widest"
                          style={{ color: "#52525b" }}
                        >
                          Statements shown
                        </span>
                        <span
                          className="font-mono text-sm font-bold"
                          style={{ color: allRevealed ? "#4ade80" : "#f59e0b" }}
                        >
                          {revealed.length} / {total}
                        </span>
                      </div>
                      {allRevealed && (
                        <button
                          onClick={() => {
                            send(OP.REVEAL, { segment: "segment2" });
                            calcSeg2Points();
                          }}
                          className="w-full py-4 rounded-xl font-mono text-base font-bold uppercase tracking-widest transition-colors"
                          style={{
                            backgroundColor: "#f59e0b",
                            color: "#09090b",
                          }}
                        >
                          REVEAL TRUTH / LIE
                        </button>
                      )}
                    </div>
                  );
                })()}

              {seg2Preview && !seg2Awarded && (
                <div
                  className="rounded-xl p-5 space-y-3"
                  style={{
                    backgroundColor: "#0d0d0f",
                    border: "1px solid #78350f",
                  }}
                >
                  <p
                    className="font-mono text-sm font-bold uppercase tracking-widest"
                    style={{ color: "#f59e0b" }}
                  >
                    POINTS BREAKDOWN
                  </p>
                  {seg2Preview.lines.map((line, i) => (
                    <p
                      key={i}
                      className="font-mono text-sm"
                      style={{ color: "#a1a1aa" }}
                    >
                      {line}
                    </p>
                  ))}
                  <p
                    className="font-mono text-sm font-bold"
                    style={{ color: "#fafafa" }}
                  >
                    TOTAL:{" "}
                    {players
                      .map((p) =>
                        seg2Preview.totals[p.id]
                          ? `${p.name} +${seg2Preview.totals[p.id]}`
                          : null,
                      )
                      .filter(Boolean)
                      .join(", ") || "No changes"}
                  </p>
                  <button
                    onClick={awardSeg2Points}
                    className="w-full py-4 rounded-xl font-mono text-base font-bold uppercase tracking-widest transition-colors"
                    style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
                  >
                    CONFIRM &amp; AWARD POINTS
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="pt-4" style={{ borderTop: "1px solid #27272a" }}>
          {allDone ? (
            <button
              onClick={() => send(OP.GOTO_PHASE, { phase: "SEGMENT3" })}
              className="w-full py-4 rounded-xl font-mono text-base font-bold uppercase tracking-widest transition-colors"
              style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
            >
              MOVE TO SEGMENT 3 →
            </button>
          ) : (
            <p className="font-mono text-sm" style={{ color: "#52525b" }}>
              {segment2.completedStorytellers.length} OF {players.length}{" "}
              STORYTELLERS DONE
            </p>
          )}
        </div>
      </div>
    );
  }

  function renderSeg3() {
    if (!gameState) return null;
    const { segment3, players } = gameState;
    const seg3Result = getSeg3Winner();

    const playerVoteCounts: Record<number, number> = Object.fromEntries(
      players.map((p) => [p.id, 0]),
    );
    Object.values(gameState.audienceVotes ?? {}).forEach((v) => {
      if (v.votingRound === "seg3") {
        const id = parseInt(v.choice, 10);
        if (playerVoteCounts[id] !== undefined) playerVoteCounts[id]++;
      }
    });
    const totalVotes = Object.values(playerVoteCounts).reduce(
      (a, b) => a + b,
      0,
    );

    // A manual pick always wins; otherwise fall back to the clear vote leader
    // (a non-tie with at least one vote). Null means the operator hasn't chosen
    // and there's no unambiguous leader yet.
    const voteLeaderId =
      seg3Result && !seg3Result.isTie && totalVotes > 0
        ? (seg3Result.winners[0]?.id ?? null)
        : null;
    const effectiveWinnerId = seg3ManualWinnerId ?? voteLeaderId;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-5 items-start">
          <div
            className="rounded-xl p-5"
            style={{ backgroundColor: "#0d0d0f", border: "1px solid #27272a" }}
          >
            {!editSeg3 ? (
              <>
                {segment3.photoUrl && (
                  <img
                    src={segment3.photoUrl}
                    alt={segment3.photoTitle ?? ""}
                    className="h-36 rounded-lg object-cover w-full"
                  />
                )}
                {segment3.photoTitle && (
                  <p
                    className="font-mono text-base font-bold mt-2"
                    style={{ color: "#e4e4e7" }}
                  >
                    {segment3.photoTitle}
                  </p>
                )}
                <div className="flex items-center justify-between mt-3">
                  <p className="font-mono text-sm" style={{ color: "#4ade80" }}>
                    ● Showing on display screen
                  </p>
                  <button
                    onClick={() => {
                      setSeg3EditPhoto(segment3.photoUrl ?? "");
                      setSeg3EditTitle(segment3.photoTitle ?? "");
                      setEditSeg3(true);
                    }}
                    className="font-mono text-xs font-bold px-2 py-1 rounded transition-colors"
                    style={{
                      backgroundColor: "#1a1a1a",
                      color: "#f59e0b",
                      border: "1px solid #78350f",
                    }}
                  >
                    ✎ EDIT
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p
                  className="font-mono text-xs uppercase tracking-widest"
                  style={{ color: "#f59e0b" }}
                >
                  EDIT OBJECT
                </p>
                {seg3EditPhoto && (
                  <img
                    src={seg3EditPhoto}
                    alt="Object preview"
                    className="h-28 rounded-lg object-cover w-full"
                    style={{ border: "1px solid #3f3f46" }}
                  />
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) loadPhotoAsBase64(f, setSeg3EditPhoto);
                  }}
                  className="w-full font-mono text-xs"
                  style={{ color: "#a1a1aa" }}
                />
                <input
                  type="text"
                  value={seg3EditTitle}
                  onChange={(e) => setSeg3EditTitle(e.target.value)}
                  placeholder="Object name"
                  className="w-full px-3 py-2 rounded font-mono text-sm focus:outline-none"
                  style={{
                    backgroundColor: "#09090b",
                    border: "1px solid #3f3f46",
                    color: "#fafafa",
                  }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      send(OP.EDIT_SEG3, {
                        photoUrl: seg3EditPhoto || null,
                        photoTitle: seg3EditTitle.trim() || null,
                      });
                      setEditSeg3(false);
                    }}
                    className="flex-1 py-2 rounded-lg font-mono text-sm font-bold uppercase tracking-widest"
                    style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditSeg3(false)}
                    className="px-4 py-2 rounded-lg font-mono text-sm font-bold"
                    style={{
                      backgroundColor: "#27272a",
                      color: "#a1a1aa",
                      border: "1px solid #3f3f46",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          <div>
            <p
              className="font-mono text-sm uppercase tracking-widest mb-2"
              style={{ color: "#52525b" }}
            >
              Audience Vote
            </p>
            <p
              className="font-mono text-sm"
              style={{
                color: gameState.segment3.audienceVotingOpen
                  ? "#4ade80"
                  : "#52525b",
              }}
            >
              {gameState.segment3.audienceVotingOpen
                ? "● Voting is live — use right panel to lock"
                : "○ Use right panel to open vote"}
            </p>
          </div>
        </div>

        {renderBanterTimer()}

        {/* Player statements — the live-written claims shown on the display */}
        <div
          className="rounded-xl p-5 space-y-3"
          style={{ backgroundColor: "#0d0d0f", border: "1px solid #27272a" }}
        >
          <p
            className="font-mono text-sm uppercase tracking-widest"
            style={{ color: "#52525b" }}
          >
            Player Statements{" "}
            <span style={{ color: "#3f3f46" }}>— shown live on display</span>
          </p>
          {players.map((player) => {
            const shown = (gameState.segment3.shownStatements ?? []).includes(
              player.id,
            );
            return (
              <div key={player.id} className="flex items-start gap-3">
                {player.photo && (
                  <img
                    src={player.photo}
                    className="w-10 h-10 rounded-full object-cover shrink-0 mt-1"
                    alt=""
                  />
                )}
                <div className="w-24 shrink-0 pt-1 space-y-1">
                  <span
                    className="font-mono text-sm font-semibold block truncate"
                    style={{ color: "#e4e4e7" }}
                  >
                    {player.name}
                  </span>
                  <button
                    onClick={() =>
                      send(OP.TOGGLE_SEG3_STATEMENT, { playerId: player.id })
                    }
                    className="w-full font-mono text-xs font-bold px-2 py-1 rounded transition-colors"
                    style={{
                      backgroundColor: shown ? "#052e16" : "#1a1a1a",
                      color: shown ? "#4ade80" : "#71717a",
                      border: `1px solid ${shown ? "#166534" : "#3f3f46"}`,
                    }}
                  >
                    {shown ? "SHOWN" : "SHOW"}
                  </button>
                </div>
                <textarea
                  defaultValue={
                    gameState.segment3.playerStatements?.[player.id] ?? ""
                  }
                  onBlur={(e) =>
                    send(OP.SET_SEG3_STATEMENT, {
                      playerId: player.id,
                      statement: e.target.value.trim(),
                    })
                  }
                  rows={2}
                  placeholder="Write this player's claim…"
                  className="flex-1 px-3 py-2 rounded font-mono text-sm focus:outline-none resize-none"
                  style={{
                    backgroundColor: "#09090b",
                    border: "1px solid #3f3f46",
                    color: "#fafafa",
                  }}
                />
              </div>
            );
          })}
          <p className="font-mono text-xs" style={{ color: "#3f3f46" }}>
            Saves when you click out of a box.
          </p>
        </div>

        <div
          className="rounded-xl p-5 space-y-4"
          style={{ backgroundColor: "#0d0d0f", border: "1px solid #27272a" }}
        >
          {players.map((player) => {
            const count = playerVoteCounts[player.id] ?? 0;
            const pct =
              totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            return (
              <div key={player.id} className="flex items-center gap-4">
                {player.photo && (
                  <img
                    src={player.photo}
                    className="w-10 h-10 rounded-full object-cover shrink-0"
                    alt=""
                  />
                )}
                <span
                  className="font-mono text-base font-semibold w-28 shrink-0"
                  style={{ color: "#e4e4e7" }}
                >
                  {player.name}
                </span>
                <div
                  className="flex-1 h-4 rounded-full overflow-hidden"
                  style={{ backgroundColor: "#27272a" }}
                >
                  <div
                    className="h-4 rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: "#f59e0b" }}
                  />
                </div>
                <span
                  className="font-mono text-sm font-bold w-24 text-right shrink-0"
                  style={{ color: "#e4e4e7" }}
                >
                  {count} ({pct}%)
                </span>
              </div>
            );
          })}
          <p className="font-mono text-sm" style={{ color: "#52525b" }}>
            TOTAL VOTES: {totalVotes}
          </p>
        </div>

        {!segment3.showResult ? (
          <div
            className="rounded-xl p-5 space-y-4"
            style={{ backgroundColor: "#0d0d0f", border: "1px solid #27272a" }}
          >
            {/* Winner picker is always available — pick the owner and award any
                time, no need to wait for audience votes. When votes exist the
                current leader is pre-selected as a suggestion. */}
            <div>
              <p
                className="font-mono text-sm font-bold uppercase tracking-widest mb-4"
                style={{ color: "#fbbf24" }}
              >
                Select winner:
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${Math.min(players.length, 5)}, minmax(0, 1fr))`,
                  gap: "12px",
                }}
              >
                {players.map((p) => {
                  const selected = effectiveWinnerId === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSeg3ManualWinnerId(p.id)}
                      className="p-4 rounded-xl font-mono text-base font-bold transition-all"
                      style={{
                        border: selected
                          ? "2px solid #f59e0b"
                          : "1px solid #3f3f46",
                        backgroundColor: selected ? "#130f00" : "#18181b",
                        color: selected ? "#f59e0b" : "#a1a1aa",
                      }}
                    >
                      {p.name}
                      <span
                        className="block text-xs mt-1"
                        style={{ color: "#52525b" }}
                      >
                        {playerVoteCounts[p.id]} vote
                        {playerVoteCounts[p.id] === 1 ? "" : "s"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <SegmentPointsInput
              points={segment3.points ?? 50}
              onSet={(p) =>
                send(OP.SET_SEGMENT_POINTS, {
                  segment: "segment3",
                  points: p,
                })
              }
            />

            {effectiveWinnerId ? (
              <button
                onClick={() => awardSeg3Points(effectiveWinnerId)}
                className="w-full py-4 rounded-xl font-mono text-base font-bold uppercase tracking-widest transition-colors"
                style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
              >
                AWARD {segment3.points ?? 50} PTS TO{" "}
                {players
                  .find((p) => p.id === effectiveWinnerId)
                  ?.name?.toUpperCase()}
              </button>
            ) : (
              <p
                className="font-mono text-sm text-center"
                style={{ color: "#52525b" }}
              >
                Select a winner above to award {segment3.points ?? 50} pts
              </p>
            )}
          </div>
        ) : (
          <div
            className="rounded-xl p-5"
            style={{ backgroundColor: "#0d0d0f", border: "1px solid #27272a" }}
          >
            <p className="font-mono text-lg" style={{ color: "#fafafa" }}>
              AWARDED:{" "}
              <span style={{ color: "#f59e0b", fontWeight: 700 }}>
                {players.find((p) => p.id === segment3.winnerId)?.name}
              </span>{" "}
              <span style={{ color: "#52525b" }}>+{segment3.points ?? 50}</span>
            </p>
          </div>
        )}

        <div className="pt-4" style={{ borderTop: "1px solid #27272a" }}>
          <button
            onClick={() => {
              send(OP.GOTO_PHASE, { phase: "FINAL" });
              send(OP.TOGGLE_DISPLAY, {
                key: "showLeaderboardModal",
                value: true,
              });
            }}
            className="w-full py-4 rounded-xl font-mono text-base font-bold uppercase tracking-widest transition-colors"
            style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
          >
            SHOW FINAL SCOREBOARD →
          </button>
        </div>
      </div>
    );
  }

  function renderFinal() {
    const audienceUrl = `${origin}/audience`;
    return (
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <p
            className="font-mono text-sm uppercase tracking-widest"
            style={{ color: "#52525b" }}
          >
            Display Controls
          </p>
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() =>
                send(OP.TOGGLE_DISPLAY, {
                  key: "showLeaderboardModal",
                  value: true,
                })
              }
              className="px-5 py-3 rounded-lg font-mono text-sm font-bold transition-colors"
              style={{ border: "1px solid #3f3f46", color: "#a1a1aa" }}
            >
              SHOW FULL SCOREBOARD
            </button>
            <button
              onClick={() =>
                send(OP.TOGGLE_DISPLAY, {
                  key: "showLeaderboardModal",
                  value: false,
                })
              }
              className="px-5 py-3 rounded-lg font-mono text-sm font-bold transition-colors"
              style={{ border: "1px solid #3f3f46", color: "#a1a1aa" }}
            >
              HIDE SCOREBOARD
            </button>
          </div>
          <p className="font-mono text-xs" style={{ color: "#3f3f46" }}>
            Use the right panel to reset the game.
          </p>
        </div>

        {origin && (
          <div
            className="rounded-xl p-5 text-center"
            style={{ backgroundColor: "#0d0d0f", border: "1px solid #27272a" }}
          >
            <p
              className="font-mono text-xs uppercase tracking-widest mb-3"
              style={{ color: "#52525b" }}
            >
              Audience Voting URL
            </p>
            <p
              className="font-mono text-sm mb-4 break-all"
              style={{ color: "#f59e0b" }}
            >
              {audienceUrl}
            </p>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(audienceUrl)}&bgcolor=0d0d0f&color=f59e0b`}
              alt="QR Code for audience"
              className="mx-auto rounded-lg"
              width={160}
              height={160}
            />
            <p className="font-mono text-sm mt-3" style={{ color: "#52525b" }}>
              Scan to access audience voting
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // Auth gate FIRST: the operator socket only connects after login
  // (useGameState enabled: isAuthenticated), so gameState stays null until then.
  // Checking !gameState before this would deadlock on the loading spinner.
  if (!isAuthenticated) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ backgroundColor: "#09090b" }}
      >
        <div
          className="rounded-lg p-8 max-w-md w-full"
          style={{ backgroundColor: "#18181b", border: "1px solid #3f3f46" }}
        >
          <div className="text-center mb-6">
            <h1
              className="font-mono text-2xl font-bold tracking-widest mb-1"
              style={{ color: "#f59e0b" }}
            >
              LIE HARD
            </h1>
            <p
              className="font-mono text-xs uppercase tracking-widest mb-4"
              style={{ color: "#71717a" }}
            >
              OPERATOR PANEL
            </p>
            <p className="text-sm" style={{ color: "#a1a1aa" }}>
              Enter password to continue
            </p>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label
                className="block text-xs font-mono uppercase tracking-widest mb-2"
                style={{ color: "#71717a" }}
              >
                Password
              </label>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg text-sm focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: "#09090b",
                  border: "1px solid #3f3f46",
                  color: "#fafafa",
                  // @ts-ignore
                  "--tw-ring-color": "#f59e0b",
                }}
                placeholder="Enter operator password"
                autoFocus
                required
              />
            </div>

            {authError && (
              <div
                className="p-3 rounded-lg text-sm"
                style={{ backgroundColor: "#450a0a", color: "#fca5a5" }}
              >
                {authError}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 rounded-lg font-mono font-bold text-sm uppercase tracking-widest transition-colors"
              style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
            >
              Access Operator Panel
            </button>
          </form>

          <p
            className="text-center text-xs font-mono mt-6"
            style={{ color: "#3f3f46" }}
          >
            Authorized personnel only
          </p>
        </div>
      </div>
    );
  }

  // Authenticated but the socket hasn't delivered state yet.
  if (!gameState) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: "#09090b" }}
      >
        <div className="text-center">
          <div
            className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-3"
            style={{ borderColor: "#f59e0b", borderTopColor: "transparent" }}
          />
          <p
            className="font-mono text-xs uppercase tracking-widest"
            style={{ color: "#52525b" }}
          >
            Connecting to server…
          </p>
        </div>
      </div>
    );
  }

  const rawPhase = gameState.phase as string;
  const isValidPhase = (PHASE_ORDER as string[]).includes(rawPhase);
  const currentPhase: GameState["phase"] = isValidPhase
    ? (rawPhase as GameState["phase"])
    : "SETUP";
  const currentPhaseIdx = PHASE_ORDER.indexOf(currentPhase);
  const audienceUrl = `${origin}/audience`;

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "#09090b", color: "#fafafa" }}
    >
      {/* Failover banner — the backup operator is now driving the show */}
      {backupMode && (
        <div
          className="w-full flex items-center justify-center gap-4 px-4 py-2 text-center flex-wrap"
          style={{
            backgroundColor: "#450a0a",
            borderBottom: "1px solid #7f1d1d",
          }}
        >
          <span
            className="font-mono text-sm font-bold"
            style={{ color: "#fca5a5" }}
          >
            ⚠ BACKUP IN CONTROL — the show is running from the backup operator.
            Don&apos;t operate here.
          </span>
          <button
            onClick={() => setAudienceBackupMode(false)}
            className="font-mono text-xs font-bold px-3 py-1 rounded"
            style={{
              backgroundColor: "#1a1a1a",
              color: "#f59e0b",
              border: "1px solid #78350f",
            }}
          >
            TAKE BACK CONTROL
          </button>
        </div>
      )}
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20"
        style={{
          backgroundColor: "#09090b",
          borderBottom: "1px solid #1f1f23",
        }}
      >
        <div className="px-6 lg:px-10 py-3">
          <div className="flex items-center justify-between gap-6">
            <div className="shrink-0">
              <h1
                className="font-mono text-lg font-bold tracking-widest"
                style={{ color: "#f59e0b" }}
              >
                LIE HARD
              </h1>
              <p
                className="font-mono text-xs uppercase tracking-widest"
                style={{ color: "#3f3f46" }}
              >
                OPERATOR PANEL
              </p>
              {!backupMode && (
                <button
                  onClick={() => {
                    if (
                      confirm(
                        "Hand control to the BACKUP operator? The server will stop mirroring and the audience will vote via the backup. Use this if the server is failing.",
                      )
                    )
                      setAudienceBackupMode(true);
                  }}
                  className="mt-2 font-mono text-[11px] font-bold px-2 py-1 rounded"
                  style={{
                    backgroundColor: "#1a1a1a",
                    color: "#a1a1aa",
                    border: "1px solid #3f3f46",
                  }}
                >
                  ⇄ Hand to backup
                </button>
              )}
              {/* Jump to any phase at will (show must be started so segment data is loaded). */}
              {gameState.phase !== "SETUP" && (
                <select
                  value=""
                  onChange={(e) => {
                    const target = e.target.value as GameState["phase"];
                    if (!target || target === currentPhase) return;
                    if (
                      !confirm(
                        `Jump to ${PHASE_LABELS[target]}? The display and phones switch immediately.`,
                      )
                    )
                      return;
                    send(OP.GOTO_PHASE, { phase: target });
                    if (target === "FINAL")
                      send(OP.TOGGLE_DISPLAY, {
                        key: "showLeaderboardModal",
                        value: true,
                      });
                  }}
                  className="mt-2 font-mono text-xs px-2 py-1 rounded cursor-pointer focus:outline-none"
                  style={{
                    backgroundColor: "#18181b",
                    border: "1px solid #f59e0b",
                    color: "#f59e0b",
                  }}
                >
                  <option value="">Jump to phase…</option>
                  {PHASE_ORDER.filter((p) => p !== currentPhase).map((p) => {
                    const total = gameState.players.length;
                    const done =
                      total > 0 &&
                      (p === "SEGMENT1"
                        ? gameState.segment1.completedStorytellers.length ===
                          total
                        : p === "SEGMENT2"
                          ? gameState.segment2.completedStorytellers.length ===
                            total
                          : p === "SEGMENT3"
                            ? gameState.segment3.showResult
                            : false);
                    return (
                      <option
                        key={p}
                        value={p}
                        style={{ color: "#e4e4e7", backgroundColor: "#18181b" }}
                      >
                        {PHASE_LABELS[p]}
                        {done ? " ✓ done" : ""}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>

            {/* Phase stepper */}
            <div className="flex items-center gap-0 overflow-x-auto flex-1 justify-center">
              {PHASE_ORDER.map((phase, i) => {
                const isPast = i < currentPhaseIdx;
                const isCurrent = i === currentPhaseIdx;
                const isFuture = i > currentPhaseIdx;
                return (
                  <div key={phase} className="flex items-center">
                    {isPast ? (
                      <button
                        onClick={() => send(OP.GOTO_PHASE, { phase })}
                        className="font-mono text-sm px-3 py-1 rounded whitespace-nowrap transition-colors"
                        style={{
                          color: "#6b7280",
                          backgroundColor: "transparent",
                          fontWeight: 400,
                        }}
                        onMouseEnter={(e) => {
                          (e.target as HTMLElement).style.color = "#d1d5db";
                          (e.target as HTMLElement).style.backgroundColor =
                            "#1f1f23";
                        }}
                        onMouseLeave={(e) => {
                          (e.target as HTMLElement).style.color = "#6b7280";
                          (e.target as HTMLElement).style.backgroundColor =
                            "transparent";
                        }}
                      >
                        {PHASE_LABELS[phase]}
                      </button>
                    ) : (
                      <span
                        className="font-mono text-sm px-3 py-1 rounded transition-colors whitespace-nowrap"
                        style={{
                          backgroundColor: isCurrent
                            ? "#f59e0b"
                            : "transparent",
                          color: isCurrent ? "#09090b" : "#27272a",
                          fontWeight: isCurrent ? 700 : 400,
                          cursor: isFuture ? "default" : "default",
                        }}
                      >
                        {isCurrent && "▶ "}
                        {PHASE_LABELS[phase]}
                      </span>
                    )}
                    {i < PHASE_ORDER.length - 1 && (
                      <span
                        className="font-mono text-sm mx-1"
                        style={{ color: isPast ? "#374151" : "#1f1f23" }}
                      >
                        —
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Live scores */}
            <div className="flex gap-2 shrink-0">
              {gameState.players.map((p) => (
                <div
                  key={p.id}
                  className="text-center px-4 py-2 rounded-lg"
                  style={{
                    border: "1px solid #27272a",
                    backgroundColor: "#111113",
                  }}
                >
                  <p
                    className="font-mono text-xs leading-none mb-1"
                    style={{ color: "#71717a" }}
                  >
                    {p.name}
                  </p>
                  <p
                    className="font-mono text-xl font-bold leading-none"
                    style={{ color: "#f59e0b" }}
                  >
                    {p.score}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Body: scrollable content + fixed right panel */}
      <div className="flex">
        <main className="flex-1 min-w-0 px-6 lg:px-10 py-6">
          {/* Stale data warning */}
          {!isValidPhase && (
            <div
              className="mb-6 rounded-lg p-4"
              style={{
                backgroundColor: "#1a1200",
                border: "1px solid #854d0e",
              }}
            >
              <p
                className="font-mono text-sm font-bold mb-1"
                style={{ color: "#fbbf24" }}
              >
                OLD GAME DATA DETECTED
              </p>
              <p
                className="font-mono text-sm mb-3"
                style={{ color: "#713f12" }}
              >
                Database has data from a previous version. Initialize to start
                fresh.
              </p>
              <button
                onClick={() => send(OP.RESET_GAME)}
                className="px-5 py-2.5 rounded font-mono text-sm font-bold transition-colors"
                style={{
                  backgroundColor: "#1c0000",
                  color: "#f87171",
                  border: "1px solid #7f1d1d",
                }}
              >
                INITIALIZE FRESH GAME STATE
              </button>
            </div>
          )}

          {/* Fixed player scoring card — visible once game is live */}
          {currentPhase !== "SETUP" && gameState.players.length > 0 && (
            <div
              className="mb-6 rounded-xl p-4"
              style={{
                border: "1px solid #27272a",
                backgroundColor: "#0d0d0f",
              }}
            >
              <p
                className="font-mono text-xs uppercase tracking-widest mb-3"
                style={{ color: "#52525b" }}
              >
                PLAYER SCORES
              </p>
              <div className="flex flex-wrap gap-3">
                {gameState.players.map((player) => (
                  <div
                    key={player.id}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 flex-1 min-w-[180px]"
                    style={{
                      backgroundColor: "#18181b",
                      border: "1px solid #3f3f46",
                    }}
                  >
                    <span
                      className="font-mono text-sm font-semibold flex-1 truncate"
                      style={{ color: "#e4e4e7" }}
                    >
                      {player.name}
                    </span>
                    <span
                      className="font-mono text-xs font-bold shrink-0"
                      style={{ color: "#f59e0b" }}
                    >
                      {player.score}
                    </span>
                    <input
                      type="number"
                      min="1"
                      value={scoreInputs[player.id] ?? ""}
                      onChange={(e) =>
                        setScoreInputs((prev) => ({
                          ...prev,
                          [player.id]: e.target.value,
                        }))
                      }
                      className="w-14 px-2 py-1 rounded font-mono text-xs text-center focus:outline-none"
                      style={{
                        backgroundColor: "#09090b",
                        border: "1px solid #3f3f46",
                        color: "#fafafa",
                      }}
                      placeholder="pts"
                    />
                    <button
                      onClick={() => applyScore(player.id, 1)}
                      className="w-8 h-8 rounded font-mono font-bold text-sm shrink-0"
                      style={{
                        backgroundColor: "#052e16",
                        color: "#4ade80",
                        border: "1px solid #166534",
                      }}
                    >
                      +
                    </button>
                    <button
                      onClick={() => applyScore(player.id, -1)}
                      className="w-8 h-8 rounded font-mono font-bold text-sm shrink-0"
                      style={{
                        backgroundColor: "#450a0a",
                        color: "#f87171",
                        border: "1px solid #7f1d1d",
                      }}
                    >
                      −
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Phase sections */}
          <SectionCard
            id="SETUP"
            title="SETUP"
            currentPhase={currentPhase}
            render={renderSetup}
          />
          <SectionCard
            id="WARMUP"
            title="WARMUP ROUND"
            currentPhase={currentPhase}
            render={renderWarmup}
          />
          <SectionCard
            id="SEGMENT1"
            title="SEGMENT 1 — TRUTH OR LIE"
            currentPhase={currentPhase}
            render={renderSeg1}
          />
          <SectionCard
            id="SEGMENT2"
            title="SEGMENT 2 — TWO STATEMENTS"
            currentPhase={currentPhase}
            render={renderSeg2}
          />
          <SectionCard
            id="SEGMENT3"
            title="SEGMENT 3 — WHO OWNS IT?"
            currentPhase={currentPhase}
            render={renderSeg3}
          />
          <SectionCard
            id="FINAL"
            title="FINAL"
            currentPhase={currentPhase}
            render={renderFinal}
          />
        </main>

        {/* Fixed right panel */}
        {renderRightPanel()}
      </div>
    </div>
  );
}
