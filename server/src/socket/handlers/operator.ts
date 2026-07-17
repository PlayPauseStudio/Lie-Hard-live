import type { ZodSchema } from 'zod';
import { z } from 'zod';
import type { RoomStore } from '../../game/store';
import { initialGameState } from '../../game/state';
import type { Broadcaster } from '../broadcast';
import type { AppSocket } from '../types';
import { logger } from '../../util/logger';
import { OP, type Ack } from '../../protocol/events';
import { clearAllVoters } from '../../persistence/voters';
import * as R from '../../game/reducers';
import * as S from '../../validation/schemas';

const empty = z.object({}).default({});

export interface HandlerCtx {
  store: RoomStore;
  broadcaster: Broadcaster;
}

export function registerOperatorHandlers(socket: AppSocket, ctx: HandlerCtx): void {
  const { store, broadcaster } = ctx;

  /** Apply a reducer patch and broadcast the delta. */
  const apply = (patch: R.Patch): void => {
    store.applyPatch(patch);
    broadcaster.broadcastPatch(patch);
  };

  /** Register an operator event: role guard + zod validation + ack + errors. */
  function on<T>(event: string, schema: ZodSchema<T>, body: (data: T) => void | Promise<void>): void {
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
        await body(parsed.data);
        cb({ ok: true });
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

  on(OP.AWARD_SEGMENT, S.awardSegmentSchema, (d) => apply(R.awardSegment(store.getState(), d.segment)));

  on(OP.AWARD_SEGMENT3, S.awardSegment3Schema, (d) =>
    apply(R.awardSegment3(store.getState(), d.winnerId)),
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

  on(OP.RESET_GAME, empty, () => {
    store.replace(initialGameState());
    broadcaster.broadcastFull();
  });

  on(OP.DELETE_USER_DATA, empty, async () => {
    apply(R.deleteUserData(store.getState()));
    const count = await clearAllVoters();
    logger.info({ count }, 'Operator deleted user data');
  });
}
