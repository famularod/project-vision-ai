import {
  bindECOSProjectDocumentInventoryRow,
  compareSourceIds,
  type ECOSExpectedProjectDocumentInventoryPage,
  type ECOSProjectDocumentInventoryRow,
} from './ecos-project-document-inventory.ts';
import {
  bindECOSDocumentProjectBindingRead,
  type ECOSDocumentProjectBindingRead,
} from './ecos-document-project-binding.ts';

const SCHEMA = 'ecos-linked-project-document-inventory/2.0' as const;
const SCOPE = 'exact_primary_and_reviewed_secondary_documents_only' as const;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_INVENTORY_BYTES = 16 * 1024 * 1024;
const encoder = new TextEncoder();
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
export type ECOSExpectedLinkedProjectDocumentInventoryPage =
  ECOSExpectedProjectDocumentInventoryPage;
export interface ECOSLinkedProjectDocumentInventoryRow {
  source_id: string;
  registry_row: Readonly<ECOSProjectDocumentInventoryRow> | null;
  association_kind: 'exact_primary' | 'reviewed_secondary';
  association_state: 'current' | 'stale';
  binding_read: Readonly<ECOSDocumentProjectBindingRead> | null;
}
interface Scope {
  schema_version: typeof SCHEMA;
  publication_mode: 'shadow';
  scope: typeof SCOPE;
  organization_id: string;
  project_id: string;
  owner_id: string;
  epoch_sha256: string;
  total_count: number;
  legacy_name_scope: 'not_assessed';
  operational_records: 'not_assessed';
  indexing_status: 'not_assessed';
  retrieval_authorized: false;
}
export interface ECOSBoundLinkedProjectDocumentInventoryPage extends Scope {
  after_source_id: string | null;
  rows: readonly Readonly<ECOSLinkedProjectDocumentInventoryRow>[];
  next_source_id: string | null;
}
export interface ECOSLinkedProjectDocumentInventory extends Scope {
  rows: readonly Readonly<ECOSLinkedProjectDocumentInventoryRow>[];
  whole_project_completeness: 'not_assessed';
}
export type ECOSLinkedProjectDocumentStep =
  | 'needs_index_resolution'
  | 'needs_metadata_review'
  | 'excluded_not_current'
  | 'excluded_superseded'
  | 'needs_association_review';
export interface ECOSLinkedProjectDocumentPlan
  extends Omit<ECOSLinkedProjectDocumentInventory, 'schema_version' | 'rows'> {
  schema_version: 'ecos-linked-project-document-plan/2.0';
  answer_readiness: 'not_assessed';
  question_interpretation: 'not_performed';
  index_resolution: 'not_performed';
  needs_index_resolution_count: number;
  needs_metadata_review_count: number;
  excluded_not_current_count: number;
  excluded_superseded_count: number;
  needs_association_review_count: number;
  items: readonly Readonly<
    {
      source: Readonly<ECOSLinkedProjectDocumentInventoryRow>;
      next_step: ECOSLinkedProjectDocumentStep;
    }
  >[];
}
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
  'retrieval_authorized',
];
const EXPECTED_KEYS = [
  'organizationId',
  'projectId',
  'ownerId',
  'epochSha256',
  'afterSourceId',
  'pageLimit',
];
const ROW_KEYS = [
  'source_id',
  'registry_row',
  'association_kind',
  'association_state',
  'binding_read',
];
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
];
const pages = new WeakMap<
  object,
  Readonly<ECOSExpectedLinkedProjectDocumentInventoryPage>
