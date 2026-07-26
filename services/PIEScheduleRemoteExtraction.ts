import * as Crypto from 'expo-crypto';
import type { ProjectArea, ScheduleItem, ScheduleStatus } from '../types';
import { reconcileScheduleProgress } from './ScheduleProgressInvariant';

const SCHEDULE_EXTRACTOR_URL =
  'https://project-schedule-extractor-backend.vercel.app/api/extract-schedule';
const EXTRACTION_TIMEOUT_MS = 55_000;

type RemoteScheduleItem = Readonly<{
  taskName?: unknown;
  projectName?: unknown;
  locationName?: unknown;
  startDate?: unknown;
  finishDate?: unknown;
  dueDate?: unknown;
  owner?: unknown;
  status?: unknown;
  percentComplete?: unknown;
  notes?: unknown;
}>;

type RemoteScheduleResponse = Readonly<{
  ok?: unknown;
  code?: unknown;
  error?: unknown;
  retryable?: unknown;
  items?: unknown;
  warnings?: unknown;
  extractedAt?: unknown;
}>;

export type PIEScheduleExtractionProject = Readonly<{
  id?: string | null;
  name: string;
}>;

export type PIEScheduleRemoteExtractionResult = Readonly<{
  items: ScheduleItem[];
  warnings: string[];
}>;

export class PIEScheduleRemoteExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PIEScheduleRemoteExtractionError';
  }
}

export async function extractSchedulePdfWithServer({
  uri,
  fileName,
  mimeType,
  projects,
  projectRecords,
  projectAreas,
  idempotencyKey,
}: Readonly<{
  uri: string;
  fileName: string;
  mimeType: string;
  projects: readonly string[];
  projectRecords: readonly PIEScheduleExtractionProject[];
  projectAreas: readonly ProjectArea[];
  idempotencyKey: string;
}>): Promise<PIEScheduleRemoteExtractionResult> {
  const { getCurrentSessionAccessToken } = await import('./SupabaseService');
  const tokenResult = await getCurrentSessionAccessToken();
  const accessToken = tokenResult.ok && tokenResult.data?.status === 'token_present'
    ? tokenResult.data.accessToken
    : null;
  if (!accessToken) {
    throw new PIEScheduleRemoteExtractionError(
      'Sign in to cloud sync, then import the schedule again.',
    );
  }

  const form = new FormData();
  form.append('file', { uri, name: fileName, type: mimeType } as unknown as Blob);
  form.append('projectName', projects.length === 1 ? projects[0] : '');
  form.append('projects', JSON.stringify(projectRecords.map(project => ({
    id: text(project.id) || null,
    name: text(project.name),
  }))));
  form.append('locations', JSON.stringify(projectAreas.map(area => area.name)));
  form.append('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);
  try {
    const response = await fetch(
      scheduleExtractorUrl(),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: form,
        signal: controller.signal,
      },
    );
    const body = await response.json().catch(() => null) as RemoteScheduleResponse | null;
    if (!response.ok || body?.ok !== true) {
      throw new PIEScheduleRemoteExtractionError(
        scheduleExtractionFailureMessage(body, response.status),
      );
    }
    return scheduleItemsFromRemoteExtractorPayload(body, {
      fileName,
      projects,
      extractedAt: text(body.extractedAt) || new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof PIEScheduleRemoteExtractionError) throw error;
    throw new PIEScheduleRemoteExtractionError(
      error instanceof Error && error.name === 'AbortError'
        ? 'Schedule extraction took too long. Try again on a stable connection.'
        : 'The schedule extraction service could not be reached. The PDF remains saved.',
    );
  } finally {
    clearTimeout(timeout);
  }
}

function scheduleExtractionFailureMessage(
  body: RemoteScheduleResponse | null,
  status: number,
): string {
  const code = text(body?.code);
  const serverMessage = text(body?.error).slice(0, 260);
  if (serverMessage) return serverMessage;
  if (status === 401) return 'Your Vitruvius session has expired. Sign in and try again.';
  if (status === 403) return 'The signed-in account cannot import a schedule for one or more selected projects.';
  if (status === 409 && code === 'REQUEST_IN_PROGRESS') {
    return 'This schedule is already being analyzed. Wait a moment, then retry.';
  }
  if (status === 429) return 'Schedule analysis is temporarily limited. Try again shortly.';
  if (status === 413) return 'The schedule is larger than the protected analysis limit.';
  if (status === 415) return 'Only readable PDF schedule files can be analyzed.';
  return 'The schedule could not be analyzed. The PDF remains saved so you can retry.';
}

/**
 * The mobile bundle must not accept a public runtime override for the service
 * receiving a signed-in user's schedule and access token. Changing this
 * endpoint requires a reviewed source change and a new signed build.
 */
export function scheduleExtractorUrl(): string {
  const endpoint = new URL(SCHEDULE_EXTRACTOR_URL);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.hostname !== 'project-schedule-extractor-backend.vercel.app' ||
    endpoint.pathname !== '/api/extract-schedule'
  ) {
    throw new PIEScheduleRemoteExtractionError(
      'The schedule extraction service configuration is not trusted.',
    );
  }
  return endpoint.toString();
}

export function scheduleItemsFromRemoteExtractorPayload(
  payload: RemoteScheduleResponse,
  context: Readonly<{
    fileName: string;
    projects: readonly string[];
    extractedAt: string;
  }>,
): PIEScheduleRemoteExtractionResult {
  const rows = Array.isArray(payload.items) ? payload.items as RemoteScheduleItem[] : [];
  const fallbackProject = context.projects.length === 1 ? context.projects[0] : '';
  const items = rows.flatMap((row): ScheduleItem[] => {
    const taskName = text(row.taskName);
    if (!taskName) return [];
    const status = scheduleStatus(row.status);
    const reportedPercent = schedulePercent(row.percentComplete);
    const progress = reconcileScheduleProgress(
      status,
      reportedPercent ?? (status === 'Complete' ? 100 : 0),
    );
    const projectName = text(row.projectName) || fallbackProject;
    return [{
      id: `remote-schedule-${Crypto.randomUUID()}`,
      scheduleProjectName: projectName,
      projectTimeZone: null,
      projectName,
      locationName: text(row.locationName),
      taskName,
      startDate: text(row.startDate),
      finishDate: text(row.finishDate) || text(row.dueDate),
      milestone: '',
      owner: text(row.owner),
      contractor: '',
      durationDays: null,
      percentComplete: progress.percentComplete,
      progressSource: 'schedule_import',
      progressConfirmedAt: null,
      progressConfirmedBy: null,
      priority: 'Medium',
      status: progress.status,
      notes: text(row.notes),
      importedFrom: context.fileName,
      importedAt: context.extractedAt,
      importBatchId: null,
      sourceDocumentId: null,
      completionVerification: null,
      createdAt: context.extractedAt,
      updatedAt: context.extractedAt,
    }];
  });
  if (items.length === 0) {
    throw new PIEScheduleRemoteExtractionError(
      'No dated schedule activities could be extracted. Check that the PDF is readable and includes task names and dates.',
    );
  }
  return {
    items,
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.map(text).filter(Boolean)
      : [],
  };
}

function scheduleStatus(value: unknown): ScheduleStatus {
  const normalized = text(value).toLowerCase();
  if (normalized === 'complete') return 'Complete';
  if (normalized === 'in progress') return 'In Progress';
  if (normalized === 'waiting') return 'Waiting';
  return 'Not Started';
}

function schedulePercent(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value.replace('%', '').trim())
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return null;
  return numeric;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
