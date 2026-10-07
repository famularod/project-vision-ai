import 'react-native-url-polyfill/auto';

import {
  isAuthStorageSecure,
  SUPABASE_AUTH_STORAGE_LABEL,
  supabaseSecureAuthStorage,
} from './SupabaseAuthStorage';
import { accountDisplayNameForMetadata } from './AccountProfile';
import { CLOUD_ACCOUNT_CHANGED, CLOUD_ACCOUNT_CHANGED_MESSAGE, CLOUD_REQUEST_ACCOUNT_HEADER, callAsCloudOwner, cloudOwnerExpectedForThisCall, currentCloudOwner, noteSignedInOwner } from './CloudOwnerBinding';
import { ownerWorkspaceAuthDecision } from './OwnerWorkspaceAuthDecision';
import { AppState } from 'react-native';
import {
  createClient,
  isAuthRefreshDiscardedError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type Session,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
import type {
  DAVESyncTombstone,
  ProjectArea,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import {
  confirmScheduleItemCloudAcknowledgement,
  describeScheduleItemAcknowledgementMismatch,
} from './ScheduleItemCloudAcknowledgement';
import type {
  PIEActor,
  PIEActualOutcomeRecord,
  PIEAuditEvent,
  PIEDecisionRecord,
  PIEDecisionVersion,
} from './PIEDecisionLedger';
import type {
  PIERealityModel,
  PIERealityObject,
} from './PIERealityModel';
import type { PIEExecutiveJudgmentRecord } from './PIEExecutiveJudgmentRepository';
import type { DAVEProjectTruthSnapshot } from './DAVEProjectTruthRepository';
import { bindDAVECloudDatabaseIdentity } from './DAVECloudRecovery';
import {
  applySupabaseKeysetPage,
  chunkSupabaseFilterValues,
  paginateSupabaseCollection,
  paginateSupabaseCollectionByKey,
  sortSupabaseRows,
  type SupabaseRowOrder,
} from './SupabaseCollectionPagination';
import { SCHEDULE_ITEM_ALREADY_IN_CLOUD } from './CloudListAbsenceCheck';
import { CLOUD_ROW_CHANGED_SINCE_READ, withCloudRowVersion } from './CloudRowVersion';
import {
  verifyPIERealityHistoryRows,
  type PIERealityHistoryCloudRow,
} from './PIERealityHistoryIntegrity';
import {
  FileSizePreflightError,
  hashExpoFileSha256,
  preflightExpoFileRead,
  prepareExpoFileUploadPayload,
} from './FileSizePreflight';
import {
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
  uploadFileResumably,
} from './ResumableStorageUpload';
import {
  attachDAVEOperationalRealtime,
  type DAVEOperationalCollectionName,
  type DAVEOperationalRealtimeEntity,
  type DAVEOperationalRealtimeStatus,
} from './DAVEOperationalRefresh';
import {
  compactECOSDocumentIndexForCloud,
  compactECOSReferenceDocumentsForOperationalRead,
} from './ECOSDocumentIndexPersistence';
import { replaceECOSDocumentCloudIndex } from './ECOSDocumentCloudIndex';
import {
  enqueueECOSHostedIndex,
  loadECOSHostedIndexStatuses,
} from './ECOSHostedIndexer';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SupabaseConfigurationStatus = {
  configured: boolean;
  urlConfigured: boolean;
  anonKeyConfigured: boolean;
  rawProjectUrl: string | null;
  projectUrl: string | null;
  createClientUrl: string | null;
  authStorage: typeof SUPABASE_AUTH_STORAGE_LABEL;
  message: string;
};

export type SupabaseConnectionStatus = SupabaseConfigurationStatus & {
  clientReady: boolean;
  authenticated: boolean;
  userEmail: string | null;
  checkedAt: string;
};

export type SupabaseConnectionTestResult = {
  configured: boolean;
  connected: boolean;
  projectCount: number | null;
  checkedAt: string;
  status?: number;
  error?: string;
};

export type SupabaseDiagnosticStep = {
  label: string;
  url: string;
  ok: boolean;
  reachedNetwork: boolean;
  status?: number;
  statusText?: string;
  responsePreview?: string;
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
};

export type SupabaseConnectionDiagnostics = {
  checkedAt: string;
  rawSupabaseUrl: string | null;
  supabaseUrl: string | null;
  createClientUrl: string | null;
  clientInitialized: boolean;
  rootFetch: SupabaseDiagnosticStep;
  restFetch: SupabaseDiagnosticStep;
};

export type SupabaseServiceResult<T> = {
  ok: boolean;
  configured: boolean;
  data: T | null;
  error?: string;
  message?: string;
  status?: number;
  code?: string;
  stubbed?: boolean;
};

export type SignInParams = {
  email: string;
  password: string;
};

export type SignUpParams = SignInParams;

export type AuthResult = {
  user: User | null;
  session: Session | null;
};

export type SupabaseSessionMissingReason =
  | 'auth_loading'
  | 'signed_out'
  | 'expired_session'
  | 'storage_unavailable'
  | 'client_mismatch'
  | 'unknown';

export type SupabaseAuthSessionState =
  | 'loading'
  | 'signed_in'
  | 'signed_out'
  | 'expired'
  | 'unknown';

export type SupabaseAppAuthMode =
  | 'supabase_authenticated'
  | 'local_only'
  | 'unknown';

export type SupabaseSessionTokenLookupResult = {
  status: 'token_present' | 'token_missing';
  accessToken: string | null;
  missingReason: SupabaseSessionMissingReason | null;
  authState: SupabaseAuthSessionState;
  appAuthMode: SupabaseAppAuthMode;
  authHydrationCompleted: boolean;
  storageAvailable: boolean;
  signInClientSource: string;
  tokenLookupClientSource: string;
  clientMismatch: boolean;
  supabaseUserIdPresent: boolean;
  sessionTokenPresent: boolean;
  lastAuthEvent: string;
  userId: string | null;
  userEmail: string | null;
  expiresAt: number | null;
  checkedAt: string;
};

export type CloudProject = {
  id?: string | null;
  name: string;
  status?: string | null;
  archived?: boolean | null;
  isFavorite?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  ownerId?: string | null;
  data?: JsonValue | null;
};

export type CreateProjectParams = {
  name: string;
  status?: string;
  archived?: boolean;
  isFavorite?: boolean;
  data?: JsonValue | null;
};

export type UpdateProjectParams = {
  id?: string;
  name?: string;
  previousName?: string;
  status?: string;
  archived?: boolean;
  isFavorite?: boolean;
  data?: JsonValue | null;
};

export type DeleteProjectParams = {
  name: string;
};

export type CloudProjectUpdate<TUpdate = JsonValue> = {
  id: string;
  projectId?: string | null;
  projectName: string;
  areaName: string;
  idempotencyKey?: string | null;
  updateData: TUpdate;
  createdAt?: string | null;
  updatedAt?: string | null;
  ownerId?: string | null;
};

export type SaveProjectUpdateParams<TUpdate> = {
  id: string;
  projectId: string;
  projectName: string;
  areaName?: string | null;
  idempotencyKey?: string | null;
  updateData: TUpdate;
  updatedAt?: string;
};

export type DeleteProjectUpdateParams = {
  id: string;
};

export type ProjectUpdateSyncMetadata<TUpdate = JsonValue> = {
  id: string;
  projectId: string | null;
  updatedAt: string | null;
  projectName: string | null;
  areaName: string | null;
  updateData: TUpdate | null;
};

export type UploadPhotoParams = {
  bucket?: string;
  path: string;
  uri: string;
  contentType?: string;
  upsert?: boolean;
  cacheControl?: string;
  reportedSizeBytes?: number | null;
  maxBytes?: number;
  onProgress?: (fraction: number) => void;
};

export type UploadedPhoto = {
  bucket: string;
  path: string;
  fullPath?: string | null;
};

export type DownloadPhotoParams = {
  bucket?: string;
  path: string;
};

export type CreatePhotoSignedUrlParams = {
  bucket?: string;
  path: string;
  expiresIn?: number;
};

export type DAVEStorageCleanupBucket =
  | 'project-photos'
  | 'project-documents';

export type DAVEStorageCleanupIntent = Readonly<{
  id: string;
  bucket: DAVEStorageCleanupBucket;
  objectPath: string;
  sourceEntityType: 'project' | 'project_update' | 'reference_document';
  sourceRecordId: string;
  status: 'pending' | 'completed' | 'failed';
  attemptCount: number;
  lastError: string | null;
  updatedAt: string | null;
}>;

const RAW_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_URL = RAW_SUPABASE_URL.trim();
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';
const PROJECTS_TABLE = 'projects';
const PROJECT_UPDATES_TABLE = 'project_updates';
const PROJECT_AREAS_TABLE = 'project_areas';
const SCHEDULE_ITEMS_TABLE = 'schedule_items';
const REFERENCE_DOCUMENTS_TABLE = 'reference_documents';
const DAVE_SYNC_TOMBSTONES_TABLE = 'dave_sync_tombstones';
const REPORT_SNAPSHOTS_TABLE = 'report_snapshots';
const DAVE_STORAGE_CLEANUP_INTENTS_TABLE = 'dave_storage_cleanup_intents';
const DAVE_PROJECT_TRUTH_SNAPSHOTS_TABLE = 'dave_project_truth_snapshots';
const PIE_DECISION_RECORDS_TABLE = 'pie_decision_records';
const PIE_DECISION_VERSIONS_TABLE = 'pie_decision_versions';
const PIE_DECISION_OUTCOMES_TABLE = 'pie_decision_outcomes';
const PIE_DECISION_AUDIT_EVENTS_TABLE = 'pie_decision_audit_events';
const PIE_REALITY_MODELS_TABLE = 'pie_reality_models';
const PIE_REALITY_OBJECTS_TABLE = 'pie_reality_objects';
const PIE_REALITY_ASSERTIONS_TABLE = 'pie_reality_assertions';
const PIE_REALITY_RELATIONSHIPS_TABLE = 'pie_reality_relationships';
const PIE_REALITY_OBJECT_HISTORY_TABLE = 'pie_reality_object_history';
const PIE_REALITY_MODEL_SNAPSHOTS_TABLE = 'pie_reality_model_snapshots';
const PIE_REALITY_CONFLICTS_TABLE = 'pie_reality_conflicts';
const PIE_REALITY_UNCERTAINTIES_TABLE = 'pie_reality_uncertainties';
const PIE_EXECUTIVE_JUDGMENTS_TABLE = 'pie_executive_judgments';
const PROJECT_PHOTOS_BUCKET = 'project-photos';
const SUPABASE_CLIENT_SOURCE = 'SupabaseService.singleton';
const AUTH_HYDRATION_WAIT_MS = 1500;
const AUTH_HYDRATION_POLL_MS = 50;
const AUTH_STORAGE_PROBE_KEY = 'projectVisionAI.supabaseAuthStorage.probe';

let authHydrationCompleted = false;
let lastSignInClientSource = SUPABASE_CLIENT_SOURCE;
let lastAuthEvent = 'UNKNOWN';
let authAutoRefreshSubscriptionStarted = false;

// Audit P0-14/P1-30: tokens live in SecureStore (Keychain/Keystore), never
// plain AsyncStorage. See services/SupabaseAuthStorage.ts.
const supabaseAuthStorage = supabaseSecureAuthStorage;
// supabase-js's own default key, named so this service can read the saved
// sign-in without the network (owner answer Q13).
const SUPABASE_AUTH_STORAGE_KEY = supabaseAuthStorageKey(SUPABASE_URL);
// Used when a saved session lacks expires_in; Supabase issues hourly tokens.
const DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 3600;
// auth-js refreshes a token this close to its expiry before using it
// (EXPIRY_MARGIN_MS), so Sign Out treats it as expired as early.
const SIGN_IN_EXPIRY_MARGIN_MS = 90_000;
/** SupabaseServiceResult.code of a Sign Out made on this device only, with no signal. */
export const SIGNED_OUT_ON_THIS_DEVICE_ONLY = 'signed_out_on_this_device_only';
/**
 * Owner answer Q21 (30 Sep 2026): Sign Out ends this device's sign-in only
 * ('local', the default) or every device's ('global', auth-js's own default).
 */
export type SignOutScope = 'local' | 'global';
/** SupabaseServiceResult.code of a Sign Out of All Devices that could not reach the cloud: nothing signed out. */
export const SIGN_OUT_OF_ALL_DEVICES_NEEDS_SIGNAL = 'sign_out_of_all_devices_needs_signal';
const SIGN_OUT_OF_ALL_DEVICES_NEEDS_SIGNAL_MESSAGE =
  'Signing out your other devices needs signal, and Vitruvius could not reach the cloud just now. Nothing was signed out.';
/**
 * Whole-app audit A1 pass 4 L2: the same code when the sign-in server
 * answered 5xx (an outage): there is signal, so "needs signal" was not why.
 */
const SIGN_OUT_OF_ALL_DEVICES_SERVER_NOT_ANSWERING_MESSAGE =
  'Signing out your other devices needs the sign-in server, and it isn\'t answering right now. ' +
  'Nothing was signed out. Try again in a few minutes.';
/**
 * SupabaseServiceResult.code of a Sign Out of All Devices whose sign-in the
 * server had already ended (its refresh was refused): this device is signed
 * out by that refusal; the other devices could not be signed out from here
 * (whole-app audit A1 pass 3 L1).
 */
export const SIGN_IN_ALREADY_ENDED_ON_SERVER = 'sign_in_already_ended_on_server';
const SIGN_IN_ALREADY_ENDED_ON_SERVER_MESSAGE =
  'This device\'s sign-in had already ended on the server, so this device is now signed out. ' +
  'Your other devices were not signed out from here. To sign them out, sign in again, then choose Sign Out of All Devices.';
/** How long the signal check waits for the project's auth server (A1 pass 3 L1). */
export const SIGNAL_CHECK_TIMEOUT_MS = 4_000;
/**
 * auth-js 2.108.2's REFRESH_FAILURE_COOLDOWN_MS: after a refresh gives up it
 * answers from that failure, without sending anything, for this long
 * (pinned in tests/app-offline-sign-in.test.tsx).
 */
const AUTH_REFRESH_FAILURE_COOLDOWN_MS = 60_000;
/**
 * With signal back, how long the sign-in may take to finish: auth-js's
 * cooldown, then its own ~30 seconds of retries (A1 pass 3 L1).
 */
const SIGNAL_BACK_REFRESH_WAIT_MS = AUTH_REFRESH_FAILURE_COOLDOWN_MS + 30_000;
const SIGNAL_BACK_POLL_MS = 1_000;
/**
 * A refresh request this wait sent may still answer after the wait is over;
 * it gets this long more (whole-app audit A1 pass 4 L1).
 */
const SENT_REFRESH_GRACE_MS = 5_000;
/**
 * Whole-app audit A1 pass 4 L1: whether the app is in the foreground. The
 * wait above counted wall-clock time, so two minutes in another app used it
 * up: Sign Out of All Devices then said it needed signal, with signal there,
 * and Retry on the 7-day lockout showed the lockout again before opening. It
 * now counts only polls made in the foreground, and asks nothing in the
 * background (iOS suspends the app there; the sign-in refreshes on return).
 * Unknown at launch counts as the foreground.
 */
let appInForeground = !['background', 'inactive'].includes(String(AppState.currentState));
/**
 * Whole-app audit A1 pass 5 L2: how many times the app has left the
 * foreground. A refresh request out while it did can fail on return for that
 * alone: auth-js does not retry it, its 30 seconds of retries having passed
 * on the wall clock meanwhile. That failure is no evidence of no signal.
 */
let appLeftForegroundCount = 0;

function createSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: supabaseAuthStorage,
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: { fetch: fetchObservingSignInRefresh },
  });
}

