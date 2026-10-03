import {
  createClient,
  isAuthError,
  isAuthRefreshDiscardedError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import type {
  ProjectUpdate,
  ReferenceDocument,
  ReferenceDocumentExtractedPage,
  ScheduleItem,
  UpdatePhoto,
} from '../types';
import {
  DAVE_WEB_MAX_DOCUMENT_BYTES,
  type DAVEWebDocumentExtension,
  type DAVEWebReportRecord,
  type DAVEWebScheduleImportRevision,
} from './DAVEWebOperations';
import {
  accessTokenIsForBrowserTabSignIn,
  browserTabSignInUserId,
  browserTabStoredSignIn,
  forgetBrowserTabSignIn,
  supabaseSecureAuthStorage,
} from './SupabaseAuthStorage.web';
import {
  chunkSupabaseFilterValues,
  paginateSupabaseCollection,
} from './SupabaseCollectionPagination';
import {
  attachDAVEOperationalRealtime,
  type DAVEOperationalCollectionName,
  type DAVEOperationalRealtimeEntity,
  type DAVEOperationalRealtimePayload,
  type DAVEOperationalRealtimeStatus,
} from './DAVEOperationalRefresh';
import { createFieldNoteCloudGateway } from './FieldNoteCloudGateway';
import { forgetDAVEWebReportPeriods } from './DAVEWebReportSend';

export const DAVE_WEB_AUTHORIZATION_CACHE_TTL_MS = 5 * 60_000;
export const DAVE_WEB_DOCUMENT_COVERAGE_CACHE_TTL_MS = 5 * 60_000;
import { RESUMABLE_UPLOAD_THRESHOLD_BYTES } from './StorageUploadPolicy';
import { uploadWebFileResumably } from './ResumableWebStorageUpload';
import { MAX_PHOTO_SOURCE_BYTES } from './PhotoPairPreparation';
import {
  compactECOSDocumentIndexForCloud,
  compactECOSDocumentMetadataForCloud,
} from './ECOSDocumentIndexPersistence';
import {
  canonicalReferenceCategory,
} from './AuthoritativeDocumentSystem';
import { replaceECOSDocumentCloudIndex } from './ECOSDocumentCloudIndex';
import {
  GOOGLE_DRIVE_LINK_MAX_BYTES,
  isGoogleDriveLinkedSource,
} from './GoogleDriveWebProvider';
import {
  activateECOSCurrentReferenceDocument,
  enqueueECOSHostedIndex,
  carryECOSHostedIndexStatus,
  loadECOSHostedIndexStatuses,
  type ScheduleRetirementScope,
} from './ECOSHostedIndexer';
import { askECOSProjectQuestion } from './ECOSProjectQuestion';
import {
  analyzeECOSDrawingPage,
  type ECOSDrawingPageAnalysisInput,
} from './ECOSDrawingPageAnalysis';
import {
  beginOrResumeECOSDocumentIndexJob,
  checkpointECOSDocumentIndexPage,
  commitECOSDocumentIndexJob,
  setECOSDocumentIndexJobStatus,
} from './ECOSDocumentIndexJobs';
import {
  summarizeECOSDocumentCoverageRows,
  type ECOSDocumentCoverageSummary,
} from './ECOSDocumentCoverageSummary';
import {
  loadAuthorizedECOSDocumentProofBundle,
  type ECOSAuthorizedDocumentProof,
  type ECOSDocumentProofClaim,
} from './ECOSDocumentProofAuthority';

export type DAVEWebRawRows = Readonly<{
  projects: readonly unknown[];
  scheduleItems: readonly unknown[];
  projectUpdates: readonly unknown[];
  referenceDocuments: readonly unknown[];
  syncTombstones: readonly unknown[];
}>;

export type DAVEWebSignInResult = Readonly<{
  ok: boolean;
  session: Session | null;
}>;

export type DAVEWebSessionStatus = Readonly<{
  configured: boolean;
  session: Session | null;
}>;

export class DAVEWebAuthorizationError extends Error {
  constructor(message = 'This account is not authorized for the Vitruvius desktop pilot.') {
    super(message);
    this.name = 'DAVEWebAuthorizationError';
  }
}

/**
 * Owner answer Q21 (30 Sep 2026): sign out of this computer only ('local') or
 * of every device ('global', which ends the iPhone's and iPad's sign-ins too).
 */
export type DAVEWebSignOutScope = 'local' | 'global';

/**
 * What a tab's sign-out because another tab signed out left in this tab
 * (whole-app audit A12 pass 10 L1): 'ended', no sign-in; 'kept', a sign-in
 * of another session or account, left as it is.
 */
export type DAVEWebTabSignOutOutcome = 'ended' | 'kept';

/** Sign out of all devices could not reach the cloud; nothing was signed out. */
export class DAVEWebSignOutNeedsConnectionError extends Error {
  constructor() {
    super('Signing out your other devices needs an internet connection, and Vitruvius could not reach the cloud just now. Nothing was signed out.');
    this.name = 'DAVEWebSignOutNeedsConnectionError';
  }
}

export type DAVEWebTaskMutationErrorCode =
  | 'conflict'
  | 'deleted'
  | 'not_found'
  | 'write_failed';

export class DAVEWebTaskMutationError extends Error {
  constructor(
    public readonly code: DAVEWebTaskMutationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DAVEWebTaskMutationError';
  }
}

export class DAVEWebDocumentMutationError extends Error {
  constructor(
    public readonly code: DAVEWebTaskMutationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DAVEWebDocumentMutationError';
  }
}

export type DAVEWebStorageBucket = 'project-photos' | 'project-documents';

export class DAVEWebArtifactAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DAVEWebArtifactAccessError';
  }
}

export type DAVEWebDocumentUploadInput = Readonly<{
  document: ReferenceDocument & DAVEWebDocumentExtension;
  bytes: ArrayBuffer;
  file?: Blob;
  /** New rows this import inserts; never written over a saved task. */
  scheduleItems?: readonly ScheduleItem[];
  /** Saved tasks this import changes (planDAVEWebScheduleImport), each only while its cloud revision matches. */
  revisedScheduleItems?: readonly DAVEWebScheduleImportRevision[];
  onProgress?: (fraction: number) => void;
}>;

export type DAVEWebLinkedDocumentInput = Readonly<{
  document: ReferenceDocument & DAVEWebDocumentExtension;
  bytes: ArrayBuffer;
  file?: Blob;
  onProgress?: (fraction: number) => void;
}>;

export type DAVEWebTaskPhotoUploadInput = Readonly<{
  task: ScheduleItem;
  bytes: ArrayBuffer;
  fileName: string;
  mimeType: string;
}>;

type DAVEWebRevisionedReferenceDocument =
  ReferenceDocument &
  DAVEWebDocumentExtension &
  Readonly<{ cloudUpdatedAt?: string | null }>;

export type DAVEWebSupabaseGateway = ReturnType<typeof createDAVEWebSupabaseGateway>;

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

const browserClient = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: supabaseSecureAuthStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

/** Live-update connections already kept on their tab's own sign-in. */
const realtimeKeptOnThisTabsSignIn = new WeakSet<object>();

/**
 * This tab's live updates keep this tab's own sign-in too (owner answer
 * Q26, 2 Oct 2026; whole-app audit A12 pass 6). supabase-js gives the
 * live-update connection the access token of every refresh and sign-in its
 * auth client hears, and auth-js passes this tab every other tab's of this
 * browser, with that tab's tokens. Another account's tab refreshing had
 * made this tab's live updates sign in as that account until that tab
 * signed out or David clicked back into this one: the cloud's owner check
 * kept every row from it, so he missed live updates meanwhile.
 *
 * Now a token is taken only when it is for the account this tab's own
 * stored sign-in is: his own refreshes and sign-ins (auth-js stores them
 * before it tells of them) and another tab of his account, as before.
 * Another account's, or any while this tab holds no sign-in, is left out
 * and the connection keeps what it had. A sign-out still sets it back to
 * this tab's own sign-in (none once signed out), as before.
 */
function keepRealtimeOnThisTabsSignIn(client: SupabaseClient): void {
  const realtime = (client as Partial<Pick<SupabaseClient, 'realtime'>>).realtime;
  if (!realtime || typeof realtime.setAuth !== 'function') return;
  if (realtimeKeptOnThisTabsSignIn.has(realtime)) return;
  realtimeKeptOnThisTabsSignIn.add(realtime);
  const setAuth = realtime.setAuth.bind(realtime);
  realtime.setAuth = async (token?: string | null) => {
    if (token && !accessTokenIsForBrowserTabSignIn(token)) return;
    await setAuth(token);
  };
}

