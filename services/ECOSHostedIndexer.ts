import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceDocument } from '../types';

export type ECOSHostedIndexState =
  | 'queued'
  | 'fetching_source'
  | 'extracting'
  | 'mapping'
  | 'awaiting_visual'
  | 'assuring'
  | 'ready'
  | 'needs_review'
  | 'reconnect_source'
  | 'temporarily_unavailable'
  | 'failed_internal'
  | 'cancelled';

export type ECOSHostedIndexStatus = Readonly<{
  documentId: string;
  projectId: string;
  state: ECOSHostedIndexState;
  customerStatus:
    | 'Waiting'
    | 'Preparing'
    | 'Prepared'
    | 'Prepared with limitations'
    | 'Ready for ECOS'
    | 'Ready with limitations'
    | 'Needs Review'
    | 'Reconnect Files'
    | 'Temporarily Unavailable';
  completedPageCount: number;
  sourcePageCount: number;
  progressPercent: number;
  customerMessage: string | null;
  limitationCount: number;
  supportReference: string | null;
  committedEvidenceVersion: string | null;
  updatedAt: string | null;
  readyAt: string | null;
}>;

export type ECOSHostedIndexStatusAuthority = 'available' | 'unavailable';

export type ECOSHostedIndexStatusSnapshot = Readonly<{
  authority: ECOSHostedIndexStatusAuthority;
  statuses: readonly ECOSHostedIndexStatus[];
}>;

export type ECOSHostedEnqueueResult = Readonly<{
  status: 'queued' | 'unavailable' | 'failed';
  jobId: string | null;
  message: string | null;
}>;

export type ECOSCurrentReferenceActivationResult = Readonly<{
  status: 'activated' | 'not_prepared' | 'conflict' | 'unavailable' | 'failed';
  documentId: string | null;
  updatedAt: string | null;
  changedCount: number;
  message: string | null;
}>;

export async function enqueueECOSHostedIndex({
  client,
  documentId,
}: {
  client: SupabaseClient;
  documentId: string;
}): Promise<ECOSHostedEnqueueResult> {
  const normalizedDocumentId = documentId.trim();
  if (!normalizedDocumentId) {
    return Object.freeze({ status: 'failed', jobId: null, message: 'The project document identity is missing.' });
  }
  const { data, error } = await client.rpc('ecos_enqueue_hosted_index', {
    p_document_id: normalizedDocumentId,
  });
  if (error) {
    const unavailable = rpcUnavailable(error);
    return Object.freeze({
      status: unavailable ? 'unavailable' : 'failed',
      jobId: null,
      message: unavailable
        ? 'Background document preparation is not available in this environment yet.'
        : safeCustomerMessage(error.message),
    });
  }
  const jobId = typeof data === 'string' && data.trim() ? data.trim() : null;
  return Object.freeze({
    status: jobId ? 'queued' : 'failed',
    jobId,
    message: jobId ? null : 'Vitruvius could not confirm the background preparation request.',
  });
}

/**
 * Promotes one exact reference-document revision through a single authenticated
 * database transaction. The database owns family selection and readiness
 * checks so two clients cannot leave multiple revisions current.
 */
export async function activateECOSCurrentReferenceDocument({
  client,
  documentId,
  expectedUpdatedAt,
}: {
  client: SupabaseClient;
  documentId: string;
  expectedUpdatedAt: string;
}): Promise<ECOSCurrentReferenceActivationResult> {
  const normalizedDocumentId = documentId.trim();
  const normalizedUpdatedAt = expectedUpdatedAt.trim();
  if (!normalizedDocumentId || !normalizedUpdatedAt) {
    return activationResult(
      'conflict',
      null,
      null,
      0,
      'Refresh the project documents before changing the current revision.',
    );
  }

  const { data, error } = await client.rpc('ecos_activate_current_reference_document', {
    p_document_id: normalizedDocumentId,
    p_expected_updated_at: normalizedUpdatedAt,
  });
  if (error) {
    const diagnostic = String(error.message || '').toLowerCase();
    if (rpcUnavailable(error)) {
      return activationResult(
        'unavailable', null, null, 0,
        'Current-revision activation is not available in this environment yet.',
      );
    }
    if (diagnostic.includes('ecos_target_not_prepared')) {
      return activationResult(
        'not_prepared', null, null, 0,
        'This drawing must finish background preparation and ECOS Assurance before it can be made current.',
      );
    }
    if (
      diagnostic.includes('ecos_current_activation_conflict') ||
      diagnostic.includes('ecos_current_activation_target_unavailable')
    ) {
      return activationResult(
        'conflict', null, null, 0,
        'The shared document changed first. Refresh before changing the current revision.',
      );
    }
    return activationResult(
      'failed', null, null, 0,
      'Vitruvius could not change the current revision. Try again shortly.',
    );
  }

  const row = record(data);
  const activatedDocumentId = text(row.document_id);
  const updatedAt = text(row.updated_at);
  if (activatedDocumentId !== normalizedDocumentId || !updatedAt) {
    return activationResult(
      'failed', null, null, 0,
      'Vitruvius could not verify the current revision change.',
    );
  }
  return activationResult(
    'activated',
    activatedDocumentId,
    updatedAt,
    count(row.changed_count),
    null,
  );
}

