import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

export const ECOS_PROJECT_QUESTION_FUNCTION = 'ecos-ask-project' as const;
export const ECOS_PROJECT_QUESTION_SCHEMA_VERSION = 'ecos-project-question/2.0' as const;
export const ECOS_PROJECT_QUESTION_LEGACY_SCHEMA_VERSION = 'ecos-project-question/1.0' as const;
export const ECOS_QUESTION_TRACE_SCHEMA_VERSION = 'ecos-question-trace/1.0' as const;
export const ECOS_EVIDENCE_SNAPSHOT_SCHEMA_VERSION = 'ecos-project-evidence-snapshot/1.0' as const;
export const ECOS_EVIDENCE_DOSSIER_SCHEMA_VERSION = 'ecos-evidence-dossier/1.0' as const;

export type ECOSQuestionClientSurface = 'web' | 'iphone' | 'ipad' | 'android' | 'unknown';

export type ECOSProjectQuestionRequest = Readonly<{
  schemaVersion: typeof ECOS_PROJECT_QUESTION_SCHEMA_VERSION;
  clientRequestId: string;
  clientSurface: ECOSQuestionClientSurface;
  projectId: string;
  projectName: string;
  question: string;
}>;

export type ECOSQuestionDiagnostics = Readonly<{
  schemaVersion: typeof ECOS_QUESTION_TRACE_SCHEMA_VERSION;
  traceId: string;
  clientRequestId: string;
  clientSurface: ECOSQuestionClientSurface;
  evidenceSnapshotId: string | null;
  evidenceDossierId: string | null;
  replayed: boolean;
  persisted: boolean;
}>;

export function buildECOSProjectQuestionRequest({
  projectId,
  projectName,
  question,
  clientRequestId = Crypto.randomUUID(),
  clientSurface = currentECOSQuestionClientSurface(),
}: {
  projectId: string;
  projectName: string;
  question: string;
  clientRequestId?: string;
  clientSurface?: ECOSQuestionClientSurface;
}): ECOSProjectQuestionRequest {
  return Object.freeze({
    schemaVersion: ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
    clientRequestId,
    clientSurface,
    projectId,
    projectName,
    question,
  });
}

export function currentECOSQuestionClientSurface(): ECOSQuestionClientSurface {
  if (Platform.OS === 'web') return 'web';
  if (Platform.OS === 'ios') return Platform.isPad ? 'ipad' : 'iphone';
  if (Platform.OS === 'android') return 'android';
  return 'unknown';
}

export function parseECOSQuestionDiagnostics(value: unknown): ECOSQuestionDiagnostics | null {
  const record = objectValue(value);
  if (record.schemaVersion !== ECOS_QUESTION_TRACE_SCHEMA_VERSION) return null;
  const traceId = uuidText(record.traceId);
  const clientRequestId = uuidText(record.clientRequestId);
  const clientSurface = clientSurfaceValue(record.clientSurface);
  if (!traceId || !clientRequestId || !clientSurface) return null;
  return Object.freeze({
    schemaVersion: ECOS_QUESTION_TRACE_SCHEMA_VERSION,
    traceId,
    clientRequestId,
    clientSurface,
    evidenceSnapshotId: uuidText(record.evidenceSnapshotId) || null,
    evidenceDossierId: uuidText(record.evidenceDossierId) || null,
    replayed: record.replayed === true,
    persisted: record.persisted === true,
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function uuidText(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : '';
}

function clientSurfaceValue(value: unknown): ECOSQuestionClientSurface | null {
  return value === 'web' || value === 'iphone' || value === 'ipad' ||
      value === 'android' || value === 'unknown'
    ? value
    : null;
}
