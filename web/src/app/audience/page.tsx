"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  doc,
  onSnapshot,
  updateDoc,
  disableNetwork,
  enableNetwork,
} from "firebase/firestore";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  User,
} from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import { useGameState } from "@/lib/useGameState";
import { AUD } from "@/lib/realtime";

// ── Types ──────────────────────────────────────────────────────────────────

interface Player {
  id: number;
  name: string;
  score: number;
  photo: string;
}
interface WarmupStatement {
  statement: string;
  isLie: boolean;
}
interface Segment1Statement {
  playerId: number;
  playerName: string;
  statement: string;
  isLie: boolean;
}
interface Segment2Statement {
  playerId: number;
  playerName: string;
  statements: string[];
  lieIndex: number;
}

interface GameState {
  phase: "SETUP" | "WARMUP" | "SEGMENT1" | "SEGMENT2" | "SEGMENT3" | "FINAL";
  players: Player[];
  warmup: {
    statements: WarmupStatement[];
    currentIndex: number;
    audienceVotingOpen: boolean;
    showResult: boolean;
  };
  segment1: {
    statements: Segment1Statement[];
    currentStorytellerId: number | null;
    audienceVotingOpen: boolean;
    showResult: boolean;
    statementShown?: boolean;
  };
  segment2: {
    statements: Segment2Statement[];
    currentStorytellerId: number | null;
    audienceVotingOpen: boolean;
    showResult: boolean;
    revealedStatements: number[];
  };
  segment3: {
    photoUrl: string | null;
    photoTitle: string | null;
    audienceVotingOpen: boolean;
    showResult: boolean;
    winnerId: number | null;
  };
}

interface VoterDoc {
  name: string;
  phone: string;
  registeredAt: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getCurrentVotingRound(gs: GameState): string | null {
  // Gate on phase too: once the show advances (e.g. to FINAL) a leftover
  // audienceVotingOpen flag must NOT keep a voting screen alive on phones.
  if (gs.phase === "WARMUP" && gs.warmup?.audienceVotingOpen)
    return `warmup-${gs.warmup.currentIndex}`;
  if (
    gs.phase === "SEGMENT1" &&
    gs.segment1?.audienceVotingOpen &&
    gs.segment1.currentStorytellerId != null
  )
    return `seg1-${gs.segment1.currentStorytellerId}`;
  if (
    gs.phase === "SEGMENT2" &&
    gs.segment2?.audienceVotingOpen &&
    gs.segment2.currentStorytellerId != null
  )
    return `seg2-${gs.segment2.currentStorytellerId}`;
  if (gs.phase === "SEGMENT3" && gs.segment3?.audienceVotingOpen) return "seg3";
  return null;
}

// ── Google G SVG ───────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" className="shrink-0">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
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
  const [emailFormData, setEmailFormData] = useState({
    email: "",
    password: "",
  });
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Registration form state
  const [regFormData, setRegFormData] = useState({ name: "", phone: "" });
  const [regError, setRegError] = useState("");
  const [registering, setRegistering] = useState(false);

