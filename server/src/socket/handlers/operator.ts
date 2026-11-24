import type { ZodSchema } from 'zod';
import { z } from 'zod';
import type { RoomStore } from '../../game/store';
import { initialGameState, type GameState } from '../../game/state';
import type { Broadcaster } from '../broadcast';
import type { AppSocket } from '../types';
import { logger } from '../../util/logger';
import { OP, type Ack } from '../../protocol/events';
import { clearAllVoters, listVoters } from '../../persistence/voters';
import { logImposterRound, logScoreChanges, logSegment3Round, logSegmentRound } from '../../game/history';
import { getCurrentVotingRound } from '../../game/voting';
import { worstStallMs } from '../../util/loadMonitor';
import * as R from '../../game/reducers';
import * as S from '../../validation/schemas';

const empty = z.object({}).default({});

/** Events that replace the whole show (and its score log). */
const FRESH_START = new Set<string>([OP.START_SHOW, OP.RESET_GAME, OP.SOFT_REFRESH]);

/** Which segment an event's score changes belong to (so a reset can undo them). */
function scoredSegment(event: string, data: unknown): R.VoteSegmentKey | null {
  switch (event) {
    case OP.REVEAL:
    case OP.AWARD_SEGMENT:
      return (data as { segment: R.VoteSegmentKey }).segment;
    case OP.AWARD_SEGMENT3:
      return 'segment3';
    case OP.EDIT_SEG1:
      return 'segment1';
    case OP.EDIT_SEG2:
      return 'segment2';
    case OP.IMPOSTER_SET:
    case OP.IMPOSTER_PICK:
    case OP.AWARD_IMPOSTER:
      return 'imposter';
    default:
      return null;
  }
}

/** Add whatever panel and audience scores moved to that segment's ledger (in place). */
function recordLedger(before: GameState, after: GameState, segment: string): void {
  const led = (after.segmentLedger[segment] ??= { players: {}, voters: {} });
  if (after.players !== before.players) {
    const prev = new Map(before.players.map((p) => [p.id, p.score]));
    for (const p of after.players) {
      const d = p.score - (prev.get(p.id) ?? p.score);
      if (d) led.players[p.id] = (led.players[p.id] ?? 0) + d;
    }
  }
  if (after.voterScores !== before.voterScores) {
    const uids = new Set([...Object.keys(before.voterScores), ...Object.keys(after.voterScores)]);
    for (const uid of uids) {
      const d = (after.voterScores[uid]?.correctCount ?? 0) - (before.voterScores[uid]?.correctCount ?? 0);
      if (d) led.voters[uid] = (led.voters[uid] ?? 0) + d;
    }
  }
}

const ROUND_LOG_NAME: Record<R.VoteSegmentKey, string> = {
  warmup: 'Warm-up',
  segment1: 'Segment 1',
  segment2: 'Segment 2',
  segment3: 'Segment 3',
  imposter: 'Imposter',
};

export interface ServerInfo {
  /** Sockets currently connected per role. */
  online(): { operators: number; displays: number; phones: number };
  /** Redis snapshot status. */
  snapshots(): string;
  /** When the last snapshot reached Redis (ms), or null. */
  lastSavedAt(): number | null;
}

export interface HandlerCtx {
  store: RoomStore;
  broadcaster: Broadcaster;
  info: ServerInfo;
}

