import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../util/logger';
import { TokenBucketLimiter } from '../util/rateLimit';
import { socketAuthMiddleware } from '../auth/socketAuth';
import type { RoomStore } from '../game/store';
import type { GameMirror } from '../persistence/gameMirror';
import { Broadcaster } from './broadcast';
import { registerOperatorHandlers } from './handlers/operator';
import { registerAudienceHandlers } from './handlers/audience';
import { type AppServer, type AppSocket, ROOM_FULL, ROOM_AUDIENCE } from './types';

export interface RealtimeServer {
  io: AppServer;
  broadcaster: Broadcaster;
}

export function createIo(httpServer: HttpServer, store: RoomStore, mirror?: GameMirror): RealtimeServer {
  const io: AppServer = new Server(httpServer, {
    cors: {
      origin: env.ALLOWED_ORIGINS,
      credentials: true,
    },
    // Liveness: drop dead phones promptly on flaky venue Wi-Fi.
    pingInterval: 20_000,
    pingTimeout: 20_000,
    // Cap payloads (base64 photos ride inside op:startShow).
    maxHttpBufferSize: 2_000_000,
  });

  // Vote rate limiter: burst of 5, refilling ~2/sec per uid.
  const voteLimiter = new TokenBucketLimiter(5, 2);
  const sweep = setInterval(() => voteLimiter.sweep(), 60_000);
  sweep.unref?.();

  const broadcaster = new Broadcaster(io, store, mirror);
  broadcaster.start();

  io.use(socketAuthMiddleware);

  io.on('connection', (socket: AppSocket) => {
    const { role } = socket.data;
    logger.info({ role, uid: socket.data.uid, id: socket.id }, 'socket connected');

    // audience → redacted room; operator + display → full-fidelity room.
    socket.join(role === 'audience' ? ROOM_AUDIENCE : ROOM_FULL);

    // Register BOTH handler sets on every socket. Each handler enforces its own
    // role guard and replies with an explicit `forbidden` ack when the role is
    // wrong — so a non-operator emitting op:* always gets a response (never a
    // silent hang) and can never mutate state (defense in depth).
    const ctx = { store, broadcaster };
    registerOperatorHandlers(socket, ctx);
    registerAudienceHandlers(socket, ctx, voteLimiter);

    // Send current state immediately on join / reconnect.
    broadcaster.sendFullTo(socket);

    socket.on('disconnect', (reason) => {
      logger.debug({ role, id: socket.id, reason }, 'socket disconnected');
    });
  });

  return { io, broadcaster };
}
