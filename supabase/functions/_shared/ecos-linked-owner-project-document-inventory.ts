import { copyECOSV2JSON } from './ecos-v2-json-model.ts';
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
import {
  bindECOSOwnerSourceAuthorityRead,
  deriveECOSOwnerEffectiveSource,
  type ECOSOwnerEffectiveSource,
  type ECOSOwnerSourceAuthorityRead,
} from './ecos-owner-source-authority.ts';

const SCHEMA = 'ecos-linked-owner-project-document-inventory/2.1' as const;
const SCOPE = 'owner_workspace_primary_and_reviewed_documents_only' as const;
const PAGE_BYTES = 2 * 1024 * 1024, INVENTORY_BYTES = 16 * 1024 * 1024;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
export type ECOSExpectedLinkedOwnerProjectDocumentInventoryPage =
  ECOSExpectedProjectDocumentInventoryPage;
export type ECOSLinkedOwnerEffectiveSource =
  | ECOSOwnerEffectiveSource
  | Readonly<{
    source_id: string;
    source_sha256: string | null;
    source_revision: string | null;
    source_page_count: number | null;
    authority_kind: 'declared_organization';
    authority_decision_id: null;
    authority_receipt_sha256: null;
    source_locator_sha256: null;
  }>;
export interface ECOSLinkedOwnerProjectDocumentInventoryRow {
  source_id: string;
  registry_row: Readonly<ECOSProjectDocumentInventoryRow> | null;
  association_kind: 'exact_primary' | 'reviewed_secondary';
  association_state: 'current' | 'stale';
  binding_read: Readonly<ECOSDocumentProjectBindingRead> | null;
  owner_authority_read: Readonly<ECOSOwnerSourceAuthorityRead> | null;
  effective_source: ECOSLinkedOwnerEffectiveSource | null;
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
export interface ECOSBoundLinkedOwnerProjectDocumentInventoryPage
  extends Scope {
  after_source_id: string | null;
  next_source_id: string | null;
  rows: readonly Readonly<ECOSLinkedOwnerProjectDocumentInventoryRow>[];
}
export interface ECOSLinkedOwnerProjectDocumentInventory extends Scope {
  rows: readonly Readonly<ECOSLinkedOwnerProjectDocumentInventoryRow>[];
  whole_project_completeness: 'not_assessed';
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
const ROW_KEYS = [
  'source_id',
  'registry_row',
  'association_kind',
  'association_state',
  'binding_read',
  'owner_authority_read',
  'effective_source',
];
const EFFECTIVE_KEYS = [
  'source_id',
  'source_sha256',
  'source_revision',
  'source_page_count',
  'authority_kind',
  'authority_decision_id',
  'authority_receipt_sha256',
  'source_locator_sha256',
];
const EXPECTED_KEYS = [
  'organizationId',
  'projectId',
  'ownerId',
  'epochSha256',
  'afterSourceId',
  'pageLimit',
];
const pages = new WeakMap<
  object,
  Readonly<ECOSExpectedLinkedOwnerProjectDocumentInventoryPage>
>();
const inventories = new WeakSet<object>();
function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  ) throw new Error('Exact owner inventory fields required');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 300): string {
  if (
    typeof value !== 'string' || !value || value.length > max ||
    value.trim() !== value ||
    [...value].some((character) => {
      const codepoint = character.codePointAt(0)!;
      return codepoint < 32 || (codepoint >= 127 && codepoint <= 159) ||
        (codepoint >= 0xd800 && codepoint <= 0xdfff);
    }) ||
    encoder.encode(value).length > max
  ) {
    throw new Error('Exact bounded owner inventory text required');
  }
  return value;
}
function pin(value: unknown, uuid = false): string {
  if (typeof value !== 'string' || !(uuid ? UUID : SHA).test(value)) {
    throw new Error('Canonical owner inventory pin required');
  }
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) || value < min ||
    value > max
  ) throw new Error('Owner inventory count exceeds bound');
  return value;
}
function size(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}
function budget(value: unknown, max: number) {
  if (size(value) > max) {
    throw new Error('Owner inventory exceeds retained byte bound');
  }
}
function sameEffective(
  raw: unknown,
  expected: ECOSLinkedOwnerEffectiveSource | null,
) {
  if (expected === null) {
    if (raw !== null) {
      throw new Error(
        'Unreviewed or stale source cannot supply effective pins',
      );
    }
    return;
  }
  const value = object(raw, EFFECTIVE_KEYS);
  if (
    EFFECTIVE_KEYS.some((key) =>
      value[key] !== expected[key as keyof ECOSLinkedOwnerEffectiveSource]
    )
  ) {
    throw new Error(
      'Effective source differs from independently bound association pins',
    );
  }
}

