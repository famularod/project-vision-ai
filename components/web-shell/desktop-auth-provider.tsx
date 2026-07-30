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
  type DAVEWebStorageBucket,
} from '../../services/DAVEWebSupabaseClient';
import {
  scheduleItemForCloud,
  type DAVEWebScheduleItem,
} from '../../services/DAVEWebTaskEditing';
import type {
  DAVEWebPreparedUpload,
  DAVEWebReportRecord,
} from '../../services/DAVEWebOperations';
import {
  initialDAVEWebFreshnessState,
  recordDAVEWebRefreshFailure,
  recordDAVEWebRefreshSuccess,
  type DAVEWebFreshnessState,
} from '../../services/DAVEWebFreshness';

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
  freshness: DAVEWebFreshnessState;
  message: string | null;
  signInWithPassword: (email: string, password: string) => Promise<boolean>;
  signOutOfDesktop: () => Promise<void>;
  refreshSnapshot: () => Promise<boolean>;
  getArtifactUrl: (bucket: DAVEWebStorageBucket, path: string) => Promise<string>;
  createTask: (item: DAVEWebScheduleItem) => Promise<void>;
  updateTask: (item: DAVEWebScheduleItem) => Promise<void>;
  updateTasks: (items: readonly DAVEWebScheduleItem[]) => Promise<number>;
  deleteTask: (item: DAVEWebScheduleItem) => Promise<void>;
  deleteDocument: (document: DAVEWebReferenceDocument, deleteLinkedTasks: boolean) => Promise<void>;
  uploadDocument: (
    prepared: DAVEWebPreparedUpload,
    bytes: ArrayBuffer,
    file?: Blob,
    onProgress?: (fraction: number) => void,
  ) => Promise<void>;
  setCurrentSchedule: (document: DAVEWebReferenceDocument) => Promise<void>;
  saveReport: (input: {
    id: string;
    projectName: string | null;
    report: DAVEWebReportRecord;
    expectedCloudUpdatedAt?: string | null;
  }) => Promise<string>;
  restoreMissingTasks: (items: readonly DAVEWebScheduleItem[]) => Promise<number>;
}>;

const DesktopAuthContext = createContext<DesktopAuthContextValue | null>(null);
const AUTOMATIC_REFRESH_WAITING_MESSAGE =
  'Automatic cloud refresh is waiting. Your current workspace remains available.';

