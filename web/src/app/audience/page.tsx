'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  GoogleAuthProvider, onAuthStateChanged, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, User,
} from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { useGameState } from '@/lib/useGameState';
import { AUD } from '@/lib/realtime';

// ── Types ──────────────────────────────────────────────────────────────────

interface Player { id: number; name: string; score: number; photo: string; }
interface WarmupStatement { statement: string; isLie: boolean; }
interface Segment1Statement { playerId: number; playerName: string; statement: string; isLie: boolean; }
interface Segment2Statement { playerId: number; playerName: string; statements: string[]; lieIndex: number; }

interface GameState {
  phase: 'SETUP' | 'WARMUP' | 'SEGMENT1' | 'SEGMENT2' | 'SEGMENT3' | 'FINAL';
  players: Player[];
  warmup: { statements: WarmupStatement[]; currentIndex: number; audienceVotingOpen: boolean; showResult: boolean; };
  segment1: { statements: Segment1Statement[]; currentStorytellerId: number | null; audienceVotingOpen: boolean; showResult: boolean; };
  segment2: { statements: Segment2Statement[]; currentStorytellerId: number | null; audienceVotingOpen: boolean; showResult: boolean; revealedStatements: number[]; };
  segment3: { photoUrl: string | null; photoTitle: string | null; audienceVotingOpen: boolean; showResult: boolean; winnerId: number | null; };
}

interface VoterDoc {
  name: string;
  phone: string;
  registeredAt: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getCurrentVotingRound(gs: GameState): string | null {
  if (gs.warmup?.audienceVotingOpen) return `warmup-${gs.warmup.currentIndex}`;
  if (gs.segment1?.audienceVotingOpen && gs.segment1.currentStorytellerId != null) return `seg1-${gs.segment1.currentStorytellerId}`;
  if (gs.segment2?.audienceVotingOpen && gs.segment2.currentStorytellerId != null) return `seg2-${gs.segment2.currentStorytellerId}`;
  if (gs.segment3?.audienceVotingOpen) return 'seg3';
  return null;
}

// ── Google G SVG ───────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" className="shrink-0">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AudiencePage() {
  // Auth
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Voter registration doc: null=loading, false=not-found, object=registered
  const [voterDoc, setVoterDoc] = useState<VoterDoc | null | false>(null);

