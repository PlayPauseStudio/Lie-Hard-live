// src/lib/realtime.ts
//
// Thin Socket.IO client wrapper for talking to lie-hard-server. Mirrors the
// server's wire protocol (src/protocol/events.ts). The server is the authority
// for game state; clients emit intent and receive redacted state.

import { io, type Socket } from 'socket.io-client';

export type Role = 'operator' | 'display' | 'audience';

// The realtime server URL (wss/https in prod). Falls back to localhost in dev.
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:8080';
export const WS_HTTP_URL = process.env.NEXT_PUBLIC_WS_HTTP_URL || WS_URL;

// ── Event names (must match the server) ──────────────────────────────────────
export const OP = {
  START_SHOW: 'op:startShow',
  GOTO_PHASE: 'op:gotoPhase',
  WARMUP_NAV: 'op:warmupNav',
  OPEN_VOTE: 'op:openVote',
  LOCK_VOTE: 'op:lockVote',
  REVEAL: 'op:reveal',
  SELECT_STORYTELLER: 'op:selectStoryteller',
  SET_PLAYER_VOTE: 'op:setPlayerVote',
  TOGGLE_STATEMENT: 'op:toggleStatement',
  TOGGLE_SEG1_STATEMENT: 'op:toggleSeg1Statement',
  EDIT_SEG1: 'op:editSeg1',
  EDIT_SEG2: 'op:editSeg2',
  EDIT_SEG3: 'op:editSeg3',
  SET_SEG3_STATEMENT: 'op:setSeg3Statement',
  TOGGLE_SEG3_STATEMENT: 'op:toggleSeg3Statement',
  AWARD_SEGMENT: 'op:awardSegment',
  AWARD_SEGMENT3: 'op:awardSegment3',
  SET_SEGMENT_POINTS: 'op:setSegmentPoints',
  SET_AUDIENCE_LINK: 'op:setAudienceLink',
  ADJUST_SCORE: 'op:adjustScore',
  TOGGLE_DISPLAY: 'op:toggleDisplay',
  TIMER_START: 'op:timerStart',
  TIMER_STOP: 'op:timerStop',
  TIMER_RESET: 'op:timerReset',
  RESET_GAME: 'op:resetGame',
  DELETE_USER_DATA: 'op:deleteUserData',
} as const;

export const AUD = {
  REGISTER: 'aud:register',
  VOTE: 'aud:vote',
} as const;

export const SRV = {
  STATE_FULL: 'state:full',
  STATE_PATCH: 'state:patch',
  ERROR: 'error',
} as const;

export interface Ack {
  ok: boolean;
  error?: string;
  choice?: string;
  votingRound?: string | null;
  registered?: boolean;
}

export type TokenProvider = () => Promise<string | null> | string | null;

/**
 * Create a configured socket for a given role. For audience, `getToken` returns
 * a fresh Firebase ID token (re-fetched on every (re)connect so it never
 * expires); for operator it returns the stored JWT; for display it's omitted.
 */
export function createGameSocket(role: Role, getToken?: TokenProvider): Socket {
  return io(WS_URL, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    auth: (cb) => {
      Promise.resolve(getToken ? getToken() : null)
        .then((token) => cb({ role, token: token ?? undefined }))
        .catch(() => cb({ role }));
    },
  });
}

/** Promise-based emit that resolves the server ack. */
export function emitAck(socket: Socket, event: string, payload?: unknown): Promise<Ack> {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload ?? {}, (err: unknown, ack: Ack) => {
      if (err) resolve({ ok: false, error: 'timeout' });
      else resolve(ack ?? { ok: false, error: 'no_ack' });
    });
  });
}

/** POST the operator password to the server and return a JWT (or null). */
export async function operatorLogin(password: string): Promise<string | null> {
  try {
    const res = await fetch(`${WS_HTTP_URL}/auth/operator/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    return data.token ?? null;
  } catch {
    return null;
  }
}