export async function loadECOSHostedIndexStatuses({
  client,
  documentIds,
}: {
  client: SupabaseClient;
  documentIds?: readonly string[];
}): Promise<readonly ECOSHostedIndexStatus[]> {
  return (await loadECOSHostedIndexStatusSnapshot({ client, documentIds })).statuses;
}

export async function loadECOSHostedIndexStatusSnapshot({
  client,
  documentIds,
}: {
  client: SupabaseClient;
  documentIds?: readonly string[];
}): Promise<ECOSHostedIndexStatusSnapshot> {
  const ids = [...new Set((documentIds ?? []).map(value => value.trim()).filter(Boolean))];
  let { data, error } = await client.rpc('ecos_hosted_index_status_v2', {
    p_document_ids: ids.length ? ids : null,
  });
  if (error && rpcUnavailable(error)) {
    ({ data, error } = await client.rpc('ecos_hosted_index_status', {
      p_document_ids: ids.length ? ids : null,
    }));
  }
  if (error) {
    if (rpcUnavailable(error)) {
      return Object.freeze({ authority: 'unavailable', statuses: Object.freeze([]) });
    }
    throw new Error(safeCustomerMessage(error.message));
  }
  const statuses = Object.freeze((Array.isArray(data) ? data : []).map(normalizeStatus).filter(isPresent));
  return Object.freeze({ authority: 'available', statuses });
}

/**
 * Replaces cached hosted authority with the latest authenticated snapshot.
 * Missing rows are authoritative revocations, not permission to retain an old
 * Ready receipt. When the authority boundary is unavailable, preserve the
 * library record while making proof-dependent readiness fail closed.
 */
export function reconcileECOSHostedIndexStatus(
  document: ReferenceDocument,
  status: ECOSHostedIndexStatus | null,
  authority: ECOSHostedIndexStatusAuthority,
): ReferenceDocument {
  const withoutCachedHostedStatus: ReferenceDocument = {
    ...document,
    ecosHostedIndexStatus: null,
    ecosHostedIndexProgressPercent: null,
    ecosHostedIndexCustomerMessage: null,
    ecosHostedIndexLimitationCount: null,
    ecosHostedIndexSupportReference: null,
    ecosHostedIndexEvidenceVersion: null,
    ecosHostedIndexUpdatedAt: null,
  };
  const withoutCachedHostedCommit: ReferenceDocument = {
    ...withoutCachedHostedStatus,
    ecosVerifiedIndexCommitVersion: null,
    ecosVerifiedIndexCommittedAt: null,
    ecosVerifiedIndexCommittedSha256: null,
    ecosVerifiedIndexCommittedPageCount: null,
    ecosVerifiedIndexPageGraphSha256: null,
  };
  const documentProjectId = text(document.projectId);
  const exactStatus = status?.documentId === document.id &&
    documentProjectId && status.projectId === documentProjectId
    ? status
    : null;
  if (!exactStatus) {
    return authority === 'unavailable'
      ? {
          ...withoutCachedHostedCommit,
          ecosHostedIndexStatus: 'Temporarily Unavailable',
          ecosHostedIndexCustomerMessage: 'Vitruvius could not confirm the current hosted preparation status.',
        }
      : withoutCachedHostedCommit;
  }
  const exactCurrentReadyAuthority = document.isCurrent === true &&
    exactStatus.state === 'ready' &&
    (exactStatus.customerStatus === 'Ready for ECOS' ||
      exactStatus.customerStatus === 'Ready with limitations') &&
    exactStatus.committedEvidenceVersion === 'ecos-hosted-evidence/1.3';
  const claimsReadyAuthority = exactStatus.customerStatus === 'Ready for ECOS' ||
    exactStatus.customerStatus === 'Ready with limitations';
  if (claimsReadyAuthority && !exactCurrentReadyAuthority) {
    return {
      ...withoutCachedHostedCommit,
      ecosHostedIndexStatus: 'Temporarily Unavailable',
      ecosHostedIndexProgressPercent: null,
      ecosHostedIndexCustomerMessage: 'Vitruvius could not confirm the exact current hosted readiness receipt.',
      ecosHostedIndexLimitationCount: null,
      ecosHostedIndexSupportReference: exactStatus.supportReference,
      ecosHostedIndexEvidenceVersion: null,
      ecosHostedIndexUpdatedAt: exactStatus.updatedAt,
    };
  }
  return {
    ...(exactCurrentReadyAuthority
      ? withoutCachedHostedStatus
      : withoutCachedHostedCommit),
    ecosHostedIndexStatus: exactStatus.customerStatus,
    ecosHostedIndexProgressPercent: exactStatus.progressPercent,
    ecosHostedIndexCustomerMessage: exactStatus.customerMessage,
    ecosHostedIndexLimitationCount: exactStatus.limitationCount,
    ecosHostedIndexSupportReference: exactStatus.supportReference,
    ecosHostedIndexEvidenceVersion: exactStatus.committedEvidenceVersion,
    ecosHostedIndexUpdatedAt: exactStatus.updatedAt,
  };
}

