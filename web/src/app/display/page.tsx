'use client';

import { useState, useEffect, useRef } from 'react';
import { useGameState } from '@/lib/useGameState';

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
  phase: 'SETUP' | 'WARMUP' | 'SEGMENT1' | 'SEGMENT2' | 'SEGMENT3' | 'FINAL';
  players: Player[];
  showScoreboard: boolean;
  showLeaderboardModal: boolean;
  showTopVoters: boolean;
  showScorePopup: boolean;
  showVoteBars: boolean;
  showLogo?: boolean;
  scorePopupDeltas: { name: string; delta: number }[];
  voterScores: { [uid: string]: { name: string; correctCount: number } };
  banterTimer: {
    totalSeconds: number;
    startedAt: number | null;
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
    playerVotes: { [playerId: number]: 'TRUTH' | 'LIE' | null };
    audienceVotingOpen: boolean;
    showResult: boolean;
    completedStorytellers: number[];
  };
  segment2: {
    statements: Segment2Statement[];
    currentStorytellerId: number | null;
    playerVotes: { [playerId: number]: string | null };
    audienceVotingOpen: boolean;
    showResult: boolean;
    completedStorytellers: number[];
    revealedStatements: number[];
  };
  segment3: {
    photoUrl: string | null;
    photoTitle: string | null;
    audienceVotingOpen: boolean;
    showResult: boolean;
    winnerId: number | null;
  };
  audienceVotes: {
    [deviceId: string]: {
      choice: string;
      votingRound: string;
    };
  };
}

// ── Vote count helper ──────────────────────────────────────────────────────

function getVoteCounts(
  audienceVotes: GameState['audienceVotes'],
  votingRound: string,
  options: string[]
): Record<string, number> {
  const counts = Object.fromEntries(options.map((o) => [o, 0]));
  Object.values(audienceVotes ?? {}).forEach((v) => {
    if (v.votingRound === votingRound && counts[v.choice] !== undefined) {
      counts[v.choice]++;
    }
  });
  return counts;
}

// ── Vote bars ──────────────────────────────────────────────────────────────

