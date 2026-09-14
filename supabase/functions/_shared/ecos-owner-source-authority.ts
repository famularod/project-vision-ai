import { copyECOSV2JSON } from './ecos-v2-json-model.ts';
import {
  bindECOSProjectDocumentInventoryRow,
  type ECOSProjectDocumentInventoryRow,
} from './ecos-project-document-inventory.ts';

const POLICY = 'configured_app_owner_workspace/1.0' as const;
const CONTEXT = 'ecos-owner-source-authority-context/2.1' as const;
const DECISION = 'ecos-document-project-binding-decision/2.1' as const;
const RECEIPT = 'ecos-document-project-binding-receipt/2.1' as const;
const RESULT = 'ecos-document-project-binding-result/2.1' as const;
const READ = 'ecos-document-project-binding-read/2.1' as const;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const DECISION_KEYS = [
  'schema_version',
  'publication_mode',
  'decision_id',
  'organization_id',
  'owner_id',
  'reviewed_by',
  'review_project_id',
  'review_epoch_sha256',
  'document_id',
  'document_metadata_sha256',
  'content_sha256',
  'source_revision',
  'project_ids',
  'expected_previous_decision_id',
  'review_confirmation',
  'authority_policy',
  'original_organization_state',
  'source_page_count',
  'source_locator_sha256',
  'source_generation',
] as const;
const CONTEXT_KEYS = [
  'schema_version',
  'publication_mode',
  'authority_policy',
  'organization_id',
  'owner_id',
  'review_project_id',
  'document_id',
  'document_metadata_json',
  'document_metadata_sha256',
  'original_organization_state',
  'source_sha256',
  'source_revision',
  'source_page_count',
  'source_locator_sha256',
  'binding_context_sha256',
  'review_epoch_sha256',
  'project_ids',
  'selected_project_pins',
  'source_generation',
  'membership_sha256',
  'expected_previous_decision_id',
  'retrieval_authorized',
] as const;
const METADATA_KEYS = [
  'source_id',
  'owner_id',
  'name',
  'category',
  'updated_at',
  'document_data_type',
  'id',
  'organization_key_present',
  'organizationId',
  'projectId',
  'projectName',
  'projectNames',
  'projectIds',
  'category_data',
  'contentSha256',
  'drawingRevision',
  'webVersionGroupId',
  'sourcePageCount',
  'isCurrent',
  'drawingStatus',
  'storagePath',
  'sourceProvider',
  'externalSource',
  'originalFileName',
  'mimeType',
  'sizeBytes',
  'webFileFingerprint',
  'indexedContentSha256',
] as const;
const RECEIPT_KEYS = [
  'schema_version',
  'publication_mode',
  'decision_json',
  'decision_sha256',
  'version',
  'previous_decision_id',
  'binding_context_sha256',
  'committed_at',
  'verification',
  'retrieval_authorized',
] as const;
const READ_KEYS = [
  'schema_version',
  'publication_mode',
  'organization_id',
  'owner_id',
  'project_id',
  'document_id',
  'state',
  'decision_id',
  'receipt_json',
  'receipt_sha256',
  'retrieval_authorized',
] as const;

