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
import type { ECOSProjectQuestionAnswer } from '../../services/ECOSProjectQuestion';
import type { ECOSDrawingPageAnalysisInput } from '../../services/ECOSDrawingPageAnalysis';
import type { ECOSDrawingPageAnalysisResult } from '../../services/ECOSDrawingPageAnalysis';
import type { ECOSDocumentIndexJob } from '../../services/ECOSDocumentIndexJobs';
import type { ECOSDocumentCoverageSummary } from '../../services/ECOSDocumentCoverageSummary';
import type { ReferenceDocumentExtractedPage } from '../../types';
import {
  initialDAVEWebFreshnessState,
  recordDAVEWebRefreshFailure,
  recordDAVEWebRefreshSuccess,
  type DAVEWebFreshnessState,
} from '../../services/DAVEWebFreshness';
import {
  DAVE_WEB_OPERATIONAL_POLL_INTERVAL_MS,
  shouldRefreshDAVEOperationalDataOnForeground,
  type DAVEOperationalCollectionName,
} from '../../services/DAVEOperationalRefresh';

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
  loadDocumentCoverageSummary: (
    documentId: string,
    documentRevision?: string | null,
  ) => Promise<ECOSDocumentCoverageSummary>;
  getArtifactUrl: (
    bucket: DAVEWebStorageBucket,
    path: string,
    options?: Readonly<{ preview?: boolean }>,
  ) => Promise<string>;
  createTask: (item: DAVEWebScheduleItem) => Promise<void>;
  updateTask: (item: DAVEWebScheduleItem) => Promise<void>;
  updateTasks: (items: readonly DAVEWebScheduleItem[]) => Promise<number>;
  deleteTask: (item: DAVEWebScheduleItem) => Promise<void>;
  uploadTaskPhoto: (
    item: DAVEWebScheduleItem,
    fileName: string,
    mimeType: string,
    bytes: ArrayBuffer,
  ) => Promise<void>;
  deleteDocument: (document: DAVEWebReferenceDocument, deleteLinkedTasks: boolean) => Promise<void>;
  uploadDocument: (
    prepared: DAVEWebPreparedUpload,
    bytes: ArrayBuffer,
    file?: Blob,
    onProgress?: (fraction: number) => void,
  ) => Promise<void>;
  linkDocument: (
    prepared: DAVEWebPreparedUpload,
    bytes: ArrayBuffer,
    file?: Blob,
    onProgress?: (fraction: number) => void,
  ) => Promise<void>;
  setCurrentSchedule: (document: DAVEWebReferenceDocument) => Promise<void>;
  setCurrentDocument: (document: DAVEWebReferenceDocument) => Promise<void>;
  updateDocument: (document: DAVEWebReferenceDocument) => Promise<void>;
  enqueueDocumentPreparation: (documentId: string) => Promise<void>;
  saveReport: (input: {
    id: string;
    projectName: string | null;
    report: DAVEWebReportRecord;
    expectedCloudUpdatedAt?: string | null;
  }) => Promise<string>;
  restoreMissingTasks: (items: readonly DAVEWebScheduleItem[]) => Promise<number>;
  askProjectQuestion: (input: {
    projectId: string;
    projectName: string;
    question: string;
  }) => Promise<ECOSProjectQuestionAnswer>;
  analyzeDrawingPage: (input: ECOSDrawingPageAnalysisInput) => Promise<ECOSDrawingPageAnalysisResult>;
  beginOrResumeDocumentIndexJob: (input: {
    documentId: string;
    sourceSha256: string;
    sourcePageCount: number;
  }) => Promise<ECOSDocumentIndexJob>;
  checkpointDocumentIndexPage: (input: {
    jobId: string;
    page: ReferenceDocumentExtractedPage;
  }) => Promise<void>;
  setDocumentIndexJobStatus: (input: {
    jobId: string;
    status: 'running' | 'ready' | 'committed' | 'failed' | 'cancelled';
    failureMessage?: string | null;
  }) => Promise<void>;
  commitDocumentIndexJob: (input: {
    jobId: string;
    extractionMethod?: string | null;
  }) => Promise<Readonly<{ indexedPages: number; indexedChunks: number }>>;
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
  const pendingBackgroundCollectionsRef = useRef<Set<DAVEOperationalCollectionName>>(new Set());
  const pendingFullBackgroundRefreshRef = useRef(false);
  const maintenanceOwnerRef = useRef<string | null>(null);
  const realtimeHealthyRef = useRef(false);
  const lastSuccessfulRefreshAtRef = useRef<string | null>(null);

  const clearSessionView = useCallback((nextPhase: DesktopAuthPhase = 'signed_out') => {
    if (!mountedRef.current) return;
    loadSequenceRef.current += 1;
    setUserEmail(null);
    setSessionExpiresAt(null);
    snapshotRef.current = null;
    maintenanceOwnerRef.current = null;
    realtimeHealthyRef.current = false;
    lastSuccessfulRefreshAtRef.current = null;
    pendingBackgroundCollectionsRef.current.clear();
    pendingFullBackgroundRefreshRef.current = false;
    setSnapshot(null);
    setFreshness(initialDAVEWebFreshnessState());
    setMessage(null);
    setPhase(nextPhase);
  }, []);

  const loadAuthorizedSnapshot = useCallback(async (
    session: Session | null,
    options: {
      background?: boolean;
      collections?: readonly DAVEOperationalCollectionName[];
    } = {},
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
      const nextSnapshot = await loadDAVEWebReadOnlySnapshot(options.collections);
      if (!mountedRef.current || loadSequenceRef.current !== loadSequence) return false;
      snapshotRef.current = nextSnapshot;
      lastSuccessfulRefreshAtRef.current = nextSnapshot.refreshedAt;
      setSnapshot(nextSnapshot);
      setPhase('ready');
      setFreshness(recordDAVEWebRefreshSuccess(nextSnapshot.refreshedAt));
      if (options.background) {
        setMessage(current =>
          current === AUTOMATIC_REFRESH_WAITING_MESSAGE ? null : current);
      }
      if (maintenanceOwnerRef.current !== session.user.id) {
        maintenanceOwnerRef.current = session.user.id;
        void daveWebSupabaseGateway.runAuthorizedMaintenance().catch(() => undefined);
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
    options?: Readonly<{ preview?: boolean }>,
  ) => daveWebSupabaseGateway.createAuthorizedArtifactSignedUrl(
    bucket,
    path,
    600,
    options,
  ), []);

  const refreshSnapshotInBackground = useCallback((
    collections?: readonly DAVEOperationalCollectionName[],
  ): Promise<void> => {
    const webCollections = collections?.filter(collection => collection !== 'project_areas');
    if (collections && webCollections?.length === 0) return Promise.resolve();
    if (backgroundRefreshRef.current) {
      if (!webCollections) pendingFullBackgroundRefreshRef.current = true;
      else webCollections.forEach(collection => pendingBackgroundCollectionsRef.current.add(collection));
      return backgroundRefreshRef.current;
    }
    const run = (async () => {
      let nextCollections: readonly DAVEOperationalCollectionName[] | undefined = webCollections;
      while (true) {
        pendingFullBackgroundRefreshRef.current = false;
        pendingBackgroundCollectionsRef.current.clear();
        try {
          const status = await daveWebSupabaseGateway.getSessionStatus();
          if (!mountedRef.current) return;
          if (!status.session) {
            clearSessionView();
            return;
          }
          await loadAuthorizedSnapshot(status.session, {
            background: true,
            collections: nextCollections,
          });
        } catch {
          if (mountedRef.current) {
            setFreshness(current =>
              recordDAVEWebRefreshFailure(current, new Date().toISOString()));
            setMessage(AUTOMATIC_REFRESH_WAITING_MESSAGE);
          }
        }
        if (!mountedRef.current) return;
        if (pendingFullBackgroundRefreshRef.current) {
          nextCollections = undefined;
          continue;
        }
        if (pendingBackgroundCollectionsRef.current.size > 0) {
          nextCollections = Array.from(pendingBackgroundCollectionsRef.current);
          continue;
        }
        break;
      }
    })();
    backgroundRefreshRef.current = run;
    void run.finally(() => {
      if (backgroundRefreshRef.current === run) backgroundRefreshRef.current = null;
      if (
        mountedRef.current &&
        (pendingFullBackgroundRefreshRef.current ||
          pendingBackgroundCollectionsRef.current.size > 0)
      ) {
        const pendingCollections = pendingFullBackgroundRefreshRef.current
          ? undefined
          : Array.from(pendingBackgroundCollectionsRef.current);
        pendingFullBackgroundRefreshRef.current = false;
        pendingBackgroundCollectionsRef.current.clear();
        void refreshSnapshotInBackground(pendingCollections);
      }
    });
    return run;
  }, [clearSessionView, loadAuthorizedSnapshot]);

  useEffect(() => {
    if (phase !== 'ready') return;
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void refreshSnapshotInBackground();
      }
    }, DAVE_WEB_OPERATIONAL_POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [phase, refreshSnapshotInBackground]);

  useEffect(() => {
    if (phase !== 'ready') return;
    let active = true;
    let realtimeHasSubscribed = false;
    let unsubscribe: () => void = () => undefined;
    void daveWebSupabaseGateway.subscribeToAuthorizedOperationalChanges({
      onChange: (_entity, collections) => {
        if (active) void refreshSnapshotInBackground(collections);
      },
      onStatus: status => {
        if (active && (status === 'error' || status === 'closed')) {
          realtimeHealthyRef.current = false;
          setFreshness(current =>
            recordDAVEWebRefreshFailure(current, new Date().toISOString()));
          setMessage(AUTOMATIC_REFRESH_WAITING_MESSAGE);
        } else if (active && status === 'subscribed') {
          realtimeHealthyRef.current = true;
          if (realtimeHasSubscribed) void refreshSnapshotInBackground();
          realtimeHasSubscribed = true;
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
    channel.onmessage = event => {
      if (phase !== 'ready') return;
      const data = event.data && typeof event.data === 'object'
        ? event.data as { type?: unknown; collections?: unknown }
        : null;
      const collections = data?.type === 'cloud-mutated' && Array.isArray(data.collections)
        ? data.collections.filter(isDAVEOperationalCollectionName)
        : undefined;
      void refreshSnapshotInBackground(collections?.length ? collections : undefined);
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
        if (shouldRefreshDAVEOperationalDataOnForeground({
          realtimeHealthy: realtimeHealthyRef.current,
          lastSuccessfulRefreshAt: lastSuccessfulRefreshAtRef.current,
        })) {
          void refreshSnapshotInBackground();
        }
      }
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [phase, refreshSnapshotInBackground]);

  const announceMutation = useCallback((
    collections: readonly DAVEOperationalCollectionName[],
  ) => {
    channelRef.current?.postMessage({
      type: 'cloud-mutated',
      at: Date.now(),
      collections,
    });
  }, []);

  const applyAcknowledgedTask = useCallback((
    item: DAVEWebScheduleItem,
    cloudUpdatedAt: string,
  ) => {
    if (!mountedRef.current) return;
    const current = snapshotRef.current;
    if (!current) return;
    const existingIndex = current.scheduleItems.findIndex(candidate => candidate.id === item.id);
    const existing = existingIndex >= 0 ? current.scheduleItems[existingIndex] : null;
    if (existing && cloudRevisionIsAfter(existing.cloudUpdatedAt, cloudUpdatedAt)) return;

    const acknowledgedItem = Object.freeze({ ...item, cloudUpdatedAt });
    const scheduleItems = [...current.scheduleItems];
    if (existingIndex >= 0) scheduleItems[existingIndex] = acknowledgedItem;
    else scheduleItems.unshift(acknowledgedItem);
    const nextSnapshot = Object.freeze({
      ...current,
      scheduleItems: Object.freeze(scheduleItems),
      refreshedAt: new Date().toISOString(),
    });
    snapshotRef.current = nextSnapshot;
    lastSuccessfulRefreshAtRef.current = nextSnapshot.refreshedAt;
    setSnapshot(nextSnapshot);
  }, []);

  const loadDocumentCoverageSummary = useCallback((
    documentId: string,
    documentRevision?: string | null,
  ) => daveWebSupabaseGateway.loadAuthorizedDocumentCoverageSummary(
    documentId,
    documentRevision,
  ), []);

  const createTask = useCallback(async (item: DAVEWebScheduleItem) => {
    const acknowledgedAt = await daveWebSupabaseGateway.createAuthorizedScheduleItem(
      scheduleItemForCloud(item),
    );
    applyAcknowledgedTask(item, acknowledgedAt);
    const collections = ['schedule_items'] as const;
    announceMutation(collections);
    await refreshSnapshotInBackground(collections);
    applyAcknowledgedTask(item, acknowledgedAt);
  }, [announceMutation, applyAcknowledgedTask, refreshSnapshotInBackground]);

  const updateTask = useCallback(async (item: DAVEWebScheduleItem) => {
    const acknowledgedAt = await daveWebSupabaseGateway.updateAuthorizedScheduleItem(
      scheduleItemForCloud(item),
      item.cloudUpdatedAt,
    );
    applyAcknowledgedTask(item, acknowledgedAt);
    const collections = ['schedule_items'] as const;
    announceMutation(collections);
    await refreshSnapshotInBackground(collections);
    applyAcknowledgedTask(item, acknowledgedAt);
  }, [announceMutation, applyAcknowledgedTask, refreshSnapshotInBackground]);

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
      if (updated > 0) {
        const collections = ['schedule_items'] as const;
        announceMutation(collections);
        await refreshSnapshotInBackground(collections);
      }
    }
    return updated;
  }, [announceMutation, refreshSnapshotInBackground]);

  const deleteTask = useCallback(async (item: DAVEWebScheduleItem) => {
    await daveWebSupabaseGateway.deleteAuthorizedScheduleItem(
      item.id,
      item.cloudUpdatedAt,
    );
    const collections = ['sync_tombstones', 'schedule_items'] as const;
    announceMutation(collections);
    await refreshSnapshotInBackground(collections);
  }, [announceMutation, refreshSnapshotInBackground]);

  const uploadTaskPhoto = useCallback(async (
    item: DAVEWebScheduleItem,
    fileName: string,
    mimeType: string,
    bytes: ArrayBuffer,
  ) => {
    await daveWebSupabaseGateway.uploadAuthorizedTaskPhoto({
      task: scheduleItemForCloud(item),
      fileName,
      mimeType,
      bytes,
    });
    const collections = ['project_updates'] as const;
    announceMutation(collections);
    await refreshSnapshotInBackground(collections);
  }, [announceMutation, refreshSnapshotInBackground]);

  const deleteDocument = useCallback(async (
    document: DAVEWebReferenceDocument,
    deleteLinkedTasks: boolean,
  ) => {
    await daveWebSupabaseGateway.deleteAuthorizedReferenceDocument(
      document.id,
      document.cloudUpdatedAt,
      deleteLinkedTasks ? document.linkedScheduleItems : [],
    );
    const collections: readonly DAVEOperationalCollectionName[] = deleteLinkedTasks
      ? ['sync_tombstones', 'reference_documents', 'schedule_items']
      : ['sync_tombstones', 'reference_documents'];
    announceMutation(collections);
    await refreshSnapshotInBackground(collections);
  }, [announceMutation, refreshSnapshotInBackground]);

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
    const collections: readonly DAVEOperationalCollectionName[] = prepared.scheduleItems.length > 0
      ? ['reference_documents', 'schedule_items']
      : ['reference_documents'];
    announceMutation(collections);
    await refreshSnapshotInBackground(collections);
  }, [announceMutation, refreshSnapshotInBackground]);

  const linkDocument = useCallback(async (
    prepared: DAVEWebPreparedUpload,
    bytes: ArrayBuffer,
    file?: Blob,
    onProgress?: (fraction: number) => void,
  ) => {
    if (prepared.scheduleItems.length > 0) {
      throw new Error('Google Drive linking does not import schedule tasks in this first release.');
    }
    await daveWebSupabaseGateway.saveAuthorizedLinkedReferenceDocument({
      document: prepared.document,
      bytes,
      file,
      onProgress,
    });
    const collections = ['reference_documents'] as const;
    announceMutation(collections);
    await refreshSnapshotInBackground(collections);
  }, [announceMutation, refreshSnapshotInBackground]);

  const setCurrentSchedule = useCallback(async (document: DAVEWebReferenceDocument) => {
    const scheduleDocuments = (snapshot?.referenceDocuments || []).filter(item =>
      item.category === 'Schedules' || item.category === 'Schedule',
    );
    await daveWebSupabaseGateway.setAuthorizedCurrentSchedule(document, scheduleDocuments);
    const collections = ['reference_documents'] as const;
    announceMutation(collections);
    await refreshSnapshotInBackground(collections);
  }, [announceMutation, refreshSnapshotInBackground, snapshot?.referenceDocuments]);

  const setCurrentDocument = useCallback(async (document: DAVEWebReferenceDocument) => {
    const documents = snapshot?.referenceDocuments || [];
    await daveWebSupabaseGateway.setAuthorizedCurrentDocument(document, documents);
    const collections = ['reference_documents'] as const;
    announceMutation(collections);
    await refreshSnapshotInBackground(collections);
  }, [announceMutation, refreshSnapshotInBackground, snapshot?.referenceDocuments]);

  const updateDocument = useCallback(async (document: DAVEWebReferenceDocument) => {
    await daveWebSupabaseGateway.updateAuthorizedReferenceDocument(document);
    const collections = ['reference_documents'] as const;
    announceMutation(collections);
    await refreshSnapshotInBackground(collections);
  }, [announceMutation, refreshSnapshotInBackground]);

  const enqueueDocumentPreparation = useCallback(async (documentId: string) => {
    await daveWebSupabaseGateway.enqueueAuthorizedDocumentPreparation(documentId);
    const collections = ['reference_documents'] as const;
    announceMutation(collections);
    await refreshSnapshotInBackground(collections);
  }, [announceMutation, refreshSnapshotInBackground]);

  const saveReport = useCallback(async (input: {
    id: string;
    projectName: string | null;
    report: DAVEWebReportRecord;
    expectedCloudUpdatedAt?: string | null;
  }) => {
    const revision = await daveWebSupabaseGateway.saveAuthorizedReportArtifact(input);
    const collections = ['reference_documents'] as const;
    announceMutation(collections);
    await refreshSnapshotInBackground(collections);
    return revision;
  }, [announceMutation, refreshSnapshotInBackground]);

  const restoreMissingTasks = useCallback(async (items: readonly DAVEWebScheduleItem[]) => {
    const currentIds = new Set(snapshot?.scheduleItems.map(item => item.id) || []);
    let restored = 0;
    for (const item of items) {
      if (currentIds.has(item.id)) continue;
      await daveWebSupabaseGateway.createAuthorizedScheduleItem(scheduleItemForCloud(item));
      currentIds.add(item.id);
      restored += 1;
    }
    if (restored > 0) {
      const collections = ['schedule_items'] as const;
      announceMutation(collections);
      await refreshSnapshotInBackground(collections);
    }
    return restored;
  }, [announceMutation, refreshSnapshotInBackground, snapshot?.scheduleItems]);

  const askProjectQuestion = useCallback((input: {
    projectId: string;
    projectName: string;
    question: string;
  }) => daveWebSupabaseGateway.askAuthorizedProjectQuestion(input), []);

  const analyzeDrawingPage = useCallback((input: ECOSDrawingPageAnalysisInput) =>
    daveWebSupabaseGateway.analyzeAuthorizedDrawingPage(input), []);
  const beginOrResumeDocumentIndexJob = useCallback((input: {
    documentId: string;
    sourceSha256: string;
    sourcePageCount: number;
  }) => daveWebSupabaseGateway.beginOrResumeAuthorizedDocumentIndexJob(input), []);
  const checkpointDocumentIndexPage = useCallback((input: {
    jobId: string;
    page: ReferenceDocumentExtractedPage;
  }) => daveWebSupabaseGateway.checkpointAuthorizedDocumentIndexPage(input), []);
  const setDocumentIndexJobStatus = useCallback((input: {
    jobId: string;
    status: 'running' | 'ready' | 'committed' | 'failed' | 'cancelled';
    failureMessage?: string | null;
  }) => daveWebSupabaseGateway.setAuthorizedDocumentIndexJobStatus(input), []);
  const commitDocumentIndexJob = useCallback(async (input: {
    jobId: string;
    extractionMethod?: string | null;
  }) => {
    const result = await daveWebSupabaseGateway.commitAuthorizedDocumentIndexJob(input);
    const collections = ['reference_documents'] as const;
    announceMutation(collections);
    await refreshSnapshotInBackground(collections);
    return result;
  }, [announceMutation, refreshSnapshotInBackground]);

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
    loadDocumentCoverageSummary,
    getArtifactUrl,
    createTask,
    updateTask,
    updateTasks,
    deleteTask,
    uploadTaskPhoto,
    deleteDocument,
    uploadDocument,
    linkDocument,
    setCurrentSchedule,
    setCurrentDocument,
    updateDocument,
    enqueueDocumentPreparation,
    saveReport,
    restoreMissingTasks,
    askProjectQuestion,
    analyzeDrawingPage,
    beginOrResumeDocumentIndexJob,
    checkpointDocumentIndexPage,
    setDocumentIndexJobStatus,
    commitDocumentIndexJob,
  }), [
    createTask,
    deleteDocument,
    deleteTask,
    freshness,
    getArtifactUrl,
    message,
    phase,
    refreshSnapshot,
    loadDocumentCoverageSummary,
    sessionExpiresAt,
    signInWithPassword,
    signOutOfDesktop,
    snapshot,
    uploadTaskPhoto,
    uploadDocument,
    linkDocument,
    setCurrentSchedule,
    setCurrentDocument,
    updateDocument,
    enqueueDocumentPreparation,
    saveReport,
    restoreMissingTasks,
    askProjectQuestion,
    analyzeDrawingPage,
    beginOrResumeDocumentIndexJob,
    checkpointDocumentIndexPage,
    setDocumentIndexJobStatus,
    commitDocumentIndexJob,
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

function cloudRevisionIsAfter(
  candidate: string | null | undefined,
  baseline: string,
): boolean {
  const candidateTime = candidate ? Date.parse(candidate) : Number.NaN;
  const baselineTime = Date.parse(baseline);
  return Number.isFinite(candidateTime) &&
    Number.isFinite(baselineTime) &&
    candidateTime > baselineTime;
}

function isDAVEOperationalCollectionName(
  value: unknown,
): value is DAVEOperationalCollectionName {
  return value === 'projects' ||
    value === 'project_updates' ||
    value === 'project_areas' ||
    value === 'schedule_items' ||
    value === 'reference_documents' ||
    value === 'sync_tombstones';
}
