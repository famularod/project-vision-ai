export const ECOS_PROJECT_DOCUMENT_INVENTORY_SCHEMA_VERSION =
  'ecos-project-document-inventory/2.0' as const;
const REGISTRY_SCOPE = 'exact_project_document_registry_only' as const;
const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_INVENTORY_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();

export type ECOSProjectDocumentDisposition =
  | 'current_candidate'
  | 'not_current'
  | 'superseded'
  | 'needs_review';

export interface ECOSProjectDocumentInventoryRow {
  source_id: string;
  metadata_sha256: string;
  source_sha256: string | null;
  source_revision: string | null;
  source_page_count: number | null;
  is_current: boolean | null;
  category: string | null;
  disposition: ECOSProjectDocumentDisposition;
  limitations: readonly string[];
}

interface InventoryScope {
  schema_version: typeof ECOS_PROJECT_DOCUMENT_INVENTORY_SCHEMA_VERSION;
  publication_mode: 'shadow';
  scope: typeof REGISTRY_SCOPE;
  organization_id: string;
  project_id: string;
  owner_id: string;
  epoch_sha256: string;
  total_count: number;
  legacy_name_scope: 'not_assessed';
  operational_records: 'not_assessed';
  indexing_status: 'not_assessed';
}

export interface ECOSBoundProjectDocumentInventoryPage extends InventoryScope {
  after_source_id: string | null;
  rows: readonly Readonly<ECOSProjectDocumentInventoryRow>[];
  next_source_id: string | null;
}

export interface ECOSProjectDocumentInventory extends InventoryScope {
  rows: readonly Readonly<ECOSProjectDocumentInventoryRow>[];
  whole_project_completeness: 'not_assessed';
}

export interface ECOSExpectedProjectDocumentInventoryPage {
  organizationId: string;
  projectId: string;
  ownerId: string;
  epochSha256: string | null;
  afterSourceId: string | null;
  pageLimit: number;
}

export type ECOSDocumentPreprocessingStep =
  | 'needs_index_resolution'
  | 'excluded_not_current'
  | 'excluded_superseded'
  | 'needs_metadata_review';

export interface ECOSProjectDocumentPlan
  extends Omit<InventoryScope, 'schema_version'> {
  schema_version: 'ecos-project-document-plan/2.0';
  whole_project_completeness: 'not_assessed';
  answer_readiness: 'not_assessed';
  question_interpretation: 'not_performed';
  index_resolution: 'not_performed';
  needs_index_resolution_count: number;
  needs_metadata_review_count: number;
  excluded_not_current_count: number;
  excluded_superseded_count: number;
  items: readonly Readonly<{
    source: Readonly<ECOSProjectDocumentInventoryRow>;
    next_step: ECOSDocumentPreprocessingStep;
  }>[];
}

const pageOrigins = new WeakMap<
  object,
  Readonly<ECOSExpectedProjectDocumentInventoryPage>
>();
const inventories = new WeakSet<object>();
const PAGE_KEYS = [
  'schema_version',
  'publication_mode',
  'scope',
  'organization_id',
  'project_id',
  'owner_id',
  'epoch_sha256',
  'total_count',
  'after_source_id',
  'rows',
  'next_source_id',
  'legacy_name_scope',
  'operational_records',
  'indexing_status',
] as const;
const ROW_KEYS = [
  'source_id',
  'metadata_sha256',
  'source_sha256',
  'source_revision',
  'source_page_count',
  'is_current',
  'category',
  'disposition',
  'limitations',
] as const;
const EXPECTED_KEYS = [
  'organizationId',
  'projectId',
  'ownerId',
  'epochSha256',
  'afterSourceId',
  'pageLimit',
] as const;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;

