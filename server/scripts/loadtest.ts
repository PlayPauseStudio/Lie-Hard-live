/**
 * Socket load test for the live server.
 *
 *   npx tsx scripts/loadtest.ts [N] [mode] [options]
 *
 * Modes:
 *   --join     AUDIENCE ONLY. Connect N fake audience, then vote in whatever
 *              round YOU open from the real operator panel — the script never
 *              touches the operator or advances the game, you control the flow.
 *              By default it votes in one round and exits; `--rounds <n>` keeps
 *              the N connected and votes once in each of the next <n> rounds you
 *              open (great for driving a whole show by hand under load).
 *              Needs LOADTEST_URL (+ LOADTEST_SECRET for Railway). No operator
 *              password required.
 *
 *   --game     DRIVER. Logs in as operator, starts a show, and plays it start to
 *              finish (warmup → seg1×players → seg2×players → seg3) with the N
 *              audience voting each round. Fully automated; resets game state.
 *
 *   (default)  DRIVER. Operator starts a show, opens the warmup vote, everyone
 *              votes once. Quick connectivity smoke test.
 *
 * Options:
 *   [N]            audience count (default 100)
 *   --rounds <n>   (--join) vote in this many successive open rounds (default 1)
 *   --wait <ms>    (--join) how long to wait for the next round to open (default 120000)
 *   --stagger <ms> delay between audience connects (spread the connect storm)
 *   --pace <ms>    (--game) delay between vote rounds (simulate show pacing)
 *
 * Auth:
 *   Locally (server without a Firebase service account) the dev fallback treats
 *   the token as the uid, so `lt-<id>` works. Against the real Railway server,
 *   set LOADTEST_SECRET to the value configured on the server and tokens become
 *   `lt:<secret>:<id>` (accepted as uid `lt-<id>` without Firebase).
 *
 * Env: LOADTEST_URL, OPERATOR_PASSWORD (driver modes only), LOADTEST_SECRET
 */
import { io, type Socket } from 'socket.io-client';

const URL = process.env.LOADTEST_URL ?? 'http://localhost:8080';
const PASSWORD = process.env.OPERATOR_PASSWORD ?? 'loadtest';
// Against a Firebase-configured (Railway) server, set LOADTEST_SECRET to the
// same value as the server's env → tokens become `lt:<secret>:<id>`. Locally
// (no service account) leave it unset and the raw `lt-<id>` token is the uid.
const SECRET = process.env.LOADTEST_SECRET ?? '';
const audToken = (i: number) => (SECRET ? `lt:${SECRET}:${i}` : `lt-${i}`);

const N = Number(process.argv[2] ?? 100);
const JOIN = process.argv.includes('--join');
const GAME = process.argv.includes('--game');
const argNum = (flag: string, dflt: number) => {
  const idx = process.argv.indexOf(flag);
  return idx > -1 ? Number(process.argv[idx + 1]) : dflt;
};
const STAGGER = argNum('--stagger', 0); // ms between connects
const PACE = argNum('--pace', 0); // ms between vote rounds (--game)
const ROUNDS = argNum('--rounds', 1); // vote in this many open rounds (--join)
const WAIT = argNum('--wait', 120_000); // ms to wait for the next round to open (--join)
const CONTIMEOUT = argNum('--contimeout', 45_000); // per-attempt connect timeout (ms)
const CONNECT_DEADLINE = 150_000; // hard cap: give up on a socket after this (ms)
// Shift the synthetic uid range so multiple processes/machines don't collide:
// run one with --offset 0 and another with --offset 500 for 1000 distinct voters.
const OFFSET = argNum('--offset', 0);

const nowMs = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms, sub-ms precision
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pace = () => (PACE ? sleep(PACE) : Promise.resolve());

// 3-player show used by the driver (--game / default) modes.
const PLAYERS = [
  { id: 1, name: 'P1', photo: '' },
  { id: 2, name: 'P2', photo: '' },
  { id: 3, name: 'P3', photo: '' },
];

// Minimal shape of the redacted state the audience receives (game/redact.ts).
interface AudState {
  phase: string;
  players: { id: number }[];
  warmup: { currentIndex: number; audienceVotingOpen: boolean };
  segment1: { currentStorytellerId: number | null; audienceVotingOpen: boolean };
  segment2: {
    currentStorytellerId: number | null;
    audienceVotingOpen: boolean;
    statements: { playerId: number; statements: string[] }[];
  };
  segment3: { audienceVotingOpen: boolean };
}

