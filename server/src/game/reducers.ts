import type { GameState, Player, Phase, WarmupStatement, Segment1Statement, Segment2Statement } from './state';
import { initialGameState, SEG1_POINTS, SEG2_POINTS, SEG3_POINTS } from './state';
import { answerSwapDelta, awardVoterScores, computeSegmentAward, voterScoreSwap } from './scoring';

/**
 * Each reducer is a pure function of (state, payload) that returns the changed
 * top-level slices of GameState. The store shallow-merges the result and bumps
 * the version. This mirrors the dot-path db_update() calls in the original
 * client operator page, but with the server as the single authority.
 */
export type Patch = Partial<GameState>;

export type SegmentKey = 'segment1' | 'segment2';
export type VoteSegmentKey = 'warmup' | 'segment1' | 'segment2' | 'segment3';
export type DisplayKey =
  | 'showScoreboard'
  | 'showLeaderboardModal'
  | 'showScorePopup'
  | 'showVoteBars'
  | 'showLogo'
  | 'showTopVoters'
  | 'showAudienceLink';

function emptyPlayerVotes(players: Player[]): Record<number, null> {
  return Object.fromEntries(players.map((p) => [p.id, null]));
}

// ── Setup / lifecycle ──────────────────────────────────────────────────────

export interface StartShowPayload {
  players: { id: number; name: string; photo?: string }[];
  warmup: WarmupStatement[];
  segment1: Segment1Statement[];
  segment2: Segment2Statement[];
  segment3: { photoUrl?: string | null; photoTitle?: string | null };
}

/** Full replacement state for a new show (returns a complete GameState). */
export function buildStartState(payload: StartShowPayload): GameState {
  const init = initialGameState();
  const players: Player[] = payload.players.map((p) => ({
    id: p.id,
    name: p.name.trim(),
    score: 0,
    photo: p.photo || `/player${p.id}.png`,
  }));
  const playerVotes = emptyPlayerVotes(players);
  return {
    ...init,
    phase: 'WARMUP',
    players,
    warmup: { ...init.warmup, statements: payload.warmup },
    segment1: { ...init.segment1, statements: payload.segment1, playerVotes },
    segment2: { ...init.segment2, statements: payload.segment2, playerVotes },
    segment3: {
      ...init.segment3,
      photoUrl: payload.segment3.photoUrl ?? null,
      photoTitle: payload.segment3.photoTitle ?? null,
    },
  };
}

export function gotoPhase(_state: GameState, phase: Phase): Patch {
  // Vote bars default OFF at the start of each round/segment; operator opts in.
  return { phase, showVoteBars: false };
}

// ── Warmup ──────────────────────────────────────────────────────────────────

export function warmupNav(state: GameState, index: number): Patch {
  return {
    warmup: { ...state.warmup, currentIndex: index, audienceVotingOpen: false, showResult: false },
    audienceVotes: {},
    showVoteBars: false,
  };
}

// ── Voting open/lock (all phases) ────────────────────────────────────────────

export function setVoteOpen(state: GameState, segment: VoteSegmentKey, open: boolean): Patch {
  return { [segment]: { ...state[segment], audienceVotingOpen: open } } as Patch;
}

// ── Reveal (sets showResult + tallies voter scores) ──────────────────────────

export function reveal(state: GameState, segment: VoteSegmentKey): Patch {
  if (segment === 'warmup') {
    const w = state.warmup;
    const stmt = w.statements[w.currentIndex];
    const correct = stmt?.isLie ? 'LIE' : 'TRUTH';
    return {
      warmup: { ...w, showResult: true, audienceVotingOpen: false },
      voterScores: awardVoterScores(state, `warmup-${w.currentIndex}`, correct),
    };
  }
  if (segment === 'segment1') {
    const s = state.segment1;
    const stmt = s.statements.find((x) => x.playerId === s.currentStorytellerId);
    if (!stmt) return { segment1: { ...s, showResult: true } };
    const correct = stmt.isLie ? 'LIE' : 'TRUTH';
    return {
      segment1: { ...s, showResult: true },
      voterScores: awardVoterScores(state, `seg1-${s.currentStorytellerId}`, correct),
    };
  }
  if (segment === 'segment2') {
    const s = state.segment2;
    const stmt = s.statements.find((x) => x.playerId === s.currentStorytellerId);
    if (!stmt) return { segment2: { ...s, showResult: true } };
    return {
      segment2: { ...s, showResult: true },
      voterScores: awardVoterScores(state, `seg2-${s.currentStorytellerId}`, `STATEMENT_${stmt.lieIndex}`),
    };
  }
  // segment3 reveal happens via awardSegment3
  return {};
}

