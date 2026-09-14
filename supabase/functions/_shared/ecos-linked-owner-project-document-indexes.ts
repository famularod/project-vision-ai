import {
  assertECOSLinkedOwnerProjectDocumentInventory,
  type ECOSLinkedOwnerProjectDocumentInventory,
  type ECOSLinkedOwnerProjectDocumentInventoryRow,
} from './ecos-linked-owner-project-document-inventory.ts';
import type { ECOSOwnerPageHead } from './ecos-owner-page-observations.ts';

/** Complete, owner-specific METADATA inventory. No HostedJob conversion,
 * checkpoint body reads, extraction completion, image or answer authority. */
const SCHEMA = 'ecos-linked-owner-project-document-indexes/2.1' as const;
const MiB = 1024 * 1024;
const MAX_PAGE = 2 * MiB, MAX_RETAINED = 16 * MiB;
const SHA = /^[a-f0-9]{64}$/;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const encoder = new TextEncoder();
const STATES = [
  'inventory_gap',
  'authority_unavailable',
  'execution_missing',
  'execution_stale',
  'execution_ambiguous',
  'project_scope_mismatch',
  'execution_cancelled',
  'execution_in_progress',
  'execution_current',
] as const;
export type ECOSOwnerIndexResolutionState = typeof STATES[number];
export interface ECOSOwnerIndexExecution {
  readonly execution_id: string;
  readonly binding_id: string;
  readonly binding_version: number;
  readonly source_sha256: string;
  readonly source_revision: string | null;
  readonly source_page_count: number;
  readonly extraction_version: 'ecos-owner-native-preview/2.0';
  readonly authority_decision_id: string;
  readonly authority_receipt_sha256: string;
  readonly managed_attempt_id: string;
  readonly managed_receipt_sha256: string;
  readonly state: 'queued' | 'running' | 'released' | 'failed' | 'expired';
}
export interface ECOSOwnerIndexSourceRow {
  readonly kind: 'source';
  readonly ordinal: number;
  readonly source_id: string;
  readonly source_page_count: number | null;
  readonly resolution_state: ECOSOwnerIndexResolutionState;
  readonly execution: ECOSOwnerIndexExecution | null;
}
export interface ECOSOwnerIndexPageRow {
  readonly kind: 'page';
  readonly ordinal: number;
  readonly source_id: string;
  readonly page_number: number;
  readonly head: ECOSOwnerPageHead | null;
}
export type ECOSOwnerIndexRow = ECOSOwnerIndexSourceRow | ECOSOwnerIndexPageRow;
export interface ECOSBoundLinkedOwnerProjectDocumentIndexesPage {
  readonly schema_version: typeof SCHEMA;
  readonly publication_mode: 'shadow';
  readonly organization_id: string;
  readonly project_id: string;
  readonly owner_id: string;
  readonly inventory_epoch_sha256: string;
  readonly index_epoch_sha256: string;
  readonly total_source_count: number;
  readonly total_expected_page_count: number;
  readonly total_row_count: number;
  readonly after_ordinal: number;
  readonly next_ordinal: number | null;
  readonly rows: readonly ECOSOwnerIndexRow[];
  readonly retrieval_authorized: false;
  readonly answer_readiness: 'not_assessed';
  readonly semantic_verified: false;
  readonly image_available: false;
}
export interface ECOSOwnerIndexSource {
  readonly source: Readonly<ECOSLinkedOwnerProjectDocumentInventoryRow>;
  readonly resolution: ECOSOwnerIndexSourceRow;
  readonly pages: readonly ECOSOwnerIndexPageRow[];
  readonly coverage: {
    readonly expected_page_count: number | null;
    readonly checkpoint_count: number;
    readonly missing_page_count: number | null;
    readonly native: Readonly<
      Record<'partial' | 'unreadable' | 'failed' | 'not_attempted', number>
    >;
    readonly table: Readonly<
      Record<'partial' | 'unreadable' | 'failed' | 'not_attempted', number>
    >;
    readonly visual: Readonly<
      Record<'partial' | 'unreadable' | 'failed' | 'not_attempted', number>
    >;
  };
}
export interface ECOSLinkedOwnerProjectDocumentIndexes {
  readonly schema_version: typeof SCHEMA;
  readonly publication_mode: 'shadow';
  readonly organization_id: string;
  readonly project_id: string;
  readonly owner_id: string;
  readonly inventory_epoch_sha256: string;
  readonly index_epoch_sha256: string;
  readonly total_source_count: number;
  readonly total_expected_page_count: number;
  readonly total_row_count: number;
  readonly sources: readonly ECOSOwnerIndexSource[];
  readonly retrieval_authorized: false;
  readonly answer_readiness: 'not_assessed';
  readonly semantic_verified: false;
  readonly image_available: false;
  readonly geometry_validation: 'not_performed';
  readonly whole_project_completeness: 'not_assessed';
  readonly currentness: 'index_readbacks_only_not_atomic_project_snapshot';
}
export interface ECOSExpectedOwnerIndexesPage {
  afterOrdinal: number;
  pageLimit: number;
  indexEpochSha256: string | null;
}
type Layout = {
  source: Readonly<ECOSLinkedOwnerProjectDocumentInventoryRow>;
  page: number;
  count: number | null;
}[];
const layouts = new WeakMap<object, Layout>();
const pages = new WeakMap<
  object,
  {
    inventory: ECOSLinkedOwnerProjectDocumentInventory;
    expected: Readonly<ECOSExpectedOwnerIndexesPage>;
  }