function object(value: unknown, keys: readonly string[], field: string) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error(`${field} must be a plain data object`);
  }
  const names = Reflect.ownKeys(value);
  if (
    names.length !== keys.length ||
    names.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    throw new Error(`${field} has missing or unsupported fields`);
  }
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (
      !property || !property.enumerable || !Object.hasOwn(property, 'value')
    ) {
      throw new Error(`${field} must contain enumerable data properties only`);
    }
    output[key] = property.value;
  }
  return output;
}
function array(value: unknown, max: number, field: string): unknown[] {
  if (
    !Array.isArray(value) || value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new Error(`${field} must be a bounded dense data array`);
  }
  return Array.from({ length: value.length }, (_, index) => {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !property || !property.enumerable || !Object.hasOwn(property, 'value')
    ) {
      throw new Error(`${field} must contain enumerable data properties only`);
    }
    return property.value;
  });
}
function boundedText(value: unknown, max: number, field: string) {
  if (
    typeof value !== 'string' || !value || value.length > max ||
    value.trim() !== value ||
    value.startsWith('\u0085') || value.endsWith('\u0085')
  ) {
    throw new Error(`${field} must be exact bounded text`);
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || (code >= 127 && code <= 159)) {
      throw new Error(`${field} contains control characters`);
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`${field} has invalid Unicode`);
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`${field} has invalid Unicode`);
    }
  }
  if (encoder.encode(value).length > max) {
    throw new Error(`${field} exceeds its UTF-8 byte bound`);
  }
  return value;
}
function pin(value: unknown, field: string, uuid = false) {
  if (typeof value !== 'string' || !(uuid ? UUID : SHA).test(value)) {
    throw new Error(`${field} must be canonical ${uuid ? 'UUID' : 'SHA-256'}`);
  }
  return value;
}
function integer(value: unknown, min: number, max: number, field: string) {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) || value < min ||
    value > max
  ) {
    throw new Error(`${field} exceeds its integer bound`);
  }
  return value;
}
/** PostgreSQL UTF-8 COLLATE C ordering, not locale ordering or UTF-16 sorting. */
export function compareSourceIds(left: string, right: string) {
  const a = encoder.encode(left), b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}
function byteBound(value: unknown, maximum: number, field: string) {
  if (encoder.encode(JSON.stringify(value)).length > maximum) {
    throw new Error(`${field} exceeds its retained byte budget`);
  }
}

/** Pure metadata validation only: this grants no scope, snapshot or retrieval authority. */
export function bindECOSProjectDocumentInventoryRow(
  value: unknown,
): Readonly<ECOSProjectDocumentInventoryRow> {
  const raw = object(value, ROW_KEYS, 'document registry row');
  const source_id = boundedText(raw.source_id, 300, 'source ID');
  const metadata_sha256 = pin(raw.metadata_sha256, 'metadata hash');
  const source_sha256 = raw.source_sha256 === null
    ? null
    : pin(raw.source_sha256, 'source hash');
  const source_revision = raw.source_revision === null
    ? null
    : boundedText(raw.source_revision, 300, 'source revision');
  const source_page_count = raw.source_page_count === null
    ? null
    : integer(raw.source_page_count, 1, 10_000, 'source page count');
  const is_current = raw.is_current;
  if (is_current !== null && typeof is_current !== 'boolean') {
    throw new Error('current document state must be boolean or unknown');
  }
  const category = raw.category === null
    ? null
    : boundedText(raw.category, 500, 'category');
  const limitations = array(raw.limitations, 16, 'registry limitations').map(
    (value) => {
      if (
        typeof value !== 'string' || value.length > 80 ||
        !/^[a-z][a-z0-9_]*$/.test(value)
      ) {
        throw new Error('registry limitation must be a bounded lowercase code');
      }
      return value;
    },
  );
  if (new Set(limitations).size !== limitations.length) {
    throw new Error('duplicate registry limitation');
  }
  const hasReviewGap = limitations.some((code) =>
    code !== 'not_current' && code !== 'superseded'
  );
  const disposition = hasReviewGap
    ? 'needs_review'
    : limitations.includes('superseded')
    ? 'superseded'
    : limitations.includes('not_current')
    ? 'not_current'
    : 'current_candidate';
  if (raw.disposition !== disposition) {
    throw new Error('document disposition contradicts its limitations');
  }
  if (
    disposition !== 'needs_review' &&
    (source_sha256 === null || source_page_count === null ||
      category === null || is_current === null)
  ) {
    throw new Error('unresolved document metadata must remain needs_review');
  }
  if (
    (is_current === false && !limitations.includes('not_current')) ||
    (is_current !== false && limitations.includes('not_current')) ||
    (disposition === 'current_candidate' && is_current !== true)
  ) {
    throw new Error('document current state contradicts its disposition');
  }
  for (
    const [code, value] of [
      ['source_hash_missing_or_invalid', source_sha256],
      ['source_revision_invalid', source_revision],
      ['source_page_count_missing_or_invalid', source_page_count],
      ['current_state_missing_or_invalid', is_current],
      ['category_missing_or_invalid', category],
      ['category_conflict', category],
    ] as const
  ) {
    if (limitations.includes(code) && value !== null) {
      throw new Error('invalid registry metadata cannot be exposed as known');
    }
  }
  if (
    limitations.includes('organization_scope_missing') ||
    limitations.includes('organization_scope_conflict')
  ) {
    if (
      limitations.length !== 1 || source_sha256 !== null ||
      source_revision !== null ||
      source_page_count !== null || is_current !== null || category !== null
    ) {
      throw new Error(
        'unresolved organization scope must not expose document metadata',
      );
    }
  }
  return Object.freeze({
    source_id,
    metadata_sha256,
    source_sha256,
    source_revision,
    source_page_count,
    is_current,
    category,
    disposition,
    limitations: Object.freeze(limitations),
  });
}

