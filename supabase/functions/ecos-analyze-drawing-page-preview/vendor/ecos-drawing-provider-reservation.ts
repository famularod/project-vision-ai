export const ECOS_VISUAL_PROVIDER_OPERATION_SCHEMA_VERSION =
  'ecos-visual-provider-operation/1.0' as const;

const CANONICAL_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;
const NON_SPACE_PRINTABLE_ASCII = /[!-~]/;
const LOWER_SHA256 = /^[a-f0-9]{64}$/;
const EVIDENCE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const VISUAL_REGION_KEY = /^[\x21-\x7e]{1,300}$/;

export type ECOSHostedDrawingProviderIdentity = Readonly<{
  organizationId: string;
  projectId: string;
  documentId: string;
  sourceSha256: string;
  pageNumber: number;
  hostedJobId: string;
  hostedClaimToken: string;
  evidenceVersion: string;
  visualExceptionFingerprint: string;
  visualRegionKey: string;
  providerOperationId: string;
}>;

export type ECOSDrawingProviderCallRole =
  | 'analysis_primary'
  | 'analysis_capacity_fallback'
  | 'analysis_invalid_output_fallback'
  | 'assurance';

export type ECOSDrawingProviderAttemptReservation = (input: Readonly<{
  callRole: ECOSDrawingProviderCallRole;
  provider: 'openai' | 'gemini';
  model: string;
}>) => Promise<void>;

type RPCClient = Readonly<{
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<Readonly<{
    data: unknown;
    error: unknown;
  }>>;
}>;

export class ECOSDrawingOperationControlError extends Error {
  constructor(public readonly code:
    | 'analysis_operation_control_unavailable'
    | 'analysis_operation_identity_invalid'
    | 'analysis_operation_in_progress'
    | 'drawing_provider_reservation_denied'
    | 'analysis_operation_finish_failed') {
    super(code);
    this.name = 'ECOSDrawingOperationControlError';
  }
}

export async function normalizeECOSHostedDrawingProviderIdentity(
  value: unknown,
  exactVisualExceptionRegionKey: string,
): Promise<ECOSHostedDrawingProviderIdentity | null> {
  if (!isRecord(value)) return null;
  const identity = {
    organizationId: exactString(value.organizationId),
    projectId: exactString(value.projectId),
    documentId: exactString(value.documentId),
    sourceSha256: exactString(value.sourceSha256),
    pageNumber: value.pageNumber,
    hostedJobId: exactString(value.hostedJobId),
    hostedClaimToken: exactString(value.hostedClaimToken),
    evidenceVersion: exactString(value.evidenceVersion),
    visualExceptionFingerprint: exactString(value.visualExceptionFingerprint),
    visualRegionKey: exactString(value.visualRegionKey),
    providerOperationId: exactString(value.providerOperationId),
  };
  if (
    !exactHostedTextId(identity.organizationId, 500) ||
    !exactHostedTextId(identity.projectId, 500) ||
    !exactHostedTextId(identity.documentId, 200) ||
    !LOWER_SHA256.test(identity.sourceSha256) ||
    !Number.isInteger(identity.pageNumber) || Number(identity.pageNumber) < 1 || Number(identity.pageNumber) > 10_000 ||
    !CANONICAL_UUID.test(identity.hostedJobId) ||
    !CANONICAL_UUID.test(identity.hostedClaimToken) ||
    !EVIDENCE_VERSION.test(identity.evidenceVersion) ||
    !LOWER_SHA256.test(identity.visualExceptionFingerprint) ||
    !VISUAL_REGION_KEY.test(identity.visualRegionKey) ||
    identity.visualRegionKey !== exactVisualExceptionRegionKey ||
    !LOWER_SHA256.test(identity.providerOperationId)
  ) return null;

  const normalized = identity as ECOSHostedDrawingProviderIdentity;
  const expectedOperationId = await ecosVisualProviderOperationId(normalized);
  return timingSafeEqual(expectedOperationId, normalized.providerOperationId)
    ? Object.freeze(normalized)
    : null;
}

export function ecosVisualProviderOperationCanonicalBytes(
  identity: Omit<ECOSHostedDrawingProviderIdentity, 'providerOperationId'>,
) {
  // Key order and compact encoding exactly match Python
  // json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=True).
  const canonical = {
    documentId: identity.documentId,
    evidenceVersion: identity.evidenceVersion,
    hostedClaimToken: identity.hostedClaimToken,
    hostedJobId: identity.hostedJobId,
    organizationId: identity.organizationId,
    pageNumber: identity.pageNumber,
    projectId: identity.projectId,
    schemaVersion: ECOS_VISUAL_PROVIDER_OPERATION_SCHEMA_VERSION,
    sourceSha256: identity.sourceSha256,
    visualExceptionFingerprint: identity.visualExceptionFingerprint,
    visualRegionKey: identity.visualRegionKey,
  };
  return new TextEncoder().encode(asciiJSON(canonical));
}

export async function ecosVisualProviderOperationId(
  identity: Omit<ECOSHostedDrawingProviderIdentity, 'providerOperationId'>,
) {
  return sha256Hex(ecosVisualProviderOperationCanonicalBytes(identity));
}

