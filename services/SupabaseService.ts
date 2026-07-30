import 'react-native-url-polyfill/auto';

import {
  isAuthStorageSecure,
  SUPABASE_AUTH_STORAGE_LABEL,
  supabaseSecureAuthStorage,
} from './SupabaseAuthStorage';
import { accountDisplayNameForMetadata } from './AccountProfile';
import { AppState } from 'react-native';
import {
  createClient,
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
import { scheduleItemCloudAcknowledgementMatches } from './ScheduleItemCloudAcknowledgement';
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
  chunkSupabaseFilterValues,
  paginateSupabaseCollection,
} from './SupabaseCollectionPagination';
import {
  verifyPIERealityHistoryRows,
  type PIERealityHistoryCloudRow,
} from './PIERealityHistoryIntegrity';
import {
  FileSizePreflightError,
  preflightExpoFileRead,
  prepareExpoFileUploadPayload,
} from './FileSizePreflight';
import {
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
  uploadFileResumably,
} from './ResumableStorageUpload';
import {
  attachDAVEOperationalRealtime,
  type DAVEOperationalRealtimeEntity,
  type DAVEOperationalRealtimeStatus,
} from './DAVEOperationalRefresh';

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

function createSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: supabaseAuthStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
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

export async function signOut(): Promise<SupabaseServiceResult<null>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<null>();

  const { error } = await client.auth.signOut();

  if (error) return errorResult(error.message);

  lastAuthEvent = 'SIGNED_OUT';
  authHydrationCompleted = true;

  return okResult(null);
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

  return () => data.subscription.unsubscribe();
}

export async function subscribeToDAVEOperationalChanges({
  onChange,
  onStatus,
}: {
  onChange: (entity: DAVEOperationalRealtimeEntity) => void;
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
      'DAVE could not safely inspect this file. Choose it again and retry.',
      422,
      'file_size_unavailable',
    );
  }

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

    try {
      const uploaded = await uploadFileResumably({
        projectUrl: configuration.projectUrl || '',
        accessToken: sessionData.session.access_token,
        bucket,
        path,
        uri,
        sizeBytes: verifiedSizeBytes,
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

  onProgress?.(0);
  const { data, error } = await client.storage
    .from(bucket)
    .upload(path, fileData, {
      cacheControl,
      contentType,
      upsert,
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
): Promise<SupabaseServiceResult<string>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<string>();
  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);
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

  const result = await paginateSupabaseCollection(async ({ from, to, includeExactCount }) =>
    client
      .from(PROJECTS_TABLE)
      .select('*', { count: includeExactCount ? 'exact' : undefined })
      .eq('owner_id', owner.data)
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  );

  if (!result.ok) return tableAwareListResult<CloudProject>(result.error, result.status);
  return okResult(result.rows.map(normalizeProject), result.status);
}

export async function listArchivedProjects(): Promise<SupabaseServiceResult<CloudProject[]>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<CloudProject[]>();
  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const result = await paginateSupabaseCollection(async ({ from, to, includeExactCount }) =>
    client
      .from(PROJECTS_TABLE)
      .select('*', { count: includeExactCount ? 'exact' : undefined })
      .eq('owner_id', owner.data)
      .eq('archived', true)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  );

  if (!result.ok) return tableAwareListResult<CloudProject>(result.error, result.status);
  return okResult(result.rows.map(normalizeProject), result.status);
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

  const stableIdempotencyKey =
    sanitizeIdempotencyKey(idempotencyKey) ||
    extractProjectUpdateIdempotencyKey(updateData) ||
    id;
  const payload = {
    id,
    project_name: projectName || 'Unassigned Project',
    area_name: areaName || '',
    idempotency_key: stableIdempotencyKey,
    update_data: updateData,
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
}: {
  id: string;
  archivedAt: string;
}): Promise<SupabaseServiceResult<null>> {
  const metadata = await getProjectUpdateSyncMetadata<Record<string, unknown>>(id);
  if (!metadata.ok || metadata.stubbed) {
    return errorResult(metadata.error || metadata.message || 'Field update archive could not be read.');
  }
  if (!metadata.data?.updateData) return okResult(null, metadata.status);
  const updateData = metadata.data.updateData;
  const projectName = typeof updateData.projectName === 'string'
    ? updateData.projectName
    : metadata.data.projectName || '';
  if (!projectName.trim()) return errorResult('Field update archive requires a project name.');
  const result = await saveProjectUpdate({
    id,
    projectName,
    areaName: typeof updateData.selectedAreaName === 'string'
      ? updateData.selectedAreaName
      : metadata.data.areaName || '',
    updateData: { ...updateData, isArchived: true, archivedAt },
    updatedAt: archivedAt,
  });
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

  const result = await paginateSupabaseCollection(async ({ from, to, includeExactCount }) =>
    client
      .from(PROJECT_UPDATES_TABLE)
      .select('*', { count: includeExactCount ? 'exact' : undefined })
      .eq('owner_id', owner.data)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  );

  if (!result.ok) {
    return tableAwareListResult<CloudProjectUpdate<TUpdate>>(
      result.error,
      result.status,
    );
  }

  return okResult(
    result.rows.map(row => normalizeProjectUpdate<TUpdate>(row)),
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
    .select('id, updated_at, project_name, area_name, update_data')
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
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
      projectName: typeof row.project_name === 'string' ? row.project_name : null,
      areaName: typeof row.area_name === 'string' ? row.area_name : null,
      updateData: (row.update_data as TUpdate | null) ?? null,
    },
    status,
  );
}