/**
 * Service-only structural binding. Expected owner/project scope is independently
 * authorized by the caller; this function performs no authentication or RPC.
 * The registry epoch and metadata hashes are database-canonical digest pins,
 * not JavaScript recomputations or proofs of customer document readiness.
 */
export function bindECOSProjectDocumentInventoryPage(
  rawPage: unknown,
  expectedInput: ECOSExpectedProjectDocumentInventoryPage,
): Readonly<ECOSBoundProjectDocumentInventoryPage> {
  const input = object(
    expectedInput,
    EXPECTED_KEYS,
    'expected registry page scope',
  );
  const expected = Object.freeze({
    organizationId: boundedText(input.organizationId, 500, 'organization ID'),
    projectId: pin(input.projectId, 'project ID', true),
    ownerId: pin(input.ownerId, 'owner ID', true),
    epochSha256: input.epochSha256 === null
      ? null
      : pin(input.epochSha256, 'expected registry epoch'),
    afterSourceId: input.afterSourceId === null
      ? null
      : boundedText(input.afterSourceId, 300, 'expected source cursor'),
    pageLimit: integer(input.pageLimit, 1, 100, 'registry page limit'),
  });
  if (expected.afterSourceId !== null && expected.epochSha256 === null) {
    throw new Error('continuation pages require an independently pinned epoch');
  }
  const raw = object(rawPage, PAGE_KEYS, 'registry inventory page');
  const scope = {
    schema_version: ECOS_PROJECT_DOCUMENT_INVENTORY_SCHEMA_VERSION,
    publication_mode: 'shadow' as const,
    scope: REGISTRY_SCOPE,
    organization_id: expected.organizationId,
    project_id: expected.projectId,
    owner_id: expected.ownerId,
    legacy_name_scope: 'not_assessed' as const,
    operational_records: 'not_assessed' as const,
    indexing_status: 'not_assessed' as const,
  };
  if (Object.entries(scope).some(([key, value]) => raw[key] !== value)) {
    throw new Error('registry page does not match independent scope');
  }
  const epoch_sha256 = pin(raw.epoch_sha256, 'registry epoch');
  if (expected.epochSha256 !== null && epoch_sha256 !== expected.epochSha256) {
    throw new Error('registry epoch changed');
  }
  if (raw.after_source_id !== expected.afterSourceId) {
    throw new Error('registry page cursor does not match request');
  }
  const total_count = integer(raw.total_count, 0, 500, 'registry total count');
  const rows = array(raw.rows, expected.pageLimit, 'document registry rows')
    .map(bindECOSProjectDocumentInventoryRow);
  if (
    rows.length > total_count ||
    (expected.afterSourceId === null &&
      rows.length !== Math.min(expected.pageLimit, total_count)) ||
    (expected.afterSourceId !== null && rows.length === 0)
  ) {
    throw new Error('registry page row count is inconsistent');
  }
  let previous = expected.afterSourceId;
  for (const entry of rows) {
    if (previous !== null && compareSourceIds(previous, entry.source_id) >= 0) {
      throw new Error(
        'registry rows must be strictly ordered after their UTF-8 cursor',
      );
    }
    previous = entry.source_id;
  }
  const next_source_id = raw.next_source_id === null
    ? null
    : boundedText(raw.next_source_id, 300, 'next source cursor');
  if (
    next_source_id !== null &&
    (rows.length !== expected.pageLimit ||
      next_source_id !== rows.at(-1)?.source_id)
  ) {
    throw new Error(
      'registry continuation cursor must equal the last complete page row',
    );
  }
  if (
    expected.afterSourceId === null &&
    next_source_id !==
      (rows.length < total_count ? rows.at(-1)!.source_id : null)
  ) {
    throw new Error(
      'registry first-page continuation does not match total count',
    );
  }
  const page = Object.freeze({
    ...scope,
    epoch_sha256,
    total_count,
    after_source_id: expected.afterSourceId,
    rows: Object.freeze(rows),
    next_source_id,
  });
  byteBound(page, MAX_PAGE_BYTES, 'registry page');
  pageOrigins.set(page, expected);
  return page;
}

export function assertECOSBoundProjectDocumentInventoryPage(
  value: unknown,
): asserts value is ECOSBoundProjectDocumentInventoryPage {
  if (!value || typeof value !== 'object' || !pageOrigins.has(value)) {
    throw new Error(
      'registry page must originate from the exact binding boundary',
    );
  }
}

