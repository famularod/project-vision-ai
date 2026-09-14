import {
  assertECOSV2ManagedOriginalVerification,
  ECOS_V2_MANAGED_ORIGINAL_BUCKET,
  ECOS_V2_MANAGED_ORIGINAL_PROJECT_URL,
  type ECOSV2ManagedOriginalVerification,
} from './ecos-v2-managed-original.ts';
import {
  assertECOSOwnerSourceAuthorityRead,
  type ECOSOwnerSourceAuthorityRead,
} from './ecos-owner-source-authority.ts';

/** Internal supplied-readback binding only: no RPC/network, automatic enrollment,
 * source locator mutation, or Storage policy assertion. SQL records a trusted
 * service attestation; SQL does not independently inspect Storage bytes. */
export interface ECOSManagedOriginalAttestation {
  schema_version: 'ecos-managed-original-attestation/2.0';
  publication_mode: 'shadow';
  owner_id: string;
  organization_id: string;
  project_id: string;
  source_id: string;
  attempt_id: string;
  expected_previous_attempt_id: string | null;
  authority_decision_id: string;
  authority_receipt_sha256: string;
  source_generation: number;
  source_metadata_sha256: string;
  original_locator_sha256: string;
  source_revision: string | null;
  content_sha256: string;
  source_id_sha256: string;
  byte_length: number;
  measured_page_count: number;
  project_url: typeof ECOS_V2_MANAGED_ORIGINAL_PROJECT_URL;
  bucket: typeof ECOS_V2_MANAGED_ORIGINAL_BUCKET;
  object_key: string;
  verification: 'exact_bytes_sha256_and_independent_pdf_page_count';
  retrieval_authorized: false;
}
export interface ECOSManagedOriginalReceipt {
  schema_version: 'ecos-managed-original-receipt/2.0';
  publication_mode: 'shadow';
  attestation_json: string;
  attestation_sha256: string;
  version: number;
  previous_attempt_id: string | null;
  committed_at: string;
  verification: 'trusted_service_attested_storage_readback';
  retrieval_authorized: false;
  attestation: Readonly<ECOSManagedOriginalAttestation>;
}
export interface ECOSManagedOriginalResult {
  schema_version: 'ecos-managed-original-result/2.0';
  publication_mode: 'shadow';
  outcome: 'committed' | 'already_committed';
  receipt_json: string;
  receipt_sha256: string;
  current_head_attempt_id: string;
  retrieval_authorized: false;
  receipt: Readonly<ECOSManagedOriginalReceipt>;
  currentness: 'not_asserted_requires_read';
}
export interface ECOSManagedOriginalRead {
  schema_version: 'ecos-managed-original-read/2.0';
  publication_mode: 'shadow';
  owner_id: string;
  organization_id: string;
  project_id: string;
  source_id: string;
  state: 'missing' | 'stale' | 'current';
  attempt_id: string | null;
  receipt_json: string | null;
  receipt_sha256: string | null;
  retrieval_authorized: false;
  receipt: Readonly<ECOSManagedOriginalReceipt> | null;
  currentness: 'supplied_database_and_authority_readbacks_only';
  storage_currentness: 'not_rechecked';
  enrollment: 'not_performed';
}
const ATTESTATION_KEYS = [
  'schema_version',
  'publication_mode',
  'owner_id',
  'organization_id',
  'project_id',
  'source_id',
  'attempt_id',
  'expected_previous_attempt_id',
  'authority_decision_id',
  'authority_receipt_sha256',
  'source_generation',
  'source_metadata_sha256',
  'original_locator_sha256',
  'source_revision',
  'content_sha256',
  'source_id_sha256',
  'byte_length',
  'measured_page_count',
  'project_url',
  'bucket',
  'object_key',
  'verification',
  'retrieval_authorized',
] as const;
const RECEIPT_KEYS = [
  'schema_version',
  'publication_mode',
  'attestation_json',
  'attestation_sha256',
  'version',
  'previous_attempt_id',
  'committed_at',
  'verification',
  'retrieval_authorized',
] as const;
const RESULT_KEYS = [
  'schema_version',
  'publication_mode',
  'outcome',
  'receipt_json',
  'receipt_sha256',
  'current_head_attempt_id',
  'retrieval_authorized',
] as const;
const READ_KEYS = [
  'schema_version',
  'publication_mode',
  'owner_id',
  'organization_id',
  'project_id',
  'source_id',
  'state',
  'attempt_id',
  'receipt_json',
  'receipt_sha256',
  'retrieval_authorized',
] as const;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ATTEMPT =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const attestations = new WeakSet<object>(), results = new WeakSet<object>();
const reads = new WeakMap<object, Readonly<ECOSOwnerSourceAuthorityRead>>();
const fail = () => {
  throw new Error('Managed-original registry binding rejected');
};
function object(value: unknown, keys: readonly string[]) {
  if (
    !value || typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value),
    own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    own.some((k) => typeof k !== 'string' || !keys.includes(k)) ||
    Object.values(descriptors).some((d) =>
      !d.enumerable || !Object.hasOwn(d, 'value')
    )
  ) return fail();
  return Object.fromEntries(
    Object.entries(descriptors).map(([k, d]) => [k, d.value]),
  ) as Record<string, unknown>;
}
function text(value: unknown, max: number) {
  if (
    typeof value !== 'string' || value.length > max ||
    encoder.encode(value).length > max ||
    value.includes('\0') ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u
      .test(value)
  ) return fail();
  return value;
}
function uuid(value: unknown, attempt = false): string {
  if (typeof value !== 'string' || !(attempt ? ATTEMPT : UUID).test(value)) {
    return fail();
  }
  return value;
}
function sha(value: unknown) {
  if (typeof value !== 'string' || !SHA.test(value)) return fail();
  return value;
}
function integer(value: unknown, min: number, max: number) {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) || value < min ||
    value > max
  ) return fail();
  return value;
}
function controls(value: string) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}
async function digest(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  ].map((v) => v.toString(16).padStart(2, '0')).join('');
}
// Both wire objects are flat scalar JSON. Scan the bounded original string so
// duplicate keys, exponent/fractional numeric tokens and rounded near-integers
// cannot be hidden by JSON.parse before hash verification.
function parse(raw: string, keys: readonly string[]) {
  let p = 0;
  const seen = new Set<string>();
  const space = () => {
    while (/[\t\r\n ]/.test(raw[p] ?? '!')) p++;
  };
  const quoted = () => {
    const start = p;
    if (raw[p++] !== '"') return fail();
    while (p < raw.length) {
      const ch = raw[p++];
      if (ch === '\\') {
        p++;
        continue;
      }
      if (ch === '"') return JSON.parse(raw.slice(start, p)) as string;
    }
    return fail();
  };
  space();
  if (raw[p++] !== '{') return fail();
  space();
  while (raw[p] !== '}') {
    const key = quoted();
    if (seen.has(key)) return fail();
    seen.add(key);
    space();
    if (raw[p++] !== ':') return fail();
    space();
    if (raw[p] === '"') quoted();
    else {
      const start = p;
      while (p < raw.length && !/[},\t\r\n ]/.test(raw[p])) p++;
      if (!/^(?:0|[1-9][0-9]*|true|false|null)$/.test(raw.slice(start, p))) {
        return fail();
      }
    }
    space();
    if (raw[p] === ',') {
      p++;
      space();
      if (raw[p] === '}') return fail();
    } else if (raw[p] !== '}') return fail();
  }
  p++;
  space();
  if (p !== raw.length) return fail();
  return object(JSON.parse(raw), keys);
}
function attestationWire(
  v: Record<string, unknown>,
): Readonly<ECOSManagedOriginalAttestation> {
  if (
    v.schema_version !== 'ecos-managed-original-attestation/2.0' ||
    v.publication_mode !== 'shadow' || v.retrieval_authorized !== false ||
    v.project_url !== ECOS_V2_MANAGED_ORIGINAL_PROJECT_URL ||
    v.bucket !== ECOS_V2_MANAGED_ORIGINAL_BUCKET ||
    v.verification !== 'exact_bytes_sha256_and_independent_pdf_page_count'
  ) return fail();
  for (
    const k of [
      'owner_id',
      'organization_id',
      'project_id',
      'authority_decision_id',
    ]
  ) uuid(v[k]);
  uuid(v.attempt_id, true);
  if (v.expected_previous_attempt_id !== null) {
    uuid(v.expected_previous_attempt_id, true);
  }
  if (
    v.owner_id !== v.organization_id ||
    v.expected_previous_attempt_id === v.attempt_id
  ) return fail();
  const source = text(v.source_id, 300);
  if (
    !source || source.trim() !== source || controls(source)
  ) return fail();
  if (v.source_revision !== null) {
    const revision = text(v.source_revision, 300);
    if (
      !revision || revision.trim() !== revision ||
      controls(revision)
    ) return fail();
  }
  for (
    const k of [
      'authority_receipt_sha256',
      'source_metadata_sha256',
      'original_locator_sha256',
      'content_sha256',
      'source_id_sha256',
    ]
  ) sha(v[k]);
  integer(v.source_generation, 0, 2147483647);
  integer(v.byte_length, 5, 67108864);
  integer(v.measured_page_count, 1, 10000);
  if (
    v.object_key !==
      `v2-originals/${v.owner_id}/${v.source_id_sha256}/${v.content_sha256}/${v.attempt_id}.pdf`
  ) return fail();
  return Object.freeze(v) as unknown as Readonly<
    ECOSManagedOriginalAttestation
  >;
}
export function prepareECOSManagedOriginalAttestation(
  verification: Readonly<ECOSV2ManagedOriginalVerification>,
  expectedPreviousAttemptId: string | null,
): Readonly<ECOSManagedOriginalAttestation> {
  assertECOSV2ManagedOriginalVerification(verification);
  if (expectedPreviousAttemptId !== null) uuid(expectedPreviousAttemptId, true);
  const p = verification.authority;
  const a = attestationWire({
    schema_version: 'ecos-managed-original-attestation/2.0',
    publication_mode: 'shadow',
    owner_id: p.ownerId,
    organization_id: p.organizationId,
    project_id: p.projectId,
    source_id: p.sourceId,
    attempt_id: verification.attemptId,
    expected_previous_attempt_id: expectedPreviousAttemptId,
    authority_decision_id: p.decisionId,
    authority_receipt_sha256: p.receiptSha256,
    source_generation: p.sourceGeneration,
    source_metadata_sha256: p.sourceMetadataSha256,
    original_locator_sha256: p.originalLocatorSha256,
    source_revision: p.sourceRevision,
    content_sha256: verification.contentSha256,
    source_id_sha256: verification.sourceIdSha256,
    byte_length: verification.byteLength,
    measured_page_count: verification.measuredPageCount,
    project_url: verification.projectUrl,
    bucket: verification.bucket,
    object_key: verification.objectKey,
    verification: verification.verification,
    retrieval_authorized: false,
  });
  attestations.add(a);
  return a;
}
export function assertECOSManagedOriginalAttestation(
  value: unknown,
): asserts value is Readonly<ECOSManagedOriginalAttestation> {
  if (!value || typeof value !== 'object' || !attestations.has(value)) fail();
}
async function receipt(
  raw: string,
  expectedSha: string,
): Promise<Readonly<ECOSManagedOriginalReceipt>> {
  const v = parse(raw, RECEIPT_KEYS);
  if (
    v.schema_version !== 'ecos-managed-original-receipt/2.0' ||
    v.publication_mode !== 'shadow' || v.retrieval_authorized !== false ||
    v.verification !== 'trusted_service_attested_storage_readback'
  ) return fail();
  const attestationJson = text(v.attestation_json, 16384),
    attestationSha = sha(v.attestation_sha256),
    a = attestationWire(parse(attestationJson, ATTESTATION_KEYS));
  const version = integer(v.version, 1, 1000);
  if (v.previous_attempt_id !== null) uuid(v.previous_attempt_id, true);
  if (
    v.previous_attempt_id !== a.expected_previous_attempt_id ||
    (version === 1) !== (v.previous_attempt_id === null)
  ) return fail();
  const stamp = text(v.committed_at, 27);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(stamp) ||
    !Number.isFinite(Date.parse(stamp)) ||
    new Date(Date.parse(stamp)).toISOString().slice(0, 19) !==
      stamp.slice(0, 19)
  ) return fail();
  if (
    await digest(raw) !== expectedSha ||
    await digest(attestationJson) !== attestationSha ||
    await digest(a.source_id) !== a.source_id_sha256
  ) return fail();
  return Object.freeze({ ...v, attestation: a }) as unknown as Readonly<
    ECOSManagedOriginalReceipt
  >;
}
export async function bindECOSManagedOriginalResult(
  raw: unknown,
  attestation: Readonly<ECOSManagedOriginalAttestation>,
): Promise<Readonly<ECOSManagedOriginalResult>> {
  assertECOSManagedOriginalAttestation(attestation);
  const v = object(raw, RESULT_KEYS),
    rtext = text(v.receipt_json, 20000),
    rsha = sha(v.receipt_sha256);
  uuid(v.current_head_attempt_id, true);
  if (
    v.schema_version !== 'ecos-managed-original-result/2.0' ||
    v.publication_mode !== 'shadow' || v.retrieval_authorized !== false ||
    !['committed', 'already_committed'].includes(v.outcome as string) ||
    (v.outcome === 'committed' &&
      v.current_head_attempt_id !== attestation.attempt_id)
  ) return fail();
  const r = await receipt(rtext, rsha);
  if (ATTESTATION_KEYS.some((k) => r.attestation[k] !== attestation[k])) {
    return fail();
  }
  const result = Object.freeze({
    ...v,
    receipt: r,
    currentness: 'not_asserted_requires_read',
  }) as unknown as Readonly<ECOSManagedOriginalResult>;
  results.add(result);
  return result;
}
export function assertECOSManagedOriginalResult(
  value: unknown,
): asserts value is Readonly<ECOSManagedOriginalResult> {
  if (!value || typeof value !== 'object' || !results.has(value)) fail();
}
export async function bindECOSManagedOriginalRead(
  raw: unknown,
  authority: Readonly<ECOSOwnerSourceAuthorityRead>,
): Promise<Readonly<ECOSManagedOriginalRead>> {
  assertECOSOwnerSourceAuthorityRead(authority);
  const v = object(raw, READ_KEYS);
  if (
    v.schema_version !== 'ecos-managed-original-read/2.0' ||
    v.publication_mode !== 'shadow' || v.retrieval_authorized !== false ||
    v.owner_id !== authority.owner_id ||
    v.organization_id !== authority.organization_id ||
    v.project_id !== authority.project_id ||
    v.source_id !== authority.document_id ||
    !['missing', 'stale', 'current'].includes(v.state as string)
  ) return fail();
  let r: Readonly<ECOSManagedOriginalReceipt> | null = null;
  if (v.state === 'missing') {
    if (
      v.attempt_id !== null || v.receipt_json !== null ||
      v.receipt_sha256 !== null
    ) return fail();
  } else {
    uuid(v.attempt_id, true);
    if (v.state === 'stale') {
      if (v.receipt_json !== null || v.receipt_sha256 !== null) {
        return fail();
      }
    } else {
      if (authority.state !== 'current' || !authority.receipt) return fail();
      r = await receipt(text(v.receipt_json, 20000), sha(v.receipt_sha256));
      const a = r.attestation, d = authority.receipt.decision;
      if (
        a.owner_id !== v.owner_id || a.organization_id !== v.organization_id ||
        a.project_id !== v.project_id || a.source_id !== v.source_id ||
        a.attempt_id !== v.attempt_id ||
        a.authority_decision_id !== authority.decision_id ||
        a.authority_receipt_sha256 !== authority.receipt_sha256 ||
        a.content_sha256 !== d.content_sha256 ||
        a.source_revision !== d.source_revision ||
        a.measured_page_count !== d.source_page_count ||
        a.source_generation !== d.source_generation ||
        a.source_metadata_sha256 !== d.document_metadata_sha256 ||
        a.original_locator_sha256 !== d.source_locator_sha256
      ) return fail();
    }
  }
  const result = Object.freeze({
    ...v,
    receipt: r,
    currentness: 'supplied_database_and_authority_readbacks_only',
    storage_currentness: 'not_rechecked',
    enrollment: 'not_performed',
  }) as unknown as Readonly<ECOSManagedOriginalRead>;
  reads.set(result, authority);
  return result;
}
export function assertECOSManagedOriginalRead(
  value: unknown,
  authority: Readonly<ECOSOwnerSourceAuthorityRead>,
): asserts value is Readonly<ECOSManagedOriginalRead> {
  assertECOSOwnerSourceAuthorityRead(authority);
  if (!value || typeof value !== 'object' || reads.get(value) !== authority) {
    fail();
  }
}