function supabaseAuthStorageKey(url: string): string | undefined {
  try {
    return url ? `sb-${new URL(url).hostname.split('.')[0]}-auth-token` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Owner answer Q13 (30 Sep 2026): whether the last sign-in refresh reached the
 * server. auth-js reports a refresh whose request failed at the network (or a
 * 5xx) as AuthRetryableFetchError and keeps the session; any other answer (400
 * invalid or revoked refresh token) removes the session and emits SIGNED_OUT.
 * It retries a network failure for about 25 seconds before saying so, and the
 * first failed request already settles it: no answer is no rejection.
 */
let lastSignInRefreshTransport: 'failed' | 'answered' | 'server_error' | null = null;
/**
 * Told as each refresh request ends without the sign-in: no answer
 * (network_unavailable), or, whole-app audit A1 pass 4 L2, a 5xx from the
 * sign-in server (server_unavailable). An auth-server outage (health
 * answering, the token endpoint 503) read as "Signal is back — finishing
 * sign-in…", then "No signal…".
 */
const signInRefreshFailureWaiters = new Set<(outcome: SavedSignInRefresh) => void>();
/**
 * Whole-app audit A1 pass 3 L1: after its retries auth-js answers "failed" from
 * its last failure for AUTH_REFRESH_FAILURE_COOLDOWN_MS, sending nothing. That
 * answer, or the failed attempt above, was taken for no signal even when
 * signal had returned: Retry on the 7-day lockout said "No signal" again, and
 * Sign Out of All Devices said it needed signal, with nothing sent. Counted
 * here: the refresh requests sent, those that got no answer, and when the
 * last one ended, so a caller can tell a request of its own that got no answer
 * from an earlier one.
 */
let signInRefreshRequestsSent = 0;
let signInRefreshRequestsUnanswered = 0;
let lastSignInRefreshEndedAtMs = 0;
/**
 * Whole-app audit A1 pass 2 #2: the refresh tokens of sign-ins a Sign Out
 * with no signal removed from this phone. auth-js's guard against saving a
 * refresh over a sign-out only notices its own sign-out, so a waiting retry
 * answered while the Keychain entries were going saved the session back and
 * reopened the workspace after "Signed out on this device". A refresh with
 * one of these tokens now ends as if there were no signal, even when the
 * answer arrives meanwhile: auth-js saves nothing.
 */
const refreshTokensSignedOutHere = new Set<string>();

/**
 * Sync batch Y4 (the account boundary; owner answer Q45). The last look before a request leaves: a request that
 * names one account as its owner (in its filter or in the row it writes) is never sent with another account's
 * sign-in. This is where a request the library tries again by itself is caught (it tries a failed read again a
 * second later, with whichever sign-in is there by then), and any request that was built for one account and
 * leaves late. Answered here, as a refusal, with nothing sent; a refusal is not tried again.
 *
 * The sign-in is read from the request itself (the account inside its token). A token that names no account is
 * judged by the account the app knows to be signed in, and only when the app knows one. A request that names no
 * owner is not looked at.
 */
function refusedForAnotherAccount(url: string, init?: Parameters<typeof fetch>[1]): Response | null {
  if (!cloudRequestNamesAnotherAccount(url, init?.body, init?.headers, currentCloudOwner().ownerId)) return null;
  return new Response(JSON.stringify({ message: CLOUD_ACCOUNT_CHANGED_MESSAGE, code: CLOUD_ACCOUNT_CHANGED, details: null, hint: null }), {
    status: 409,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Whether a request names one account as its owner while it would leave with another account's sign-in; then the
 * two accounts. `knownOwnerId`: the account the app knows to be signed in, used only when the request's own token
 * names none. (Exported for its tests; it sends nothing and reads nothing but what it is given.)
 */
export function cloudRequestNamesAnotherAccount(
  url: string,
  body: unknown,
  headers: unknown,
  knownOwnerId: string | null | undefined,
): Readonly<{ named: string; signedIn: string }> | null {
  // Review pass 1, sync G1, G2 and G4: a request that carries the account it is sent for (a file, a document's
  // search index: they name no account in themselves) is judged by that, wherever it goes.
  const named = requestHeader(headers, CLOUD_REQUEST_ACCOUNT_HEADER) || ownerNamedByRequest(url, body);
  if (!named) return null;
  const signedIn = accountOfBearer(headers) ?? knownOwnerId;
  if (typeof signedIn !== 'string' || !signedIn || signedIn === named) return null;
  return { named, signedIn };
}

/** The account a request to the database names as owner: in its filter, or in the row (or first row) it writes. */
function ownerNamedByRequest(url: string, body: unknown): string | null {
  if (!url.includes('/rest/v1/')) return null;
  const filtered = /[?&]owner_id=eq\.([^&]+)/.exec(url)?.[1];
  if (filtered) {
    try {
      return decodeURIComponent(filtered);
    } catch {
      return filtered;
    }
  }
  if (typeof body !== 'string') return null;
  return /"owner_id"\s*:\s*"([^"\\]+)"/.exec(body)?.[1] ?? null;
}

/** One header of a request, whichever way its headers are held; null when it has none of that name. */
function requestHeader(headers: unknown, name: string): string | null {
  try {
    if (!headers) return null;
    if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) || null;
    const wanted = name.toLowerCase();
    const found = Object.entries(headers as Record<string, unknown>).find(([key]) => key.toLowerCase() === wanted)?.[1];
    return typeof found === 'string' && found ? found : null;
  } catch {
    return null;
  }
}

/**
 * The request as it is sent: without the account it is sent for (see CLOUD_REQUEST_ACCOUNT_HEADER). That name is
 * for the last look above and goes no further than this phone.
 */
function withoutAccountSentFor(init: Parameters<typeof fetch>[1]): Parameters<typeof fetch>[1] {
  const headers: unknown = init?.headers;
  if (!init || !headers || requestHeader(headers, CLOUD_REQUEST_ACCOUNT_HEADER) === null) return init;
  if (typeof (headers as Headers).get === 'function') {
    const sent = new Headers(headers as Headers);
    sent.delete(CLOUD_REQUEST_ACCOUNT_HEADER);
    return { ...init, headers: sent };
  }
  return {
    ...init,
    headers: Object.fromEntries(Object.entries(headers as Record<string, string>)
      .filter(([key]) => key.toLowerCase() !== CLOUD_REQUEST_ACCOUNT_HEADER)),
  };
}

/** The account inside a request's sign-in token; undefined when the token names none or cannot be read. */
function accountOfBearer(headers: unknown): string | undefined {
  let authorization: unknown;
  try {
    authorization = headers && typeof (headers as Headers).get === 'function'
      ? (headers as Headers).get('Authorization')
      : (headers as Record<string, unknown> | undefined)?.Authorization ?? (headers as Record<string, unknown> | undefined)?.authorization;
    const part = typeof authorization === 'string' ? authorization.replace(/^Bearer /i, '').split('.')[1] : undefined;
    if (!part || typeof globalThis.atob !== 'function') return undefined;
    const text = globalThis.atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const subject = (JSON.parse(text) as { sub?: unknown }).sub;
    return typeof subject === 'string' && subject ? subject : undefined;
  } catch {
    return undefined;
  }
}

function fetchObservingSignInRefresh(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const url = typeof input === 'string' ? input : String((input as { url?: unknown })?.url ?? input);
  const refusal = refusedForAnotherAccount(url, init);
  if (refusal) return Promise.resolve(refusal);
  init = withoutAccountSentFor(init);
  const refresh = url.includes('/auth/v1/token?grant_type=refresh_token');
  const signedOutHere = refresh ? refreshTokenSignedOutHere(init?.body) : () => false;
  // Each attempt starts unknown: an earlier failure says nothing about a
  // refresh under way now (auth security review, 30 Sep 2026).
  if (refresh) {
    lastSignInRefreshTransport = null;
    signInRefreshRequestsSent += 1;
  }
  const request = signedOutHere()
    ? Promise.reject(new TypeError('Network request failed'))
    : fetch(input, init).then(response => {
      if (signedOutHere()) throw new TypeError('Network request failed');
      return response;
    });
  return request.then(response => {
    if (refresh) {
      const serverError = response.status >= 500;
      lastSignInRefreshTransport = serverError ? 'server_error' : 'answered';
      lastSignInRefreshEndedAtMs = Date.now();
      if (serverError) signInRefreshFailureWaiters.forEach(notify => notify(SIGN_IN_SERVER_NOT_ANSWERING));
    }
    return response;
  }, error => {
    if (refresh) {
      lastSignInRefreshTransport = 'failed';
      signInRefreshRequestsUnanswered += 1;
      lastSignInRefreshEndedAtMs = Date.now();
      signInRefreshFailureWaiters.forEach(notify => notify(UNANSWERED_REFRESH));
    }
    throw error;
  });
}

/**
 * Marks the start of a sign-in lookup: a refresh request that gets no answer
 * after this is the lookup's own evidence of no signal (A1 pass 3 L1).
 */
export function signInRefreshNoAnswerMark(): number {
  return signInRefreshRequestsUnanswered;
}

/**
 * Whether the project's auth server answers now (A1 pass 3 L1): a GET of its
 * health endpoint through the same fetch as the sign-in, carrying no sign-in
 * token. The public anon key goes in a header, never in the URL, and nothing
 * here is logged. Any answer below 500 is signal; a failure, a 5xx, or no
 * answer within `timeoutMs` is not.
 */
export async function authServerReachable(timeoutMs: number = SIGNAL_CHECK_TIMEOUT_MS): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const answered = fetchObservingSignInRefresh(`${withoutTrailingSlash(SUPABASE_URL)}/auth/v1/health`, {
    method: 'GET',
    headers: { apikey: SUPABASE_ANON_KEY },
    ...(controller ? { signal: controller.signal } : {}),
  }).then(response => response.status < 500, () => false);
  try {
    return await Promise.race([
      answered,
      new Promise<boolean>(resolve => {
        timer = setTimeout(() => {
          controller?.abort();
          resolve(false);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function refreshTokenSignedOutHere(body: unknown): () => boolean {
  let token: unknown = null;
  try {
    token = typeof body === 'string' ? (JSON.parse(body) as { refresh_token?: unknown }).refresh_token : null;
  } catch {
    token = null;
  }
  return () => typeof token === 'string' && refreshTokensSignedOutHere.has(token);
}

export type SavedSignIn = Readonly<{
  ownerId: string;
  /** For Settings while the sign-in is pending (A1 pass 2 #1). */
  email?: string | null;
  /** When the server issued the saved token: its expiry minus its lifetime. */
  lastRefreshedAtMs: number;
  expiresAtMs: number;
}>;

/** The sign-in saved on this phone, read from the Keychain without the network. */
export async function readSavedSignIn(): Promise<SavedSignIn | null> {
  return (await readSavedSession())?.signIn ?? null;
}

/** With its refresh token, which stays in this module (A1 pass 2 #2). */
async function readSavedSession(): Promise<Readonly<{ signIn: SavedSignIn; refreshToken: string }> | null> {
  if (!getSupabaseClient() || !SUPABASE_AUTH_STORAGE_KEY) return null;
  const raw = await supabaseAuthStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as {
      refresh_token?: unknown;
      expires_at?: unknown;
      expires_in?: unknown;
      user?: { id?: unknown; email?: unknown } | null;
    };
    const ownerId = typeof session.user?.id === 'string' ? session.user.id.trim() : '';
    if (!ownerId || typeof session.refresh_token !== 'string' || !session.refresh_token) return null;
    if (typeof session.expires_at !== 'number' || !Number.isFinite(session.expires_at)) return null;
    const lifetime = typeof session.expires_in === 'number' && session.expires_in > 0
      ? session.expires_in
      : DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS;
    return {
      refreshToken: session.refresh_token,
      signIn: Object.freeze({
        ownerId,
        email: typeof session.user?.email === 'string' && session.user.email ? session.user.email : null,
        lastRefreshedAtMs: (session.expires_at - lifetime) * 1000,
        expiresAtMs: session.expires_at * 1000,
      }),
    };
  } catch {
    return null;
  }
}

/**
 * 'server_unavailable' (whole-app audit A1 pass 4 L2): the sign-in server
 * answered 5xx. Like 'network_unavailable' it is no refusal (owner answer
 * Q13), but there is signal, so it is never called "no signal".
 */
export type SavedSignInRefresh =
  | Readonly<{ status: 'signed_in'; ownerId: string }>
  | Readonly<{ status: 'signed_out' | 'rejected' | 'network_unavailable' | 'server_unavailable' | 'unreadable' }>;

export type SavedSignInRefreshOptions = Readonly<{
  /**
   * signInRefreshNoAnswerMark() when the lookup began (default: now). Only a
   * request that got no answer after it is taken for no signal as it stands.
   */
  noAnswerMark?: number;
  /** Signal is back, and the sign-in is being finished (A1 pass 3 L1). */
  onSignalBack?: () => void;
  /** False once nobody waits for the answer: the wait for the sign-in ends. */
  stillWanted?: () => boolean;
  /**
   * Whole-app audit A1 pass 4 L3: refresh through the server even a token
   * valid by the phone's clock, whose clock is not trusted.
   */
  askServer?: boolean;
}>;

const UNANSWERED_REFRESH: SavedSignInRefresh = Object.freeze({ status: 'network_unavailable' });
const SIGN_IN_SERVER_NOT_ANSWERING: SavedSignInRefresh = Object.freeze({ status: 'server_unavailable' });

/**
 * auth-js reports a refresh that got no answer and one the server answered
 * 5xx alike (AuthRetryableFetchError); only the second carries the status
 * (A1 pass 4 L2).
 */
function isSignInServerNotAnswering(error: unknown): boolean {
  return isAuthRetryableFetchError(error) && typeof error.status === 'number' && error.status >= 500;
}

/**
 * How the saved sign-in's refresh ends (owner answer Q13): 'network_unavailable'
 * only when the server never answered, as described above; a rejection has
 * already signed out through auth-js by the time this returns 'rejected'.
 *
 * Whole-app audit A1 pass 3 L1: when no refresh request of this lookup went
 * unanswered (auth-js answered from an earlier failure), whether there is
 * signal is asked instead of assumed. Without signal the answer is as before.
 * With signal, `onSignalBack` runs and this waits for the sign-in to finish.
 */
export async function awaitSavedSignInRefresh(
  options: SavedSignInRefreshOptions = {},
): Promise<SavedSignInRefresh> {
  const client = getSupabaseClient();
  if (!client) return { status: 'signed_out' };
  const noAnswerMark = options.noAnswerMark ?? signInRefreshRequestsUnanswered;
  const stillWanted = options.stillWanted ?? (() => true);
  let notify: (outcome: SavedSignInRefresh) => void = () => undefined;
  const refreshFailed = new Promise<SavedSignInRefresh>(resolve => {
    notify = resolve;
  });
  if (lastSignInRefreshTransport === 'failed') notify(UNANSWERED_REFRESH);
  // A1 pass 4 L2: a 5xx that auth-js is still retrying, or answers from in
  // its cooldown, is the server not answering, with signal; said at once.
  else if (
    lastSignInRefreshTransport === 'server_error' &&
    Date.now() < lastSignInRefreshEndedAtMs + AUTH_REFRESH_FAILURE_COOLDOWN_MS
  ) {
    notify(SIGN_IN_SERVER_NOT_ANSWERING);
  }
  signInRefreshFailureWaiters.add(notify);
  const ask = options.askServer
    ? () => savedSignInServerRefreshOutcome(client)
    : () => savedSignInRefreshOutcome(client);
  let outcome: SavedSignInRefresh;
  try {
    outcome = await Promise.race([ask(), refreshFailed]);
  } finally {
    signInRefreshFailureWaiters.delete(notify);
  }
  if (outcome.status !== 'network_unavailable' || signInRefreshRequestsUnanswered > noAnswerMark) {
    return outcome;
  }
  if (!stillWanted() || !(await authServerReachable()) || !stillWanted()) return outcome;
  options.onSignalBack?.();
  return savedSignInRefreshWithSignal(client, stillWanted, ask);
}

/** The saved sign-in as auth-js has it: getSession refreshes an expired one. */
function savedSignInRefreshOutcome(client: SupabaseClient): Promise<SavedSignInRefresh> {
  return client.auth.getSession().then(({ data, error }): SavedSignInRefresh => {
    if (isSignInServerNotAnswering(error)) return SIGN_IN_SERVER_NOT_ANSWERING;
    if (error) return isAuthRetryableFetchError(error) ? UNANSWERED_REFRESH : { status: 'rejected' };
    const ownerId = data.session?.user?.id;
    return ownerId ? { status: 'signed_in', ownerId } : { status: 'signed_out' };
  }, (): SavedSignInRefresh => ({ status: 'unreadable' }));
}

/**
 * Whole-app audit A1 pass 4 L3: the saved sign-in refreshed through the
 * server even though its token is valid by the phone's clock, which is not
 * trusted (it is earlier than a time this phone already saw): the server's
 * answer decides. auth-js keeps a session whose token is valid by that clock
 * when the server refuses its refresh, so a refusal here ends it on this
 * phone, as auth-js ends any other refused sign-in (owner answer Q13).
 */
function savedSignInServerRefreshOutcome(client: SupabaseClient): Promise<SavedSignInRefresh> {
  return client.auth.refreshSession().then(async ({ data, error }): Promise<SavedSignInRefresh> => {
    if (isSignInServerNotAnswering(error)) return SIGN_IN_SERVER_NOT_ANSWERING;
    if (isAuthRetryableFetchError(error)) return UNANSWERED_REFRESH;
    // Gone meanwhile (a sign-out): nothing left to end.
    if (isAuthSessionMissingError(error) || isAuthRefreshDiscardedError(error)) return { status: 'signed_out' };
    if (error) {
      const saved = await readSavedSession().catch(() => null);
      if (saved) await signOutOnThisPhone(saved.refreshToken);
      return { status: 'rejected' };
    }
    const ownerId = data.session?.user?.id;
    return ownerId ? { status: 'signed_in', ownerId } : { status: 'signed_out' };
  }, (): SavedSignInRefresh => ({ status: 'unreadable' }));
}

/**
 * Signal is back (A1 pass 3 L1): the sign-in's own refresh through auth-js,
 * which joins one under way and never runs past its cooldown: while auth-js
 * answers from its last failure this waits, then asks once more. Ends
 * 'network_unavailable' only when a refresh request sent meanwhile got no
 * answer, the wait (SIGNAL_BACK_REFRESH_WAIT_MS of foreground time, A1 pass 4
 * L1) ran out, or nobody waits. In the background it pauses: on return the
 * sign-in is asked again, and a refresh that finished meanwhile is the answer.
 * A request sent that got no answer while the app was away is not taken for
 * no signal: signal is checked again, and with it the sign-in is asked again
 * (A1 pass 5 L2).
 */
async function savedSignInRefreshWithSignal(
  client: SupabaseClient,
  stillWanted: () => boolean = () => true,
  ask: () => Promise<SavedSignInRefresh> = () => savedSignInRefreshOutcome(client),
): Promise<SavedSignInRefresh> {
  const wait: ForegroundWait = { foregroundMs: 0, stillWanted };
  for (;;) {
    const sentBefore = signInRefreshRequestsSent;
    const leftForegroundBefore = appLeftForegroundCount;
    // A 5xx ends the wait at once: no "Signal is back" past it (A1 pass 4 L2).
    const asked = untilServerNotAnswering(ask());
    let outcome = await beforeForegroundWaitOver(asked, wait);
    // A request it sent may be about to answer: a few seconds more.
    if (!outcome && signInRefreshRequestsSent > sentBefore && wait.stillWanted()) {
      outcome = await beforeDeadline(asked, Date.now() + SENT_REFRESH_GRACE_MS, null);
    }
    if (!outcome) return UNANSWERED_REFRESH;
    if (outcome.status !== 'network_unavailable') return outcome;
    if (signInRefreshRequestsSent > sentBefore) {
      // A1 pass 5 L2: the app left the foreground while the request was out.
      // With signal, the sign-in is asked again, and the wait starts over:
      // auth-js's minute after that failure, then its retries, come again.
      if (appLeftForegroundCount === leftForegroundBefore || !(await signalCheckedInForeground(wait))) {
        return outcome;
      }
      wait.foregroundMs = 0;
      continue;
    }
    // Nothing was sent: auth-js answered from its last failure. Wait out its
    // cooldown, or until a refresh of its own (its timer) goes out; in the
    // background, until the app is back.
    do {
      if (foregroundWaitOver(wait)) return UNANSWERED_REFRESH;
      await foregroundPoll(wait);
    } while (
      !appInForeground ||
      (Date.now() < lastSignInRefreshEndedAtMs + AUTH_REFRESH_FAILURE_COOLDOWN_MS &&
        signInRefreshRequestsSent === sentBefore)
    );
  }
}

/**
 * Whether there is signal, asked once the app is in the foreground (nothing
 * is asked in the background); false once nobody waits (A1 pass 5 L2).
 */
async function signalCheckedInForeground(wait: ForegroundWait): Promise<boolean> {
  while (!appInForeground) {
    if (!wait.stillWanted()) return false;
    await foregroundPoll(wait);
  }
  return wait.stillWanted() && (await authServerReachable()) && wait.stillWanted();
}

/** `work`'s answer, or 'server_unavailable' at the next 5xx a refresh request gets (A1 pass 4 L2). */
function untilServerNotAnswering(work: Promise<SavedSignInRefresh>): Promise<SavedSignInRefresh> {
  let notify: (outcome: SavedSignInRefresh) => void = () => undefined;
  const serverNotAnswering = new Promise<SavedSignInRefresh>(resolve => {
    notify = outcome => {
      if (outcome.status === 'server_unavailable') resolve(outcome);
    };
  });
  signInRefreshFailureWaiters.add(notify);
  return Promise.race([work, serverNotAnswering]).finally(() => {
    signInRefreshFailureWaiters.delete(notify);
  });
}

/** The wait for the sign-in, in foreground time (A1 pass 4 L1). */
type ForegroundWait = { foregroundMs: number; readonly stillWanted: () => boolean };

function foregroundWaitOver(wait: ForegroundWait): boolean {
  return wait.foregroundMs >= SIGNAL_BACK_REFRESH_WAIT_MS || !wait.stillWanted();
}

/**
 * One poll: a second, or less if `work` settles first. Only a whole second
 * in the foreground counts, however long the app was suspended meanwhile.
 */
async function foregroundPoll(wait: ForegroundWait, work?: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const polled = await Promise.race([
    new Promise<boolean>(resolve => {
      timer = setTimeout(() => resolve(true), SIGNAL_BACK_POLL_MS);
    }),
    ...(work ? [work.then(() => false, () => false)] : []),
  ]);
  if (timer) clearTimeout(timer);
  if (polled && appInForeground) wait.foregroundMs += SIGNAL_BACK_POLL_MS;
}

/** `work`'s answer, or null once the wait is over. */
async function beforeForegroundWaitOver<T>(work: Promise<T>, wait: ForegroundWait): Promise<T | null> {
  let settled = false;
  let answer: T | null = null;
  const watched = work.then(value => { answer = value; }, () => undefined).then(() => { settled = true; });
  while (!settled) {
    if (foregroundWaitOver(wait)) return null;
    await foregroundPoll(wait, watched);
  }
  return answer;
}

function beforeDeadline<T>(work: Promise<T>, deadlineMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<T>(resolve => {
      timer = setTimeout(() => resolve(fallback), Math.max(0, deadlineMs - Date.now()));
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export const supabase = createSupabaseClient();

startSupabaseAuthLifecycle(supabase);

export function getSupabaseClient(): SupabaseClient | null {
  return supabase;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && supabase);
}

export function getSupabaseConfigurationStatus(): SupabaseConfigurationStatus {
  const urlConfigured = Boolean(SUPABASE_URL);
  const anonKeyConfigured = Boolean(SUPABASE_ANON_KEY);
  const configured = Boolean(urlConfigured && anonKeyConfigured && supabase);

  return {
    configured,
    urlConfigured,
    anonKeyConfigured,
    rawProjectUrl: urlConfigured ? RAW_SUPABASE_URL : null,
    projectUrl: urlConfigured ? SUPABASE_URL : null,
    createClientUrl: supabase ? SUPABASE_URL : null,
    authStorage: SUPABASE_AUTH_STORAGE_LABEL,
    message: configured
      ? 'Supabase is configured from Expo public environment variables.'
      : 'Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to enable cloud sync.',
  };
}

export async function getSupabaseConnectionStatus(): Promise<SupabaseConnectionStatus> {
  const configuration = getSupabaseConfigurationStatus();
  const client = getSupabaseClient();

  if (!configuration.configured || !client) {
    return {
      ...configuration,
      clientReady: false,
      authenticated: false,
      userEmail: null,
      checkedAt: new Date().toISOString(),
    };
  }

  await waitForAuthHydration(AUTH_HYDRATION_WAIT_MS);
  const { data } = await client.auth.getSession();

  return {
    ...configuration,
    clientReady: true,
    authenticated: Boolean(data.session?.user),
    userEmail: data.session?.user?.email ?? null,
    checkedAt: new Date().toISOString(),
    message: data.session?.user
      ? 'Supabase is configured and a user session is active.'
      : 'Supabase is configured. No user is signed in yet.',
  };
}

export async function testSupabaseConnection(): Promise<SupabaseConnectionTestResult> {
  const client = getSupabaseClient();
  const checkedAt = new Date().toISOString();

  if (!client) {
    return {
      configured: false,
      connected: false,
      projectCount: null,
      checkedAt,
      error:
        'Supabase client did not initialize. Check EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
    };
  }

  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return {
      configured: true,
      connected: false,
      projectCount: null,
      checkedAt,
      status: owner.status,
      error: owner.error,
    };
  }

  const { count, error, status } = await client
    .from(PROJECTS_TABLE)
    .select('name', { count: 'exact' })
    .eq('owner_id', owner.data)
    .eq('archived', false)
    .limit(1);

  if (error) {
    return {
      configured: true,
      connected: false,
      projectCount: null,
      checkedAt,
      status,
      error: error.message,
    };
  }

  return {
    configured: true,
    connected: true,
    projectCount: typeof count === 'number' ? count : null,
    checkedAt,
    status,
  };
}

export async function runSupabaseConnectionDiagnostics(): Promise<SupabaseConnectionDiagnostics> {
  const supabaseUrl = SUPABASE_URL || null;
  const client = getSupabaseClient();
  if (client) await waitForAuthHydration(AUTH_HYDRATION_WAIT_MS);
  const sessionResult = client ? await client.auth.getSession() : null;
  const accessToken = sessionResult?.data.session?.access_token ?? null;
  const rootUrl = supabaseUrl || 'Missing EXPO_PUBLIC_SUPABASE_URL';
  const restUrl = supabaseUrl
    ? `${withoutTrailingSlash(supabaseUrl)}/rest/v1/${PROJECTS_TABLE}?select=name&limit=1`
    : 'Missing EXPO_PUBLIC_SUPABASE_URL';

  const [rootFetch, restFetch] = await Promise.all([
    supabaseUrl
      ? fetchDiagnosticStep('Supabase URL root', rootUrl)
      : Promise.resolve(missingUrlStep('Supabase URL root', rootUrl)),
    supabaseUrl && SUPABASE_ANON_KEY && accessToken
      ? fetchDiagnosticStep('Supabase REST projects endpoint', restUrl, {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${accessToken}`,
          },
        })
      : Promise.resolve(
          missingUrlStep(
            'Supabase REST projects endpoint',
            restUrl,
            supabaseUrl && SUPABASE_ANON_KEY
              ? 'Sign in is required to test authenticated project access.'
              : supabaseUrl
                ? 'Missing EXPO_PUBLIC_SUPABASE_ANON_KEY.'
              : 'Missing EXPO_PUBLIC_SUPABASE_URL.',
          ),
        ),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    rawSupabaseUrl: RAW_SUPABASE_URL || null,
    supabaseUrl,
    createClientUrl: getSupabaseClient() ? SUPABASE_URL : null,
    clientInitialized: Boolean(getSupabaseClient()),
    rootFetch,
    restFetch,
  };
}

export async function signIn({
  email,
  password,
}: SignInParams): Promise<SupabaseServiceResult<AuthResult>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<AuthResult>();

  lastSignInClientSource = SUPABASE_CLIENT_SOURCE;

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) return errorResult(error.message);

  lastAuthEvent = 'SIGNED_IN';
  authHydrationCompleted = true;

  return okResult({
    user: data.user,
    session: data.session,
  });
}

export async function signUp({
  email,
  password,
}: SignUpParams): Promise<SupabaseServiceResult<AuthResult>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<AuthResult>();

  lastSignInClientSource = SUPABASE_CLIENT_SOURCE;

  const { data, error } = await client.auth.signUp({
    email,
    password,
  });

  if (error) return errorResult(error.message);

  authHydrationCompleted = true;
  if (data.session) lastAuthEvent = 'SIGNED_IN';
  else lastAuthEvent = 'USER_UPDATED';

  return okResult({
    user: data.user,
    session: data.session,
  });
}

export async function signOut(
  scope: SignOutScope = 'local',
): Promise<SupabaseServiceResult<null>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<null>();

  // Owner answer Q13: an expired saved sign-in whose last refresh got no
  // answer cannot be ended on the server (that needs a refreshed token), so
  // it is not tried again here; the library's retries take about 25 seconds.
  // A token within auth-js's refresh margin counts as expired: auth-js would
  // refresh it first.
  const saved = await readSavedSession().catch(() => null);
  let unreachable = Boolean(
    saved &&
    saved.signIn.expiresAtMs - SIGN_IN_EXPIRY_MARGIN_MS <= Date.now() &&
    lastSignInRefreshTransport === 'failed',
  );
  // Whole-app audit A1 pass 3 L1: that failure may be a minute old, with
  // auth-js still answering from it. All Devices is the lost-device choice,
  // so whether there is signal is asked, not assumed. With signal the expired
  // token is refreshed first (the sign-out needs a valid one); a refusal
  // means the server had already ended this sign-in, and that is what is said.
  let serverNotAnswering = false;
  if (unreachable && scope === 'global' && await authServerReachable()) {
    const refreshed = await savedSignInRefreshWithSignal(client);
    serverNotAnswering = refreshed.status === 'server_unavailable';
    if (refreshed.status === 'signed_in') {
      unreachable = false;
    } else if (refreshed.status === 'rejected' || refreshed.status === 'signed_out') {
      lastAuthEvent = 'SIGNED_OUT';
      authHydrationCompleted = true;
      return {
        ...okResult(null, undefined, SIGN_IN_ALREADY_ENDED_ON_SERVER_MESSAGE),
        code: SIGN_IN_ALREADY_ENDED_ON_SERVER,
      };
    }
  }
  const error = unreachable ? null : (await client.auth.signOut({ scope })).error;

  if (!unreachable && !error) {
    lastAuthEvent = 'SIGNED_OUT';
    authHydrationCompleted = true;
    return okResult(null);
  }
  if (error && !isAuthRetryableFetchError(error)) return errorResult(error.message);
  // Owner answer Q21: only the cloud can sign out the other devices. Without
  // it nothing is signed out here either; the owner is told and chooses.
  // A1 pass 4 L2: a sign-in server answering 5xx is not "needs signal".
  if (scope === 'global') {
    return errorResult(
      serverNotAnswering || isSignInServerNotAnswering(error)
        ? SIGN_OUT_OF_ALL_DEVICES_SERVER_NOT_ANSWERING_MESSAGE
        : SIGN_OUT_OF_ALL_DEVICES_NEEDS_SIGNAL_MESSAGE,
      undefined,
      SIGN_OUT_OF_ALL_DEVICES_NEEDS_SIGNAL,
    );
  }

  // No signal (owner answer Q13): sign out on this phone. The server session
  // is not ended, then or later; no copy of its token stays on the phone.
  return signOutOnThisPhone(saved?.refreshToken ?? null);
}

const localAuthListeners = new Set<(event: string, session: Session | null) => void>();

/**
 * The local half of a sign-out, the step auth-js runs once the server has
 * confirmed one: the saved session leaves the Keychain, then every subscriber
 * hears SIGNED_OUT, which moves this owner's data into its sandbox (entry.ts)
 * exactly as an online sign-out does. Unsynced work goes with it and uploads
 * after this account signs in here again.
 */
async function signOutOnThisPhone(refreshToken: string | null): Promise<SupabaseServiceResult<null>> {
  if (!SUPABASE_AUTH_STORAGE_KEY) return errorResult('Sign-in storage is not configured.');
  // Before anything is removed, and in the same step as the no-signal check
  // above: no refresh with this token is saved from here on (A1 pass 2 #2).
  if (refreshToken) refreshTokensSignedOutHere.add(refreshToken);
  try {
    // The session itself goes last, so a failure before it leaves the sign-in
    // whole and "You are still signed in" true (auth security review).
    for (const suffix of ['-code-verifier', '-user', '']) {
      await supabaseAuthStorage.removeItem(`${SUPABASE_AUTH_STORAGE_KEY}${suffix}`);
    }
  } catch {
    // Still signed in, so its refresh may save again.
    if (refreshToken) refreshTokensSignedOutHere.delete(refreshToken);
    return errorResult(
      'Vitruvius could not remove the saved sign-in from this phone. You are still signed in.',
    );
  }
  lastAuthEvent = 'SIGNED_OUT';
  authHydrationCompleted = true;
  noteSignedInOwner(null);
  [...localAuthListeners].forEach(listener => listener('SIGNED_OUT', null));
  // True as worded: nothing reached the server, so the account's other
  // devices keep their own sign-ins, now and when this one has signal again.
  return {
    ...okResult(
      null,
      undefined,
      'Signed out on this device only. There was no signal, so your other devices stay signed in.',
    ),
    code: SIGNED_OUT_ON_THIS_DEVICE_ONLY,
  };
}

export async function getCurrentUser(): Promise<SupabaseServiceResult<User | null>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<User | null>();

  const { data, error } = await client.auth.getUser();

  if (error) return errorResult(error.message);

  return okResult(data.user ?? null);
}

export async function getCurrentSessionUser(): Promise<SupabaseServiceResult<User | null>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<User | null>();

  const hydrated = await waitForAuthHydration(AUTH_HYDRATION_WAIT_MS);
  if (!hydrated) {
    return errorResult(
      'Authentication is still loading. Try opening this workspace again in a moment.',
      503,
      'auth_loading',
    );
  }

  const { data, error } = await client.auth.getSession();
  if (error) return errorResult(error.message, 401, 'auth_required');

  return okResult(data.session?.user ?? null);
}

export function accountDisplayNameForUser(user: User | null | undefined): string {
  return accountDisplayNameForMetadata(user?.user_metadata);
}

export async function updateCurrentUserDisplayName(
  displayName: string,
): Promise<SupabaseServiceResult<User | null>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<User | null>();
  const { data, error } = await client.auth.updateUser({
    data: { project_vision_display_name: displayName.trim() },
  });
  if (error) return errorResult(error.message);
  return okResult(data.user ?? null);
}

export function subscribeToAuthStateChange(
  callback: (event: string, session: Session | null) => void,
): () => void {
  const client = getSupabaseClient();

  if (!client) return () => undefined;

  const { data } = client.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  // Also hears a sign-out made on this phone without signal (owner answer Q13).
  const local = (event: string, session: Session | null) => callback(event, session);
  localAuthListeners.add(local);

  return () => {
    localAuthListeners.delete(local);
    data.subscription.unsubscribe();
  };
}

export async function subscribeToDAVEOperationalChanges({
  onChange,
  onStatus,
}: {
  onChange: (
    entity: DAVEOperationalRealtimeEntity,
    collections?: readonly DAVEOperationalCollectionName[],
    payload?: import('./DAVEOperationalRefresh').DAVEOperationalRealtimePayload,
  ) => void;
  onStatus?: (status: DAVEOperationalRealtimeStatus) => void;
}): Promise<() => void> {
  const client = getSupabaseClient();
  if (!client) return () => undefined;

  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) return () => undefined;

  return attachDAVEOperationalRealtime({
    client,
    ownerId: owner.data,
    onChange,
    onStatus,
  });
}

/** Converts an owner-filtered Realtime row into the same model returned by
 * the collection readers, allowing the app to merge one changed row instead
 * of downloading the complete table. */
export function normalizeDAVEOperationalRealtimeRecord(
  entity: DAVEOperationalRealtimeEntity,
  value: unknown,
): unknown | null {
  const row = toRecord(value);
  if (Object.keys(row).length === 0) return null;
  if (entity === 'project') return normalizeProject(row);
  if (entity === 'project_update') return normalizeProjectUpdate(row);
  if (entity === 'sync_tombstone') {
    const entityType = typeof row.entity_type === 'string'
      ? row.entity_type
      : '';
    const recordId = typeof row.record_id === 'string'
      ? row.record_id.trim()
      : '';
    const deletedAt = typeof row.deleted_at === 'string'
      ? row.deleted_at
      : '';
    return recordId && deletedAt && [
      'project',
      'project_update',
      'project_area',
      'schedule_item',
      'reference_document',
    ].includes(entityType)
      ? { entityType, recordId, deletedAt }
      : null;
  }
  const jsonColumn = entity === 'project_area'
    ? 'area_data'
    : entity === 'schedule_item'
      ? 'item_data'
      : 'document_data';
  const jsonRecord = toRecord(row[jsonColumn]);
  if (Object.keys(jsonRecord).length === 0) return null;
  const record = bindDAVECloudDatabaseIdentity(jsonRecord, row.id);
  return entity === 'reference_document'
    ? {
        ...record,
        cloudUpdatedAt:
          typeof row.updated_at === 'string' ? row.updated_at : null,
      }
    : record;
}

export async function getCurrentSessionAccessToken(): Promise<SupabaseServiceResult<SupabaseSessionTokenLookupResult>> {
  const client = getSupabaseClient();
  const storageAvailable = await probeAuthStorage();

  if (!client) {
    return {
      ok: false,
      configured: false,
      data: buildSessionTokenLookup({
        storageAvailable,
        authState: 'unknown',
        missingReason: 'client_mismatch',
      }),
      error:
        'Supabase client is not available to read the current auth session.',
    };
  }

  if (!storageAvailable) {
    return okResult(buildSessionTokenLookup({
      storageAvailable: false,
      authState: 'unknown',
      missingReason: 'storage_unavailable',
    }));
  }

  await waitForAuthHydration(AUTH_HYDRATION_WAIT_MS);

  if (!authHydrationCompleted) {
    return okResult(buildSessionTokenLookup({
      storageAvailable,
      authState: 'loading',
      missingReason: 'auth_loading',
    }));
  }

  const { data, error } = await client.auth.getSession();

  if (error) {
    return okResult(buildSessionTokenLookup({
      storageAvailable,
      authState: 'unknown',
      missingReason: storageAvailable ? 'unknown' : 'storage_unavailable',
    }), undefined, error.message);
  }

  const session = data.session ?? null;
  const expiresAt = typeof session?.expires_at === 'number' ? session.expires_at : null;
  const expired = Boolean(expiresAt && expiresAt * 1000 <= Date.now());

  if (expired) {
    return okResult(buildSessionTokenLookup({
      session,
      storageAvailable,
      authState: 'expired',
      missingReason: 'expired_session',
    }));
  }

  if (!session?.access_token) {
    return okResult(buildSessionTokenLookup({
      session,
      storageAvailable,
      authState: 'signed_out',
      missingReason: storageAvailable ? 'signed_out' : 'storage_unavailable',
    }));
  }

  return okResult(buildSessionTokenLookup({
    session,
    storageAvailable,
    authState: 'signed_in',
    missingReason: null,
  }));
}

export async function uploadPhoto({
  bucket = PROJECT_PHOTOS_BUCKET,
  path,
  uri,
  contentType = 'image/jpeg',
  upsert = true,
  cacheControl = '3600',
  reportedSizeBytes,
  maxBytes,
  onProgress,
}: UploadPhotoParams): Promise<SupabaseServiceResult<UploadedPhoto>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<UploadedPhoto>();
  // A file sent for one account is not sent once another has signed in (sync batch Y4, the account boundary). Asked
  // only when the caller named the account, and before the file is read: every other upload is made as it always was.
  //
  // Review pass 1, sync G1 (older; owner answer Q45, 6 Oct 2026). It was asked here only. Measuring a file, reading
  // it and (for a large one) hashing it take seconds, and when the account changed meanwhile the file left with the
  // next account's sign-in. It is asked again after each of those waits, and the request itself says which account
  // the file is sent for, so the last look where it leaves refuses it under any other sign-in. A large file goes
  // up with the sign-in read here, which is checked to be that account's own.
  const asOwner = cloudOwnerExpectedForThisCall();
  const refusedUnderAnotherAccount = async (): Promise<SupabaseServiceResult<UploadedPhoto> | null> => {
    if (!asOwner) return null;
    const owner = await requireAuthenticatedOwnerId(client, asOwner);
    return owner.ok && owner.data ? null : errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  };
  const refusedAtStart = await refusedUnderAnotherAccount();
  if (refusedAtStart) return refusedAtStart;

  let verifiedSizeBytes: number;
  try {
    verifiedSizeBytes = (await preflightExpoFileRead({
      uri,
      ...(reportedSizeBytes !== undefined ? { reportedSizeBytes } : {}),
      ...(maxBytes !== undefined ? { maxBytes } : {}),
    })).sizeBytes;
  } catch (cause) {
    if (cause instanceof FileSizePreflightError) {
      return errorResult(
        cause.message,
        cause.code === 'file_too_large' ? 413 : 422,
        cause.code,
      );
    }
    return errorResult(
      'ECOS could not safely inspect this file. Choose it again and retry.',
      422,
      'file_size_unavailable',
    );
  }

  const refusedAfterMeasuring = await refusedUnderAnotherAccount();
  if (refusedAfterMeasuring) return refusedAfterMeasuring;

  if (verifiedSizeBytes > RESUMABLE_UPLOAD_THRESHOLD_BYTES) {
    const configuration = getSupabaseConfigurationStatus();
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      return errorResult(
        sessionError?.message || 'Sign in again before uploading this large file.',
        401,
        'missing_upload_session',
      );
    }
    // The large file goes up with this sign-in and no other: it must be the account's own.
    if (asOwner && sessionData.session.user?.id !== asOwner) {
      return errorResult(CLOUD_ACCOUNT_CHANGED_MESSAGE, 409, CLOUD_ACCOUNT_CHANGED);
    }

    try {
      const integrity = await hashExpoFileSha256({
        uri,
        reportedSizeBytes: verifiedSizeBytes,
        ...(maxBytes !== undefined ? { maxBytes } : {}),
      });
      const refusedAfterHashing = await refusedUnderAnotherAccount();
      if (refusedAfterHashing) return refusedAfterHashing;
      const uploaded = await uploadFileResumably({
        projectUrl: configuration.projectUrl || '',
        accessToken: sessionData.session.access_token,
        bucket,
        path,
        uri,
        sizeBytes: integrity.sizeBytes,
        contentSha256: integrity.sha256,
        contentType,
        cacheControl,
        upsert,
        ...(onProgress ? { onProgress } : {}),
      });
      return okResult({
        bucket,
        path: uploaded.path,
        fullPath: null,
      });
    } catch (cause) {
      if (cause instanceof FileSizePreflightError) {
        return errorResult(
          cause.message,
          cause.code === 'file_too_large' ? 413 : 422,
          cause.code,
        );
      }
      return errorResult(
        cause instanceof Error
          ? cause.message
          : 'The resumable upload could not be completed.',
        undefined,
        'resumable_upload_failed',
      );
    }
  }

  let fileData: ArrayBuffer;
  try {
    fileData = (await prepareExpoFileUploadPayload({
      uri,
      reportedSizeBytes: verifiedSizeBytes,
      ...(maxBytes !== undefined ? { maxBytes } : {}),
    })).data;
  } catch (cause) {
    if (cause instanceof FileSizePreflightError) {
      return errorResult(cause.message, 422, cause.code);
    }
    return errorResult(
      'Vitruvius could not safely prepare this file. Choose it again and retry.',
      422,
      'file_read_failed',
    );
  }

  const refusedAfterReading = await refusedUnderAnotherAccount();
  if (refusedAfterReading) return refusedAfterReading;

  onProgress?.(0);
  const { data, error } = await client.storage
    .from(bucket)
    .upload(path, fileData, {
      cacheControl,
      contentType,
      upsert,
      ...(asOwner ? { headers: { [CLOUD_REQUEST_ACCOUNT_HEADER]: asOwner } } : {}),
    });

  if (error) {
    const errorRecord = error as unknown as Record<string, unknown>;
    const status =
      typeof errorRecord.statusCode === 'number'
        ? errorRecord.statusCode
        : typeof errorRecord.status === 'number'
          ? errorRecord.status
          : undefined;
    const code =
      typeof errorRecord.error === 'string'
        ? errorRecord.error
        : typeof errorRecord.code === 'string'
          ? errorRecord.code
          : undefined;

    return errorResult(error.message, status, code);
  }

  onProgress?.(1);
  return okResult({
    bucket,
    path: data?.path ?? path,
    fullPath: data?.fullPath ?? null,
  });
}

export async function downloadPhoto({
  bucket = PROJECT_PHOTOS_BUCKET,
  path,
}: DownloadPhotoParams): Promise<SupabaseServiceResult<Blob>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<Blob>();

  const { data, error } = await client.storage.from(bucket).download(path);

  if (error) return errorResult(error.message);

  return okResult(data);
}

export async function removeProtectedStorageObject({
  bucket,
  path,
}: {
  bucket: DAVEStorageCleanupBucket;
  path: string;
}): Promise<SupabaseServiceResult<null>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<null>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }
  if (bucket !== 'project-photos' && bucket !== 'project-documents') {
    return errorResult('Protected file cleanup requires an approved project storage bucket.');
  }
  const objectPath = path.trim();
  if (!objectPath) return errorResult('Protected file cleanup requires an object path.');

  const { error } = await client.storage.from(bucket).remove([objectPath]);
  if (error) return errorResult(error.message);
  return okResult(null);
}

export async function listDAVEStorageCleanupIntents(
  limit = 25,
): Promise<SupabaseServiceResult<DAVEStorageCleanupIntent[]>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<DAVEStorageCleanupIntent[]>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const { data, error, status } = await client
    .from(DAVE_STORAGE_CLEANUP_INTENTS_TABLE)
    .select(
      'id,bucket_id,object_path,source_entity_type,source_record_id,status,attempt_count,last_error,updated_at',
    )
    .eq('owner_id', owner.data)
    .in('status', ['pending', 'failed'])
    .order('updated_at', { ascending: true })
    .limit(safeLimit);

  if (error) {
    return tableAwareErrorResult<DAVEStorageCleanupIntent[]>(
      error.message,
      status,
    );
  }

  const intents = (data ?? [])
    .map(normalizeStorageCleanupIntent)
    .filter((intent): intent is DAVEStorageCleanupIntent => Boolean(intent));
  return okResult(intents, status);
}

export async function recordDAVEStorageCleanupAttempt({
  intent,
  completed,
  errorMessage = null,
}: {
  intent: DAVEStorageCleanupIntent;
  completed: boolean;
  errorMessage?: string | null;
}): Promise<SupabaseServiceResult<null>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<null>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const updatedAt = new Date().toISOString();
  const { error, status } = await client
    .from(DAVE_STORAGE_CLEANUP_INTENTS_TABLE)
    .update({
      status: completed ? 'completed' : 'failed',
      attempt_count: intent.attemptCount + 1,
      last_error: completed ? null : (errorMessage || 'Protected file cleanup failed.'),
      updated_at: updatedAt,
      completed_at: completed ? updatedAt : null,
    })
    .eq('owner_id', owner.data)
    .eq('id', intent.id)
    .in('status', ['pending', 'failed']);

  if (error) return tableAwareErrorResult<null>(error.message, status);
  return okResult(null, status);
}

export async function purgeExpiredDAVEDeletionAudit(): Promise<
  SupabaseServiceResult<number>
> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<number>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(
      owner.error || 'Sign in is required.',
      owner.status,
      owner.code,
    );
  }

  const { data, error, status } = await client.rpc(
    'dave_purge_expired_deletion_audit',
  );
  if (error) return errorResult(error.message, status, error.code);
  return okResult(
    typeof data === 'number' && Number.isFinite(data)
      ? Math.max(0, Math.floor(data))
      : 0,
    status,
  );
}

export async function createPhotoSignedUrl(
  path: string,
  expiresIn = 300,
  bucket = PROJECT_PHOTOS_BUCKET,
  transform?: Readonly<{
    width?: number;
    height?: number;
    quality?: number;
    resize?: 'cover' | 'contain' | 'fill';
  }>,
): Promise<SupabaseServiceResult<string>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<string>();
  const storage = client.storage.from(bucket);
  const { data, error } = transform
    ? await storage.createSignedUrl(path, expiresIn, { transform })
    : await storage.createSignedUrl(path, expiresIn);
  if (error) {
    const errorRecord = error as unknown as Record<string, unknown>;
    const rawStatus = errorRecord.statusCode ?? errorRecord.status;
    const parsedStatus = typeof rawStatus === 'string'
      ? Number(rawStatus)
      : rawStatus;
    const status = typeof parsedStatus === 'number' && Number.isFinite(parsedStatus)
      ? parsedStatus
      : undefined;
    const code = typeof errorRecord.error === 'string'
      ? errorRecord.error
      : typeof errorRecord.code === 'string'
        ? errorRecord.code
        : undefined;

    return errorResult(error.message, status, code);
  }
  return okResult(data.signedUrl);
}

export async function verifyDAVEAppOwner(): Promise<SupabaseServiceResult<boolean>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<boolean>();

  const { data, error, status } = await client.rpc('dave_is_app_owner');
  if (error) return errorResult(error.message, status);
  return okResult(data === true, status);
}

export async function createProject(
  project: CreateProjectParams,
): Promise<SupabaseServiceResult<CloudProject>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<CloudProject>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const payload = {
    name: project.name,
    status: project.status ?? 'Active',
    archived: project.archived ?? false,
    is_favorite: project.isFavorite ?? false,
    ...(project.data !== undefined ? { project_data: project.data } : {}),
    owner_id: owner.data,
  };

  const { data, error, status } = await client
    .from(PROJECTS_TABLE)
    .insert(payload)
    .select('*')
    .single();

  if (error) return tableAwareErrorResult<CloudProject>(error.message, status);

  return okResult(normalizeProject(data), status);
}

export async function updateProject(
  project: UpdateProjectParams,
): Promise<SupabaseServiceResult<CloudProject>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<CloudProject>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const payload: Record<string, unknown> = {};

  if (project.name !== undefined) payload.name = project.name;
  if (project.status !== undefined) payload.status = project.status;
  if (project.archived !== undefined) payload.archived = project.archived;
  if (project.isFavorite !== undefined) payload.is_favorite = project.isFavorite;
  if (project.data !== undefined) payload.project_data = project.data;

  if (Object.keys(payload).length === 0) {
    return okResult<CloudProject>(
      null,
      undefined,
      'No project changes were provided.',
    );
  }

  let query = client
    .from(PROJECTS_TABLE)
    .update(payload)
    .eq('owner_id', owner.data)
    .select('*');

  if (project.id) {
    query = query.eq('id', project.id);
  } else if (project.previousName || project.name) {
    query = query.eq('name', project.previousName || project.name || '');
  } else {
    return errorResult('Project update requires an id, previousName, or name.');
  }

  const { data, error, status } = await query.limit(1).maybeSingle();

  if (error && project.archived === true && error.code === 'PGRST116') {
    return okResult<CloudProject>(
      null,
      status,
      'Project was already absent from the cloud project list.',
    );
  }
  if (error) return tableAwareErrorResult<CloudProject>(error.message, status);
  if (!data && project.archived === true) {
    return okResult<CloudProject>(
      null,
      status,
      'Project was already absent from the cloud project list.',
    );
  }
  if (!data) return errorResult('Project could not be found.', status);

  return okResult(normalizeProject(data), status);
}

export async function deleteProject({
  name,
}: DeleteProjectParams): Promise<SupabaseServiceResult<null>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<null>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const projectName = name.trim();

  if (!projectName) return errorResult('Project delete requires a name.');

  const { error, status } = await client.rpc(
    'dave_delete_project_atomically',
    { p_project_name: projectName },
  );
  if (error) {
    if (
      error.code === 'PGRST202' ||
      error.message.toLowerCase().includes('dave_delete_project_atomically')
    ) {
      return errorResult(
        'Protected project deletion is not available yet. Apply the approved Vitruvius database migration, then retry.',
        status,
        error.code,
      );
    }
    return errorResult(
      'The project and its deletion markers could not be committed together. No partial cloud deletion was accepted.',
      status,
      error.code,
    );
  }
  return okResult(null, status);
}

export async function listProjects(): Promise<SupabaseServiceResult<CloudProject[]>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<CloudProject[]>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const result = await paginateSupabaseCollectionByKey(request => applySupabaseKeysetPage(
    client
      .from(PROJECTS_TABLE)
      .select('*', { count: request.includeExactCount ? 'exact' : undefined })
      .eq('owner_id', owner.data)
      .eq('archived', false),
    ROW_ID_KEY,
    request,
  ), LIST_READ_BY_ROW_ID);

  if (!result.ok) return tableAwareListResult<CloudProject>(result.error, result.status);
  return okResult(newestCreatedFirst(result.rows).map(normalizeProject), result.status);
}

export async function listArchivedProjects(): Promise<SupabaseServiceResult<CloudProject[]>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<CloudProject[]>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const result = await paginateSupabaseCollectionByKey(request => applySupabaseKeysetPage(
    client
      .from(PROJECTS_TABLE)
      .select('*', { count: request.includeExactCount ? 'exact' : undefined })
      .eq('owner_id', owner.data)
      .eq('archived', true),
    ROW_ID_KEY,
    request,
  ), LIST_READ_BY_ROW_ID);

  if (!result.ok) return tableAwareListResult<CloudProject>(result.error, result.status);
  return okResult(newestCreatedFirst(result.rows).map(normalizeProject), result.status);
}

/**
 * This account's projects with these exact ids, open or closed (independent
 * review R02): a project neither list returned is read by its id before it is
 * taken as deleted on another device.
 */
export async function getProjectsByIds(
  ids: readonly string[],
): Promise<SupabaseServiceResult<CloudProject[]>> {
  const result = await readOwnedRowsByIds(PROJECTS_TABLE, '*', ids);
  if (!result.ok || !result.data) return { ...result, data: null };
  return okResult(result.data.map(normalizeProject), result.status);
}

export async function countCloudProjects(): Promise<SupabaseServiceResult<number>> {
  const testResult = await testSupabaseConnection();

  if (!testResult.configured) return notConfiguredResult<number>();

  if (!testResult.connected) {
    return errorResult(
      testResult.error || 'Supabase project count failed.',
      testResult.status,
    );
  }

  return okResult(testResult.projectCount ?? 0, testResult.status);
}

export async function saveProjectUpdate<TUpdate>({
  id,
  projectId,
  projectName,
  areaName,
  idempotencyKey,
  updateData,
  updatedAt = new Date().toISOString(),
}: SaveProjectUpdateParams<TUpdate>): Promise<
  SupabaseServiceResult<CloudProjectUpdate<TUpdate>>
> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<CloudProjectUpdate<TUpdate>>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const canonicalProjectId = exactOperationalProjectId(projectId);
  if (!canonicalProjectId) {
    return errorResult(
      'The field update is missing its exact cloud project identity.',
      409,
      'operational_project_identity_required',
    );
  }
  const updateRecord = toRecord(updateData);
  if (Object.keys(updateRecord).length === 0) {
    return errorResult(
      'The field update payload must be a protected record.',
      400,
      'operational_payload_invalid',
    );
  }
  const embeddedProjectId = updateRecord.projectId;
  if (
    embeddedProjectId !== undefined &&
    embeddedProjectId !== null &&
    embeddedProjectId !== canonicalProjectId
  ) {
    return errorResult(
      'The field update project identity does not match its protected record.',
      409,
      'operational_project_identity_mismatch',
    );
  }
  const boundUpdateData = {
    ...updateRecord,
    projectId: canonicalProjectId,
  } as TUpdate;

  const stableIdempotencyKey =
    sanitizeIdempotencyKey(idempotencyKey) ||
    extractProjectUpdateIdempotencyKey(updateData) ||
    id;
  const payload = {
    id,
    project_id: canonicalProjectId,
    project_name: projectName || 'Unassigned Project',
    area_name: areaName || '',
    idempotency_key: stableIdempotencyKey,
    update_data: boundUpdateData,
    updated_at: updatedAt,
    owner_id: owner.data,
  };

  const { data, error, status } = await client
    .from(PROJECT_UPDATES_TABLE)
    .upsert(payload, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) {
    return tableAwareErrorResult<CloudProjectUpdate<TUpdate>>(
      error.message,
      status,
    );
  }

  return okResult(normalizeProjectUpdate<TUpdate>(data), status);
}

export async function deleteProjectUpdate({
  id,
}: DeleteProjectUpdateParams): Promise<SupabaseServiceResult<null>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<null>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const updateId = id.trim();
  if (!updateId) return errorResult('Field update delete requires an id.');

  const { error, status } = await client.rpc(
    'dave_delete_project_update_atomically',
    { p_update_id: updateId },
  );
  if (error) {
    if (
      error.code === 'PGRST202' ||
      error.message.toLowerCase().includes('dave_delete_project_update_atomically')
    ) {
      return errorResult(
        'Protected field-update deletion is not available yet. Apply the approved Vitruvius database migration, then retry.',
        status,
        error.code,
      );
    }
    return errorResult(
      'The field update and its deletion marker could not be committed together. No partial cloud deletion was accepted.',
      status,
      error.code,
    );
  }
  return okResult(null, status);
}

export async function archiveProjectUpdate({
  id,
  archivedAt,
  projectId,
}: {
  id: string;
  archivedAt: string;
  projectId?: string | null;
}): Promise<SupabaseServiceResult<null>> {
  // The account this archive must be made as holds for its write too, which starts after the read has answered.
  const asOwner = cloudOwnerExpectedForThisCall();
  const metadata = await getProjectUpdateSyncMetadata<Record<string, unknown>>(id);
  if (!metadata.ok || metadata.stubbed) {
    return errorResult(metadata.error || metadata.message || 'Field update archive could not be read.');
  }
  if (!metadata.data?.updateData) return okResult(null, metadata.status);
  const updateData = metadata.data.updateData;
  const boundProjectId = exactOperationalProjectId(
    projectId || metadata.data.projectId || toRecord(updateData).projectId,
  );
  if (!boundProjectId) {
    return errorResult('Field update archive requires an exact cloud project identity.');
  }
  const projectName = typeof updateData.projectName === 'string'
    ? updateData.projectName
    : metadata.data.projectName || '';
  if (!projectName.trim()) return errorResult('Field update archive requires a project name.');
  const areaName = typeof updateData.selectedAreaName === 'string'
    ? updateData.selectedAreaName
    : metadata.data.areaName || '';
  const result = await callAsCloudOwner(asOwner, () => saveProjectUpdate({
    id,
    projectId: boundProjectId,
    projectName,
    areaName,
    updateData: { ...updateData, isArchived: true, archivedAt },
    updatedAt: archivedAt,
  }));
  if (!result.ok || result.stubbed) {
    return errorResult(result.error || result.message || 'Field update archive could not be saved.');
  }
  return okResult(null, result.status);
}

export async function listProjectUpdates<TUpdate>(): Promise<
  SupabaseServiceResult<CloudProjectUpdate<TUpdate>[]>
> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<CloudProjectUpdate<TUpdate>[]>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const result = await paginateSupabaseCollectionByKey(request => applySupabaseKeysetPage(
    client
      .from(PROJECT_UPDATES_TABLE)
      .select('*', { count: request.includeExactCount ? 'exact' : undefined })
      .eq('owner_id', owner.data),
    ROW_ID_KEY,
    request,
  ), LIST_READ_BY_ROW_ID);

  if (!result.ok) {
    return tableAwareListResult<CloudProjectUpdate<TUpdate>>(
      result.error,
      result.status,
    );
  }

  return okResult(
    newestCreatedFirst(result.rows).map(row => normalizeProjectUpdate<TUpdate>(row)),
    result.status,
  );
}

export async function getProjectUpdateSyncMetadata<TUpdate>(
  id: string,
): Promise<SupabaseServiceResult<ProjectUpdateSyncMetadata<TUpdate> | null>> {
  const client = getSupabaseClient();

  if (!client) {
    return notConfiguredResult<ProjectUpdateSyncMetadata<TUpdate> | null>();
  }
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const { data, error, status } = await client
    .from(PROJECT_UPDATES_TABLE)
    .select('id, project_id, updated_at, project_name, area_name, update_data')
    .eq('owner_id', owner.data)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return tableAwareErrorResult<ProjectUpdateSyncMetadata<TUpdate> | null>(
      error.message,
      status,
    );
  }

  if (!data) return okResult(null, status);

  const row = toRecord(data);

  return okResult(
    {
      id: String(row.id || id),
      projectId: typeof row.project_id === 'string' ? row.project_id : null,
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
      projectName: typeof row.project_name === 'string' ? row.project_name : null,
      areaName: typeof row.area_name === 'string' ? row.area_name : null,
      updateData: (row.update_data as TUpdate | null) ?? null,
    },
    status,
  );
}

/**
 * Independent review pass 2 (item 1), as upsertScheduleItem: `onlyIfAbsent`
 * writes the area only if the cloud has no row for it; `ifUnchangedSince`
 * writes it only if the cloud's row is still that version. Refused, the answer
 * says so (CLOUD_ROW_CHANGED_SINCE_READ) and the row is as it was.
 */
export async function upsertProjectArea(
  area: ProjectArea,
  options: CloudRowWriteCondition = {},
): Promise<SupabaseServiceResult<ProjectArea>> {
  const payload = {
    id: area.id,
    name: area.name,
    area_data: toJsonValue(area),
    updated_at: new Date().toISOString(),
  };
  if (!options.onlyIfAbsent && !options.ifUnchangedSince) {
    return upsertJsonRecord<ProjectArea>({ table: PROJECT_AREAS_TABLE, ownerScoped: true, payload, data: area });
  }
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<ProjectArea>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }
  const row = { ...payload, owner_id: owner.data };
  const written = options.ifUnchangedSince
    ? await client.from(PROJECT_AREAS_TABLE).update(row)
      .eq('owner_id', owner.data).eq('id', area.id).eq('updated_at', options.ifUnchangedSince).select('id, updated_at')
    : await client.from(PROJECT_AREAS_TABLE).upsert(row, { ignoreDuplicates: true }).select('id, updated_at');
  if (written.error) return tableAwareErrorResult<ProjectArea>(written.error.message, written.status);
  if (!Array.isArray(written.data) || written.data.length === 0) {
    return errorResult<ProjectArea>(
      'This GPS area changed in the cloud while the sync was running. This copy was not sent over it.',
      409,
      CLOUD_ROW_CHANGED_SINCE_READ,
    );
  }
  return okResult(withCloudRowVersion(area, toRecord(written.data[0]).updated_at ?? payload.updated_at), written.status);
}

/** When a task or GPS area row may be written (independent review R02 and pass 2). */
export type CloudRowWriteCondition = Readonly<{
  /** Only if the cloud has no row for it. */
  onlyIfAbsent?: boolean;
  /** Only if the cloud's row is still this version (cloudRowVersionOf of the row it was weighed against). */
  ifUnchangedSince?: string | null;
}>;

/**
 * `onlyIfAbsent` (independent review R02): for a task this device believes the
 * cloud does not have. The row is written only if there is none; one that
 * appeared since it was checked is left exactly as it is, and the answer says
 * so (SCHEDULE_ITEM_ALREADY_IN_CLOUD). A row another device wrote can then
 * never be replaced by a copy sent as new.
 *
 * `ifUnchangedSince` (independent review pass 2, item 1): for a task weighed
 * against the cloud's row. The row is written only if it is still the version
 * that was weighed (its `updated_at` as read, which every writer sets): the
 * same conditional write the desktop makes. A row another device has written
 * since is left exactly as it is, and the answer says so
 * (CLOUD_ROW_CHANGED_SINCE_READ): the caller reads it again and weighs again.
 */
export async function upsertScheduleItem(
  item: ScheduleItem,
  { onlyIfAbsent = false, ifUnchangedSince = null }: CloudRowWriteCondition = {},
): Promise<SupabaseServiceResult<ScheduleItem>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<ScheduleItem>();

  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const canonicalProjectId = exactOperationalProjectId(item.projectId);
  if (!canonicalProjectId) {
    return errorResult(
      'The task is missing its exact cloud project identity.',
      409,
      'operational_project_identity_required',
    );
  }
  const boundItem: ScheduleItem = {
    ...item,
    projectId: canonicalProjectId,
  };

  const row = {
    id: item.id,
    owner_id: owner.data,
    project_id: canonicalProjectId,
    project_name: item.projectName,
    task_name: item.taskName,
    item_data: toJsonValue(boundItem),
    updated_at: new Date().toISOString(),
  };
  let written: { data: unknown; error: { message: string } | null; status: number };
  if (onlyIfAbsent) {
    // On a row that exists the cloud does nothing and returns no row. The
    // conflict is on the table's own key, as the plain upsert below has it.
    const inserted = await client
      .from(SCHEDULE_ITEMS_TABLE)
      .upsert(row, { ignoreDuplicates: true })
      .select('id, item_data, updated_at');
    if (!inserted.error && (!Array.isArray(inserted.data) || inserted.data.length === 0)) {
      return errorResult<ScheduleItem>(
        'This task changed in the cloud while the sync was running. This copy was not sent over it.',
        409,
        SCHEDULE_ITEM_ALREADY_IN_CLOUD,
      );
    }
    written = { data: inserted.data?.[0] ?? null, error: inserted.error, status: inserted.status };
  } else if (ifUnchangedSince) {
    // No row is changed unless it is still the version that was weighed.
    const updated = await client
      .from(SCHEDULE_ITEMS_TABLE)
      .update(row)
      .eq('owner_id', owner.data)
      .eq('id', item.id)
      .eq('updated_at', ifUnchangedSince)
      .select('id, item_data, updated_at');
    if (!updated.error && (!Array.isArray(updated.data) || updated.data.length === 0)) {
      return errorResult<ScheduleItem>(
        'This task changed in the cloud while the sync was running. This copy was not sent over it.',
        409,
        CLOUD_ROW_CHANGED_SINCE_READ,
      );
    }
    written = { data: updated.data?.[0] ?? null, error: updated.error, status: updated.status };
  } else {
    written = await client
      .from(SCHEDULE_ITEMS_TABLE)
      .upsert(row)
      .select('id, item_data, updated_at')
      .single();
  }
  const { data, error, status } = written;

  if (error) return tableAwareErrorResult<ScheduleItem>(error.message, status);

  const confirmationRead = {
    errorMessage: null as string | null,
    status,
    row: null as unknown,
  };
  const acknowledged = await confirmScheduleItemCloudAcknowledgement(
    boundItem,
    data,
    async () => {
      const confirmation = await client
        .from(SCHEDULE_ITEMS_TABLE)
        .select('id, item_data')
        .eq('id', item.id)
        .eq('owner_id', owner.data)
        .maybeSingle();
      confirmationRead.errorMessage = confirmation.error?.message || null;
      confirmationRead.status = confirmation.status;
      confirmationRead.row = confirmation.data;
      return confirmation.data;
    },
  );
  if (confirmationRead.errorMessage) {
    return tableAwareErrorResult<ScheduleItem>(
      confirmationRead.errorMessage,
      confirmationRead.status,
    );
  }
  if (!acknowledged) {
    // Name the disagreeing fields. The bare sentence is true of a stale row, a
    // dropped field and a value that cannot survive the round trip alike, and
    // leaves nothing to act on. Field names only, never values.
    return errorResult(
      'The cloud did not confirm the exact saved task revision — ' +
        describeScheduleItemAcknowledgementMismatch(
          boundItem,
          confirmationRead.row ?? data,
        ),
      409,
      'cloud_acknowledgement_missing',
    );
  }

  // The version the row now is: a later write in the same pass is made against it.
  return okResult(withCloudRowVersion(boundItem, toRecord(data).updated_at ?? row.updated_at), status);
}

export async function upsertReferenceDocument(
  document: ReferenceDocument,
  { existing = false }: Readonly<{ existing?: boolean }> = {},
): Promise<SupabaseServiceResult<ReferenceDocument>> {
  // Review pass 1, sync G4 (older; owner answer Q45, 6 Oct 2026). The account this document is sent for holds for
  // everything this call sends: its record, and then its search index (the page text) and the request to prepare
  // it. Those two went out after the record as whoever was signed in by then, in requests that named no account.
  // Now: the account is asked again once the record has answered; if it has changed, the index is not sent and the
  // answer says the account changed, so the document stays waiting for its own account, which sends the record
  // (by its id) and the index again; and both requests say which account they are sent for, so the last look where
  // they leave refuses them under any other sign-in.
  const asOwner = cloudOwnerExpectedForThisCall();
  const compactDocument = compactECOSDocumentIndexForCloud(document);
  const { cloudUpdatedAt: _cloudUpdatedAt, cloudDetailsSeen: _cloudDetailsSeen, ...documentData } = compactDocument;
  const payload = {
    id: document.id,
    name: document.name,
    category: document.category,
    document_data: toJsonValue(documentData),
    updated_at: new Date().toISOString(),
  };
  // A record the cloud already has is updated, not upserted. Postgres runs
  // the guard trigger's insert branch of an upsert first, and that branch
  // refuses every Current drawing, so almost every phone edit to one was
  // refused; the iPad and the web already update (whole-app audit A8 pass 1
  // F3 (30 Sep 2026)). No row updated means the record was not found.
  const result = existing
    ? await updateOwnedJsonRecord<ReferenceDocument>({
        table: REFERENCE_DOCUMENTS_TABLE,
        payload,
        data: document,
        notFoundMessage: 'The shared document record was not found in the cloud. It will be checked again.',
      })
    : await upsertJsonRecord<ReferenceDocument>({
        table: REFERENCE_DOCUMENTS_TABLE,
        ownerScoped: true,
        payload,
        data: document,
      });
  const client = getSupabaseClient();
  if (result.ok && client) {
    if (asOwner) {
      const owner = await requireAuthenticatedOwnerId(client, asOwner);
      if (!owner.ok || !owner.data) return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
    }
    const sentFor = asOwner ? { [CLOUD_REQUEST_ACCOUNT_HEADER]: asOwner } : undefined;
    await replaceECOSDocumentCloudIndex({ client, document, requestHeaders: sentFor });
    await enqueueECOSHostedIndex({ client, documentId: document.id, requestHeaders: sentFor });
  }
  return result;
}

export async function listProjectAreas(): Promise<SupabaseServiceResult<ProjectArea[]>> {
  return listOwnedJsonRecords<ProjectArea>({
    table: PROJECT_AREAS_TABLE,
    jsonColumn: 'area_data',
  });
}

export async function listScheduleItems(): Promise<SupabaseServiceResult<ScheduleItem[]>> {
  return listOwnedJsonRecords<ScheduleItem>({
    table: SCHEDULE_ITEMS_TABLE,
    jsonColumn: 'item_data',
  });
}

/**
 * One task's cloud row, read by its id, as listScheduleItems gives it; null
 * when the cloud has none (whole-app audit A7 pass 15 L-2). The list pages by
 * offset, newest first, so a row edited while it is read moves to page 0 and
 * can be missed: a conflict choice read "not in the list" as deleted.
 */
export async function getScheduleItem(
  id: string,
): Promise<SupabaseServiceResult<ScheduleItem | null>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<ScheduleItem | null>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const { data, error, status } = await client
    .from(SCHEDULE_ITEMS_TABLE)
    .select('id, updated_at, item_data')
    .eq('owner_id', owner.data)
    .eq('id', id)
    .maybeSingle();

  if (error) return tableAwareErrorResult<ScheduleItem | null>(error.message, status);
  if (!data) return okResult<ScheduleItem | null>(null, status);

  const row = toRecord(data);
  const item = toRecord(row.item_data);
  // A row with no task in it is left out of the list too.
  if (Object.keys(item).length === 0) return okResult<ScheduleItem | null>(null, status);
  return okResult(withCloudRowVersion(bindDAVECloudDatabaseIdentity(item, row.id) as ScheduleItem, row.updated_at), status);
}

/**
 * The cloud rows of these tasks, read by their ids, each as listScheduleItems
 * gives it (independent review R02). A task the cloud has no row for is not in
 * the answer. One request for every hundred ids.
 */
export async function getScheduleItemsByIds(
  ids: readonly string[],
): Promise<SupabaseServiceResult<ScheduleItem[]>> {
  const result = await readOwnedRowsByIds(SCHEDULE_ITEMS_TABLE, 'id, updated_at, item_data', ids);
  if (!result.ok || !result.data) return { ...result, data: null };
  return okResult(result.data.flatMap(row => {
    const item = toRecord(row.item_data);
    return Object.keys(item).length === 0 ? [] : [withCloudRowVersion(bindDAVECloudDatabaseIdentity(item, row.id) as ScheduleItem, row.updated_at)];
  }), result.status);
}

/** The cloud rows of these GPS areas, read by their ids, each as listProjectAreas gives it (independent review R02). */
export async function getProjectAreasByIds(
  ids: readonly string[],
): Promise<SupabaseServiceResult<ProjectArea[]>> {
  const result = await readOwnedRowsByIds(PROJECT_AREAS_TABLE, 'id, updated_at, area_data', ids);
  if (!result.ok || !result.data) return { ...result, data: null };
  return okResult(result.data.flatMap(row => {
    const area = toRecord(row.area_data);
    return Object.keys(area).length === 0 ? [] : [withCloudRowVersion(bindDAVECloudDatabaseIdentity(area, row.id) as ProjectArea, row.updated_at)];
  }), result.status);
}

/**
 * Told each time the shared-document list has been read from the cloud, with
 * the account it was read for (owner answer Q44, 6 Oct 2026): the archived
 * marks are read then too, by services/SharedDocumentArchive.ts. The list
 * does not wait for it (review of D1, L12) and is never changed or failed by
 * it: it is shown at once from what the device knows, and the cloud's answer
 * about the marks is applied when it comes.
 */
type ReferenceDocumentsListedListener = (client: SupabaseClient, ownerId: string) => Promise<unknown>;
let referenceDocumentsListedListener: ReferenceDocumentsListedListener | null = null;
export function setReferenceDocumentsListedListener(listener: ReferenceDocumentsListedListener | null): void {
  referenceDocumentsListedListener = listener;
}

export async function listReferenceDocuments(): Promise<SupabaseServiceResult<ReferenceDocument[]>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<ReferenceDocument[]>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  // Document rows can contain multi-megabyte page indexes. Mobile and desktop
  // must share the bounded metadata RPC so routine sync never downloads those
  // indexes merely to compare names, versions, and storage authority.
  const { data, error, status } = await client.rpc(
    'dave_list_reference_document_metadata',
  );
  if (error || !Array.isArray(data)) {
    return errorResult(
      error?.message || 'Authorized reference document metadata could not be loaded.',
      status,
      error?.code,
    );
  }
  void Promise.resolve(owner.data).then(ownerId => referenceDocumentsListedListener?.(client, ownerId)).catch(() => undefined); // told, not waited for
  const documents = data
    .map(value => {
      const row = toRecord(value);
      const documentData = toRecord(row.document_data);
      if (Object.keys(documentData).length === 0) return null;
      const record = bindDAVECloudDatabaseIdentity(documentData, row.id);
      return {
        ...record,
        cloudUpdatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
      } as ReferenceDocument;
    })
    .filter((value): value is ReferenceDocument => Boolean(value));
  const compactDocuments = compactECOSReferenceDocumentsForOperationalRead(documents);
  let statuses: Awaited<ReturnType<typeof loadECOSHostedIndexStatuses>> = [];
  try {
    statuses = await loadECOSHostedIndexStatuses({
      client,
      documentIds: compactDocuments.map(document => document.id),
    });
  } catch {
    // Hosted preparation status is supplemental. Never hide the document library
    // when the status service is temporarily unavailable.
  }
  if (statuses.length === 0) {
    return okResult(compactDocuments, status);
  }
  const statusByDocument = new Map(statuses.map(status => [status.documentId, status]));
  return okResult(compactDocuments.map(document => {
    const hosted = statusByDocument.get(document.id);
    return hosted ? {
      ...document,
      ecosHostedIndexStatus: hosted.customerStatus,
      ecosHostedIndexProgressPercent: hosted.progressPercent,
      ecosHostedIndexCustomerMessage: hosted.customerMessage,
      ecosHostedIndexLimitationCount: hosted.limitationCount,
      ecosHostedIndexSupportReference: hosted.supportReference,
      ecosHostedIndexEvidenceVersion: hosted.committedEvidenceVersion,
      ecosHostedIndexUpdatedAt: hosted.updatedAt,
    } : document;
  }), status);
}

export async function upsertDAVESyncTombstone(
  tombstone: DAVESyncTombstone,
): Promise<SupabaseServiceResult<DAVESyncTombstone>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<DAVESyncTombstone>();

  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const { error, status } = await client
    .from(DAVE_SYNC_TOMBSTONES_TABLE)
    .upsert(
      {
        owner_id: owner.data,
        entity_type: tombstone.entityType,
        record_id: tombstone.recordId,
        deleted_at: tombstone.deletedAt,
      },
      { onConflict: 'owner_id,entity_type,record_id' },
    );

  if (error) return tableAwareErrorResult<DAVESyncTombstone>(error.message, status);
  return okResult(tombstone, status);
}

export async function upsertDAVESyncTombstones(
  tombstones: readonly DAVESyncTombstone[],
): Promise<SupabaseServiceResult<DAVESyncTombstone[]>> {
  if (tombstones.length === 0) return okResult([]);
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<DAVESyncTombstone[]>();

  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const { error, status } = await client
    .from(DAVE_SYNC_TOMBSTONES_TABLE)
    .upsert(
      tombstones.map(tombstone => ({
        owner_id: owner.data,
        entity_type: tombstone.entityType,
        record_id: tombstone.recordId,
        deleted_at: tombstone.deletedAt,
      })),
      { onConflict: 'owner_id,entity_type,record_id' },
    );

  if (error) return tableAwareErrorResult<DAVESyncTombstone[]>(error.message, status);
  return okResult([...tombstones], status);
}

export async function listDAVESyncTombstones(): Promise<
  SupabaseServiceResult<DAVESyncTombstone[]>
> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<DAVESyncTombstone[]>();

  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  // A deletion record has no id of its own: what it deletes (the kind of
  // record, and which) is its key, and the table's (independent review R02).
  const result = await paginateSupabaseCollectionByKey(request => applySupabaseKeysetPage(
    client
      .from(DAVE_SYNC_TOMBSTONES_TABLE)
      .select('entity_type, record_id, deleted_at', {
        count: request.includeExactCount ? 'exact' : undefined,
      })
      .eq('owner_id', owner.data),
    DELETION_RECORD_KEY,
    request,
  ), { key: DELETION_RECORD_KEY, requestExactCount: true });

  if (!result.ok) return tableAwareListResult<DAVESyncTombstone>(result.error, result.status);

  // Newest deletion first, as the list was when the cloud sorted it.
  const tombstones = sortSupabaseRows(
    result.rows,
    { by: row => toRecord(row).deleted_at, time: true, descending: true },
    { by: row => toRecord(row).entity_type },
    { by: row => toRecord(row).record_id },
  )
        .map(deletionRecordOfRow)
        .filter((value): value is DAVESyncTombstone => Boolean(value));

  return okResult(tombstones, result.status);
}

/** A deletion record as the cloud's row has it; null for a row that is not one. */
function deletionRecordOfRow(row: unknown): DAVESyncTombstone | null {
  const record = toRecord(row);
  const entityType = String(record.entity_type || '');
  const recordId = String(record.record_id || '').trim();
  const deletedAt = String(record.deleted_at || '');
  if (
    !recordId ||
    !deletedAt ||
    ![
      'project',
      'project_update',
      'project_area',
      'schedule_item',
      'reference_document',
    ].includes(entityType)
  ) return null;
  return {
    entityType: entityType as DAVESyncTombstone['entityType'],
    recordId,
    deletedAt,
  };
}

/**
 * The deletion records the cloud holds NOW for these records of one kind
 * (sync batch Y1, item 2): asked for just the ids a sync is about to create,
 * not the whole history again. One request for every hundred ids. An id is
 * asked for as given and in lower case: a deletion record keeps the id as its
 * writer had it, and the app compares the two without regard to case.
 */
export async function listDAVESyncTombstonesForRecords(
  entityType: DAVESyncTombstone['entityType'],
  recordIds: readonly string[],
): Promise<SupabaseServiceResult<DAVESyncTombstone[]>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<DAVESyncTombstone[]>();

  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const wanted = [...new Set(recordIds.flatMap(id => (typeof id === 'string' && id.trim() ? [id.trim(), id.trim().toLowerCase()] : [])))];
  const found: DAVESyncTombstone[] = [];
  let lastStatus: number | undefined;
  for (const chunk of chunkSupabaseFilterValues(wanted)) {
    const { data, error, status } = await client
      .from(DAVE_SYNC_TOMBSTONES_TABLE)
      .select('entity_type, record_id, deleted_at')
      .eq('owner_id', owner.data)
      .eq('entity_type', entityType)
      .in('record_id', [...chunk]);
    if (error || !Array.isArray(data)) {
      return tableAwareErrorResult<DAVESyncTombstone[]>(error?.message || 'The cloud did not answer for these deletion records.', status);
    }
    lastStatus = status;
    found.push(...data.map(deletionRecordOfRow).filter((value): value is DAVESyncTombstone => Boolean(value)));
  }
  return okResult(found, lastStatus);
}

/**
 * The owner's shared "since the last report" period for one project set and
 * report format (owner answer Q16, 30 Sep 2026), with the account it was read
 * for. Before the report_snapshots migration is applied the result is the
 * quiet stub of a missing table.
 */
export async function loadReportSnapshotCloud(
  scopeKey: string,
  format: string,
): Promise<SupabaseServiceResult<Readonly<{ ownerId: string; snapshot: unknown }>>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const { data, error, status } = await client
    .from(REPORT_SNAPSHOTS_TABLE)
    .select('snapshot')
    .eq('owner_id', owner.data)
    .eq('scope_key', scopeKey)
    .eq('format', format)
    .maybeSingle();

  if (error) return tableAwareErrorResult(error.message, status);
  return okResult({ ownerId: owner.data, snapshot: data ? toRecord(data).snapshot ?? null : null }, status);
}

/**
 * Upserts the owner's shared period. `deliveredAt` is when the report the
 * period runs from was sent; the table keeps the later one. With
 * `expectedOwnerId`, nothing is written once another account is signed in.
 */
export async function saveReportSnapshotCloud(row: Readonly<{
  scopeKey: string;
  format: string;
  snapshot: unknown;
  approvedAt: string;
  deliveredAt: string | null;
  expectedOwnerId?: string;
}>): Promise<SupabaseServiceResult<null>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }
  if (row.expectedOwnerId && row.expectedOwnerId !== owner.data) {
    return errorResult('The signed-in account changed before the report period was shared.', 409, 'owner_changed');
  }

  const { error, status } = await client
    .from(REPORT_SNAPSHOTS_TABLE)
    .upsert(
      {
        owner_id: owner.data,
        scope_key: row.scopeKey,
        format: row.format,
        snapshot: toJsonValue(row.snapshot),
        approved_at: row.approvedAt,
        delivered_at: row.deliveredAt,
      },
      { onConflict: 'owner_id,scope_key,format' },
    );

  if (error) return tableAwareErrorResult<null>(error.message, status);
  return okResult(null, status);
}

export async function loadLatestDAVEProjectTruthSnapshotCloud(
  organizationId: string,
  projectId: string,
): Promise<SupabaseServiceResult<DAVEProjectTruthSnapshot | null>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<DAVEProjectTruthSnapshot | null>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }
  if (organizationId !== owner.data) {
    return errorResult('Project Truth organization does not match the authenticated owner.', 403);
  }

  const { data, error, status } = await client
    .from(DAVE_PROJECT_TRUTH_SNAPSHOTS_TABLE)
    .select('snapshot')
    .eq('owner_id', owner.data)
    .eq('organization_id', organizationId)
    .eq('project_id', projectId)
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return tableAwareErrorResult<DAVEProjectTruthSnapshot | null>(error.message, status);
  }
  if (!data) return okResult(null, status);
  return okResult(
    (toRecord(data).snapshot as unknown as DAVEProjectTruthSnapshot) || null,
    status,
  );
}

export async function saveDAVEProjectTruthSnapshotCloud(
  snapshot: DAVEProjectTruthSnapshot,
): Promise<SupabaseServiceResult<DAVEProjectTruthSnapshot>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<DAVEProjectTruthSnapshot>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }
  if (snapshot.organizationId !== owner.data) {
    return errorResult('Project Truth organization does not match the authenticated owner.', 403);
  }

  const payload = {
    id: snapshot.id,
    owner_id: owner.data,
    organization_id: snapshot.organizationId,
    project_id: snapshot.projectId,
    project_name: snapshot.projectName,
    revision: snapshot.revision,
    source_fingerprint: snapshot.sourceFingerprint,
    truth_schema_version: snapshot.truthSchemaVersion,
    generated_at: snapshot.generatedAt,
    saved_at: snapshot.savedAt,
    snapshot: toJsonValue(snapshot),
  };
  const { error, status } = await client
    .from(DAVE_PROJECT_TRUTH_SNAPSHOTS_TABLE)
    .insert(payload);

  if (error) {
    if (!isDuplicateKeyError(error.message)) {
      return tableAwareErrorResult<DAVEProjectTruthSnapshot>(error.message, status);
    }
    const latest = await loadLatestDAVEProjectTruthSnapshotCloud(
      snapshot.organizationId,
      snapshot.projectId,
    );
    if (
      latest.ok &&
      latest.data &&
      latest.data.sourceFingerprint === snapshot.sourceFingerprint
    ) {
      return okResult(latest.data, status);
    }
    return errorResult('A newer Project Truth revision already exists.', 409, 'truth_revision_conflict');
  }
  return okResult(snapshot, status);
}

export async function loadPIERealityModelCloud(
  organizationId: string,
  projectId: string,
): Promise<SupabaseServiceResult<PIERealityModel | null>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<PIERealityModel | null>();

  const { data, error, status } = await client
    .from(PIE_REALITY_MODEL_SNAPSHOTS_TABLE)
    .select('snapshot')
    .eq('organization_id', organizationId)
    .eq('project_id', projectId)
    .order('model_version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return tableAwareErrorResult<PIERealityModel | null>(error.message, status);
  if (!data) return okResult(null, status);

  return okResult(toRecord(data).snapshot as PIERealityModel, status);
}

export async function savePIERealityModelCloud(
  model: PIERealityModel,
  reason = 'Reality Model synchronized from live ECOS authority.',
): Promise<SupabaseServiceResult<PIERealityModel>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<PIERealityModel>();

  const modelId = `reality-model-${model.organizationId}-${model.projectId}`;
  const generatedAt = model.generatedAt || new Date().toISOString();
  const modelResult = await upsertJsonRecord<PIERealityModel>({
    table: PIE_REALITY_MODELS_TABLE,
    payload: {
      id: modelId,
      organization_id: model.organizationId,
      project_id: model.projectId,
      model_version: model.version,
      status: model.evidenceConflicts.length > 0 ? 'conflicted' : 'authoritative',
      generated_at: generatedAt,
      last_synchronized_at: new Date().toISOString(),
      source_evidence_cutoff_at: model.sourceEvidenceCutoffAt,
      confidence: model.confidence,
      readiness: model.readiness,
      expected_future_state: model.expectedFutureState,
      summary: toJsonValue(model.summary),
    },
    data: model,
  });

  if (!modelResult.ok) return modelResult;

  const detailResults = await Promise.all([
    savePIERealityObjectsCloud(modelId, model),
    savePIERealityAssertionsCloud(model),
    savePIERealityRelationshipsCloud(modelId, model),
    savePIERealityHistoryCloud(model),
    savePIERealitySnapshotCloud(modelId, model, reason),
    savePIERealityConflictsCloud(model),
    savePIERealityUncertaintiesCloud(model),
  ]);
  const failed = detailResults.find(result => !result.ok);
  if (failed) {
    return tableAwareErrorResult<PIERealityModel>(
      failed.error || failed.message || 'Reality Model cloud detail save failed.',
      failed.status,
    );
  }

  return modelResult;
}

export async function listPIEExecutiveJudgmentsCloud(
  organizationId: string,
  projectId: string,
): Promise<SupabaseServiceResult<PIEExecutiveJudgmentRecord[]>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<PIEExecutiveJudgmentRecord[]>();

  // Read by each row's id (its primary key), then put newest first as before (independent review pass 2, item 4).
  const result = await paginateSupabaseCollectionByKey(request => applySupabaseKeysetPage(
    client
      .from(PIE_EXECUTIVE_JUDGMENTS_TABLE)
      .select('*', { count: request.includeExactCount ? 'exact' : undefined })
      .eq('organization_id', organizationId)
      .eq('project_id', projectId),
    ROW_ID_KEY,
    request,
  ), { key: ROW_ID_KEY });

  if (!result.ok) {
    return tableAwareListResult<PIEExecutiveJudgmentRecord>(result.error, result.status);
  }
  return okResult(
    sortSupabaseRows(
      result.rows,
      { by: row => toRecord(row).judgment_time, time: true, descending: true },
      { by: row => toRecord(row).id },
    ).map(normalizePIEExecutiveJudgmentRow),
    result.status,
  );
}

export async function getActivePIEExecutiveJudgmentCloud(
  organizationId: string,
  projectId: string,
): Promise<SupabaseServiceResult<PIEExecutiveJudgmentRecord | null>> {
  const result = await listPIEExecutiveJudgmentsCloud(organizationId, projectId);
  if (!result.ok) {
    return {
      ok: false,
      configured: result.configured,
      data: null,
      error: result.error,
      message: result.message,
      status: result.status,
      stubbed: result.stubbed,
    };
  }
  return okResult(result.data?.[0] || null, result.status);
}

export async function savePIEExecutiveJudgmentCloud(
  record: PIEExecutiveJudgmentRecord,
): Promise<SupabaseServiceResult<PIEExecutiveJudgmentRecord>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<PIEExecutiveJudgmentRecord>();

  const payload = {
    id: record.id,
    organization_id: record.organizationId,
    project_id: record.projectId,
    reality_model_id: record.realityModelId,
    reality_model_version: record.realityModelVersion,
    reality_snapshot_id: record.realitySnapshotId,
    judgment_time: record.judgmentTime,
    situation_summary: record.situationSummary,
    primary_recommendation: record.primaryRecommendation,
    alternatives_considered: toJsonValue(record.alternativesConsidered),
    tradeoffs: toJsonValue(record.tradeoffs),
    risks: toJsonValue(record.risks),
    constraints: toJsonValue(record.constraints),
    opportunities: toJsonValue(record.opportunities),
    resource_considerations: toJsonValue(record.resourceConsiderations),
    priority_rationale: record.priorityRationale,
    escalation_rationale: record.escalationRationale,
    authority_requirement: record.authorityRequirement,
    no_action_option: record.noActionOption,
    confidence: record.confidence,
    uncertainty: toJsonValue(record.uncertainty),
    supporting_reality_object_ids: toJsonValue(record.supportingRealityObjectIds),
    supporting_assertion_ids: toJsonValue(record.supportingAssertionIds),
    active_conflict_ids: toJsonValue(record.activeConflictIds),
    active_uncertainty_ids: toJsonValue(record.activeUncertaintyIds),
    evidence_cutoff_time: record.evidenceCutoffTime,
    conditions_that_would_change_recommendation: toJsonValue(record.conditionsThatWouldChangeRecommendation),
    superseded_by: record.supersededBy,
    superseded_at: record.supersededAt,
    immutable: true,
  };
  const { error, status } = await client
    .from(PIE_EXECUTIVE_JUDGMENTS_TABLE)
    .insert(payload);

  if (error) {
    if (isDuplicateKeyError(error.message)) return okResult(record, status, 'Executive Judgment already exists in cloud.');
    return tableAwareErrorResult<PIEExecutiveJudgmentRecord>(error.message, status);
  }

  return okResult(record, status);
}

async function savePIERealityObjectsCloud(
  modelId: string,
  model: PIERealityModel,
): Promise<SupabaseServiceResult<null>> {
  if (model.objects.length === 0) return okResult(null);
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<null>();

  const payload = model.objects.map(object => ({
    id: object.identity.id,
    model_id: modelId,
    organization_id: model.organizationId,
    project_id: model.projectId,
    stable_object_id: object.stableObjectId,
    object_type: object.type,
    name: object.name,
    description: object.description,
    current_state: toJsonValue(object.currentState),
    prior_state: object.priorState ? toJsonValue(object.priorState) : null,
    expected_state: object.expectedState ? toJsonValue(object.expectedState) : null,
    owner: object.owner,
    location: object.location,
    area_name: object.areaName,
    readiness: object.readiness,
    risk: object.risk,
    confidence: toJsonValue(object.confidence),
    next_best_action: toJsonValue(object.nextBestAction),
    source_evidence_references: toJsonValue(object.sourceEvidenceReferences),
    last_observed_at: object.lastObservedAt,
    last_changed_at: object.lastChangedAt,
    last_updated_at: object.lastUpdated,
  }));

  const { error, status } = await client
    .from(PIE_REALITY_OBJECTS_TABLE)
    .upsert(payload, { onConflict: 'id' });

  if (error) return tableAwareErrorResult<null>(error.message, status);
  return okResult(null, status);
}

async function savePIERealityAssertionsCloud(
  model: PIERealityModel,
): Promise<SupabaseServiceResult<null>> {
  const assertions = model.objects.flatMap(object => object.assertions);
  if (assertions.length === 0) return okResult(null);
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<null>();

  const payload = assertions.map(assertion => ({
    id: assertion.id,
    organization_id: assertion.organizationId,
    project_id: assertion.projectId,
    object_id: assertion.objectId,
    statement: assertion.statement,
    classification: assertion.classification,
    supporting_evidence_ids: toJsonValue(assertion.supportingEvidenceIds),
    contradicting_evidence_ids: toJsonValue(assertion.contradictingEvidenceIds),
    confidence: assertion.confidence,
    source: assertion.source,
    created_at: assertion.createdAt,
    last_reviewed_at: assertion.lastReviewedAt,
    review_at: assertion.reviewAt,
    expires_at: assertion.expiresAt,
    assumptions: toJsonValue(assertion.assumptions),
    expected_timeframe: assertion.expectedTimeframe,
    explanation: assertion.explanation,
  }));

  const { error, status } = await client
    .from(PIE_REALITY_ASSERTIONS_TABLE)
    .upsert(payload, { onConflict: 'id' });

  if (error) return tableAwareErrorResult<null>(error.message, status);
  return okResult(null, status);
}

async function savePIERealityRelationshipsCloud(
  modelId: string,
  model: PIERealityModel,
): Promise<SupabaseServiceResult<null>> {
  const relationships = model.objects.flatMap(object =>
    object.relationships.map(relationship => ({
      relationship,
      sourceObjectId: object.identity.id,
    })),
  );
  if (relationships.length === 0) return okResult(null);
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<null>();

  const payload = relationships.map(({ relationship, sourceObjectId }) => ({
    id: relationship.id,
    model_id: modelId,
    organization_id: model.organizationId,
    project_id: model.projectId,
    source_object_id: sourceObjectId,
    target_object_id: relationship.targetObjectId,
    relationship_type: relationship.type,
    summary: relationship.summary,
    confidence: relationship.confidence,
  }));

  const { error, status } = await client
    .from(PIE_REALITY_RELATIONSHIPS_TABLE)
    .upsert(payload, { onConflict: 'id' });

  if (error) return tableAwareErrorResult<null>(error.message, status);
  return okResult(null, status);
}

async function savePIERealityHistoryCloud(
  model: PIERealityModel,
): Promise<SupabaseServiceResult<null>> {
  const events = model.objects.flatMap(object =>
    object.history.map(event => ({
      event,
      objectId: object.identity.id,
    })),
  );
  if (events.length === 0) return okResult(null);
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<null>();

  const payload: PIERealityHistoryCloudRow[] = events.map(({ event, objectId }) => ({
    id: event.id,
    organization_id: model.organizationId,
    project_id: model.projectId,
    object_id: objectId,
    occurred_at: event.occurredAt,
    event_type: event.eventType,
    summary: event.summary,
    previous_status: event.previousStatus,
    next_status: event.nextStatus,
  }));

  const inputIntegrity = verifyPIERealityHistoryRows(payload, payload);
  if (!inputIntegrity.ok) {
    return errorResult(
      inputIntegrity.error || 'Reality history contains conflicting duplicate IDs.',
      409,
      'reality_history_immutable_conflict',
    );
  }

  const { error, status } = await client
    .from(PIE_REALITY_OBJECT_HISTORY_TABLE)
    .upsert(payload, { onConflict: 'id', ignoreDuplicates: true });

  if (error) return tableAwareErrorResult<null>(error.message, status);

  const cloudRows: unknown[] = [];
  for (const idChunk of chunkSupabaseFilterValues(payload.map(row => row.id))) {
    const pageResult = await paginateSupabaseCollection(async ({
      from,
      to,
      includeExactCount,
    }) => {
      const response = await client
        .from(PIE_REALITY_OBJECT_HISTORY_TABLE)
        .select(
          'id, organization_id, project_id, object_id, occurred_at, event_type, summary, previous_status, next_status',
          { count: includeExactCount ? 'exact' : undefined },
        )
        .eq('organization_id', model.organizationId)
        .eq('project_id', model.projectId)
        .in('id', [...idChunk])
        .order('id', { ascending: true })
        .range(from, to);
      return response;
    });
    if (!pageResult.ok) {
      return tableAwareErrorResult<null>(pageResult.error, pageResult.status);
    }
    cloudRows.push(...pageResult.rows);
  }

  const verification = verifyPIERealityHistoryRows(payload, cloudRows);
  if (!verification.ok) {
    return errorResult(
      verification.error || 'Reality history immutable verification failed.',
      409,
      'reality_history_immutable_conflict',
    );
  }

  return okResult(null, status);
}

async function savePIERealitySnapshotCloud(
  modelId: string,
  model: PIERealityModel,
  reason: string,
): Promise<SupabaseServiceResult<null>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<null>();

  const payload = {
    id: `reality-snapshot-${model.organizationId}-${model.projectId}-v${model.version}`,
    model_id: modelId,
    organization_id: model.organizationId,
    project_id: model.projectId,
    model_version: model.version,
    source_evidence_cutoff_at: model.sourceEvidenceCutoffAt,
    snapshot: toJsonValue(model),
    reason,
    created_at: model.generatedAt || new Date().toISOString(),
  };

  const { error, status } = await client
    .from(PIE_REALITY_MODEL_SNAPSHOTS_TABLE)
    .insert(payload);

  if (error) {
    if (isDuplicateKeyError(error.message)) return okResult(null, status);
    return tableAwareErrorResult<null>(error.message, status);
  }
  return okResult(null, status);
}

async function savePIERealityConflictsCloud(
  model: PIERealityModel,
): Promise<SupabaseServiceResult<null>> {
  if (model.evidenceConflicts.length === 0) return okResult(null);
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<null>();

  const payload = model.evidenceConflicts.map(conflict => ({
    id: conflict.id,
    organization_id: conflict.organizationId,
    project_id: conflict.projectId,
    affected_object_ids: toJsonValue(conflict.affectedObjectIds),
    affected_assertion_ids: toJsonValue(conflict.affectedAssertionIds),
    supporting_evidence_side_a: toJsonValue(conflict.supportingEvidenceSideA),
    supporting_evidence_side_b: toJsonValue(conflict.supportingEvidenceSideB),
    conflict_type: conflict.conflictType,
    severity: conflict.severity,
    confidence: conflict.confidence,
    status: conflict.status,
    resolution_owner: conflict.resolutionOwner,
    recommended_next_evidence: toJsonValue(conflict.recommendedNextEvidence),
    created_at: conflict.createdAt,
    resolved_at: conflict.resolvedAt,
    resolution_explanation: conflict.resolutionExplanation,
  }));

  const { error, status } = await client
    .from(PIE_REALITY_CONFLICTS_TABLE)
    .upsert(payload, { onConflict: 'id' });

  if (error) return tableAwareErrorResult<null>(error.message, status);
  return okResult(null, status);
}

async function savePIERealityUncertaintiesCloud(
  model: PIERealityModel,
): Promise<SupabaseServiceResult<null>> {
  if (model.activeUncertainties.length === 0) return okResult(null);
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<null>();

  const payload = model.activeUncertainties.map(uncertainty => ({
    id: uncertainty.id,
    organization_id: uncertainty.organizationId,
    project_id: uncertainty.projectId,
    affected_object_id: uncertainty.affectedObjectId,
    affected_assertion_id: uncertainty.affectedAssertionId,
    description: uncertainty.description,
    category: uncertainty.category,
    severity: uncertainty.severity,
    confidence_impact: uncertainty.confidenceImpact,
    evidence_needed: toJsonValue(uncertainty.evidenceNeeded),
    likely_source_of_evidence: uncertainty.likelySourceOfEvidence,
    owner: uncertainty.owner,
    review_at: uncertainty.reviewAt,
    status: uncertainty.status,
    created_at: uncertainty.createdAt,
  }));

  const { error, status } = await client
    .from(PIE_REALITY_UNCERTAINTIES_TABLE)
    .upsert(payload, { onConflict: 'id' });

  if (error) return tableAwareErrorResult<null>(error.message, status);
  return okResult(null, status);
}

export async function savePIEDecisionRecord(
  decision: PIEDecisionRecord,
): Promise<SupabaseServiceResult<PIEDecisionRecord>> {
  return savePIEDecisionRecordAtomic(decision, decision.createdBy);
}

export async function savePIEDecisionRecordAtomic(
  decision: PIEDecisionRecord,
  actor: PIEActor,
): Promise<SupabaseServiceResult<PIEDecisionRecord>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<PIEDecisionRecord>();

  if (!actor.cloudTrusted) {
    return errorResult('Decision ledger cloud save requires verified organization membership.');
  }

  const { data, error, status } = await client.rpc(
    'save_pie_decision_record_atomic',
    {
      decision_payload: toJsonValue(decision),
      actor_payload: toJsonValue(actor),
    },
  );

  if (error) return tableAwareErrorResult<PIEDecisionRecord>(error.message, status);
  return okResult(
    data ? normalizePIEDecisionPayload(data) : decision,
    status,
  );
}

export async function savePIEDecisionRecordNonAtomicForTesting(
  decision: PIEDecisionRecord,
): Promise<SupabaseServiceResult<PIEDecisionRecord>> {
  const recordResult = await upsertJsonRecord<PIEDecisionRecord>({
    table: PIE_DECISION_RECORDS_TABLE,
    payload: {
      id: decision.id,
      organization_id: decision.organizationId,
      project_id: decision.projectId,
      current_status: decision.currentStatus,
      current_version: decision.currentVersion,
      immutable_snapshot: toJsonValue(decision.immutableSnapshot),
      outcome_plan: decision.outcomePlan ? toJsonValue(decision.outcomePlan) : null,
      implementation_assessment: decision.implementationAssessment
        ? toJsonValue(decision.implementationAssessment)
        : null,
      created_by: toJsonValue(decision.createdBy),
      created_at: decision.createdAt,
      updated_at: decision.updatedAt,
      close_blockers: toJsonValue(decision.closeBlockers),
    },
    data: decision,
  });

  if (!recordResult.ok) return recordResult;

  const [versionsResult, outcomesResult, auditResult] = await Promise.all([
    savePIEDecisionVersions(decision.versions, decision),
    savePIEDecisionOutcomes(decision.actualOutcomes),
    savePIEDecisionAuditEvents(decision.auditHistory),
  ]);

  const failed = [versionsResult, outcomesResult, auditResult]
    .find(result => !result.ok);

  if (failed) {
    return tableAwareErrorResult<PIEDecisionRecord>(
      failed.error || failed.message || 'Decision ledger detail save failed.',
      failed.status,
    );
  }

  return recordResult;
}

export async function listPIEDecisionRecords(
  organizationId: string,
  projectId?: string | null,
): Promise<SupabaseServiceResult<PIEDecisionRecord[]>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<PIEDecisionRecord[]>();

  // Each of the four tables is read by its rows' id (their primary keys, in the ledger's migration), then put in the
  // order the cloud gave them before (independent review pass 2, item 4): decisions newest first; a decision's
  // versions by number, its outcomes and its audit events oldest first.
  const readByRowId = (table: string) => paginateSupabaseCollectionByKey<unknown>(request => {
    const query = client
      .from(table)
      .select('*', { count: request.includeExactCount ? 'exact' : undefined })
      .eq('organization_id', organizationId);
    return applySupabaseKeysetPage(projectId ? query.eq('project_id', projectId) : query, ROW_ID_KEY, request);
  }, { key: ROW_ID_KEY });
  const column = (name: string) => (row: unknown) => toRecord(row)[name];

  const decisionsRead = await readByRowId(PIE_DECISION_RECORDS_TABLE);
  if (!decisionsRead.ok) {
    return tableAwareListResult<PIEDecisionRecord>(decisionsRead.error, decisionsRead.status);
  }
  const recordsResult = {
    ...decisionsRead,
    rows: sortSupabaseRows(decisionsRead.rows, { by: column('created_at'), time: true, descending: true }, { by: column('id') }),
  };
  if (recordsResult.rows.length === 0) return okResult([], recordsResult.status);

  const [versionsRead, outcomesRead, auditRead] = await Promise.all([
    readByRowId(PIE_DECISION_VERSIONS_TABLE),
    readByRowId(PIE_DECISION_OUTCOMES_TABLE),
    readByRowId(PIE_DECISION_AUDIT_EVENTS_TABLE),
  ]);
  const inOrder = (read: typeof versionsRead, second: SupabaseRowOrder<unknown>): typeof versionsRead => (read.ok
    ? { ...read, rows: sortSupabaseRows(read.rows, { by: column('decision_id') }, second, { by: column('id') }) }
    : read);
  const versionsResult = inOrder(versionsRead, { by: column('version') });
  const outcomesResult = inOrder(outcomesRead, { by: column('created_at'), time: true });
  const auditResult = inOrder(auditRead, { by: column('created_at'), time: true });

  const failedChildren = [versionsResult, outcomesResult, auditResult]
    .find(result => !result.ok);
  if (failedChildren && !failedChildren.ok) {
    return tableAwareListResult<PIEDecisionRecord>(
      failedChildren.error,
      failedChildren.status,
    );
  }

  const versionsByDecision = groupRowsByDecisionId(versionsResult.rows);
  const outcomesByDecision = groupRowsByDecisionId(outcomesResult.rows);
  const auditByDecision = groupRowsByDecisionId(auditResult.rows);
  const rowsWithChildren = recordsResult.rows.map(row => {
    const record = toRecord(row);
    const decisionId = String(record.id || '');
    return {
      ...record,
      pie_decision_versions: versionsByDecision.get(decisionId) || [],
      pie_decision_outcomes: outcomesByDecision.get(decisionId) || [],
      pie_decision_audit_events: auditByDecision.get(decisionId) || [],
    };
  });

  return okResult(
    rowsWithChildren.map(row => normalizePIEDecisionRow(row)),
    recordsResult.status,
  );
}

async function savePIEDecisionVersions(
  versions: PIEDecisionVersion[],
  decision: PIEDecisionRecord,
): Promise<SupabaseServiceResult<null>> {
  if (versions.length === 0) return okResult(null);
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<null>();

  const payload = versions.map(version => ({
    decision_id: decision.id,
    organization_id: decision.organizationId,
    project_id: decision.projectId,
    version: version.version,
    snapshot: toJsonValue(version.snapshot),
    created_by: toJsonValue(version.createdBy),
    created_at: version.createdAt,
    reason: version.reason,
  }));

  const { error, status } = await client
    .from(PIE_DECISION_VERSIONS_TABLE)
    .upsert(payload, { onConflict: 'decision_id,version' });

  if (error) return tableAwareErrorResult<null>(error.message, status);
  return okResult(null, status);
}

async function savePIEDecisionOutcomes(
  outcomes: PIEActualOutcomeRecord[],
): Promise<SupabaseServiceResult<null>> {
  if (outcomes.length === 0) return okResult(null);
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<null>();

  const payload = outcomes.map(outcome => ({
    id: outcome.id,
    decision_id: outcome.decisionId,
    organization_id: outcome.organizationId,
    project_id: outcome.projectId,
    classification: outcome.classification,
    summary: outcome.summary,
    actual_results: toJsonValue(outcome.actualResults),
    measured_values: toJsonValue(outcome.measuredValues),
    prediction_comparisons: toJsonValue(outcome.predictionComparisons),
    evidence_references: toJsonValue(outcome.evidenceReferences),
    unintended_consequences: toJsonValue(outcome.unintendedConsequences),
    confounding_factors: toJsonValue(outcome.confoundingFactors),
    observation_period: toJsonValue(outcome.observationPeriod),
    validation_status: outcome.validationStatus,
    validator: outcome.validator ? toJsonValue(outcome.validator) : null,
    validation_date: outcome.validationDate,
    created_by: toJsonValue(outcome.createdBy),
    created_at: outcome.createdAt,
  }));

  const { error, status } = await client
    .from(PIE_DECISION_OUTCOMES_TABLE)
    .upsert(payload);

  if (error) return tableAwareErrorResult<null>(error.message, status);
  return okResult(null, status);
}

async function savePIEDecisionAuditEvents(
  auditEvents: PIEAuditEvent[],
): Promise<SupabaseServiceResult<null>> {
  if (auditEvents.length === 0) return okResult(null);
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<null>();

  const payload = auditEvents.map(event => ({
    id: event.id,
    decision_id: event.decisionId,
    organization_id: event.organizationId,
    project_id: event.projectId,
    field: event.field,
    previous_value: event.previousValue,
    new_value: event.newValue,
    changed_by: toJsonValue(event.changedBy),
    reason: event.reason,
    source: event.source,
    linked_evidence: toJsonValue(event.linkedEvidence),
    automation: event.automation ? toJsonValue(event.automation) : null,
    created_at: event.timestamp,
  }));

  const { error, status } = await client
    .from(PIE_DECISION_AUDIT_EVENTS_TABLE)
    .upsert(payload);

  if (error) return tableAwareErrorResult<null>(error.message, status);
  return okResult(null, status);
}

function normalizePIEDecisionRow(row: unknown): PIEDecisionRecord {
  const record = toRecord(row);
  const snapshot = toRecord(record.immutable_snapshot) as PIEDecisionRecord['immutableSnapshot'];
  const createdBy = toRecord(record.created_by) as PIEDecisionRecord['createdBy'];
  const versions = Array.isArray(record.pie_decision_versions)
    ? record.pie_decision_versions.map(normalizePIEDecisionVersion)
    : [];
  const outcomes = Array.isArray(record.pie_decision_outcomes)
    ? record.pie_decision_outcomes.map(normalizePIEDecisionOutcome)
    : [];
  const auditEvents = Array.isArray(record.pie_decision_audit_events)
    ? record.pie_decision_audit_events.map(normalizePIEDecisionAuditEvent)
    : [];
  return {
    id: String(record.id || ''),
    organizationId: String(record.organization_id || ''),
    projectId: String(record.project_id || ''),
    currentStatus: String(record.current_status || 'proposed') as PIEDecisionRecord['currentStatus'],
    currentVersion: typeof record.current_version === 'number' ? record.current_version : 1,
    immutableSnapshot: snapshot,
    versions,
    outcomePlan: record.outcome_plan
      ? toRecord(record.outcome_plan) as PIEDecisionRecord['outcomePlan']
      : null,
    implementationAssessment: record.implementation_assessment
      ? toRecord(record.implementation_assessment) as PIEDecisionRecord['implementationAssessment']
      : null,
    actualOutcomes: outcomes,
    auditHistory: auditEvents,
    createdAt: typeof record.created_at === 'string' ? record.created_at : new Date().toISOString(),
    createdBy,
    updatedAt: typeof record.updated_at === 'string' ? record.updated_at : new Date().toISOString(),
    closeBlockers: Array.isArray(record.close_blockers)
      ? record.close_blockers.map(String)
      : [],
  };
}

function groupRowsByDecisionId(rows: readonly unknown[]) {
  const grouped = new Map<string, unknown[]>();
  for (const row of rows) {
    const decisionId = String(toRecord(row).decision_id || '');
    if (!decisionId) continue;
    grouped.set(decisionId, [...(grouped.get(decisionId) || []), row]);
  }
  return grouped;
}

function normalizePIEDecisionVersion(row: unknown): PIEDecisionVersion {
  const record = toRecord(row);
  return {
    version: typeof record.version === 'number' ? record.version : Number(record.version || 1),
    snapshot: toRecord(record.snapshot) as PIEDecisionVersion['snapshot'],
    createdAt: typeof record.created_at === 'string' ? record.created_at : new Date().toISOString(),
    createdBy: toRecord(record.created_by) as PIEDecisionVersion['createdBy'],
    reason: String(record.reason || 'Decision version.'),
  };
}

function normalizePIEDecisionOutcome(row: unknown): PIEActualOutcomeRecord {
  const record = toRecord(row);
  return {
    id: String(record.id || ''),
    decisionId: String(record.decision_id || ''),
    organizationId: String(record.organization_id || ''),
    projectId: String(record.project_id || ''),
    classification: String(record.classification || 'inconclusive') as PIEActualOutcomeRecord['classification'],
    summary: String(record.summary || ''),
    actualResults: Array.isArray(record.actual_results) ? record.actual_results.map(String) : [],
    measuredValues: toRecord(record.measured_values) as PIEActualOutcomeRecord['measuredValues'],
    predictionComparisons: Array.isArray(record.prediction_comparisons)
      ? record.prediction_comparisons as PIEActualOutcomeRecord['predictionComparisons']
      : [],
    evidenceReferences: Array.isArray(record.evidence_references)
      ? record.evidence_references as PIEActualOutcomeRecord['evidenceReferences']
      : [],
    unintendedConsequences: Array.isArray(record.unintended_consequences)
      ? record.unintended_consequences.map(String)
      : [],
    confoundingFactors: Array.isArray(record.confounding_factors)
      ? record.confounding_factors.map(String)
      : [],
    observationPeriod: toRecord(record.observation_period) as PIEActualOutcomeRecord['observationPeriod'],
    validationStatus: String(record.validation_status || 'unvalidated') as PIEActualOutcomeRecord['validationStatus'],
    validator: record.validator ? toRecord(record.validator) as PIEActualOutcomeRecord['validator'] : null,
    validationDate: typeof record.validation_date === 'string' ? record.validation_date : null,
    createdAt: typeof record.created_at === 'string' ? record.created_at : new Date().toISOString(),
    createdBy: toRecord(record.created_by) as PIEActualOutcomeRecord['createdBy'],
  };
}

function normalizePIEDecisionAuditEvent(row: unknown): PIEAuditEvent {
  const record = toRecord(row);
  return {
    id: String(record.id || ''),
    decisionId: String(record.decision_id || ''),
    organizationId: String(record.organization_id || ''),
    projectId: String(record.project_id || ''),
    field: String(record.field || ''),
    previousValue: typeof record.previous_value === 'string' ? record.previous_value : null,
    newValue: typeof record.new_value === 'string' ? record.new_value : null,
    timestamp: typeof record.created_at === 'string' ? record.created_at : new Date().toISOString(),
    changedBy: toRecord(record.changed_by) as PIEAuditEvent['changedBy'],
    reason: String(record.reason || ''),
    source: String(record.source || 'sync') as PIEAuditEvent['source'],
    linkedEvidence: Array.isArray(record.linked_evidence)
      ? record.linked_evidence as PIEAuditEvent['linkedEvidence']
      : [],
    automation: record.automation ? toRecord(record.automation) as PIEAuditEvent['automation'] : null,
  };
}

function normalizePIEExecutiveJudgmentRow(row: unknown): PIEExecutiveJudgmentRecord {
  const record = toRecord(row);
  return {
    id: String(record.id || ''),
    organizationId: String(record.organization_id || ''),
    projectId: String(record.project_id || ''),
    realityModelId: String(record.reality_model_id || ''),
    realityModelVersion: typeof record.reality_model_version === 'number'
      ? record.reality_model_version
      : Number(record.reality_model_version || 1),
    realitySnapshotId: String(record.reality_snapshot_id || ''),
    judgmentTime: typeof record.judgment_time === 'string'
      ? record.judgment_time
      : new Date().toISOString(),
    situationSummary: String(record.situation_summary || ''),
    primaryRecommendation: String(record.primary_recommendation || ''),
    alternativesConsidered: Array.isArray(record.alternatives_considered)
      ? record.alternatives_considered.map(String)
      : [],
    tradeoffs: toRecord(record.tradeoffs) as PIEExecutiveJudgmentRecord['tradeoffs'],
    risks: Array.isArray(record.risks) ? record.risks as PIEExecutiveJudgmentRecord['risks'] : [],
    constraints: Array.isArray(record.constraints)
      ? record.constraints as PIEExecutiveJudgmentRecord['constraints']
      : [],
    opportunities: Array.isArray(record.opportunities)
      ? record.opportunities as PIEExecutiveJudgmentRecord['opportunities']
      : [],
    resourceConsiderations: Array.isArray(record.resource_considerations)
      ? record.resource_considerations.map(String)
      : [],
    priorityRationale: String(record.priority_rationale || ''),
    escalationRationale: String(record.escalation_rationale || ''),
    authorityRequirement: String(record.authority_requirement || 'User'),
    noActionOption: String(record.no_action_option || ''),
    confidence: String(record.confidence || 'medium') as PIEExecutiveJudgmentRecord['confidence'],
    uncertainty: Array.isArray(record.uncertainty) ? record.uncertainty.map(String) : [],
    supportingRealityObjectIds: Array.isArray(record.supporting_reality_object_ids)
      ? record.supporting_reality_object_ids.map(String)
      : [],
    supportingAssertionIds: Array.isArray(record.supporting_assertion_ids)
      ? record.supporting_assertion_ids.map(String)
      : [],
    activeConflictIds: Array.isArray(record.active_conflict_ids)
      ? record.active_conflict_ids.map(String)
      : [],
    activeUncertaintyIds: Array.isArray(record.active_uncertainty_ids)
      ? record.active_uncertainty_ids.map(String)
      : [],
    evidenceCutoffTime: typeof record.evidence_cutoff_time === 'string'
      ? record.evidence_cutoff_time
      : new Date().toISOString(),
    conditionsThatWouldChangeRecommendation: Array.isArray(record.conditions_that_would_change_recommendation)
      ? record.conditions_that_would_change_recommendation.map(String)
      : [],
    supersededBy: typeof record.superseded_by === 'string' ? record.superseded_by : null,
    supersededAt: typeof record.superseded_at === 'string' ? record.superseded_at : null,
    immutable: true,
  };
}

function normalizePIEDecisionPayload(payload: unknown): PIEDecisionRecord {
  const record = toRecord(payload);
  if ('organizationId' in record && 'immutableSnapshot' in record) {
    return record as PIEDecisionRecord;
  }
  return normalizePIEDecisionRow(record);
}

function startSupabaseAuthLifecycle(client: SupabaseClient | null) {
  if (!client) return;

  void client.auth.getSession()
    .then(() => {
      authHydrationCompleted = true;
      if (lastAuthEvent === 'UNKNOWN') lastAuthEvent = 'INITIAL_SESSION';
    })
    .catch(() => {
      authHydrationCompleted = true;
      if (lastAuthEvent === 'UNKNOWN') lastAuthEvent = 'INITIAL_SESSION';
    });

  client.auth.onAuthStateChange((event, session) => {
    authHydrationCompleted = true;
    lastAuthEvent = event;
    // Uploads bind to the signed-in account (whole-app audit A1 M3).
    const decision = ownerWorkspaceAuthDecision(event, session?.user?.id);
    if (decision.action === 'activate') noteSignedInOwner(decision.ownerId);
  });

  if (authAutoRefreshSubscriptionStarted) return;
  authAutoRefreshSubscriptionStarted = true;

  if (AppState.currentState === 'active') {
    client.auth.startAutoRefresh();
  }

  AppState.addEventListener('change', state => {
    if (appInForeground && state !== 'active') appLeftForegroundCount += 1;
    appInForeground = state === 'active';
    if (state === 'active') {
      client.auth.startAutoRefresh();
    } else {
      client.auth.stopAutoRefresh();
    }
  });
}

async function waitForAuthHydration(timeoutMs: number) {
  if (authHydrationCompleted) return true;

  const startedAt = Date.now();
  while (!authHydrationCompleted && Date.now() - startedAt < timeoutMs) {
    await delay(AUTH_HYDRATION_POLL_MS);
  }

  return authHydrationCompleted;
}

async function requireAuthenticatedOwnerId(
  client: SupabaseClient,
  /**
   * Sync batch Y4 (the account boundary; owner answer Q45): the account this call must be made as, when its caller
   * started it with callAsCloudOwner. Read in the instant the call starts. Another account signed in: refused, and
   * nothing is sent. So the owner a write names is never "whoever is signed in by now".
   */
  expectedOwnerId: string | null = cloudOwnerExpectedForThisCall(),
): Promise<SupabaseServiceResult<string>> {
  const hydrated = await waitForAuthHydration(AUTH_HYDRATION_WAIT_MS);
  if (!hydrated) {
    return errorResult(
      'Authentication is still loading. Try cloud sync again in a moment.',
      503,
      'auth_loading',
    );
  }

  const { data, error } = await client.auth.getSession();
  if (error) return errorResult(error.message, 401, 'auth_required');
  const session = data.session;
  if (!session?.access_token || !session.user?.id) {
    return errorResult(
      'Sign in is required before cloud data can be accessed.',
      401,
      'auth_required',
    );
  }
  if (
    typeof session.expires_at === 'number' &&
    session.expires_at * 1000 <= Date.now()
  ) {
    return errorResult(
      'The sign-in session expired. Sign in again before cloud sync.',
      401,
      'session_expired',
    );
  }
  if (expectedOwnerId && session.user.id !== expectedOwnerId) {
    return errorResult(CLOUD_ACCOUNT_CHANGED_MESSAGE, 409, CLOUD_ACCOUNT_CHANGED);
  }

  return okResult(session.user.id);
}

async function probeAuthStorage(): Promise<boolean> {
  // Probes the real auth storage adapter (SecureStore-backed), not
  // AsyncStorage, so storageAvailable reflects where tokens actually live.
  try {
    if (!(await isAuthStorageSecure())) return false;
    await supabaseAuthStorage.setItem(AUTH_STORAGE_PROBE_KEY, 'ok');
    const stored = await supabaseAuthStorage.getItem(AUTH_STORAGE_PROBE_KEY);
    await supabaseAuthStorage.removeItem(AUTH_STORAGE_PROBE_KEY);
    return stored === 'ok';
  } catch {
    return false;
  }
}

function buildSessionTokenLookup({
  session = null,
  storageAvailable,
  authState,
  missingReason,
}: {
  session?: Session | null;
  storageAvailable: boolean;
  authState: SupabaseAuthSessionState;
  missingReason: SupabaseSessionMissingReason | null;
}): SupabaseSessionTokenLookupResult {
  const tokenLookupClientSource = SUPABASE_CLIENT_SOURCE;
  const clientMismatch = lastSignInClientSource !== tokenLookupClientSource;
  const accessToken =
    missingReason === null && session?.access_token
      ? session.access_token
      : null;
  const sessionTokenPresent = Boolean(accessToken);
  const supabaseUserIdPresent = Boolean(session?.user?.id);
  const appAuthMode =
    sessionTokenPresent && supabaseUserIdPresent
      ? 'supabase_authenticated'
      : missingReason === 'auth_loading' || clientMismatch
        ? 'unknown'
        : 'local_only';

  return {
    status: sessionTokenPresent ? 'token_present' : 'token_missing',
    accessToken,
    missingReason: clientMismatch ? 'client_mismatch' : missingReason,
    authState: clientMismatch ? 'unknown' : authState,
    appAuthMode,
    authHydrationCompleted,
    storageAvailable,
    signInClientSource: lastSignInClientSource,
    tokenLookupClientSource,
    clientMismatch,
    supabaseUserIdPresent,
    sessionTokenPresent,
    lastAuthEvent,
    userId: session?.user?.id ?? null,
    userEmail: session?.user?.email ?? null,
    expiresAt: typeof session?.expires_at === 'number' ? session.expires_at : null,
    checkedAt: new Date().toISOString(),
  };
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function okResult<T>(
  data: T | null,
  status?: number,
  message?: string,
): SupabaseServiceResult<T> {
  return {
    ok: true,
    configured: true,
    data,
    status,
    message,
  };
}

function notConfiguredResult<T>(): SupabaseServiceResult<T> {
  return {
    ok: false,
    configured: false,
    data: null,
    error:
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to enable cloud sync.',
  };
}

function errorResult<T>(
  error: string,
  status?: number,
  code?: string,
): SupabaseServiceResult<T> {
  return {
    ok: false,
    configured: true,
    data: null,
    error,
    status,
    code,
  };
}

function stubResult<T>(
  message: string,
  status?: number,
  data: T | null = null,
): SupabaseServiceResult<T> {
  return {
    ok: true,
    configured: true,
    data,
    status,
    message,
    stubbed: true,
  };
}

function tableAwareErrorResult<T>(
  error: string,
  status?: number,
): SupabaseServiceResult<T> {
  if (isMissingTableError(error)) {
    return stubResult<T>(
      'Supabase is configured, but the required database table is not available yet.',
      status,
    );
  }

  return errorResult(error, status);
}

function tableAwareListResult<T>(
  error: string,
  status?: number,
): SupabaseServiceResult<T[]> {
  if (isMissingTableError(error)) {
    return stubResult<T[]>(
      'Supabase is configured, but this database table is not available yet.',
      status,
      [],
    );
  }

  return errorResult<T[]>(error, status);
}

async function upsertJsonRecord<T>({
  table,
  payload,
  data,
  ownerScoped = false,
}: {
  table: string;
  payload: Record<string, unknown>;
  data: T;
  ownerScoped?: boolean;
}): Promise<SupabaseServiceResult<T>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<T>();
  let writePayload = payload;
  if (ownerScoped) {
    const owner = await requireAuthenticatedOwnerId(client);
    if (!owner.ok || !owner.data) {
      return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
    }
    writePayload = {
      ...payload,
      owner_id: owner.data,
    };
  }

  const { error, status } = await client.from(table).upsert(writePayload);

  if (error) return tableAwareErrorResult<T>(error.message, status);

  return okResult(data, status);
}

async function updateOwnedJsonRecord<T>({
  table,
  payload: { id, ...values },
  data,
  notFoundMessage,
}: {
  table: string;
  payload: Record<string, unknown> & { id: string };
  data: T;
  notFoundMessage: string;
}): Promise<SupabaseServiceResult<T>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<T>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const { data: rows, error, status } = await client
    .from(table)
    .update(values)
    .eq('id', id)
    .eq('owner_id', owner.data)
    .select('id');

  if (error) return tableAwareErrorResult<T>(error.message, status);
  if (!Array.isArray(rows) || rows.length === 0) {
    return errorResult<T>(notFoundMessage, 404, 'not_found');
  }

  return okResult(data, status);
}

/**
 * Independent review R02 (Build 229): this account's lists are read whole, one
 * page after another, and what is done next treats a record that is not in
 * the list as one the cloud does not have. Read by offset, a list said ok
 * with a row missing when another device edited or deleted a row between two
 * pages.
 *
 * Independent review pass 2 (item 4): these lists are read by key, not by
 * offset. A list read by offset newest first is disturbed by every write
 * elsewhere, and while a schedule's hundreds of tasks were going up from one
 * device every other read of the task list failed until it stopped. Read in
 * the order of each row's own `id`, which no edit changes, an edit elsewhere
 * can neither repeat a row nor hide one, and nothing is read again.
 * (paginateSupabaseCollectionByKey says what the count still does.)
 *
 * What is assumed of the cloud, which this app cannot see: within one
 * account a row's `id` is that row's alone and never changes. The task and
 * area writes already rest on that (an upsert on the table's key, a read by
 * `id` that expects one row); the field update write names `id` as its
 * conflict key; projects are read and written by `id`. Deletion records: the
 * table's key is (owner_id, entity_type, record_id), in its migration.
 */
const ROW_ID_KEY = Object.freeze(['id'] as const);
const LIST_READ_BY_ROW_ID = Object.freeze({ key: ROW_ID_KEY, requestExactCount: true });
const DELETION_RECORD_KEY = Object.freeze(['entity_type', 'record_id'] as const);

/** Newest created first, then by id: the order the cloud gave projects and field updates. */
function newestCreatedFirst<T>(rows: readonly T[]): T[] {
  return sortSupabaseRows(
    rows,
    { by: row => toRecord(row).created_at, time: true, descending: true },
    { by: row => toRecord(row).id },
  );
}

/**
 * This account's rows with these exact ids, in as few requests as the ids
 * allow (independent review R02): what a list did not hold is confirmed by id
 * before it is taken as absent. A row that is not returned is not there.
 */
async function readOwnedRowsByIds(
  table: string,
  columns: string,
  ids: readonly string[],
): Promise<SupabaseServiceResult<Record<string, unknown>[]>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<Record<string, unknown>[]>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const wanted = [...new Set(ids.filter(id => typeof id === 'string' && id.trim()))];
  const rows: Record<string, unknown>[] = [];
  let lastStatus: number | undefined;
  for (const chunk of chunkSupabaseFilterValues(wanted)) {
    const { data, error, status } = await client
      .from(table)
      .select(columns)
      .eq('owner_id', owner.data)
      .in('id', [...chunk]);
    if (error || !Array.isArray(data)) {
      return tableAwareErrorResult<Record<string, unknown>[]>(
        error?.message || 'The cloud did not answer for these records.',
        status,
      );
    }
    lastStatus = status;
    rows.push(...data.map(toRecord));
  }
  return okResult(rows, lastStatus);
}

async function listOwnedJsonRecords<T>({
  table,
  jsonColumn,
  includeCloudUpdatedAt = false,
  pageSize,
}: {
  table: string;
  jsonColumn: string;
  includeCloudUpdatedAt?: boolean;
  pageSize?: number;
}): Promise<SupabaseServiceResult<T[]>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<T[]>();

  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const result = await paginateSupabaseCollectionByKey(
    request => applySupabaseKeysetPage(
      client
        .from(table)
        .select(`id, updated_at, ${jsonColumn}`, { count: request.includeExactCount ? 'exact' : undefined })
        .eq('owner_id', owner.data),
      ROW_ID_KEY,
      request,
    ),
    LIST_READ_BY_ROW_ID,
    pageSize,
  );

  if (!result.ok) return tableAwareListResult<T>(result.error, result.status);

  // Most recently written first, as the list was when the cloud sorted it.
  const records = sortSupabaseRows(
    result.rows,
    { by: row => toRecord(row).updated_at, time: true, descending: true },
    { by: row => toRecord(row).id },
  )
    .map(row => {
      const databaseRow = toRecord(row);
      const jsonRecord = toRecord(databaseRow[jsonColumn]);
      if (Object.keys(jsonRecord).length === 0) return null;
      // The database row is the durable identity. Legacy JSON may omit its id
      // or contain an old conflicting id; using the row id prevents a later
      // upload from manufacturing a second cloud record.
      const record = bindDAVECloudDatabaseIdentity(jsonRecord, databaseRow.id);
      // The row's version goes beside the record, never in it (independent review pass 2, item 1).
      return withCloudRowVersion((includeCloudUpdatedAt
        ? {
            ...record,
            cloudUpdatedAt:
              typeof databaseRow.updated_at === 'string'
                ? databaseRow.updated_at
                : null,
          }
        : record) as T, databaseRow.updated_at);
    })
    .filter((value): value is T => Boolean(value));

  return okResult(records, result.status);
}

function isMissingTableError(message: string): boolean {
  const normalized = message.toLowerCase();

  // Deliberately narrow: only PostgREST's "missing table" message (PGRST205,
  // "Could not find the table 'x' in the schema cache") and Postgres's own
  // "relation ... does not exist" (42P01). A bare "schema cache" or "does not
  // exist" check also matches PGRST204 ("Could not find the 'x' column of
  // 'y' in the schema cache") and "column ... does not exist" - i.e. a real,
  // permanent schema-drift error - which must NOT be treated as a soft
  // "table not available yet" stub or it silently masks broken writes.
  return (
    normalized.includes('could not find the table') ||
    (normalized.includes('relation') && normalized.includes('does not exist'))
  );
}

function isDuplicateKeyError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('duplicate key') ||
    normalized.includes('already exists') ||
    normalized.includes('unique constraint')
  );
}

function appendRelatedDeleteError(
  errors: string[],
  label: string,
  message?: string,
) {
  if (!message || isMissingTableError(message)) return;

  errors.push(`${label}: ${message}`);
}

function recordMatchesProject(value: unknown, projectName: string): boolean {
  const record = toRecord(value);
  const expected = projectName.toLowerCase();
  const candidates = [
    record.projectName,
    record.project_name,
    record.project,
    record.name,
  ];

  return candidates.some(
    candidate =>
      typeof candidate === 'string' &&
      candidate.trim().toLowerCase() === expected,
  );
}

async function fetchDiagnosticStep(
  label: string,
  url: string,
  init?: RequestInit,
): Promise<SupabaseDiagnosticStep> {
  try {
    const response = await fetch(url, init);
    const responsePreview = await safeResponsePreview(response);
    const statusText = response.statusText || '';

    return {
      label,
      url,
      ok: response.ok,
      reachedNetwork: true,
      status: response.status,
      statusText,
      responsePreview,
      errorMessage: response.ok
        ? undefined
        : `HTTP ${response.status}${statusText ? ` ${statusText}` : ''}`,
    };
  } catch (error) {
    return {
      label,
      url,
      ok: false,
      reachedNetwork: false,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage:
        error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    };
  }
}

function missingUrlStep(
  label: string,
  url: string,
  message = 'Missing EXPO_PUBLIC_SUPABASE_URL.',
): SupabaseDiagnosticStep {
  return {
    label,
    url,
    ok: false,
    reachedNetwork: false,
    errorName: 'ConfigurationError',
    errorMessage: message,
  };
}

async function safeResponsePreview(response: Response): Promise<string> {
  try {
    const text = await response.text();

    return text.trim().slice(0, 500);
  } catch (error) {
    return error instanceof Error
      ? `Response body could not be read: ${error.message}`
      : 'Response body could not be read.';
  }
}

function withoutTrailingSlash(value: string) {
  return value.replace(/\/+$/g, '');
}

function normalizeProject(value: unknown): CloudProject {
  const row = toRecord(value);

  return {
    id: typeof row.id === 'string' ? row.id : null,
    name: String(row.name || 'Untitled Project'),
    status: typeof row.status === 'string' ? row.status : null,
    archived: typeof row.archived === 'boolean' ? row.archived : null,
    isFavorite:
      typeof row.is_favorite === 'boolean' ? row.is_favorite : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    ownerId: typeof row.owner_id === 'string' ? row.owner_id : null,
    data: isJsonValue(row.project_data) ? row.project_data : null,
  };
}

function normalizeProjectUpdate<TUpdate>(
  value: unknown,
): CloudProjectUpdate<TUpdate> {
  const row = toRecord(value);

  return {
    id: String(row.id || ''),
    projectId: typeof row.project_id === 'string' ? row.project_id : null,
    projectName:
      typeof row.project_name === 'string'
        ? row.project_name
        : 'Unassigned Project',
    areaName: typeof row.area_name === 'string' ? row.area_name : '',
    idempotencyKey:
      typeof row.idempotency_key === 'string' ? row.idempotency_key : null,
    updateData: row.update_data as TUpdate,
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    ownerId: typeof row.owner_id === 'string' ? row.owner_id : null,
  };
}

function exactOperationalProjectId(value: unknown): string | null {
  if (typeof value !== 'string' || value !== value.trim()) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : null;
}

function normalizeStorageCleanupIntent(
  value: unknown,
): DAVEStorageCleanupIntent | null {
  const row = toRecord(value);
  const bucket = row.bucket_id;
  const sourceEntityType = row.source_entity_type;
  const status = row.status;
  if (
    typeof row.id !== 'string' ||
    (bucket !== 'project-photos' && bucket !== 'project-documents') ||
    typeof row.object_path !== 'string' ||
    !row.object_path.trim() ||
    (
      sourceEntityType !== 'project' &&
      sourceEntityType !== 'project_update' &&
      sourceEntityType !== 'reference_document'
    ) ||
    typeof row.source_record_id !== 'string' ||
    (
      status !== 'pending' &&
      status !== 'completed' &&
      status !== 'failed'
    )
  ) {
    return null;
  }

  return {
    id: row.id,
    bucket,
    objectPath: row.object_path.trim(),
    sourceEntityType,
    sourceRecordId: row.source_record_id,
    status,
    attemptCount:
      typeof row.attempt_count === 'number' &&
      Number.isFinite(row.attempt_count)
        ? Math.max(0, Math.floor(row.attempt_count))
        : 0,
    lastError: typeof row.last_error === 'string' ? row.last_error : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}

function extractProjectUpdateIdempotencyKey(updateData: unknown): string | null {
  const update = toRecord(updateData);

  return (
    sanitizeIdempotencyKey(update.idempotencyKey) ||
    sanitizeIdempotencyKey(update.stableSendId)
  );
}

function sanitizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;

  if (Array.isArray(value)) return value.every(isJsonValue);

  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }

  return false;
}