>();
const indexes = new WeakMap<object, ECOSLinkedOwnerProjectDocumentInventory>();
const reject = (): never => {
  throw new Error(
    'Owner index inventory rejected or exceeds whole-inventory bounds',
  );
};
function integer(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) {
    return reject();
  }
  return v;
}
function pin(v: unknown, uuid = false): string {
  if (typeof v !== 'string' || !(uuid ? UUID : SHA).test(v)) return reject();
  return v;
}
function size(v: unknown) {
  return encoder.encode(JSON.stringify(v)).length;
}
function object(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !v || typeof v !== 'object' || Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  ) return reject();
  return v as Record<string, unknown>;
}
function copy(value: unknown): unknown {
  let nodes = 0, bytes = 0;
  function visit(v: unknown, depth: number): unknown {
    if (++nodes > 200000 || depth > 16) return reject();
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return integer(v, 0, Number.MAX_SAFE_INTEGER);
    if (typeof v === 'string') {
      if (
        v.length > MAX_PAGE || [...v].some((c) => {
          const n = c.codePointAt(0)!;
          return n === 0 || n >= 0xd800 && n <= 0xdfff;
        })
      ) return reject();
      bytes += encoder.encode(v).length;
      if (bytes > MAX_PAGE) return reject();
      return v;
    }
    if (!v || typeof v !== 'object') return reject();
    const array = Array.isArray(v), prototype = Object.getPrototypeOf(v);
    if (
      array
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    ) return reject();
    const keys = Reflect.ownKeys(v),
      descriptors = Object.getOwnPropertyDescriptors(v);
    if (array && (v as unknown[]).length > 128 || !array && keys.length > 32) {
      return reject();
    }
    for (const k of keys) {
      if (array && k === 'length') continue;
      if (
        typeof k !== 'string' ||
        ['__proto__', 'constructor', 'prototype'].includes(k) ||
        !descriptors[k].enumerable || !Object.hasOwn(descriptors[k], 'value')
      ) return reject();
    }
    if (array) {
      if (keys.length !== (v as unknown[]).length + 1) return reject();
      return Object.freeze(
        Array.from({ length: (v as unknown[]).length }, (_, i) => {
          if (!Object.hasOwn(descriptors, String(i))) return reject();
          return visit(descriptors[i].value, depth + 1);
        }),
      );
    }
    return Object.freeze(
      Object.fromEntries(
        keys.map((k) => [k, visit(descriptors[k as string].value, depth + 1)]),
      ),
    );
  }
  const result = visit(value, 0);
  if (size(result) > MAX_PAGE) return reject();
  return result;
}
function layout(inventory: ECOSLinkedOwnerProjectDocumentInventory): Layout {
  assertECOSLinkedOwnerProjectDocumentInventory(inventory);
  let result = layouts.get(inventory);
  if (result) return result;
  result = [];
  let total = 0;
  for (const source of inventory.rows) {
    const count = source.effective_source?.source_page_count ??
      source.registry_row?.source_page_count ?? null;
    if (count !== null) {
      integer(count, 1, 10000);
      total += count;
    }
    if (total > 20000 || inventory.rows.length > 600) return reject();
    result.push({ source, count, page: 0 });
    for (let page = 1; page <= (count ?? 0); page++) {
      result.push({ source, count, page });
    }
  }
  layouts.set(inventory, result);
  return result;
}
function head(value: unknown) {
  if (value === null) return;
  const h = object(value, [
    'attempt_id',
    'page_sha256',
    'version',
    'previous_attempt_id',
    'recorded_at',
    'modalities',
  ]);
  pin(h.attempt_id, true);
  pin(h.page_sha256);
  integer(h.version, 1, 32);
  if (h.previous_attempt_id !== null) pin(h.previous_attempt_id, true);
  if (
    (h.version === 1) !== (h.previous_attempt_id === null) ||
    h.previous_attempt_id === h.attempt_id
  ) return reject();
  const stamp = h.recorded_at;
  if (
    typeof stamp !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(
      stamp,
    ) || !Number.isFinite(Date.parse(stamp)) ||
    new Date(Date.parse(stamp)).toISOString().slice(0, 19) !==
      stamp.slice(0, 19)
  ) return reject();
  const modalities = object(h.modalities, ['native', 'table', 'visual']);
  for (
    const [lane, max] of [['native', MiB], ['table', 3 * MiB], [
      'visual',
      4 * MiB,
    ]] as const
  ) {
    const m = object(modalities[lane], [
      'state',
      'payload_sha256',
      'payload_bytes',
      'limitation_codes',
    ]);
    if (
      !['partial', 'unreadable', 'failed', 'not_attempted'].includes(
        m.state as string,
      )
    ) return reject();
    integer(m.payload_bytes, 0, max);
    const codes = m.limitation_codes;
    if (
      !Array.isArray(codes) || codes.length < 1 || codes.length > 32 ||
      new Set(codes).size !== codes.length || codes.some((c) =>
        typeof c !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(c)
      )
    ) {
      return reject();
    }
    if (m.payload_sha256 === null) {
      if (
        m.payload_bytes !== 0 ||
        !['failed', 'not_attempted'].includes(m.state as string)
      ) {
        return reject();
      }
    } else {
      pin(m.payload_sha256);
      if (
        (m.payload_bytes as number) < 2 || m.state === 'not_attempted' ||
        lane === 'visual' && m.state === 'failed'
      ) {
        return reject();
      }
    }
  }
}
function sourceRow(raw: Record<string, unknown>, expected: Layout[number]) {
  object(raw, [
    'kind',
    'ordinal',
    'source_id',
    'source_page_count',
    'resolution_state',
    'execution',
  ]);
  const source = expected.source, effective = source.effective_source;
  if (
    raw.source_page_count !== expected.count ||
    !STATES.includes(raw.resolution_state as ECOSOwnerIndexResolutionState)
  ) return reject();
  if (!effective) {
    if (raw.resolution_state !== 'inventory_gap') return reject();
  } else if (effective.authority_kind === 'declared_organization') {
    if (raw.resolution_state !== 'authority_unavailable') return reject();
  } else if (
    ['inventory_gap', 'authority_unavailable'].includes(
      raw.resolution_state as string,
    )
  ) return reject();
  const usable = ['execution_current', 'execution_in_progress'].includes(
    raw.resolution_state as string,
  );
  if (!usable) {
    if (raw.execution !== null) return reject();
    return;
  }
  if (
    !effective || effective.authority_kind !== 'owner_workspace_receipt' ||
    source.owner_authority_read?.state !== 'current'
  ) return reject();
  const e = object(raw.execution, [
    'execution_id',
    'binding_id',
    'binding_version',
    'source_sha256',
    'source_revision',
    'source_page_count',
    'extraction_version',
    'authority_decision_id',
    'authority_receipt_sha256',
    'managed_attempt_id',
    'managed_receipt_sha256',
    'state',
  ]);
  for (
    const key of [
      'execution_id',
      'binding_id',
      'authority_decision_id',
      'managed_attempt_id',
    ]
  ) pin(e[key], true);
  for (
    const key of [
      'source_sha256',
      'authority_receipt_sha256',
      'managed_receipt_sha256',
    ]
  ) pin(e[key]);
  integer(e.binding_version, 1, 100);
  if (
    e.source_sha256 !== effective.source_sha256 ||
    e.source_revision !== effective.source_revision ||
    e.source_page_count !== expected.count ||
    e.extraction_version !== 'ecos-owner-native-preview/2.0' ||
    e.authority_decision_id !== effective.authority_decision_id ||
    e.authority_receipt_sha256 !== effective.authority_receipt_sha256 ||
    !(raw.resolution_state === 'execution_in_progress'
      ? ['queued', 'running']
      : ['released', 'failed', 'expired']).includes(e.state as string)
  ) return reject();
}
export function bindECOSLinkedOwnerProjectDocumentIndexesPage(
  value: unknown,
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  expected: ECOSExpectedOwnerIndexesPage,
): Readonly<ECOSBoundLinkedOwnerProjectDocumentIndexesPage> {
  try {
    const ordered = layout(inventory);
    const e = object(copy(expected), [
      'afterOrdinal',
      'pageLimit',
      'indexEpochSha256',
    ]);
    const after = integer(e.afterOrdinal, 0, ordered.length),
      limit = integer(e.pageLimit, 1, 128);
    if (e.indexEpochSha256 !== null) pin(e.indexEpochSha256);
    if (
      after !== 0 && e.indexEpochSha256 === null ||
      after === ordered.length && after !== 0
    ) return reject();
    const r = object(copy(value), [
      'schema_version',
      'publication_mode',
      'organization_id',
      'project_id',
      'owner_id',
      'inventory_epoch_sha256',
      'index_epoch_sha256',
      'total_source_count',
      'total_expected_page_count',
      'total_row_count',
      'after_ordinal',
      'next_ordinal',
      'rows',
      'retrieval_authorized',
      'answer_readiness',
      'semantic_verified',
      'image_available',
    ]);
    pin(r.index_epoch_sha256);
    if (
      r.schema_version !== SCHEMA || r.publication_mode !== 'shadow' ||
      r.organization_id !== inventory.organization_id ||
      r.owner_id !== inventory.owner_id ||
      r.project_id !== inventory.project_id ||
      inventory.organization_id !== inventory.owner_id ||
      r.inventory_epoch_sha256 !== inventory.epoch_sha256 ||
      e.indexEpochSha256 !== null &&
        r.index_epoch_sha256 !== e.indexEpochSha256 ||
      r.total_source_count !== inventory.rows.length ||
      r.total_expected_page_count !== ordered.length - inventory.rows.length ||
      r.total_row_count !== ordered.length ||
      r.after_ordinal !== after || r.retrieval_authorized !== false ||
      r.answer_readiness !== 'not_assessed' || r.semantic_verified !== false ||
      r.image_available !== false
    ) return reject();
    const rows = r.rows;
    if (
      !Array.isArray(rows) ||
      rows.length !== Math.min(limit, ordered.length - after)
    ) return reject();
    if (
      r.next_ordinal !==
        (after + rows.length < ordered.length ? after + rows.length : null)
    ) return reject();
    for (let i = 0; i < rows.length; i++) {
      const item = rows[i] as Record<string, unknown>, at = ordered[after + i];
      if (
        item.ordinal !== after + i + 1 ||
        item.source_id !== at.source.source_id ||
        item.kind !== (at.page === 0 ? 'source' : 'page')
      ) return reject();
      if (at.page === 0) sourceRow(item, at);
      else {
        object(item, ['kind', 'ordinal', 'source_id', 'page_number', 'head']);
        if (item.page_number !== at.page) return reject();
        head(item.head);
      }
    }
    const result =
      r as unknown as ECOSBoundLinkedOwnerProjectDocumentIndexesPage;
    pages.set(result, {
      inventory,
      expected: e as unknown as ECOSExpectedOwnerIndexesPage,
    });
    return result;
  } catch {
    return reject();
  }
}
export function assembleECOSLinkedOwnerProjectDocumentIndexes(
  supplied: readonly ECOSBoundLinkedOwnerProjectDocumentIndexesPage[],
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
): Readonly<ECOSLinkedOwnerProjectDocumentIndexes> {
  const ordered = layout(inventory);
  if (
    !Array.isArray(supplied) ||
    Object.getPrototypeOf(supplied) !== Array.prototype || !supplied.length ||
    supplied.length > 20600 ||
    Reflect.ownKeys(supplied).length !== supplied.length + 1
  ) return reject();
  const descriptors = Object.getOwnPropertyDescriptors(supplied);
  const input = Array.from({ length: supplied.length }, (_, i) => {
    const descriptor = descriptors[String(i)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      return reject();
    }
    const origin = descriptor.value && typeof descriptor.value === 'object'
      ? pages.get(descriptor.value)
      : null;
    if (!origin || origin.inventory !== inventory) return reject();
    return descriptor.value as ECOSBoundLinkedOwnerProjectDocumentIndexesPage;
  });
  let offset = 0, bytes = 0;
  const epoch = input[0].index_epoch_sha256;
  const sources: ECOSOwnerIndexSource[] = [], ids = new Set<string>();
  let current: {
    source: Readonly<ECOSLinkedOwnerProjectDocumentInventoryRow>;
    resolution: ECOSOwnerIndexSourceRow;
    pages: ECOSOwnerIndexPageRow[];
  } | null = null;
  function flush() {
    if (!current) return;
    const resolution = current.resolution, rows = current.pages;
    if (rows.length !== (resolution.source_page_count ?? 0)) return reject();
    const available = resolution.execution !== null;
    const counts = () => ({
      partial: 0,
      unreadable: 0,
      failed: 0,
      not_attempted: 0,
    });
    const coverage = {
      expected_page_count: resolution.source_page_count,
      checkpoint_count: 0,
      missing_page_count: resolution.source_page_count,
      native: counts(),
      table: counts(),
      visual: counts(),
    };
    for (const p of rows) {
      if (p.head !== null) {
        if (
          !available || resolution.execution!.state === 'queued' ||
          ids.has(p.head.attempt_id)
        ) return reject();
        ids.add(p.head.attempt_id);
        coverage.checkpoint_count++;
        for (
          const lane of ['native', 'table', 'visual'] as const
        ) coverage[lane][p.head.modalities[lane].state]++;
      }
    }
    if (coverage.missing_page_count !== null) {
      coverage.missing_page_count -= coverage.checkpoint_count;
    }
    sources.push(Object.freeze({
      ...current,
      pages: Object.freeze(rows),
      coverage: Object.freeze({
        ...coverage,
        native: Object.freeze(coverage.native),
        table: Object.freeze(coverage.table),
        visual: Object.freeze(coverage.visual),
      }),
    }));
  }
  const executionIds = new Set<string>(), bindingIds = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const p = input[i], origin = pages.get(p);
    if (
      !origin || origin.inventory !== inventory ||
      p.index_epoch_sha256 !== epoch || p.after_ordinal !== offset ||
      i > 0 && input[i - 1].next_ordinal === null
    ) return reject();
    bytes += size(p);
    if (bytes > MAX_RETAINED) return reject();
    for (const row of p.rows) {
      if (row.kind === 'source') {
        flush();
        current = {
          source: ordered[offset].source,
          resolution: row,
          pages: [],
        };
        if (row.execution) {
          if (
            executionIds.has(row.execution.execution_id) ||
            bindingIds.has(row.execution.binding_id)
          ) return reject();
          executionIds.add(row.execution.execution_id);
          bindingIds.add(row.execution.binding_id);
        }
      } else {
        if (!current) return reject();
        current.pages.push(row);
      }
      offset++;
    }
  }
  flush();
  if (
    offset !== ordered.length || input.at(-1)!.next_ordinal !== null ||
    sources.length !== inventory.rows.length
  ) return reject();
  const result: ECOSLinkedOwnerProjectDocumentIndexes = Object.freeze({
    schema_version: SCHEMA,
    publication_mode: 'shadow',
    organization_id: inventory.organization_id,
    project_id: inventory.project_id,
    owner_id: inventory.owner_id,
    inventory_epoch_sha256: inventory.epoch_sha256,
    index_epoch_sha256: epoch,
    total_source_count: sources.length,
    total_expected_page_count: ordered.length - sources.length,
    total_row_count: ordered.length,
    sources: Object.freeze(sources),
    retrieval_authorized: false,
    answer_readiness: 'not_assessed',
    semantic_verified: false,
    image_available: false,
    geometry_validation: 'not_performed',
    whole_project_completeness: 'not_assessed',
    currentness: 'index_readbacks_only_not_atomic_project_snapshot',
  });
  if (size(result) > MAX_RETAINED) return reject();
  indexes.set(result, inventory);
  return result;
}
export function assertECOSLinkedOwnerProjectDocumentIndexes(
  value: unknown,
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
): asserts value is Readonly<ECOSLinkedOwnerProjectDocumentIndexes> {
  assertECOSLinkedOwnerProjectDocumentInventory(inventory);
  if (!value || typeof value !== 'object' || indexes.get(value) !== inventory) {
    return reject();
  }
}
