/**
 * Carryover / switch-over rehearsal.
 *
 * Writes a fake game to Firestore `gameState/live` and steps it forward every
 * few seconds — exactly what the server's GameMirror does. Open the BACKUP app's
 * /display (and /audience) in a browser pointed at the SAME project and watch it
 * update live at each step. This proves (a) the shared-project real-time sync
 * works and (b) the server's state shape renders correctly in the backup.
 *
 * Usage (from lie-hard-live/server):
 *   FIREBASE_SERVICE_ACCOUNT_B64=<lie-hard-live service account, base64> \
 *   npx tsx scripts/seed-live-game.ts
 *
 * Optional: STEP_MS=5000 to change the delay between steps.
 *
 * NOTE: this OVERWRITES gameState/live. Run it only for rehearsal, and reset the
 * real game afterward (operator "Reset Game", or re-run this and let it finish).
 */
import * as admin from 'firebase-admin';
import { buildStartState } from '../src/game/reducers';
import type { GameState } from '../src/game/state';

const STEP_MS = Number(process.env.STEP_MS ?? 5000);

function initDb(): admin.firestore.Firestore {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) {
    console.error('✗ Set FIREBASE_SERVICE_ACCOUNT_B64 to the lie-hard-live service-account JSON (base64).');
    process.exit(1);
  }
  const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  return admin.firestore();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const db = initDb();
  const ref = db.collection('gameState').doc('live');

  // A realistic started game (mirrors what op:startShow builds).
  let state: GameState = buildStartState({
    players: [
      { id: 1, name: 'Karan' },
      { id: 2, name: 'Priya' },
      { id: 3, name: 'Rohit' },
    ],
    warmup: [
      { statement: 'I once ate 12 momos in one sitting', isLie: false },
      { statement: 'I have never been to Goa', isLie: true },
    ],
    segment1: [
      { playerId: 1, playerName: 'Karan', statement: 'I was a national level swimmer', isLie: false },
      { playerId: 2, playerName: 'Priya', statement: 'I have never eaten a burger', isLie: true },
      { playerId: 3, playerName: 'Rohit', statement: 'I can speak 4 languages', isLie: false },
    ],
    segment2: [
      { playerId: 1, playerName: 'Karan', statements: ['I studied in London', 'I failed my driving test 5x'], lieIndex: 1 },
    ],
    segment3: { photoUrl: null, photoTitle: 'A vintage wristwatch' },
  });

  const write = async (label: string) => {
    await ref.set(state as unknown as Record<string, unknown>);
    console.log(`  ✓ ${label}`);
  };

  console.log(`\nRehearsal driving gameState/live every ${STEP_MS}ms.`);
  console.log('Open the BACKUP /display (and /audience) in a browser now, then watch it update.\n');

  await write('SETUP → WARMUP: game started (3 players)');
  await sleep(STEP_MS);

  state = { ...state, warmup: { ...state.warmup, audienceVotingOpen: true } };
  await write('Warmup vote OPEN (audience should see TRUTH/LIE buttons)');
  await sleep(STEP_MS);

  state = {
    ...state,
    audienceVotes: {
      'demo-uid-1': { choice: 'LIE', votingRound: 'warmup-0', displayName: 'Aisha', ts: Date.now() },
      'demo-uid-2': { choice: 'TRUTH', votingRound: 'warmup-0', displayName: 'Rahul', ts: Date.now() },
    },
  };
  await write('Two audience votes cast (bars should move on display)');
  await sleep(STEP_MS);

  state = {
    ...state,
    warmup: { ...state.warmup, audienceVotingOpen: false, showResult: true },
    voterScores: { 'demo-uid-1': { name: 'Aisha', correctCount: 1 } },
  };
  await write('Warmup REVEALED + voter score (display shows the answer + top voter)');
  await sleep(STEP_MS);

  state = {
    ...state,
    phase: 'SEGMENT1',
    players: state.players.map((p) => (p.id === 1 ? { ...p, score: p.score + 10 } : p)),
    showScorePopup: true,
    scorePopupDeltas: [{ name: 'Karan', delta: 10 }],
  };
  await write('Moved to SEGMENT 1, Karan +10 (scoreboard should update)');

  console.log('\nDone. If the backup display updated live at each step, carryover is working.');
  console.log('Reset the game afterward (operator "Reset Game") before the real show.\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('✗ Rehearsal failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