function normalizeStatus(value: unknown): ECOSHostedIndexStatus | null {
  const row = record(value);
  const documentId = text(row.document_id);
  const projectId = text(row.project_id);
  const state = hostedState(row.state);
  const customerStatus = customerStatusValue(row.customer_status);
  if (!documentId || !projectId || !state || !customerStatus) return null;
  return Object.freeze({
    documentId,
    projectId,
    state,
    customerStatus,
    completedPageCount: count(row.completed_page_count),
    sourcePageCount: count(row.source_page_count),
    progressPercent: Math.min(100, count(row.progress_percent)),
    customerMessage: text(row.customer_message) || null,
    limitationCount: count(row.limitation_count),
    supportReference: text(row.support_reference) || null,
    committedEvidenceVersion: text(row.committed_evidence_version) || null,
    updatedAt: text(row.updated_at) || null,
    readyAt: text(row.ready_at) || null,
  });
}

function hostedState(value: unknown): ECOSHostedIndexState | null {
  return typeof value === 'string' && [
    'queued', 'fetching_source', 'extracting', 'mapping', 'awaiting_visual',
    'assuring', 'ready', 'needs_review', 'reconnect_source',
    'temporarily_unavailable', 'failed_internal', 'cancelled',
  ].includes(value) ? value as ECOSHostedIndexState : null;
}

function customerStatusValue(value: unknown): ECOSHostedIndexStatus['customerStatus'] | null {
  return typeof value === 'string' && [
    'Waiting', 'Preparing', 'Prepared', 'Prepared with limitations',
    'Ready for ECOS', 'Ready with limitations', 'Needs Review',
    'Reconnect Files', 'Temporarily Unavailable',
  ].includes(value) ? value as ECOSHostedIndexStatus['customerStatus'] : null;
}

function safeCustomerMessage(value: unknown) {
  const message = text(value).toLowerCase();
  if (message.includes('project document is unavailable')) return 'This project document is no longer available.';
  if (message.includes('organization membership')) return 'Your Vitruvius workspace access needs attention.';
  if (message.includes('assigned to a project')) return 'Assign this document to a project, then try again.';
  if (message.includes('checksum')) return 'Choose the source file again so Vitruvius can verify it.';
  return 'Vitruvius could not start background document preparation. Try again shortly.';
}

function rpcUnavailable(error: { code?: string | null; message?: string | null }) {
  return error.code === '42883' || error.code === 'PGRST202' ||
    String(error.message || '').toLowerCase().includes('could not find the function');
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function count(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function isPresent<T>(value: T | null): value is T {
  return value != null;
}

function activationResult(
  status: ECOSCurrentReferenceActivationResult['status'],
  documentId: string | null,
  updatedAt: string | null,
  changedCount: number,
  message: string | null,
): ECOSCurrentReferenceActivationResult {
  return Object.freeze({ status, documentId, updatedAt, changedCount, message });
}
