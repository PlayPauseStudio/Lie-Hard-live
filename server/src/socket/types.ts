import type { Server, Socket, DefaultEventsMap } from 'socket.io';
import type { SocketData } from '../auth/socketAuth';

// Loosely-typed event maps (we validate payloads with zod at runtime); the
// meaningful generic here is SocketData, which carries the trusted role + uid.
export type AppServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
export type AppSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

/** Room holding trusted clients (operator + display) — full-fidelity state. */
export const ROOM_FULL = 'room:full';
/** Room holding audience phones — redacted projections only. */
export const ROOM_AUDIENCE = 'room:audience';