>();
const inventories = new WeakSet<object>();
function object(value: unknown, keys: readonly string[], field: string) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error(`${field} must be plain data`);
  }
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    throw new Error(`${field} has missing or unsupported fields`);
  }
  const copied: Record<string, unknown> = {};
  for (const key of keys) {
    const prop = Object.getOwnPropertyDescriptor(value, key);
    if (!prop?.enumerable || !Object.hasOwn(prop, 'value')) {
      throw new Error(`${field} must contain only data properties`);
    }
    copied[key] = prop.value;
  }
  return copied;
}
function array(value: unknown, maximum: number, field: string) {
  if (
    !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) throw new Error(`${field} must be a bounded dense data array`);
  return Array.from({ length: value.length }, (_, index) => {
    const prop = Object.getOwnPropertyDescriptor(value, String(index));
    if (!prop?.enumerable || !Object.hasOwn(prop, 'value')) {
      throw new Error(`${field} must contain only data properties`);
    }
    return prop.value;
  });
}
function text(value: unknown, maximum: number, field: string) {
  if (
    typeof value !== 'string' || !value || value.length > maximum ||
    value.trim() !== value ||
    [...value].some((char) => {
      const code = char.codePointAt(0)!;
      return code < 32 || (code >= 127 && code <= 159) ||
        (code >= 0xd800 && code <= 0xdfff);
    }) || encoder.encode(value).length > maximum
  ) throw new Error(`${field} must be exact bounded UTF-8 text`);
  return value;
}
function pin(value: unknown, field: string, uuid = false) {
  if (typeof value !== 'string' || !(uuid ? UUID : SHA).test(value)) {
    throw new Error(`${field} must be canonical`);
  }
  return value;
}
function integer(value: unknown, min: number, max: number, field: string) {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) || value < min ||
    value > max
  ) throw new Error(`${field} exceeds its integer bound`);
  return value;
}
function byteSize(value: unknown) {
  return encoder.encode(JSON.stringify(value)).length;
}
function budget(value: unknown, maximum: number, field: string) {
  if (byteSize(value) > maximum) {
    throw new Error(`${field} exceeds retained byte budget`);
  }
}
function snapshotRow(value: unknown) {
  const raw = object(value, ROW_KEYS, 'linked source row');
  const source_id = text(raw.source_id, 300, 'linked source ID');
  const registry_row = raw.registry_row === null
    ? null
    : bindECOSProjectDocumentInventoryRow(raw.registry_row);
  if (registry_row !== null && registry_row.source_id !== source_id) {
    throw new Error('linked source summary identity mismatch');
  }
  const association_kind = raw.association_kind,
    association_state = raw.association_state;
  if (
    (association_kind !== 'exact_primary' &&
      association_kind !== 'reviewed_secondary') ||
    (association_state !== 'current' && association_state !== 'stale')
  ) throw new Error('linked source association protocol mismatch');
  let binding_read: Readonly<Record<string, unknown>> | null = null;
  if (raw.binding_read !== null) {
    const nested = object(raw.binding_read, READ_KEYS, 'nested binding read');
    for (const value of Object.values(nested)) {
      if (
        value !== null && typeof value !== 'string' &&
        typeof value !== 'boolean'
      ) throw new Error('binding read wire must contain scalar data only');
      if (typeof value === 'string' && value.length > 64 * 1024) {
        throw new Error('binding read wire exceeds text bound');
      }
    }
    binding_read = Object.freeze(nested);
  }
  return Object.freeze({
    source_id,
    registry_row,
    association_kind,
    association_state,
    binding_read,
  });
}

