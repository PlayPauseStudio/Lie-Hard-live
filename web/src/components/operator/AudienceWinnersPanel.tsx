"use client";

import { useState } from "react";
import { OP } from "@/lib/realtime";
import {
  PRIZE_ORDER,
  PRIZE_ROUNDS,
  PRIZE_TITLE,
  secs,
  type PrizeBoards,
  type PrizeKey,
  type PrizeRow,
  type PrizeState,
} from "@/lib/prizes";

/**
 * Operator view of the three audience prizes. The big screen only ever shows
 * the official order (correct, then fastest); the other sorts are here so the
 * team can use the data however they need.
 */

type View = "official" | "speedPoints" | "average" | "perRound";

const VIEWS: { key: View; label: string; explain: string }[] = [
  {
    key: "official",
    label: "Correct + fastest",
    explain:
      "What the big screen uses. Most correct answers first; a tie goes to whoever took the least total time on their correct answers.",
  },
  {
    key: "speedPoints",
    label: "Speed points",
    explain:
      "Each correct answer is worth 500, plus up to 500 more for answering quickly (full bonus at 0s, none after 30s). Rewards speed more than a tie-break does.",
  },
  {
    key: "average",
    label: "Average time",
    explain:
      "Fastest average time per correct answer, whatever the number correct. Someone with 1 very quick answer can top this.",
  },
  {
    key: "perRound",
    label: "Fastest per round",
    explain:
      "The 3 quickest correct answers in each round of this prize. Handy for a one-off 'fastest finger' shout-out.",
  },
];

const STATUS_TEXT = (r: PrizeRow) =>
  r.status === "skipped"
    ? "Skipped"
    : r.status === "won-earlier"
      ? `Won ${PRIZE_TITLE[r.wonIn!].replace(" Audience Winners", "")}`
      : "";

function Explain({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[11px] leading-snug mt-1" style={{ color: "#71717a" }}>
      {children}
    </p>
  );
}