export function createDAVEWebSupabaseGateway(client: SupabaseClient | null) {
  if (client) keepRealtimeOnThisTabsSignIn(client);
  let artifactPathOwnerId: string | null = null;
  let authorizedPhotoPaths = new Set<string>();
  let authorizedDocumentPaths = new Set<string>();
  let cachedRowsOwnerId: string | null = null;
  let cachedAuthorizedRows: DAVEWebRawRows | null = null;
  let authorizationCache: Readonly<{ ownerId: string; expiresAt: number }> | null = null;
  let authorizationInFlight: Promise<string> | null = null;
  const documentCoverageSummaryCache = new Map<string, Readonly<{
    expiresAt: number;
    summary: ECOSDocumentCoverageSummary;
  }>>();
  const realtimeSatisfiedCollections = new Set<DAVEOperationalCollectionName>();

  function cacheAcknowledgedScheduleItem(
    item: ScheduleItem,
    ownerId: string,
    cloudUpdatedAt: string,
  ) {
    if (cachedRowsOwnerId !== ownerId || !cachedAuthorizedRows) return;
    const acknowledgedRow = scheduleItemRow(item, ownerId, cloudUpdatedAt);
    const existingIndex = cachedAuthorizedRows.scheduleItems.findIndex(
      value => readRawString(value, 'id') === item.id,
    );
    const scheduleItems = [...cachedAuthorizedRows.scheduleItems];
    if (existingIndex >= 0) scheduleItems[existingIndex] = acknowledgedRow;
    else scheduleItems.unshift(acknowledgedRow);
    cachedAuthorizedRows = Object.freeze({
      ...cachedAuthorizedRows,
      scheduleItems: Object.freeze(scheduleItems),
    });
    realtimeSatisfiedCollections.add('schedule_items');
  }

  /**
   * A write the cloud refused because another device got there first means
   * this copy of the table is behind. Clearing its up-to-date mark makes the
   * next refresh of it, even a targeted one, read the cloud again. An earlier
   * save in the same batch had set the mark, so "Apply all date changes" said
   * the schedule was refreshed while it still showed the refused task as the
   * web had opened it (whole-app audit round 2 follow-up, 30 Sep 2026).
   */
  function markBehindCloud(...collections: DAVEOperationalCollectionName[]) {
    collections.forEach(collection => realtimeSatisfiedCollections.delete(collection));
  }

  function invalidateAuthorization() {
    authorizationCache = null;
    authorizationInFlight = null;
  }

  /** Nothing read for the signed-out account is kept. */
  function forgetSignedInReads() {
    invalidateAuthorization();
    cachedRowsOwnerId = null;
    cachedAuthorizedRows = null;
    documentCoverageSummaryCache.clear();
    artifactPathOwnerId = null;
    authorizedPhotoPaths = new Set<string>();
    authorizedDocumentPaths = new Set<string>();
  }

  async function requireAuthorizedOwnerCached(): Promise<string> {
    if (
      authorizationCache &&
      authorizationCache.expiresAt > Date.now()
    ) {
      return authorizationCache.ownerId;
    }
    if (authorizationInFlight) return authorizationInFlight;
    const request = requireAuthorizedOwner(client!).then(ownerId => {
      authorizationCache = Object.freeze({
        ownerId,
        expiresAt: Date.now() + DAVE_WEB_AUTHORIZATION_CACHE_TTL_MS,
      });
      return ownerId;
    });
    authorizationInFlight = request;
    try {
      return await request;
    } finally {
      if (authorizationInFlight === request) authorizationInFlight = null;
    }
  }

  const fieldNotes = createFieldNoteCloudGateway(
    client,
    requireAuthorizedOwnerCached,
  );

  return Object.freeze({
    fieldNotes,
    async beginOrResumeAuthorizedDocumentIndexJob(input: {
      documentId: string;
      sourceSha256: string;
      sourcePageCount: number;
    }) {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwnerCached();
      return beginOrResumeECOSDocumentIndexJob({ client, ownerId, ...input });
    },
    async checkpointAuthorizedDocumentIndexPage(input: {
      jobId: string;
      page: ReferenceDocumentExtractedPage;
    }) {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwnerCached();
      return checkpointECOSDocumentIndexPage({ client, ownerId, ...input });
    },
    async setAuthorizedDocumentIndexJobStatus(input: {
      jobId: string;
      status: 'running' | 'ready' | 'committed' | 'failed' | 'cancelled';
      failureMessage?: string | null;
    }) {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwnerCached();
      return setECOSDocumentIndexJobStatus({ client, ownerId, ...input });
    },
    async commitAuthorizedDocumentIndexJob(input: {
      jobId: string;
      extractionMethod?: string | null;
    }) {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      await requireAuthorizedOwnerCached();
      return commitECOSDocumentIndexJob({ client, ...input });
    },
    async analyzeAuthorizedDrawingPage(input: ECOSDrawingPageAnalysisInput) {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      await requireAuthorizedOwnerCached();
      return analyzeECOSDrawingPage({ client, input });
    },
    async askAuthorizedProjectQuestion(input: {
      projectId: string;
      projectName: string;
      question: string;
      conversationId?: string;
      priorTurnId?: string;
      knownProjectNames?: readonly string[];
      closedProjectNames?: readonly string[];
    }) {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      await requireAuthorizedOwnerCached();
      return askECOSProjectQuestion({ client, ...input });
    },
    /**
     * Whole-app audit A12 pass 3 L1 (30 Sep 2026): with an expired access
     * token and no network, auth-js answers with an error and no session but
     * keeps the stored sign-in, so that check throws (it did not finish; the
     * page says he is still signed in and tries again). When the server
     * refused the refresh, auth-js has already ended the sign-in (and sent
     * SIGNED_OUT): no session, as when nobody is signed in.
     */
    async getSessionStatus(): Promise<DAVEWebSessionStatus> {
      if (!client) return { configured: false, session: null };
      const { data, error } = await client.auth.getSession();
      if (error) {
        const signInKept = !isAuthError(error) ||
          isAuthRetryableFetchError(error) ||
          isAuthRefreshDiscardedError(error);
        if (signInKept) throw new Error('The desktop session could not be checked.');
        return { configured: true, session: null };
      }
      return { configured: true, session: data.session ?? null };
    },

    async authorizeLocalAcceptanceBridge(input: {
      port: number;
      nonce: string;
    }): Promise<void> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      if (typeof __DEV__ === 'undefined' || !__DEV__) {
        throw new Error('The protected validation handoff is available only in a local development session.');
      }
      if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) {
        throw new Error('The local validation port is invalid.');
      }
      if (!/^[a-f0-9]{64}$/.test(input.nonce)) {
        throw new Error('The local validation request is invalid.');
      }
      await requireAuthorizedOwnerCached();
      const { data, error } = await client.auth.getSession();
      const accessToken = data.session?.access_token;
      if (error || !accessToken) {
        throw new Error('Sign in to Vitruvius in this browser tab, then retry the validation authorization.');
      }
      const response = await fetch(`http://127.0.0.1:${input.port}/authorize`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nonce: input.nonce }),
      });
      if (!response.ok) {
        throw new Error('The protected local validation handoff was rejected.');
      }
    },

    subscribeToAuthStateChange(
      callback: (event: AuthChangeEvent, session: Session | null) => void,
    ): () => void {
      if (!client) return () => undefined;
      const { data } = client.auth.onAuthStateChange((event, session) => {
        invalidateAuthorization();
        callback(event, session);
      });
      return () => data.subscription.unsubscribe();
    },

    async subscribeToAuthorizedOperationalChanges({
      onChange,
      onStatus,
    }: {
      onChange: (
        entity: DAVEOperationalRealtimeEntity,
        collections?: readonly DAVEOperationalCollectionName[],
        payload?: DAVEOperationalRealtimePayload,
      ) => void;
      onStatus?: (status: DAVEOperationalRealtimeStatus) => void;
    }): Promise<() => void> {
      if (!client) return () => undefined;
      const ownerId = await requireAuthorizedOwnerCached();
      return attachDAVEOperationalRealtime({
        client,
        ownerId,
        onChange: (entity, collections, payload) => {
          if (payload && cachedAuthorizedRows) {
            const applied = applyDAVEWebRealtimeRows(
              cachedAuthorizedRows,
              entity,
              payload,
            );
            if (applied) {
              cachedAuthorizedRows = applied.rows;
              applied.collections.forEach(collection =>
                realtimeSatisfiedCollections.add(collection));
            }
          }
          onChange(entity, collections, payload);
        },
        onStatus,
      });
    },

    async signIn(email: string, password: string): Promise<DAVEWebSignInResult> {
      if (!client) return { ok: false, session: null };
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.session) return { ok: false, session: null };
      return { ok: true, session: data.session };
    },

    /** This computer only unless 'global' is asked for (owner answer Q21). */
    async signOut(scope: DAVEWebSignOutScope = 'local'): Promise<void> {
      if (!client) return;
      const userId = browserTabSignInUserId();
      const { error } = await client.auth.signOut({ scope });
      if (error && scope === 'global' && isAuthRetryableFetchError(error)) {
        throw new DAVEWebSignOutNeedsConnectionError();
      }
      if (error) throw new Error('The desktop session could not be closed.');
      forgetSignedInReads();
      // The account's report periods leave this browser with its sign-in (review N1).
      if (userId) forgetDAVEWebReportPeriods(userId);
    },

    /**
     * The account this tab's own stored sign-in belongs to, without asking
     * the cloud; null when this tab holds none (whole-app audit A12 pass 5
     * L2). auth-js tells every tab of the browser about any tab's
     * SIGNED_OUT without saying whose it was.
     */
    storedSignInUserId(): string | null {
      if (!client) return null;
      return browserTabSignInUserId();
    },

    /**
     * Another tab of this browser signed this same account out of this
     * computer (or of all devices): this tab's own sign-in ends too, so
     * "Sign Out of This Computer" signs out the tabs open and running then,
     * and a reload does not show his projects again (whole-app audit A12
     * pass 5 L2, 30 Sep 2026). A tab closed or asleep then is not told and
     * keeps its sign-in (A12 pass 6 L2).
     * Ended on the server when it can be reached, and taken out of this
     * tab's storage either way. Another account's sign-in is left alone,
     * and a tab holding none sends nothing, so tabs never answer each
     * other's sign-outs back and forth. Never throws.
     *
     * A sign-in David made here meanwhile is not taken out (A12 pass 7
     * L1). auth-js does not hold a sign-in back while it signs out, and
     * when it could not finish (it threw its refresh away because storage
     * changed, or /logout answered 503) this had deleted whatever this tab
     * held by then: a sign-in David had just made here, with no
     * SIGNED_OUT, so his workspace stayed with no sign-in behind it.
     *
     * It tells them apart by session (A12 pass 9): Supabase's access token
     * names its sign-in (`session_id`), new for every sign-in and kept by
     * its refreshes. Once auth-js answers, a stored sign-in of the session
     * being ended is removed at once; one of another session or account is
     * kept, since in this tab only a sign-in that succeeded writes a new
     * session; a token that does not say is removed. It had first waited
     * for every sign-in still awaiting an answer, and kept only a refresh
     * token one had succeeded with (A12 pass 8 H1): a sign-in that never
     * answered kept the ended sign-in here, refreshed by auth-js, and a
     * reload opened his projects with no password (L1); and his new
     * sign-in, once auth-js refreshed it, was deleted with no SIGNED_OUT
     * (L2).
     *
     * It says what it left (A12 pass 10 L1), and the tab's page follows
     * that: a second ending, started while his sign-in here was out, had
     * shown the sign-in page as it settled, though it had kept his new
     * sign-in and the workspace was open on it.
     */
    async signOutThisTabToo(userId: string): Promise<DAVEWebTabSignOutOutcome> {
      if (!client) return 'ended';
      const ending = browserTabStoredSignIn();
      if (!ending) return 'ended';
      if (!userId || ending.userId !== userId) return 'kept';
      try {
        await client.auth.signOut({ scope: 'local' });
      } catch {
        // Whatever auth-js left in storage is looked at below.
      }
      const stored = browserTabStoredSignIn();
      const anotherSignIn = stored !== null &&
        stored.sessionId !== null &&
        ending.sessionId !== null &&
        (stored.userId !== ending.userId || stored.sessionId !== ending.sessionId);
      // A sign-in made here meanwhile is kept, with what it has read.
      if (anotherSignIn) return 'kept';
      if (stored) forgetBrowserTabSignIn();
      forgetSignedInReads();
      // This tab's own copies of that account's report periods go too (review N1).
      forgetDAVEWebReportPeriods(userId);
      return 'ended';
    },

    async loadAuthorizedRows(
      collections?: readonly DAVEOperationalCollectionName[],
    ): Promise<DAVEWebRawRows> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const userId = await requireAuthorizedOwnerCached();
      const cachedRows = cachedRowsOwnerId === userId ? cachedAuthorizedRows : null;
      const requestedCollections = cachedRows && collections
        ? new Set(collections)
        : null;
      const shouldRead = (collection: DAVEOperationalCollectionName) =>
        !requestedCollections || (
          requestedCollections.has(collection) &&
          !realtimeSatisfiedCollections.has(collection)
        );

      const [projects, scheduleItems, projectUpdates, referenceDocuments, syncTombstones] = await Promise.all([
        shouldRead('projects')
          // Archived rows too: the snapshot needs their names to keep them
          // out of the portfolio (DAVEWebReadOnlyRepository.portfolioProjects).
          ? readOwnerRows(client, 'projects', userId, query => query.order('created_at', { ascending: false }))
          : Promise.resolve(cachedRows?.projects ?? []),
        shouldRead('schedule_items')
          ? readOwnerRows(client, 'schedule_items', userId, query => query.order('updated_at', { ascending: false }))
          : Promise.resolve(cachedRows?.scheduleItems ?? []),
        shouldRead('project_updates')
          ? readOwnerRows(client, 'project_updates', userId, query => query.order('created_at', { ascending: false }))
          : Promise.resolve(cachedRows?.projectUpdates ?? []),
        shouldRead('reference_documents')
          ? readAuthorizedReferenceDocumentMetadata(client)
          : Promise.resolve(cachedRows?.referenceDocuments ?? []),
        shouldRead('sync_tombstones')
          ? readOwnerRows(client, 'dave_sync_tombstones', userId, query => query.order('deleted_at', { ascending: false }))
          : Promise.resolve(cachedRows?.syncTombstones ?? []),
      ]);
      const shouldReadReferenceDocuments = shouldRead('reference_documents');
      let hostedStatuses: Awaited<ReturnType<typeof loadECOSHostedIndexStatuses>> = [];
      if (shouldReadReferenceDocuments && referenceDocuments.length > 0) {
        try {
          hostedStatuses = await loadECOSHostedIndexStatuses({
            client,
            documentIds: referenceDocuments.map(value => {
              const row = isRecord(value) ? value : {};
              const data = isRecord(row.document_data) ? row.document_data : {};
              return typeof data.id === 'string' ? data.id : typeof row.id === 'string' ? row.id : '';
            }),
          });
        } catch {
          // A background-status outage must not prevent the signed-in user from
          // opening their projects, tasks, and document library.
        }
      }
      const statusByDocumentId = new Map(hostedStatuses.map(status => [status.documentId, status]));
      const referenceDocumentsWithHostedStatus = hostedStatuses.length === 0
        ? referenceDocuments
        : referenceDocuments.map(value => {
        if (!isRecord(value)) return value;
        const data = isRecord(value.document_data) ? value.document_data : {};
        const documentId = typeof data.id === 'string' ? data.id : typeof value.id === 'string' ? value.id : '';
        const hosted = statusByDocumentId.get(documentId);
        if (!hosted) return value;
        return {
          ...value,
          document_data: {
            ...data,
            ecosHostedIndexStatus: hosted.customerStatus,
            ecosHostedIndexProgressPercent: hosted.progressPercent,
            ecosHostedIndexCustomerMessage: hosted.customerMessage,
            ecosHostedIndexLimitationCount: hosted.limitationCount,
            ecosHostedIndexSupportReference: hosted.supportReference,
            ecosHostedIndexEvidenceVersion: hosted.committedEvidenceVersion,
            ecosHostedIndexUpdatedAt: hosted.updatedAt,
          },
        };
        });
      const nextRows = Object.freeze({
        projects,
        scheduleItems,
        projectUpdates,
        referenceDocuments: referenceDocumentsWithHostedStatus,
        syncTombstones,
      });
      cachedRowsOwnerId = userId;
      cachedAuthorizedRows = nextRows;
      artifactPathOwnerId = userId;
      authorizedPhotoPaths = collectOwnerPhotoStoragePaths(projectUpdates);
      authorizedDocumentPaths = collectOwnerDocumentStoragePaths(referenceDocumentsWithHostedStatus);
      if (requestedCollections) {
        requestedCollections.forEach(collection =>
          realtimeSatisfiedCollections.delete(collection));
      } else {
        realtimeSatisfiedCollections.clear();
      }

      return nextRows;
    },

    async loadAuthorizedDocumentCoverageSummary(
      documentId: string,
      documentRevision: string | null = null,
    ): Promise<ECOSDocumentCoverageSummary> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const normalizedDocumentId = documentId.trim();
      if (!normalizedDocumentId) throw new Error('Choose a document before loading its ECOS coverage.');
      const ownerId = await requireAuthorizedOwnerCached();
      const cacheKey = `${ownerId}:${normalizedDocumentId}:${documentRevision?.trim() || 'current'}`;
      const cached = documentCoverageSummaryCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.summary;
      const result = await paginateSupabaseCollection<unknown>(async ({ from, to }) => {
        const page = await client
          .from('ecos_document_pages')
          .select('page_number,sheet_number,sheet_mapping_status,visual_coverage')
          .eq('owner_id', ownerId)
          .eq('document_id', normalizedDocumentId)
          .order('page_number', { ascending: true })
          .range(from, to);
        return page;
      });
      if (!result.ok) {
        throw new Error('ECOS page coverage could not be loaded for this document.');
      }
      const summary = summarizeECOSDocumentCoverageRows(result.rows);
      documentCoverageSummaryCache.set(cacheKey, {
        expiresAt: Date.now() + DAVE_WEB_DOCUMENT_COVERAGE_CACHE_TTL_MS,
        summary,
      });
      return summary;
    },

    async loadAuthorizedDocumentProof(
      document: ReferenceDocument,
      claim: ECOSDocumentProofClaim,
    ): Promise<ECOSAuthorizedDocumentProof> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      await requireAuthorizedOwnerCached();
      return loadAuthorizedECOSDocumentProofBundle({ client, document, claim });
    },

    async runAuthorizedMaintenance(): Promise<void> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const userId = await requireAuthorizedOwnerCached();
      await Promise.all([
        processAuthorizedStorageCleanup(client, userId),
        purgeAuthorizedDeletionAudit(client),
      ]);
    },

    async createAuthorizedArtifactSignedUrl(
      bucket: DAVEWebStorageBucket,
      path: string,
      expiresInSeconds = 600,
      options: Readonly<{ preview?: boolean }> = {},
    ): Promise<string> {
      if (!client) throw new DAVEWebArtifactAccessError('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwnerCached();
      if (bucket !== 'project-photos' && bucket !== 'project-documents') {
        throw new DAVEWebArtifactAccessError('This project file type is not available in the desktop workspace.');
      }
      const safePath = safeArtifactStoragePath(path);
      const pathWasLoadedFromOwnerRecord =
        artifactPathOwnerId === ownerId &&
        (bucket === 'project-photos'
          ? authorizedPhotoPaths.has(safePath)
          : authorizedDocumentPaths.has(safePath));
      if (!safePath.startsWith(`${ownerId}/`) && !pathWasLoadedFromOwnerRecord) {
        throw new DAVEWebArtifactAccessError(
          'This project file does not have an owner-authorized storage path.',
        );
      }
      const lifetime = Math.min(900, Math.max(60, Math.floor(expiresInSeconds)));
      const storage = client.storage.from(bucket);
      const { data, error } = bucket === 'project-photos' && options.preview
        ? await storage.createSignedUrl(safePath, lifetime, {
            transform: {
              width: 960,
              quality: 72,
              resize: 'contain',
            },
          })
        : await storage.createSignedUrl(safePath, lifetime);
      const signedUrl = typeof data?.signedUrl === 'string' ? data.signedUrl.trim() : '';
      if (error || !signedUrl) {
        throw new DAVEWebArtifactAccessError(
          'The protected project file is temporarily unavailable. Refresh and try again.',
        );
      }
      return signedUrl;
    },

    async createAuthorizedScheduleItem(item: ScheduleItem): Promise<string> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwnerCached();
      const cloudUpdatedAt = new Date().toISOString();
      const { data, error } = await client
        .from('schedule_items')
        .insert(scheduleItemRow(item, ownerId, cloudUpdatedAt))
        .select('updated_at')
        .single();

      if (error || !data) {
        throw new DAVEWebTaskMutationError(
          'write_failed',
          'The task could not be created. Refresh the workspace and try again.',
        );
      }
      const acknowledgedAt = readCloudTimestamp(data) ?? cloudUpdatedAt;
      cacheAcknowledgedScheduleItem(item, ownerId, acknowledgedAt);
      return acknowledgedAt;
    },

    /**
     * The ids among `ids` that Restore Missing Tasks must leave alone: a task
     * row that still exists (a task of a schedule that is not current is in
     * the cloud but not on screen) or a deletion record. Restore had treated
     * every task the workspace does not show as missing: a deleted task came
     * back hidden behind its deletion record, and a hidden task's insert
     * failed and stopped the restore part-way (whole-app audit round 2 F8).
     */
    async listAuthorizedUnrestorableScheduleItemIds(
      ids: readonly string[],
    ): Promise<ReadonlySet<string>> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwnerCached();
      const requested = [...new Set(ids.map(id => id.trim()).filter(Boolean))];
      const unrestorable = new Set<string>();
      // 100 ids a request, as everywhere else: 200 made ~7.9 KB request
      // addresses, near what some proxies refuse (audit round 2 follow-up).
      for (const chunk of chunkSupabaseFilterValues(requested)) {
        const [existing, deleted] = await Promise.all([
          client
            .from('schedule_items')
            .select('id')
            .eq('owner_id', ownerId)
            .in('id', chunk),
          client
            .from('dave_sync_tombstones')
            .select('record_id')
            .eq('owner_id', ownerId)
            .eq('entity_type', 'schedule_item')
            .in('record_id', chunk),
        ]);
        if (existing.error || deleted.error) {
          throw new DAVEWebTaskMutationError(
            'write_failed',
            'The shared record could not be checked, so nothing was restored. Refresh the workspace and try again.',
          );
        }
        (existing.data ?? []).forEach(row => {
          const id = readRawString(row, 'id');
          if (id) unrestorable.add(id);
        });
        (deleted.data ?? []).forEach(row => {
          const id = readRawString(row, 'record_id');
          if (id) unrestorable.add(id);
        });
      }
      return unrestorable;
    },

    async updateAuthorizedScheduleItem(
      item: ScheduleItem,
      expectedCloudUpdatedAt: string | null,
    ): Promise<string> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      if (!expectedCloudUpdatedAt) {
        markBehindCloud('schedule_items');
        throw staleTaskError();
      }
      const ownerId = await requireAuthorizedOwnerCached();
      if (await scheduleItemWasDeleted(client, ownerId, item.id)) {
        markBehindCloud('schedule_items', 'sync_tombstones');
        throw new DAVEWebTaskMutationError(
          'deleted',
          'This task was deleted on another device. The workspace has been refreshed.',
        );
      }

      const cloudUpdatedAt = new Date().toISOString();
      const { data, error } = await client
        .from('schedule_items')
        .update(scheduleItemRow(item, ownerId, cloudUpdatedAt))
        .eq('owner_id', ownerId)
        .eq('id', item.id)
        .eq('updated_at', expectedCloudUpdatedAt)
        .select('updated_at')
        .maybeSingle();

      if (error) {
        throw new DAVEWebTaskMutationError(
          'write_failed',
          'The task could not be updated. Refresh the workspace and try again.',
        );
      }
      if (!data) {
        markBehindCloud('schedule_items');
        throw staleTaskError();
      }
      const acknowledgedAt = readCloudTimestamp(data) ?? cloudUpdatedAt;
      cacheAcknowledgedScheduleItem(item, ownerId, acknowledgedAt);
      return acknowledgedAt;
    },

    async deleteAuthorizedScheduleItem(
      itemId: string,
      expectedCloudUpdatedAt: string | null,
      /**
       * The saved hidden rows of the task's revision chain, recorded deleted
       * with it as the phone does (scheduleItemIdsDeletedWithTask, A10 pass 8 L3).
       */
      hiddenRowIds: readonly string[] = [],
    ): Promise<string> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      if (!expectedCloudUpdatedAt) {
        markBehindCloud('schedule_items');
        throw staleTaskError();
      }
      const ownerId = await requireAuthorizedOwnerCached();

      if (await scheduleItemWasDeleted(client, ownerId, itemId)) {
        return new Date().toISOString();
      }

      const { data: current, error: currentError } = await client
        .from('schedule_items')
        .select('updated_at')
        .eq('owner_id', ownerId)
        .eq('id', itemId)
        .maybeSingle();
      if (currentError) {
        throw new DAVEWebTaskMutationError(
          'write_failed',
          'The task could not be checked before deletion. Refresh and try again.',
        );
      }
      if (!current) {
        markBehindCloud('schedule_items');
        throw new DAVEWebTaskMutationError(
          'not_found',
          'This task no longer exists. The workspace has been refreshed.',
        );
      }
      if (readCloudTimestamp(current) !== expectedCloudUpdatedAt) {
        markBehindCloud('schedule_items');
        throw staleTaskError();
      }

      const deletedAt = new Date().toISOString();
      const markers = [...new Set([itemId, ...hiddenRowIds.map(id => id.trim()).filter(Boolean)])].map(recordId => ({
        owner_id: ownerId,
        entity_type: 'schedule_item',
        record_id: recordId,
        deleted_at: deletedAt,
      }));
      const { error } = await client
        .from('dave_sync_tombstones')
        .upsert(
          markers.length === 1 ? markers[0] : markers, // one write: the task and its hidden rows together
          { onConflict: 'owner_id,entity_type,record_id' },
        );
      if (error) {
        throw new DAVEWebTaskMutationError(
          'write_failed',
          'The task deletion marker could not be saved. Nothing was deleted.',
        );
      }
      return deletedAt;
    },

    async uploadAuthorizedReferenceDocument({
      document,
      bytes,
      file,
      scheduleItems = [],
      revisedScheduleItems = [],
      onProgress,
    }: DAVEWebDocumentUploadInput): Promise<string> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwnerCached();
      if (revisedScheduleItems.some(revision => !revision.cloudUpdatedAt)) {
        markBehindCloud('schedule_items');
        throw scheduleImportConflictError();
      }
      if (bytes.byteLength <= 0) {
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'The selected document data is no longer available. Choose the file again, then retry.',
        );
      }
      if (bytes.byteLength > DAVE_WEB_MAX_DOCUMENT_BYTES) {
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'The selected document is larger than 50 MB. Optimize or split it, then retry.',
        );
      }

      if (document.webFileFingerprint) {
        const existingRows = await readOwnerRows(
          client,
          'reference_documents',
          ownerId,
          query => query.order('updated_at', { ascending: false }),
        );
        const duplicate = existingRows.some(value => {
          const row = isRecord(value) ? value : {};
          const data = isRecord(row.document_data) ? row.document_data : {};
          return data.webFileFingerprint === document.webFileFingerprint;
        });
        if (duplicate) {
          throw new DAVEWebDocumentMutationError(
            'conflict',
            'This exact file is already in the project document library.',
          );
        }
      }

      const storagePath = `${ownerId}/web/${safePathSegment(document.id)}/${safePathSegment(document.originalFileName)}`;
      const uploadedDocument = { ...document, storagePath };
      const storage = client.storage.from('project-documents');
      const contentType = document.mimeType || 'application/octet-stream';
      if (bytes.byteLength > RESUMABLE_UPLOAD_THRESHOLD_BYTES) {
        const session = await client.auth.getSession();
        const accessToken = session.data.session?.access_token;
        if (!SUPABASE_URL || !accessToken) {
          throw new DAVEWebDocumentMutationError(
            'write_failed',
            'The secure upload session is unavailable. Sign in again, then retry.',
          );
        }
        try {
          await uploadWebFileResumably({
            projectUrl: SUPABASE_URL,
            accessToken,
            bucket: 'project-documents',
            path: storagePath,
            file: file ?? new Blob([bytes], { type: contentType }),
            contentSha256: document.contentSha256 || '',
            contentType,
            upsert: false,
            onProgress,
          });
        } catch {
          throw new DAVEWebDocumentMutationError(
            'write_failed',
            'The resumable upload did not finish. Your file is still selected; retry to continue.',
          );
        }
      } else {
        onProgress?.(0);
        const { error: uploadError } = await storage.upload(storagePath, bytes, {
          contentType,
          upsert: false,
        });
        if (uploadError) {
          throw new DAVEWebDocumentMutationError('write_failed', 'The file could not be uploaded to protected project storage.');
        }
        onProgress?.(1);
      }

      const cloudUpdatedAt = new Date().toISOString();
      const { error: documentError } = await client
        .from('reference_documents')
        .insert(referenceDocumentRow(uploadedDocument, ownerId, cloudUpdatedAt));
      if (documentError) {
        const { error: cleanupError } = await storage.remove([storagePath]);
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          cleanupError
            ? 'The document record could not be saved, and cleanup of the temporary cloud copy could not be confirmed. The original file on your computer was not changed. Refresh before retrying.'
            : 'The document record could not be saved. The temporary cloud copy was removed; the original file on your computer was not changed.',
        );
      }

      if (scheduleItems.length > 0 || revisedScheduleItems.length > 0) {
        const saved = await saveScheduleImportRows({
          client,
          ownerId,
          cloudUpdatedAt,
          additions: scheduleItems,
          revisions: revisedScheduleItems,
        });
        if (!saved.ok) {
          const compensation = await compensateFailedDocumentImport({
            client,
            storage,
            ownerId,
            documentId: document.id,
            cloudUpdatedAt,
            storagePath,
          });
          if (!compensation.visibilityRecovered || !saved.revertConfirmed) {
            throw new DAVEWebDocumentMutationError(
              'write_failed',
              'The schedule tasks could not be saved, and automatic cleanup could not be confirmed. Refresh before retrying and remove the incomplete document if it appears.',
            );
          }
          if (!compensation.storageFileRemoved) {
            throw new DAVEWebDocumentMutationError(
              'write_failed',
              'The schedule tasks could not be saved. The incomplete document was blocked, but file cleanup could not be confirmed. Refresh before retrying.',
            );
          }
          if (saved.stale) {
            markBehindCloud('schedule_items');
            throw scheduleImportConflictError();
          }
          throw new DAVEWebDocumentMutationError(
            'write_failed',
            'The schedule tasks could not be saved. The incomplete document import was rolled back and its file was removed.',
          );
        }
      }
      if (canonicalReferenceCategory(uploadedDocument) !== 'drawing') {
        await replaceECOSDocumentCloudIndex({
          client,
          document: uploadedDocument,
        });
      }
      await enqueueECOSHostedIndex({ client, documentId: uploadedDocument.id });
      return cloudUpdatedAt;
    },

    async saveAuthorizedLinkedReferenceDocument({
      document,
      bytes,
      file,
      onProgress,
    }: DAVEWebLinkedDocumentInput): Promise<string> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwnerCached();
      if (
        document.sourceProvider !== 'google_drive' ||
        !isGoogleDriveLinkedSource(document.externalSource)
      ) {
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'The Google Drive reference is incomplete. Select the file again.',
        );
      }
      const hostedDrawingPreparation = canonicalReferenceCategory(document) === 'drawing';
      if (!hostedDrawingPreparation && !document.extractedPages?.length) {
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'ECOS could not create a page index for this Google Drive PDF. Nothing was linked.',
        );
      }
      if (bytes.byteLength <= 0 || bytes.byteLength !== document.externalSource.sizeBytes) {
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'The selected Google Drive file changed after review. Choose it again before saving.',
        );
      }
      if (bytes.byteLength > GOOGLE_DRIVE_LINK_MAX_BYTES) {
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'This PDF is too large for protected background preparation. Optimize or split it, then retry.',
        );
      }

      if (document.webFileFingerprint) {
        const existingRows = await readOwnerRows(
          client,
          'reference_documents',
          ownerId,
          query => query.order('updated_at', { ascending: false }),
        );
        const duplicate = existingRows.some(value => {
          const row = isRecord(value) ? value : {};
          const data = isRecord(row.document_data) ? row.document_data : {};
          return data.webFileFingerprint === document.webFileFingerprint;
        });
        if (duplicate) {
          throw new DAVEWebDocumentMutationError(
            'conflict',
            'This exact file is already in the project document library.',
          );
        }
      }

      const storagePath = `${ownerId}/drive/${safePathSegment(document.id)}/${safePathSegment(document.originalFileName)}`;
      const storage = client.storage.from('project-documents');
      const contentType = document.mimeType || 'application/pdf';
      try {
        if (bytes.byteLength > RESUMABLE_UPLOAD_THRESHOLD_BYTES) {
          const session = await client.auth.getSession();
          const accessToken = session.data.session?.access_token;
          if (!SUPABASE_URL || !accessToken) {
            throw new Error('secure_upload_session_unavailable');
          }
          await uploadWebFileResumably({
            projectUrl: SUPABASE_URL,
            accessToken,
            bucket: 'project-documents',
            path: storagePath,
            file: file ?? new Blob([bytes], { type: contentType }),
            contentSha256: document.contentSha256 || '',
            contentType,
            upsert: false,
            onProgress,
          });
        } else {
          onProgress?.(0);
          const { error: uploadError } = await storage.upload(storagePath, bytes, {
            contentType,
            upsert: false,
          });
          if (uploadError) throw uploadError;
          onProgress?.(1);
        }
      } catch {
        await storage.remove([storagePath]);
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'Vitruvius could not save the protected processing copy. The original file in Drive was not changed.',
        );
      }

      const cloudUpdatedAt = new Date().toISOString();
      const linkedDocument = { ...document, storagePath };
      const { error: documentError } = await client
        .from('reference_documents')
        .insert(referenceDocumentRow(linkedDocument, ownerId, cloudUpdatedAt));
      if (documentError) {
        await storage.remove([storagePath]);
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'The Google Drive document reference could not be saved. Its temporary processing copy was removed; the original file in Drive was not changed.',
        );
      }

      if (!hostedDrawingPreparation) {
        const indexResult = await replaceECOSDocumentCloudIndex({
          client,
          document: linkedDocument,
        });
        if (indexResult.status !== 'saved') {
          const visibilityRecovered = await compensateFailedLinkedDocumentImport({
            client,
            ownerId,
            documentId: document.id,
            cloudUpdatedAt,
          });
          const cleanup = await storage.remove([storagePath]);
          throw new DAVEWebDocumentMutationError(
            'write_failed',
            visibilityRecovered && !cleanup.error
              ? `The Google Drive file was not linked because the ECOS search index could not be verified. ${indexResult.message || 'Try again shortly.'}`
              : 'The ECOS search index could not be verified, and automatic cleanup could not be confirmed. Refresh before retrying.',
          );
        }
      }
      await enqueueECOSHostedIndex({ client, documentId: linkedDocument.id });
      return cloudUpdatedAt;
    },

    async uploadAuthorizedTaskPhoto({
      task,
      bytes,
      fileName,
      mimeType,
    }: DAVEWebTaskPhotoUploadInput): Promise<string> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwnerCached();
      if (bytes.byteLength <= 0 || bytes.byteLength > MAX_PHOTO_SOURCE_BYTES) {
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'The photo must be between 1 byte and 12 MB.',
        );
      }
      if (!mimeType.trim().toLowerCase().startsWith('image/')) {
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'Choose an image file to add to this task.',
        );
      }

      const createdAt = new Date().toISOString();
      const updateId = createWebMutationId('web-task-update');
      const photoId = createWebMutationId('web-task-photo');
      const projectName = (
        task.scheduleProjectName ||
        task.projectName ||
        'Unassigned Project'
      ).trim();
      const areaName = task.locationName?.trim() || null;
      const storagePath = [
        ownerId,
        'web-updates',
        safePathSegment(updateId),
        `${safePathSegment(photoId)}-${safePathSegment(fileName || 'task-photo')}`,
      ].join('/');
      const photo: UpdatePhoto = {
        id: photoId,
        uri: '',
        caption: task.taskName,
        category: 'Update',
        actionRequired: '',
        actionOwner: task.owner || '',
        actionDueDate: '',
        actionStatus: 'Open',
        fileName: fileName || 'task-photo',
        mimeType,
        cloudStoragePath: storagePath,
        selectedAreaId: null,
        selectedAreaName: areaName,
        photoIntelligence: null,
      };
      const update: ProjectUpdate = {
        id: updateId,
        projectName,
        date: createdAt,
        photos: [photo],
        notes: '',
        recipients: { contactIds: [] },
        scheduleItemId: task.id,
        scheduleTaskName: task.taskName,
        scheduleProjectName: projectName,
        selectedAreaId: null,
        selectedAreaName: areaName,
        pieStatus: 'not_started',
        status: 'sent',
      };
      const storage = client.storage.from('project-photos');
      const { error: uploadError } = await storage.upload(storagePath, bytes, {
        contentType: mimeType,
        upsert: false,
      });
      if (uploadError) {
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'The task photo could not be uploaded to protected project storage.',
        );
      }

      const { error: updateError } = await client
        .from('project_updates')
        .insert({
          id: updateId,
          owner_id: ownerId,
          project_name: projectName,
          area_name: areaName,
          idempotency_key: updateId,
          update_data: update,
          updated_at: createdAt,
        });
      if (updateError) {
        await storage.remove([storagePath]);
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'The task photo record could not be saved. The uploaded file was removed.',
        );
      }

      authorizedPhotoPaths.add(storagePath);
      return updateId;
    },

    async setAuthorizedCurrentSchedule(
      selected: ReferenceDocument & DAVEWebDocumentExtension & { cloudUpdatedAt?: string | null },
      scheduleDocuments: readonly (ReferenceDocument & DAVEWebDocumentExtension & { cloudUpdatedAt?: string | null })[],
    ): Promise<ScheduleRetirementScope> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwnerCached();
      // The activation's response says how the cloud retired other schedules (owner answer Q15).
      return setAuthorizedCurrentReferenceDocument({
        client,
        ownerId,
        selected,
        documents: scheduleDocuments,
        subject: 'schedule',
      });
    },

    async setAuthorizedCurrentDocument(
      selected: DAVEWebRevisionedReferenceDocument,
      documents: readonly DAVEWebRevisionedReferenceDocument[],
    ): Promise<void> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwnerCached();
      await setAuthorizedCurrentReferenceDocument({
        client,
        ownerId,
        selected,
        documents,
        subject: 'document',
      });
    },

    async updateAuthorizedReferenceDocument(
      document: DAVEWebRevisionedReferenceDocument,
    ): Promise<string> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      if (!document.cloudUpdatedAt) throw staleDocumentError();
      const ownerId = await requireAuthorizedOwnerCached();
      const updatedAt = new Date().toISOString();
      // document_data.updatedAt moves with updated_at: the phone ranks the
      // cloud copy by it, so an older offline phone edit cannot overwrite
      // this one (whole-app audit A8 pass 1 F1 (30 Sep 2026)).
      const { data, error } = await client
        .from('reference_documents')
        .update(referenceDocumentRow({ ...document, updatedAt }, ownerId, updatedAt))
        .eq('owner_id', ownerId)
        .eq('id', document.id)
        .eq('updated_at', document.cloudUpdatedAt)
        .select('updated_at')
        .maybeSingle();
      if (error || !data) throw staleDocumentError();
      if (canonicalReferenceCategory(document) !== 'drawing') {
        await replaceECOSDocumentCloudIndex({ client, document });
      }
      await enqueueECOSHostedIndex({ client, documentId: document.id });
      return readCloudTimestamp(data) || updatedAt;
    },

    async enqueueAuthorizedDocumentPreparation(documentId: string): Promise<void> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      await requireAuthorizedOwnerCached();
      const result = await enqueueECOSHostedIndex({ client, documentId });
      if (result.status !== 'queued') {
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          result.message || 'Vitruvius could not confirm background document preparation.',
        );
      }
    },

    /**
     * The owner's shared "since the last report" period for these projects
     * and format, as the phone and the iPad keep it (owner answer Q16): the
     * stored snapshot, null when there is none yet, with the account it was
     * read for. 'unavailable' before the report_snapshots table exists;
     * throws when it could not be read. Everyday item 3 read it; since owner
     * answer 2 Oct (web sends count) the web writes it too
     * (saveAuthorizedReportPeriod).
     */
    async loadAuthorizedReportPeriod(
      scopeKey: string,
      format: string,
    ): Promise<Readonly<{ ownerId: string; snapshot: unknown }> | 'unavailable'> {
      if (!client) return 'unavailable';
      const ownerId = await requireAuthorizedOwnerCached();
      const { data, error } = await client
        .from('report_snapshots')
        .select('snapshot')
        .eq('owner_id', ownerId)
        .eq('scope_key', scopeKey)
        .eq('format', format)
        .maybeSingle();
      if (error) {
        const message = (error.message || '').toLowerCase();
        // Only a missing table is quiet, as on the phone (SupabaseService.isMissingTableError).
        if (message.includes('could not find the table') || (message.includes('relation') && message.includes('does not exist'))) {
          return 'unavailable';
        }
        throw new Error('The shared report period could not be read.');
      }
      return Object.freeze({ ownerId, snapshot: isRecord(data) ? data.snapshot ?? null : null });
    },

    /**
     * Owner answer 2 Oct (web sends count): a report approved or sent from
     * this computer goes into the owner's shared period, exactly as the
     * phone's does (SupabaseService.saveReportSnapshotCloud): one row per
     * owner, projects and format, the later send kept by the table's own
     * rule. With `expectedOwnerId`, nothing is written once another account
     * is signed in. 'unavailable' before the report_snapshots table exists
     * (this computer then keeps its own period only).
     */
    async saveAuthorizedReportPeriod(row: Readonly<{
      scopeKey: string;
      format: string;
      snapshot: unknown;
      approvedAt: string;
      deliveredAt: string | null;
      expectedOwnerId?: string;
    }>): Promise<'saved' | 'unavailable'> {
      if (!client) return 'unavailable';
      const ownerId = await requireAuthorizedOwnerCached();
      if (row.expectedOwnerId && row.expectedOwnerId !== ownerId) {
        throw new Error('The signed-in account changed before the report period was shared.');
      }
      const { error } = await client
        .from('report_snapshots')
        .upsert(
          {
            owner_id: ownerId,
            scope_key: row.scopeKey,
            format: row.format,
            snapshot: row.snapshot,
            approved_at: row.approvedAt,
            delivered_at: row.deliveredAt,
          },
          { onConflict: 'owner_id,scope_key,format' },
        );
      if (error) {
        const message = (error.message || '').toLowerCase();
        if (message.includes('could not find the table') || (message.includes('relation') && message.includes('does not exist'))) {
          return 'unavailable';
        }
        throw new Error('The shared report period could not be saved.');
      }
      return 'saved';
    },

    /** The signed-in owner's id, for this computer's own copy of the report periods (owner answer 2 Oct). */
    async authorizedOwnerId(): Promise<string> {
      return requireAuthorizedOwnerCached();
    },

    async saveAuthorizedReportArtifact({
      id,
      projectName,
      report,
      expectedCloudUpdatedAt = null,
    }: {
      id: string;
      projectName: string | null;
      report: DAVEWebReportRecord;
      expectedCloudUpdatedAt?: string | null;
    }): Promise<string> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      const ownerId = await requireAuthorizedOwnerCached();
      const updatedAt = new Date().toISOString();
      const document: ReferenceDocument & DAVEWebDocumentExtension = {
        id,
        name: report.title,
        originalFileName: `${safePathSegment(report.title)}.md`,
        uri: '',
        mimeType: 'text/markdown',
        category: 'Report',
        notes: report.status === 'approved' ? 'Approved project report' : 'Project report draft',
        isCurrent: report.status === 'approved',
        importedAt: report.generatedAt,
        projectId: null,
        projectName,
        importBatchId: null,
        webVersionGroupId: `report:${projectName || 'portfolio'}`,
        webReport: report,
      };
      let query = client.from('reference_documents');
      if (expectedCloudUpdatedAt) {
        const result = await query
          .update(referenceDocumentRow(document, ownerId, updatedAt))
          .eq('owner_id', ownerId)
          .eq('id', id)
          .eq('updated_at', expectedCloudUpdatedAt)
          .select('updated_at')
          .maybeSingle();
        if (result.error || !result.data) throw staleDocumentError();
        return readCloudTimestamp(result.data) || updatedAt;
      }
      const { data, error } = await query
        .insert(referenceDocumentRow(document, ownerId, updatedAt))
        .select('updated_at')
        .single();
      if (error || !data) throw new DAVEWebDocumentMutationError('write_failed', 'The report artifact could not be saved.');
      return readCloudTimestamp(data) || updatedAt;
    },

    async deleteAuthorizedReferenceDocument(
      documentId: string,
      expectedCloudUpdatedAt: string | null,
      linkedScheduleItems: readonly Readonly<{ id: string; cloudUpdatedAt: string | null }>[] = [],
      /**
       * The saved tasks shown that answer to a removed task from now on
       * (planDAVEWebScheduleDocumentDelete, A10 pass 8 M1): saved before the
       * deletion records, each only while its cloud revision matches.
       */
      answeringScheduleItems: readonly DAVEWebScheduleImportRevision[] = [],
    ): Promise<string> {
      if (!client) throw new Error('The desktop cloud connection is not configured.');
      if (!expectedCloudUpdatedAt) throw staleDocumentError();
      const ownerId = await requireAuthorizedOwnerCached();

      if (await recordWasDeleted(client, ownerId, 'reference_document', documentId)) {
        return new Date().toISOString();
      }

      const { data: current, error: currentError } = await client
        .from('reference_documents')
        .select('updated_at')
        .eq('owner_id', ownerId)
        .eq('id', documentId)
        .maybeSingle();
      if (currentError) {
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'The document could not be checked before deletion. Refresh and try again.',
        );
      }
      if (!current) {
        throw new DAVEWebDocumentMutationError(
          'not_found',
          'This document no longer exists. The workspace has been refreshed.',
        );
      }
      if (readCloudTimestamp(current) !== expectedCloudUpdatedAt) throw staleDocumentError();

      const requestedTaskRevisions = new Map<string, string | null>();
      linkedScheduleItems.forEach(item => {
        const id = item.id.trim();
        if (id) requestedTaskRevisions.set(id, item.cloudUpdatedAt);
      });
      const requestedTaskIds = [...requestedTaskRevisions.keys()];
      if (requestedTaskIds.length > 0) {
        const { data: ownedTasks, error: ownedTasksError } = await client
          .from('schedule_items')
          .select('id,updated_at')
          .eq('owner_id', ownerId)
          .in('id', requestedTaskIds);
        const ownedRevisions = new Map(
          (ownedTasks ?? [])
            .map(row => [
              typeof row?.id === 'string' ? row.id : '',
              readCloudTimestamp(row),
            ] as const)
            .filter(([id]) => Boolean(id)),
        );
        if (
          ownedTasksError ||
          requestedTaskIds.some(id => (
            !requestedTaskRevisions.get(id) ||
            ownedRevisions.get(id) !== requestedTaskRevisions.get(id)
          ))
        ) {
          throw new DAVEWebDocumentMutationError(
            'conflict',
            'The document task links changed on another device. Refresh and review them before deleting.',
          );
        }
      }

      const deletedAt = new Date().toISOString();
      if (answeringScheduleItems.length > 0) {
        // A task a new master moved answers to its removed row before the row is recorded deleted (A10 pass 8 M1).
        const linksChanged = () => new DAVEWebDocumentMutationError(
          'conflict',
          'The document task links changed on another device. Refresh and review them before deleting.',
        );
        const answeringIds = answeringScheduleItems.map(revision => revision.item.id);
        const { data: deletedRows, error: deletedError } = await client
          .from('dave_sync_tombstones')
          .select('record_id')
          .eq('owner_id', ownerId)
          .eq('entity_type', 'schedule_item')
          .in('record_id', answeringIds);
        if (deletedError) {
          throw new DAVEWebDocumentMutationError(
            'write_failed',
            'The document task links could not be checked before deletion. Refresh and try again.',
          );
        }
        if (
          (deletedRows ?? []).length > 0 ||
          answeringScheduleItems.some(revision => !revision.cloudUpdatedAt)
        ) {
          markBehindCloud('schedule_items', 'sync_tombstones');
          throw linksChanged();
        }
        const saved = await saveScheduleImportRows({
          client,
          ownerId,
          cloudUpdatedAt: deletedAt,
          additions: [],
          revisions: answeringScheduleItems,
        });
        // The next refresh reads the tasks again, the rows saved here included.
        markBehindCloud('schedule_items');
        if (!saved.ok) {
          if (saved.stale && saved.revertConfirmed) throw linksChanged();
          throw new DAVEWebDocumentMutationError(
            'write_failed',
            saved.revertConfirmed
              ? 'The document task links could not be saved. Nothing was deleted.'
              : 'The document task links could not be saved, and their cleanup could not be confirmed. Nothing was deleted; refresh before retrying.',
          );
        }
      }
      const deletionMarkers = [
        {
          owner_id: ownerId,
          entity_type: 'reference_document',
          record_id: documentId,
          deleted_at: deletedAt,
        },
        ...requestedTaskIds.map(recordId => ({
          owner_id: ownerId,
          entity_type: 'schedule_item',
          record_id: recordId,
          deleted_at: deletedAt,
        })),
      ];
      const { error } = await client
        .from('dave_sync_tombstones')
        .upsert(deletionMarkers, { onConflict: 'owner_id,entity_type,record_id' });
      if (error) {
        throw new DAVEWebDocumentMutationError(
          'write_failed',
          'The document deletion marker could not be saved. Nothing was deleted.',
        );
      }
      void processAuthorizedStorageCleanup(client, ownerId).catch(() => undefined);
      return deletedAt;
    },
  });
}

