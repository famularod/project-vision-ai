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
  DAVEWebDocumentMutationError,
  DAVEWebTaskMutationError,
  daveWebSupabaseGateway,
  type DAVEWebSignInResult,
  type DAVEWebSignOutScope,
  type DAVEWebStorageBucket,
  type DAVEWebTabSignOutOutcome,
} from '../../services/DAVEWebSupabaseClient';
import {
  scheduleItemForCloud,
  type DAVEWebScheduleItem,
} from '../../services/DAVEWebTaskEditing';
import {
  planDAVEWebScheduleDocumentDelete,
  planDAVEWebScheduleImport,
  type DAVEWebPreparedUpload,
  type DAVEWebReportRecord,
} from '../../services/DAVEWebOperations';
import type { ECOSProjectQuestionAnswer, ECOSProjectQuestionControl } from '../../services/ECOSProjectQuestion';
import type { ECOSDrawingPageAnalysisInput } from '../../services/ECOSDrawingPageAnalysis';
import type { ECOSDrawingPageAnalysisResult } from '../../services/ECOSDrawingPageAnalysis';
import type { ECOSDocumentIndexJob } from '../../services/ECOSDocumentIndexJobs';
import type { ECOSDocumentCoverageSummary } from '../../services/ECOSDocumentCoverageSummary';
import type {
  ECOSAuthorizedDocumentProof,
  ECOSDocumentProofClaim,
} from '../../services/ECOSDocumentProofAuthority';
import type { ReferenceDocument, ReferenceDocumentExtractedPage } from '../../types';
import type { ScheduleRetirementScope } from '../../services/ECOSHostedIndexer';
import { scheduleProgressCarriedToShownTasks } from '../../services/ScheduleImportMerge';
import { scheduleDocumentAddsToMaster } from '../../services/PIEScheduleReconciliation';
import { scheduleItemIdsDeletedWithTask } from '../../services/DAVEDeletedTaskEvidence';
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
import { isAuthStorageSecure } from '../../services/SupabaseAuthStorage.web';

export type DesktopAuthPhase =
  | 'checking'
  | 'signed_out'
  | 'signing_in'
  | 'loading'
  | 'ready'
  | 'unauthorized'
  /** Signed in, but the owner check or first load could not finish; retrying. */
  | 'unavailable'
  | 'error';

