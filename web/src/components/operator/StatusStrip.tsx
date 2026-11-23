"use client";

import { useEffect, useRef, useState } from "react";
import { OP, type Ack } from "@/lib/realtime";

/** What op:status returns (server/src/socket/handlers/operator.ts). */
interface ServerStatus {
  serverTime: number;
  online: { operators: number; displays: number; phones: number };
  votingRound: string | null;
  votesNow: number;
  voters: number;
  worstStallMs: number;
  memoryMb: number;
  snapshots: string;
  savedAgoMs: number | null;
  uptimeS: number;
}

type Tone = "good" | "warn" | "bad" | "plain";

const TONE: Record<Tone, { bg: string; border: string; color: string }> = {
  good: { bg: "#052e16", border: "#166534", color: "#86efac" },
  warn: { bg: "#1a1200", border: "#854d0e", color: "#fbbf24" },
  bad: { bg: "#450a0a", border: "#b91c1c", color: "#fca5a5" },
  plain: { bg: "#111113", border: "#27272a", color: "#d4d4d8" },
};

function Chip({
  tone,
  label,
  value,
  title,
}: {
  tone: Tone;
  label: string;
  value: string;
  title?: string;
}) {
  const t = TONE[tone];
  return (
    <div
      className="flex items-baseline gap-1.5 px-2.5 py-1 rounded font-mono text-xs whitespace-nowrap"
      style={{
        backgroundColor: t.bg,
        border: `1px solid ${t.border}`,
        color: t.color,
      }}
      title={title}
    >
      <span className="uppercase tracking-widest opacity-70">{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );
}

const POLL_MS = 2000;

function ago(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

function uptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/**
 * Show-day health at a glance: server link, big screen, phones, votes, server
 * load and the Redis backup. Asks the server every two seconds while connected.
 */
export default function StatusStrip({
  connected,
  emit,
}: {
  connected: boolean;
  emit: (event: string, payload?: unknown) => Promise<Ack>;
}) {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);

  useEffect(() => {
    if (!connected) return;
    let alive = true;
    const poll = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      const started = performance.now();
      const ack = await emit(OP.STATUS);
      inFlight.current = false;
      if (!alive) return;
      setNow(Date.now());
      if (ack.ok && ack.status) {
        setStatus(ack.status as ServerStatus);
        setRttMs(Math.round(performance.now() - started));
        setLastOkAt(Date.now());
      }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [connected, emit]);

  // Keep "x seconds ago" honest when polls stop coming back.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const stale = lastOkAt === null || now - lastOkAt > 8000;
  const chips: React.ReactNode[] = [];

  if (!connected) {
    chips.push(
      <Chip key="srv" tone="bad" label="Server" value="Reconnecting…" />,
    );
  } else if (stale) {
    chips.push(
      <Chip
        key="srv"
        tone="bad"
        label="Server"
        value="Not answering"
        title="Connected, but status requests aren't coming back"
      />,
    );
  } else {
    const slow = (rttMs ?? 0) > 400;
    chips.push(
      <Chip
        key="srv"
        tone={slow ? "warn" : "good"}
        label="Server"
        value={`Connected · ${rttMs} ms`}
        title={`Round trip from this laptop. Up ${uptime(status?.uptimeS ?? 0)}`}
      />,
    );
  }

  if (status && !stale) {
    const s = status;
    chips.push(
      <Chip
        key="screen"
        tone={s.online.displays > 0 ? "good" : "bad"}
        label="Big screen"
        value={
          s.online.displays > 0
            ? `${s.online.displays} connected`
            : "Not connected"
        }
      />,
    );
    if (s.online.operators > 1)
      chips.push(
        <Chip
          key="ops"
          tone="warn"
          label="Operators"
          value={`${s.online.operators} open`}
          title="More than one operator panel is open — both can change the show"
        />,
      );
    chips.push(
      <Chip
        key="phones"
        tone="plain"
        label="Phones"
        value={`${s.online.phones} online · ${s.voters} voted`}
        title="Online = phones with the audience page open right now. Voted = voted at least once this show."
      />,
    );
    if (s.votingRound)
      chips.push(
        <Chip
          key="votes"
          tone="plain"
          label="Votes"
          value={`${s.votesNow}`}
          title="Audience votes in the round that's open now"
        />,
      );

    const load = s.worstStallMs;
    chips.push(
      <Chip
        key="load"
        tone={load < 100 ? "good" : load < 300 ? "warn" : "bad"}
        label="Server load"
        value={
          load < 100
            ? `OK · ${load} ms`
            : load < 300
              ? `Busy · ${load} ms`
              : `Overloaded · ${load} ms`
        }
        title={`Longest wait for the server in the last 10 seconds. Memory ${s.memoryMb} MB.`}
      />,
    );

    if (s.snapshots === "disabled") {
      chips.push(
        <Chip
          key="backup"
          tone="warn"
          label="Backup"
          value="Off"
          title="No Redis: a server restart would lose the show"
        />,
      );
    } else if (s.snapshots !== "connected") {
      chips.push(
        <Chip
          key="backup"
          tone="bad"
          label="Backup"
          value={s.snapshots === "connecting" ? "Reconnecting" : "Down"}
          title="Redis is unreachable: a server restart now would lose recent changes"
        />,
      );
    } else {
      chips.push(
        <Chip
          key="backup"
          tone="good"
          label="Backup"
          value={
            s.savedAgoMs === null ? "Ready" : `Saved ${ago(s.savedAgoMs)}`
          }
          title="Saved to Redis; survives a server restart"
        />,
      );
    }
  }

  return <div className="flex flex-wrap items-center gap-2">{chips}</div>;
}