function applyDAVEWebRealtimeRows(
  rows: DAVEWebRawRows,
  entity: DAVEOperationalRealtimeEntity,
  payload: DAVEOperationalRealtimePayload,
): Readonly<{
  rows: DAVEWebRawRows;
  collections: readonly DAVEOperationalCollectionName[];
}> | null {
  const candidate = payload.eventType === 'DELETE'
    ? payload.oldRow
    : payload.newRow;
  if (!candidate) return null;

  if (entity === 'sync_tombstone') {
    const entityType = typeof candidate.entity_type === 'string'
      ? candidate.entity_type
      : '';
    const recordId = typeof candidate.record_id === 'string'
      ? candidate.record_id
      : '';
    if (!entityType || !recordId) return null;
    const collection = webCollectionForTombstoneEntity(entityType);
    const nextRows: {
      -readonly [Key in keyof DAVEWebRawRows]: DAVEWebRawRows[Key]
    } = {
      ...rows,
      syncTombstones: mergeRealtimeRows(
        rows.syncTombstones,
        candidate,
        payload.eventType,
        value => `${readRawString(value, 'entity_type')}:${readRawString(value, 'record_id')}`,
      ),
    };
    if (collection) {
      const property = webRowsProperty(collection);
      if (property) {
        nextRows[property] = removeRealtimeRow(
          nextRows[property],
          recordId,
          value => readRawString(value, 'id'),
        ) as never;
      }
    }
    return Object.freeze({
      rows: Object.freeze(nextRows),
      collections: Object.freeze([
        'sync_tombstones' as const,
        ...(collection ? [collection] : []),
      ]),
    });
  }

  const collection = daveWebCollectionForRealtimeEntity(entity);
  const property = collection ? webRowsProperty(collection) : null;
  const id = readRawString(candidate, 'id');
  if (!collection || !property || !id) return null;
  // An archived project row is kept with its flag, so the portfolio still
  // knows the name to keep out.
  const nextCollection = mergeRealtimeRows(
    rows[property],
    entity === 'reference_document' && payload.eventType !== 'DELETE'
      ? withHeldHostedIndexStatus(candidate, rows.referenceDocuments, id)
      : candidate,
    payload.eventType,
    value => readRawString(value, 'id'),
  );
  return Object.freeze({
    rows: Object.freeze({ ...rows, [property]: nextCollection }),
    collections: Object.freeze([collection]),
  });
}

