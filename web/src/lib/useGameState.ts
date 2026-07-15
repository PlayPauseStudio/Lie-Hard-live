// src/lib/useGameState.ts
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { createGameSocket, emitAck, SRV, type Ack, type Role, type TokenProvider } from './realtime';

interface StateMsg<T> {
  version: number;
  state: T;
}
interface PatchMsg<T> {
  version: number;
  changed: Partial<T>;
}

export interface UseGameStateOptions {
  /** Returns a fresh auth token on each (re)connect (Firebase ID token / operator JWT). */
  getToken?: TokenProvider;
  /** Gate the connection until auth is ready (e.g. audience signed in, operator has JWT). */
  enabled?: boolean;
}

export interface UseGameState<T> {
  gameState: T | null;
  connected: boolean;
  emit: (event: string, payload?: unknown) => Promise<Ack>;
}

/**
 * Subscribe to authoritative game state over WebSocket, replacing the old
 * Firestore onSnapshot pattern. Operator/display receive `state:patch` deltas
 * (shallow-merged into the current state); audience receives full redacted
 * `state:full` snapshots. On (re)connect the server always sends a fresh
 * `state:full`, so no manual gap recovery is needed.
 */
export function useGameState<T>(role: Role, opts: UseGameStateOptions = {}): UseGameState<T> {
  const { getToken, enabled = true } = opts;
  const [gameState, setGameState] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Keep the latest token provider without forcing a reconnect when it changes identity.
  const tokenRef = useRef<TokenProvider | undefined>(getToken);
  tokenRef.current = getToken;

  useEffect(() => {
    if (!enabled) return;

    const socket = createGameSocket(role, () => (tokenRef.current ? tokenRef.current() : null));
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on(SRV.STATE_FULL, (msg: StateMsg<T>) => setGameState(msg.state));
    socket.on(SRV.STATE_PATCH, (msg: PatchMsg<T>) =>
      setGameState((prev) => (prev ? { ...prev, ...msg.changed } : prev)),
    );

    // Phones drop the socket when the screen locks / the tab is backgrounded.
    // Reconnect the instant the page becomes visible again (or the network
    // returns), instead of waiting out Socket.IO's backoff — resume feels
    // instant and the audience never has to reload. On reconnect the server
    // sends a fresh state:full, so state resyncs automatically.
    const resume = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (!socket.connected) socket.connect();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);

    return () => {
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [role, enabled]);

  const emit = useCallback((event: string, payload?: unknown): Promise<Ack> => {
    const socket = socketRef.current;
    if (!socket) return Promise.resolve({ ok: false, error: 'not_connected' });
    return emitAck(socket, event, payload);
  }, []);

  return { gameState, connected, emit };
}