export interface ECOSOwnerSourceAuthorityContext {
  schema_version: typeof CONTEXT;
  publication_mode: 'shadow';
  authority_policy: typeof POLICY;
  organization_id: string;
  owner_id: string;
  review_project_id: string;
  document_id: string;
  document_metadata_json: string;
  document_metadata_sha256: string;
  original_organization_state: 'missing' | 'null';
  source_sha256: string;
  source_revision: string | null;
  source_page_count: number;
  source_locator_sha256: string;
  binding_context_sha256: string;
  review_epoch_sha256: string;
  project_ids: readonly string[];
  selected_project_pins: readonly Readonly<
    { project_id: string; project_sha256: string; generation: number }
  >[];
  source_generation: number;
  membership_sha256: string;
  expected_previous_decision_id: string | null;
  retrieval_authorized: false;
}
export interface ECOSOwnerSourceAuthorityDecision {
  schema_version: typeof DECISION;
  publication_mode: 'shadow';
  decision_id: string;
  organization_id: string;
  owner_id: string;
  reviewed_by: string;
  review_project_id: string;
  review_epoch_sha256: string;
  document_id: string;
  document_metadata_sha256: string;
  content_sha256: string;
  source_revision: string | null;
  project_ids: readonly string[];
  expected_previous_decision_id: string | null;
  review_confirmation: 'exact_project_ids_confirmed';
  authority_policy: typeof POLICY;
  original_organization_state: 'missing' | 'null';
  source_page_count: number;
  source_locator_sha256: string;
  source_generation: number;
}
export interface ECOSOwnerSourceAuthorityReceipt {
  schema_version: typeof RECEIPT;
  publication_mode: 'shadow';
  decision_json: string;
  decision_sha256: string;
  version: number;
  previous_decision_id: string | null;
  binding_context_sha256: string;
  committed_at: string;
  verification: 'owner_reviewed_association_only';
  retrieval_authorized: false;
  decision: Readonly<ECOSOwnerSourceAuthorityDecision>;
}
export interface ECOSOwnerSourceAuthorityRead {
  schema_version: typeof READ;
  publication_mode: 'shadow';
  organization_id: string;
  owner_id: string;
  project_id: string;
  document_id: string;
  state: 'missing' | 'stale' | 'current';
  decision_id: string | null;
  receipt_json: string | null;
  receipt_sha256: string | null;
  retrieval_authorized: false;
  receipt: Readonly<ECOSOwnerSourceAuthorityReceipt> | null;
  verification: 'authority_state_only_not_evidence_readiness';
}
export interface ECOSOwnerSourceAuthorityResult {
  schema_version: typeof RESULT;
  publication_mode: 'shadow';
  outcome: 'committed' | 'already_committed';
  receipt_json: string;
  receipt_sha256: string;
  current_head_decision_id: string;
  receipt: Readonly<ECOSOwnerSourceAuthorityReceipt>;
  binding_currentness: 'not_asserted_requires_read';
}
const contexts = new WeakSet<object>();
const decisions = new WeakMap<
  object,
  Readonly<ECOSOwnerSourceAuthorityContext>
>();
const reads = new WeakSet<object>();
const results = new WeakSet<object>();
function object(value: unknown, keys: readonly string[]) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) throw new Error('Owner authority requires plain data');
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    own.some((k) => typeof k !== 'string' || !keys.includes(k))
  ) throw new Error('Owner authority has missing or unsupported fields');
  const out: Record<string, unknown> = Object.create(null);
  for (const k of keys) {
    const p = Object.getOwnPropertyDescriptor(value, k);
    if (!p?.enumerable || !Object.hasOwn(p, 'value')) {
      throw new Error('Owner authority forbids accessors');
    }
    out[k] = p.value;
  }
  return out;
}
function snapshot(value: unknown, keys: readonly string[], max = 64 * 1024) {
  return object(copyECOSV2JSON(value, max), keys);
}
function pin(value: unknown, uuid = false): string {
  if (typeof value !== 'string' || !(uuid ? UUID : SHA).test(value)) {
    throw new Error('Owner authority has a noncanonical pin');
  }
  return value;
}
function unicode(value: string) {
  return !/[\ud800-\udfff]/u.test(
    value.replace(/[\ud800-\udbff][\udc00-\udfff]/gu, ''),
  );
}
function text(value: unknown, max: number): string {
  if (
    typeof value !== 'string' || !value || value !== value.trim() ||
    !unicode(value) || encoder.encode(value).length > max ||
    [...value].some((c) => {
      const n = c.codePointAt(0)!;
      return n < 32 || (n >= 127 && n <= 159);
    })
  ) throw new Error('Owner authority has invalid exact text');
  return value;
}
function rawText(value: unknown, max: number): string {
  if (
    typeof value !== 'string' || !value || !unicode(value) ||
    encoder.encode(value).length > max
  ) throw new Error('Owner authority raw text exceeds bounds');
  return value;
}
function integer(value: unknown, min = 0, max = 2147483647): number {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) || value < min ||
    value > max
  ) throw new Error('Owner authority integer exceeds bounds');
  return value;
}
function projectIds(value: unknown, sorted = true) {
  if (
    !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 1 || value.length > 20 ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) throw new Error('Owner authority project IDs exceed bounds');
  const ids = Array.from({ length: value.length }, (_, i) => {
    const p = Object.getOwnPropertyDescriptor(value, String(i));
    if (!p?.enumerable || !Object.hasOwn(p, 'value')) {
      throw new Error('Owner authority project IDs must be data');
    }
    return pin(p.value, true);
  });
  if (
    new Set(ids).size !== ids.length ||
    (sorted && ids.some((id, i) => i > 0 && ids[i - 1] >= id))
  ) throw new Error('Owner authority project IDs must be distinct and ordered');
  return Object.freeze(sorted ? ids : ids.sort());
}
const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);
function originalState(value: unknown): 'missing' | 'null' {
  if (value !== 'missing' && value !== 'null') {
    throw new Error('Owner authority cannot repair an explicit organization');
  }
  return value;
}
const revision = (value: unknown) => value === null ? null : text(value, 300);
const predecessor = (value: unknown) =>
  value === null ? null : pin(value, true);
