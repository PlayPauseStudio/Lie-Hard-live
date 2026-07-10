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
      cb({ ok: false, error: 'forbidden' });
      return;
    }
    if (!limiter.take(uid)) {
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
      cb({ ok: false, error: 'no_open_round' });
      return;
    }
    const invalid = validateChoice(gs, round, parsed.data.choice);
    if (invalid) {
      cb({ ok: false, error: invalid });
      return;
    }

    // Resolve display name (cached, or one lazy lookup for returning voters).
    let name = socket.data.name;
    if (!name) {
      const v = await getVoter(uid).catch(() => null);
      name = v?.name;
      socket.data.name = name;
    }

    store.recordVote(uid, { choice: parsed.data.choice, votingRound: round, displayName: name, ts: Date.now() });
    broadcaster.markVotesDirty();
    cb({ ok: true, choice: parsed.data.choice, votingRound: round });
  });
}