/** All provider data is copied synchronously before any receipt hash awaits. */
export async function bindECOSLinkedProjectDocumentInventoryPage(
  rawPage: unknown,
  expectedInput: ECOSExpectedLinkedProjectDocumentInventoryPage,
): Promise<Readonly<ECOSBoundLinkedProjectDocumentInventoryPage>> {
  const input = object(
    expectedInput,
    EXPECTED_KEYS,
    'expected linked inventory scope',
  );
  const expected = Object.freeze({
    organizationId: text(input.organizationId, 500, 'organization ID'),
    projectId: pin(input.projectId, 'project ID', true),
    ownerId: pin(input.ownerId, 'owner ID', true),
    epochSha256: input.epochSha256 === null
      ? null
      : pin(input.epochSha256, 'expected linked epoch'),
    afterSourceId: input.afterSourceId === null
      ? null
      : text(input.afterSourceId, 300, 'expected source cursor'),
    pageLimit: integer(input.pageLimit, 1, 25, 'linked page limit'),
  });
  if (expected.afterSourceId !== null && expected.epochSha256 === null) {
    throw new Error('continuation requires independently pinned epoch');
  }
  const raw = object(rawPage, PAGE_KEYS, 'linked inventory page');
  const scope = {
    schema_version: SCHEMA,
    publication_mode: 'shadow' as const,
    scope: SCOPE,
    organization_id: expected.organizationId,
    project_id: expected.projectId,
    owner_id: expected.ownerId,
    legacy_name_scope: 'not_assessed' as const,
    operational_records: 'not_assessed' as const,
    indexing_status: 'not_assessed' as const,
    retrieval_authorized: false as const,
  };
  if (Object.entries(scope).some(([key, value]) => raw[key] !== value)) {
    throw new Error('linked inventory independent scope mismatch');
  }
  const epoch_sha256 = pin(raw.epoch_sha256, 'linked epoch');
  if (expected.epochSha256 !== null && expected.epochSha256 !== epoch_sha256) {
    throw new Error('linked inventory epoch changed');
  }
  if (raw.after_source_id !== expected.afterSourceId) {
    throw new Error('linked inventory cursor differs from request');
  }
  const total_count = integer(raw.total_count, 0, 600, 'linked total count');
  const rows = array(raw.rows, expected.pageLimit, 'linked inventory rows').map(
    snapshotRow,
  );
  if (
    rows.length > total_count ||
    (expected.afterSourceId === null &&
      rows.length !== Math.min(expected.pageLimit, total_count)) ||
    (expected.afterSourceId !== null && rows.length === 0)
  ) throw new Error('linked inventory row count is inconsistent');
  let previous = expected.afterSourceId;
  for (const row of rows) {
    if (previous !== null && compareSourceIds(previous, row.source_id) >= 0) {
      throw new Error(
        'linked sources must be strictly UTF-8 ordered after cursor',
      );
    }
    previous = row.source_id;
  }
  const next_source_id = raw.next_source_id === null
    ? null
    : text(raw.next_source_id, 300, 'next source cursor');
  if (
    next_source_id !== null &&
    (rows.length !== expected.pageLimit ||
      next_source_id !== rows.at(-1)?.source_id)
  ) throw new Error('linked continuation must equal last full-page row');
  if (
    expected.afterSourceId === null &&
    next_source_id !==
      (rows.length < total_count ? rows.at(-1)!.source_id : null)
  ) throw new Error('linked first page continuation contradicts count');
  const snapshot = Object.freeze({
    ...scope,
    epoch_sha256,
    total_count,
    after_source_id: expected.afterSourceId,
    rows: Object.freeze(rows),
    next_source_id,
  });
  budget(snapshot, MAX_PAGE_BYTES, 'linked wire page');
  const boundRows: Readonly<ECOSLinkedProjectDocumentInventoryRow>[] = [];
  for (const row of rows) {
    const binding_read = row.binding_read === null
      ? null
      : await bindECOSDocumentProjectBindingRead(row.binding_read, {
        organizationId: expected.organizationId,
        ownerId: expected.ownerId,
        projectId: expected.projectId,
        documentId: row.source_id,
        decisionId: null,
      });
    if (binding_read?.state === 'missing') {
      throw new Error('linked source cannot carry a missing binding read');
    }
    if (row.association_kind === 'exact_primary') {
      if (row.association_state !== 'current' || row.registry_row === null) {
        throw new Error(
          'exact primary requires a current recorded association and registry row',
        );
      }
    } else if (
      binding_read === null || binding_read.state !== row.association_state
    ) {
      throw new Error(
        'secondary association must match a verified current or stale binding',
      );
    }
    if (binding_read?.state === 'current') {
      const source = row.registry_row,
        decision = binding_read.receipt!.decision;
      if (
        source === null || source.source_sha256 !== decision.content_sha256 ||
        source.source_revision !== decision.source_revision ||
        source.is_current !== true
      ) {
        throw new Error(
          'current linked binding differs from source identity, hash, revision or state',
        );
      }
    }
    boundRows.push(Object.freeze({ ...row, binding_read }));
  }
  const page = Object.freeze({ ...snapshot, rows: Object.freeze(boundRows) });
  budget(page, MAX_PAGE_BYTES, 'bound linked page');
  pages.set(page, expected);
  return page;
}
export function assertECOSBoundLinkedProjectDocumentInventoryPage(
  value: unknown,
): asserts value is ECOSBoundLinkedProjectDocumentInventoryPage {
  if (!value || typeof value !== 'object' || !pages.has(value)) {
    throw new Error('linked inventory page must originate from exact binding');
  }
}
export function assembleECOSLinkedProjectDocumentInventory(
  input: readonly ECOSBoundLinkedProjectDocumentInventoryPage[],
): Readonly<ECOSLinkedProjectDocumentInventory> {
  const values = array(input, 600, 'linked inventory pages');
  if (!values.length) {
    throw new Error('linked inventory requires first page even when empty');
  }
  let first: ECOSBoundLinkedProjectDocumentInventoryPage | undefined;
  let cursor: string | null = null,
    retained = 0,
    registryCount = 0,
    bindingCount = 0;
  const bindingDecisions = new Set<string>();
  const rows: Readonly<ECOSLinkedProjectDocumentInventoryRow>[] = [];
  for (const value of values) {
    assertECOSBoundLinkedProjectDocumentInventoryPage(value);
    if (first && cursor === null) {
      throw new Error('linked inventory continues after terminal page');
    }
    const page = value, request = pages.get(page)!;
    first ??= page;
    if (
      page.organization_id !== first.organization_id ||
      page.project_id !== first.project_id ||
      page.owner_id !== first.owner_id ||
      page.epoch_sha256 !== first.epoch_sha256 ||
      page.total_count !== first.total_count
    ) throw new Error('linked inventory mixes scope, epoch or total count');
    if (
      page.after_source_id !== cursor || request.afterSourceId !== cursor ||
      (cursor !== null && request.epochSha256 !== first.epoch_sha256)
    ) throw new Error('linked inventory chain has gap or duplicate');
    const remaining = first.total_count - rows.length;
    if (page.rows.length !== Math.min(request.pageLimit, remaining)) {
      throw new Error('linked page omits or invents remaining sources');
    }
    if (
      page.next_source_id !==
        (page.rows.length < remaining ? page.rows.at(-1)!.source_id : null)
    ) throw new Error('linked continuation hides or invents sources');
    if (
      rows.length && page.rows.length &&
      compareSourceIds(rows.at(-1)!.source_id, page.rows[0].source_id) >= 0
    ) throw new Error('linked source identities overlap');
    retained += byteSize(page);
    if (retained > MAX_INVENTORY_BYTES) {
      throw new Error('linked inventory exceeds retained byte budget');
    }
    for (const source of page.rows) {
      if (source.registry_row !== null) registryCount++;
      if (source.binding_read !== null) {
        bindingCount++;
        const decisionId = source.binding_read.decision_id!;
        if (bindingDecisions.has(decisionId)) {
          throw new Error(
            'linked sources cannot reuse a binding decision identity',
          );
        }
        bindingDecisions.add(decisionId);
      }
    }
    if (registryCount > 500 || bindingCount > 100) {
      throw new Error(
        'linked inventory exceeds physical registry or binding-head bounds',
      );
    }
    rows.push(...page.rows);
    cursor = page.next_source_id;
  }
  if (cursor !== null || rows.length !== first!.total_count) {
    throw new Error('linked inventory enumeration incomplete');
  }
  const {
    after_source_id: _after,
    next_source_id: _next,
    rows: _rows,
    ...scope
  } = first!;
  const inventory = Object.freeze({
    ...scope,
    rows: Object.freeze(rows),
    whole_project_completeness: 'not_assessed' as const,
  });
  budget(inventory, MAX_INVENTORY_BYTES, 'complete linked inventory');
  inventories.add(inventory);
  return inventory;
}
export function assertECOSLinkedProjectDocumentInventory(
  value: unknown,
): asserts value is ECOSLinkedProjectDocumentInventory {
  if (!value || typeof value !== 'object' || !inventories.has(value)) {
    throw new Error(
      'linked inventory must originate from complete bound pages',
    );
  }
}
/** A current association is not extraction, authorization, or an answer. */
export function buildECOSLinkedProjectDocumentPlan(
  inventory: ECOSLinkedProjectDocumentInventory,
): Readonly<ECOSLinkedProjectDocumentPlan> {
  assertECOSLinkedProjectDocumentInventory(inventory);
  const counts = {
    needs_index_resolution_count: 0,
    needs_metadata_review_count: 0,
    excluded_not_current_count: 0,
    excluded_superseded_count: 0,
    needs_association_review_count: 0,
  };
  const steps = {
    current_candidate: 'needs_index_resolution',
    needs_review: 'needs_metadata_review',
    not_current: 'excluded_not_current',
    superseded: 'excluded_superseded',
  } as const;
  const items = inventory.rows.map((source) => {
    const next_step: ECOSLinkedProjectDocumentStep =
      source.association_kind === 'reviewed_secondary' &&
        source.association_state === 'stale'
        ? 'needs_association_review'
        : source.registry_row === null
        ? 'needs_association_review'
        : steps[source.registry_row.disposition];
    counts[`${next_step}_count`]++;
    return Object.freeze({ source, next_step });
  });
  const { rows: _rows, ...scope } = inventory;
  const plan = Object.freeze({
    ...scope,
    schema_version: 'ecos-linked-project-document-plan/2.0' as const,
    answer_readiness: 'not_assessed' as const,
    question_interpretation: 'not_performed' as const,
    index_resolution: 'not_performed' as const,
    ...counts,
    items: Object.freeze(items),
  });
  budget(plan, MAX_INVENTORY_BYTES, 'linked preprocessing plan');
  return plan;
}
