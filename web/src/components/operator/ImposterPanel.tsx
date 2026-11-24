"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { OP } from "@/lib/realtime";

/**
 * Imposter round: crowd members, one with an empty box. The panel and the
 * audience vote for who they think it is. Playable at any point in the show.
 */

export interface ImposterContestant {
  id: number;
  name: string;
}

export interface ImposterState {
  title: string;
  contestants: ImposterContestant[];
  statements: { [contestantId: number]: string };
  shownStatements: number[];
  imposterId: number | null;
  playerVotes: { [playerId: number]: number | null };
  audienceVotingOpen: boolean;
  showResult: boolean;
  awarded: boolean;
  points: number;
}

export const IMPOSTER_DEFAULT_TITLE = "Imposter Round";
export const IMPOSTER_DEFAULT_CONTESTANTS: ImposterContestant[] = [
  1, 2, 3, 4,
].map((id) => ({ id, name: `Person ${id}` }));
const MIN_CONTESTANTS = 2;
const MAX_CONTESTANTS = 8;

const inputStyle = {
  backgroundColor: "#09090b",
  border: "1px solid #3f3f46",
  color: "#fafafa",
};
const card = { backgroundColor: "#0d0d0f", border: "1px solid #27272a" };
const label = "font-mono text-sm uppercase tracking-widest";