async function hash(raw: string, expected: string) {
  const actual = [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(raw)),
    ),
  ].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw new Error('Owner authority raw hash mismatch');
}
function parse(
  raw: string,
  keys: readonly string[],
  onlyIntegers = false,
  integerFields: readonly string[] = [],
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Owner authority raw JSON invalid');
  }
  let p = 0;
  const ws = () => {
    while (p < raw.length && /[\x20\t\r\n]/.test(raw[p])) p++;
  };
  const str = () => {
    const start = p++;
    while (p < raw.length) {
      const c = raw[p++];
      if (c === '\\') p++;
      else if (c === '"') {
        const value = JSON.parse(raw.slice(start, p)) as string;
        if (!unicode(value) || value.includes(String.fromCharCode(0))) {
          throw new Error('Owner authority decoded Unicode invalid');
        }
        return value;
      }
    }
    throw new Error('Owner authority JSON string incomplete');
  };
  function visit(depth: number, field: string | null = null) {
    if (depth > 16) {
      throw new Error('Owner authority JSON nesting exceeds bounds');
    }
    ws();
    const opening = raw[p];
    if (opening === '{' || opening === '[') {
      p++;
      const end = opening === '{' ? '}' : ']', names = new Set<string>();
      ws();
      while (raw[p] !== end) {
        let name: string | null = null;
        if (opening === '{') {
          name = str();
          if (
            names.has(name) ||
            ['__proto__', 'constructor', 'prototype'].includes(name)
          ) throw new Error('Owner authority duplicate or unsafe JSON key');
          names.add(name);
          ws();
          p++;
        }
        visit(depth + 1, name);
        ws();
        if (raw[p] === end) break;
        p++;
        ws();
      }
      p++;
    } else if (opening === '"') str();
    else {
      const start = p;
      while (p < raw.length && !/[\x20\t\r\n,}\]]/.test(raw[p])) p++;
      const token = raw.slice(start, p);
      if (
        (onlyIntegers ||
          (depth === 1 && field !== null && integerFields.includes(field))) &&
        /^-?[0-9]/.test(token) &&
        (!/^(?:0|[1-9][0-9]*)$/.test(token) ||
          !Number.isSafeInteger(Number(token)))
      ) {
        throw new Error(
          'Owner authority receipt number must be a canonical integer',
        );
      }
    }
  }
  visit(0);
  return object(parsed, keys);
}

/** This privileged read is independently scoped by the service caller. Its
 * brand verifies source metadata/receipt identity, NOT authentication, available
 * downloaded bytes, human review, extraction coverage or retrieval permission. */