export function assembleECOSProjectDocumentInventory(
  inputPages: readonly ECOSBoundProjectDocumentInventoryPage[],
): Readonly<ECOSProjectDocumentInventory> {
  const pages = array(inputPages, 500, 'registry pages');
  if (!pages.length) {
    throw new Error(
      'complete registry requires its first page, even when empty',
    );
  }
  let first: ECOSBoundProjectDocumentInventoryPage | undefined;
  const rows: Readonly<ECOSProjectDocumentInventoryRow>[] = [];
  let cursor: string | null = null, retainedBytes = 0;
  for (const value of pages) {
    assertECOSBoundProjectDocumentInventoryPage(value);
    const page = value, request = pageOrigins.get(page)!;
    if (first && cursor === null) {
      throw new Error('registry pages continue after the complete inventory');
    }
    first ??= page;
    if (
      page.organization_id !== first.organization_id ||
      page.project_id !== first.project_id ||
      page.owner_id !== first.owner_id ||
      page.epoch_sha256 !== first.epoch_sha256 ||
      page.total_count !== first.total_count
    ) {
      throw new Error('registry pages mix scope, epoch or total count');
    }
    if (
      page.after_source_id !== cursor || request.afterSourceId !== cursor ||
      (cursor !== null && request.epochSha256 !== first.epoch_sha256)
    ) {
      throw new Error('registry continuation chain has a gap or duplicate');
    }
    const remaining = first.total_count - rows.length;
    if (
      (remaining === 0 && rows.length > 0) ||
      page.rows.length !== Math.min(request.pageLimit, remaining)
    ) {
      throw new Error(
        'registry page must include every remaining row up to its requested limit',
      );
    }
    const last = page.rows.at(-1)?.source_id ?? null;
    const expectedNext = page.rows.length < remaining ? last : null;
    if (page.next_source_id !== expectedNext) {
      throw new Error(
        'registry page continuation hides or invents remaining rows',
      );
    }
    if (
      rows.length && page.rows.length &&
      compareSourceIds(rows.at(-1)!.source_id, page.rows[0].source_id) >= 0
    ) {
      throw new Error('registry source identities overlap between pages');
    }
    retainedBytes += encoder.encode(JSON.stringify(page)).length;
    if (retainedBytes > MAX_INVENTORY_BYTES) {
      throw new Error('complete registry exceeds its retained byte budget');
    }
    rows.push(...page.rows);
    cursor = page.next_source_id;
  }
  if (cursor !== null || rows.length !== first!.total_count) {
    throw new Error('registry enumeration is incomplete');
  }
  const inventory = Object.freeze({
    schema_version: ECOS_PROJECT_DOCUMENT_INVENTORY_SCHEMA_VERSION,
    publication_mode: 'shadow' as const,
    scope: REGISTRY_SCOPE,
    organization_id: first!.organization_id,
    project_id: first!.project_id,
    owner_id: first!.owner_id,
    epoch_sha256: first!.epoch_sha256,
    total_count: first!.total_count,
    rows: Object.freeze(rows),
    legacy_name_scope: 'not_assessed' as const,
    operational_records: 'not_assessed' as const,
    indexing_status: 'not_assessed' as const,
    whole_project_completeness: 'not_assessed' as const,
  });
  byteBound(inventory, MAX_INVENTORY_BYTES, 'complete registry');
  inventories.add(inventory);
  return inventory;
}

export function assertECOSProjectDocumentInventory(
  value: unknown,
): asserts value is ECOSProjectDocumentInventory {
  if (!value || typeof value !== 'object' || !inventories.has(value)) {
    throw new Error(
      'document inventory must originate from complete bound pages',
    );
  }
}

/** All registry rows remain visible. This plan resolves no index and cannot authorize an answer. */
export function buildECOSProjectDocumentPlan(
  inventory: ECOSProjectDocumentInventory,
): Readonly<ECOSProjectDocumentPlan> {
  assertECOSProjectDocumentInventory(inventory);
  const counts = {
    needs_index_resolution_count: 0,
    needs_metadata_review_count: 0,
    excluded_not_current_count: 0,
    excluded_superseded_count: 0,
  };
  const steps = {
    current_candidate: 'needs_index_resolution',
    not_current: 'excluded_not_current',
    superseded: 'excluded_superseded',
    needs_review: 'needs_metadata_review',
  } as const;
  const items = inventory.rows.map((source) => {
    const next_step = steps[source.disposition];
    counts[`${next_step}_count`]++;
    return Object.freeze({ source, next_step });
  });
  const { rows: _rows, ...scope } = inventory;
  const plan = Object.freeze({
    ...scope,
    schema_version: 'ecos-project-document-plan/2.0' as const,
    answer_readiness: 'not_assessed' as const,
    question_interpretation: 'not_performed' as const,
    index_resolution: 'not_performed' as const,
    ...counts,
    items: Object.freeze(items),
  });
  byteBound(plan, MAX_INVENTORY_BYTES, 'registry preprocessing plan');
  return plan;
}