export function registerOperatorHandlers(socket: AppSocket, ctx: HandlerCtx): void {
  const { store, broadcaster } = ctx;

  /** Apply a reducer patch and broadcast the delta. */
  const apply = (patch: R.Patch): void => {
    store.applyPatch(patch);
    broadcaster.broadcastPatch(patch);
  };

  /** Register an operator event: role guard + zod validation + ack + errors. */
  function on<T>(
    event: string,
    schema: ZodSchema<T>,
    body: (data: T) => void | Partial<Ack> | Promise<void | Partial<Ack>>,
  ): void {
    socket.on(event, async (payload: unknown, ack?: (a: Ack) => void) => {
      const cb = typeof ack === 'function' ? ack : () => {};
      if (socket.data.role !== 'operator') {
        cb({ ok: false, error: 'forbidden' });
        return;
      }
      const parsed = schema.safeParse(payload ?? {});
      if (!parsed.success) {
        cb({ ok: false, error: 'bad_payload' });
        return;
      }
      try {
        const before = store.getState();
        const extra = await body(parsed.data);
        // Any score that moved goes in the export's score log, whatever caused it.
        const after = store.getState();
        // (Not for a new show or a reset: those start a fresh log.)
        if (after !== before && after.players !== before.players && !FRESH_START.has(event))
          logScoreChanges(before, after, event);
        const seg = after !== before ? scoredSegment(event, parsed.data) : null;
        if (seg) recordLedger(before, after, seg);
        cb({ ok: true, ...(extra ?? {}) });
      } catch (e) {
        logger.error({ event, err: e instanceof Error ? e.message : e }, 'Operator handler error');
        cb({ ok: false, error: 'server_error' });
      }
    });
  }

  on(OP.START_SHOW, S.startShowSchema, (d) => {
    store.replace(R.buildStartState(d));
    broadcaster.broadcastFull();
  });

  on(OP.GOTO_PHASE, S.gotoPhaseSchema, (d) => apply(R.gotoPhase(store.getState(), d.phase)));

  on(OP.WARMUP_NAV, S.warmupNavSchema, (d) => apply(R.warmupNav(store.getState(), d.index)));

  on(OP.OPEN_VOTE, S.voteSegmentSchema, (d) => apply(R.setVoteOpen(store.getState(), d.segment, true)));
  on(OP.LOCK_VOTE, S.voteSegmentSchema, (d) => apply(R.setVoteOpen(store.getState(), d.segment, false)));

  on(OP.REVEAL, S.voteSegmentSchema, (d) => apply(R.reveal(store.getState(), d.segment)));

  on(OP.SELECT_STORYTELLER, S.selectStorytellerSchema, (d) =>
    apply(R.selectStoryteller(store.getState(), d.segment, d.playerId)),
  );

  on(OP.SET_PLAYER_VOTE, S.setPlayerVoteSchema, (d) =>
    apply(R.setPlayerVote(store.getState(), d.segment, d.playerId, d.vote)),
  );

  on(OP.TOGGLE_STATEMENT, S.toggleStatementSchema, (d) =>
    apply(R.toggleStatement(store.getState(), d.index)),
  );

  on(OP.TOGGLE_SEG1_STATEMENT, empty, () => apply(R.toggleSeg1Statement(store.getState())));

  on(OP.EDIT_SEG1, S.editSeg1Schema, (d) =>
    apply(R.editSeg1Statement(store.getState(), d.playerId, d.statement, d.isLie)),
  );

  on(OP.EDIT_SEG2, S.editSeg2Schema, (d) =>
    apply(R.editSeg2Statement(store.getState(), d.playerId, d.statements, d.lieIndex)),
  );

  on(OP.EDIT_SEG3, S.editSeg3Schema, (d) =>
    apply(R.editSeg3Object(store.getState(), d.photoUrl, d.photoTitle)),
  );

  on(OP.SET_SEG3_STATEMENT, S.setSeg3StatementSchema, (d) =>
    apply(R.setSeg3Statement(store.getState(), d.playerId, d.statement)),
  );

  on(OP.TOGGLE_SEG3_STATEMENT, S.toggleSeg3StatementSchema, (d) =>
    apply(R.toggleSeg3Statement(store.getState(), d.playerId)),
  );

  on(OP.AWARD_SEGMENT, S.awardSegmentSchema, (d) => {
    logSegmentRound(store.getState(), d.segment);
    apply(R.awardSegment(store.getState(), d.segment));
  });

  on(OP.AWARD_SEGMENT3, S.awardSegment3Schema, (d) => {
    logSegment3Round(store.getState(), d.winnerId);
    apply(R.awardSegment3(store.getState(), d.winnerId));
  }
  );

  // ── Imposter round ─────────────────────────────────────────────────────────
  on(OP.IMPOSTER_SETUP, S.imposterSetupSchema, (d) =>
    apply(R.setImposterSetup(store.getState(), d.title, d.contestants)),
  );
  on(OP.IMPOSTER_STATEMENT, S.imposterStatementSchema, (d) =>
    apply(R.setImposterStatement(store.getState(), d.contestantId, d.statement)),
  );
  on(OP.IMPOSTER_TOGGLE_STATEMENT, S.imposterToggleSchema, (d) =>
    apply(R.toggleImposterStatement(store.getState(), d.contestantId)),
  );
  on(OP.IMPOSTER_SET, S.imposterSetSchema, (d) => apply(R.setImposterId(store.getState(), d.imposterId)));
  on(OP.IMPOSTER_PICK, S.imposterPickSchema, (d) =>
    apply(R.setImposterPick(store.getState(), d.playerId, d.contestantId)),
  );
  on(OP.AWARD_IMPOSTER, empty, () => {
    const patch = R.awardImposter(store.getState());
    if (!patch.imposter) return;
    logImposterRound(store.getState());
    apply(patch);
  });

  on(OP.SET_SEGMENT_POINTS, S.setSegmentPointsSchema, (d) =>
    apply(R.setSegmentPoints(store.getState(), d.segment, d.points)),
  );

  on(OP.RESET_SEGMENT, S.resetSegmentSchema, (d) => {
    const s = store.getState();
    const patch = R.resetSegment(s, d.segment);
    delete s.segmentLedger[d.segment];
    // The replay's votes and rounds take the old ones' place in the export.
    for (const h of Object.values(s.voteHistory))
      for (const round of Object.keys(h.votes)) if (R.roundSegment(round) === d.segment) delete h.votes[round];
    for (let i = s.roundLog.length - 1; i >= 0; i--)
      if (s.roundLog[i].segment === ROUND_LOG_NAME[d.segment]) s.roundLog.splice(i, 1);
    apply(patch);
  });

  on(OP.SET_SCREEN_TEXT, S.setScreenTextSchema, (d) => apply(R.setScreenText(store.getState(), d.key, d.text)));

  on(OP.SET_AUDIENCE_LINK, S.setAudienceLinkSchema, (d) =>
    apply(R.setAudienceLink(store.getState(), d.url, d.label)),
  );

  on(OP.ADJUST_SCORE, S.adjustScoreSchema, (d) =>
    apply(R.adjustScore(store.getState(), d.playerId, d.delta)),
  );

  on(OP.TOGGLE_DISPLAY, S.toggleDisplaySchema, (d) =>
    apply(R.toggleDisplay(store.getState(), d.key, d.value)),
  );

  on(OP.TIMER_START, S.timerStartSchema, (d) => apply(R.timerStart(store.getState(), d.totalSeconds)));
  on(OP.TIMER_STOP, empty, () => apply(R.timerStop(store.getState())));
  on(OP.TIMER_RESET, S.timerResetSchema, (d) => apply(R.timerReset(store.getState(), d.totalSeconds)));

  /**
   * Both resets start a new episode: the state goes out first (phones see the
   * new episode and sign out), then every voter sign-up is deleted so they
   * register again after signing back in.
   */
  async function newEpisode(next: GameState, what: string): Promise<Partial<Ack>> {
    store.replace(next);
    broadcaster.broadcastFull();
    try {
      const count = await clearAllVoters();
      logger.info({ count }, `${what}: voter sign-ups cleared`);
      return {};
    } catch (e) {
      logger.error({ err: e instanceof Error ? e.message : e }, `${what}: clearing voter sign-ups failed`);
      return { warning: 'voters_not_cleared' };
    }
  }

  on(OP.RESET_GAME, empty, () => newEpisode(initialGameState(), 'Full reset'));
  on(OP.SOFT_REFRESH, empty, () => newEpisode(R.softRefresh(store.getState()), 'Soft refresh'));

  // ── Export (read-only): the history no screen gets, plus voter sign-ups ────
  on(OP.EXPORT_DATA, empty, async () => {
    const s = store.getState();
    let voters: Awaited<ReturnType<typeof listVoters>> = [];
    let votersError = false;
    try {
      voters = await listVoters();
    } catch (e) {
      votersError = true;
      logger.error({ err: e instanceof Error ? e.message : e }, 'Export: reading voter sign-ups failed');
    }
    return {
      export: {
        exportedAt: Date.now(),
        episodeStartedAt: s.episodeStartedAt,
        voters,
        votersError,
        voteHistory: s.voteHistory,
        scoreLog: s.scoreLog,
        roundLog: s.roundLog,
      },
    };
  });

  // ── Status strip (read-only, polled every few seconds) ─────────────────────
  on(OP.STATUS, empty, () => {
    const s = store.getState();
    const round = getCurrentVotingRound(s);
    const saved = ctx.info.lastSavedAt();
    return {
      status: {
        serverTime: Date.now(),
        online: ctx.info.online(),
        votingRound: round,
        votesNow: round ? Object.values(s.audienceVotes).filter((v) => v.votingRound === round).length : 0,
        voters: Object.keys(s.audienceVotes).length,
        worstStallMs: worstStallMs(),
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        snapshots: ctx.info.snapshots(),
        savedAgoMs: saved ? Date.now() - saved : null,
        uptimeS: Math.round(process.uptime()),
      },
    };
  });
}