// ── Storyteller selection (seg1 / seg2) ──────────────────────────────────────

export function selectStoryteller(state: GameState, segment: SegmentKey, playerId: number): Patch {
  const playerVotes = emptyPlayerVotes(state.players);
  if (segment === 'segment1') {
    return {
      // Vote bars default OFF for each new storyteller's round; operator opts in.
      showVoteBars: false,
      segment1: {
        ...state.segment1,
        currentStorytellerId: playerId,
        playerVotes,
        audienceVotingOpen: false,
        showResult: false,
        statementShown: false,
        // Each storyteller's round starts at the default value; the operator can bump it.
        points: SEG1_POINTS,
      },
    };
  }
  return {
    showVoteBars: false,
    segment2: {
      ...state.segment2,
      currentStorytellerId: playerId,
      playerVotes,
      audienceVotingOpen: false,
      showResult: false,
      revealedStatements: [],
      points: SEG2_POINTS,
    },
  };
}

// ── Per-round points (operator-adjustable award value) ────────────────────────

export function setSegmentPoints(
  state: GameState,
  segment: 'segment1' | 'segment2' | 'segment3',
  points: number,
): Patch {
  return { [segment]: { ...state[segment], points } } as Patch;
}

// ── Audience link button (URL + label; shown via toggleDisplay) ───────────────

export function setAudienceLink(_state: GameState, url: string, label: string): Patch {
  return { audienceLink: url, audienceLinkLabel: label };
}

// ── Operator-logged player votes (seg1 / seg2) ───────────────────────────────

export function setPlayerVote(state: GameState, segment: SegmentKey, playerId: number, vote: string): Patch {
  const seg = state[segment];
  return { [segment]: { ...seg, playerVotes: { ...seg.playerVotes, [playerId]: vote } } } as Patch;
}

// ── Statement reveal toggles (show the statement text on the display) ─────────

export function toggleSeg1Statement(state: GameState): Patch {
  return { segment1: { ...state.segment1, statementShown: !state.segment1.statementShown } };
}

export function toggleStatement(state: GameState, index: number): Patch {
  const revealed = state.segment2.revealedStatements ?? [];
  const next = revealed.includes(index) ? revealed.filter((x) => x !== index) : [...revealed, index];
  return { segment2: { ...state.segment2, revealedStatements: next } };
}

// ── Live content edits (operator fixes a statement/answer/object mid-show) ─────

export function editSeg1Statement(
  state: GameState,
  playerId: number,
  statement: string,
  isLie: boolean,
): Patch {
  const s = state.segment1;
  const prev = s.statements.find((x) => x.playerId === playerId);
  const patch: Patch = {
    segment1: {
      ...s,
      statements: s.statements.map((x) => (x.playerId === playerId ? { ...x, statement, isLie } : x)),
    },
  };
  // If the answer changed on an already-revealed/awarded round, re-score it.
  if (prev && prev.isLie !== isLie) {
    const oldChoice = prev.isLie ? 'LIE' : 'TRUTH';
    const newChoice = isLie ? 'LIE' : 'TRUTH';
    if (s.showResult || s.completedStorytellers.includes(playerId)) {
      patch.voterScores = voterScoreSwap(state, `seg1-${playerId}`, oldChoice, newChoice);
    }
    if (s.completedStorytellers.includes(playerId)) {
      const delta = answerSwapDelta(state.players, playerId, s.playerVotes, oldChoice, newChoice, s.points ?? SEG1_POINTS);
      patch.players = state.players.map((p) => ({ ...p, score: p.score + (delta[p.id] ?? 0) }));
    }
  }
  return patch;
}