/**
 * The live row's stored preparation status is missing or older than the one
 * the web read from the hosted indexer; the collection is then marked up to
 * date, so no refresh would correct it (whole-app audit round 2 F3).
 */
function withHeldHostedIndexStatus(
  candidate: Readonly<Record<string, unknown>>,
  heldRows: readonly unknown[],
  id: string,
): Readonly<Record<string, unknown>> {
  const held = heldRows.find(row => readRawString(row, 'id') === id);
  const incomingData = candidate.document_data;
  const heldData = isRecord(held) ? held.document_data : null;
  if (!isRecord(incomingData) || !isRecord(heldData)) return candidate;
  const documentData = carryECOSHostedIndexStatus(incomingData, heldData);
  return documentData === incomingData
    ? candidate
    : { ...candidate, document_data: documentData };
}

function daveWebCollectionForRealtimeEntity(
  entity: DAVEOperationalRealtimeEntity,
): DAVEOperationalCollectionName | null {
  switch (entity) {
    case 'project': return 'projects';
    case 'project_update': return 'project_updates';
    case 'schedule_item': return 'schedule_items';
    case 'reference_document': return 'reference_documents';
    case 'project_area':
    case 'sync_tombstone':
      return null;
  }
}

function webCollectionForTombstoneEntity(
  entityType: string,
): DAVEOperationalCollectionName | null {
  switch (entityType) {
    case 'project': return 'projects';
    case 'project_update': return 'project_updates';
    case 'schedule_item': return 'schedule_items';
    case 'reference_document': return 'reference_documents';
    default: return null;
  }
}