export async function sha256Hex(value: Uint8Array) {
  const owned = Uint8Array.from(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', owned.buffer));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export type ECOSDrawingAnalysisOperation = Readonly<{
  requestId: string;
  providerOperationId: string;
  replayResponse: Record<string, unknown> | null;
}>;

export async function beginECOSDrawingAnalysisOperation({
  client,
  identity,
  payloadSha256,
  payloadBytes,
}: Readonly<{
  client: RPCClient;
  identity: ECOSHostedDrawingProviderIdentity;
  payloadSha256: string;
  payloadBytes: number;
}>): Promise<ECOSDrawingAnalysisOperation> {
  if (!LOWER_SHA256.test(payloadSha256) || !Number.isSafeInteger(payloadBytes) || payloadBytes < 1) {
    throw new ECOSDrawingOperationControlError('analysis_operation_identity_invalid');
  }
  const { data, error } = await client.rpc('ecos_begin_drawing_analysis', {
    p_organization_id: identity.organizationId,
    p_project_id: identity.projectId,
    p_document_id: identity.documentId,
    p_source_sha256: identity.sourceSha256,
    p_page_number: identity.pageNumber,
    p_hosted_job_id: identity.hostedJobId,
    p_hosted_claim_token: identity.hostedClaimToken,
    p_evidence_version: identity.evidenceVersion,
    p_visual_exception_fingerprint: identity.visualExceptionFingerprint,
    p_visual_region_key: identity.visualRegionKey,
    p_provider_operation_id: identity.providerOperationId,
    p_idempotency_key: identity.providerOperationId,
    p_payload_sha256: payloadSha256,
    p_payload_bytes: payloadBytes,
  });
  if (error || !isRecord(data)) {
    throw new ECOSDrawingOperationControlError('analysis_operation_control_unavailable');
  }
  const disposition = exactString(data.disposition);
  const requestId = exactString(data.requestId);
  if (!CANONICAL_UUID.test(requestId)) {
    throw new ECOSDrawingOperationControlError('analysis_operation_control_unavailable');
  }
  if (disposition === 'in_progress') {
    throw new ECOSDrawingOperationControlError('analysis_operation_in_progress');
  }
  if (disposition === 'replay') {
    if (!isRecord(data.response)) {
      throw new ECOSDrawingOperationControlError('analysis_operation_control_unavailable');
    }
    return Object.freeze({
      requestId,
      providerOperationId: identity.providerOperationId,
      replayResponse: data.response,
    });
  }
  if (disposition !== 'started') {
    throw new ECOSDrawingOperationControlError('analysis_operation_control_unavailable');
  }
  return Object.freeze({
    requestId,
    providerOperationId: identity.providerOperationId,
    replayResponse: null,
  });
}

export function createECOSDrawingProviderAttemptReservation({
  client,
  operation,
}: Readonly<{
  client: RPCClient;
  operation: ECOSDrawingAnalysisOperation;
}>): ECOSDrawingProviderAttemptReservation {
  let callOrdinal = 0;
  return async ({ callRole, provider, model }) => {
    callOrdinal += 1;
    const normalizedModel = exactString(model);
    if (!/^[\x21-\x7e]{1,160}$/.test(normalizedModel)) {
      throw new ECOSDrawingOperationControlError('drawing_provider_reservation_denied');
    }
    const idempotencyKey = [
      operation.providerOperationId,
      callRole,
      String(callOrdinal),
      provider,
      normalizedModel,
    ].join(':');
    const { data, error } = await client.rpc('ecos_reserve_drawing_provider_attempt', {
      p_request_id: operation.requestId,
      p_provider_operation_id: operation.providerOperationId,
      p_call_role: callRole,
      p_call_ordinal: callOrdinal,
      p_provider: provider,
      p_model: normalizedModel,
      p_idempotency_key: idempotencyKey,
    });
    if (error || data !== true) {
      throw new ECOSDrawingOperationControlError('drawing_provider_reservation_denied');
    }
  };
}

export async function finishECOSDrawingAnalysisOperation({
  client,
  operation,
  status,
  responsePayload = null,
  errorCode = null,
}: Readonly<{
  client: RPCClient;
  operation: ECOSDrawingAnalysisOperation;
  status: 'completed' | 'failed';
  responsePayload?: Record<string, unknown> | null;
  errorCode?: string | null;
}>) {
  const { data, error } = await client.rpc('ecos_finish_drawing_analysis', {
    p_request_id: operation.requestId,
    p_provider_operation_id: operation.providerOperationId,
    p_status: status,
    p_response_payload: responsePayload,
    p_error_code: errorCode,
  });
  if (error || data !== true) {
    throw new ECOSDrawingOperationControlError('analysis_operation_finish_failed');
  }
}

function asciiJSON(value: unknown) {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, character =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function exactString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function exactHostedTextId(value: string, maximumBytes: number) {
  return value.length >= 1 &&
    value.length <= maximumBytes &&
    PRINTABLE_ASCII.test(value) &&
    NON_SPACE_PRINTABLE_ASCII.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

