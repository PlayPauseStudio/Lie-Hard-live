/**
 * End-to-end smoke test against a running lie-hard-server.
 *
 *   1. Start the server in dev mode (no Firebase/Redis needed):
 *        npm run dev
 *   2. In another shell:
 *        npm run smoke
 *
 * Exercises the security guarantees: operator-only control, audience can only
 * vote while a round is open, one-vote-per-round, and non-operator rejection.
 */
import { io, type Socket } from 'socket.io-client';

const URL = process.env.SERVER_URL ?? 'http://localhost:8080';
const PASSWORD = process.env.OPERATOR_PASSWORD ?? 'letmein';

let failures = 0;
function check(name: string, cond: boolean): void {
  // eslint-disable-next-line no-console
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${name}`);
  if (!cond) failures++;
}

function connect(auth: Record<string, unknown>): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(URL, { auth, transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(e));
    setTimeout(() => reject(new Error('connect timeout')), 5000);
  });
}

function emit(s: Socket, event: string, payload: unknown): Promise<{ ok: boolean; error?: string; votingRound?: string | null }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'ack_timeout' }), 5000);
    s.emit(event, payload, (ack: { ok: boolean; error?: string; votingRound?: string | null }) => {
      clearTimeout(timer);
      resolve(ack ?? { ok: false, error: 'no_ack' });
    });
  });
}

// Resolve the next state delivery, normalizing full (`state`) and patch
// (`changed`) into a single object of changed slices.
const nextState = (s: Socket): Promise<any> =>
  new Promise((resolve) => {
    const onFull = (m: any) => { s.off('state:patch', onPatch); resolve(m.state); };
    const onPatch = (m: any) => { s.off('state:full', onFull); resolve(m.changed); };
    s.once('state:full', onFull);
    s.once('state:patch', onPatch);
  });

async function main(): Promise<void> {
  // ── Operator login (HTTP) ──────────────────────────────────────────────────
  const res = await fetch(`${URL}/auth/operator/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  check('operator login returns 200', res.ok);
  const { token } = (await res.json()) as { token: string };
  check('operator login returns a token', typeof token === 'string' && token.length > 0);

  const badLogin = await fetch(`${URL}/auth/operator/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' }),
  });
  check('wrong password rejected (401)', badLogin.status === 401);

  // ── Connections ─────────────────────────────────────────────────────────────
  const operator = await connect({ role: 'operator', token });
  const display = await connect({ role: 'display' });
  const alice = await connect({ role: 'audience', token: 'uid-alice' }); // dev: token == uid
  const bob = await connect({ role: 'audience', token: 'uid-bob' });
  check('operator/display/audience all connect', true);

  // Forged operator token must be rejected at the handshake.
  let forgedRejected = false;
  try {
    await connect({ role: 'operator', token: 'not-a-jwt' });
  } catch {
    forgedRejected = true;
  }
  check('forged operator token rejected at handshake', forgedRejected);

  // ── Start show ──────────────────────────────────────────────────────────────
  const startAck = await emit(operator, 'op:startShow', {
    players: [
      { id: 1, name: 'P1', photo: '' },
      { id: 2, name: 'P2', photo: '' },
      { id: 3, name: 'P3', photo: '' },
    ],
    warmup: [{ statement: 'The sky is green', isLie: true }],
    segment1: [
      { playerId: 1, playerName: 'P1', statement: 's', isLie: false },
      { playerId: 2, playerName: 'P2', statement: 's', isLie: true },
      { playerId: 3, playerName: 'P3', statement: 's', isLie: false },
    ],
    segment2: [{ playerId: 1, playerName: 'P1', statements: ['a', 'b'], lieIndex: 1 }],
    segment3: { photoUrl: null, photoTitle: null },
  });
  check('operator can start show', startAck.ok);

  // Audience must NOT be able to drive the show.
  const spoof = await emit(alice, 'op:gotoPhase', { phase: 'FINAL' });
  check('audience cannot emit operator control (forbidden)', !spoof.ok && spoof.error === 'forbidden');

  // ── Vote gating ─────────────────────────────────────────────────────────────
  const voteClosed = await emit(alice, 'aud:vote', { choice: 'TRUTH' });
  check('vote rejected before round opens', !voteClosed.ok && voteClosed.error === 'no_open_round');

  await emit(operator, 'op:openVote', { segment: 'warmup' });
  const aliceVote = await emit(alice, 'aud:vote', { choice: 'TRUTH' });
  check('vote accepted once round is open', aliceVote.ok && aliceVote.votingRound === 'warmup-0');

  const aliceInvalid = await emit(alice, 'aud:vote', { choice: 'BANANA' });
  check('invalid choice rejected', !aliceInvalid.ok && aliceInvalid.error === 'invalid_choice');

  // Change vote (still one vote for the round).
  await emit(alice, 'aud:vote', { choice: 'LIE' });
  await emit(bob, 'aud:vote', { choice: 'TRUTH' });

  // Let the throttled tally flush reach the operator/display room.
  await new Promise((r) => setTimeout(r, 400));

  await emit(operator, 'op:lockVote', { segment: 'warmup' });
  const voteAfterLock = await emit(alice, 'aud:vote', { choice: 'TRUTH' });
  check('vote rejected after lock', !voteAfterLock.ok && voteAfterLock.error === 'no_open_round');

  // ── Reveal awards voter scores authoritatively ─────────────────────────────
  // Register the state listener BEFORE emitting so we don't miss the broadcast.
  const revealState = nextState(operator);
  await emit(operator, 'op:reveal', { segment: 'warmup' });
  const changed = await revealState;
  // Alice changed to LIE (correct, sky is green = lie), Bob TRUTH (wrong).
  const scores = changed?.voterScores ?? {};
  check('reveal credits only the correct voter', scores['uid-alice']?.correctCount === 1 && !scores['uid-bob']);

  // eslint-disable-next-line no-console
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);

  [operator, display, alice, bob].forEach((s) => s.close());
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('smoke test error:', e);
  process.exit(1);
});
