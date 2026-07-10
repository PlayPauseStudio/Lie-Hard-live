import type { Socket } from 'socket.io';
import type { ExtendedError } from 'socket.io/dist/namespace';
import { verifyIdToken } from './firebaseAdmin';
import { verifyOperatorToken } from './operatorJwt';
import { logger } from '../util/logger';

export type Role = 'operator' | 'display' | 'audience';

export interface SocketData {
  role: Role;
  uid?: string; // present for audience
  name?: string; // present for audience (from token, optional)
}

/**
 * Socket.IO handshake auth middleware. Runs once per connection, before any
 * event handler, and stamps the trusted role (+ uid for audience) onto
 * socket.data. Rejected connections never reach a handler.
 *
 * Client connects with: io(url, { auth: { role, token } }).
 */
export async function socketAuthMiddleware(
  socket: Socket,
  next: (err?: ExtendedError) => void,
): Promise<void> {
  try {
    const auth = (socket.handshake.auth ?? {}) as { role?: string; token?: string };
    const role = auth.role;

    if (role === 'display') {
      socket.data = { role: 'display' } satisfies SocketData;
      return next();
    }

    if (role === 'operator') {
      if (!auth.token) return next(new Error('operator_token_required'));
      await verifyOperatorToken(auth.token);
      socket.data = { role: 'operator' } satisfies SocketData;
      return next();
    }

    if (role === 'audience') {
      if (!auth.token) return next(new Error('audience_token_required'));
      const user = await verifyIdToken(auth.token);
      socket.data = { role: 'audience', uid: user.uid, name: user.name } satisfies SocketData;
      return next();
    }

    return next(new Error('invalid_role'));
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : e }, 'Socket auth rejected');
    return next(new Error('unauthorized'));
  }
}