function webRowsProperty(
  collection: DAVEOperationalCollectionName,
): keyof DAVEWebRawRows | null {
  switch (collection) {
    case 'projects': return 'projects';
    case 'project_updates': return 'projectUpdates';
    case 'schedule_items': return 'scheduleItems';
    case 'reference_documents': return 'referenceDocuments';
    case 'sync_tombstones': return 'syncTombstones';
    case 'project_areas': return null;
  }
}

function mergeRealtimeRows(
  rows: readonly unknown[],
  candidate: Readonly<Record<string, unknown>>,
  eventType: DAVEOperationalRealtimePayload['eventType'],
  keyFor: (value: unknown) => string,
): readonly unknown[] {
  const key = keyFor(candidate);
  if (!key) return rows;
  if (eventType === 'DELETE') return removeRealtimeRow(rows, key, keyFor);
  const next = [...rows];
  const index = next.findIndex(value => keyFor(value) === key);
  if (index >= 0) next[index] = candidate;
  else next.unshift(candidate);
  return Object.freeze(next);
}

function removeRealtimeRow(
  rows: readonly unknown[],
  key: string,
  keyFor: (value: unknown) => string,
): readonly unknown[] {
  const next = rows.filter(value => keyFor(value) !== key);
  return next.length === rows.length ? rows : Object.freeze(next);
}

