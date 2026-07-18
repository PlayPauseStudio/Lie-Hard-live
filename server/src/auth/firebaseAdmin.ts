import * as admin from 'firebase-admin';
import { env, isProd } from '../config/env';
import { logger } from '../util/logger';

let initialized = false;
let firestore: admin.firestore.Firestore | null = null;

/**
 * Initialize the Firebase Admin SDK from a base64-encoded service-account JSON.
 * If no service account is configured, the server runs in a degraded mode where
 * (in non-production only) the audience "token" is treated as the raw uid, so
 * local development works without Firebase credentials.
 */
export function initFirebaseAdmin(): void {
  if (initialized) return;
  const b64 = env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) {
    if (isProd) {
      logger.error('FIREBASE_SERVICE_ACCOUNT_B64 is required in production for token verification.');
    } else {
      logger.warn('Firebase Admin not configured — audience tokens accepted as raw uid (dev only).');
    }
    initialized = true;
    return;
  }
  try {
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    admin.initializeApp({ credential: admin.credential.cert(json) });
    firestore = admin.firestore();
    logger.info('Firebase Admin initialized.');
  } catch (e) {
    logger.error({ err: e }, 'Failed to initialize Firebase Admin from FIREBASE_SERVICE_ACCOUNT_B64.');
    if (isProd) process.exit(1);
  }
  initialized = true;
}

export function isFirebaseConfigured(): boolean {
  return admin.apps.length > 0;
}

export function getFirestore(): admin.firestore.Firestore | null {
  return firestore;
}

export interface VerifiedUser {
  uid: string;
  name?: string;
}

/**
 * Verify a Firebase ID token and return the trusted uid. Throws on invalid
 * tokens. In dev-without-Firebase mode, accepts a non-empty string as the uid.
 */
export async function verifyIdToken(token: string): Promise<VerifiedUser> {
  if (!token) throw new Error('missing_token');
  // Load-test bypass (env-gated; UNSET in normal prod). Accepts synthetic
  // `lt:<secret>:<id>` tokens as uid `lt-<id>` without Firebase, so a load
  // script can connect as many audience members against the real server.
  if (env.LOADTEST_SECRET) {
    const prefix = `lt:${env.LOADTEST_SECRET}:`;
    if (token.startsWith(prefix)) return { uid: `lt-${token.slice(prefix.length)}` };
  }
  if (!isFirebaseConfigured()) {
    if (isProd) throw new Error('auth_unavailable');
    return { uid: token }; // dev fallback
  }
  const decoded = await admin.auth().verifyIdToken(token);
  return { uid: decoded.uid, name: decoded.name };
}
