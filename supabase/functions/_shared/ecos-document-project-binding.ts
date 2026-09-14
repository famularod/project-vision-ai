import {
  assertECOSDocumentAssociationReviewInventory,
  type ECOSDocumentAssociationReviewInventory,
} from './ecos-document-association-review.ts';

const DECISION_SCHEMA = 'ecos-document-project-binding-decision/2.0' as const;
const RECEIPT_SCHEMA = 'ecos-document-project-binding-receipt/2.0' as const;
const RESULT_SCHEMA = 'ecos-document-project-binding-result/2.0' as const;
const READ_SCHEMA = 'ecos-document-project-binding-read/2.0' as const;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();

export interface ECOSDocumentProjectBindingSelection {
  decisionId: string;
  documentId: string;
  projectIds: readonly string[];
  expectedPreviousDecisionId: string | null;
  reviewerId: string;
  confirmation: 'exact_project_ids_confirmed';
}
export interface ECOSDocumentProjectBindingDecision {
  schema_version: typeof DECISION_SCHEMA;
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
}
export interface ECOSDocumentProjectBindingReceipt {
  schema_version: typeof RECEIPT_SCHEMA;
  publication_mode: 'shadow';
  decision_json: string;
  decision_sha256: string;
  version: number;
  previous_decision_id: string | null;
  binding_context_sha256: string;
  committed_at: string;
  verification: 'owner_reviewed_association_only';
  retrieval_authorized: false;
  decision: Readonly<ECOSDocumentProjectBindingDecision>;
}
export interface ECOSDocumentProjectBindingResult {
  schema_version: typeof RESULT_SCHEMA;
  publication_mode: 'shadow';
  outcome: 'committed' | 'already_committed';
  receipt_json: string;
  receipt_sha256: string;
  current_head_decision_id: string;
  receipt: Readonly<ECOSDocumentProjectBindingReceipt>;
  binding_currentness: 'not_asserted_requires_read';
}
export interface ECOSExpectedDocumentProjectBindingRead {
  organizationId: string;
  ownerId: string;
  projectId: string;
  documentId: string;
  decisionId: string | null;
}
export interface ECOSDocumentProjectBindingRead {
  schema_version: typeof READ_SCHEMA;
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
  receipt: Readonly<ECOSDocumentProjectBindingReceipt> | null;
  verification: 'binding_state_only_not_evidence_authority';
}
const SELECTION_KEYS = [
  'decisionId',
  'documentId',
  'projectIds',
  'expectedPreviousDecisionId',
  'reviewerId',
  'confirmation',
] as const;
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
const RESULT_KEYS = [
  'schema_version',
  'publication_mode',
  'outcome',
  'receipt_json',
  'receipt_sha256',
  'current_head_decision_id',
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
const READ_EXPECTED_KEYS = [
  'organizationId',
  'ownerId',
  'projectId',
  'documentId',
  'decisionId',
] as const;
const decisions = new WeakSet<object>(),
  results = new WeakSet<object>(),
  reads = new WeakSet<object>();

function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null);
}
function object(value: unknown, keys: readonly string[], field: string) {
  if (!plain(value)) throw new Error(`${field} must be a plain data object`);
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    throw new Error(`${field} has missing or unsupported fields`);
  }
  const copied: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${field} must contain data properties only`);
    }
    copied[key] = descriptor.value;
  }
  return copied;
}
function array(value: unknown, maximum: number, field: string): unknown[] {
  if (
    !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new Error(`${field} must be a bounded dense data array`);
  }
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${field} must contain data properties only`);
    }
    return descriptor.value;
  });
}
function unicode(value: string) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function text(value: unknown, maximum: number, field: string) {
  if (
    typeof value !== 'string' || !value || value.length > maximum ||
    value.trim() !== value ||
    [...value].some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    }) ||
    !unicode(value) || encoder.encode(value).length > maximum
  ) throw new Error(`${field} must be exact bounded UTF-8 text`);
  return value;
}
function pin(value: unknown, field: string, uuid = false) {
  if (typeof value !== 'string' || !(uuid ? UUID : SHA).test(value)) {
    throw new Error(`${field} must be canonical ${uuid ? 'UUID' : 'SHA-256'}`);
  }
  return value;
}
function rawText(value: unknown, maximum: number, field: string) {
  if (
    typeof value !== 'string' || !value || value.length > maximum ||
    !unicode(value) ||
    encoder.encode(value).length > maximum
  ) throw new Error(`${field} exceeds exact raw byte bound`);
  return value;
}
function selectedIds(value: unknown, sorted: boolean) {
  const ids = array(value, 20, 'selected project IDs').map((id) =>
    pin(id, 'selected project ID', true)
  );
  if (!ids.length || new Set(ids).size !== ids.length) {
    throw new Error('selected project IDs must be nonempty and distinct');
  }
  if (sorted && ids.some((id, index) => index > 0 && ids[index - 1] >= id)) {
    throw new Error('selected project IDs must be canonically sorted');
  }
  return Object.freeze(sorted ? ids : ids.sort());
}
function parsedJSON(raw: string, keys: readonly string[], field: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${field} is invalid JSON`);
  }
  // These protocol objects contain only scalar values and a project-ID array.
  // Reject duplicate keys and nested structure before adopting parsed values.
  let position = 0;
  const space = () => {
    while (position < raw.length && /[\x20\t\r\n]/.test(raw[position])) {
      position++;
    }
  };
  const string = () => {
    const start = position++;
    while (position < raw.length) {
      const char = raw[position++];
      if (char === '\\') position++;
      else if (char === '"') {
        return JSON.parse(raw.slice(start, position)) as string;
      }
    }
    throw new Error(`${field} has incomplete text`);
  };
  function visit(depth: number) {
    if (depth > 4) throw new Error(`${field} exceeds nesting bound`);
    space();
    const opening = raw[position];
    if (opening === '{' || opening === '[') {
      position++;
      const closing = opening === '{' ? '}' : ']';
      const names = new Set<string>();
      space();
      while (raw[position] !== closing) {
        if (opening === '{') {
          const key = string();
          if (names.has(key)) throw new Error(`${field} has duplicate members`);
          names.add(key);
          space();
          position++;
        }
        visit(depth + 1);
        space();
        if (raw[position] === closing) break;
        position++;
        space();
      }
      position++;
    } else if (opening === '"') string();
    else {
      const start = position;
      while (
        position < raw.length && !/[\x20\t\r\n,}\]]/.test(raw[position])
      ) position++;
      const token = raw.slice(start, position);
      if (
        /^-?[0-9]/.test(token) &&
        (!/^-?(?:0|[1-9][0-9]*)$/.test(token) ||
          !Number.isSafeInteger(Number(token)))
      ) {
        throw new Error(`${field} has a noncanonical integer token`);
      }
    }
  }
  visit(0);
  return object(parsed, keys, field);
}
function decisionWire(
  value: unknown,
): Readonly<ECOSDocumentProjectBindingDecision> {
  const raw = object(value, DECISION_KEYS, 'binding decision');
  if (
    raw.schema_version !== DECISION_SCHEMA ||
    raw.publication_mode !== 'shadow' ||
    raw.review_confirmation !== 'exact_project_ids_confirmed'
  ) {
    throw new Error('binding decision protocol or confirmation mismatch');
  }
  const decision_id = pin(raw.decision_id, 'decision ID', true),
    owner_id = pin(raw.owner_id, 'owner ID', true);
  const reviewed_by = pin(raw.reviewed_by, 'reviewer ID', true),
    review_project_id = pin(raw.review_project_id, 'review project ID', true);
  const project_ids = selectedIds(raw.project_ids, true);
  const expected_previous_decision_id =
    raw.expected_previous_decision_id === null
      ? null
      : pin(raw.expected_previous_decision_id, 'previous decision ID', true);
  if (
    reviewed_by !== owner_id || !project_ids.includes(review_project_id) ||
    expected_previous_decision_id === decision_id
  ) {
    throw new Error('binding decision review scope or predecessor mismatch');
  }
  return Object.freeze({
    schema_version: DECISION_SCHEMA,
    publication_mode: 'shadow',
    decision_id,
    organization_id: text(raw.organization_id, 500, 'organization ID'),
    owner_id,
    reviewed_by,
    review_project_id,
    review_epoch_sha256: pin(raw.review_epoch_sha256, 'review epoch'),
    document_id: text(raw.document_id, 300, 'document ID'),
    document_metadata_sha256: pin(
      raw.document_metadata_sha256,
      'document metadata hash',
    ),
    content_sha256: pin(raw.content_sha256, 'source content hash'),
    source_revision: raw.source_revision === null
      ? null
      : text(raw.source_revision, 300, 'source revision'),
    project_ids,
    expected_previous_decision_id,
    review_confirmation: 'exact_project_ids_confirmed',
  });
}

/**
 * Confirmation is an explicit caller assertion, not proof of a human UI event.
 * Names never select projects. No document record is changed by this factory.
 */
export function prepareECOSDocumentProjectBindingDecision(
  inventory: ECOSDocumentAssociationReviewInventory,
  selection: ECOSDocumentProjectBindingSelection,
): Readonly<ECOSDocumentProjectBindingDecision> {
  assertECOSDocumentAssociationReviewInventory(inventory);
  const input = object(selection, SELECTION_KEYS, 'explicit binding selection');
  if (input.confirmation !== 'exact_project_ids_confirmed') {
    throw new Error('explicit exact-project confirmation required');
  }
  const documentId = text(input.documentId, 300, 'selected document ID');
  const sourceRow = inventory.rows.find((row) =>
    row.entity_type === 'document' && row.entity_id === documentId
  );
  if (
    !sourceRow || sourceRow.redaction_reason !== null ||
    sourceRow.metadata_json === null
  ) throw new Error('selected document is missing or redacted');
  // Already hash-checked, strict, duplicate-free metadata from the genuine inventory.
  const source = JSON.parse(sourceRow.metadata_json) as Record<string, unknown>;
  if (
    source.source_id !== documentId || source.id !== documentId ||
    source.data_type !== 'object' ||
    source.owner_id !== inventory.owner_id ||
    source.organizationId !== inventory.organization_id ||
    source.isCurrent !== true ||
    (source.drawingStatus !== null &&
      typeof source.drawingStatus !== 'string') ||
    (typeof source.drawingStatus === 'string' &&
      source.drawingStatus.trim().toLowerCase() ===
        'superseded')
  ) {
    throw new Error('selected source is not exact current reviewable metadata');
  }
  const projectIds = selectedIds(input.projectIds, false);
  if (!projectIds.includes(inventory.project_id)) {
    throw new Error('selection must retain review target project');
  }
  if (
    source.projectId !== null &&
    (typeof source.projectId !== 'string' || !UUID.test(source.projectId) ||
      !projectIds.includes(source.projectId))
  ) {
    throw new Error(
      'selection must preserve the exact recorded primary project',
    );
  }
  for (const id of projectIds) {
    const projectRow = inventory.rows.find((row) =>
      row.entity_type === 'project' && row.entity_id === id
    );
    if (
      !projectRow || projectRow.redaction_reason !== null ||
      projectRow.metadata_json === null ||
      inventory.rows.some((row) =>
        row.entity_type === 'project_tombstone' && row.entity_id === id
      )
    ) {
      throw new Error(
        'selected project is unavailable, redacted or has a deletion marker',
      );
    }
    const project = JSON.parse(projectRow.metadata_json) as Record<
      string,
      unknown
    >;
    if (
      project.id !== id || project.owner_id !== inventory.owner_id ||
      project.archived !== false ||
      [project.declared_organization_id, project.embedded_organization_id].some(
        (value) => value !== null && value !== inventory.organization_id,
      )
    ) {
      throw new Error('selected project is not active in exact reviewed scope');
    }
  }
  const decision = decisionWire({
    schema_version: DECISION_SCHEMA,
    publication_mode: 'shadow',
    decision_id: input.decisionId,
    organization_id: inventory.organization_id,
    owner_id: inventory.owner_id,
    reviewed_by: input.reviewerId,
    review_project_id: inventory.project_id,
    review_epoch_sha256: inventory.epoch_sha256,
    document_id: documentId,
    document_metadata_sha256: sourceRow.metadata_sha256,
    content_sha256: source.contentSha256,
    source_revision: source.drawingRevision,
    project_ids: projectIds,
    expected_previous_decision_id: input.expectedPreviousDecisionId,
    review_confirmation: input.confirmation,
  });
  if (encoder.encode(JSON.stringify(decision)).length > 16 * 1024) {
    throw new Error('binding decision exceeds byte bound');
  }
  decisions.add(decision);
  return decision;
}
export function assertECOSDocumentProjectBindingDecision(
  value: unknown,
): asserts value is ECOSDocumentProjectBindingDecision {
  if (!value || typeof value !== 'object' || !decisions.has(value)) {
    throw new Error(
      'binding decision must originate from reviewed inventory and explicit selection',
    );
  }
}

async function verifyHash(raw: string, expected: string, field: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(raw));
  const actual = [...new Uint8Array(digest)].map((b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
  if (actual !== expected) throw new Error(`${field} hash mismatch`);
}
function utcTimestamp(value: unknown) {
  const valueText = rawText(value, 40, 'commit UTC timestamp');
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(
      valueText,
    )
  ) throw new Error('commit timestamp must be an exact UTC instant');
  const whole = valueText.slice(0, 19), parsed = Date.parse(`${whole}.000Z`);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 19) !== whole
  ) throw new Error('commit timestamp is not a real UTC instant');
  return valueText;
}
async function receipt(
  rawString: string,
  receiptHash: string,
): Promise<Readonly<ECOSDocumentProjectBindingReceipt>> {
  await verifyHash(rawString, receiptHash, 'binding receipt');
  const raw = parsedJSON(rawString, RECEIPT_KEYS, 'binding receipt');
  if (
    raw.schema_version !== RECEIPT_SCHEMA ||
    raw.publication_mode !== 'shadow' ||
    raw.verification !== 'owner_reviewed_association_only' ||
    raw.retrieval_authorized !== false
  ) {
    throw new Error('binding receipt protocol or authority mismatch');
  }
  const decision_json = rawText(
    raw.decision_json,
    16 * 1024,
    'receipt decision JSON',
  );
  const decision_sha256 = pin(raw.decision_sha256, 'receipt decision hash');
  const version = raw.version;
  if (
    typeof version !== 'number' || !Number.isSafeInteger(version) ||
    version < 1 ||
    version > 2147483647
  ) {
    throw new Error(
      'binding receipt version must be a positive PostgreSQL integer',
    );
  }
  const previous_decision_id = raw.previous_decision_id === null
    ? null
    : pin(raw.previous_decision_id, 'receipt predecessor ID', true);
  if ((version === 1) !== (previous_decision_id === null)) {
    throw new Error('binding receipt version contradicts predecessor');
  }
  const binding_context_sha256 = pin(
    raw.binding_context_sha256,
    'binding context hash',
  );
  const committed_at = utcTimestamp(raw.committed_at);
  await verifyHash(decision_json, decision_sha256, 'receipt decision');
  const decision = decisionWire(
    parsedJSON(decision_json, DECISION_KEYS, 'receipt decision'),
  );
  if (decision.expected_previous_decision_id !== previous_decision_id) {
    throw new Error('receipt predecessor differs from exact decision');
  }
  return Object.freeze({
    schema_version: RECEIPT_SCHEMA,
    publication_mode: 'shadow',
    decision_json,
    decision_sha256,
    version,
    previous_decision_id,
    binding_context_sha256,
    committed_at,
    verification: 'owner_reviewed_association_only',
    retrieval_authorized: false,
    decision,
  });
}
function sameDecision(
  left: ECOSDocumentProjectBindingDecision,
  right: ECOSDocumentProjectBindingDecision,
) {
  return DECISION_KEYS.every((key) =>
    key === 'project_ids'
      ? left.project_ids.length === right.project_ids.length &&
        left.project_ids.every((id, i) => id === right.project_ids[i])
      : left[key] === right[key]
  );
}
export async function bindECOSDocumentProjectBindingResult(
  rawResult: unknown,
  decision: ECOSDocumentProjectBindingDecision,
): Promise<Readonly<ECOSDocumentProjectBindingResult>> {
  assertECOSDocumentProjectBindingDecision(decision);
  const raw = object(rawResult, RESULT_KEYS, 'binding commit result');
  if (
    raw.schema_version !== RESULT_SCHEMA || raw.publication_mode !== 'shadow' ||
    !['committed', 'already_committed'].includes(raw.outcome as string)
  ) {
    throw new Error('binding result protocol mismatch');
  }
  // Adopt immutable scalar fields before either asynchronous hash check.
  const copied = Object.freeze({
    schema_version: RESULT_SCHEMA,
    publication_mode: 'shadow' as const,
    outcome: raw.outcome as 'committed' | 'already_committed',
    receipt_json: rawText(raw.receipt_json, 64 * 1024, 'binding receipt JSON'),
    receipt_sha256: pin(raw.receipt_sha256, 'binding receipt hash'),
    current_head_decision_id: pin(
      raw.current_head_decision_id,
      'current head ID',
      true,
    ),
  });
  if (
    copied.outcome === 'committed' &&
    copied.current_head_decision_id !== decision.decision_id
  ) {
    throw new Error('newly committed result contradicts its decision head');
  }
  const checked = await receipt(copied.receipt_json, copied.receipt_sha256);
  if (!sameDecision(checked.decision, decision)) {
    throw new Error('commit receipt differs from exact reviewed decision');
  }
  const result = Object.freeze({
    ...copied,
    receipt: checked,
    binding_currentness: 'not_asserted_requires_read' as const,
  });
  results.add(result);
  return result;
}
export function assertECOSDocumentProjectBindingResult(
  value: unknown,
): asserts value is ECOSDocumentProjectBindingResult {
  if (!value || typeof value !== 'object' || !results.has(value)) {
    throw new Error(
      'binding result must originate from verified receipt binding',
    );
  }
}

/** A current read verifies association state at that read, never source evidence eligibility. */
export async function bindECOSDocumentProjectBindingRead(
  rawRead: unknown,
  expectedInput: ECOSExpectedDocumentProjectBindingRead,
): Promise<Readonly<ECOSDocumentProjectBindingRead>> {
  const input = object(
    expectedInput,
    READ_EXPECTED_KEYS,
    'expected binding read scope',
  );
  const expected = Object.freeze({
    organizationId: text(input.organizationId, 500, 'organization ID'),
    ownerId: pin(input.ownerId, 'owner ID', true),
    projectId: pin(input.projectId, 'project ID', true),
    documentId: text(input.documentId, 300, 'document ID'),
    decisionId: input.decisionId === null
      ? null
      : pin(input.decisionId, 'expected decision ID', true),
  });
  const raw = object(rawRead, READ_KEYS, 'binding read');
  const scope = {
    schema_version: READ_SCHEMA,
    publication_mode: 'shadow' as const,
    organization_id: expected.organizationId,
    owner_id: expected.ownerId,
    project_id: expected.projectId,
    document_id: expected.documentId,
    retrieval_authorized: false as const,
  };
  if (
    Object.entries(scope).some(([key, value]) => raw[key] !== value) ||
    !['missing', 'stale', 'current'].includes(raw.state as string)
  ) {
    throw new Error('binding read scope or protocol mismatch');
  }
  const state = raw.state as 'missing' | 'stale' | 'current';
  const decision_id = raw.decision_id === null
    ? null
    : pin(raw.decision_id, 'read decision ID', true);
  const receipt_json = raw.receipt_json === null
    ? null
    : rawText(raw.receipt_json, 64 * 1024, 'read receipt JSON');
  const receipt_sha256 = raw.receipt_sha256 === null
    ? null
    : pin(raw.receipt_sha256, 'read receipt hash');
  if (
    state === 'missing'
      ? decision_id !== null || receipt_json !== null || receipt_sha256 !== null
      : state === 'stale'
      ? decision_id === null || receipt_json !== null || receipt_sha256 !== null
      : decision_id === null || receipt_json === null || receipt_sha256 === null
  ) throw new Error('binding read state contradicts receipt presence');
  const copied = Object.freeze({
    ...scope,
    state,
    decision_id,
    receipt_json,
    receipt_sha256,
  });
  let checked: Readonly<ECOSDocumentProjectBindingReceipt> | null = null;
  if (state === 'current') {
    if (expected.decisionId !== null && decision_id !== expected.decisionId) {
      throw new Error(
        'binding read current decision differs from expected head',
      );
    }
    checked = await receipt(receipt_json!, receipt_sha256!);
    const decision = checked.decision;
    if (
      decision.decision_id !== decision_id ||
      decision.organization_id !== expected.organizationId ||
      decision.owner_id !== expected.ownerId ||
      decision.document_id !== expected.documentId ||
      !decision.project_ids.includes(expected.projectId)
    ) {
      throw new Error(
        'current binding receipt does not match exact read scope',
      );
    }
  }
  const result = Object.freeze({
    ...copied,
    receipt: checked,
    verification: 'binding_state_only_not_evidence_authority' as const,
  });
  reads.add(result);
  return result;
}
export function assertECOSDocumentProjectBindingRead(
  value: unknown,
): asserts value is ECOSDocumentProjectBindingRead {
  if (!value || typeof value !== 'object' || !reads.has(value)) {
    throw new Error(
      'binding read must originate from verified exact-scope read',
    );
  }
}