  // Failover: control/mode.backupMode. Normally we use the secure WebSocket; on
  // backup mode we read state from and vote to Firestore directly — staying on
  // this same URL so the audience never has to sign in again.
  const [backupMode, setBackupMode] = useState(false);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "control", "mode"), (snap) => {
      setBackupMode(snap.exists() ? Boolean(snap.data()?.backupMode) : false);
    });
    return () => unsub();
  }, []);

  // Optional creative-team form. URL lives in control/config.audienceFormUrl.
  // When set, the registration screen requires tapping it open once before
  // Register unlocks — a soft gate (no submission tracking). Empty/unset means
  // no gate and the normal flow. `formOpened` is local only (not persisted), so
  // a returning viewer who's already registered never sees it again.
  const [audienceFormUrl, setAudienceFormUrl] = useState("");
  const [formOpened, setFormOpened] = useState(false);
  // Operator-pushed link button (any URL) with a live SHOW/HIDE toggle, both from
  // control/config. When shown + set, a button on this screen opens it in a new tab.
  const [audienceLinkUrl, setAudienceLinkUrl] = useState("");
  const [audienceLinkShown, setAudienceLinkShown] = useState(false);
  const [audienceLinkLabel, setAudienceLinkLabel] = useState("");
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "control", "config"), (snap) => {
      const d = snap.exists() ? snap.data() : {};
      setAudienceFormUrl(String(d?.audienceFormUrl ?? ""));
      setAudienceLinkUrl(String(d?.audienceLinkUrl ?? ""));
      setAudienceLinkShown(Boolean(d?.audienceLinkShown));
      setAudienceLinkLabel(String(d?.audienceLinkLabel ?? ""));
    });
    return () => unsub();
  }, []);

  // Restore the "form opened" gate after a background-tab reload (mobile), so a
  // viewer who already opened the form isn't re-blocked from registering.
  useEffect(() => {
    try {
      if (
        audienceFormUrl &&
        localStorage.getItem("lh_formOpened:" + audienceFormUrl)
      ) {
        setFormOpened(true);
      }
    } catch {
      /* storage unavailable — fine */
    }
  }, [audienceFormUrl]);

  // Browser online status drives the "Reconnecting…" banner in backup mode.
  // Phones freeze background tabs; on wake, Firestore's socket can stay wedged
  // (matters in backup mode + for the voters/config listeners). `online` only
  // fires on network changes, so we also toggle the network on `visibilitychange`
  // to force a resync.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let reconnecting = false;
    const reconnect = async () => {
      if (reconnecting) return;
      reconnecting = true;
      try {
        await disableNetwork(db);
        await enableNetwork(db);
      } catch {
        /* best-effort resync */
      } finally {
        reconnecting = false;
      }
    };
    const on = () => {
      setOnline(true);
      void reconnect();
    };
    const off = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (typeof navigator !== "undefined") setOnline(navigator.onLine);
        void reconnect();
      }
    };
    if (typeof navigator !== "undefined") setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Game / voting — authoritative state over WebSocket (audience role).
  const getToken = useCallback(
    () =>
      auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null),
    [],
  );
  const {
    gameState: socketState,
    emit,
    connected: socketConnected,
  } = useGameState<GameState>("audience", {
    getToken,
    enabled: !!user && !backupMode,
  });

  // Firestore game state — used only in backup mode (server paused/down).
  const [firestoreState, setFirestoreState] = useState<GameState | null>(null);
  useEffect(() => {
    if (!backupMode) return;
    const unsub = onSnapshot(doc(db, "gameState", "live"), (snap) => {
      if (snap.exists()) setFirestoreState(snap.data() as GameState);
    });
    return () => unsub();
  }, [backupMode]);

  const gameState = backupMode ? firestoreState : socketState;
  const connected = backupMode ? online : socketConnected;

  const [myVote, setMyVote] = useState<{
    choice: string;
    votingRound: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [voteError, setVoteError] = useState("");
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

  // Surface any error from a redirect-based Google sign-in (mobile fallback).
  useEffect(() => {
    getRedirectResult(auth).catch((e: unknown) => {
      setAuthError(
        e instanceof Error ? e.message : "Sign-in failed. Try again.",
      );
    });
  }, []);

  // ── Voter doc lookup (real-time — detects remote deletion) ──────────────

  useEffect(() => {
    if (!user) return;
    setVoterDoc(null); // loading
    const unsub = onSnapshot(doc(db, "voters", user.uid), (snap) => {
      setVoterDoc(snap.exists() ? (snap.data() as VoterDoc) : false);
    });
    return () => unsub();
  }, [user]);

  // ── Reset showChange on new voting round ─────────────────────────────────

  const currentVotingRound = gameState
    ? getCurrentVotingRound(gameState)
    : null;
  useEffect(() => {
    if (currentVotingRound !== lastVotingRound) {
      setLastVotingRound(currentVotingRound);
      setShowChange(false);
      setVoteError("");
    }
  }, [currentVotingRound, lastVotingRound]);

  // ── Auth handlers ─────────────────────────────────────────────────────────

  async function handleGoogleSignIn() {
    setAuthError("");
    if (!termsAccepted) {
      setAuthError("Please accept the Terms & Privacy Policy first.");
      return;
    }
    setSigningIn(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code ?? "";
      // Popups are commonly blocked on phones / in-app browsers — fall back to a full-page redirect.
      if (
        code === "auth/popup-blocked" ||
        code === "auth/cancelled-popup-request" ||
        code === "auth/operation-not-supported-in-this-environment"
      ) {
        try {
          await signInWithRedirect(auth, provider);
          return; // page navigates to Google and back
        } catch (e2: unknown) {
          setAuthError(
            e2 instanceof Error ? e2.message : "Sign-in failed. Try again.",
          );
        }
      } else if (code !== "auth/popup-closed-by-user") {
        setAuthError(
          e instanceof Error ? e.message : "Sign-in failed. Try again.",
        );
      }
    } finally {
      setSigningIn(false);
    }
  }

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    if (!termsAccepted) {
      setAuthError("Please accept the Terms & Privacy Policy first.");
      return;
    }
    const { email, password } = emailFormData;
    if (password.length < 6) {
      setAuthError("Password must be at least 6 characters.");
      return;
    }
    setSigningIn(true);
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (
        msg.includes("user-not-found") ||
        msg.includes("wrong-password") ||
        msg.includes("invalid-credential")
      ) {
        setAuthError("Incorrect email or password.");
      } else if (msg.includes("email-already-in-use")) {
        setAuthError("Account already exists. Try signing in.");
      } else {
        setAuthError(msg || "Something went wrong. Try again.");
      }
    } finally {
      setSigningIn(false);
    }
  }

  // ── Registration handler ──────────────────────────────────────────────────

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegError("");
    const { name, phone } = regFormData;
    if (!name.trim()) {
      setRegError("Please enter your name.");
      return;
    }
    if (!phone.trim()) {
      setRegError("Please enter your phone number.");
      return;
    }
    if (audienceFormUrl && !formOpened) {
      setRegError("Please open the form first.");
      return;
    }
    setRegistering(true);
    try {
      // Registration is written server-side (Firebase Admin), keyed by the
      // server-verified uid. The voters/{uid} onSnapshot below will also pick
      // it up, but we update optimistically for a snappy transition.
      const ack = await emit(AUD.REGISTER, {
        name: name.trim(),
        phone: phone.trim(),
      });
      if (!ack.ok) {
        setRegError("Failed to save. Please try again.");
        return;
      }
      setVoterDoc({
        name: name.trim(),
        phone: phone.trim(),
        registeredAt: Date.now(),
      });
    } catch {
      setRegError("Failed to save. Please try again.");
    } finally {
      setRegistering(false);
    }
  }

  // ── Vote submission ───────────────────────────────────────────────────────

  async function vote(choice: string) {
    if (!user || !gameState || !voterDoc) return;
    if (!connected) {
      setVoteError("Reconnecting to the show… wait a moment and tap again.");
      return;
    }
    setSubmitting(true);
    setVoteError("");
    try {
      if (backupMode) {
        // Failover: vote straight to Firestore, exactly like the backup audience.
        const votingRound = getCurrentVotingRound(gameState);
        if (!votingRound) {
          setVoteError("Voting is not open right now.");
          return;
        }
        await updateDoc(doc(db, "gameState", "live"), {
          [`audienceVotes.${user.uid}`]: {
            choice,
            votingRound,
            displayName: voterDoc.name,
          },
        });
        setMyVote({ choice, votingRound });
        return;
      }
      // The server derives the round, validates it's open, and dedupes per uid.
      const ack = await emit(AUD.VOTE, { choice });
      if (ack.ok && ack.votingRound) {
        setMyVote({
          choice: ack.choice ?? choice,
          votingRound: ack.votingRound,
        });
      } else {
        // Surface why the vote didn't take instead of silently dropping it.
        console.warn("Vote rejected:", ack);
        const e = ack.error;
        setVoteError(
          e === "no_open_round"
            ? "Voting is not open right now."
            : e === "not_all_revealed"
              ? "Hang on — wait for all the statements to be shown."
              : e === "rate_limited"
                ? "Slow down a second, then tap again."
                : e === "timeout" || e === "not_connected"
                  ? "Connection hiccup — please tap again."
                  : e === "forbidden"
                    ? "Please sign in again to vote."
                    : `Couldn't submit your vote — please try again.${e ? ` (${e})` : ""}`,
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Derived voting state ──────────────────────────────────────────────────

  const alreadyVoted = myVote?.votingRound === currentVotingRound;
  const showButtons = !alreadyVoted || showChange;
  const btnBase =
    "w-full rounded-2xl py-8 text-2xl font-bold mb-4 disabled:opacity-50 active:scale-95 transition-transform";

  const voteErrorToast = voteError ? (
    <div
      className="fixed bottom-4 left-4 right-4 z-50 rounded-2xl px-5 py-4 text-center"
      style={{ backgroundColor: "#450a0a", border: "1px solid #f87171" }}
    >
      <p className="text-red-200 text-base font-semibold">{voteError}</p>
    </div>
  ) : null;

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
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
        style={{
          background:
            "linear-gradient(135deg, #1a0533 0%, #0f1a3d 50%, #0a1a2e 100%)",
        }}
      >
        <div className="w-full max-w-sm space-y-8">
          {/* Title */}
          <div className="text-center">
            <h1 className="text-orange-500 text-5xl font-black tracking-tight mb-2">
              LIE HARD
            </h1>
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
              I agree to the{" "}
              <Link href="/terms/" className="text-orange-400 underline">
                Terms &amp; Conditions
              </Link>{" "}
              and{" "}
              <Link href="/privacy/" className="text-orange-400 underline">
                Privacy Policy
              </Link>
              .
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
              <label className="block text-gray-300 text-sm font-medium mb-1">
                Email
              </label>
              <input
                type="email"
                required
                value={emailFormData.email}
                onChange={(e) =>
                  setEmailFormData((p) => ({ ...p, email: e.target.value }))
                }
                placeholder="you@example.com"
                className="w-full rounded-xl px-4 py-3 text-white bg-gray-900 border border-gray-700 outline-none focus:border-orange-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-1">
                Password
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={emailFormData.password}
                onChange={(e) =>
                  setEmailFormData((p) => ({ ...p, password: e.target.value }))
                }
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
              {signingIn ? "Please wait..." : isSignUp ? "Sign Up" : "Sign In"}
            </button>
          </form>

          {/* Toggle sign-in / sign-up */}
          <p className="text-center text-gray-500 text-sm">
            {isSignUp ? "Already have an account? " : "Don't have an account? "}
            <button
              className="text-orange-400 underline"
              onClick={() => {
                setIsSignUp((v) => !v);
                setAuthError("");
              }}
            >
              {isSignUp ? "Sign In" : "Sign Up"}
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
            <h1 className="text-orange-500 text-4xl font-black tracking-tight mb-1">
              LIE HARD
            </h1>
            <p className="text-gray-400 text-sm">One-time registration</p>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-1">
                Your Name
              </label>
              <input
                type="text"
                required
                value={regFormData.name}
                onChange={(e) =>
                  setRegFormData((p) => ({ ...p, name: e.target.value }))
                }
                placeholder="Enter your name"
                className="w-full rounded-xl px-4 py-3 text-white bg-gray-900 border border-gray-700 outline-none focus:border-orange-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                required
                value={regFormData.phone}
                onChange={(e) =>
                  setRegFormData((p) => ({ ...p, phone: e.target.value }))
                }
                placeholder="Enter your phone number"
                className="w-full rounded-xl px-4 py-3 text-white bg-gray-900 border border-gray-700 outline-none focus:border-orange-500 transition-colors"
              />
            </div>
            {audienceFormUrl && (
              <div className="rounded-xl border border-orange-500/40 bg-orange-500/5 p-4 space-y-2">
                <p className="text-gray-300 text-sm text-center">
                  One quick step — tap to open our form, then come back and
                  continue.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    // No window-features string: some mobile browsers block the
                    // new tab when one is present. Persist so a background-tab
                    // reload doesn't re-lock Register after they open the form.
                    window.open(audienceFormUrl, "_blank");
                    setFormOpened(true);
                    try {
                      localStorage.setItem(
                        "lh_formOpened:" + audienceFormUrl,
                        "1",
                      );
                    } catch {
                      /* storage unavailable — fine */
                    }
                  }}
                  className="w-full rounded-xl py-3 font-bold text-base bg-orange-500/90 text-white active:scale-95 transition-transform"
                >
                  {formOpened ? "✓ Opened — tap to reopen" : "Open the form ↗"}
                </button>
              </div>
            )}

            {regError && (
              <p className="text-red-400 text-sm text-center">{regError}</p>
            )}

            <button
              type="submit"
              disabled={registering || (!!audienceFormUrl && !formOpened)}
              className="w-full rounded-xl py-4 font-bold text-base bg-orange-500 text-white disabled:opacity-60 active:scale-95 transition-transform"
            >
              {registering ? "Saving..." : "Register & Continue →"}
            </button>
          </form>

          <button
            className="w-full text-gray-600 text-sm underline"
            onClick={() => signOut(auth)}
          >
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
      <>
        {!connected && (
          <div
            className="flex items-center justify-center gap-2 py-1.5 text-xs font-medium"
            style={{
              backgroundColor: "rgba(245,158,11,0.15)",
              color: "#fbbf24",
              borderBottom: "1px solid rgba(245,158,11,0.3)",
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ backgroundColor: "#fbbf24" }}
            />
            Reconnecting…
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <span className="text-orange-500 font-bold text-sm tracking-widest">
            LIE HARD
          </span>
          <div className="flex items-center gap-3">
            {user?.photoURL && (
              <img
                src={user.photoURL}
                alt=""
                className="w-7 h-7 rounded-full object-cover"
              />
            )}
            <span className="text-gray-400 text-sm">
              {(voterDoc as VoterDoc).name}
            </span>
            <button
              className="text-gray-600 text-xs underline"
              onClick={() => signOut(auth)}
            >
              Sign out
            </button>
          </div>
        </div>
        {audienceLinkShown && audienceLinkUrl && (
          <div className="px-4 py-3">
            <button
              onClick={() => window.open(audienceLinkUrl, "_blank")}
              className="w-full inline-flex items-center justify-center gap-2 font-display font-black uppercase leading-none active:scale-95 transition-transform"
              style={{
                padding: "1.35rem 1.15rem",
                backgroundColor: "rgba(28,28,32,0.65)",
                border: "2px solid #f59e0b",
                borderRadius: "0.7rem",
                boxShadow: "0 4px 24px rgba(0,0,0,0.55)",
                color: "#f59e0b",
                fontSize: "1.35rem",
                letterSpacing: "0.02em",
              }}
            >
              {audienceLinkLabel || "Open link"}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ width: "1.05em", height: "1.05em", flexShrink: 0 }}
                aria-hidden="true"
              >
                <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              </svg>
            </button>
          </div>
        )}
      </>
    );
  }

  // ── Confirmation message ──────────────────────────────────────────────────

  function ConfirmationMessage({ choice }: { choice: string }) {
    const label =
      choice === "TRUTH"
        ? "TRUTH"
        : choice === "LIE"
          ? "LIE"
          : choice.startsWith("STATEMENT_")
            ? `Statement ${parseInt(choice.replace("STATEMENT_", ""), 10) + 1} is the Lie`
            : (gameState!.players.find((p) => p.id === parseInt(choice))
                ?.name ?? `Player ${choice}`);
    const color =
      choice === "TRUTH"
        ? "text-green-400"
        : choice === "LIE"
          ? "text-red-400"
          : "text-orange-400";
    return (
      <div className="flex flex-col items-center gap-6 px-6">
        <div className="rounded-2xl bg-gray-900 border-2 border-gray-700 px-8 py-6 text-center w-full">
          <p className="text-gray-400 text-sm uppercase tracking-widest mb-2">
            Your vote
          </p>
          <p className={`text-3xl font-bold ${color}`}>{label}</p>
        </div>
        <button
          onClick={() => setShowChange(true)}
          className="text-gray-400 underline text-base"
        >
          Change vote
        </button>
      </div>
    );
  }

  const { phase, warmup, segment1, segment2, segment3, players } = gameState;

  // ── Warmup ────────────────────────────────────────────────────────────────

  if (phase === "WARMUP" && warmup?.audienceVotingOpen) {
    const stmt = warmup.statements?.[warmup.currentIndex];
    return (
      <div className="bg-black min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex flex-col px-4 py-8">
          <p className="text-gray-400 text-sm text-center mb-4 uppercase tracking-widest">
            Warmup Round
          </p>
          {stmt && (
            <p className="text-white text-xl text-center px-2 mb-8 leading-relaxed">
              {stmt.statement}
            </p>
          )}
          {showButtons ? (
            <>
              <button
                className={`${btnBase} bg-green-500 text-white`}
                disabled={submitting}
                onClick={() => {
                  setShowChange(false);
                  vote("TRUTH");
                }}
              >
                ✓ TRUTH
              </button>
              <button
                className={`${btnBase} bg-red-500 text-white`}
                disabled={submitting}
                onClick={() => {
                  setShowChange(false);
                  vote("LIE");
                }}
              >
                ✗ LIE
              </button>
            </>
          ) : (
            <ConfirmationMessage choice={myVote!.choice} />
          )}
          {voteErrorToast}
        </div>
      </div>
    );
  }

  // ── Segment 1 ─────────────────────────────────────────────────────────────

  if (
    phase === "SEGMENT1" &&
    segment1?.audienceVotingOpen &&
    segment1.currentStorytellerId != null
  ) {
    const stmtObj = segment1.statements?.find(
      (s) => s.playerId === segment1.currentStorytellerId,
    );
    const storytellerName =
      players.find((p) => p.id === segment1.currentStorytellerId)?.name ??
      stmtObj?.playerName ??
      "";
    return (
      <div className="bg-black min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex flex-col px-4 py-8">
          <p className="text-gray-400 text-sm text-center mb-2 uppercase tracking-widest">
            Segment 1
          </p>
          {stmtObj && (
            <>
              <p className="text-orange-400 text-2xl font-bold text-center mb-4">
                {storytellerName}
              </p>
              {segment1.statementShown ? (
                <p className="text-white text-xl text-center px-2 mb-8 leading-relaxed">
                  {stmtObj.statement}
                </p>
              ) : (
                <p className="text-gray-600 text-center text-base mb-8">
                  Listen to the statement, then vote.
                </p>
              )}
            </>
          )}
          {showButtons ? (
            <>
              <button
                className={`${btnBase} bg-green-500 text-white`}
                disabled={submitting}
                onClick={() => {
                  setShowChange(false);
                  vote("TRUTH");
                }}
              >
                TRUTH
              </button>
              <button
                className={`${btnBase} bg-red-500 text-white`}
                disabled={submitting}
                onClick={() => {
                  setShowChange(false);
                  vote("LIE");
                }}
              >
                LIE
              </button>
            </>
          ) : (
            <ConfirmationMessage choice={myVote!.choice} />
          )}
          {voteErrorToast}
        </div>
      </div>
    );
  }

  // ── Segment 2 ─────────────────────────────────────────────────────────────

  if (
    phase === "SEGMENT2" &&
    segment2?.audienceVotingOpen &&
    segment2.currentStorytellerId != null
  ) {
    const stmtObj = segment2.statements?.find(
      (s) => s.playerId === segment2.currentStorytellerId,
    );
    const storytellerName =
      players.find((p) => p.id === segment2.currentStorytellerId)?.name ??
      stmtObj?.playerName ??
      "";
    const revealed = segment2.revealedStatements ?? [];
    const revealedStatements = (stmtObj?.statements ?? []).filter((_, i) =>
      revealed.includes(i),
    );
    const allRevealed = stmtObj
      ? revealed.length >= stmtObj.statements.length
      : false;
    return (
      <div className="bg-black min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex flex-col px-4 py-8">
          <p className="text-gray-400 text-sm text-center mb-2 uppercase tracking-widest">
            Segment 2
          </p>
          {stmtObj && (
            <>
              <p className="text-orange-400 text-2xl font-bold text-center mb-4">
                {storytellerName}
              </p>
              {revealedStatements.length === 0 ? (
                <p className="text-gray-600 text-center text-base mb-8">
                  Statements will appear here as they are revealed...
                </p>
              ) : (
                <div className="flex flex-col gap-4 mb-8">
                  {(stmtObj?.statements ?? []).map((stmt, i) =>
                    revealed.includes(i) ? (
                      <div
                        key={i}
                        className="bg-gray-900 rounded-xl p-4 border border-gray-700"
                      >
                        <p className="text-gray-400 text-xs uppercase tracking-widest mb-1">
                          Statement {i + 1}
                        </p>
                        <p className="text-white text-lg leading-relaxed">
                          {stmt}
                        </p>
                      </div>
                    ) : null,
                  )}
                </div>
              )}
            </>
          )}
          {allRevealed && showButtons ? (
            <>
              {(stmtObj?.statements ?? []).map((_, i) => (
                <button
                  key={i}
                  className={`${btnBase} bg-orange-500 text-white`}
                  disabled={submitting}
                  onClick={() => {
                    setShowChange(false);
                    vote(`STATEMENT_${i}`);
                  }}
                >
                  Statement {i + 1} is the Lie
                </button>
              ))}
            </>
          ) : allRevealed && !showButtons ? (
            <ConfirmationMessage choice={myVote!.choice} />
          ) : (
            <p className="text-gray-500 text-center text-base mt-4">
              Voting opens after all statements are revealed
            </p>
          )}
          {voteErrorToast}
        </div>
      </div>
    );
  }

  // ── Segment 3 ─────────────────────────────────────────────────────────────

  if (phase === "SEGMENT3" && segment3?.audienceVotingOpen) {
    return (
      <div className="bg-black min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex flex-col px-4 py-8">
          <p className="text-gray-400 text-sm text-center mb-2 uppercase tracking-widest">
            Segment 3
          </p>
          <p className="text-white text-xl text-center px-2 mb-8">
            Who does this belong to?
          </p>
          {showButtons ? (
            <>
              {players.map((player) => (
                <button
                  key={player.id}
                  className={`${btnBase} ${myVote?.choice === String(player.id) && showChange ? "bg-orange-500" : "bg-gray-700"} text-white`}
                  disabled={submitting}
                  onClick={() => {
                    setShowChange(false);
                    vote(String(player.id));
                  }}
                >
                  {player.name}
                </button>
              ))}
            </>
          ) : (
            <ConfirmationMessage choice={myVote!.choice} />
          )}
          {voteErrorToast}
        </div>
      </div>
    );
  }

  // ── Voting closed ─────────────────────────────────────────────────────────

  return (
    <div className="bg-black min-h-screen flex flex-col">
      <Header />
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-orange-500 text-4xl font-bold tracking-tight">
          LIE HARD
        </h1>
        {phase === "FINAL" ? (
          <>
            <p className="text-white text-2xl font-semibold mt-4">
              That&apos;s a wrap!
            </p>
            <p className="text-gray-500 text-base">Thanks for playing along.</p>
          </>
        ) : (
          <>
            <p className="text-white text-2xl font-semibold mt-4">
              Voting is closed
            </p>
            <p className="text-gray-500 text-base">Stay tuned...</p>
          </>
        )}
      </div>
    </div>
  );
}