function pct(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
function stat(name: string, arr: number[]) {
  const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  console.log(
    `  ${name.padEnd(12)} n=${String(arr.length).padStart(4)}  avg=${avg.toFixed(0)}  p50=${pct(arr, 50).toFixed(0)}  p95=${pct(arr, 95).toFixed(0)}  p99=${pct(arr, 99).toFixed(0)}  max=${(arr.length ? Math.max(...arr) : 0).toFixed(0)} (ms)`,
  );
}
const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

function emitAck(s: Socket, ev: string, payload: unknown, timeout = 15000): Promise<{ ok?: boolean; error?: string }> {
  return new Promise((resolve) => {
    s.timeout(timeout).emit(ev, payload, (err: unknown, ack: { ok?: boolean; error?: string }) =>
      resolve(err ? { ok: false, error: 'timeout' } : (ack ?? { ok: false, error: 'no_ack' })),
    );
  });
}

// The round key currently open, matching the server's getCurrentVotingRound.
function openRoundKey(s: AudState | null): string | null {
  if (!s) return null;
  if (s.phase === 'WARMUP' && s.warmup?.audienceVotingOpen) return `warmup-${s.warmup.currentIndex}`;
  if (s.phase === 'SEGMENT1' && s.segment1?.audienceVotingOpen && s.segment1.currentStorytellerId != null)
    return `seg1-${s.segment1.currentStorytellerId}`;
  if (s.phase === 'SEGMENT2' && s.segment2?.audienceVotingOpen && s.segment2.currentStorytellerId != null)
    return `seg2-${s.segment2.currentStorytellerId}`;
  if (s.phase === 'SEGMENT3' && s.segment3?.audienceVotingOpen) return 'seg3';
  return null;
}

const randInt = (n: number) => Math.floor(Math.random() * n);

// A random valid choice for the open round (derived from live state), so the
// tally looks like real voting instead of a perfect alternating split.
function choiceFor(key: string, s: AudState): string {
  if (key.startsWith('warmup') || key.startsWith('seg1')) return Math.random() < 0.5 ? 'TRUTH' : 'LIE';
  if (key.startsWith('seg2')) {
    const st = s.segment2.statements.find((x) => x.playerId === s.segment2.currentStorytellerId);
    const k = st?.statements?.length ?? 2;
    return `STATEMENT_${randInt(k)}`;
  }
  if (key === 'seg3') {
    const ids = s.players.map((p) => p.id);
    return ids.length ? String(ids[randInt(ids.length)]) : '1';
  }
  return 'TRUTH';
}

interface Wave {
  label: string;
  ok: number;
  ms: number[];
  errs: Record<string, number>;
}

// Connect N audience sockets once; each keeps `store.state` fresh from state:full.
async function connectAudience(store: { state: AudState | null }) {
  const sockets: Socket[] = new Array(N);
  const connectMs: number[] = [];
  const connectErrors: Record<string, number> = {};
  let connected = 0;

  const connectOne = (i: number) =>
    new Promise<void>((resolve) => {
      const t0 = nowMs();
      const s = io(URL, {
        transports: ['websocket'],
        // High N from one machine: a single laptop can't complete 1000 TLS
        // handshakes at once, so let slow/crowded-out attempts retry instead of
        // dropping permanently, with a generous per-attempt timeout.
        reconnection: true,
        reconnectionAttempts: 12,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 8000,
        timeout: CONTIMEOUT,
        auth: { role: 'audience', token: audToken(OFFSET + i) },
      });
      sockets[i] = s;
      s.on('state:full', (msg: { state: AudState }) => {
        if (msg?.state) store.state = msg.state;
      });
      let done = false;
      const fin = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      s.on('connect', () => {
        if (!done) {
          connectMs.push(nowMs() - t0);
          connected++;
        }
        fin(); // count once; reconnects after this don't double-count
      });
      // Give up only after every reconnection attempt is exhausted…
      s.io.on('reconnect_failed', () => {
        bump(connectErrors, 'connect:failed');
        fin();
      });
      // …or a hard deadline, so one wedged socket can't hang the whole run.
      setTimeout(() => {
        if (!done) {
          bump(connectErrors, 'connect:deadline');
          s.close();
          fin();
        }
      }, CONNECT_DEADLINE);
    });

  const start = nowMs();
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < N; i++) {
    jobs.push(connectOne(i));
    if (STAGGER) await sleep(STAGGER);
  }
  await Promise.all(jobs);
  const wall = nowMs() - start;
  console.log(`\nconnected: ${connected}/${N}  wall: ${wall.toFixed(0)}ms`);
  stat('connect', connectMs);
  if (Object.keys(connectErrors).length) console.log('  connect errors:', connectErrors);
  return { sockets, connectMs, connected };
}