export async function bindECOSOwnerSourceAuthorityContext(
  raw: unknown,
  expectedInput: {
    ownerId: string;
    reviewProjectId: string;
    documentId: string;
    projectIds: readonly string[];
  },
): Promise<Readonly<ECOSOwnerSourceAuthorityContext>> {
  const e = snapshot(expectedInput, [
    'ownerId',
    'reviewProjectId',
    'documentId',
    'projectIds',
  ], 16 * 1024);
  const owner = pin(e.ownerId, true),
    reviewProject = pin(e.reviewProjectId, true),
    document = text(e.documentId, 300),
    selected = projectIds(e.projectIds, false);
  const v = snapshot(raw, CONTEXT_KEYS);
  if (
    v.schema_version !== CONTEXT || v.publication_mode !== 'shadow' ||
    v.authority_policy !== POLICY || v.organization_id !== owner ||
    v.owner_id !== owner || v.review_project_id !== reviewProject ||
    v.document_id !== document || v.retrieval_authorized !== false
  ) throw new Error('Owner authority context scope mismatch');
  const ids = projectIds(v.project_ids);
  if (!sameIds(ids, selected) || !ids.includes(reviewProject)) {
    throw new Error(
      'Owner authority context changed explicit project selection',
    );
  }
  if (
    !Array.isArray(v.selected_project_pins) ||
    v.selected_project_pins.length !== ids.length
  ) throw new Error('Owner authority project pins incomplete');
  const projects = v.selected_project_pins.map((item, i) => {
    const r = object(item, ['project_id', 'project_sha256', 'generation']);
    if (r.project_id !== ids[i]) {
      throw new Error('Owner authority project pin order mismatch');
    }
    return Object.freeze({
      project_id: ids[i],
      project_sha256: pin(r.project_sha256),
      generation: integer(r.generation),
    });
  });
  const result: Readonly<ECOSOwnerSourceAuthorityContext> = Object.freeze({
    schema_version: CONTEXT,
    publication_mode: 'shadow',
    authority_policy: POLICY,
    organization_id: owner,
    owner_id: owner,
    review_project_id: reviewProject,
    document_id: document,
    document_metadata_json: rawText(v.document_metadata_json, 16 * 1024),
    document_metadata_sha256: pin(v.document_metadata_sha256),
    original_organization_state: originalState(v.original_organization_state),
    source_sha256: pin(v.source_sha256),
    source_revision: revision(v.source_revision),
    source_page_count: integer(v.source_page_count, 1, 10000),
    source_locator_sha256: pin(v.source_locator_sha256),
    binding_context_sha256: pin(v.binding_context_sha256),
    review_epoch_sha256: pin(v.review_epoch_sha256),
    project_ids: ids,
    selected_project_pins: Object.freeze(projects),
    source_generation: integer(v.source_generation),
    membership_sha256: pin(v.membership_sha256),
    expected_previous_decision_id: predecessor(v.expected_previous_decision_id),
    retrieval_authorized: false,
  });
  await hash(result.document_metadata_json, result.document_metadata_sha256);
  const m = parse(result.document_metadata_json, METADATA_KEYS, false, [
    'sourcePageCount',
  ]);
  if (
    m.source_id !== document || m.id !== document || m.owner_id !== owner ||
    m.document_data_type !== 'object' || m.organizationId !== null ||
    m.organization_key_present !==
      (result.original_organization_state === 'null') ||
    m.contentSha256 !== result.source_sha256 ||
    m.drawingRevision !== result.source_revision ||
    m.sourcePageCount !== result.source_page_count || m.isCurrent !== true ||
    (m.drawingStatus !== null && typeof m.drawingStatus !== 'string') ||
    (typeof m.drawingStatus === 'string' &&
      m.drawingStatus.trim().toLowerCase() === 'superseded')
  ) {
    throw new Error(
      'Owner authority metadata is not the exact current missing-organization source',
    );
  }
  if (
    m.projectId !== null &&
    (!UUID.test(String(m.projectId)) || !ids.includes(m.projectId as string))
  ) {
    throw new Error(
      'Owner authority must preserve the recorded primary project',
    );
  }
  contexts.add(result);
  return result;
}
export function assertECOSOwnerSourceAuthorityContext(
  value: unknown,
): asserts value is ECOSOwnerSourceAuthorityContext {
  if (!value || typeof value !== 'object' || !contexts.has(value)) {
    throw new Error('Owner authority context must be independently bound');
  }
}
function decisionWire(
  raw: unknown,
): Readonly<ECOSOwnerSourceAuthorityDecision> {
  const v = snapshot(raw, DECISION_KEYS, 16 * 1024),
    owner = pin(v.owner_id, true),
    id = pin(v.decision_id, true),
    review = pin(v.review_project_id, true),
    ids = projectIds(v.project_ids),
    previous = predecessor(v.expected_previous_decision_id);
  if (
    v.schema_version !== DECISION || v.publication_mode !== 'shadow' ||
    v.authority_policy !== POLICY ||
    v.review_confirmation !== 'exact_project_ids_confirmed' ||
    v.organization_id !== owner || v.reviewed_by !== owner ||
    !ids.includes(review) || previous === id
  ) throw new Error('Owner authority decision scope or protocol mismatch');
  return Object.freeze({
    schema_version: DECISION,
    publication_mode: 'shadow',
    decision_id: id,
    organization_id: owner,
    owner_id: owner,
    reviewed_by: owner,
    review_project_id: review,
    review_epoch_sha256: pin(v.review_epoch_sha256),
    document_id: text(v.document_id, 300),
    document_metadata_sha256: pin(v.document_metadata_sha256),
    content_sha256: pin(v.content_sha256),
    source_revision: revision(v.source_revision),
    project_ids: ids,
    expected_previous_decision_id: previous,
    review_confirmation: 'exact_project_ids_confirmed',
    authority_policy: POLICY,
    original_organization_state: originalState(v.original_organization_state),
    source_page_count: integer(v.source_page_count, 1, 10000),
    source_locator_sha256: pin(v.source_locator_sha256),
    source_generation: integer(v.source_generation),
  });
}
/** Explicit operator assertion, not a fabricated human-review or download proof. */
export function prepareECOSOwnerSourceAuthorityDecision(
  context: Readonly<ECOSOwnerSourceAuthorityContext>,
  input: {
    decisionId: string;
    reviewerId: string;
    confirmation: 'exact_project_ids_confirmed';
  },
): Readonly<ECOSOwnerSourceAuthorityDecision> {
  assertECOSOwnerSourceAuthorityContext(context);
  const v = snapshot(
    input,
    ['decisionId', 'reviewerId', 'confirmation'],
    16 * 1024,
  );
  const result = decisionWire({
    schema_version: DECISION,
    publication_mode: 'shadow',
    decision_id: v.decisionId,
    organization_id: context.organization_id,
    owner_id: context.owner_id,
    reviewed_by: v.reviewerId,
    review_project_id: context.review_project_id,
    review_epoch_sha256: context.review_epoch_sha256,
    document_id: context.document_id,
    document_metadata_sha256: context.document_metadata_sha256,
    content_sha256: context.source_sha256,
    source_revision: context.source_revision,
    project_ids: context.project_ids,
    expected_previous_decision_id: context.expected_previous_decision_id,
    review_confirmation: v.confirmation,
    authority_policy: POLICY,
    original_organization_state: context.original_organization_state,
    source_page_count: context.source_page_count,
    source_locator_sha256: context.source_locator_sha256,
    source_generation: context.source_generation,
  });
  decisions.set(result, context);
  return result;
}
export function assertECOSOwnerSourceAuthorityDecision(
  value: unknown,
): asserts value is ECOSOwnerSourceAuthorityDecision {
  if (!value || typeof value !== 'object' || !decisions.has(value)) {
    throw new Error(
      'Owner authority decision requires genuine context and explicit confirmation',
    );
  }
}
function utc(value: unknown) {
  const s = rawText(value, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(s)
  ) throw new Error('Owner authority timestamp must be UTC');
  const base = s.slice(0, 19), time = Date.parse(base + '.000Z');
  if (
    !Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== base
  ) throw new Error('Owner authority timestamp invalid');
  return s;
}
async function receipt(
  raw: string,
  sha: string,
): Promise<Readonly<ECOSOwnerSourceAuthorityReceipt>> {
  await hash(raw, sha);
  const v = parse(raw, RECEIPT_KEYS, true);
  if (
    v.schema_version !== RECEIPT || v.publication_mode !== 'shadow' ||
    v.verification !== 'owner_reviewed_association_only' ||
    v.retrieval_authorized !== false
  ) throw new Error('Owner authority receipt protocol mismatch');
  const decision_json = rawText(v.decision_json, 16 * 1024),
    decision_sha256 = pin(v.decision_sha256),
    version = integer(v.version, 1),
    previous = predecessor(v.previous_decision_id),
    binding_context_sha256 = pin(v.binding_context_sha256),
    committed_at = utc(v.committed_at);
  if ((version === 1) !== (previous === null)) {
    throw new Error('Owner authority receipt predecessor mismatch');
  }
  await hash(decision_json, decision_sha256);
  const decision = decisionWire(parse(decision_json, DECISION_KEYS, true));
  if (decision.expected_previous_decision_id !== previous) {
    throw new Error('Owner authority receipt changed decision predecessor');
  }
  return Object.freeze({
    schema_version: RECEIPT,
    publication_mode: 'shadow',
    decision_json,
    decision_sha256,
    version,
    previous_decision_id: previous,
    binding_context_sha256,
    committed_at,
    verification: 'owner_reviewed_association_only',
    retrieval_authorized: false,
    decision,
  });
}
export async function bindECOSOwnerSourceAuthorityResult(
  raw: unknown,
  decision: Readonly<ECOSOwnerSourceAuthorityDecision>,
): Promise<Readonly<ECOSOwnerSourceAuthorityResult>> {
  assertECOSOwnerSourceAuthorityDecision(decision);
  const v = snapshot(raw, [
    'schema_version',
    'publication_mode',
    'outcome',
    'receipt_json',
    'receipt_sha256',
    'current_head_decision_id',
  ], 80 * 1024);
  if (
    v.schema_version !== RESULT || v.publication_mode !== 'shadow' ||
    (v.outcome !== 'committed' && v.outcome !== 'already_committed')
  ) throw new Error('Owner authority result protocol mismatch');
  const receipt_json = rawText(v.receipt_json, 64 * 1024),
    receipt_sha256 = pin(v.receipt_sha256),
    head = pin(v.current_head_decision_id, true),
    outcome = v.outcome;
  if (outcome === 'committed' && head !== decision.decision_id) {
    throw new Error('Owner authority newly committed head mismatch');
  }
  const checked = await receipt(receipt_json, receipt_sha256);
  if (
    DECISION_KEYS.some((k) =>
      k === 'project_ids'
        ? !sameIds(checked.decision.project_ids, decision.project_ids)
        : checked.decision[k] !== decision[k]
    ) ||
    checked.binding_context_sha256 !==
      decisions.get(decision)!.binding_context_sha256
  ) {
    throw new Error(
      'Owner authority result differs from exact prepared decision/context',
    );
  }
  const result = Object.freeze({
    schema_version: RESULT,
    publication_mode: 'shadow' as const,
    outcome,
    receipt_json,
    receipt_sha256,
    current_head_decision_id: head,
    receipt: checked,
    binding_currentness: 'not_asserted_requires_read' as const,
  });
  results.add(result);
  return result;
}
export function assertECOSOwnerSourceAuthorityResult(
  value: unknown,
): asserts value is ECOSOwnerSourceAuthorityResult {
  if (!value || typeof value !== 'object' || !results.has(value)) {
    throw new Error('Owner authority result must be independently bound');
  }
}
export async function bindECOSOwnerSourceAuthorityRead(
  raw: unknown,
  expectedInput: {
    ownerId: string;
    projectId: string;
    documentId: string;
    decisionId: string | null;
  },
): Promise<Readonly<ECOSOwnerSourceAuthorityRead>> {
  const e = snapshot(expectedInput, [
      'ownerId',
      'projectId',
      'documentId',
      'decisionId',
    ], 16 * 1024),
    owner = pin(e.ownerId, true),
    project = pin(e.projectId, true),
    document = text(e.documentId, 300),
    expectedDecision = predecessor(e.decisionId),
    v = snapshot(raw, READ_KEYS, 80 * 1024);
  if (
    v.schema_version !== READ || v.publication_mode !== 'shadow' ||
    v.organization_id !== owner || v.owner_id !== owner ||
    v.project_id !== project || v.document_id !== document ||
    v.retrieval_authorized !== false ||
    !['missing', 'stale', 'current'].includes(v.state as string)
  ) throw new Error('Owner authority read scope or protocol mismatch');
  const state = v.state as 'missing' | 'stale' | 'current',
    decision_id = predecessor(v.decision_id),
    receipt_json = v.receipt_json === null
      ? null
      : rawText(v.receipt_json, 64 * 1024),
    receipt_sha256 = v.receipt_sha256 === null ? null : pin(v.receipt_sha256);
  if (
    state === 'missing'
      ? decision_id !== null || receipt_json !== null || receipt_sha256 !== null
      : state === 'stale'
      ? decision_id === null || receipt_json !== null || receipt_sha256 !== null
      : decision_id === null || receipt_json === null || receipt_sha256 === null
  ) throw new Error('Owner authority read state contradicts receipt pins');
  const checked = state === 'current'
    ? await receipt(receipt_json!, receipt_sha256!)
    : null;
  if (
    checked &&
    (checked.decision.decision_id !== decision_id ||
      checked.decision.owner_id !== owner ||
      checked.decision.organization_id !== owner ||
      checked.decision.document_id !== document ||
      !checked.decision.project_ids.includes(project) ||
      (expectedDecision !== null && expectedDecision !== decision_id))
  ) {
    throw new Error(
      'Owner authority current read changed exact decision scope',
    );
  }
  const result = Object.freeze({
    schema_version: READ,
    publication_mode: 'shadow' as const,
    organization_id: owner,
    owner_id: owner,
    project_id: project,
    document_id: document,
    state,
    decision_id,
    receipt_json,
    receipt_sha256,
    retrieval_authorized: false as const,
    receipt: checked,
    verification: 'authority_state_only_not_evidence_readiness' as const,
  });
  reads.add(result);
  return result;
}
export function assertECOSOwnerSourceAuthorityRead(
  value: unknown,
): asserts value is ECOSOwnerSourceAuthorityRead {
  if (!value || typeof value !== 'object' || !reads.has(value)) {
    throw new Error('Owner authority read must be independently bound');
  }
}
export interface ECOSOwnerEffectiveSource {
  source_id: string;
  source_sha256: string;
  source_revision: string | null;
  source_page_count: number;
  authority_kind: 'owner_workspace_receipt';
  authority_decision_id: string;
  authority_receipt_sha256: string;
  source_locator_sha256: string;
}
/** Derives distinct expected source pins; never rewrites the original summary,
 * creates an old inventory brand, or proves that any source bytes were read. */
export function deriveECOSOwnerEffectiveSource(
  registryRow: Readonly<ECOSProjectDocumentInventoryRow> | null,
  read: Readonly<ECOSOwnerSourceAuthorityRead>,
): Readonly<ECOSOwnerEffectiveSource> | null {
  assertECOSOwnerSourceAuthorityRead(read);
  if (read.state !== 'current') return null;
  const source = registryRow === null
    ? null
    : bindECOSProjectDocumentInventoryRow(registryRow);
  if (
    !source || source.source_id !== read.document_id ||
    source.disposition !== 'needs_review' || source.limitations.length !== 1 ||
    source.limitations[0] !== 'organization_scope_missing'
  ) {
    throw new Error(
      'Owner authority current source must retain its original missing-organization summary',
    );
  }
  const d = read.receipt!.decision;
  return Object.freeze({
    source_id: d.document_id,
    source_sha256: d.content_sha256,
    source_revision: d.source_revision,
    source_page_count: d.source_page_count,
    authority_kind: 'owner_workspace_receipt',
    authority_decision_id: d.decision_id,
    authority_receipt_sha256: read.receipt_sha256!,
    source_locator_sha256: d.source_locator_sha256,
  });
}
