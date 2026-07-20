import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  loadDAVEWebReadOnlySnapshot,
  type DAVEWebReadOnlySnapshot,
} from '../../services/DAVEWebReadOnlyRepository';
import {
  DAVEWebAuthorizationError,
  daveWebSupabaseGateway,
} from '../../services/DAVEWebSupabaseClient';

export type DesktopAuthPhase =
  | 'checking'
  | 'signed_out'
  | 'signing_in'
  | 'loading'
  | 'ready'
  | 'unauthorized'
  | 'error';

type DesktopAuthContextValue = Readonly<{
  phase: DesktopAuthPhase;
  userEmail: string | null;
  sessionExpiresAt: number | null;
  snapshot: DAVEWebReadOnlySnapshot | null;
  message: string | null;
  signInWithPassword: (email: string, password: string) => Promise<boolean>;
  signOutOfDesktop: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
}>;

const DesktopAuthContext = createContext<DesktopAuthContextValue | null>(null);

export function DesktopAuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<DesktopAuthPhase>('checking');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<DAVEWebReadOnlySnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const loadSequenceRef = useRef(0);

  const clearSessionView = useCallback((nextPhase: DesktopAuthPhase = 'signed_out') => {
    if (!mountedRef.current) return;
    loadSequenceRef.current += 1;
    setUserEmail(null);
    setSessionExpiresAt(null);
    setSnapshot(null);
    setMessage(null);
    setPhase(nextPhase);
  }, []);

  const loadAuthorizedSnapshot = useCallback(async (session: Session | null) => {
    if (!session?.user) {
      clearSessionView();
      return false;
    }

    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    if (mountedRef.current) {
      setPhase('loading');
      setMessage(null);
      setUserEmail(session.user.email ?? null);
      setSessionExpiresAt(session.expires_at ?? null);
    }

    try {
      const nextSnapshot = await loadDAVEWebReadOnlySnapshot();
      if (!mountedRef.current || loadSequenceRef.current !== loadSequence) return false;
      setSnapshot(nextSnapshot);
      setPhase('ready');
      return true;
    } catch (error) {
      if (!mountedRef.current || loadSequenceRef.current !== loadSequence) return false;
      setSnapshot(null);
      if (error instanceof DAVEWebAuthorizationError) {
        await daveWebSupabaseGateway.signOut();
        if (mountedRef.current) {
          setPhase('unauthorized');
          setMessage(error.message);
        }
        return false;
      }
      setPhase('error');
      setMessage('Authorized project data could not be loaded. Try refreshing the workspace.');
      return false;
    }
  }, [clearSessionView]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    void daveWebSupabaseGateway.getSessionStatus().then(async status => {
      if (cancelled) return;
      if (!status.configured) {
        setPhase('error');
        setMessage('The desktop cloud connection is not configured.');
        return;
      }
      if (!status.session) {
        clearSessionView();
        return;
      }
      if (!cancelled) await loadAuthorizedSnapshot(status.session);
    }).catch(() => {
      if (!cancelled) {
        setPhase('error');
        setMessage('The desktop session could not be checked.');
      }
    });

    const unsubscribe = daveWebSupabaseGateway.subscribeToAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'SIGNED_OUT' || !session) {
        clearSessionView();
        return;
      }
      if (
        event === 'INITIAL_SESSION' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'USER_UPDATED'
      ) {
        void loadAuthorizedSnapshot(session);
      }
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      unsubscribe();
    };
  }, [clearSessionView, loadAuthorizedSnapshot]);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    if (mountedRef.current) {
      setPhase('signing_in');
      setMessage(null);
    }
    const result = await daveWebSupabaseGateway.signIn(email.trim(), password);
    if (!result.ok || !result.session) {
      if (mountedRef.current) {
        setPhase('signed_out');
        setMessage('Sign-in could not be completed. Check your email and password, then try again.');
      }
      return false;
    }
    return loadAuthorizedSnapshot(result.session);
  }, [loadAuthorizedSnapshot]);

  const signOutOfDesktop = useCallback(async () => {
    await daveWebSupabaseGateway.signOut();
    clearSessionView();
  }, [clearSessionView]);

  const refreshSnapshot = useCallback(async () => {
    const status = await daveWebSupabaseGateway.getSessionStatus();
    if (!status.session) {
      clearSessionView();
      return;
    }
    await loadAuthorizedSnapshot(status.session);
  }, [clearSessionView, loadAuthorizedSnapshot]);

  const value = useMemo<DesktopAuthContextValue>(() => ({
    phase,
    userEmail,
    sessionExpiresAt,
    snapshot,
    message,
    signInWithPassword,
    signOutOfDesktop,
    refreshSnapshot,
  }), [
    message,
    phase,
    refreshSnapshot,
    sessionExpiresAt,
    signInWithPassword,
    signOutOfDesktop,
    snapshot,
    userEmail,
  ]);

  return <DesktopAuthContext.Provider value={value}>{children}</DesktopAuthContext.Provider>;
}

export function useDesktopAuth(): DesktopAuthContextValue {
  const value = useContext(DesktopAuthContext);
  if (!value) throw new Error('useDesktopAuth must be used inside DesktopAuthProvider.');
  return value;
}