function readRawString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate.trim() : '';
}

export const daveWebSupabaseGateway = createDAVEWebSupabaseGateway(browserClient);

async function processAuthorizedStorageCleanup(
  client: SupabaseClient,
  ownerId: string,
  limit = 100,
): Promise<void> {
  const { data, error } = await client
    .from('dave_storage_cleanup_intents')
    .select('id,bucket_id,object_path,status,attempt_count')
    .eq('owner_id', ownerId)
    .in('status', ['pending', 'failed'])
    .order('updated_at', { ascending: true })
    .limit(Math.max(1, Math.min(100, Math.floor(limit))));
  if (error) return;

  for (const value of data ?? []) {
    const row: Record<string, unknown> = isRecord(value) ? value : {};
    const id = typeof row.id === 'string' ? row.id : '';
    const bucket =
      row.bucket_id === 'project-photos' ||
      row.bucket_id === 'project-documents'
        ? row.bucket_id
        : null;
    const objectPath =
      typeof row.object_path === 'string' ? row.object_path.trim() : '';
    const attemptCount =
      typeof row.attempt_count === 'number' &&
      Number.isFinite(row.attempt_count)
        ? Math.max(0, Math.floor(row.attempt_count))
        : 0;
    if (!id || !bucket || !objectPath) continue;

    const removed = await client.storage.from(bucket).remove([objectPath]);
    const completed = !removed.error;
    const updatedAt = new Date().toISOString();
    await client
      .from('dave_storage_cleanup_intents')
      .update({
        status: completed ? 'completed' : 'failed',
        attempt_count: attemptCount + 1,
        last_error: completed
          ? null
          : 'A deleted project file is waiting for protected cloud cleanup.',
        updated_at: updatedAt,
        completed_at: completed ? updatedAt : null,
      })
      .eq('owner_id', ownerId)
      .eq('id', id)
      .in('status', ['pending', 'failed']);
  }
}

