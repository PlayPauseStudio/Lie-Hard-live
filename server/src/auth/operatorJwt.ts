import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'lie-hard-server';
const AUDIENCE = 'lie-hard-operator';

/** Verify an operator password attempt against the configured hash/plaintext. */
export async function checkOperatorPassword(password: string): Promise<boolean> {
  if (!password) return false;
  if (env.OPERATOR_PASSWORD_HASH) {
    return bcrypt.compare(password, env.OPERATOR_PASSWORD_HASH);
  }
  if (env.OPERATOR_PASSWORD) {
    // Dev fallback: constant-time-ish direct compare.
    return password === env.OPERATOR_PASSWORD;
  }
  return false;
}

/** Issue a short-lived operator JWT. */
export async function signOperatorToken(): Promise<string> {
  return new SignJWT({ role: 'operator' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(env.OPERATOR_JWT_TTL)
    .sign(secret);
}

/** Verify an operator JWT. Throws if invalid/expired. */
export async function verifyOperatorToken(token: string): Promise<{ role: 'operator' }> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: AUDIENCE });
  if (payload.role !== 'operator') throw new Error('not_operator');
  return { role: 'operator' };
}