export function DesktopAuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<DesktopAuthPhase>('checking');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<DAVEWebReadOnlySnapshot | null>(null);
  const [freshness, setFreshness] = useState<DAVEWebFreshnessState>(
    initialDAVEWebFreshnessState,
  );
  const [message, setMessage] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const loadSequenceRef = useRef(0);
  const snapshotRef = useRef<DAVEWebReadOnlySnapshot | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const backgroundRefreshRef = useRef<Promise<void> | null>(null);

  const clearSessionView = useCallback((nextPhase: DesktopAuthPhase = 'signed_out') => {
    if (!mountedRef.current) return;
    loadSequenceRef.current += 1;
    setUserEmail(null);
    setSessionExpiresAt(null);
    snapshotRef.current = null;
    setSnapshot(null);
    setFreshness(initialDAVEWebFreshnessState());
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
      if (!snapshotRef.current) setPhase('loading');
      setMessage(null);
      setUserEmail(session.user.email ?? null);
      setSessionExpiresAt(session.expires_at ?? null);
    }

    try {
      const nextSnapshot = await loadDAVEWebReadOnlySnapshot();
      if (!mountedRef.current || loadSequenceRef.current !== loadSequence) return false;
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setPhase('ready');
      setFreshness(recordDAVEWebRefreshSuccess(nextSnapshot.refreshedAt));
      if (options.background) {
        setMessage(current =>
          current === AUTOMATIC_REFRESH_WAITING_MESSAGE ? null : current);
      }
      return true;
    } catch (error) {
      if (!mountedRef.current || loadSequenceRef.current !== loadSequence) return false;
      if (error instanceof DAVEWebAuthorizationError) {
        await daveWebSupabaseGateway.signOut();
        if (mountedRef.current) {
          setPhase('unauthorized');
          setMessage(error.message);
        }
        return false;
      }
      if (snapshotRef.current) {
        setPhase('ready');
        setFreshness(current =>
          recordDAVEWebRefreshFailure(current, new Date().toISOString()));
        setMessage(AUTOMATIC_REFRESH_WAITING_MESSAGE);
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
      return false;
    }
    return loadAuthorizedSnapshot(status.session);
  }, [clearSessionView, loadAuthorizedSnapshot]);

  const getArtifactUrl = useCallback((
    bucket: DAVEWebStorageBucket,
    path: string,
  ) => daveWebSupabaseGateway.createAuthorizedArtifactSignedUrl(bucket, path), []);

  const refreshSnapshotInBackground = useCallback((): Promise<void> => {
    if (backgroundRefreshRef.current) return backgroundRefreshRef.current;
    const run = (async () => {
      try {
        const status = await daveWebSupabaseGateway.getSessionStatus();
        if (!mountedRef.current) return;
        if (!status.session) {
          clearSessionView();
          return;
        }
        await loadAuthorizedSnapshot(status.session, { background: true });
      } catch {
        if (mountedRef.current) {
          setFreshness(current =>
            recordDAVEWebRefreshFailure(current, new Date().toISOString()));
          setMessage(AUTOMATIC_REFRESH_WAITING_MESSAGE);
        }
      }
    })();
    backgroundRefreshRef.current = run;
    void run.finally(() => {
      if (backgroundRefreshRef.current === run) backgroundRefreshRef.current = null;
    });
    return run;
  }, [clearSessionView, loadAuthorizedSnapshot]);

  useEffect(() => {
    if (phase !== 'ready') return;
    const timer = setInterval(() => { void refreshSnapshotInBackground(); }, 12_000);
    return () => {
      clearInterval(timer);
    };
  }, [phase, refreshSnapshotInBackground]);

  useEffect(() => {
    if (phase !== 'ready') return;
    let active = true;
    let unsubscribe: () => void = () => undefined;
    void daveWebSupabaseGateway.subscribeToAuthorizedOperationalChanges({
      onChange: () => {
        if (active) void refreshSnapshotInBackground();
      },
      onStatus: status => {
        if (active && (status === 'error' || status === 'closed')) {
          setFreshness(current =>
            recordDAVEWebRefreshFailure(current, new Date().toISOString()));
          setMessage(AUTOMATIC_REFRESH_WAITING_MESSAGE);
        } else if (active && status === 'subscribed') {
          void refreshSnapshotInBackground();
        }
      },
    }).then(stop => {
      if (!active) stop();
      else unsubscribe = stop;
    }).catch(() => {
      if (active) {
        setFreshness(current =>
          recordDAVEWebRefreshFailure(current, new Date().toISOString()));
        setMessage(AUTOMATIC_REFRESH_WAITING_MESSAGE);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [phase, refreshSnapshotInBackground]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('vitruvius-shared-record-v1');
    channelRef.current = channel;
    channel.onmessage = () => {
      if (phase === 'ready') void refreshSnapshotInBackground();
    };
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, [phase, refreshSnapshotInBackground]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible' && phase === 'ready') {
        void refreshSnapshotInBackground();
      }
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [phase, refreshSnapshotInBackground]);

  const announceMutation = useCallback(() => {
    channelRef.current?.postMessage({ type: 'cloud-mutated', at: Date.now() });
  }, []);

  const createTask = useCallback(async (item: DAVEWebScheduleItem) => {
    await daveWebSupabaseGateway.createAuthorizedScheduleItem(
      scheduleItemForCloud(item),
    );
    announceMutation();
    await refreshSnapshot();
  }, [announceMutation, refreshSnapshot]);

  const updateTask = useCallback(async (item: DAVEWebScheduleItem) => {
    await daveWebSupabaseGateway.updateAuthorizedScheduleItem(
      scheduleItemForCloud(item),
      item.cloudUpdatedAt,
    );
    announceMutation();
    await refreshSnapshot();
  }, [announceMutation, refreshSnapshot]);

  const updateTasks = useCallback(async (items: readonly DAVEWebScheduleItem[]) => {
    let updated = 0;
    try {
      for (const item of items) {
        await daveWebSupabaseGateway.updateAuthorizedScheduleItem(
          scheduleItemForCloud(item),
          item.cloudUpdatedAt,
        );
        updated += 1;
      }
    } finally {
      if (updated > 0) announceMutation();
      await refreshSnapshot();
    }
    return updated;
  }, [announceMutation, refreshSnapshot]);

  const deleteTask = useCallback(async (item: DAVEWebScheduleItem) => {
    await daveWebSupabaseGateway.deleteAuthorizedScheduleItem(
      item.id,
      item.cloudUpdatedAt,
    );
    announceMutation();
    await refreshSnapshot();
  }, [announceMutation, refreshSnapshot]);

  const deleteDocument = useCallback(async (
    document: DAVEWebReferenceDocument,
    deleteLinkedTasks: boolean,
  ) => {
    await daveWebSupabaseGateway.deleteAuthorizedReferenceDocument(
      document.id,
      document.cloudUpdatedAt,
      deleteLinkedTasks ? document.linkedScheduleItems : [],
    );
    announceMutation();
    await refreshSnapshot();
  }, [announceMutation, refreshSnapshot]);

  const uploadDocument = useCallback(async (
    prepared: DAVEWebPreparedUpload,
    bytes: ArrayBuffer,
    file?: Blob,
    onProgress?: (fraction: number) => void,
  ) => {
    await daveWebSupabaseGateway.uploadAuthorizedReferenceDocument({
      document: prepared.document,
      bytes,
      file,
      scheduleItems: prepared.scheduleItems,
      onProgress,
    });
    announceMutation();
    await refreshSnapshot();
  }, [announceMutation, refreshSnapshot]);

  const setCurrentSchedule = useCallback(async (document: DAVEWebReferenceDocument) => {
    const scheduleDocuments = (snapshot?.referenceDocuments || []).filter(item =>
      item.category === 'Schedules' || item.category === 'Schedule',
    );
    await daveWebSupabaseGateway.setAuthorizedCurrentSchedule(document, scheduleDocuments);
    announceMutation();
    await refreshSnapshot();
  }, [announceMutation, refreshSnapshot, snapshot?.referenceDocuments]);

  const saveReport = useCallback(async (input: {
    id: string;
    projectName: string | null;
    report: DAVEWebReportRecord;
    expectedCloudUpdatedAt?: string | null;
  }) => {
    const revision = await daveWebSupabaseGateway.saveAuthorizedReportArtifact(input);
    announceMutation();
    await refreshSnapshot();
    return revision;
  }, [announceMutation, refreshSnapshot]);

  const restoreMissingTasks = useCallback(async (items: readonly DAVEWebScheduleItem[]) => {
    const currentIds = new Set(snapshot?.scheduleItems.map(item => item.id) || []);
    let restored = 0;
    for (const item of items) {
      if (currentIds.has(item.id)) continue;
      await daveWebSupabaseGateway.createAuthorizedScheduleItem(scheduleItemForCloud(item));
      currentIds.add(item.id);
      restored += 1;
    }
    if (restored > 0) announceMutation();
    await refreshSnapshot();
    return restored;
  }, [announceMutation, refreshSnapshot, snapshot?.scheduleItems]);

  const value = useMemo<DesktopAuthContextValue>(() => ({
    phase,
    userEmail,
    sessionExpiresAt,
    snapshot,
    freshness,
    message,
    signInWithPassword,
    signOutOfDesktop,
    refreshSnapshot,
    getArtifactUrl,
    createTask,
    updateTask,
    updateTasks,
    deleteTask,
    deleteDocument,
    uploadDocument,
    setCurrentSchedule,
    saveReport,
    restoreMissingTasks,
  }), [
    createTask,
    deleteDocument,
    deleteTask,
    freshness,
    getArtifactUrl,
    message,
    phase,
    refreshSnapshot,
    sessionExpiresAt,
    signInWithPassword,
    signOutOfDesktop,
    snapshot,
    uploadDocument,
    setCurrentSchedule,
    saveReport,
    restoreMissingTasks,
    updateTask,
    updateTasks,
    userEmail,
  ]);

  return <DesktopAuthContext.Provider value={value}>{children}</DesktopAuthContext.Provider>;
}

export function useDesktopAuth(): DesktopAuthContextValue {
  const value = useContext(DesktopAuthContext);
  if (!value) throw new Error('useDesktopAuth must be used inside DesktopAuthProvider.');
  return value;
}
