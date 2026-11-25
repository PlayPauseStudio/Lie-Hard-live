import { getFirestore, isFirebaseConfigured } from '../auth/firebaseAdmin';
import { logger } from '../util/logger';

export interface VoterRecord {
  name: string;
  phone: string;
  registeredAt: number;
}

/**
 * Voter (audience) registration storage. Backed by Firestore `voters/{uid}`
 * when Firebase Admin is configured; otherwise an in-memory Map (dev/degraded).
 * Writes are keyed by the *server-verified* uid — never a client-supplied id —
 * and the registeredAt timestamp is stamped server-side.
 */
const memory = new Map<string, VoterRecord>();

export async function registerVoter(
  uid: string,
  data: { name: string; phone: string },
): Promise<VoterRecord> {
  const record: VoterRecord = {
    name: data.name.trim(),
    phone: data.phone.trim(),
    registeredAt: Date.now(),
  };
  const fs = getFirestore();
  if (fs) {
    await fs.collection('voters').doc(uid).set(record);
  } else {
    memory.set(uid, record);
  }
  return record;
}

export async function getVoter(uid: string): Promise<VoterRecord | null> {
  const fs = getFirestore();
  if (fs) {
    const snap = await fs.collection('voters').doc(uid).get();
    return snap.exists ? (snap.data() as VoterRecord) : null;
  }
  return memory.get(uid) ?? null;
}

/**
 * How many people have signed up this show, for the status strip. Firestore is
 * asked (a count query, ~1 read) at most every 5 s in the background; callers
 * get the last known number straight away (null until the first answer).
 */
const joined = { count: null as number | null, at: 0, inFlight: false };
const JOINED_REFRESH_MS = 5000;

export function joinedCount(): number | null {
  const fs = getFirestore();
  if (!fs) return memory.size;
  if (!joined.inFlight && Date.now() - joined.at > JOINED_REFRESH_MS) {
    joined.inFlight = true;
    fs.collection('voters')
      .count()
      .get()
      .then((snap) => {
        joined.count = snap.data().count;
      })
      .catch((e) => logger.warn({ err: e instanceof Error ? e.message : e }, 'Counting voter sign-ups failed'))
      .finally(() => {
        joined.at = Date.now();
        joined.inFlight = false;
      });
  }
  return joined.count;
}

/** Every voter sign-up, for the export (name and phone by uid). */
export async function listVoters(): Promise<(VoterRecord & { uid: string })[]> {
  const fs = getFirestore();
  if (!fs) return [...memory.entries()].map(([uid, r]) => ({ uid, ...r }));
  const snap = await fs.collection('voters').get();
  return snap.docs.map((d) => ({ uid: d.id, ...(d.data() as VoterRecord) }));
}

/** Firestore allows at most 500 writes per batch. */
const BATCH_SIZE = 400;

/**
 * Delete every voter sign-up (soft refresh / full reset), so phones register
 * again after signing back in.
 */
export async function clearAllVoters(): Promise<number> {
  // Sign-ups are being wiped: count again from zero.
  joined.count = 0;
  joined.at = Date.now();
  const fs = getFirestore();
  if (!fs) {
    const n = memory.size;
    memory.clear();
    return n;
  }
  const snap = await fs.collection('voters').get();
  if (snap.empty) return 0;
  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = fs.batch();
    for (const d of snap.docs.slice(i, i + BATCH_SIZE)) batch.delete(d.ref);
    await batch.commit();
  }
  logger.info({ count: snap.size }, 'Cleared voter records');
  return snap.size;
}

export function votersBackend(): 'firestore' | 'memory' {
  return isFirebaseConfigured() ? 'firestore' : 'memory';
}