/** Title + crowd names, used in setup and for live edits. */
export function ImposterNamesEditor({
  title,
  contestants,
  onChange,
}: {
  title: string;
  contestants: ImposterContestant[];
  onChange: (title: string, contestants: ImposterContestant[]) => void;
}) {
  const setName = (id: number, name: string) =>
    onChange(
      title,
      contestants.map((c) => (c.id === id ? { ...c, name } : c)),
    );
  const add = () => {
    const id = Math.max(0, ...contestants.map((c) => c.id)) + 1;
    onChange(title, [...contestants, { id, name: `Person ${id}` }]);
  };
  const remove = (id: number) =>
    onChange(
      title,
      contestants.filter((c) => c.id !== id),
    );
  return (
    <div className="space-y-3">
      <input
        type="text"
        value={title}
        onChange={(e) => onChange(e.target.value, contestants)}
        placeholder={IMPOSTER_DEFAULT_TITLE}
        maxLength={120}
        className="w-full px-3 py-2 rounded font-mono text-sm focus:outline-none"
        style={inputStyle}
      />
      {contestants.map((c, i) => (
        <div key={c.id} className="flex items-center gap-2">
          <span
            className="font-mono text-sm w-6 shrink-0"
            style={{ color: "#52525b" }}
          >
            {i + 1}
          </span>
          <input
            type="text"
            value={c.name}
            onChange={(e) => setName(c.id, e.target.value)}
            placeholder={`Person ${i + 1}`}
            maxLength={80}
            className="flex-1 px-3 py-2 rounded font-mono text-sm focus:outline-none"
            style={inputStyle}
          />
          {contestants.length > MIN_CONTESTANTS && (
            <button
              onClick={() => remove(c.id)}
              className="w-8 h-8 rounded font-mono font-bold text-sm shrink-0"
              style={{
                backgroundColor: "#1a1a1a",
                color: "#f87171",
                border: "1px solid #7f1d1d",
              }}
              title="Remove"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {contestants.length < MAX_CONTESTANTS && (
        <button
          onClick={add}
          className="font-mono text-xs font-bold px-3 py-1.5 rounded"
          style={{
            backgroundColor: "#1a1a1a",
            color: "#a1a1aa",
            border: "1px solid #3f3f46",
          }}
        >
          + Add person
        </button>
      )}
    </div>
  );
}

/** Blank names fall back to "Person N" so the server always gets a name. */
export function cleanContestants(
  contestants: ImposterContestant[],
): ImposterContestant[] {
  return contestants.map((c, i) => ({
    id: c.id,
    name: c.name.trim() || `Person ${i + 1}`,
  }));
}

/** Statement box that keeps what the operator is typing over server echoes. */
function StatementBox({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        if (text.trim() !== value) onSave(text.trim());
      }}
      rows={2}
      placeholder="Type their statement…"
      className="flex-1 px-3 py-2 rounded font-mono text-sm focus:outline-none resize-none"
      style={inputStyle}
    />
  );
}

export default function ImposterPanel({
  imposter,
  players,
  audienceVotes,
  send,
  timer,
  pointsInput,
  onNext,
}: {
  imposter: ImposterState;
  players: { id: number; name: string }[];
  audienceVotes: { [uid: string]: { choice: string; votingRound: string } };
  send: (event: string, payload?: unknown) => void;
  timer: ReactNode;
  pointsInput: ReactNode;
  onNext: () => void;
}) {
  const im = imposter;
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draft, setDraft] = useState<ImposterContestant[]>([]);

  const nameOf = (id: number | null | undefined) =>
    im.contestants.find((c) => c.id === id)?.name ?? "";

  const counts: Record<number, number> = Object.fromEntries(
    im.contestants.map((c) => [c.id, 0]),
  );
  for (const v of Object.values(audienceVotes ?? {})) {
    if (v.votingRound !== "imposter") continue;
    const id = Number(v.choice);
    if (counts[id] !== undefined) counts[id]++;
  }
  const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);

  const correctPanel = players.filter(
    (p) => im.imposterId != null && im.playerVotes?.[p.id] === im.imposterId,
  );

  return (
    <div className="space-y-4">
      {/* Title + names */}
      <div className="rounded-xl p-5 space-y-3" style={card}>
        {!editing ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <p
                className="font-mono text-lg font-bold"
                style={{ color: "#f59e0b" }}
              >
                {im.title}
              </p>
              <button
                onClick={() => {
                  setDraftTitle(im.title);
                  setDraft(im.contestants);
                  setEditing(true);
                }}
                className="font-mono text-xs font-bold px-2 py-1 rounded"
                style={{
                  backgroundColor: "#1a1a1a",
                  color: "#f59e0b",
                  border: "1px solid #78350f",
                }}
              >
                ✎ EDIT NAMES
              </button>
            </div>
            <p className="font-mono text-sm" style={{ color: "#a1a1aa" }}>
              {im.contestants.map((c) => c.name).join(" · ")}
            </p>
          </>
        ) : (
          <>
            <p className={label} style={{ color: "#f59e0b" }}>
              Edit round
            </p>
            <ImposterNamesEditor
              title={draftTitle}
              contestants={draft}
              onChange={(t, cs) => {
                setDraftTitle(t);
                setDraft(cs);
              }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  send(OP.IMPOSTER_SETUP, {
                    title: draftTitle.trim(),
                    contestants: cleanContestants(draft),
                  });
                  setEditing(false);
                }}
                className="flex-1 py-2 rounded-lg font-mono text-sm font-bold uppercase tracking-widest"
                style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
              >
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
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
          </>
        )}
      </div>

      {/* The answer — set now or at the reveal */}
      <div className="rounded-xl p-5 space-y-3" style={card}>
        <p className={label} style={{ color: "#52525b" }}>
          Who has the empty box?{" "}
          <span style={{ color: "#3f3f46" }}>
            — {im.imposterId != null ? "phones can't see this" : "not set yet"}
          </span>
        </p>
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${Math.min(im.contestants.length, 4)}, minmax(0, 1fr))`,
          }}
        >
          {im.contestants.map((c) => {
            const selected = im.imposterId === c.id;
            return (
              <button
                key={c.id}
                onClick={() => {
                  if (selected) {
                    // Clearing is only possible before the reveal.
                    if (!im.showResult)
                      send(OP.IMPOSTER_SET, { imposterId: null });
                    return;
                  }
                  if (
                    im.showResult &&
                    !confirm(
                      `Change the imposter to ${c.name}? Audience${im.awarded ? " and panel" : ""} scores will be recalculated.`,
                    )
                  )
                    return;
                  send(OP.IMPOSTER_SET, { imposterId: c.id });
                }}
                className="py-3 rounded-lg font-mono text-sm font-bold transition-colors"
                style={{
                  backgroundColor: selected ? "#450a0a" : "#18181b",
                  color: selected ? "#f87171" : "#a1a1aa",
                  border: `1px solid ${selected ? "#b91c1c" : "#3f3f46"}`,
                }}
              >
                {selected ? "🕵 " : ""}
                {c.name}
              </button>
            );
          })}
        </div>
      </div>

      {timer}

      {/* Statements shown live on the display */}
      <div className="rounded-xl p-5 space-y-3" style={card}>
        <p className={label} style={{ color: "#52525b" }}>
          Statements{" "}
          <span style={{ color: "#3f3f46" }}>— shown live on display</span>
        </p>
        {im.contestants.map((c) => {
          const shown = im.shownStatements.includes(c.id);
          return (
            <div key={c.id} className="flex items-start gap-3">
              <div className="w-28 shrink-0 pt-1 space-y-1">
                <span
                  className="font-mono text-sm font-semibold block truncate"
                  style={{ color: "#e4e4e7" }}
                >
                  {c.name}
                </span>
                <button
                  onClick={() =>
                    send(OP.IMPOSTER_TOGGLE_STATEMENT, { contestantId: c.id })
                  }
                  className="w-full font-mono text-xs font-bold px-2 py-1 rounded"
                  style={{
                    backgroundColor: shown ? "#052e16" : "#1a1a1a",
                    color: shown ? "#4ade80" : "#71717a",
                    border: `1px solid ${shown ? "#166534" : "#3f3f46"}`,
                  }}
                >
                  {shown ? "SHOWN" : "SHOW"}
                </button>
              </div>
              <StatementBox
                value={im.statements?.[c.id] ?? ""}
                onSave={(statement) =>
                  send(OP.IMPOSTER_STATEMENT, {
                    contestantId: c.id,
                    statement,
                  })
                }
              />
            </div>
          );
        })}
        <p className="font-mono text-xs" style={{ color: "#3f3f46" }}>
          Saves when you click out of a box.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-5 items-start">
        {/* Panel picks */}
        <div className="rounded-xl p-5 space-y-3" style={card}>
          <p className={label} style={{ color: "#52525b" }}>
            Panel picks
          </p>
          {players.map((p) => (
            <div key={p.id} className="space-y-1.5">
              <span
                className="font-mono text-sm font-semibold"
                style={{ color: "#e4e4e7" }}
              >
                {p.name}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {im.contestants.map((c) => {
                  const selected = im.playerVotes?.[p.id] === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() =>
                        send(OP.IMPOSTER_PICK, {
                          playerId: p.id,
                          contestantId: selected ? null : c.id,
                        })
                      }
                      className="px-3 py-2 rounded font-mono text-xs font-bold"
                      style={{
                        backgroundColor: selected ? "#130f00" : "#18181b",
                        color: selected ? "#f59e0b" : "#71717a",
                        border: `1px solid ${selected ? "#f59e0b" : "#3f3f46"}`,
                      }}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Audience votes */}
        <div className="rounded-xl p-5 space-y-3" style={card}>
          <p className={label} style={{ color: "#52525b" }}>
            Audience vote{" "}
            <span
              style={{ color: im.audienceVotingOpen ? "#4ade80" : "#3f3f46" }}
            >
              {im.audienceVotingOpen ? "● live" : "○ right panel to open"}
            </span>
          </p>
          {im.contestants.map((c) => {
            const n = counts[c.id] ?? 0;
            const pct = totalVotes ? Math.round((n / totalVotes) * 100) : 0;
            return (
              <div key={c.id} className="flex items-center gap-3">
                <span
                  className="font-mono text-sm w-24 shrink-0 truncate"
                  style={{ color: "#e4e4e7" }}
                >
                  {c.name}
                </span>
                <div
                  className="flex-1 h-3 rounded-full overflow-hidden"
                  style={{ backgroundColor: "#27272a" }}
                >
                  <div
                    className="h-3 rounded-full transition-all duration-700"
                    style={{
                      width: `${pct}%`,
                      backgroundColor:
                        im.showResult && c.id === im.imposterId
                          ? "#f87171"
                          : "#f59e0b",
                    }}
                  />
                </div>
                <span
                  className="font-mono text-xs w-16 text-right shrink-0"
                  style={{ color: "#a1a1aa" }}
                >
                  {n} ({pct}%)
                </span>
              </div>
            );
          })}
          <p className="font-mono text-xs" style={{ color: "#52525b" }}>
            TOTAL VOTES: {totalVotes}
          </p>
        </div>
      </div>

      {/* Points, reveal, award */}
      <div className="rounded-xl p-5 space-y-4" style={card}>
        {pointsInput}
        {!im.showResult && (
          <button
            disabled={im.imposterId == null}
            onClick={() => send(OP.REVEAL, { segment: "imposter" })}
            className="w-full py-4 rounded-xl font-mono text-base font-bold uppercase tracking-widest disabled:opacity-40"
            style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
          >
            {im.imposterId == null
              ? "SET THE IMPOSTER ABOVE TO REVEAL"
              : `REVEAL: ${nameOf(im.imposterId).toUpperCase()} IS THE IMPOSTER`}
          </button>
        )}
        {im.imposterId != null && !im.awarded && (
          <button
            onClick={() => send(OP.AWARD_IMPOSTER)}
            className="w-full py-4 rounded-xl font-mono text-base font-bold uppercase tracking-widest"
            style={
              im.showResult
                ? { backgroundColor: "#f59e0b", color: "#09090b" }
                : {
                    backgroundColor: "#1a1a1a",
                    color: "#f59e0b",
                    border: "1px solid #78350f",
                  }
            }
          >
            {correctPanel.length
              ? `AWARD ${im.points} PTS TO ${correctPanel.map((p) => p.name.toUpperCase()).join(", ")}`
              : "NO PANELIST SPOTTED THEM — CLOSE ROUND"}
            {!im.showResult ? " (ALSO REVEALS)" : ""}
          </button>
        )}
        {im.awarded && (
          <p className="font-mono text-sm" style={{ color: "#fafafa" }}>
            AWARDED:{" "}
            <span style={{ color: "#f59e0b", fontWeight: 700 }}>
              {correctPanel.length
                ? correctPanel.map((p) => p.name).join(", ")
                : "nobody"}
            </span>{" "}
            <span style={{ color: "#52525b" }}>
              +{im.points} each · changing the imposter or a pick re-scores
            </span>
          </p>
        )}
      </div>

      <div className="pt-4" style={{ borderTop: "1px solid #27272a" }}>
        <button
          onClick={onNext}
          className="w-full py-4 rounded-xl font-mono text-base font-bold uppercase tracking-widest"
          style={{ backgroundColor: "#f59e0b", color: "#09090b" }}
        >
          MOVE TO SEGMENT 2 →
        </button>
      </div>
    </div>
  );
}
