import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import {
  createClient,
  type Session,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
import type {
  ProjectArea,
  ReferenceDocument,
  ScheduleItem,
} from '../types';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SupabaseConfigurationStatus = {
  configured: boolean;
  urlConfigured: boolean;
  anonKeyConfigured: boolean;
  projectUrl: string | null;
  authStorage: 'AsyncStorage';
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

export type SupabaseServiceResult<T> = {
  ok: boolean;
  configured: boolean;
  data: T | null;
  error?: string;
  message?: string;
  status?: number;
  stubbed?: boolean;
};

export type SignInParams = {
  email: string;
  password: string;
};

export type AuthResult = {
  user: User | null;
  session: Session | null;
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
  ownerId?: string | null;
  data?: JsonValue | null;
};

export type UpdateProjectParams = {
  id?: string;
  name?: string;
  previousName?: string;
  status?: string;
  archived?: boolean;
  isFavorite?: boolean;
  ownerId?: string | null;
  data?: JsonValue | null;
};

export type CloudProjectUpdate<TUpdate = JsonValue> = {
  id: string;
  projectName: string;
  areaName: string;
  updateData: TUpdate;
  createdAt?: string | null;
  updatedAt?: string | null;
  ownerId?: string | null;
};

export type SaveProjectUpdateParams<TUpdate> = {
  id: string;
  projectName: string;
  areaName?: string | null;
  updateData: TUpdate;
  updatedAt?: string;
  ownerId?: string | null;
};

export type ProjectUpdateSyncMetadata<TUpdate = JsonValue> = {
  id: string;
  updatedAt: string | null;
  updateData: TUpdate | null;
};

export type UploadPhotoParams = {
  bucket?: string;
  path: string;
  uri: string;
  contentType?: string;
  upsert?: boolean;
  cacheControl?: string;
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

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '';
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';
const PROJECTS_TABLE = 'projects';
const PROJECT_UPDATES_TABLE = 'project_updates';
const PROJECT_AREAS_TABLE = 'project_areas';
const SCHEDULE_ITEMS_TABLE = 'schedule_items';
const REFERENCE_DOCUMENTS_TABLE = 'reference_documents';
const PROJECT_PHOTOS_BUCKET = 'project-photos';

const supabaseAuthStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};

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
    projectUrl: urlConfigured ? SUPABASE_URL : null,
    authStorage: 'AsyncStorage',
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

  const { count, error, status } = await client
    .from(PROJECTS_TABLE)
    .select('name', { count: 'exact' })
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

export async function signIn({
  email,
  password,
}: SignInParams): Promise<SupabaseServiceResult<AuthResult>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<AuthResult>();

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) return errorResult(error.message);

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

  return okResult(null);
}

export async function getCurrentUser(): Promise<SupabaseServiceResult<User | null>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<User | null>();

  const { data, error } = await client.auth.getUser();

  if (error) return errorResult(error.message);

  return okResult(data.user ?? null);
}

export async function uploadPhoto({
  bucket = PROJECT_PHOTOS_BUCKET,
  path,
  uri,
  contentType = 'image/jpeg',
  upsert = true,
  cacheControl = '3600',
}: UploadPhotoParams): Promise<SupabaseServiceResult<UploadedPhoto>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<UploadedPhoto>();

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const fileData = base64ToArrayBuffer(base64);

  const { data, error } = await client.storage
    .from(bucket)
    .upload(path, fileData, {
      cacheControl,
      contentType,
      upsert,
    });

  if (error) return errorResult(error.message);

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

export async function createProject(
  project: CreateProjectParams,
): Promise<SupabaseServiceResult<CloudProject>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<CloudProject>();

  const payload = {
    name: project.name,
    status: project.status ?? 'Active',
    archived: project.archived ?? false,
    is_favorite: project.isFavorite ?? false,
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

  const payload: Record<string, unknown> = {};

  if (project.name !== undefined) payload.name = project.name;
  if (project.status !== undefined) payload.status = project.status;
  if (project.archived !== undefined) payload.archived = project.archived;
  if (project.isFavorite !== undefined) payload.is_favorite = project.isFavorite;

  if (Object.keys(payload).length === 0) {
    return okResult<CloudProject>(
      null,
      undefined,
      'No project changes were provided.',
    );
  }

  let query = client.from(PROJECTS_TABLE).update(payload).select('*');

  if (project.id) {
    query = query.eq('id', project.id);
  } else if (project.previousName || project.name) {
    query = query.eq('name', project.previousName || project.name || '');
  } else {
    return errorResult('Project update requires an id, previousName, or name.');
  }

  const { data, error, status } = await query.limit(1).single();

  if (error) return tableAwareErrorResult<CloudProject>(error.message, status);

  return okResult(normalizeProject(data), status);
}

