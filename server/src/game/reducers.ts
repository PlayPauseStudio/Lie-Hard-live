import type { GameState, Player, Phase, WarmupStatement, Segment1Statement, Segment2Statement, ImposterContestant, ScreenText } from './state';
import { initialGameState, initialImposter, initialScreenText, SEG1_POINTS, SEG2_POINTS, SEG3_POINTS } from './state';
import { answerSwapDelta, awardVoterScores, computeSegmentAward, voterScoreSwap } from './scoring';

/**
 * Each reducer is a pure function of (state, payload) that returns the changed
 * top-level slices of GameState. The store shallow-merges the result and bumps
 * the version. This mirrors the dot-path db_update() calls in the original
 * client operator page, but with the server as the single authority.
 */
export type Patch = Partial<GameState>;

export type SegmentKey = 'segment1' | 'segment2';
export type VoteSegmentKey = 'warmup' | 'segment1' | 'segment2' | 'segment3' | 'imposter';
export type DisplayKey =
  | 'showScoreboard'
  | 'showLeaderboardModal'
  | 'showScorePopup'
  | 'showVoteBars'
  | 'showLogo'
  | 'showTopVoters'
  | 'showAudienceLink'
  | 'showVotingStatus';

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
  imposter?: { title: string; contestants: ImposterContestant[] };
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
    imposter: {
      ...init.imposter,
      ...(payload.imposter ?? {}),
      playerVotes: emptyPlayerVotes(players),
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
  if (segment === 'imposter') {
    // The answer has to be in before the reveal (the operator may only decide now).
    const im = state.imposter;
    if (im.imposterId == null) return {};
    return {
      imposter: { ...im, showResult: true, audienceVotingOpen: false },
      voterScores: awardVoterScores(state, 'imposter', String(im.imposterId)),
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
  segment: 'segment1' | 'segment2' | 'segment3' | 'imposter',
  points: number,
): Patch {
  // Imposter re-scoring assumes the value it was awarded at.
  if (segment === 'imposter' && state.imposter.awarded) return {};
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

// ── Imposter round ───────────────────────────────────────────────────────────

/** Title and crowd-member names: filled in at setup, editable live. */
export function setImposterSetup(state: GameState, title: string, contestants: ImposterContestant[]): Patch {
  const im = state.imposter;
  const ids = new Set(contestants.map((c) => c.id));
  const keep = <T>(rec: Record<number, T>): Record<number, T> =>
    Object.fromEntries(Object.entries(rec).filter(([id]) => ids.has(Number(id)))) as Record<number, T>;
  return {
    imposter: {
      ...im,
      title: title.trim() || initialImposter().title,
      contestants: contestants.map((c) => ({ id: c.id, name: c.name.trim() })),
      statements: keep(im.statements),
      shownStatements: im.shownStatements.filter((id) => ids.has(id)),
      // A removed contestant can't stay the answer or anyone's pick.
      imposterId: im.imposterId != null && ids.has(im.imposterId) ? im.imposterId : null,
      playerVotes: Object.fromEntries(
        Object.entries(im.playerVotes).map(([pid, c]) => [pid, c != null && ids.has(c) ? c : null]),
      ),
    },
  };
}

export function setImposterStatement(state: GameState, contestantId: number, statement: string): Patch {
  const im = state.imposter;
  return { imposter: { ...im, statements: { ...im.statements, [contestantId]: statement } } };
}

export function toggleImposterStatement(state: GameState, contestantId: number): Patch {
  const im = state.imposter;
  const shown = im.shownStatements.includes(contestantId)
    ? im.shownStatements.filter((x) => x !== contestantId)
    : [...im.shownStatements, contestantId];
  return { imposter: { ...im, shownStatements: shown } };
}

/** Panel points for `answer`: the round's points to each panelist who picked it. */
function imposterPanelTotals(state: GameState, answer: number | null): Record<number, number> {
  const im = state.imposter;
  return Object.fromEntries(
    state.players.map((p) => [p.id, answer != null && im.playerVotes[p.id] === answer ? im.points : 0]),
  );
}

function addScores(players: Player[], delta: Record<number, number>): Player[] {
  return players.map((p) => ({ ...p, score: p.score + (delta[p.id] ?? 0) }));
}

/**
 * Set (or change) who the imposter is. Works before the round or at the reveal;
 * changing it after the reveal re-scores the audience, and after the award also
 * moves the panel's points.
 */
export function setImposterId(state: GameState, imposterId: number | null): Patch {
  const im = state.imposter;
  if (imposterId != null && !im.contestants.some((c) => c.id === imposterId)) return {};
  // Once revealed there must always be an answer on screen.
  if (imposterId == null && im.showResult) return {};
  const patch: Patch = { imposter: { ...im, imposterId } };
  if (im.showResult && im.imposterId != null && imposterId != null && im.imposterId !== imposterId) {
    patch.voterScores = voterScoreSwap(state, 'imposter', String(im.imposterId), String(imposterId));
  }
  if (im.awarded) {
    const before = imposterPanelTotals(state, im.imposterId);
    const after = imposterPanelTotals(state, imposterId);
    patch.players = addScores(
      state.players,
      Object.fromEntries(state.players.map((p) => [p.id, after[p.id] - before[p.id]])),
    );
  }
  return patch;
}

/** Log a panelist's pick. After the award, a changed pick re-scores that panelist. */
export function setImposterPick(state: GameState, playerId: number, contestantId: number | null): Patch {
  const im = state.imposter;
  if (contestantId != null && !im.contestants.some((c) => c.id === contestantId)) return {};
  const patch: Patch = { imposter: { ...im, playerVotes: { ...im.playerVotes, [playerId]: contestantId } } };
  if (im.awarded && im.imposterId != null) {
    const was = im.playerVotes[playerId] === im.imposterId ? im.points : 0;
    const now = contestantId === im.imposterId ? im.points : 0;
    if (was !== now) patch.players = addScores(state.players, { [playerId]: now - was });
  }
  return patch;
}

/** Give each panelist who spotted the imposter the round's points (once). */
export function awardImposter(state: GameState): Patch {
  const im = state.imposter;
  if (im.awarded || im.imposterId == null) return {};
  const totals = imposterPanelTotals(state, im.imposterId);
  return {
    players: addScores(state.players, totals),
    imposter: { ...im, awarded: true, showResult: true, audienceVotingOpen: false },
    scorePopupDeltas: state.players
      .filter((p) => totals[p.id] > 0)
      .map((p) => ({ name: p.name, delta: totals[p.id] })),
    showScorePopup: false,
    // Awarding also reveals, for when the operator skips the separate reveal.
    ...(im.showResult ? {} : { voterScores: awardVoterScores(state, 'imposter', String(im.imposterId)) }),
  };
}

// ── Segment reset (replay a segment, or clear it after testing) ────────────────

/** Which segment an audience voting round belongs to. */
export function roundSegment(round: string): VoteSegmentKey | null {
  if (round.startsWith('warmup-')) return 'warmup';
  if (round.startsWith('seg1-')) return 'segment1';
  if (round.startsWith('seg2-')) return 'segment2';
  if (round === 'seg3') return 'segment3';
  if (round === 'imposter') return 'imposter';
  return null;
}

/**
 * Put one segment back to the start, keeping its content (statements, names,
 * photo, edited headings). The panel points and audience correct-answers it
 * gave out are taken back, using what the segment ledger recorded; manual score
 * changes stay. The handler clears the ledger and the export history for it.
 */
export function resetSegment(state: GameState, segment: VoteSegmentKey): Patch {
  const init = initialGameState();
  const ledger = state.segmentLedger[segment];
  const patch: Patch = {
    audienceVotes: Object.fromEntries(
      Object.entries(state.audienceVotes).filter(([, v]) => roundSegment(v.votingRound) !== segment),
    ),
    showVoteBars: false,
    showScorePopup: false,
    scorePopupDeltas: [],
    votesResetAt: Date.now(),
  };
  if (ledger) {
    patch.players = addScores(
      state.players,
      Object.fromEntries(Object.entries(ledger.players).map(([id, n]) => [id, -n])),
    );
    const voterScores = { ...state.voterScores };
    for (const [uid, n] of Object.entries(ledger.voters)) {
      const v = voterScores[uid];
      if (!v) continue;
      const left = v.correctCount - n;
      if (left > 0) voterScores[uid] = { ...v, correctCount: left };
      else delete voterScores[uid];
    }
    patch.voterScores = voterScores;
  }
  switch (segment) {
    case 'warmup':
      patch.warmup = { ...init.warmup, statements: state.warmup.statements };
      break;
    case 'segment1':
      patch.segment1 = { ...init.segment1, statements: state.segment1.statements, playerVotes: emptyPlayerVotes(state.players) };
      break;
    case 'segment2':
      patch.segment2 = { ...init.segment2, statements: state.segment2.statements, playerVotes: emptyPlayerVotes(state.players) };
      break;
    case 'segment3':
      patch.segment3 = { ...init.segment3, photoUrl: state.segment3.photoUrl, photoTitle: state.segment3.photoTitle };
      break;
    case 'imposter':
      patch.imposter = {
        ...init.imposter,
        title: state.imposter.title,
        contestants: state.imposter.contestants,
        playerVotes: emptyPlayerVotes(state.players),
      };
      break;
  }
  return patch;
}

// ── Editable headings ────────────────────────────────────────────────────────

export function setScreenText(state: GameState, key: keyof ScreenText, text: string): Patch {
  // Cleared means back to the default wording.
  return { screenText: { ...state.screenText, [key]: text.trim() || initialScreenText()[key] } };
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

/**
 * Soft refresh: replay the show from the warm-up with the same players,
 * statements and Segment 3 photo. Scores, votes, voter scores and the live
 * Segment 3 notes are cleared, and a new episode starts (phones sign out).
 * Before the show has started there is nothing to replay, so it only clears
 * the audience side.
 */
export function softRefresh(state: GameState): GameState {
  const now = Date.now();
  if (state.phase === 'SETUP') {
    return { ...state, audienceVotes: {}, voterScores: {}, episodeStartedAt: now };
  }
  return {
    ...buildStartState({
      players: state.players,
      warmup: state.warmup.statements,
      segment1: state.segment1.statements,
      segment2: state.segment2.statements,
      segment3: { photoUrl: state.segment3.photoUrl, photoTitle: state.segment3.photoTitle },
      imposter: { title: state.imposter.title, contestants: state.imposter.contestants },
    }),
    audienceLink: state.audienceLink,
    audienceLinkLabel: state.audienceLinkLabel,
    showVotingStatus: state.showVotingStatus,
    screenText: state.screenText,
    episodeStartedAt: now,
  };
}