// One vote wave: every connected socket votes once with `choiceFn(i)`.
async function voteWave(sockets: Socket[], label: string, choiceFn: (i: number) => string): Promise<Wave> {
  const ms: number[] = [];
  const errs: Record<string, number> = {};
  let ok = 0;
  await Promise.all(
    sockets.map(
      (s, i) =>
        new Promise<void>((resolve) => {
          if (!s || !s.connected) {
            bump(errs, 'not_connected');
            return resolve();
          }
          const v0 = nowMs();
          s.timeout(15000).emit(
            'aud:vote',
            { choice: choiceFn(i) },
            (err: unknown, ack: { ok?: boolean; error?: string }) => {
              if (err) bump(errs, 'timeout');
              else if (ack?.ok) {
                ms.push(nowMs() - v0);
                ok++;
              } else bump(errs, `err:${ack?.error ?? 'unknown'}`);
              resolve();
            },
          );
        }),
    ),
  );
  const errStr = Object.keys(errs).length ? `  errors=${JSON.stringify(errs)}` : '';
  console.log(`  round ${label.padEnd(12)} voted ${ok}/${sockets.length}  p95=${pct(ms, 95).toFixed(0)}ms${errStr}`);
  return { label, ok, ms, errs };
}

function report(connectMs: number[], connected: number, waves: Wave[], wallMs: number) {
  const allVoteMs = waves.flatMap((w) => w.ms);
  const totalVotes = waves.reduce((a, w) => a + w.ok, 0);
  const totalErrs = waves.reduce<Record<string, number>>((acc, w) => {
    for (const [k, v] of Object.entries(w.errs)) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {});
  console.log(`\n── Results: N=${N} | ${waves.length} vote round(s) | wall: ${wallMs.toFixed(0)}ms ──`);
  console.log(`connected: ${connected}/${N}   votes accepted: ${totalVotes}/${N * Math.max(1, waves.length)}`);
  stat('connect', connectMs);
  stat('vote-ack', allVoteMs);
  if (Object.keys(totalErrs).length) console.log('vote errors:', totalErrs);
  else console.log('vote errors: none');
}

// ── --join: audience-only, you drive the game from the operator panel ─────────
async function runJoin() {
  console.log(`\nJOIN mode → ${URL} | N=${N} | rounds=${ROUNDS} | stagger=${STAGGER}ms`);
  console.log('Connecting audience… then waiting for YOU to open a vote in the operator panel.');
  const store: { state: AudState | null } = { state: null };
  const { sockets, connectMs, connected } = await connectAudience(store);

  const waves: Wave[] = [];
  const runStart = nowMs();
  let lastKey: string | null = null;

  for (let r = 0; r < ROUNDS; r++) {
    // Wait for a NEW open round (different from the one we just voted in).
    const deadline = nowMs() + WAIT;
    let key = openRoundKey(store.state);
    while ((key === null || key === lastKey) && nowMs() < deadline) {
      await sleep(200);
      key = openRoundKey(store.state);
    }
    if (key === null || key === lastKey) {
      console.log(`\nNo new round opened within ${(WAIT / 1000).toFixed(0)}s — stopping.`);
      break;
    }
    console.log(`\n▶ round "${key}" is open — casting ${connected} votes`);
    const snapshot = store.state as AudState;
    waves.push(await voteWave(sockets, key, () => choiceFor(key as string, snapshot)));
    lastKey = key;
    if (r < ROUNDS - 1) console.log('  (lock/reveal this round and open the next when ready…)');
  }

  report(connectMs, connected, waves, nowMs() - runStart);
  sockets.forEach((s) => s?.close());
  await sleep(200);
  process.exit(0);
}

// ── driver modes (--game / default): script acts as operator too ──────────────
async function runDriver() {
  console.log(`\nDRIVER mode → ${URL} | N=${N} | ${GAME ? 'full game' : 'warmup smoke'} | stagger=${STAGGER}ms | pace=${PACE}ms`);

  const res = await fetch(`${URL}/auth/operator/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`operator login failed: HTTP ${res.status}`);
  const { token } = (await res.json()) as { token: string };

  const op = io(URL, { transports: ['websocket'], auth: { role: 'operator', token } });
  await new Promise<void>((r, rej) => {
    op.once('connect', () => r());
    op.once('connect_error', (e) => rej(new Error(`operator connect_error: ${e.message}`)));
  });
  const opDo = async (ev: string, payload: unknown) => {
    const a = await emitAck(op, ev, payload);
    if (!a.ok) console.warn(`  ! operator ${ev} → ${a.error}`);
    return a;
  };

  await opDo('op:startShow', {
    players: PLAYERS,
    warmup: [{ statement: 'Warmup statement', isLie: false }],
    segment1: PLAYERS.map((p) => ({
      playerId: p.id,
      playerName: p.name,
      statement: `${p.name} seg1 statement`,
      isLie: p.id % 2 === 0,
    })),
    segment2: PLAYERS.map((p) => ({
      playerId: p.id,
      playerName: p.name,
      statements: ['Statement A', 'Statement B'],
      lieIndex: 1,
    })),
    segment3: { photoUrl: null, photoTitle: 'Mystery object' },
  });

  const store: { state: AudState | null } = { state: null };
  const { sockets, connectMs, connected } = await connectAudience(store);

  const waves: Wave[] = [];
  const TL = () => (Math.random() < 0.5 ? 'TRUTH' : 'LIE');
  const runStart = nowMs();

  if (!GAME) {
    console.log('\noperator: warmup vote OPEN');
    await opDo('op:openVote', { segment: 'warmup' });
    waves.push(await voteWave(sockets, 'warmup', TL));
    await opDo('op:lockVote', { segment: 'warmup' });
  } else {
    console.log('\n── playing full show ──');
    await opDo('op:warmupNav', { index: 0 });
    await opDo('op:openVote', { segment: 'warmup' });
    waves.push(await voteWave(sockets, 'warmup', TL));
    await opDo('op:lockVote', { segment: 'warmup' });
    await opDo('op:reveal', { segment: 'warmup' });
    await pace();

    await opDo('op:gotoPhase', { phase: 'SEGMENT1' });
    for (const p of PLAYERS) {
      await opDo('op:selectStoryteller', { segment: 'segment1', playerId: p.id });
      await opDo('op:toggleSeg1Statement', {});
      await opDo('op:openVote', { segment: 'segment1' });
      waves.push(await voteWave(sockets, `seg1-p${p.id}`, TL));
      await opDo('op:lockVote', { segment: 'segment1' });
      await opDo('op:reveal', { segment: 'segment1' });
      await opDo('op:awardSegment', { segment: 'segment1' });
      await pace();
    }

    await opDo('op:gotoPhase', { phase: 'SEGMENT2' });
    for (const p of PLAYERS) {
      await opDo('op:selectStoryteller', { segment: 'segment2', playerId: p.id });
      await opDo('op:toggleStatement', { index: 0 });
      await opDo('op:toggleStatement', { index: 1 });
      await opDo('op:openVote', { segment: 'segment2' });
      waves.push(await voteWave(sockets, `seg2-p${p.id}`, () => `STATEMENT_${randInt(2)}`));
      await opDo('op:lockVote', { segment: 'segment2' });
      await opDo('op:reveal', { segment: 'segment2' });
      await opDo('op:awardSegment', { segment: 'segment2' });
      await pace();
    }

    await opDo('op:gotoPhase', { phase: 'SEGMENT3' });
    await opDo('op:openVote', { segment: 'segment3' });
    waves.push(await voteWave(sockets, 'seg3', () => String(PLAYERS[randInt(PLAYERS.length)].id)));
    await opDo('op:lockVote', { segment: 'segment3' });
    await opDo('op:awardSegment3', { winnerId: PLAYERS[0].id });
    await pace();
    await opDo('op:gotoPhase', { phase: 'FINAL' });
  }

  report(connectMs, connected, waves, nowMs() - runStart);
  sockets.forEach((s) => s?.close());
  op.close();
  await sleep(200);
  process.exit(0);
}

async function main() {
  if (JOIN) await runJoin();
  else await runDriver();
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