export async function listProjects(): Promise<SupabaseServiceResult<CloudProject[]>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<CloudProject[]>();

  const { data, error, status } = await client
    .from(PROJECTS_TABLE)
    .select('*')
    .eq('archived', false)
    .order('created_at', { ascending: false });

  if (error) return tableAwareListResult<CloudProject>(error.message, status);

  return okResult(Array.isArray(data) ? data.map(normalizeProject) : [], status);
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
  updateData,
  updatedAt = new Date().toISOString(),
}: SaveProjectUpdateParams<TUpdate>): Promise<
  SupabaseServiceResult<CloudProjectUpdate<TUpdate>>
> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<CloudProjectUpdate<TUpdate>>();

  const payload = {
    id,
    project_name: projectName || 'Unassigned Project',
    area_name: areaName || '',
    update_data: updateData,
    updated_at: updatedAt,
  };

  const { data, error, status } = await client
    .from(PROJECT_UPDATES_TABLE)
    .upsert(payload)
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

export async function listProjectUpdates<TUpdate>(): Promise<
  SupabaseServiceResult<CloudProjectUpdate<TUpdate>[]>
> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<CloudProjectUpdate<TUpdate>[]>();

  const { data, error, status } = await client
    .from(PROJECT_UPDATES_TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return tableAwareListResult<CloudProjectUpdate<TUpdate>>(
      error.message,
      status,
    );
  }

  return okResult(
    Array.isArray(data) ? data.map(row => normalizeProjectUpdate<TUpdate>(row)) : [],
    status,
  );
}

export async function getProjectUpdateSyncMetadata<TUpdate>(
  id: string,
): Promise<SupabaseServiceResult<ProjectUpdateSyncMetadata<TUpdate> | null>> {
  const client = getSupabaseClient();

  if (!client) {
    return notConfiguredResult<ProjectUpdateSyncMetadata<TUpdate> | null>();
  }

  const { data, error, status } = await client
    .from(PROJECT_UPDATES_TABLE)
    .select('id, updated_at, update_data')
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
  return upsertJsonRecord<ScheduleItem>({
    table: SCHEDULE_ITEMS_TABLE,
    payload: {
      id: item.id,
      project_name: item.projectName,
      task_name: item.taskName,
      item_data: toJsonValue(item),
      updated_at: new Date().toISOString(),
    },
    data: item,
  });
}

export async function upsertReferenceDocument(
  document: ReferenceDocument,
): Promise<SupabaseServiceResult<ReferenceDocument>> {
  return upsertJsonRecord<ReferenceDocument>({
    table: REFERENCE_DOCUMENTS_TABLE,
    payload: {
      id: document.id,
      name: document.name,
      category: document.category,
      document_data: toJsonValue(document),
      updated_at: new Date().toISOString(),
    },
    data: document,
  });
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
): SupabaseServiceResult<T> {
  return {
    ok: false,
    configured: true,
    data: null,
    error,
    status,
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
}: {
  table: string;
  payload: Record<string, unknown>;
  data: T;
}): Promise<SupabaseServiceResult<T>> {
  const client = getSupabaseClient();

  if (!client) return notConfiguredResult<T>();

  const { error, status } = await client.from(table).upsert(payload);

  if (error) return tableAwareErrorResult<T>(error.message, status);

  return okResult(data, status);
}

function isMissingTableError(message: string): boolean {
  const normalized = message.toLowerCase();

  return (
    normalized.includes('could not find the table') ||
    normalized.includes('schema cache') ||
    normalized.includes('does not exist') ||
    normalized.includes('relation') && normalized.includes('not exist')
  );
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
    updateData: row.update_data as TUpdate,
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    ownerId: typeof row.owner_id === 'string' ? row.owner_id : null,
  };
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

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const sanitized = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (let index = 0; index < sanitized.length; index += 1) {
    const value = chars.indexOf(sanitized.charAt(index));

    if (value < 0 || value === 64) continue;

    buffer = (buffer << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(output).buffer;
}
