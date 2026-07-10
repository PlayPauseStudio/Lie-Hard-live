'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { operatorLogin } from '@/lib/realtime';

interface ControlAccessContextType {
  isAuthenticated: boolean;
  authenticate: (password: string) => Promise<boolean>;
  logout: () => void;
  /** Current operator JWT (or null) — supplied to the WebSocket handshake. */
  getToken: () => string | null;
}

const ControlAccessContext = createContext<ControlAccessContextType | undefined>(undefined);

const TOKEN_KEY = 'operator_jwt';

/** Decode a JWT's exp claim (client-side sanity check only; the server verifies). */
function tokenValid(token: string | null): boolean {
  if (!token) return false;
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' && json.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function ControlAccessProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem(TOKEN_KEY);
      if (stored && tokenValid(stored)) setToken(stored);
      else if (stored) sessionStorage.removeItem(TOKEN_KEY);
    }
    setIsInitialized(true);
  }, []);

  // The password is verified server-side; on success the server returns a JWT.
  // Authority now lives on the server — this is no longer a bypassable gate.
  const authenticate = async (password: string): Promise<boolean> => {
    const jwt = await operatorLogin(password);
    if (jwt) {
      setToken(jwt);
      if (typeof window !== 'undefined') sessionStorage.setItem(TOKEN_KEY, jwt);
      return true;
    }
    return false;
  };

  const logout = () => {
    setToken(null);
    if (typeof window !== 'undefined') sessionStorage.removeItem(TOKEN_KEY);
  };

  const getToken = () => (token && tokenValid(token) ? token : null);

  if (!isInitialized) return null;

  const isAuthenticated = tokenValid(token);

  return (
    <ControlAccessContext.Provider value={{ isAuthenticated, authenticate, logout, getToken }}>
      {children}
    </ControlAccessContext.Provider>
  );
}

export function useControlAccess() {
  const context = useContext(ControlAccessContext);
  if (context === undefined) {
    throw new Error('useControlAccess must be used within a ControlAccessProvider');
  }
  return context;
}