async function purgeAuthorizedDeletionAudit(
  client: SupabaseClient,
): Promise<void> {
  const { error } = await client.rpc('dave_purge_expired_deletion_audit');
  if (error) throw new Error('Deletion receipt retention is temporarily unavailable.');
}

/**
 * Writes a schedule import's tasks (whole-app audit A5 pass 3 F5, 30 Sep
 * 2026), and the tasks a schedule's delete changes before its deletion
 * records (A10 pass 8 M1, no new rows). Each saved task the import changes (planDAVEWebScheduleImport) is
 * updated only while its cloud revision is the one the web read, the guard
 * updateAuthorizedScheduleItem uses; then the new rows are inserted, never
 * upserted over a saved task. On any failure the saved tasks already changed
 * are written back (again only while no one else has changed them), so the
 * caller can roll the document back and ask for a refresh.
 */
async function saveScheduleImportRows({
  client,
  ownerId,
  cloudUpdatedAt,
  additions,
  revisions,
}: {
  client: SupabaseClient;
  ownerId: string;
  cloudUpdatedAt: string;
  additions: readonly ScheduleItem[];
  revisions: readonly DAVEWebScheduleImportRevision[];
}): Promise<Readonly<{ ok: true } | { ok: false; stale: boolean; revertConfirmed: boolean }>> {
  const applied: { item: ScheduleItem; acknowledgedAt: string }[] = [];
  let failure: 'stale' | 'write_failed' | null = null;
  for (const revision of revisions) {
    try {
      const { data, error } = await client
        .from('schedule_items')
        .update(scheduleItemRow(revision.item, ownerId, cloudUpdatedAt))
        .eq('owner_id', ownerId)
        .eq('id', revision.item.id)
        .eq('updated_at', revision.cloudUpdatedAt)
        .select('updated_at')
        .maybeSingle();
      if (error) failure = 'write_failed';
      else if (!data) failure = 'stale';
      else applied.push({ item: revision.previous, acknowledgedAt: readCloudTimestamp(data) ?? cloudUpdatedAt });
    } catch {
      failure = 'write_failed';
    }
    if (failure) break;
  }
  if (!failure && additions.length > 0) {
    try {
      const { error } = await client
        .from('schedule_items')
        .insert(additions.map(item => scheduleItemRow(item, ownerId, cloudUpdatedAt)));
      if (error) failure = 'write_failed';
    } catch {
      failure = 'write_failed';
    }
  }
  if (!failure) return Object.freeze({ ok: true });

  let revertConfirmed = true;
  const revertedAt = new Date().toISOString();
  for (const { item, acknowledgedAt } of applied.reverse()) {
    try {
      const { data, error } = await client
        .from('schedule_items')
        .update(scheduleItemRow(item, ownerId, revertedAt))
        .eq('owner_id', ownerId)
        .eq('id', item.id)
        .eq('updated_at', acknowledgedAt)
        .select('updated_at')
        .maybeSingle();
      if (error || !data) revertConfirmed = false;
    } catch {
      revertConfirmed = false;
    }
  }
  return Object.freeze({ ok: false, stale: failure === 'stale', revertConfirmed });
}

async function compensateFailedDocumentImport({
  client,
  storage,
  ownerId,
  documentId,
  cloudUpdatedAt,
  storagePath,
}: {
  client: SupabaseClient;
  storage: ReturnType<SupabaseClient['storage']['from']>;
  ownerId: string;
  documentId: string;
  cloudUpdatedAt: string;
  storagePath: string;
}): Promise<Readonly<{
  visibilityRecovered: boolean;
  storageFileRemoved: boolean;
}>> {
  const deletedAt = new Date().toISOString();
  let tombstoneSaved = false;
  let documentRowRemoved = false;
  let storageFileRemoved = false;
  try {
    const { error } = await client
      .from('dave_sync_tombstones')
      .upsert(
        {
          owner_id: ownerId,
          entity_type: 'reference_document',
          record_id: documentId,
          deleted_at: deletedAt,
        },
        { onConflict: 'owner_id,entity_type,record_id' },
      );
    tombstoneSaved = !error;
  } catch {
    tombstoneSaved = false;
  }

  try {
    const { data, error } = await client
      .from('reference_documents')
      .delete()
      .eq('owner_id', ownerId)
      .eq('id', documentId)
      .eq('updated_at', cloudUpdatedAt)
      .select('id')
      .maybeSingle();
    documentRowRemoved = !error && Boolean(data);
  } catch {
    documentRowRemoved = false;
  }

  try {
    const { error } = await storage.remove([storagePath]);
    storageFileRemoved = !error;
  } catch {
    storageFileRemoved = false;
  }
  return Object.freeze({
    visibilityRecovered: tombstoneSaved || documentRowRemoved,
    storageFileRemoved,
  });
}

