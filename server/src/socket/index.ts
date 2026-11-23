import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../util/logger';
import { TokenBucketLimiter } from '../util/rateLimit';
import { socketAuthMiddleware } from '../auth/socketAuth';
import type { RoomStore } from '../game/store';
import { Broadcaster } from './broadcast';
import { getVoter } from '../persistence/voters';
import { registerOperatorHandlers, type ServerInfo } from './handlers/operator';
import { registerAudienceHandlers } from './handlers/audience';
import { type AppServer, type AppSocket, ROOM_FULL, ROOM_AUDIENCE } from './types';

export interface RealtimeServer {
  io: AppServer;
  broadcaster: Broadcaster;
}

/** Server facts the status strip needs that live outside the socket layer. */
export interface ServerFacts {
  snapshots: ServerInfo['snapshots'];
  lastSavedAt: ServerInfo['lastSavedAt'];
}

export function createIo(httpServer: HttpServer, store: RoomStore, facts: ServerFacts): RealtimeServer {
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

  const broadcaster = new Broadcaster(io, store);
  broadcaster.start();

  const info: ServerInfo = {
    online: () => {
      const online = { operators: 0, displays: 0, phones: 0 };
      for (const s of io.sockets.sockets.values()) {
        const role = (s as AppSocket).data.role;
        if (role === 'operator') online.operators++;
        else if (role === 'display') online.displays++;
        else if (role === 'audience') online.phones++;
      }
      return online;
    },
    snapshots: facts.snapshots,
    lastSavedAt: facts.lastSavedAt,
  };

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
    const ctx = { store, broadcaster, info };
    registerOperatorHandlers(socket, ctx);
    registerAudienceHandlers(socket, ctx, voteLimiter);

    // Load the registered voter name onto the socket UP FRONT (not just on the
    // first vote). socket.data is rebuilt on every (re)connect and the token
    // carries no name for email/password logins, so without this a vote after a
    // reconnect would be stored nameless and voterScores would fall back to the
    // raw uid. Fire-and-forget: it resolves well before the first vote.
    if (role === 'audience' && socket.data.uid && !socket.data.name) {
      getVoter(socket.data.uid)
        .then((v) => {
          if (v?.name) socket.data.name = v.name;
        })
        .catch(() => {});
    }

    // Send current state immediately on join / reconnect.
    broadcaster.sendFullTo(socket);

    socket.on('disconnect', (reason) => {
      logger.debug({ role, id: socket.id, reason }, 'socket disconnected');
    });
  });

  return { io, broadcaster };
}