type DesktopAuthContextValue = Readonly<{
  phase: DesktopAuthPhase;
  userEmail: string | null;
  sessionExpiresAt: number | null;
  snapshot: DAVEWebReadOnlySnapshot | null;
  freshness: DAVEWebFreshnessState;
  message: string | null;
  signInWithPassword: (email: string, password: string) => Promise<boolean>;
  /** This computer only unless 'global' (owner answer Q21); throws when it did not finish. */
  signOutOfDesktop: (scope?: DAVEWebSignOutScope) => Promise<void>;
  refreshSnapshot: () => Promise<boolean>;
  loadDocumentCoverageSummary: (
    documentId: string,
    documentRevision?: string | null,
  ) => Promise<ECOSDocumentCoverageSummary>;
  loadDocumentProof: (
    document: ReferenceDocument,
    claim: ECOSDocumentProofClaim,
  ) => Promise<ECOSAuthorizedDocumentProof>;
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
  /** Resolves with how the cloud retired other schedules (owner answer Q15). */
  setCurrentSchedule: (document: DAVEWebReferenceDocument) => Promise<ScheduleRetirementScope>;
  setCurrentDocument: (document: DAVEWebReferenceDocument) => Promise<void>;
  updateDocument: (document: DAVEWebReferenceDocument) => Promise<void>;
  enqueueDocumentPreparation: (documentId: string) => Promise<void>;
  saveReport: (input: {
    id: string;
    projectName: string | null;
    report: DAVEWebReportRecord;
    expectedCloudUpdatedAt?: string | null;
  }) => Promise<string>;
  /** The phone and iPad's shared "since the last report" period (everyday item 3). */
  loadReportPeriod: (scopeKey: string, format: string) => Promise<Readonly<{ ownerId: string; snapshot: unknown }> | 'unavailable'>;
  /** A report approved or sent here goes into that shared period (owner answer 2 Oct, web sends count). */
  saveReportPeriod: (row: Parameters<typeof daveWebSupabaseGateway.saveAuthorizedReportPeriod>[0]) => Promise<'saved' | 'unavailable'>;
  /** The signed-in owner, for this computer's own copy of the report periods. */
  reportOwnerId: () => Promise<string>;
  restoreMissingTasks: (items: readonly DAVEWebScheduleItem[]) => Promise<number>;
  askProjectQuestion: (input: ECOSProjectQuestionControl & {
    projectId: string;
    projectName: string;
    question: string;
    conversationId?: string;
    priorTurnId?: string;
    knownProjectNames?: readonly string[];
    closedProjectNames?: readonly string[];
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

/**
 * The tabs of this browser tell each other which account signed out of this
 * computer (whole-app audit A12 pass 5 L2, 30 Sep 2026). Each tab keeps its
 * own sign-in; auth-js passes every tab's SIGNED_OUT to the others without
 * saying whose it was.
 */
export const DESKTOP_SIGN_OUT_CHANNEL_NAME = 'vitruvius-desktop-sign-out-v1';
const SIGNED_OUT_OF_THIS_COMPUTER = 'signed-out-of-this-computer';

/** The account another tab says signed out of this computer, or null. */
function signedOutUserId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const { type, userId } = data as { type?: unknown; userId?: unknown };
  return type === SIGNED_OUT_OF_THIS_COMPUTER && typeof userId === 'string' && userId.trim()
    ? userId
    : null;
}
const AUTOMATIC_REFRESH_WAITING_MESSAGE =
  'Automatic cloud refresh is waiting. Your current workspace remains available.';
const WORKSPACE_UNAVAILABLE_MESSAGE =
  'Your projects could not be loaded just now. Vitruvius will try again automatically, or choose Try Again.';
/**
 * Signed in, but nothing has loaded yet: try again after 5 s, 15 s, 30 s,
 * then every minute while the tab is visible (audit round 2 follow-up).
 */
export const DESKTOP_WORKSPACE_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000] as const;
/**
 * The longest a sign-in waits for this tab's sign-in to finish ending
 * (whole-app audit A12 pass 7 L1, 30 Sep 2026).
 */
export const DESKTOP_SIGN_IN_ENDING_WAIT_MS = 10_000;

const SIGN_IN_FAILED_MESSAGE =
  'Sign-in could not be completed. Check your email and password, then try again.';
/** This tab cannot store a sign-in: the browser blocks site data (A12 pass 11 L2). */
const SITE_STORAGE_BLOCKED_MESSAGE =
  "This browser is blocking site storage, so Vitruvius can't keep you signed in. Allow site data for this site, then try again.";

/** What a sign-in here answered when it opened nothing (A12 pass 11 L1). */
type DesktopSignInAnswer = Readonly<{ phase: 'signed_out' | 'unauthorized'; message: string }>;

/** This tab ending its sign-in because another tab signed out. */
type DesktopSignInEnding = {
  /** Settles once the ending has, either way. */
  settled: Promise<void>;
  /** A sign-in was made here during it: its settling leaves the view be. */
  signInMadeDuring: boolean;
  /**
   * A sign-in here answered during it and opened nothing (a mistyped
   * password, a dropped connection, an account that is not the owner's):
   * its settling shows that answer again, not the plain sign-in page (A12
   * pass 11 L1).
   */
  signInAnsweredDuring: DesktopSignInAnswer | null;
};

export function DesktopAuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<DesktopAuthPhase>('checking');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<DAVEWebReadOnlySnapshot | null>(null);
  const [freshness, setFreshness] = useState<DAVEWebFreshnessState>(
    initialDAVEWebFreshnessState,
  );
  const [message, setMessage] = useState<string | null>(null);
  /** Loads in a row that could not finish before any workspace loaded. */
  const [unavailableAttempts, setUnavailableAttempts] = useState(0);
  const mountedRef = useRef(true);
  const loadSequenceRef = useRef(0);
  const snapshotRef = useRef<DAVEWebReadOnlySnapshot | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const signOutChannelRef = useRef<BroadcastChannel | null>(null);
  const backgroundRefreshRef = useRef<Promise<void> | null>(null);
  const pendingBackgroundCollectionsRef = useRef<Set<DAVEOperationalCollectionName>>(new Set());
  const pendingFullBackgroundRefreshRef = useRef(false);
  const maintenanceOwnerRef = useRef<string | null>(null);
  const realtimeHealthyRef = useRef(false);
  const lastSuccessfulRefreshAtRef = useRef<string | null>(null);
  /**
   * The sign-in the owner check said is not the owner's, while this browser
   * signs it out (whole-app audit A12 pass 4 L3, 30 Sep 2026).
   */
  const notOwnerRef = useRef<Readonly<{ userId: string; message: string }> | null>(null);
  const notOwnerSignOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notOwnerSignOutRunningRef = useRef(false);
  /**
   * Set while this tab ends its sign-in because another tab of the same
   * account signed out (whole-app audit A1 pass 6 L1, 30 Sep 2026), until
   * that ending settles (A12 pass 7 L1) or a sign-in made here after the
   * time limit succeeds (A12 pass 8 L1).
   */
  const endingSignInRef = useRef<DesktopSignInEnding | null>(null);
  /**
   * Sign-ins here that have not answered yet, from the moment one is chosen
   * (its wait for an ending included) until the cloud answers it (A12 pass
   * 10 L1).
   */
  const signInsAwaitingAnswerRef = useRef(0);

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
    setUnavailableAttempts(0);
    // While the owner check's "not the owner" stands, the view stays on it:
    // the browser's own sign-out going through (SIGNED_OUT, now or on a
    // quiet retry) does not turn it into a plain sign-in page (A12 pass 4 L3).
    const notOwner = notOwnerRef.current;
    setMessage(notOwner ? notOwner.message : null);
    setPhase(notOwner ? 'unauthorized' : nextPhase);
  }, []);

  /**
   * This tab's sign-in ended: the sign-in page. While a sign-in here awaits
   * its answer, the button stays busy and that sign-in's own result decides
   * what shows: an ending starting or settling then had shown "Sign in
   * securely" while his request was still out (A12 pass 10 L1). An ending
   * settling after his sign-in answered without opening anything clears the
   * view, then shows that answer again: it had replaced it with the plain
   * sign-in page (A12 pass 11 L1).
   */
  const showSignInEnded = useCallback((answer: DesktopSignInAnswer | null = null) => {
    const awaitingAnswer = signInsAwaitingAnswerRef.current > 0;
    clearSessionView(awaitingAnswer ? 'signing_in' : 'signed_out');
    if (answer && !awaitingAnswer && mountedRef.current) {
      setPhase(answer.phase);
      setMessage(answer.message);
    }
  }, [clearSessionView]);

  /**
   * A sign-in here answered (null: it opened the workspace, or a new one
   * started); the ending under way, if any, keeps that answer for its
   * settling (A12 pass 11 L1).
   */
  const noteSignInAnswer = useCallback((answer: DesktopSignInAnswer | null) => {
    const ending = endingSignInRef.current;
    if (ending) ending.signInAnsweredDuring = answer;
  }, []);

  /** A new sign-in: the earlier "not the owner" no longer applies. */
  const forgetNotOwner = useCallback(() => {
    notOwnerRef.current = null;
    if (notOwnerSignOutTimerRef.current) {
      clearTimeout(notOwnerSignOutTimerRef.current);
      notOwnerSignOutTimerRef.current = null;
    }
  }, []);

  /**
   * Signs a sign-in that is not the owner's out of this browser only (owner
   * answer Q21), and when that cannot reach the server (a dropped
   * connection) tries again after 5 s, 15 s, 30 s, then every minute, with
   * nothing on screen (A12 pass 4 L3). Never throws.
   */
  const signOutNotOwnerQuietly = useCallback(async () => {
    if (notOwnerSignOutRunningRef.current) return;
    if (notOwnerSignOutTimerRef.current) {
      clearTimeout(notOwnerSignOutTimerRef.current);
      notOwnerSignOutTimerRef.current = null;
    }
    const attempt = async (index: number): Promise<void> => {
      const notOwner = notOwnerRef.current;
      if (!mountedRef.current || !notOwner) return;
      notOwnerSignOutRunningRef.current = true;
      try {
        await daveWebSupabaseGateway.signOut('local');
        notOwnerSignOutRunningRef.current = false;
        if (mountedRef.current && notOwnerRef.current === notOwner) {
          // Signed out: nothing is left to retry; the answer stays on screen,
          // an ending settling later included (A12 pass 11 L1).
          notOwnerRef.current = null;
          setPhase('unauthorized');
          setMessage(notOwner.message);
          noteSignInAnswer({ phase: 'unauthorized', message: notOwner.message });
        }
        return;
      } catch {
        notOwnerSignOutRunningRef.current = false;
      }
      if (!mountedRef.current || notOwnerRef.current !== notOwner) return;
      const delay = DESKTOP_WORKSPACE_RETRY_DELAYS_MS[
        Math.min(index, DESKTOP_WORKSPACE_RETRY_DELAYS_MS.length - 1)
      ];
      notOwnerSignOutTimerRef.current = setTimeout(() => {
        notOwnerSignOutTimerRef.current = null;
        void attempt(index + 1);
      }, delay);
    };
    await attempt(0);
  }, [noteSignInAnswer]);

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
    const notOwner = notOwnerRef.current;
    if (notOwner && notOwner.userId === session.user.id) {
      // The owner check already said this sign-in is not the owner's and its
      // sign-out has not gone through yet: nothing is read again (a second
      // check on a dropping connection showed "still signed in"), and the
      // sign-out is tried again now (A12 pass 4 L3).
      clearSessionView('unauthorized');
      await signOutNotOwnerQuietly();
      return false;
    }
    if (notOwner) forgetNotOwner();

    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    if (mountedRef.current && !options.background) {
      if (!snapshotRef.current) setPhase('loading');
      setMessage(null);
      setUserEmail(session.user.email ?? null);
      setSessionExpiresAt(session.expires_at ?? null);
    }

    try {
      // Everyday item 3 (2 Oct 2026): when this tab's last download of every
      // task started, for Reports' "behind" check; only a full load reads them all.
      const startedAt = new Date().toISOString();
      const loaded = await loadDAVEWebReadOnlySnapshot(options.collections);
      if (!mountedRef.current || loadSequenceRef.current !== loadSequence) return false;
      const tasksPulledAt = options.collections ? snapshotRef.current?.tasksPulledAt ?? null : startedAt;
      const nextSnapshot = Object.freeze({ ...loaded, tasksPulledAt });
      snapshotRef.current = nextSnapshot;
      lastSuccessfulRefreshAtRef.current = nextSnapshot.refreshedAt;
      setSnapshot(nextSnapshot);
      setPhase('ready');
      setUnavailableAttempts(0);
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
        // Not the owner: the not-authorized page, whatever the browser's
        // sign-out does next. A sign-out that could not reach the server had
        // thrown out of here, and the start-up check showed "Your projects
        // are not loaded yet… You are still signed in" (whole-app audit A12
        // pass 4 L3, 30 Sep 2026). Nothing loaded is kept. This browser only:
        // an automatic sign-out never ends the owner's iPhone and iPad
        // sign-ins (owner answer Q21).
        notOwnerRef.current = { userId: session.user.id, message: error.message };
        clearSessionView('unauthorized');
        await signOutNotOwnerQuietly();
        return false;
      }
      if (snapshotRef.current) {
        setPhase('ready');
        setFreshness(current =>
          recordDAVEWebRefreshFailure(current, new Date().toISOString()));
        setMessage(AUTOMATIC_REFRESH_WAITING_MESSAGE);
      } else {
        // Still signed in; the owner check or first read did not finish (a
        // timeout, a dropped connection). This had shown the password form
        // with no way to try again, and nothing retried until a workspace had
        // loaded (audit round 2 follow-up, 30 Sep 2026).
        setPhase('unavailable');
        setMessage(WORKSPACE_UNAVAILABLE_MESSAGE);
        setUnavailableAttempts(count => count + 1);
      }
      return false;
    }
  }, [clearSessionView, forgetNotOwner, signOutNotOwnerQuietly]);

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
      // The sign-in is kept but the check did not finish (an expired access
      // token and no network). This had shown the password form with "The
      // desktop session could not be checked." and no Try Again; it is now
      // the "not loaded yet" page, with Try Again and the automatic retry.
      // Nothing is shown until a check confirms the owner (A12 pass 3 L1).
      // Never after the owner check has said "not the owner" (A12 pass 4 L3).
      if (!cancelled && mountedRef.current && notOwnerRef.current) {
        clearSessionView('unauthorized');
        return;
      }
      if (!cancelled && mountedRef.current) {
        setPhase('unavailable');
        setMessage(WORKSPACE_UNAVAILABLE_MESSAGE);
        setUnavailableAttempts(count => count + 1);
      }
    });

    const unsubscribe = daveWebSupabaseGateway.subscribeToAuthStateChange((event, session) => {
      if (cancelled) return;
      // While this tab ends its sign-in because another tab signed out,
      // only SIGNED_OUT counts. auth-js's sign-out first refreshes an
      // expired sign-in (a tab hidden for an hour), and that refresh had
      // started loading the workspace: with /logout failing, no SIGNED_OUT
      // followed and the tab showed his projects or "This account is not
      // authorized…" instead of the sign-in page (A1 pass 6 L1).
      if (endingSignInRef.current && event !== 'SIGNED_OUT') return;
      // auth-js also sends the start-up event without a session when the
      // refresh could not reach the server and the sign-in is kept. The
      // start-up check above decides that view; a real sign-out arrives as
      // SIGNED_OUT (A12 pass 3 L1).
      if (event === 'INITIAL_SESSION' && !session) return;
      // auth-js tells every tab of the browser about any tab's SIGNED_OUT,
      // without saying whose. While this tab still holds its own sign-in the
      // event was another tab's: a non-owner's automatic sign-out had dropped
      // the owner's working tab to the sign-in page, its typing lost, though
      // its own sign-in was still there (A1 pass 5, 30 Sep 2026). Another tab
      // of this account that signs out says so on the sign-out channel, and
      // this tab's sign-in ends then (A12 pass 5 L2). A tab's own sign-out,
      // or its sign-in expiring, removes the stored sign-in first.
      if (event === 'SIGNED_OUT' && daveWebSupabaseGateway.storedSignInUserId()) return;
      if (event === 'SIGNED_OUT' || !session) {
        showSignInEnded();
        return;
      }
      // auth-js also passes every other tab's refresh to this tab, with that
      // tab's session. Only this tab's own sign-in is acted on: a visitor's
      // tab refreshing had made the owner's tab say "Signed in as" the
      // visitor and save his percent edits as confirmed by the visitor, and a
      // signed-out tab showed "Checking…", then "Sign in is required…", and
      // ran the automatic sign-out (whole-app audit A12 pass 6 L1, 30 Sep
      // 2026). Another tab of the same account still reloads, as before.
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        const ownUserId = daveWebSupabaseGateway.storedSignInUserId();
        if (!ownUserId || session.user?.id !== ownUserId) return;
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
      if (notOwnerSignOutTimerRef.current) {
        clearTimeout(notOwnerSignOutTimerRef.current);
        notOwnerSignOutTimerRef.current = null;
      }
    };
  }, [clearSessionView, loadAuthorizedSnapshot, showSignInEnded]);

  /**
   * A sign-in waits, at most DESKTOP_SIGN_IN_ENDING_WAIT_MS, for this tab's
   * sign-in to finish ending (A12 pass 7 L1). auth-js does not hold a
   * sign-in back while it signs out: a late /logout removed the new
   * sign-in, a refresh thrown away made the ending delete it, and a
   * mistyped password had turned the ending's guard off, so its refresh
   * loaded the workspace as the sign-in was wiped. The ending's settling
   * leaves the view to this sign-in.
   */
  const waitForSignInToFinishEnding = useCallback(async () => {
    let ending = endingSignInRef.current;
    if (!ending) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeUp = new Promise<'time-up'>(resolve => {
      timer = setTimeout(() => resolve('time-up'), DESKTOP_SIGN_IN_ENDING_WAIT_MS);
    });
    try {
      while (ending) {
        const current: DesktopSignInEnding = ending;
        current.signInMadeDuring = true;
        const outcome = await Promise.race([current.settled.then(() => 'settled' as const), timeUp]);
        if (outcome === 'time-up') return;
        ending = endingSignInRef.current === current ? null : endingSignInRef.current;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    forgetNotOwner();
    if (mountedRef.current) {
      setPhase('signing_in');
      setMessage(null);
    }
    // An earlier sign-in's answer is no longer on screen.
    noteSignInAnswer(null);
    signInsAwaitingAnswerRef.current += 1;
    let endingPastLimit: DesktopSignInEnding | null = null;
    let result: DAVEWebSignInResult;
    let failedMessage = SIGN_IN_FAILED_MESSAGE;
    try {
      // The ending's guard stays on until it settles; a sign-in starting no
      // longer turns it off (A12 pass 7 L1).
      await waitForSignInToFinishEnding();
      // Still set: the ending ran past the time limit.
      endingPastLimit = endingSignInRef.current;
      // The button is busy while this sign-in goes out.
      if (mountedRef.current) setPhase('signing_in');
      result = await daveWebSupabaseGateway.signIn(email.trim(), password);
    } catch {
      // auth-js throws, rather than answering, when this tab cannot store
      // the sign-in: with site data blocked, reading sessionStorage throws.
      // Nothing was kept. The page had stayed "signing in" with no message,
      // and every retry did the same (A12 pass 11 L2).
      result = { ok: false, session: null };
      if (!(await isAuthStorageSecure().catch(() => false))) {
        failedMessage = SITE_STORAGE_BLOCKED_MESSAGE;
      }
    } finally {
      signInsAwaitingAnswerRef.current -= 1;
    }
    if (!result.ok || !result.session) {
      if (mountedRef.current) {
        setPhase('signed_out');
        setMessage(failedMessage);
      }
      // An ending that settles after this keeps the message (A12 pass 11 L1).
      noteSignInAnswer({ phase: 'signed_out', message: failedMessage });
      return false;
    }
    // His sign-in worked: an ending past the time limit no longer holds this
    // tab's guard. It had made every later sign-in here wait the full 10 s
    // and ignored this tab's own refreshes until its hung request ended
    // (A12 pass 8 L1). A late /logout that fails leaves this sign-in be: the
    // gateway keeps a sign-in of another session than the one it ends (A12
    // pass 9). One that succeeds still removes it: auth-js then deletes
    // whatever this tab holds (`_removeSession`), with SIGNED_OUT, and the
    // tab shows the sign-in page. A sign-in that failed leaves the guard on.
    if (endingPastLimit && endingSignInRef.current === endingPastLimit) {
      endingSignInRef.current = null;
    }
    return loadAuthorizedSnapshot(result.session);
  }, [forgetNotOwner, loadAuthorizedSnapshot, noteSignInAnswer, waitForSignInToFinishEnding]);

  const signOutOfDesktop = useCallback(async (scope: DAVEWebSignOutScope = 'local') => {
    const userId = daveWebSupabaseGateway.storedSignInUserId();
    await daveWebSupabaseGateway.signOut(scope);
    clearSessionView();
    // The other tabs of this account open in this browser sign out too, so
    // "This Computer" is this computer's browser, not this one tab: the
    // other tabs had gone to the sign-in page while still signed in, and a
    // reload showed his projects again (whole-app audit A12 pass 5 L2).
    // Only a sign-out he chose says so; the automatic not-owner sign-out
    // does not. Only tabs running now hear it: a tab closed or asleep
    // (Chrome's Memory Saver, Reopen Closed Tab) keeps its sign-in, as the
    // sign-out choice and the sign-in page say (A12 pass 6 L2).
    if (userId) {
      try {
        signOutChannelRef.current?.postMessage({ type: SIGNED_OUT_OF_THIS_COMPUTER, userId });
      } catch {
        // A closed channel: the other tabs are not told, and keep their
        // sign-ins until they sign out there (A12 pass 6 L2).
      }
    }
  }, [clearSessionView]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(DESKTOP_SIGN_OUT_CHANNEL_NAME);
    } catch {
      return;
    }
    signOutChannelRef.current = channel;
    channel.onmessage = event => {
      const userId = signedOutUserId(event.data);
      // Another account's sign-out, or one that does not say whose, leaves
      // this tab as it is (A1 pass 5).
      if (!userId || daveWebSupabaseGateway.storedSignInUserId() !== userId) return;
      // Nothing is shown without a confirmed owner while the sign-in ends,
      // and, ended or not on the server, this tab then shows the sign-in
      // page (A1 pass 6 L1); its stored sign-in is gone either way. Its
      // promise is kept so a sign-in here waits for it, and the guard is
      // cleared only when it settles (A12 pass 7 L1).
      const ending: DesktopSignInEnding = {
        settled: Promise.resolve(),
        signInMadeDuring: false,
        signInAnsweredDuring: null,
      };
      endingSignInRef.current = ending;
      showSignInEnded();
      ending.settled = daveWebSupabaseGateway.signOutThisTabToo(userId)
        .catch((): DAVEWebTabSignOutOutcome => 'ended')
        .then(outcome => {
          if (endingSignInRef.current !== ending) return;
          endingSignInRef.current = null;
          // A sign-in made here meanwhile shows its own outcome: one that
          // waited on this ending, or one it kept. An ending started while
          // his sign-in was out had shown the sign-in page as it kept his
          // new sign-in, the workspace open on it (A12 pass 10 L1). One that
          // answered during it and opened nothing keeps its answer on the
          // sign-in page; nothing loaded stays (A12 pass 11 L1).
          if (outcome !== 'kept' && !ending.signInMadeDuring) {
            showSignInEnded(ending.signInAnsweredDuring);
          }
        });
    };
    return () => {
      signOutChannelRef.current = null;
      channel.close();
    };
  }, [showSignInEnded]);

  const refreshSnapshot = useCallback(async () => {
    const status = await daveWebSupabaseGateway.getSessionStatus();
    if (!status.session) {
      clearSessionView();
      return false;
    }
    return loadAuthorizedSnapshot(status.session);
  }, [clearSessionView, loadAuthorizedSnapshot]);

  useEffect(() => {
    if (phase !== 'unavailable' || unavailableAttempts === 0) return;
    const delay = DESKTOP_WORKSPACE_RETRY_DELAYS_MS[
      Math.min(unavailableAttempts, DESKTOP_WORKSPACE_RETRY_DELAYS_MS.length) - 1
    ];
    const visible = () =>
      typeof document === 'undefined' || document.visibilityState === 'visible';
    let due = false;
    const retry = () => {
      due = false;
      // A retry that fails before reaching the load still schedules the next.
      void refreshSnapshot().catch(() => {
        if (mountedRef.current) setUnavailableAttempts(count => count + 1);
      });
    };
    const timer = setTimeout(() => {
      if (visible()) retry();
      else due = true;
    }, delay);
    const retryWhenVisible = () => {
      if (due && visible()) retry();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', retryWhenVisible);
    }
    return () => {
      clearTimeout(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', retryWhenVisible);
      }
    };
  }, [phase, refreshSnapshot, unavailableAttempts]);

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

  const loadDocumentProof = useCallback((
    document: ReferenceDocument,
    claim: ECOSDocumentProofClaim,
  ) => daveWebSupabaseGateway.loadAuthorizedDocumentProof(document, claim), []);

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
    let failed = false;
    try {
      for (const item of items) {
        await daveWebSupabaseGateway.updateAuthorizedScheduleItem(
          scheduleItemForCloud(item),
          item.cloudUpdatedAt,
        );
        updated += 1;
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      const collections = ['schedule_items'] as const;
      if (updated > 0) announceMutation(collections);
      // A refusal on the first item refreshes too: "Apply all date changes"
      // says the schedule was refreshed, and the next try needs the latest
      // revisions (whole-app audit round 2 F7, 30 Sep 2026). After a refusal
      // it is a full read: a targeted one was answered from the copy an
      // earlier save in the batch had marked up to date, so the refused task
      // kept the version the web had opened (audit round 2 follow-up).
      if (failed) await refreshSnapshot().catch(() => false);
      else if (updated > 0) await refreshSnapshotInBackground(collections);
    }
    return updated;
  }, [announceMutation, refreshSnapshot, refreshSnapshotInBackground]);

  const deleteTask = useCallback(async (item: DAVEWebScheduleItem) => {
    // With the hidden rows of its revision chain, as the phone deletes it (A10 pass 8 L3).
    const current = snapshotRef.current;
    const withHiddenRows = current
      ? scheduleItemIdsDeletedWithTask(current.knownScheduleItems ?? current.scheduleItems, item, current.referenceDocuments)
      : [item.id];
    await daveWebSupabaseGateway.deleteAuthorizedScheduleItem(
      item.id,
      item.cloudUpdatedAt,
      withHiddenRows.filter(id => id !== item.id),
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
    // A task a new master moved answers to its removed row, as on the phone (A10 pass 8 M1). A lookahead's delete
    // leaves the master tasks it restated on the dates shown, with its tasks or without (review N1 web M1); without
    // them it moves no percent, as the phone's Delete PDF Only (review N2 W1).
    const current = snapshotRef.current;
    const revisions = current && (deleteLinkedTasks || scheduleDocumentAddsToMaster(document))
      ? planDAVEWebScheduleDocumentDelete({ snapshot: current, document, keepTasks: !deleteLinkedTasks })
      : [];
    await daveWebSupabaseGateway.deleteAuthorizedReferenceDocument(
      document.id,
      document.cloudUpdatedAt,
      deleteLinkedTasks ? document.linkedScheduleItems : [],
      revisions,
    );
    const collections: readonly DAVEOperationalCollectionName[] = deleteLinkedTasks || revisions.length > 0
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
    const importsTasks = prepared.scheduleItems.length > 0;
    if (importsTasks && !snapshot) {
      throw new DAVEWebDocumentMutationError(
        'conflict',
        'The workspace is still loading its tasks. Refresh the workspace, then upload the schedule again.',
      );
    }
    // Joined to the tasks the web shows now, at upload time, as the phone's
    // approval does (audit A5 pass 3 F5): unchanged tasks keep their
    // progress, changed tasks carry it.
    const plan = importsTasks
      ? planDAVEWebScheduleImport({ snapshot: snapshot!, importedScheduleItems: prepared.scheduleItems, pairingChoices: prepared.pairingChoices }) // his answers at the review (Q30)
      : null;
    try {
      await daveWebSupabaseGateway.uploadAuthorizedReferenceDocument({
        document: prepared.document,
        bytes,
        file,
        scheduleItems: plan?.additions ?? [],
        revisedScheduleItems: plan?.revisions ?? [],
        onProgress,
      });
    } catch (error) {
      if (importsTasks && error instanceof DAVEWebDocumentMutationError && error.code === 'conflict') {
        void refreshSnapshotInBackground(['reference_documents', 'schedule_items']);
      }
      throw error;
    }
    const collections: readonly DAVEOperationalCollectionName[] = importsTasks
      ? ['reference_documents', 'schedule_items']
      : ['reference_documents'];
    announceMutation(collections);
    await refreshSnapshotInBackground(collections);
  }, [announceMutation, refreshSnapshotInBackground, snapshot]);

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
    // A lookahead adds to the master (owner answer Q22): never made current, replaced or not (review N1 web M1).
    if (scheduleDocumentAddsToMaster(document)) {
      throw new DAVEWebDocumentMutationError('conflict', 'A lookahead adds to the master schedule. It is never made the current schedule.');
    }
    const scheduleDocuments = (snapshot?.referenceDocuments || []).filter(item =>
      item.category === 'Schedules' || item.category === 'Schedule',
    );
    const shownBefore = snapshotRef.current?.scheduleItems ?? [];
    const scope = await daveWebSupabaseGateway.setAuthorizedCurrentSchedule(document, scheduleDocuments);
    const collections = ['reference_documents'] as const;
    announceMutation(collections);
    await refreshSnapshotInBackground(collections);
    // Progress recorded after the upload, on a task this schedule's upload
    // paired, follows the task now shown (whole-app audit A5 pass 4 #3).
    const carried = scheduleProgressCarriedToShownTasks({
      before: shownBefore,
      after: snapshotRef.current?.scheduleItems ?? [],
      // A task entered by hand waiting on this schedule is restated now (whole-app audit A5 pass 18 L3).
      documentsBefore: scheduleDocuments,
      documentsAfter: snapshotRef.current?.referenceDocuments ?? [],
    }) as DAVEWebScheduleItem[];
    if (carried.length > 0) await updateTasks(carried).catch(() => 0);
    return scope;
  }, [announceMutation, refreshSnapshotInBackground, snapshot?.referenceDocuments, updateTasks]);

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

  const loadReportPeriod = useCallback(
    (scopeKey: string, format: string) => daveWebSupabaseGateway.loadAuthorizedReportPeriod(scopeKey, format),
    [],
  );
  const saveReportPeriod = useCallback(
    (row: Parameters<typeof daveWebSupabaseGateway.saveAuthorizedReportPeriod>[0]) =>
      daveWebSupabaseGateway.saveAuthorizedReportPeriod(row),
    [],
  );
  const reportOwnerId = useCallback(() => daveWebSupabaseGateway.authorizedOwnerId(), []);

  const restoreMissingTasks = useCallback(async (items: readonly DAVEWebScheduleItem[]) => {
    const currentIds = new Set(snapshot?.scheduleItems.map(item => item.id) || []);
    const candidates = items.filter(item => !currentIds.has(item.id));
    // Missing means gone from the cloud: not hidden (a schedule that is not
    // current) and not deleted on purpose (whole-app audit round 2 F8).
    const unrestorable = candidates.length > 0
      ? await daveWebSupabaseGateway.listAuthorizedUnrestorableScheduleItemIds(
          candidates.map(item => item.id),
        )
      : new Set<string>();
    let restored = 0;
    let failed = false;
    try {
      for (const item of candidates) {
        if (currentIds.has(item.id) || unrestorable.has(item.id)) continue;
        await daveWebSupabaseGateway.createAuthorizedScheduleItem(scheduleItemForCloud(item));
        currentIds.add(item.id);
        restored += 1;
      }
    } catch (error) {
      failed = true;
      if (restored > 0) {
        throw new DAVEWebTaskMutationError(
          'write_failed',
          `${restored} missing task${restored === 1 ? ' was' : 's were'} restored before one could not be saved. The workspace has been refreshed; validate the export again to restore the rest.`,
        );
      }
      throw error;
    } finally {
      const collections = ['schedule_items'] as const;
      if (restored > 0) announceMutation(collections);
      // Refreshed after a part-way failure too, so the workspace shows what
      // was restored.
      if (restored > 0 || failed) await refreshSnapshotInBackground(collections);
    }
    return restored;
  }, [announceMutation, refreshSnapshotInBackground, snapshot?.scheduleItems]);

  const askProjectQuestion = useCallback((input: ECOSProjectQuestionControl & {
    projectId: string;
    projectName: string;
    question: string;
    conversationId?: string;
    priorTurnId?: string;
    knownProjectNames?: readonly string[];
    closedProjectNames?: readonly string[];
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
    loadDocumentProof,
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
    loadReportPeriod,
    saveReportPeriod,
    reportOwnerId,
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
    loadDocumentProof,
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
    loadReportPeriod,
    saveReportPeriod,
    reportOwnerId,
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
