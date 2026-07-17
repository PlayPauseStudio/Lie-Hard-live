import type { AppSocket } from '../types';
import type { HandlerCtx } from './operator';
import type { TokenBucketLimiter } from '../../util/rateLimit';
import { logger } from '../../util/logger';
import { AUD, type Ack } from '../../protocol/events';
import { registerVoter, getVoter } from '../../persistence/voters';
import { getCurrentVotingRound, validateChoice } from '../../game/voting';
import { registerSchema, voteSchema } from '../../validation/schemas';

export function registerAudienceHandlers(
  socket: AppSocket,
  ctx: HandlerCtx,
  limiter: TokenBucketLimiter,
): void {
  const { store, broadcaster } = ctx;

  // ── aud:register ───────────────────────────────────────────────────────────
  socket.on(AUD.REGISTER, async (payload: unknown, ack?: (a: Ack) => void) => {
    const cb = typeof ack === 'function' ? ack : () => {};
    const uid = socket.data.uid;
    if (socket.data.role !== 'audience' || !uid) {
      cb({ ok: false, error: 'forbidden' });
      return;
    }
    const parsed = registerSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      cb({ ok: false, error: 'bad_payload' });
      return;
    }
    try {
      const rec = await registerVoter(uid, parsed.data);
      socket.data.name = rec.name; // cache for vote displayName
      cb({ ok: true, registered: true });
    } catch (e) {
      logger.error({ err: e instanceof Error ? e.message : e }, 'Register failed');
      cb({ ok: false, error: 'server_error' });
    }
  });

  // ── aud:vote ───────────────────────────────────────────────────────────────
  socket.on(AUD.VOTE, async (payload: unknown, ack?: (a: Ack) => void) => {
    const cb = typeof ack === 'function' ? ack : () => {};
    const uid = socket.data.uid;
    if (socket.data.role !== 'audience' || !uid) {
      logger.warn({ role: socket.data.role }, 'aud:vote rejected — not an audience socket');
      cb({ ok: false, error: 'forbidden' });
      return;
    }
    if (!limiter.take(uid)) {
      logger.warn({ uid }, 'aud:vote rejected — rate limited');
      cb({ ok: false, error: 'rate_limited' });
      return;
    }
    const parsed = voteSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      cb({ ok: false, error: 'bad_payload' });
      return;
    }

    // The server — never the client — decides which round the vote belongs to.
    const gs = store.getState();
    const round = getCurrentVotingRound(gs);
    if (!round) {
      logger.warn({ uid, choice: parsed.data.choice }, 'aud:vote rejected — no open round');
      cb({ ok: false, error: 'no_open_round' });
      return;
    }
    const invalid = validateChoice(gs, round, parsed.data.choice);
    if (invalid) {
      logger.warn({ uid, round, choice: parsed.data.choice, reason: invalid }, 'aud:vote rejected — invalid choice');
      cb({ ok: false, error: invalid });
      return;
    }

    // Record the vote immediately and ack — never block on the Firestore name
    // lookup, which for a returning voter could otherwise delay or hang the vote.
    store.recordVote(uid, {
      choice: parsed.data.choice,
      votingRound: round,
      displayName: socket.data.name,
      ts: Date.now(),
    });
    broadcaster.markVotesDirty();
    cb({ ok: true, choice: parsed.data.choice, votingRound: round });
    logger.info({ uid, round, choice: parsed.data.choice }, 'aud:vote recorded');

    // Backfill the display name for returning voters in the background.
    if (!socket.data.name) {
      getVoter(uid)
        .then((v) => { if (v?.name) socket.data.name = v.name; })
        .catch(() => {});
    }
  });
}
