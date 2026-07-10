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

/** Batch-delete all voter records (operator "delete user data"). */
export async function clearAllVoters(): Promise<number> {
  const fs = getFirestore();
  if (!fs) {
    const n = memory.size;
    memory.clear();
    return n;
  }
  const snap = await fs.collection('voters').get();
  if (snap.empty) return 0;
  const batch = fs.batch();
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  logger.info({ count: snap.size }, 'Cleared voter records');
  return snap.size;
}

export function votersBackend(): 'firestore' | 'memory' {
  return isFirebaseConfigured() ? 'firestore' : 'memory';
}