  // Auth form state
  const [isSignUp, setIsSignUp] = useState(false);
  const [emailFormData, setEmailFormData] = useState({ email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Registration form state
  const [regFormData, setRegFormData] = useState({ name: '', phone: '' });
  const [regError, setRegError] = useState('');
  const [registering, setRegistering] = useState(false);

  // Game / voting — authoritative state over WebSocket (audience role).
  const getToken = useCallback(
    () => (auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null)),
    [],
  );
  const { gameState, emit } = useGameState<GameState>('audience', { getToken, enabled: !!user });
  const [myVote, setMyVote] = useState<{ choice: string; votingRound: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showChange, setShowChange] = useState(false);
  const [lastVotingRound, setLastVotingRound] = useState<string | null>(null);

  // ── Auth listener ────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (!u) setVoterDoc(null);
    });
    return () => unsub();
  }, []);

  // ── Voter doc lookup (real-time — detects remote deletion) ──────────────

  useEffect(() => {
    if (!user) return;
    setVoterDoc(null); // loading
    const unsub = onSnapshot(doc(db, 'voters', user.uid), (snap) => {
      setVoterDoc(snap.exists() ? (snap.data() as VoterDoc) : false);
    });
    return () => unsub();
  }, [user]);

  // ── Reset showChange on new voting round ─────────────────────────────────

  const currentVotingRound = gameState ? getCurrentVotingRound(gameState) : null;
  useEffect(() => {
    if (currentVotingRound !== lastVotingRound) {
      setLastVotingRound(currentVotingRound);
      setShowChange(false);
    }
  }, [currentVotingRound, lastVotingRound]);

  // ── Auth handlers ─────────────────────────────────────────────────────────

  async function handleGoogleSignIn() {
    setAuthError('');
    if (!termsAccepted) { setAuthError('Please accept the Terms & Privacy Policy first.'); return; }
    setSigningIn(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e: unknown) {
      setAuthError(e instanceof Error ? e.message : 'Sign-in failed. Try again.');
    } finally {
      setSigningIn(false);
    }
  }

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    if (!termsAccepted) { setAuthError('Please accept the Terms & Privacy Policy first.'); return; }
    const { email, password } = emailFormData;
    if (password.length < 6) { setAuthError('Password must be at least 6 characters.'); return; }
    setSigningIn(true);
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('user-not-found') || msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        setAuthError('Incorrect email or password.');
      } else if (msg.includes('email-already-in-use')) {
        setAuthError('Account already exists. Try signing in.');
      } else {
        setAuthError(msg || 'Something went wrong. Try again.');
      }
    } finally {
      setSigningIn(false);
    }
  }

  // ── Registration handler ──────────────────────────────────────────────────

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegError('');
    const { name, phone } = regFormData;
    if (!name.trim()) { setRegError('Please enter your name.'); return; }
    if (!phone.trim()) { setRegError('Please enter your phone number.'); return; }
    setRegistering(true);
    try {
      // Registration is written server-side (Firebase Admin), keyed by the
      // server-verified uid. The voters/{uid} onSnapshot below will also pick
      // it up, but we update optimistically for a snappy transition.
      const ack = await emit(AUD.REGISTER, { name: name.trim(), phone: phone.trim() });
      if (!ack.ok) {
        setRegError('Failed to save. Please try again.');
        return;
      }
      setVoterDoc({ name: name.trim(), phone: phone.trim(), registeredAt: Date.now() });
    } catch {
      setRegError('Failed to save. Please try again.');
    } finally {
      setRegistering(false);
    }
  }

  // ── Vote submission ───────────────────────────────────────────────────────

  async function vote(choice: string) {
    if (!user || !gameState || !voterDoc) return;
    setSubmitting(true);
    try {
      // The server derives the round, validates it's open, and dedupes per uid.
      const ack = await emit(AUD.VOTE, { choice });
      if (ack.ok && ack.votingRound) {
        setMyVote({ choice: ack.choice ?? choice, votingRound: ack.votingRound });
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Derived voting state ──────────────────────────────────────────────────

  const alreadyVoted = myVote?.votingRound === currentVotingRound;
  const showButtons = !alreadyVoted || showChange;
  const btnBase = 'w-full rounded-2xl py-8 text-2xl font-bold mb-4 disabled:opacity-50 active:scale-95 transition-transform';

  // ── SCREEN: Loading ───────────────────────────────────────────────────────

  if (authLoading || (user && voterDoc === null)) {
    return (
      <div className="bg-black min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── SCREEN: Not logged in — Google + Email/Password ───────────────────────

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
        style={{ background: 'linear-gradient(135deg, #1a0533 0%, #0f1a3d 50%, #0a1a2e 100%)' }}>

        <div className="w-full max-w-sm space-y-8">
          {/* Title */}
          <div className="text-center">
            <h1 className="text-orange-500 text-5xl font-black tracking-tight mb-2">LIE HARD</h1>
            <p className="text-gray-400 text-sm">Sign in to vote</p>
          </div>

          {/* Terms & Privacy consent */}
          <label className="flex items-start gap-3 text-left cursor-pointer">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
            />
            <span className="text-gray-400 text-xs leading-relaxed">
              I agree to the{' '}
              <Link href="/terms/" className="text-orange-400 underline">Terms &amp; Conditions</Link>{' '}
              and{' '}
              <Link href="/privacy/" className="text-orange-400 underline">Privacy Policy</Link>.
            </span>
          </label>

          {/* Google button */}
          <button
            onClick={handleGoogleSignIn}
            disabled={signingIn || !termsAccepted}
            className="w-full flex items-center justify-center gap-3 bg-white text-gray-800 font-semibold text-base rounded-xl py-4 disabled:opacity-60 disabled:cursor-not-allowed active:scale-95 transition-transform border-2 border-gray-200"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-700" />
            <span className="text-gray-500 text-sm">or</span>
            <div className="flex-1 h-px bg-gray-700" />
          </div>

          {/* Email / Password form */}
          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                required
                value={emailFormData.email}
                onChange={(e) => setEmailFormData((p) => ({ ...p, email: e.target.value }))}
                placeholder="you@example.com"
                className="w-full rounded-xl px-4 py-3 text-white bg-gray-900 border border-gray-700 outline-none focus:border-orange-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-1">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={emailFormData.password}
                onChange={(e) => setEmailFormData((p) => ({ ...p, password: e.target.value }))}
                placeholder="Min. 6 characters"
                className="w-full rounded-xl px-4 py-3 text-white bg-gray-900 border border-gray-700 outline-none focus:border-orange-500 transition-colors"
              />
            </div>

            {authError && (
              <p className="text-red-400 text-sm text-center">{authError}</p>
            )}

            <button
              type="submit"
              disabled={signingIn || !termsAccepted}
              className="w-full rounded-xl py-4 font-bold text-base bg-orange-500 text-white disabled:opacity-60 disabled:cursor-not-allowed active:scale-95 transition-transform"
            >
              {signingIn ? 'Please wait...' : isSignUp ? 'Sign Up' : 'Sign In'}
            </button>
          </form>

          {/* Toggle sign-in / sign-up */}
          <p className="text-center text-gray-500 text-sm">
            {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
            <button
              className="text-orange-400 underline"
              onClick={() => { setIsSignUp((v) => !v); setAuthError(''); }}
            >
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  // ── SCREEN: Logged in, first-time — Registration form ────────────────────

  if (voterDoc === false) {
    return (
      <div className="bg-black min-h-screen flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <h1 className="text-orange-500 text-4xl font-black tracking-tight mb-1">LIE HARD</h1>
            <p className="text-gray-400 text-sm">One-time registration</p>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-1">Your Name</label>
              <input
                type="text"
                required
                value={regFormData.name}
                onChange={(e) => setRegFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder="Enter your name"
                className="w-full rounded-xl px-4 py-3 text-white bg-gray-900 border border-gray-700 outline-none focus:border-orange-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-1">Phone Number</label>
              <input
                type="tel"
                required
                value={regFormData.phone}
                onChange={(e) => setRegFormData((p) => ({ ...p, phone: e.target.value }))}
                placeholder="Enter your phone number"
                className="w-full rounded-xl px-4 py-3 text-white bg-gray-900 border border-gray-700 outline-none focus:border-orange-500 transition-colors"
              />
            </div>
            {regError && <p className="text-red-400 text-sm text-center">{regError}</p>}

            <button
              type="submit"
              disabled={registering}
              className="w-full rounded-xl py-4 font-bold text-base bg-orange-500 text-white disabled:opacity-60 active:scale-95 transition-transform"
            >
              {registering ? 'Saving...' : 'Register & Continue →'}
            </button>
          </form>

          <button className="w-full text-gray-600 text-sm underline" onClick={() => signOut(auth)}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // ── From here: registered voter — show voting UI ──────────────────────────

  if (!gameState) {
    return (
      <div className="bg-black min-h-screen flex items-center justify-center">
        <p className="text-gray-500 text-lg">Connecting to game...</p>
      </div>
    );
  }

  // ── Header strip ─────────────────────────────────────────────────────────

  function Header() {
    return (
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <span className="text-orange-500 font-bold text-sm tracking-widest">LIE HARD</span>
        <div className="flex items-center gap-3">
          {user?.photoURL && <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full object-cover" />}
          <span className="text-gray-400 text-sm">{(voterDoc as VoterDoc).name}</span>
          <button className="text-gray-600 text-xs underline" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </div>
    );
  }

  // ── Confirmation message ──────────────────────────────────────────────────

  function ConfirmationMessage({ choice }: { choice: string }) {
    const label =
      choice === 'TRUTH' ? 'TRUTH'
      : choice === 'LIE' ? 'LIE'
      : choice.startsWith('STATEMENT_') ? `Statement ${parseInt(choice.replace('STATEMENT_', ''), 10) + 1} is the Lie`
      : gameState!.players.find((p) => p.id === parseInt(choice))?.name ?? `Player ${choice}`;
    const color = choice === 'TRUTH' ? 'text-green-400' : choice === 'LIE' ? 'text-red-400' : 'text-orange-400';
    return (
      <div className="flex flex-col items-center gap-6 px-6">
        <div className="rounded-2xl bg-gray-900 border-2 border-gray-700 px-8 py-6 text-center w-full">
          <p className="text-gray-400 text-sm uppercase tracking-widest mb-2">Your vote</p>
          <p className={`text-3xl font-bold ${color}`}>{label}</p>
        </div>
        <button onClick={() => setShowChange(true)} className="text-gray-400 underline text-base">
          Change vote
        </button>
      </div>
    );
  }

  const { warmup, segment1, segment2, segment3, players } = gameState;

  // ── Warmup ────────────────────────────────────────────────────────────────

  if (warmup?.audienceVotingOpen) {
    const stmt = warmup.statements?.[warmup.currentIndex];
    return (
      <div className="bg-black min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex flex-col px-4 py-8">
          <p className="text-gray-400 text-sm text-center mb-4 uppercase tracking-widest">Warmup Round</p>
          {stmt && <p className="text-white text-xl text-center px-2 mb-8 leading-relaxed">{stmt.statement}</p>}
          {showButtons ? (
            <>
              <button className={`${btnBase} bg-green-500 text-white`} disabled={submitting}
                onClick={() => { setShowChange(false); vote('TRUTH'); }}>✓ TRUTH</button>
              <button className={`${btnBase} bg-red-500 text-white`} disabled={submitting}
                onClick={() => { setShowChange(false); vote('LIE'); }}>✗ LIE</button>
            </>
          ) : <ConfirmationMessage choice={myVote!.choice} />}
        </div>
      </div>
    );
  }

  // ── Segment 1 ─────────────────────────────────────────────────────────────

  if (segment1?.audienceVotingOpen && segment1.currentStorytellerId != null) {
    const stmtObj = segment1.statements?.find((s) => s.playerId === segment1.currentStorytellerId);
    const storytellerName = players.find((p) => p.id === segment1.currentStorytellerId)?.name ?? stmtObj?.playerName ?? '';
    return (
      <div className="bg-black min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex flex-col px-4 py-8">
          <p className="text-gray-400 text-sm text-center mb-2 uppercase tracking-widest">Segment 1</p>
          {stmtObj && (
            <>
              <p className="text-orange-400 text-2xl font-bold text-center mb-4">{storytellerName}</p>
              <p className="text-white text-xl text-center px-2 mb-8 leading-relaxed">{stmtObj.statement}</p>
            </>
          )}
          {showButtons ? (
            <>
              <button className={`${btnBase} bg-green-500 text-white`} disabled={submitting}
                onClick={() => { setShowChange(false); vote('TRUTH'); }}>TRUTH</button>
              <button className={`${btnBase} bg-red-500 text-white`} disabled={submitting}
                onClick={() => { setShowChange(false); vote('LIE'); }}>LIE</button>
            </>
          ) : <ConfirmationMessage choice={myVote!.choice} />}
        </div>
      </div>
    );
  }

  // ── Segment 2 ─────────────────────────────────────────────────────────────

  if (segment2?.audienceVotingOpen && segment2.currentStorytellerId != null) {
    const stmtObj = segment2.statements?.find((s) => s.playerId === segment2.currentStorytellerId);
    const storytellerName = players.find((p) => p.id === segment2.currentStorytellerId)?.name ?? stmtObj?.playerName ?? '';
    const revealed = segment2.revealedStatements ?? [];
    const revealedStatements = (stmtObj?.statements ?? []).filter((_, i) => revealed.includes(i));
    const allRevealed = stmtObj ? revealed.length >= stmtObj.statements.length : false;
    return (
      <div className="bg-black min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex flex-col px-4 py-8">
          <p className="text-gray-400 text-sm text-center mb-2 uppercase tracking-widest">Segment 2</p>
          {stmtObj && (
            <>
              <p className="text-orange-400 text-2xl font-bold text-center mb-4">{storytellerName}</p>
              {revealedStatements.length === 0 ? (
                <p className="text-gray-600 text-center text-base mb-8">Statements will appear here as they are revealed...</p>
              ) : (
                <div className="flex flex-col gap-4 mb-8">
                  {(stmtObj?.statements ?? []).map((stmt, i) =>
                    revealed.includes(i) ? (
                      <div key={i} className="bg-gray-900 rounded-xl p-4 border border-gray-700">
                        <p className="text-gray-400 text-xs uppercase tracking-widest mb-1">Statement {i + 1}</p>
                        <p className="text-white text-lg leading-relaxed">{stmt}</p>
                      </div>
                    ) : null
                  )}
                </div>
              )}
            </>
          )}
          {allRevealed && showButtons ? (
            <>
              {(stmtObj?.statements ?? []).map((_, i) => (
                <button key={i} className={`${btnBase} bg-orange-500 text-white`} disabled={submitting}
                  onClick={() => { setShowChange(false); vote(`STATEMENT_${i}`); }}>
                  Statement {i + 1} is the Lie
                </button>
              ))}
            </>
          ) : allRevealed && !showButtons ? (
            <ConfirmationMessage choice={myVote!.choice} />
          ) : (
            <p className="text-gray-500 text-center text-base mt-4">Voting opens after all statements are revealed</p>
          )}
        </div>
      </div>
    );
  }

  // ── Segment 3 ─────────────────────────────────────────────────────────────

  if (segment3?.audienceVotingOpen) {
    return (
      <div className="bg-black min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex flex-col px-4 py-8">
          <p className="text-gray-400 text-sm text-center mb-2 uppercase tracking-widest">Segment 3</p>
          <p className="text-white text-xl text-center px-2 mb-8">Who does this belong to?</p>
          {showButtons ? (
            <>
              {players.map((player) => (
                <button key={player.id}
                  className={`${btnBase} ${myVote?.choice === String(player.id) && showChange ? 'bg-orange-500' : 'bg-gray-700'} text-white`}
                  disabled={submitting}
                  onClick={() => { setShowChange(false); vote(String(player.id)); }}>
                  {player.name}
                </button>
              ))}
            </>
          ) : <ConfirmationMessage choice={myVote!.choice} />}
        </div>
      </div>
    );
  }

  // ── Voting closed ─────────────────────────────────────────────────────────

  return (
    <div className="bg-black min-h-screen flex flex-col">
      <Header />
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
        <h1 className="text-orange-500 text-4xl font-bold tracking-tight">LIE HARD</h1>
        <p className="text-white text-2xl font-semibold mt-4">Voting is closed</p>
        <p className="text-gray-500 text-base">Stay tuned...</p>
      </div>
    </div>
  );
}
