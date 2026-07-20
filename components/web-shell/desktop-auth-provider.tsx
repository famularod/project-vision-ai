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
  type DAVEWebReferenceDocument,
  type DAVEWebReadOnlySnapshot,
} from '../../services/DAVEWebReadOnlyRepository';
import {
  DAVEWebAuthorizationError,
  daveWebSupabaseGateway,
} from '../../services/DAVEWebSupabaseClient';
import {
  scheduleItemForCloud,
  type DAVEWebScheduleItem,
} from '../../services/DAVEWebTaskEditing';

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
  createTask: (item: DAVEWebScheduleItem) => Promise<void>;
  updateTask: (item: DAVEWebScheduleItem) => Promise<void>;
  deleteTask: (item: DAVEWebScheduleItem) => Promise<void>;
  deleteDocument: (document: DAVEWebReferenceDocument, deleteLinkedTasks: boolean) => Promise<void>;
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

  const loadAuthorizedSnapshot = useCallback(async (
    session: Session | null,
    options: { background?: boolean } = {},
  ) => {
    if (!session?.user) {
      clearSessionView();
      return false;
    }

    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    if (mountedRef.current && !options.background) {
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
      if (!options.background) setSnapshot(null);
      if (error instanceof DAVEWebAuthorizationError) {
        await daveWebSupabaseGateway.signOut();
        if (mountedRef.current) {
          setPhase('unauthorized');
          setMessage(error.message);
        }
        return false;
      }
      if (options.background) {
        setMessage('Automatic cloud refresh is waiting. Your current workspace remains available.');
      } else {
        setPhase('error');
        setMessage('Authorized project data could not be loaded. Try refreshing the workspace.');
      }
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

  useEffect(() => {
    if (phase !== 'ready') return;
    let active = true;
    let inFlight = false;

    const refreshInBackground = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const status = await daveWebSupabaseGateway.getSessionStatus();
        if (!active) return;
        if (!status.session) {
          clearSessionView();
          return;
        }
        await loadAuthorizedSnapshot(status.session, { background: true });
      } catch {
        if (active) {
          setMessage('Automatic cloud refresh is waiting. Your current workspace remains available.');
        }
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(() => { void refreshInBackground(); }, 12_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [clearSessionView, loadAuthorizedSnapshot, phase]);

  const createTask = useCallback(async (item: DAVEWebScheduleItem) => {
    await daveWebSupabaseGateway.createAuthorizedScheduleItem(
      scheduleItemForCloud(item),
    );
    await refreshSnapshot();
  }, [refreshSnapshot]);

  const updateTask = useCallback(async (item: DAVEWebScheduleItem) => {
    await daveWebSupabaseGateway.updateAuthorizedScheduleItem(
      scheduleItemForCloud(item),
      item.cloudUpdatedAt,
    );
    await refreshSnapshot();
  }, [refreshSnapshot]);

  const deleteTask = useCallback(async (item: DAVEWebScheduleItem) => {
    await daveWebSupabaseGateway.deleteAuthorizedScheduleItem(
      item.id,
      item.cloudUpdatedAt,
    );
    await refreshSnapshot();
  }, [refreshSnapshot]);

  const deleteDocument = useCallback(async (
    document: DAVEWebReferenceDocument,
    deleteLinkedTasks: boolean,
  ) => {
    await daveWebSupabaseGateway.deleteAuthorizedReferenceDocument(
      document.id,
      document.cloudUpdatedAt,
      deleteLinkedTasks ? document.linkedScheduleItems : [],
    );
    await refreshSnapshot();
  }, [refreshSnapshot]);

  const value = useMemo<DesktopAuthContextValue>(() => ({
    phase,
    userEmail,
    sessionExpiresAt,
    snapshot,
    message,
    signInWithPassword,
    signOutOfDesktop,
    refreshSnapshot,
    createTask,
    updateTask,
    deleteTask,
    deleteDocument,
  }), [
    createTask,
    deleteDocument,
    deleteTask,
    message,
    phase,
    refreshSnapshot,
    sessionExpiresAt,
    signInWithPassword,
    signOutOfDesktop,
    snapshot,
    updateTask,
    userEmail,
  ]);

  return <DesktopAuthContext.Provider value={value}>{children}</DesktopAuthContext.Provider>;
}

export function useDesktopAuth(): DesktopAuthContextValue {
  const value = useContext(DesktopAuthContext);
  if (!value) throw new Error('useDesktopAuth must be used inside DesktopAuthProvider.');
  return value;
}
