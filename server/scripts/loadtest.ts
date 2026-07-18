/**
 * Socket load test for the live server. Auth is bypassed by running the server
 * WITHOUT a Firebase service account (dev-auth fallback: token === uid), so we
 * can spin up N synthetic audience members with tokens `lt-0`..`lt-<N-1>`.
 *
 *   npx tsx scripts/loadtest.ts [N] [--stagger <ms>]
 *
 * It logs in as operator, starts a show, opens the warmup vote, then connects N
 * audience sockets that each vote once, and reports connect + vote-ack latency.
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
const staggerIdx = process.argv.indexOf('--stagger');
const STAGGER = staggerIdx > -1 ? Number(process.argv[staggerIdx + 1]) : 0; // ms between connects

const nowMs = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms, sub-ms precision
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pct(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
function stat(name: string, arr: number[]) {
  const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  console.log(
    `  ${name.padEnd(10)} n=${arr.length}  avg=${avg.toFixed(0)}  p50=${pct(arr, 50).toFixed(0)}  p95=${pct(arr, 95).toFixed(0)}  p99=${pct(arr, 99).toFixed(0)}  max=${(arr.length ? Math.max(...arr) : 0).toFixed(0)} (ms)`,
  );
}

function emitAck(s: Socket, ev: string, payload: unknown, timeout = 15000): Promise<{ ok?: boolean; error?: string }> {
  return new Promise((resolve) => {
    s.timeout(timeout).emit(ev, payload, (err: unknown, ack: { ok?: boolean; error?: string }) =>
      resolve(err ? { ok: false, error: 'timeout' } : (ack ?? { ok: false, error: 'no_ack' })),
    );
  });
}

async function main() {
  console.log(`\nLoad test → ${URL} | N=${N} | stagger=${STAGGER}ms`);

  // 1) Operator login → JWT
  const res = await fetch(`${URL}/auth/operator/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`operator login failed: HTTP ${res.status}`);
  const { token } = (await res.json()) as { token: string };

  // 2) Operator socket → start show + open the warmup vote (TRUTH/LIE round)
  const op = io(URL, { transports: ['websocket'], auth: { role: 'operator', token } });
  await new Promise<void>((r, rej) => {
    op.once('connect', () => r());
    op.once('connect_error', (e) => rej(new Error(`operator connect_error: ${e.message}`)));
  });
  await emitAck(op, 'op:startShow', {
    players: [
      { id: 1, name: 'P1', photo: '' },
      { id: 2, name: 'P2', photo: '' },
      { id: 3, name: 'P3', photo: '' },
    ],
    warmup: [{ statement: 'Load test statement', isLie: false }],
    segment1: [],
    segment2: [],
    segment3: { photoUrl: null, photoTitle: null },
  });
  await emitAck(op, 'op:openVote', { segment: 'warmup' });
  console.log('operator: show started, warmup vote OPEN\n');

  // 3) N audience clients: connect + vote once
  const connectMs: number[] = [];
  const voteMs: number[] = [];
  const errors: Record<string, number> = {};
  const bump = (k: string) => (errors[k] = (errors[k] ?? 0) + 1);
  const sockets: Socket[] = [];
  let connected = 0;
  let voted = 0;

  const run = (i: number) =>
    new Promise<void>((resolve) => {
      const t0 = nowMs();
      const s = io(URL, {
        transports: ['websocket'],
        reconnection: false,
        auth: { role: 'audience', token: audToken(i) },
      });
      sockets.push(s);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      s.on('connect', () => {
        connectMs.push(nowMs() - t0);
        connected++;
        const v0 = nowMs();
        s.timeout(15000).emit(
          'aud:vote',
          { choice: Math.random() < 0.5 ? 'TRUTH' : 'LIE' },
          (err: unknown, ack: { ok?: boolean; error?: string }) => {
            if (err) bump('vote:timeout');
            else if (ack?.ok) {
              voteMs.push(nowMs() - v0);
              voted++;
            } else bump(`vote:${ack?.error ?? 'unknown'}`);
            finish();
          },
        );
      });
      s.on('connect_error', (e) => {
        bump(`connect:${e.message}`);
        finish();
      });
    });

  const start = nowMs();
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < N; i++) {
    jobs.push(run(i));
    if (STAGGER) await sleep(STAGGER);
  }
  await Promise.all(jobs);
  const wall = nowMs() - start;

  // 4) Report
  console.log(`── Results: N=${N} ──`);
  console.log(`connected: ${connected}/${N}   voted: ${voted}/${N}   wall: ${wall.toFixed(0)}ms`);
  stat('connect', connectMs);
  stat('vote-ack', voteMs);
  if (Object.keys(errors).length) console.log('errors:', errors);
  else console.log('errors: none');

  sockets.forEach((s) => s.close());
  op.close();
  await sleep(200);
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