/** Service transport snapshot binding only, not a new caller permission or a
 * latest-state check. Inputs are copied before the first receipt digest awaits.
 * Original registry summaries remain /2.0 data; this never manufactures an old
 * inventory brand or labels expected hashes as verified downloaded content. */
export async function bindECOSLinkedOwnerProjectDocumentInventoryPage(
  rawPage: unknown,
  expectedInput: ECOSExpectedLinkedOwnerProjectDocumentInventoryPage,
): Promise<Readonly<ECOSBoundLinkedOwnerProjectDocumentInventoryPage>> {
  const e = object(copyECOSV2JSON(expectedInput, 2048), EXPECTED_KEYS);
  const expected = Object.freeze({
    organizationId: pin(e.organizationId, true),
    ownerId: pin(e.ownerId, true),
    projectId: pin(e.projectId, true),
    epochSha256: e.epochSha256 === null ? null : pin(e.epochSha256),
    afterSourceId: e.afterSourceId === null ? null : text(e.afterSourceId),
    pageLimit: integer(e.pageLimit, 1, 25),
  });
  if (
    expected.organizationId !== expected.ownerId ||
    expected.afterSourceId !== null && expected.epochSha256 === null
  ) {
    throw new Error(
      'Owner workspace and independently pinned continuation required',
    );
  }
  const raw = object(copyECOSV2JSON(rawPage, PAGE_BYTES), PAGE_KEYS);
  const scope = {
    schema_version: SCHEMA,
    publication_mode: 'shadow' as const,
    scope: SCOPE,
    organization_id: expected.organizationId,
    owner_id: expected.ownerId,
    project_id: expected.projectId,
    legacy_name_scope: 'not_assessed' as const,
    operational_records: 'not_assessed' as const,
    indexing_status: 'not_assessed' as const,
    retrieval_authorized: false as const,
  };
  if (Object.entries(scope).some(([key, value]) => raw[key] !== value)) {
    throw new Error('Owner inventory independent scope mismatch');
  }
  const epoch_sha256 = pin(raw.epoch_sha256),
    total_count = integer(raw.total_count, 0, 600);
  if (
    expected.epochSha256 !== null && expected.epochSha256 !== epoch_sha256 ||
    raw.after_source_id !== expected.afterSourceId
  ) {
    throw new Error('Owner inventory epoch or cursor changed');
  }
  if (
    !Array.isArray(raw.rows) || raw.rows.length > expected.pageLimit ||
    raw.rows.length > total_count ||
    (expected.afterSourceId === null &&
      raw.rows.length !== Math.min(expected.pageLimit, total_count)) ||
    (expected.afterSourceId !== null && raw.rows.length === 0)
  ) throw new Error('Owner inventory row count contradicts request');
  const rowSnapshots = raw.rows.map((value) => object(value, ROW_KEYS));
  let cursor = expected.afterSourceId;
  for (const row of rowSnapshots) {
    const id = text(row.source_id);
    if (cursor !== null && compareSourceIds(cursor, id) >= 0) {
      throw new Error('Owner sources must have strict UTF-8 order');
    }
    cursor = id;
  }
  const next_source_id = raw.next_source_id === null
    ? null
    : text(raw.next_source_id);
  if (
    next_source_id !== null &&
      (rowSnapshots.length !== expected.pageLimit ||
        next_source_id !== cursor) ||
    expected.afterSourceId === null &&
      next_source_id !== (rowSnapshots.length < total_count ? cursor : null)
  ) {
    throw new Error('Owner continuation contradicts full page and total count');
  }
  const rows: Readonly<ECOSLinkedOwnerProjectDocumentInventoryRow>[] = [];
  for (const row of rowSnapshots) {
    const source_id = row.source_id as string;
    const registry_row = row.registry_row === null
      ? null
      : bindECOSProjectDocumentInventoryRow(row.registry_row);
    if (registry_row && registry_row.source_id !== source_id) {
      throw new Error('Owner source summary identity mismatch');
    }
    const association_kind = row.association_kind,
      association_state = row.association_state;
    if (
      !['exact_primary', 'reviewed_secondary'].includes(
        association_kind as string,
      ) ||
      !['current', 'stale'].includes(association_state as string) ||
      row.binding_read !== null && row.owner_authority_read !== null
    ) {
      throw new Error(
        'Owner inventory association versions must be explicit and exclusive',
      );
    }
    const binding_read = row.binding_read === null
      ? null
      : await bindECOSDocumentProjectBindingRead(row.binding_read, {
        organizationId: expected.organizationId,
        ownerId: expected.ownerId,
        projectId: expected.projectId,
        documentId: source_id,
        decisionId: null,
      });
    const owner_authority_read = row.owner_authority_read === null
      ? null
      : await bindECOSOwnerSourceAuthorityRead(row.owner_authority_read, {
        ownerId: expected.ownerId,
        projectId: expected.projectId,
        documentId: source_id,
        decisionId: null,
      });
    const read = binding_read ?? owner_authority_read;
    if (read?.state === 'missing') {
      throw new Error('Selected owner inventory read cannot be missing');
    }
    if (association_kind === 'exact_primary') {
      if (association_state !== 'current' || registry_row === null) {
        throw new Error('Exact primary requires current recorded association');
      }
    } else if (read === null || read.state !== association_state) {
      throw new Error(
        'Secondary owner association must match a verified read state',
      );
    }
    if (
      binding_read?.state === 'current' &&
      (!registry_row || registry_row.is_current !== true ||
        registry_row.source_sha256 !==
          binding_read.receipt!.decision.content_sha256 ||
        registry_row.source_revision !==
          binding_read.receipt!.decision.source_revision)
    ) {
      throw new Error('Current old binding differs from source summary pins');
    }
    let effective_source: ECOSLinkedOwnerEffectiveSource | null = null;
    if (owner_authority_read?.state === 'current') {
      effective_source = deriveECOSOwnerEffectiveSource(
        registry_row,
        owner_authority_read,
      );
    } else if (
      association_state === 'current' &&
      registry_row?.disposition === 'current_candidate'
    ) {
      effective_source = Object.freeze({
        source_id,
        source_sha256: registry_row.source_sha256,
        source_revision: registry_row.source_revision,
        source_page_count: registry_row.source_page_count,
        authority_kind: 'declared_organization' as const,
        authority_decision_id: null,
        authority_receipt_sha256: null,
        source_locator_sha256: null,
      });
    }
    sameEffective(row.effective_source, effective_source);
    rows.push(
      Object.freeze({
        source_id,
        registry_row,
        association_kind: association_kind as
          | 'exact_primary'
          | 'reviewed_secondary',
        association_state: association_state as 'current' | 'stale',
        binding_read,
        owner_authority_read,
        effective_source,
      }),
    );
  }
  const page = Object.freeze({
    ...scope,
    epoch_sha256,
    total_count,
    after_source_id: expected.afterSourceId,
    next_source_id,
    rows: Object.freeze(rows),
  });
  budget(page, PAGE_BYTES);
  pages.set(page, expected);
  return page;
}
export function assertECOSBoundLinkedOwnerProjectDocumentInventoryPage(
  value: unknown,
): asserts value is ECOSBoundLinkedOwnerProjectDocumentInventoryPage {
  if (!value || typeof value !== 'object' || !pages.has(value)) {
    throw new Error('Owner inventory page requires exact binding');
  }
}
export function assembleECOSLinkedOwnerProjectDocumentInventory(
  input: readonly ECOSBoundLinkedOwnerProjectDocumentInventoryPage[],
): Readonly<ECOSLinkedOwnerProjectDocumentInventory> {
  if (
    !Array.isArray(input) || !input.length || input.length > 600 ||
    Reflect.ownKeys(input).length !== input.length + 1
  ) throw new Error('Bounded complete owner pages required');
  const values = Array.from({ length: input.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(input, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) {
      throw new Error('Owner pages must be dense data');
    }
    assertECOSBoundLinkedOwnerProjectDocumentInventoryPage(d.value);
    return d.value;
  });
  const first = values[0],
    rows: Readonly<ECOSLinkedOwnerProjectDocumentInventoryRow>[] = [];
  let cursor: string | null = null,
    bytes = 0,
    registryCount = 0,
    headCount = 0,
    started = false;
  const decisions = new Set<string>();
  for (const page of values) {
    const request = pages.get(page)!;
    if (
      started && cursor === null ||
      page.organization_id !== first.organization_id ||
      page.owner_id !== first.owner_id ||
      page.project_id !== first.project_id ||
      page.epoch_sha256 !== first.epoch_sha256 ||
      page.total_count !== first.total_count ||
      page.after_source_id !== cursor || request.afterSourceId !== cursor ||
      cursor !== null && request.epochSha256 !== first.epoch_sha256
    ) throw new Error('Owner pages mix scope, epoch, or continuation');
    started = true;
    const remaining = first.total_count - rows.length;
    if (
      page.rows.length !== Math.min(request.pageLimit, remaining) ||
      page.next_source_id !==
        (page.rows.length < remaining ? page.rows.at(-1)!.source_id : null)
    ) throw new Error('Owner inventory contains an omitted or invented prefix');
    bytes += size(page);
    if (bytes > INVENTORY_BYTES) {
      throw new Error('Owner inventory retained bound exceeded');
    }
    for (const row of page.rows) {
      if (
        rows.length &&
        compareSourceIds(rows.at(-1)!.source_id, row.source_id) >= 0
      ) throw new Error('Owner source identities overlap');
      if (row.registry_row) registryCount++;
      const read = row.binding_read ?? row.owner_authority_read;
      if (read) {
        headCount++;
        if (decisions.has(read.decision_id!)) {
          throw new Error('Owner inventory reuses a receipt identity');
        }
        decisions.add(read.decision_id!);
      }
      rows.push(row);
    }
    if (registryCount > 500 || headCount > 100) {
      throw new Error('Owner inventory exceeds physical source/head bounds');
    }
    cursor = page.next_source_id;
  }
  if (cursor !== null || rows.length !== first.total_count) {
    throw new Error('Owner inventory enumeration is incomplete');
  }
  const { after_source_id: _a, next_source_id: _n, rows: _r, ...scope } = first;
  const inventory = Object.freeze({
    ...scope,
    rows: Object.freeze(rows),
    whole_project_completeness: 'not_assessed' as const,
  });
  budget(inventory, INVENTORY_BYTES);
  inventories.add(inventory);
  return inventory;
}
export function assertECOSLinkedOwnerProjectDocumentInventory(
  value: unknown,
): asserts value is ECOSLinkedOwnerProjectDocumentInventory {
  if (!value || typeof value !== 'object' || !inventories.has(value)) {
    throw new Error('Owner inventory requires complete branded pages');
  }
}
/** Expected source resolution is the next step, never proof that indexing,
 * download verification, search, or an answer has happened. */
export function buildECOSLinkedOwnerProjectDocumentPlan(
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
) {
  assertECOSLinkedOwnerProjectDocumentInventory(inventory);
  const items = inventory.rows.map((source) =>
    Object.freeze({
      source,
      next_step: source.effective_source !== null
        ? 'needs_index_resolution' as const
        : source.association_state === 'stale' ||
            source.registry_row === null ||
            source.owner_authority_read?.state === 'stale'
        ? 'needs_association_review' as const
        : source.registry_row.disposition === 'not_current'
        ? 'excluded_not_current' as const
        : source.registry_row.disposition === 'superseded'
        ? 'excluded_superseded' as const
        : 'needs_metadata_review' as const,
    })
  );
  const { rows: _r, ...scope } = inventory;
  const plan = Object.freeze({
    ...scope,
    schema_version: 'ecos-linked-owner-project-document-plan/2.1' as const,
    answer_readiness: 'not_assessed' as const,
    index_resolution: 'not_performed' as const,
    question_interpretation: 'not_performed' as const,
    items: Object.freeze(items),
  });
  budget(plan, INVENTORY_BYTES);
  return plan;
}