function VoteBars({
  counts,
  labels,
  hideFooter,
}: {
  counts: Record<string, number>;
  labels?: Record<string, string>;
  hideFooter?: boolean;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const STATEMENT_PALETTE = ['#fbbf24', '#a78bfa', '#34d399', '#60a5fa', '#f472b6'];
  const colorMap: Record<string, string> = { TRUTH: '#4ade80', LIE: '#f87171' };
  Object.keys(counts).forEach((key, i) => {
    if (key.startsWith('STATEMENT_')) colorMap[key] = STATEMENT_PALETTE[i % STATEMENT_PALETTE.length];
  });

  return (
    <div
      className="w-full rounded-2xl p-6 gap-5"
      style={{
        backgroundColor: '#0d0d0f',
        border: '1px solid rgba(245,158,11,0.25)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {Object.entries(counts).map(([key, count]) => {
        const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
        const label = labels?.[key] ?? key;
        const color = colorMap[key] ?? '#71717a';
        return (
          <div key={key}>
            <div className="flex justify-between items-baseline" style={{ marginBottom: '0.42vw' }}>
              <span
                className="font-display font-bold uppercase tracking-wide"
                style={{ color, fontSize: 'clamp(16px, 1.875vw, 36px)' }}
              >
                {label}
              </span>
              <span
                className="font-display font-bold text-white"
                style={{ fontSize: 'clamp(16px, 1.875vw, 36px)' }}
              >
                {pct}%
              </span>
            </div>
            <div
              className="w-full rounded-full overflow-hidden"
              style={{ height: 'clamp(12px, 2.29vw, 44px)', backgroundColor: '#18181b' }}
            >
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${pct}%`,
                  backgroundColor: color,
                  minWidth: pct > 0 ? 'clamp(8px, 2.29vw, 44px)' : 0,
                }}
              />
            </div>
          </div>
        );
      })}
      {!hideFooter && (
        <p
          className="text-right font-display"
          style={{ color: '#3f3f46', fontSize: 'clamp(11px, 0.94vw, 18px)', paddingTop: '0.1vw' }}
        >
          {total} vote{total !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

// ── Statement card ─────────────────────────────────────────────────────────

function StatementCard({
  text,
  label,
  highlight,
  large,
}: {
  text: string;
  label?: string;
  highlight?: 'truth' | 'lie' | null;
  large?: boolean;
}) {
  const borderColor =
    highlight === 'truth' ? '#4ade80' :
    highlight === 'lie'   ? '#f87171' :
    '#f59e0b';

  const bgColor =
    highlight === 'truth' ? 'rgba(22,101,52,0.18)'  :
    highlight === 'lie'   ? 'rgba(127,29,29,0.18)'  :
    'rgba(13,13,15,0.97)';

  const labelColor =
    highlight === 'truth' ? '#4ade80' :
    highlight === 'lie'   ? '#f87171' :
    '#f59e0b';

  const textColor =
    highlight === 'truth' ? '#bbf7d0' :
    highlight === 'lie'   ? '#fecaca' :
    '#ffffff';

  return (
    <div
      className="rounded-3xl w-full relative overflow-hidden"
      style={{ border: `2px solid ${borderColor}`, backgroundColor: bgColor }}
    >
      {/* Left accent strip */}
      <div style={{ padding: 'clamp(12px, 2.08vw, 40px) clamp(16px, 2.92vw, 56px)', paddingLeft: 'clamp(18px, 3.33vw, 64px)' }}>
        {label && (
          <p
            className="font-display font-bold uppercase tracking-widest"
            style={{ color: labelColor, fontSize: 'clamp(12px, 1.25vw, 24px)', marginBottom: '0.6vw' }}
          >
            {label}
          </p>
        )}
        <p
          className="font-display leading-tight"
          style={{ fontSize: large ? 'clamp(24px, 3.64vw, 70px)' : 'clamp(18px, 2.71vw, 52px)', color: textColor }}
        >
          {text}
        </p>
      </div>
    </div>
  );
}

// ── Player avatar ──────────────────────────────────────────────────────────

function PlayerAvatar({
  player,
  vwSize = 8.33,
  glow = false,
}: {
  player: Player;
  vwSize?: number;
  glow?: boolean;
}) {
  const s = `${vwSize}vw`;
  const outer = `${vwSize + 0.42}vw`;
  return (
    <div
      className="shrink-0 rounded-full"
      style={{
        width: outer,
        height: outer,
        padding: '0.21vw',
        background: 'linear-gradient(135deg, #f59e0b, #fbbf24, #b45309)',
        boxShadow: glow
          ? '0 0 4.69vw 1.56vw rgba(245,158,11,0.45), 0 0 1.56vw 0.42vw rgba(245,158,11,0.3)'
          : 'none',
      }}
    >
      <img
        src={player.photo}
        alt={player.name}
        className="rounded-full object-cover"
        style={{ width: s, height: s, display: 'block' }}
      />
    </div>
  );
}

// ── Scoreboard top-center panel ────────────────────────────────────────────

function Scoreboard({
  players,
  highlightedIds,
}: {
  players: Player[];
  highlightedIds: Set<number>;
}) {
  const sorted = [...players].sort((a, b) => b.score - a.score);

  return (
    <div
      className="flex items-stretch"
      style={{
        backgroundColor: '#08080a',
        border: '1px solid rgba(245,158,11,0.35)',
        borderRadius: '0.94vw',
        boxShadow: '0 0.42vw 2.08vw rgba(0,0,0,0.6), 0 0 1.56vw rgba(245,159,11,0.28)',
      }}
    >
      {/* Label */}
      <div
        className="flex items-center"
        style={{ padding: '0.83vw 1.67vw', borderRight: '1px solid rgba(245,158,11,0.2)' }}
      >
        <p
          className="font-display font-bold uppercase tracking-widest"
          style={{ color: '#f59e0b', fontSize: 'clamp(11px, 1.04vw, 20px)' }}
        >
          Points
        </p>
      </div>

      {/* Player cards */}
      {sorted.map((player, rank) => {
        const isHighlighted = highlightedIds.has(player.id);
        const isLast = rank === sorted.length - 1;
        return (
          <div
            key={player.id}
            className="flex items-center transition-all duration-500 relative"
            style={{
              gap: '0.63vw',
              padding: '0.83vw 1.25vw',
              borderRight: isLast ? 'none' : '1px solid rgba(245,158,11,0.2)',
              backgroundColor: isHighlighted ? 'rgba(245,158,11,0.08)' : 'transparent',
            }}
          >
            {isHighlighted && (
              <div
                className="absolute bottom-0 left-0 right-0"
                style={{ height: '0.16vw', backgroundColor: '#f59e0b', borderRadius: '0 0 2px 2px' }}
              />
            )}
            <img
              src={player.photo}
              alt={player.name}
              className="rounded-full object-cover shrink-0"
              style={{
                width: '2.5vw',
                height: '2.5vw',
                border: `2px solid ${isHighlighted ? '#f59e0b' : 'rgba(245,158,11,0.2)'}`,
              }}
            />
            <div className="min-w-0">
              <p
                className="text-white font-semibold truncate leading-tight"
                style={{ fontSize: 'clamp(10px, 0.73vw, 14px)' }}
              >
                {player.name}
              </p>
              <p
                className="font-display font-bold leading-tight transition-colors duration-500"
                style={{ color: isHighlighted ? '#f59e0b' : '#e4e4e7', fontSize: 'clamp(12px, 1.25vw, 24px)' }}
              >
                {player.score}
              </p>
            </div>
            {isHighlighted && (
              <span
                className="font-display font-black shrink-0"
                style={{ color: '#f59e0b', marginLeft: '0.21vw', fontSize: 'clamp(10px, 0.83vw, 16px)' }}
              >
                ▲
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Leaderboard modal ──────────────────────────────────────────────────────

function LeaderboardModal({ players }: { players: Player[] }) {
  const sorted = [...players].sort((a, b) => b.score - a.score);

  const podium     = sorted.length >= 3 ? [sorted[1], sorted[0], sorted[2]] : sorted.length === 2 ? [sorted[1], sorted[0]] : sorted;
  const podiumRank = sorted.length >= 3 ? [2, 1, 3]                         : sorted.length === 2 ? [2, 1]                 : [1];
  const vwSizes    = sorted.length >= 3 ? [7.81, 10.42, 6.77]               : sorted.length === 2 ? [8.33, 10.42]          : [11.46];
  const blockVh    = sorted.length >= 3 ? [11.11, 16.67, 7.41]              : sorted.length === 2 ? [11.11, 16.67]         : [16.67];

  const rankBorder = (r: number) => r === 1 ? '#fbbf24' : r === 2 ? '#94a3b8' : '#cd7c2f';
  const rankColor  = (r: number) => r === 1 ? '#fbbf24' : r === 2 ? '#94a3b8' : '#cd7c2f';

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center" style={{ backgroundColor: '#08080a' }}>
      {/* Confetti */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[...Array(60)].map((_, i) => (
          <div
            key={i}
            className="absolute animate-fall"
            style={{
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${2 + Math.random() * 3}s`,
              width:  10 + Math.random() * 8,
              height: 10 + Math.random() * 8,
              backgroundColor: ['#f59e0b','#fbbf24','#4ade80','#60a5fa','#f472b6'][Math.floor(Math.random() * 5)],
              borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            }}
          />
        ))}
      </div>

      {/* Title */}
      <div className="relative" style={{ marginBottom: '0.42vw' }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, rgba(245,158,11,0.2) 0%, transparent 70%)' }}
        />
        <h1
          className="font-display font-black tracking-tight relative"
          style={{ fontSize: 'clamp(40px, 5.63vw, 108px)', color: '#f59e0b', textShadow: '0 0 4.17vw rgba(245,158,11,0.4)' }}
        >
          Lie Hard
        </h1>
      </div>
      <p
        className="font-display tracking-widest"
        style={{ color: '#3f3f46', fontSize: 'clamp(14px, 1.56vw, 30px)', marginBottom: '3.13vw' }}
      >
        FINAL STANDINGS
      </p>

      {/* Podium */}
      <div className="flex items-end" style={{ gap: '2.08vw' }}>
        {podium.map((player, i) => {
          const rank    = podiumRank[i];
          const isFirst = rank === 1;
          const vwSz    = vwSizes[i];
          const blockH  = blockVh[i];

          return (
            <div key={player.id} className="flex flex-col items-center" style={{ gap: '0.63vw' }}>
              <img
                src={player.photo}
                alt={player.name}
                className="rounded-full object-cover"
                style={{
                  width: `${vwSz}vw`, height: `${vwSz}vw`,
                  border: `0.26vw solid ${rankBorder(rank)}`,
                  boxShadow: isFirst ? `0 0 2.6vw 0.63vw rgba(251,191,36,0.3)` : 'none',
                }}
              />
              <p
                className="font-bold text-center"
                style={{ fontSize: isFirst ? 'clamp(18px, 2.5vw, 48px)' : 'clamp(16px, 2.08vw, 40px)', color: isFirst ? '#ffffff' : '#a1a1aa' }}
              >
                {player.name}
              </p>
              <p
                className="font-display font-bold"
                style={{ color: isFirst ? '#f59e0b' : '#52525b', fontSize: 'clamp(14px, 1.56vw, 30px)' }}
              >
                {player.score} pts
              </p>
              {/* Podium block */}
              <div
                className="rounded-t-2xl flex items-center justify-center"
                style={{
                  width: '9.17vw',
                  height: `${blockH}vh`,
                  backgroundColor: isFirst ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isFirst ? 'rgba(245,158,11,0.4)' : 'rgba(245,158,11,0.15)'}`,
                }}
              >
                <span
                  className="font-display font-black"
                  style={{ color: rankColor(rank), fontSize: 'clamp(20px, 3.13vw, 60px)' }}
                >
                  #{rank}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Top Voters Overlay ─────────────────────────────────────────────────────

function TopVotersOverlay({ voterScores }: { voterScores: GameState['voterScores'] }) {
  const sorted = Object.entries(voterScores ?? {})
    .sort(([, a], [, b]) => b.correctCount - a.correctCount)
    .slice(0, 3);

  const medals      = ['🥇', '🥈', '🥉'];
  const medalColors = ['#fbbf24', '#94a3b8', '#cd7c2f'];

  return (
    <div
      className="absolute bottom-0 right-0 z-30"
      style={{ width: 'clamp(200px, 22.9vw, 440px)', padding: '1.04vw' }}
    >
      <div
        className="rounded-3xl"
        style={{
          backgroundColor: '#0a0a0c',
          border: '2px solid rgba(245,158,11,0.4)',
          boxShadow: '0 0 2.08vw rgba(245,158,11,0.1)',
          padding: 'clamp(12px, 1.67vw, 32px) clamp(16px, 2.08vw, 40px)',
        }}
      >
        <p
          className="font-display font-black uppercase tracking-widest text-center"
          style={{ color: '#f59e0b', fontSize: 'clamp(14px, 1.56vw, 30px)', marginBottom: '1.25vw' }}
        >
          Top Voters
        </p>
        {sorted.length === 0 ? (
          <p className="text-center" style={{ color: '#3f3f46', fontSize: 'clamp(11px, 1.04vw, 20px)' }}>No votes yet</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.63vw' }}>
            {sorted.map(([uid, data], rank) => (
              <div
                key={uid}
                className="flex items-center rounded-xl"
                style={{ gap: '0.83vw', padding: '0.42vw 0.63vw', backgroundColor: 'rgba(255,255,255,0.03)' }}
              >
                <span style={{ fontSize: 'clamp(14px, 2.08vw, 40px)' }} className="shrink-0">{medals[rank]}</span>
                <span
                  className="text-white font-bold flex-1 truncate"
                  style={{ fontSize: 'clamp(12px, 1.25vw, 24px)' }}
                >
                  {data.name}
                </span>
                <span
                  className="font-display font-black shrink-0"
                  style={{ color: medalColors[rank], fontSize: 'clamp(12px, 1.25vw, 24px)' }}
                >
                  {data.correctCount} ✓
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Ambient result glow ────────────────────────────────────────────────────

function ResultGlow({ color }: { color: string }) {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ background: `radial-gradient(ellipse at center, ${color}18 0%, transparent 65%)` }}
    />
  );
}

// ── Waiting indicator ──────────────────────────────────────────────────────

function WaitingDots({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center" style={{ gap: '1.25vw' }}>
      <p
        className="font-display font-bold uppercase tracking-widest"
        style={{ color: '#f59e0b', fontSize: 'clamp(18px, 2.5vw, 48px)' }}
      >
        {label}
      </p>
      <div className="flex items-center" style={{ gap: '0.63vw' }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-full animate-breathe"
            style={{ width: '0.63vw', height: '0.63vw', backgroundColor: '#f59e0b', animationDelay: `${i * 0.3}s` }}
          />
        ))}
        <p style={{ color: '#f59e0b', fontSize: 'clamp(14px, 1.56vw, 30px)', marginLeft: '0.63vw' }}>
          Waiting for next player...
        </p>
      </div>
    </div>
  );
}

// ── Phase screens ──────────────────────────────────────────────────────────

function SetupScreen() {
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden"
      style={{ backgroundColor: '#08080a' }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, rgba(245,158,11,0.07) 0%, transparent 60%)' }}
      />
      <h1
        className="font-display font-black leading-none tracking-tight relative"
        style={{ fontSize: 'clamp(48px, 8.33vw, 160px)', color: '#f59e0b', textShadow: '0 0 6.25vw rgba(245,158,11,0.25)' }}
      >
        Lie Hard
      </h1>
      <p
        className="font-display tracking-widest relative"
        style={{ color: '#2d2d2d', fontSize: 'clamp(18px, 2.5vw, 48px)', marginTop: '0.42vw' }}
      >
        SEASON 2
      </p>
      <div className="flex items-center relative" style={{ gap: '0.63vw', marginTop: '2.08vw' }}>
        <div className="rounded-full animate-breathe" style={{ width: '0.42vw', height: '0.42vw', backgroundColor: '#f09d0e' }} />
        <p style={{ color: '#f59e0b', fontSize: 'clamp(12px, 1.25vw, 24px)' }}>Setting up...</p>
      </div>
    </div>
  );
}

function WarmupScreen({ gameState }: { gameState: GameState }) {
  const { warmup } = gameState;
  const stmt   = warmup.statements[warmup.currentIndex];
  const counts = getVoteCounts(gameState.audienceVotes, `warmup-${warmup.currentIndex}`, ['TRUTH', 'LIE']);

  if (warmup.showResult && stmt) {
    const isLie = stmt.isLie;
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden"
        style={{ backgroundColor: isLie ? '#130404' : '#031208', gap: '1.04vw' }}
      >
        <ResultGlow color={isLie ? '#f87171' : '#4ade80'} />
        <p
          className="font-display uppercase tracking-widest relative"
          style={{ color: '#52525b', fontSize: 'clamp(14px, 1.56vw, 30px)' }}
        >
          Warmup Round
        </p>
        <p
          className="font-display font-black leading-none animate-reveal-pop relative"
          style={{
            fontSize: 'clamp(60px, 11.46vw, 220px)',
            color: isLie ? '#f87171' : '#4ade80',
            textShadow: `0 0 5.21vw ${isLie ? 'rgba(248,113,113,0.4)' : 'rgba(74,222,128,0.4)'}`,
          }}
        >
          {isLie ? 'LIE' : 'TRUTH'}
        </p>
        <div className="animate-slide-up relative" style={{ width: '50vw' }}>
          <div
            className="rounded-2xl text-center"
            style={{
              backgroundColor: 'rgba(245,158,11,0.05)',
              border: '1px solid rgba(245,158,11,0.2)',
              padding: 'clamp(12px, 1.25vw, 24px) clamp(16px, 2.5vw, 48px)',
            }}
          >
            <p
              className="font-display leading-snug"
              style={{ color: isLie ? '#fca5a5' : '#86efac', fontSize: 'clamp(14px, 1.875vw, 36px)' }}
            >
              &ldquo;{stmt.statement}&rdquo;
            </p>
          </div>
        </div>
        {(gameState.showVoteBars ?? true) && (
          <div style={{ width: '50vw' }}>
            <VoteBars counts={counts} />
          </div>
        )}
      </div>
    );
  }

  if (warmup.audienceVotingOpen && stmt) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center"
        style={{ backgroundColor: '#08080a', gap: '2.08vw', padding: '0 5vw' }}
      >
        
        <div className="w-full max-w-5xl">
          <StatementCard text={stmt.statement} />
        </div>
        {(gameState.showVoteBars ?? true) && (
          <div className="w-full max-w-4xl">
            <VoteBars counts={counts} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center"
      style={{ backgroundColor: '#08080a', gap: '2.08vw', padding: '0 5vw' }}
    >
      {stmt && (
        <div className="w-full max-w-5xl">
          <StatementCard text={stmt.statement} />
        </div>
      )}
    </div>
  );
}

function Segment1Screen({ gameState }: { gameState: GameState }) {
  const { segment1, players } = gameState;
  const storyteller = players.find((p) => p.id === segment1.currentStorytellerId);
  const stmtObj     = segment1.statements.find((s) => s.playerId === segment1.currentStorytellerId);
  const counts      = getVoteCounts(gameState.audienceVotes, `seg1-${segment1.currentStorytellerId}`, ['TRUTH', 'LIE']);

  if (!storyteller || !stmtObj) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center" style={{ backgroundColor: '#08080a' }}>
        <WaitingDots label="Round 1" />
      </div>
    );
  }

  const nonStorytellers1 = players.filter((p) => p.id !== segment1.currentStorytellerId);
  const hasAnyVote1 = nonStorytellers1.some((p) => segment1.playerVotes[p.id]);

  if (segment1.showResult) {
    const isLie = stmtObj.isLie;
    const resultColor = isLie ? '#f87171' : '#4ade80';
    const totalVotes1 = Object.values(counts).reduce((a, b) => a + b, 0);
    return (
      <div className="w-full h-full flex flex-col overflow-hidden relative" style={{ backgroundColor: isLie ? '#0f0202' : '#020f04' }}>
        <ResultGlow color={resultColor} />

        {/* Row 1: TRUTH / LIE word */}
        <div className="flex items-center justify-center shrink-0 relative" style={{ padding: '2vw 5vw 1vw' }}>
          <p
            className="font-display font-black uppercase animate-reveal-pop leading-none"
            style={{
              color: resultColor,
              fontSize: 'clamp(60px, 11vw, 180px)',
              textShadow: `0 0 5vw ${isLie ? 'rgba(248,113,113,0.5)' : 'rgba(74,222,128,0.5)'}`,
            }}
          >
            {isLie ? 'LIE' : 'TRUTH'}
          </p>
        </div>

        {/* Row 2: Player photo + statement */}
        <div className="flex-1 min-h-0 flex items-center relative" style={{ padding: '0 5vw 1.5vw', gap: '2vw' }}>
          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: '0.75vw' }}>
            <div className='flex items-center'>
              <PlayerAvatar player={storyteller} vwSize={7} />
              <p className="font-display font-bold text-white leading-none ml-4" style={{ fontSize: 'clamp(24px, 3vw, 60px)' }}>
                {storyteller.name}
              </p>
            </div>
            <StatementCard text={stmtObj.statement} highlight={isLie ? 'lie' : 'truth'} large />
          </div>
        </div>

        {/* Row 3: Audience votes + Player votes side by side, no scroll */}
        <div className="flex w-full shrink-0 overflow-hidden" style={{ borderTop: '1px solid rgba(245,158,11,0.12)', padding: '1.5vw 2vw', gap: '2vw' }}>
          {(gameState.showVoteBars ?? true) && (
            <div style={{ width: '60%' }}>
              <div className="flex items-baseline justify-between mb-2">
                <p className="font-display uppercase tracking-widest" style={{ color: '#52525b', fontSize: 'clamp(11px, 1.04vw, 20px)' }}>
                  Audience Votes
                </p>
                <p className="font-display" style={{ color: '#3f3f46', fontSize: 'clamp(11px, 0.94vw, 18px)' }}>
                  {totalVotes1} vote{totalVotes1 !== 1 ? 's' : ''}
                </p>
              </div>
              <VoteBars counts={counts} hideFooter />
            </div>
          )}
          <div style={{ width: (gameState.showVoteBars ?? true) ? '40%' : '100%' }}>
            <p className="font-display uppercase tracking-widest mb-2" style={{ color: '#52525b', fontSize: 'clamp(11px, 1.04vw, 20px)' }}>
              Player Votes
            </p>
            <div className="w-full rounded-2xl p-3 flex flex-col flex-wrap gap-3 overflow-hidden" style={{ backgroundColor: '#0d0d0f', border: '1px solid rgba(245,158,11,0.2)' }}>
              {nonStorytellers1.map((player) => {
                const vote = segment1.playerVotes[player.id];
                const voteColor = vote === 'TRUTH' ? '#4ade80' : vote === 'LIE' ? '#f87171' : '#3f3f46';
                return (
                  <div key={player.id} className="flex items-center gap-2">
                    <img src={player.photo} alt={player.name} className="rounded-full object-cover shrink-0"
                      style={{ width: '4.5vw', height: '4.5vw', border: `2px solid ${vote ? voteColor : 'rgba(245,158,11,0.2)'}` }} />
                    <div className='flex items-center justify-between w-full'>
                      <p className="font-display font-bold text-white leading-tight" style={{ fontSize: 'clamp(16px, 1.7vw, 34px)' }}>{player.name}</p>
                      <p className="font-display font-bold leading-tight" style={{ color: voteColor, fontSize: 'clamp(20px, 2.1vw, 42px)' }}>{vote ?? '—'}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const waitingCard = (text: string) => (
    <div
      className="w-full rounded-2xl flex items-center justify-center p-6"
      style={{
        backgroundColor: '#0d0d0f',
        border: '1px solid rgba(245,158,11,0.25)'
      }}
    >
      <p className="font-display text-xl" style={{ color: '#3f3f46'}}>
        {text}
      </p>
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden" style={{ backgroundColor: '#08080a' }}>
      {/* Row 1: current player + statement (left-aligned) */}
      <div className="w-full p-6" style={{ borderBottom: '1px solid rgba(245,158,11,0.12)'}}>
        <div className="flex items-center" style={{ gap: '1.25vw', marginBottom: '0.83vw' }}>
          <PlayerAvatar player={storyteller} vwSize={4.58} />
          <div>
            <p className="font-display font-bold text-white leading-none" style={{ fontSize: 'clamp(18px, 2.71vw, 52px)' }}>
              {storyteller.name}
            </p>
            <p className="font-display tracking-wide" style={{ color: '#3f3f46', fontSize: 'clamp(12px, 1.25vw, 24px)', marginTop: '0.21vw' }}>
              makes a statement
            </p>
          </div>
        </div>
        <StatementCard text={stmtObj.statement} />
      </div>

      {/* Row 2: player votes + audience votes */}
      <div className="flex min-h-0 w-full">
        <div className='p-6' style={{ width: '30%'}}>
          <p className="font-display uppercase text-2xl tracking-widest mb-2" style={{ color: '#52525b'}}>
            Player Votes
          </p>
          {hasAnyVote1 ? (
            <div
              className="w-full rounded-2xl p-6 gap-6"
              style={{
                backgroundColor: '#0d0d0f',
                border: '1px solid rgba(245,158,11,0.25)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {nonStorytellers1.map((player) => {
                const vote = segment1.playerVotes[player.id];
                const voteColor = vote === 'TRUTH' ? '#4ade80' : vote === 'LIE' ? '#f87171' : '#3f3f46';
                return (
                  <div key={player.id} className="flex items-center gap-4">
                    <img
                      src={player.photo}
                      alt={player.name}
                      className="rounded-full object-cover shrink-0"
                      style={{ width: '4.17vw', height: '4.17vw', border: `2px solid ${vote ? voteColor : 'rgba(245,158,11,0.2)'}` }}
                    />
                    <div>
                      <p className="font-display font-bold text-white text-2xl leading-tight">
                        {player.name}
                      </p>
                      <p className="font-display font-bold leading-tight text-3xl" style={{ color: voteColor}}>
                        {vote ?? '—'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : waitingCard('Waiting for player votes...')}
        </div>

        <div className='p-6' style={{ width: '70%'}}>
          <div className="flex items-baseline justify-between mb-2">
            <p className="font-display uppercase tracking-widest text-2xl" style={{ color: '#52525b'}}>
              Audience Votes
            </p>
            {segment1.audienceVotingOpen && (gameState.showVoteBars ?? true) && (
              <p className="font-display text-xl" style={{ color: '#3f3f46'}}>
                {Object.values(counts).reduce((a, b) => a + b, 0)} vote{Object.values(counts).reduce((a, b) => a + b, 0) !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          {segment1.audienceVotingOpen && (gameState.showVoteBars ?? true) ? (
            <VoteBars counts={counts} hideFooter />
          ) : waitingCard('Waiting for audience votes...')}
        </div>
      </div>
    </div>
  );
}

function Segment2Screen({ gameState }: { gameState: GameState }) {
  const { segment2, players } = gameState;
  const storyteller = players.find((p) => p.id === segment2.currentStorytellerId);
  const stmtObj     = segment2.statements.find((s) => s.playerId === segment2.currentStorytellerId);
  const voteOptions = stmtObj ? stmtObj.statements.map((_, i) => `STATEMENT_${i}`) : ['STATEMENT_0', 'STATEMENT_1'];
  const counts      = getVoteCounts(gameState.audienceVotes, `seg2-${segment2.currentStorytellerId}`, voteOptions);
  const labels      = Object.fromEntries(voteOptions.map((v, i) => [v, `Statement ${i + 1} is Lie`]));

  if (!storyteller || !stmtObj) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center" style={{ backgroundColor: '#08080a' }}>
        <WaitingDots label="Round 2" />
      </div>
    );
  }

  const nonStorytellers2 = players.filter((p) => p.id !== segment2.currentStorytellerId);
  const hasAnyVote2 = nonStorytellers2.some((p) => segment2.playerVotes[p.id]);

  if (segment2.showResult) {
    const lieIdx = stmtObj.lieIndex;
    const totalVotes2 = Object.values(counts).reduce((a, b) => a + b, 0);
    return (
      <div className="w-full h-full flex flex-col overflow-hidden relative" style={{ backgroundColor: '#0f0202' }}>
        <ResultGlow color="#f87171" />

        {/* Row 1 (primary): Player photo + name + reveal */}
        <div className="flex-1 min-h-0 flex items-center justify-between relative" style={{ padding: '2vw 5vw 1vw', gap: '1vw' }}>
          <div className='flex items-center justify-between'>
            <PlayerAvatar player={storyteller} vwSize={7.5} />
            <p className="font-display font-bold text-white leading-none ml-4" style={{ fontSize: 'clamp(26px, 3.2vw, 64px)' }}>
              {storyteller.name}
            </p>
          </div>
          
          <p
            className="font-display font-black uppercase animate-reveal-pop leading-tight text-center"
            style={{
              color: '#f87171',
              fontSize: 'clamp(36px, 7vw, 130px)',
              textShadow: '0 0 5vw rgba(248,113,113,0.5)',
            }}
          >
            {`Statement ${lieIdx + 1}`} is the Lie
          </p>
        </div>

        {/* Row 2 (tertiary): Statement cards side by side, small */}
        <div className="flex shrink-0 w-full" style={{ padding: '0 5vw 1.5vw', gap: '1vw' }}>
          {stmtObj.statements.map((stmt, i) => (
            <StatementCard key={i} text={stmt} label={`Statement ${i + 1}`} highlight={i === lieIdx ? 'lie' : 'truth'} />
          ))}
        </div>

        {/* Row 3: Audience votes + Player votes side by side, no scroll */}
        <div className="flex w-full shrink-0 overflow-hidden" style={{ borderTop: '1px solid rgba(245,158,11,0.12)', padding: '1.5vw 2vw', gap: '2vw' }}>
          {(gameState.showVoteBars ?? true) && (
            <div style={{ width: '60%' }}>
              <div className="flex items-baseline justify-between mb-2">
                <p className="font-display uppercase tracking-widest" style={{ color: '#52525b', fontSize: 'clamp(11px, 1.04vw, 20px)' }}>
                  Audience Votes
                </p>
                <p className="font-display" style={{ color: '#3f3f46', fontSize: 'clamp(11px, 0.94vw, 18px)' }}>
                  {totalVotes2} vote{totalVotes2 !== 1 ? 's' : ''}
                </p>
              </div>
              <VoteBars counts={counts} labels={labels} hideFooter />
            </div>
          )}
          <div style={{ width: (gameState.showVoteBars ?? true) ? '40%' : '100%' }}>
            <p className="font-display uppercase tracking-widest mb-2" style={{ color: '#52525b', fontSize: 'clamp(11px, 1.04vw, 20px)' }}>
              Player Votes
            </p>
            <div className="w-full rounded-2xl p-3 flex flex-col gap-3 overflow-hidden" style={{ backgroundColor: '#0d0d0f', border: '1px solid rgba(245,158,11,0.2)' }}>
              {nonStorytellers2.map((player) => {
                const vote = segment2.playerVotes[player.id];
                const STMT_PALETTE = ['#fbbf24', '#a78bfa', '#34d399', '#60a5fa', '#f472b6'];
                const stmtIdx = vote?.startsWith('STATEMENT_') ? parseInt(vote.replace('STATEMENT_', ''), 10) : null;
                const voteLabel = stmtIdx !== null ? `Stmt ${stmtIdx + 1}` : null;
                const voteColor = stmtIdx !== null ? STMT_PALETTE[stmtIdx % STMT_PALETTE.length] : '#3f3f46';
                return (
                  <div key={player.id} className="flex items-center gap-2">
                    <img src={player.photo} alt={player.name} className="rounded-full object-cover shrink-0"
                      style={{ width: '4.5vw', height: '4.5vw', border: `2px solid ${vote ? voteColor : 'rgba(245,158,11,0.2)'}` }} />
                    <div className='flex justify-between items-center w-full'>
                      <p className="font-display font-bold text-white leading-tight" style={{ fontSize: 'clamp(16px, 1.7vw, 34px)' }}>{player.name}</p>
                      <p className="font-display font-bold leading-tight" style={{ color: voteColor, fontSize: 'clamp(20px, 2.1vw, 42px)' }}>{voteLabel ?? '—'}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const waitingCard2 = (text: string) => (
    <div
      className="w-full rounded-2xl flex items-center justify-center p-6"
      style={{
        backgroundColor: '#0d0d0f',
        border: '1px solid rgba(245,158,11,0.25)',
      }}
    >
      <p className="font-display text-xl" style={{ color: '#3f3f46' }}>
        {text}
      </p>
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden" style={{ backgroundColor: '#08080a' }}>
      {/* Row 1: current player + statements (left-aligned) */}
      <div className="w-full p-6" style={{ borderBottom: '1px solid rgba(245,158,11,0.12)' }}>
        <div className="flex items-center" style={{ gap: '1.67vw', marginBottom: '0.83vw' }}>
          <PlayerAvatar player={storyteller} vwSize={5.21} />
          <div>
            <p className="font-display font-bold text-white leading-none" style={{ fontSize: 'clamp(18px, 2.71vw, 52px)' }}>
              {storyteller.name}
            </p>
            <p className="font-display tracking-wide" style={{ color: '#3f3f46', fontSize: 'clamp(12px, 1.25vw, 24px)', marginTop: '0.21vw' }}>
              makes two statements
            </p>
          </div>
        </div>
        <div className="flex" style={{ gap: '1.04vw' }}>
          {stmtObj.statements.map((stmt, i) => {
            const revealed = (segment2.revealedStatements ?? []).includes(i);
            if (revealed) {
              return <StatementCard key={i} text={stmt} label={`Statement ${i + 1}`} />;
            }
            return (
              <div key={i} className="flex-1 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: '#0d0d0f', border: '1px solid rgba(245,158,11,0.12)', padding: '1.5vw' }}>
                <p className="font-display uppercase tracking-widest" style={{ color: '#3f3f46', fontSize: 'clamp(11px, 1vw, 20px)' }}>
                  Statement {i + 1}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Row 2: player votes + audience votes */}
      <div className="flex min-h-0 w-full">
        <div className='p-6' style={{ width: '30%' }}>
          <p className="font-display uppercase text-2xl tracking-widest mb-2" style={{ color: '#52525b' }}>
            Player Votes
          </p>
          {hasAnyVote2 ? (
            <div
              className="w-full rounded-2xl p-6 gap-6"
              style={{
                backgroundColor: '#0d0d0f',
                border: '1px solid rgba(245,158,11,0.25)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {nonStorytellers2.map((player) => {
                const vote = segment2.playerVotes[player.id];
                const STMT_PALETTE = ['#fbbf24', '#a78bfa', '#34d399', '#60a5fa', '#f472b6'];
                const stmtIdx = vote?.startsWith('STATEMENT_') ? parseInt(vote.replace('STATEMENT_', ''), 10) : null;
                const voteLabel = stmtIdx !== null ? `Statement ${stmtIdx + 1}` : null;
                const voteColor = stmtIdx !== null ? STMT_PALETTE[stmtIdx % STMT_PALETTE.length] : '#3f3f46';
                return (
                  <div key={player.id} className="flex items-center gap-4">
                    <img
                      src={player.photo}
                      alt={player.name}
                      className="rounded-full object-cover shrink-0"
                      style={{ width: '4.17vw', height: '4.17vw', border: `2px solid ${vote ? voteColor : 'rgba(245,158,11,0.2)'}` }}
                    />
                    <div>
                      <p className="font-display font-bold text-white text-2xl leading-tight">
                        {player.name}
                      </p>
                      <p className="font-display font-bold leading-tight text-3xl" style={{ color: voteColor }}>
                        {voteLabel ?? '—'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : waitingCard2('Waiting for player votes...')}
        </div>

        <div className='p-6' style={{ width: '70%' }}>
          <div className="flex items-baseline justify-between mb-2">
            <p className="font-display uppercase tracking-widest text-2xl" style={{ color: '#52525b' }}>
              Audience Votes
            </p>
            {segment2.audienceVotingOpen && (gameState.showVoteBars ?? true) && (
              <p className="font-display" style={{ color: '#3f3f46', fontSize: 'clamp(11px, 0.94vw, 18px)' }}>
                {Object.values(counts).reduce((a, b) => a + b, 0)} vote{Object.values(counts).reduce((a, b) => a + b, 0) !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          {segment2.audienceVotingOpen && (gameState.showVoteBars ?? true) ? (
            <VoteBars counts={counts} labels={labels} hideFooter />
          ) : waitingCard2('Waiting for audience votes...')}
        </div>
      </div>
    </div>
  );
}

function Segment3Screen({ gameState }: { gameState: GameState }) {
  const { segment3, players } = gameState;
  const winner = players.find((p) => p.id === segment3.winnerId);

  const [kpDisplay, setKpDisplay] = useState(0);
  useEffect(() => {
    if (!segment3.showResult) { setKpDisplay(0); return; }
    let current = 0;
    const interval = setInterval(() => {
      current += 10;
      if (current >= 300) { setKpDisplay(300); clearInterval(interval); }
      else setKpDisplay(current);
    }, 25);
    return () => clearInterval(interval);
  }, [segment3.showResult, segment3.winnerId]);

  const playerCounts: Record<number, number> = Object.fromEntries(players.map((p) => [p.id, 0]));
  Object.values(gameState.audienceVotes ?? {}).forEach((v) => {
    if (v.votingRound === 'seg3') {
      const id = parseInt(v.choice, 10);
      if (playerCounts[id] !== undefined) playerCounts[id]++;
    }
  });
  const totalVotes = Object.values(playerCounts).reduce((a, b) => a + b, 0);

  if (segment3.showResult && winner) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden"
        style={{ backgroundColor: '#08080a', gap: '1.67vw' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, rgba(245,158,11,0.18) 0%, transparent 60%)' }}
        />
        <div className="relative">
          <PlayerAvatar player={winner} vwSize={14.58} glow />
        </div>
        <p className="font-display font-black text-white relative" style={{ fontSize: 'clamp(28px, 4.58vw, 88px)' }}>
          {winner.name}
        </p>
        <p
          className="font-display font-black relative"
          style={{ fontSize: 'clamp(24px, 3.75vw, 72px)', color: '#f59e0b', textShadow: '0 0 2.08vw rgba(245,158,11,0.4)' }}
        >
          +{kpDisplay} POINTS
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex" style={{ backgroundColor: '#08080a' }}>
      {/* Left — object photo */}
      <div className="w-1/2 h-full relative">
        {segment3.photoUrl ? (
          <img
            src={segment3.photoUrl}
            alt={segment3.photoTitle ?? ''}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: '#0d0d0f' }}>
            <p className="font-display tracking-widest" style={{ color: '#27272a', fontSize: 'clamp(14px, 1.56vw, 30px)' }}>
              NO PHOTO
            </p>
          </div>
        )}
        {segment3.photoTitle && (
          <div
            className="absolute bottom-0 left-0 right-0"
            style={{
              padding: 'clamp(12px, 1.67vw, 32px) clamp(16px, 2.08vw, 40px)',
              background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, transparent 100%)',
            }}
          >
            <p className="font-display font-bold text-white tracking-wide" style={{ fontSize: 'clamp(16px, 2.08vw, 40px)' }}>
              {segment3.photoTitle}
            </p>
          </div>
        )}
      </div>

      {/* Right — player vote bars */}
      <div
        className="w-1/2 h-full flex flex-col justify-center"
        style={{ borderLeft: '1px solid rgba(245,158,11,0.2)', padding: '0 3.33vw', gap: '1.67vw' }}
      >
        <p className="font-display font-bold text-white tracking-wide" style={{ fontSize: 'clamp(18px, 2.5vw, 48px)' }}>
          Who does this belong to?
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25vw' }}>
          {players.map((player) => {
            const count = playerCounts[player.id] ?? 0;
            const pct   = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            return (
              <div key={player.id} className="flex items-center" style={{ gap: '1.04vw' }}>
                <img
                  src={player.photo}
                  alt={player.name}
                  className="rounded-full object-cover shrink-0"
                  style={{ width: '3.75vw', height: '3.75vw', border: '2px solid rgba(245,158,11,0.25)' }}
                />
                <div className="flex-1">
                  <div className="flex justify-between" style={{ marginBottom: '0.42vw' }}>
                    <span className="font-display font-bold text-white" style={{ fontSize: 'clamp(14px, 1.56vw, 30px)' }}>
                      {player.name}
                    </span>
                    <span className="font-display font-bold" style={{ color: '#a1a1aa', fontSize: 'clamp(12px, 1.25vw, 24px)' }}>
                      {count} · {pct}%
                    </span>
                  </div>
                  <div
                    className="w-full rounded-full overflow-hidden"
                    style={{ height: 'clamp(8px, 1.875vw, 36px)', backgroundColor: '#18181b' }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, backgroundColor: '#f59e0b' }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="font-mono" style={{ color: '#3f3f46', fontSize: 'clamp(11px, 1.04vw, 20px)' }}>
          {totalVotes} vote{totalVotes !== 1 ? 's' : ''}
        </p>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function DisplayPage() {
  // Authoritative game state over WebSocket (read-only display role).
  const { gameState } = useGameState<GameState>('display');
  const prevScoresRef  = useRef<Record<number, number>>({});
  const [highlightedIds, setHighlightedIds] = useState<Set<number>>(new Set());
  const [timerDisplay, setTimerDisplay]     = useState(0);
  const timerTickRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live timer from Firestore banterTimer
  useEffect(() => {
    const bt = gameState?.banterTimer;
    if (timerTickRef.current) clearInterval(timerTickRef.current);
    if (!bt) return;
    if (bt.running && bt.startedAt !== null) {
      const tick = () => {
        const remaining = Math.max(0, bt.totalSeconds - Math.floor((Date.now() - bt.startedAt!) / 1000));
        setTimerDisplay(remaining);
      };
      tick();
      timerTickRef.current = setInterval(tick, 250);
    } else {
      setTimerDisplay(bt.totalSeconds);
    }
    return () => { if (timerTickRef.current) clearInterval(timerTickRef.current); };
  }, [gameState?.banterTimer?.running, gameState?.banterTimer?.startedAt, gameState?.banterTimer?.totalSeconds]);

  // Highlight players whose score changed (was inline in the Firestore snapshot).
  useEffect(() => {
    if (!gameState) return;
    const changed = new Set<number>();
    gameState.players.forEach((p) => {
      if (prevScoresRef.current[p.id] !== undefined && prevScoresRef.current[p.id] !== p.score) {
        changed.add(p.id);
      }
      prevScoresRef.current[p.id] = p.score;
    });
    if (changed.size > 0) {
      setHighlightedIds(changed);
      const t = setTimeout(() => setHighlightedIds(new Set()), 2500);
      return () => clearTimeout(t);
    }
  }, [gameState]);

  if (!gameState) {
    return (
      <div style={{ width: '100vw', height: '100vh', backgroundColor: '#08080a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p className="font-display tracking-widest animate-breathe" style={{ color: '#2d2d2d', fontSize: 'clamp(18px, 2.5vw, 48px)' }}>
          CONNECTING...
        </p>
      </div>
    );
  }

  const { phase, players, showScoreboard, showLeaderboardModal, showTopVoters, showScorePopup, scorePopupDeltas, voterScores } = gameState;

  const mainContent = (() => {
    switch (phase) {
      case 'SETUP':    return <SetupScreen />;
      case 'WARMUP':   return <WarmupScreen gameState={gameState!} />;
      case 'SEGMENT1': return <Segment1Screen gameState={gameState!} />;
      case 'SEGMENT2': return <Segment2Screen gameState={gameState!} />;
      case 'SEGMENT3': return <Segment3Screen gameState={gameState!} />;
      case 'FINAL':
        return (
          <div
            className="w-full h-full flex flex-col items-center justify-center relative overflow-hidden"
            style={{ backgroundColor: '#08080a', gap: '1.04vw' }}
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse at center, rgba(245,158,11,0.07) 0%, transparent 60%)' }}
            />
            <h1
              className="font-display font-black leading-none tracking-tight relative"
              style={{ fontSize: 'clamp(40px, 7.81vw, 150px)', color: '#f59e0b', textShadow: '0 0 5.21vw rgba(245,158,11,0.25)' }}
            >
              Lie Hard
            </h1>
            <p
              className="font-display tracking-widest relative"
              style={{ color: '#2d2d2d', fontSize: 'clamp(18px, 2.5vw, 48px)' }}
            >
              SEASON 2
            </p>
          </div>
        );
      default: return <SetupScreen />;
    }
  })();

  const hideTopBar = (phase === 'SEGMENT1' && gameState.segment1.showResult) ||
                     (phase === 'SEGMENT2' && gameState.segment2.showResult);

  const isTimerRunning = gameState.banterTimer?.running && timerDisplay > 0;
  const timerMins  = Math.floor(timerDisplay / 60);
  const timerSecs  = String(timerDisplay % 60).padStart(2, '0');
  const timerUrgent = timerDisplay <= 10 && timerDisplay > 0;

  const roundLabel = (() => {
    switch (phase) {
      case 'WARMUP': return 'Round Warmup';
      case 'SEGMENT1': return 'Round 1';
      case 'SEGMENT2': return 'Round 2';
      case 'SEGMENT3': return 'Round 3';
      case 'FINAL': return 'Final';
      default: return 'Setup';
    }
  })();

  const votingStatus: 'open' | 'locked' | 'closed' = (() => {
    switch (phase) {
      case 'WARMUP':    return gameState.warmup.audienceVotingOpen ? 'open' : 'closed';
      case 'SEGMENT1':  return gameState.segment1.currentStorytellerId ? (gameState.segment1.audienceVotingOpen ? 'open' : 'closed') : 'locked';
      case 'SEGMENT2':  return gameState.segment2.currentStorytellerId ? (gameState.segment2.audienceVotingOpen ? 'open' : 'closed') : 'locked';
      case 'SEGMENT3':  return gameState.segment3.audienceVotingOpen ? 'open' : 'closed';
      default:          return 'locked';
    }
  })();

  return (
    <div
      className="text-white relative flex flex-col"
      style={{ width: '100vw', height: '100vh', backgroundColor: '#08080a', overflow: 'hidden' }}
    >
      {/* Top section: round + scoreboard + voting status */}
      {!hideTopBar && (<div
        className="z-30 flex items-center justify-between"
        style={{ padding: '0.83vw 1.25vw 0.73vw', borderBottom: '1px solid rgba(245,158,11,0.12)' }}
      >
        <div className="flex items-center" style={{ gap: '0.63vw' }}>
          <div className="rounded-full animate-breathe" style={{ width: '0.42vw', height: '0.42vw', backgroundColor: '#f59e0b' }} />
          <p
            className="font-display uppercase tracking-widest"
            style={{ color: '#f59e0b', fontSize: 'clamp(12px, 1.25vw, 24px)' }}
          >
            {roundLabel}
          </p>
        </div>

        <div>
          {showScoreboard && (
            <Scoreboard players={players} highlightedIds={highlightedIds} />
          )}
        </div>

        <div
          className="flex items-center rounded-full"
          style={{
            gap: '0.63vw',
            padding: '0.52vw 1.04vw',
            backgroundColor: '#08080a',
            border: `1px solid ${votingStatus === 'open' ? '#166534' : votingStatus === 'closed' ? '#27272a' : 'rgba(245,158,11,0.25)'}`,
          }}
        >
          <span
            className={`rounded-full shrink-0 ${votingStatus === 'open' ? 'animate-pulse' : ''}`}
            style={{
              width: '0.42vw',
              height: '0.42vw',
              backgroundColor: votingStatus === 'open' ? '#4ade80' : votingStatus === 'closed' ? '#52525b' : '#f59e0b',
            }}
          />
          <span
            className="font-mono font-bold uppercase tracking-widest"
            style={{
              color: votingStatus === 'open' ? '#4ade80' : votingStatus === 'closed' ? '#52525b' : '#f59e0b',
              fontSize: 'clamp(10px, 0.73vw, 14px)',
            }}
          >
            {votingStatus === 'open' ? 'Voting Open' : votingStatus === 'closed' ? 'Voting Closed' : 'Voting Locked'}
          </span>
        </div>
      </div>)}

      {/* Main content */}
      <div className="w-full flex-1 min-h-0 relative">
        {mainContent}
      </div>

      {/* Banter timer — bottom-center */}
      {isTimerRunning && (
        <div className="absolute left-0 right-0 flex justify-center" style={{ bottom: '1.67vw' }}>
          <div
            className="flex items-center rounded-2xl"
            style={{
              padding: 'clamp(8px, 1.04vw, 20px) clamp(16px, 2.08vw, 40px)',
              backgroundColor: timerUrgent ? 'rgba(25,4,4,0.95)' : 'rgba(8,8,10,0.93)',
              border: `2px solid ${timerUrgent ? '#f87171' : '#f59e0b'}`,
              backdropFilter: 'blur(12px)',
              boxShadow: timerUrgent ? '0 0 2.08vw rgba(248,113,113,0.2)' : '0 0 2.08vw rgba(245,158,11,0.1)',
            }}
          >
            <span
              className="font-display font-black tabular-nums leading-none"
              style={{
                fontSize: 'clamp(28px, 4.58vw, 88px)',
                color: timerUrgent ? '#f87171' : '#f59e0b',
                textShadow: timerUrgent ? '0 0 1.56vw rgba(248,113,113,0.5)' : '0 0 1.56vw rgba(245,158,11,0.3)',
              }}
            >
              {timerMins}:{timerSecs}
            </span>
          </div>
        </div>
      )}

      {/* Score popup */}
      {showScorePopup && (scorePopupDeltas ?? []).length > 0 && !showLeaderboardModal && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.78)' }}
        >
          <div
            className="rounded-3xl text-center relative overflow-hidden"
            style={{
              backgroundColor: '#09090b',
              border: '2px solid rgba(245,158,11,0.5)',
              boxShadow: '0 0 4.17vw rgba(245,158,11,0.15)',
              minWidth: 'clamp(280px, 35.4vw, 680px)',
              padding: 'clamp(24px, 2.92vw, 56px) clamp(32px, 4.17vw, 80px)',
            }}
          >
            <div
              className="absolute top-0 left-0 right-0 h-px"
              style={{ background: 'linear-gradient(90deg, transparent, #f59e0b 40%, #fbbf24 60%, transparent)' }}
            />
            <p
              className="font-display font-black uppercase tracking-widest"
              style={{ color: '#f59e0b', fontSize: 'clamp(20px, 3.13vw, 60px)', marginBottom: '2.08vw' }}
            >
              Points Awarded!
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.04vw' }}>
              {(scorePopupDeltas ?? []).map(({ name, delta }) => (
                <div key={name} className="flex items-center justify-between" style={{ gap: '5vw' }}>
                  <span className="font-display font-bold text-white" style={{ fontSize: 'clamp(18px, 2.6vw, 50px)' }}>
                    {name}
                  </span>
                  <span
                    className="font-display font-black"
                    style={{ color: delta > 0 ? '#4ade80' : '#f87171', fontSize: 'clamp(18px, 2.6vw, 50px)' }}
                  >
                    {delta > 0 ? '+' : ''}{delta}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Top voters overlay */}
      {showTopVoters && !showLeaderboardModal && (
        <TopVotersOverlay voterScores={voterScores ?? {}} />
      )}

      {/* Leaderboard modal */}
      {showLeaderboardModal && <LeaderboardModal players={players} />}

      {/* Show Logo overlay — above all other overlays */}
      {(gameState.showLogo ?? false) && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.95)' }}
        >
          <img
            src="/logo.png"
            alt="Lie Hard"
            style={{ maxWidth: '70vw', maxHeight: '70vh', objectFit: 'contain' }}
          />
        </div>
      )}
    </div>
  );
}