export default function AudienceWinnersPanel({
  prizes,
  boards,
  showing,
  send,
  onClose,
}: {
  prizes: PrizeState;
  boards: PrizeBoards | null;
  /** The podium overlay is on the big screen. */
  showing: boolean;
  send: (event: string, payload?: unknown) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<PrizeKey>(prizes.shown ?? "round1");
  const [view, setView] = useState<View>("official");
  const board = boards?.[tab];
  const setting = prizes.settings[tab];
  const onScreen = showing && prizes.shown === tab;
  const isFirst = tab === PRIZE_ORDER[0];

  const rows: PrizeRow[] =
    view === "speedPoints"
      ? (board?.bySpeedPoints ?? [])
      : view === "average"
        ? (board?.byAverage ?? [])
        : (board?.official ?? []);

  const btn = (active: boolean, danger = false): React.CSSProperties => ({
    border: `1px solid ${danger ? "#7f1d1d" : active ? "#f59e0b" : "#3f3f46"}`,
    backgroundColor: active ? "rgba(245,158,11,0.15)" : "transparent",
    color: danger ? "#f87171" : active ? "#f59e0b" : "#d4d4d8",
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
      style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl my-8 rounded-xl"
        style={{ backgroundColor: "#0b0b0d", border: "2px solid #f59e0b" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + prize tabs */}
        <div
          className="flex items-center justify-between px-6 py-3"
          style={{ backgroundColor: "#130f00" }}
        >
          <span className="font-mono text-sm font-bold uppercase tracking-widest" style={{ color: "#f59e0b" }}>
            🏆 Audience winners
          </span>
          <button onClick={onClose} className="font-mono text-sm px-3 py-1 rounded-lg" style={btn(false)}>
            Close ✕
          </button>
        </div>
        <div className="flex gap-2 px-6 pt-4">
          {PRIZE_ORDER.map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="flex-1 rounded-lg px-3 py-2 font-mono text-xs font-bold uppercase tracking-wide"
              style={btn(tab === k)}
            >
              {PRIZE_TITLE[k]}
              {showing && prizes.shown === k && <span style={{ color: "#4ade80" }}> ● ON SCREEN</span>}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-5">
          <p className="font-mono text-xs" style={{ color: "#a1a1aa" }}>
            Counts: {PRIZE_ROUNDS[tab]} · {board?.rounds ?? 0} round{board?.rounds === 1 ? "" : "s"} revealed so far
            · {board?.people ?? 0} people with at least one correct answer
          </p>

          {/* Podium preview */}
          <div className="rounded-lg p-4" style={{ backgroundColor: "#0d0d0f", border: "1px solid #27272a" }}>
            <p className="font-mono text-xs uppercase tracking-widest mb-2" style={{ color: "#52525b" }}>
              Podium on the big screen {board?.confirmed && <span style={{ color: "#4ade80" }}>· confirmed</span>}
            </p>
            {board && board.winners.length > 0 ? (
              <div className="flex gap-6">
                {board.winners.map((w, i) => (
                  <span key={w.uid} className="font-mono text-base" style={{ color: "#e4e4e7" }}>
                    {["🥇", "🥈", "🥉"][i]} <b>{w.name}</b>{" "}
                    <span style={{ color: "#71717a" }}>{w.correct} ✓</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="font-mono text-sm" style={{ color: "#3f3f46" }}>
                Nobody yet — winners appear once a round of {PRIZE_ROUNDS[tab]} is revealed.
              </p>
            )}
          </div>

          {/* Controls, each with a one-line explainer */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <button
                onClick={() => send(OP.SHOW_PRIZE, { prize: onScreen ? null : tab })}
                className="w-full rounded-lg px-3 py-2 font-mono text-xs font-bold uppercase"
                style={onScreen ? { ...btn(true), color: "#4ade80", borderColor: "#4ade80" } : btn(false)}
              >
                {onScreen ? "● On big screen — hide" : "Show on big screen"}
              </button>
              <Explain>
                Puts this prize&apos;s top 3 on the big screen podium with the heading
                &ldquo;{PRIZE_TITLE[tab]}&rdquo;. No times or sorting are shown there.
              </Explain>
            </div>
            <div>
              <button
                disabled={isFirst}
                onClick={() => send(OP.PRIZE_SETTING, { prize: tab, skipEarlier: !setting.skipEarlier })}
                className="w-full rounded-lg px-3 py-2 font-mono text-xs font-bold uppercase disabled:opacity-40"
                style={btn(setting.skipEarlier)}
              >
                {setting.skipEarlier ? "Skip earlier winners" : "Allow repeat winners"}
              </button>
              <Explain>
                {isFirst
                  ? "Round 1 is the first prize, so there are no earlier winners to skip."
                  : setting.skipEarlier
                    ? "Anyone on an earlier prize's podium is passed over here and the next person moves up. Tap to allow repeats."
                    : "The same person can win this prize and an earlier one. Tap to pass over earlier winners instead."}
              </Explain>
            </div>
            <div>
              <button
                disabled={!board?.confirmed && !board?.winners.length}
                onClick={() => send(OP.PRIZE_CONFIRM, { prize: tab, confirm: !board?.confirmed })}
                className="w-full rounded-lg px-3 py-2 font-mono text-xs font-bold uppercase disabled:opacity-40"
                style={btn(!!board?.confirmed)}
              >
                {board?.confirmed ? "✓ Confirmed — unlock" : "Confirm winners (optional)"}
              </button>
              <Explain>
                {board?.confirmed
                  ? "This podium is frozen. Unlock to let it follow the live ranking again."
                  : "Not required. Freezes this top 3 so later rounds, skips or the repeat setting can't change who already won."}
              </Explain>
            </div>
          </div>

          {/* Sort views */}
          <div>
            <div className="flex gap-2">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  className="rounded-lg px-3 py-1.5 font-mono text-xs font-bold"
                  style={btn(view === v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <Explain>{VIEWS.find((v) => v.key === view)!.explain}</Explain>
          </div>

          {view === "perRound" ? (
            <div className="space-y-3">
              {(board?.fastestPerRound ?? []).length === 0 && (
                <p className="font-mono text-sm" style={{ color: "#3f3f46" }}>No rounds revealed yet.</p>
              )}
              {(board?.fastestPerRound ?? []).map((f) => (
                <div key={f.round} className="rounded-lg p-3" style={{ backgroundColor: "#0d0d0f", border: "1px solid #27272a" }}>
                  <p className="font-mono text-xs font-bold mb-1" style={{ color: "#f59e0b" }}>{f.label}</p>
                  {f.rows.length === 0 ? (
                    <p className="font-mono text-xs" style={{ color: "#52525b" }}>Nobody got it right.</p>
                  ) : (
                    <div className="flex gap-6">
                      {f.rows.map((r, i) => (
                        <span key={r.uid} className="font-mono text-sm" style={{ color: "#e4e4e7" }}>
                          {i + 1}. {r.name} <span style={{ color: "#71717a" }}>{secs(r.ms)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div>
              <table className="w-full font-mono text-sm">
                <thead>
                  <tr style={{ color: "#71717a" }} className="text-left text-xs uppercase">
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-2">Name</th>
                    <th className="py-2 pr-2 text-right">Correct</th>
                    <th className="py-2 pr-2 text-right">Total time</th>
                    <th className="py-2 pr-2 text-right">Avg time</th>
                    <th className="py-2 pr-2 text-right">Speed pts</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 text-right">Skip</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-4" style={{ color: "#3f3f46" }}>
                        No correct answers yet.
                      </td>
                    </tr>
                  )}
                  {rows.map((r, i) => {
                    const out = r.status !== "ok";
                    const skipped = r.status === "skipped";
                    return (
                      <tr
                        key={r.uid}
                        style={{ borderTop: "1px solid #1f1f23", color: out ? "#52525b" : "#e4e4e7" }}
                      >
                        <td className="py-1.5 pr-2">{view === "official" ? (r.rank ?? "–") : i + 1}</td>
                        <td className="py-1.5 pr-2 font-bold" style={{ textDecoration: skipped ? "line-through" : undefined }}>
                          {r.name}
                        </td>
                        <td className="py-1.5 pr-2 text-right">
                          {r.correct}/{board?.rounds ?? 0}
                        </td>
                        <td className="py-1.5 pr-2 text-right">{secs(r.totalMs)}</td>
                        <td className="py-1.5 pr-2 text-right">{secs(r.avgMs)}</td>
                        <td className="py-1.5 pr-2 text-right">{r.speedPoints}</td>
                        <td className="py-1.5 pr-2 text-xs" style={{ color: skipped ? "#f87171" : "#fbbf24" }}>
                          {STATUS_TEXT(r)}
                        </td>
                        <td className="py-1.5 text-right">
                          <button
                            onClick={() => send(OP.PRIZE_SKIP, { prize: tab, uid: r.uid, skip: !skipped })}
                            className="rounded px-2 py-0.5 text-xs"
                            style={btn(false, !skipped)}
                          >
                            {skipped ? "Undo" : "Skip"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Explain>
                Top 10. <b>Skip</b> passes over someone for this prize only (not in the venue, can&apos;t be
                reached, …) and the next person moves up; <b>Undo</b> brings them back. Greyed rows are
                passed over and don&apos;t take a podium spot.
              </Explain>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