export async function upsertProjectArea(
  area: ProjectArea,
): Promise<SupabaseServiceResult<ProjectArea>> {
  return upsertJsonRecord<ProjectArea>({
    table: PROJECT_AREAS_TABLE,
    ownerScoped: true,
    payload: {
      id: area.id,
      name: area.name,
      area_data: toJsonValue(area),
      updated_at: new Date().toISOString(),
    },
    data: area,
  });
}

export async function upsertScheduleItem(
  item: ScheduleItem,
): Promise<SupabaseServiceResult<ScheduleItem>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<ScheduleItem>();

  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const { data, error, status } = await client
    .from(SCHEDULE_ITEMS_TABLE)
    .upsert({
      id: item.id,
      owner_id: owner.data,
      project_name: item.projectName,
      task_name: item.taskName,
      item_data: toJsonValue(item),
      updated_at: new Date().toISOString(),
    })
    .select('id, item_data')
    .single();

  if (error) return tableAwareErrorResult<ScheduleItem>(error.message, status);
  if (!scheduleItemCloudAcknowledgementMatches(item, data)) {
    return errorResult(
      'The cloud did not confirm the exact saved task revision.',
      409,
      'cloud_acknowledgement_missing',
    );
  }

  return okResult(item, status);
}

export async function upsertReferenceDocument(
  document: ReferenceDocument,
): Promise<SupabaseServiceResult<ReferenceDocument>> {
  const { cloudUpdatedAt: _cloudUpdatedAt, ...documentData } = document;
  return upsertJsonRecord<ReferenceDocument>({
    table: REFERENCE_DOCUMENTS_TABLE,
    ownerScoped: true,
    payload: {
      id: document.id,
      name: document.name,
      category: document.category,
      document_data: toJsonValue(documentData),
      updated_at: new Date().toISOString(),
    },
    data: document,
  });
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

export async function listReferenceDocuments(): Promise<SupabaseServiceResult<ReferenceDocument[]>> {
  return listOwnedJsonRecords<ReferenceDocument>({
    table: REFERENCE_DOCUMENTS_TABLE,
    jsonColumn: 'document_data',
    includeCloudUpdatedAt: true,
  });
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

export async function listDAVESyncTombstones(): Promise<
  SupabaseServiceResult<DAVESyncTombstone[]>
> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<DAVESyncTombstone[]>();

  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const result = await paginateSupabaseCollection(async ({ from, to, includeExactCount }) =>
    client
      .from(DAVE_SYNC_TOMBSTONES_TABLE)
      .select('entity_type, record_id, deleted_at', {
        count: includeExactCount ? 'exact' : undefined,
      })
      .eq('owner_id', owner.data)
      .order('deleted_at', { ascending: false })
      .order('entity_type', { ascending: true })
      .order('record_id', { ascending: true })
      .range(from, to),
  );

  if (!result.ok) return tableAwareListResult<DAVESyncTombstone>(result.error, result.status);

  const tombstones = result.rows
        .map(row => {
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
        })
        .filter((value): value is DAVESyncTombstone => Boolean(value));

  return okResult(tombstones, result.status);
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
  reason = 'Reality Model synchronized from live DAVE authority.',
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

  const result = await paginateSupabaseCollection(async ({ from, to, includeExactCount }) =>
    client
      .from(PIE_EXECUTIVE_JUDGMENTS_TABLE)
      .select('*', { count: includeExactCount ? 'exact' : undefined })
      .eq('organization_id', organizationId)
      .eq('project_id', projectId)
      .order('judgment_time', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  );

  if (!result.ok) {
    return tableAwareListResult<PIEExecutiveJudgmentRecord>(result.error, result.status);
  }
  return okResult(
    result.rows.map(normalizePIEExecutiveJudgmentRow),
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

  const recordsResult = await paginateSupabaseCollection(async ({
    from,
    to,
    includeExactCount,
  }) => {
    let query = client
      .from(PIE_DECISION_RECORDS_TABLE)
      .select('*', { count: includeExactCount ? 'exact' : undefined })
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true });
    if (projectId) query = query.eq('project_id', projectId);
    return query.range(from, to);
  });
  if (!recordsResult.ok) {
    return tableAwareListResult<PIEDecisionRecord>(recordsResult.error, recordsResult.status);
  }
  if (recordsResult.rows.length === 0) return okResult([], recordsResult.status);

  const [versionsResult, outcomesResult, auditResult] = await Promise.all([
    paginateSupabaseCollection(async ({ from, to, includeExactCount }) => {
      let query = client
        .from(PIE_DECISION_VERSIONS_TABLE)
        .select('*', { count: includeExactCount ? 'exact' : undefined })
        .eq('organization_id', organizationId)
        .order('decision_id', { ascending: true })
        .order('version', { ascending: true })
        .order('id', { ascending: true });
      if (projectId) query = query.eq('project_id', projectId);
      return query.range(from, to);
    }),
    paginateSupabaseCollection(async ({ from, to, includeExactCount }) => {
      let query = client
        .from(PIE_DECISION_OUTCOMES_TABLE)
        .select('*', { count: includeExactCount ? 'exact' : undefined })
        .eq('organization_id', organizationId)
        .order('decision_id', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
      if (projectId) query = query.eq('project_id', projectId);
      return query.range(from, to);
    }),
    paginateSupabaseCollection(async ({ from, to, includeExactCount }) => {
      let query = client
        .from(PIE_DECISION_AUDIT_EVENTS_TABLE)
        .select('*', { count: includeExactCount ? 'exact' : undefined })
        .eq('organization_id', organizationId)
        .order('decision_id', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
      if (projectId) query = query.eq('project_id', projectId);
      return query.range(from, to);
    }),
  ]);

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

  client.auth.onAuthStateChange(event => {
    authHydrationCompleted = true;
    lastAuthEvent = event;
  });

  if (authAutoRefreshSubscriptionStarted) return;
  authAutoRefreshSubscriptionStarted = true;

  if (AppState.currentState === 'active') {
    client.auth.startAutoRefresh();
  }

  AppState.addEventListener('change', state => {
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

async function listOwnedJsonRecords<T>({
  table,
  jsonColumn,
  includeCloudUpdatedAt = false,
}: {
  table: string;
  jsonColumn: string;
  includeCloudUpdatedAt?: boolean;
}): Promise<SupabaseServiceResult<T[]>> {
  const client = getSupabaseClient();
  if (!client) return notConfiguredResult<T[]>();

  const owner = await requireAuthenticatedOwnerId(client);
  if (!owner.ok || !owner.data) {
    return errorResult(owner.error || 'Sign in is required.', owner.status, owner.code);
  }

  const result = await paginateSupabaseCollection(async ({ from, to, includeExactCount }) =>
    client
      .from(table)
      .select(`id, updated_at, ${jsonColumn}`, { count: includeExactCount ? 'exact' : undefined })
      .eq('owner_id', owner.data)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  );

  if (!result.ok) return tableAwareListResult<T>(result.error, result.status);

  const records = result.rows
    .map(row => {
      const databaseRow = toRecord(row);
      const jsonRecord = toRecord(databaseRow[jsonColumn]);
      if (Object.keys(jsonRecord).length === 0) return null;
      // The database row is the durable identity. Legacy JSON may omit its id
      // or contain an old conflicting id; using the row id prevents a later
      // upload from manufacturing a second cloud record.
      const record = bindDAVECloudDatabaseIdentity(jsonRecord, databaseRow.id);
      return (includeCloudUpdatedAt
        ? {
            ...record,
            cloudUpdatedAt:
              typeof databaseRow.updated_at === 'string'
                ? databaseRow.updated_at
                : null,
          }
        : record) as T;
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