export function editSeg2Statement(
  state: GameState,
  playerId: number,
  statements: string[],
  lieIndex: number,
): Patch {
  const s = state.segment2;
  const prev = s.statements.find((x) => x.playerId === playerId);
  // Clamp the lie index into the (possibly resized) statements array.
  const safeLie = Math.max(0, Math.min(lieIndex, statements.length - 1));
  const patch: Patch = {
    segment2: {
      ...s,
      statements: s.statements.map((x) => (x.playerId === playerId ? { ...x, statements, lieIndex: safeLie } : x)),
    },
  };
  // If the lie moved on an already-revealed/awarded round, re-score it.
  if (prev && prev.lieIndex !== safeLie) {
    const oldChoice = `STATEMENT_${prev.lieIndex}`;
    const newChoice = `STATEMENT_${safeLie}`;
    if (s.showResult || s.completedStorytellers.includes(playerId)) {
      patch.voterScores = voterScoreSwap(state, `seg2-${playerId}`, oldChoice, newChoice);
    }
    if (s.completedStorytellers.includes(playerId)) {
      const delta = answerSwapDelta(state.players, playerId, s.playerVotes, oldChoice, newChoice, s.points ?? SEG2_POINTS);
      patch.players = state.players.map((p) => ({ ...p, score: p.score + (delta[p.id] ?? 0) }));
    }
  }
  return patch;
}

export function editSeg3Object(
  state: GameState,
  photoUrl: string | null,
  photoTitle: string | null,
): Patch {
  return { segment3: { ...state.segment3, photoUrl, photoTitle } };
}

export function setSeg3Statement(state: GameState, playerId: number, statement: string): Patch {
  return {
    segment3: {
      ...state.segment3,
      playerStatements: { ...state.segment3.playerStatements, [playerId]: statement },
    },
  };
}

export function toggleSeg3Statement(state: GameState, playerId: number): Patch {
  const shown = state.segment3.shownStatements ?? [];
  const next = shown.includes(playerId) ? shown.filter((x) => x !== playerId) : [...shown, playerId];
  return { segment3: { ...state.segment3, shownStatements: next } };
}

// ── Award points (seg1 / seg2) ───────────────────────────────────────────────

export function awardSegment(state: GameState, segment: SegmentKey): Patch {
  const segNum = segment === 'segment1' ? 1 : 2;
  const { totals, deltas } = computeSegmentAward(state, segNum);
  const updatedPlayers = state.players.map((p) => ({ ...p, score: p.score + (totals[p.id] ?? 0) }));
  const seg = state[segment];
  return {
    players: updatedPlayers,
    [segment]: {
      ...seg,
      completedStorytellers: [...seg.completedStorytellers, seg.currentStorytellerId].filter(
        (x): x is number => x != null,
      ),
      // Keep currentStorytellerId, playerVotes and showResult so the operator can
      // still edit this round's answer and have the scores auto-re-award. showResult
      // stays true so the reveal can't be re-fired (which would double-tally voters).
      audienceVotingOpen: false,
    },
    scorePopupDeltas: deltas,
    showScorePopup: false,
  } as Patch;
}

export function awardSegment3(state: GameState, winnerId: number): Patch {
  const winner = state.players.find((p) => p.id === winnerId);
  const pts = state.segment3.points ?? SEG3_POINTS;
  const updatedPlayers = state.players.map((p) =>
    p.id === winnerId ? { ...p, score: p.score + pts } : p,
  );
  return {
    players: updatedPlayers,
    segment3: { ...state.segment3, winnerId, showResult: true },
    scorePopupDeltas: winner ? [{ name: winner.name, delta: pts }] : [],
    showScorePopup: false,
    voterScores: awardVoterScores(state, 'seg3', String(winnerId)),
  };
}

// ── Manual score adjust ──────────────────────────────────────────────────────

export function adjustScore(state: GameState, playerId: number, delta: number): Patch {
  return {
    players: state.players.map((p) => (p.id === playerId ? { ...p, score: p.score + delta } : p)),
  };
}

// ── Display toggles ──────────────────────────────────────────────────────────

export function toggleDisplay(_state: GameState, key: DisplayKey, value: boolean): Patch {
  return { [key]: value } as Patch;
}

// ── Banter timer (anchor-based; clients tick locally) ────────────────────────

export function timerStart(_state: GameState, totalSeconds: number): Patch {
  return { banterTimer: { totalSeconds, startedAt: Date.now(), running: true } };
}

export function timerStop(state: GameState): Patch {
  const bt = state.banterTimer;
  const remaining =
    bt.startedAt != null
      ? Math.max(0, bt.totalSeconds - Math.floor((Date.now() - bt.startedAt) / 1000))
      : bt.totalSeconds;
  return { banterTimer: { totalSeconds: remaining, startedAt: null, running: false } };
}

export function timerReset(_state: GameState, totalSeconds: number): Patch {
  return { banterTimer: { totalSeconds, startedAt: null, running: false } };
}

// ── Danger ───────────────────────────────────────────────────────────────────

export function deleteUserData(_state: GameState): Patch {
  return { audienceVotes: {}, voterScores: {} };
}
