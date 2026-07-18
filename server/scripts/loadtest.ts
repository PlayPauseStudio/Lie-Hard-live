/**
 * Socket load test for the live server.
 *
 *   npx tsx scripts/loadtest.ts [N] [--game] [--stagger <ms>] [--pace <ms>]
 *
 * Modes:
 *   (default)  connect N audience, open the warmup vote, everyone votes once.
 *              Quick connectivity + single-wave smoke test.
 *   --game     play a full show round-by-round: warmup → segment1 (each player)
 *              → segment2 (each player, both statements revealed) → segment3.
 *              The N audience stay connected the whole show and vote every round,
 *              so this exercises sustained connections + repeated vote waves +
 *              the Firestore mirror — the realistic 20–30 min live-show pattern.
 *
 * Options:
 *   [N]            audience count (default 100)
 *   --stagger <ms> delay between audience connects (spread the connect storm)
 *   --pace <ms>    delay between vote rounds in --game mode (simulate show pacing)
 *
 * Auth:
 *   Locally (server without a Firebase service account) the dev fallback treats
 *   the token as the uid, so `lt-<id>` works. Against the real Railway server,
 *   set LOADTEST_SECRET to the value configured on the server and tokens become
 *   `lt:<secret>:<id>` (accepted as uid `lt-<id>` without Firebase).
 *
 * Env: LOADTEST_URL, OPERATOR_PASSWORD, LOADTEST_SECRET
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
const GAME = process.argv.includes('--game');
const argNum = (flag: string, dflt: number) => {
  const idx = process.argv.indexOf(flag);
  return idx > -1 ? Number(process.argv[idx + 1]) : dflt;
};
const STAGGER = argNum('--stagger', 0); // ms between connects
const PACE = argNum('--pace', 0); // ms between vote rounds (--game)

const nowMs = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms, sub-ms precision
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pace = () => (PACE ? sleep(PACE) : Promise.resolve());

// 3-player show used by --game mode.
const PLAYERS = [
  { id: 1, name: 'P1', photo: '' },
  { id: 2, name: 'P2', photo: '' },
  { id: 3, name: 'P3', photo: '' },
];

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

async function main() {
  console.log(`\nLoad test → ${URL} | N=${N} | mode=${GAME ? 'game' : 'single'} | stagger=${STAGGER}ms | pace=${PACE}ms`);

  // 1) Operator login → JWT
  const res = await fetch(`${URL}/auth/operator/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`operator login failed: HTTP ${res.status}`);
  const { token } = (await res.json()) as { token: string };

  // 2) Operator socket → start the show
  const op = io(URL, { transports: ['websocket'], auth: { role: 'operator', token } });
  await new Promise<void>((r, rej) => {
    op.once('connect', () => r());
    op.once('connect_error', (e) => rej(new Error(`operator connect_error: ${e.message}`)));
  });
  // Operator helper: emit + warn if the server rejected the command.
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

  // 3) Connect N audience sockets once; they stay connected for the whole run.
  const sockets: Socket[] = new Array(N);
  const connectMs: number[] = [];
  const connectErrors: Record<string, number> = {};
  let connected = 0;

  const connectOne = (i: number) =>
    new Promise<void>((resolve) => {
      const t0 = nowMs();
      const s = io(URL, {
        transports: ['websocket'],
        reconnection: false,
        auth: { role: 'audience', token: audToken(i) },
      });
      sockets[i] = s;
      let done = false;
      const fin = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      s.on('connect', () => {
        connectMs.push(nowMs() - t0);
        connected++;
        fin();
      });
      s.on('connect_error', (e) => {
        bump(connectErrors, `connect:${e.message}`);
        fin();
      });
    });

  const connectStart = nowMs();
  const connJobs: Promise<void>[] = [];
  for (let i = 0; i < N; i++) {
    connJobs.push(connectOne(i));
    if (STAGGER) await sleep(STAGGER);
  }
  await Promise.all(connJobs);
  const connectWall = nowMs() - connectStart;
  console.log(`\nconnected: ${connected}/${N}  wall: ${connectWall.toFixed(0)}ms`);
  stat('connect', connectMs);
  if (Object.keys(connectErrors).length) console.log('  connect errors:', connectErrors);

  // One vote wave: every connected socket votes once with a round-appropriate
  // choice. Records ack latency + errors, tagged with the round label.
  const waves: { label: string; ok: number; ms: number[]; errs: Record<string, number> }[] = [];
  const voteWave = async (label: string, choiceFn: (i: number) => string) => {
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
    waves.push({ label, ok, ms, errs });
    const errStr = Object.keys(errs).length ? `  errors=${JSON.stringify(errs)}` : '';
    console.log(`  round ${label.padEnd(12)} voted ${ok}/${sockets.length}  p95=${pct(ms, 95).toFixed(0)}ms${errStr}`);
    return ms;
  };

  const TL = (i: number) => (i % 2 ? 'LIE' : 'TRUTH'); // truth/lie split
  const runStart = nowMs();

  if (!GAME) {
    // ── Single-wave smoke: warmup vote only ──
    console.log('\noperator: warmup vote OPEN');
    await opDo('op:openVote', { segment: 'warmup' });
    await voteWave('warmup', TL);
    await opDo('op:lockVote', { segment: 'warmup' });
  } else {
    // ── Full round-wise gameplay ──
    console.log('\n── playing full show ──');

    // Warmup
    await opDo('op:warmupNav', { index: 0 });
    await opDo('op:openVote', { segment: 'warmup' });
    await voteWave('warmup', TL);
    await opDo('op:lockVote', { segment: 'warmup' });
    await opDo('op:reveal', { segment: 'warmup' });
    await pace();

    // Segment 1 — one round per storyteller (TRUTH/LIE)
    await opDo('op:gotoPhase', { phase: 'SEGMENT1' });
    for (const p of PLAYERS) {
      await opDo('op:selectStoryteller', { segment: 'segment1', playerId: p.id });
      await opDo('op:toggleSeg1Statement', {});
      await opDo('op:openVote', { segment: 'segment1' });
      await voteWave(`seg1-p${p.id}`, TL);
      await opDo('op:lockVote', { segment: 'segment1' });
      await opDo('op:reveal', { segment: 'segment1' });
      await opDo('op:awardSegment', { segment: 'segment1' });
      await pace();
    }

    // Segment 2 — one round per storyteller; reveal both statements first
    await opDo('op:gotoPhase', { phase: 'SEGMENT2' });
    for (const p of PLAYERS) {
      await opDo('op:selectStoryteller', { segment: 'segment2', playerId: p.id });
      await opDo('op:toggleStatement', { index: 0 });
      await opDo('op:toggleStatement', { index: 1 });
      await opDo('op:openVote', { segment: 'segment2' });
      await voteWave(`seg2-p${p.id}`, (i) => (i % 2 ? 'STATEMENT_1' : 'STATEMENT_0'));
      await opDo('op:lockVote', { segment: 'segment2' });
      await opDo('op:reveal', { segment: 'segment2' });
      await opDo('op:awardSegment', { segment: 'segment2' });
      await pace();
    }

    // Segment 3 — guess the player (vote a player id)
    await opDo('op:gotoPhase', { phase: 'SEGMENT3' });
    await opDo('op:openVote', { segment: 'segment3' });
    await voteWave('seg3', (i) => String(PLAYERS[i % PLAYERS.length].id));
    await opDo('op:lockVote', { segment: 'segment3' });
    await opDo('op:awardSegment3', { winnerId: PLAYERS[0].id });
    await pace();

    await opDo('op:gotoPhase', { phase: 'FINAL' });
  }

  const runWall = nowMs() - runStart;

  // 4) Report
  const allVoteMs = waves.flatMap((w) => w.ms);
  const totalVotes = waves.reduce((a, w) => a + w.ok, 0);
  const totalErrs = waves.reduce<Record<string, number>>((acc, w) => {
    for (const [k, v] of Object.entries(w.errs)) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {});
  console.log(`\n── Results: N=${N} | ${waves.length} vote round(s) | run wall: ${runWall.toFixed(0)}ms ──`);
  console.log(`connected: ${connected}/${N}   votes accepted: ${totalVotes}/${N * waves.length}`);
  stat('connect', connectMs);
  stat('vote-ack', allVoteMs);
  if (Object.keys(totalErrs).length) console.log('vote errors:', totalErrs);
  else console.log('vote errors: none');

  sockets.forEach((s) => s?.close());
  op.close();
  await sleep(200);
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