async function compensateFailedLinkedDocumentImport({
  client,
  ownerId,
  documentId,
  cloudUpdatedAt,
}: {
  client: SupabaseClient;
  ownerId: string;
  documentId: string;
  cloudUpdatedAt: string;
}): Promise<boolean> {
  const deletedAt = new Date().toISOString();
  let tombstoneSaved = false;
  let documentRowRemoved = false;
  try {
    const { error } = await client
      .from('dave_sync_tombstones')
      .upsert(
        {
          owner_id: ownerId,
          entity_type: 'reference_document',
          record_id: documentId,
          deleted_at: deletedAt,
        },
        { onConflict: 'owner_id,entity_type,record_id' },
      );
    tombstoneSaved = !error;
  } catch {
    tombstoneSaved = false;
  }
  try {
    const { data, error } = await client
      .from('reference_documents')
      .delete()
      .eq('owner_id', ownerId)
      .eq('id', documentId)
      .eq('updated_at', cloudUpdatedAt)
      .select('id')
      .maybeSingle();
    documentRowRemoved = !error && Boolean(data);
  } catch {
    documentRowRemoved = false;
  }
  return tombstoneSaved || documentRowRemoved;
}

async function setAuthorizedCurrentReferenceDocument({
  client,
  ownerId,
  selected,
  documents,
  subject,
}: {
  client: SupabaseClient;
  ownerId: string;
  selected: DAVEWebRevisionedReferenceDocument;
  documents: readonly DAVEWebRevisionedReferenceDocument[];
  subject: 'schedule' | 'document';
}): Promise<ScheduleRetirementScope> {
  if (
    !selected.cloudUpdatedAt ||
    !documents.some(document => document.id === selected.id && document.cloudUpdatedAt === selected.cloudUpdatedAt)
  ) {
    throw staleDocumentError();
  }
  // Owner authorization remains the web pilot boundary. The actual family
  // mutation is one authenticated database transaction, which prevents two
  // clients from independently leaving two revisions current.
  if (!ownerId) throw staleDocumentError();
  const result = await activateECOSCurrentReferenceDocument({
    client,
    documentId: selected.id,
    expectedUpdatedAt: selected.cloudUpdatedAt,
  });
  if (result.status === 'activated') return result.scheduleRetirementScope ?? 'schedule';
  if (result.status === 'not_prepared') {
    throw new DAVEWebDocumentMutationError(
      'write_failed',
      result.message || `This ${subject} must finish ECOS preparation before it can be made current.`,
    );
  }
  if (result.status === 'conflict') {
    throw new DAVEWebDocumentMutationError(
      'conflict',
      result.message || `The current ${subject} could not be changed because the shared record changed first. Refresh and try again.`,
    );
  }
  throw new DAVEWebDocumentMutationError(
    'write_failed',
    result.message || `The current ${subject} could not be changed. Try again shortly.`,
  );
}

/**
 * Audit A12 F2 (owner answer Q21, 30 Sep 2026): the web signs itself out only
 * on a definite answer: the owner check says false or 401/403, or the sign-in
 * check says the session is missing or 401/403. A check that could not finish
 * (timeout 57014, a 5xx, no network) used to sign out too; it now throws a
 * plain Error, so the workspace stays and says automatic refresh is waiting.
 * Nothing is read until a check returns true.
 */
async function requireAuthorizedOwner(client: SupabaseClient): Promise<string> {
  const { data: userResult, error: userError } = await client.auth.getUser();
  const userId = userResult.user?.id ?? null;
  if (userError && !isAuthSessionMissingError(userError) && !isRefusalStatus(userError.status)) {
    throw ownerCheckIncomplete();
  }
  if (userError || !userId) {
    throw new DAVEWebAuthorizationError('Sign in is required for the Vitruvius desktop pilot.');
  }

  const { data: authorized, error: authorizationError, status } = await client.rpc('dave_is_app_owner');
  if (!authorizationError && authorized === true) return userId;
  if ((!authorizationError && authorized === false) || isRefusalStatus(status)) {
    throw new DAVEWebAuthorizationError();
  }
  throw ownerCheckIncomplete();
}

function isRefusalStatus(status: unknown): boolean {
  return status === 401 || status === 403;
}

function ownerCheckIncomplete(): Error {
  return new Error('The owner check could not be completed. Try again shortly.');
}

function scheduleItemRow(item: ScheduleItem, ownerId: string, updatedAt: string) {
  return {
    id: item.id,
    owner_id: ownerId,
    project_id: item.projectId,
    project_name: item.projectName,
    task_name: item.taskName,
    item_data: item,
    updated_at: updatedAt,
  };
}

function referenceDocumentRow(
  document: ReferenceDocument & DAVEWebDocumentExtension,
  ownerId: string,
  updatedAt: string,
) {
  const compactDocument = document.sourceProvider === 'google_drive'
    ? compactECOSDocumentMetadataForCloud(document)
    : compactECOSDocumentIndexForCloud(document);
  const {
    cloudUpdatedAt: _cloudUpdatedAt,
    cloudDetailsSeen: _cloudDetailsSeen,
    linkedScheduleItems: _linkedScheduleItems,
    importedScheduleItemCount: _importedScheduleItemCount,
    ...documentData
  } = compactDocument as any;
  return {
    id: document.id,
    owner_id: ownerId,
    name: document.name,
    category: document.category,
    document_data: documentData,
    updated_at: updatedAt,
  };
}

function safePathSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
}

function createWebMutationId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${randomId}`;
}

function safeArtifactStoragePath(value: string): string {
  const path = value.trim();
  if (
    !path ||
    path.startsWith('/') ||
    /^[a-z][a-z0-9+.-]*:/i.test(path) ||
    path.includes('\\') ||
    path.split('/').some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new DAVEWebArtifactAccessError(
      'This project file does not have an owner-authorized storage path.',
    );
  }
  return path;
}

function collectOwnerPhotoStoragePaths(rows: readonly unknown[]): Set<string> {
  const paths = new Set<string>();
  rows.forEach(row => {
    if (!isRecord(row)) return;
    const updateData = isRecord(row.update_data) ? row.update_data : row;
    const photos = Array.isArray(updateData.photos) ? updateData.photos : [];
    photos.forEach(photo => {
      if (!isRecord(photo) || typeof photo.cloudStoragePath !== 'string') return;
      const path = photo.cloudStoragePath.trim();
      if (path) paths.add(path);
    });
  });
  return paths;
}

function collectOwnerDocumentStoragePaths(rows: readonly unknown[]): Set<string> {
  const paths = new Set<string>();
  rows.forEach(row => {
    if (!isRecord(row)) return;
    const documentData = isRecord(row.document_data) ? row.document_data : row;
    if (typeof documentData.storagePath !== 'string') return;
    const path = documentData.storagePath.trim();
    if (path) paths.add(path);
  });
  return paths;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function scheduleItemWasDeleted(
  client: SupabaseClient,
  ownerId: string,
  itemId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('dave_sync_tombstones')
    .select('deleted_at')
    .eq('owner_id', ownerId)
    .eq('entity_type', 'schedule_item')
    .eq('record_id', itemId)
    .maybeSingle();
  if (error) {
    throw new DAVEWebTaskMutationError(
      'write_failed',
      'Deletion history could not be checked. Refresh the workspace and try again.',
    );
  }
  return Boolean(data);
}

async function recordWasDeleted(
  client: SupabaseClient,
  ownerId: string,
  entityType: 'reference_document',
  recordId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('dave_sync_tombstones')
    .select('deleted_at')
    .eq('owner_id', ownerId)
    .eq('entity_type', entityType)
    .eq('record_id', recordId)
    .maybeSingle();
  if (error) {
    throw new DAVEWebDocumentMutationError(
      'write_failed',
      'Document deletion history could not be checked. Refresh and try again.',
    );
  }
  return Boolean(data);
}

function readCloudTimestamp(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const updatedAt = (value as Record<string, unknown>).updated_at;
  return typeof updatedAt === 'string' && updatedAt.trim() ? updatedAt : null;
}

function staleTaskError() {
  return new DAVEWebTaskMutationError(
    'conflict',
    'This task changed on another device. The workspace has been refreshed; review the latest values before saving again.',
  );
}

function scheduleImportConflictError() {
  return new DAVEWebDocumentMutationError(
    'conflict',
    'A task in this schedule changed on another device, so the schedule was not imported. Refresh the workspace, then choose the schedule file again.',
  );
}

function staleDocumentError() {
  return new DAVEWebDocumentMutationError(
    'conflict',
    'This document changed on another device. The workspace has been refreshed; review the latest record before deleting.',
  );
}

async function readOwnerRows(
  client: SupabaseClient,
  table: string,
  ownerId: string,
  refine: (query: any) => any,
): Promise<readonly unknown[]> {
  const result = await paginateSupabaseCollection(({ from, to, includeExactCount }) => {
    const baseQuery = client
      .from(table)
      .select('*', { count: includeExactCount ? 'exact' : undefined })
      .eq('owner_id', ownerId);
    return refine(baseQuery).range(from, to);
  });

  if (!result.ok) throw new Error(`Authorized ${table.replace(/_/g, ' ')} could not be loaded.`);
  return Object.freeze([...result.rows]);
}

async function readAuthorizedReferenceDocumentMetadata(
  client: SupabaseClient,
): Promise<readonly unknown[]> {
  const { data, error } = await client.rpc('dave_list_reference_document_metadata');
  if (error || !Array.isArray(data)) {
    throw new Error('Authorized reference document metadata could not be loaded.');
  }
  return Object.freeze([...data]);
}
