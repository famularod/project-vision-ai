import {
  buildECOSSourceAccountabilityManifest,
  type ECOSExtractionMethod,
  type ECOSSourceAccountabilityManifest,
  type ECOSSourceGapCode,
  expectedECOSPageItems,
} from './ecos-source-accountability.ts';
import { ECOS_NATIVE_TABLE_EXTRACTION_VERSION } from './ecos-table-evidence-records.ts';
import {
  type ECOSStoredTableRecords,
  projectECOSStoredTableRecords,
} from './ecos-stored-table-records.ts';

export const ECOS_TABLE_SOURCE_MANIFEST_SCHEMA_VERSION =
  'ecos-table-source-manifest/2.0' as const;
export const ECOS_MANIFEST_TABLE_PAGE_SCHEMA_VERSION =
  'ecos-manifest-table-page/2.0' as const;

export interface ECOSExpectedTableSourceManifest {
  jobId: string;
  organizationId: string;
  projectId: string;
  sourceId: string;
  sourceSha256: string;
  sourceRevision: string | null;
  sourcePageCount: number;
  manifestId: string;
  manifestSha256: string;
}

export interface ECOSBoundTableSourceItem {
  pageNumber: number;
  itemKey: string;
  state: 'pending' | 'partial' | 'unreadable' | 'failed';
  reported: boolean;
  extractionMethods: readonly ECOSExtractionMethod[];
  /** Number of raw extracted tables, not interpreted or verified facts. */
  evidenceRecordCount: number;
  limitationCodes: readonly string[];
  gapCode: ECOSSourceGapCode;
  resultSha256: string;
  projectionId: string | null;
  projectionSha256: string | null;
}

export interface ECOSBoundTableSourceManifest {
  jobId: string;
  manifestId: string;
  manifestSha256: string;
  accountability: Readonly<ECOSSourceAccountabilityManifest>;
  items: readonly Readonly<ECOSBoundTableSourceItem>[];
}

const boundManifests = new WeakSet<object>();
const projectedPages = new WeakMap<object, {
  manifest: ECOSBoundTableSourceManifest;
  pageNumber: number;
}>();
const encoder = new TextEncoder();
const BASE_LIMITATIONS = [
  'native_ruled_tables_only',
  'visual_understanding_pending',
  'authority_resolution_pending',
] as const;
const EXPECTED_KEYS = [
  'jobId',
  'organizationId',
  'projectId',
  'sourceId',
  'sourceSha256',
  'sourceRevision',
  'sourcePageCount',
  'manifestId',
  'manifestSha256',
] as const;
const MANIFEST_KEYS = [
  'schema_version',
  'publication_mode',
  'job_id',
  'manifest_id',
  'manifest_sha256',
  'organization_id',
  'project_id',
  'source_id',
  'source_sha256',
  'source_revision',
  'source_kind',
  'source_page_count',
  'extraction_version',
  'reported_item_count',
  'terminal_item_count',
  'usable_item_count',
  'gap_item_count',
  'fully_accounted',
  'fully_usable',
  'items',
] as const;
const ITEM_KEYS = [
  'page_number',
  'item_key',
  'state',
  'reported',
  'extraction_methods',
  'evidence_record_count',
  'limitation_codes',
  'gap_code',
  'result_sha256',
  'projection_id',
  'projection_sha256',
] as const;

function dataObject(value: unknown, keys: readonly string[], field: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const names = Reflect.ownKeys(value);
  if (
    names.length !== keys.length ||
    names.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) throw new Error(`${field} has missing or unsupported fields`);
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${field} must contain data properties only`);
    }
    copy[key] = descriptor.value;
  }
  return copy;
}

function dataArray(value: unknown, max: number, field: string): unknown[] {
  if (
    !Array.isArray(value) || value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new Error(`${field} must be a bounded dense data array`);
  }
  return Array.from({ length: value.length }, (_, index) => {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !Object.hasOwn(property, 'value')) {
      throw new Error(`${field} must contain data properties only`);
    }
    return property.value;
  });
}

function identity(value: unknown, field: string, max = 300): string {
  // Deliberate intersection with the existing accountability identity contract:
  // JS trim excludes FEFF at boundaries; native Python strip excludes NEL.
  // Reject both here instead of normalizing or broadening either old boundary.
  if (
    typeof value !== 'string' || value.length > max || !value ||
    value.trim() !== value || value.startsWith('\u0085') ||
    value.endsWith('\u0085') ||
    [...value].some((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    ) ||
    /[\ud800-\udfff]/u.test(
      value.replace(/[\ud800-\udbff][\udc00-\udfff]/gu, ''),
    ) ||
    encoder.encode(value).length > max
  ) {
    throw new Error(`${field} must be an exact bounded identity`);
  }
  return value;
}
function pin(value: unknown, field: string, uuid = false): string {
  const pattern = uuid
    ? /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
    : /^[a-f0-9]{64}$/;
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(
      `${field} must be a canonical ${uuid ? 'UUID' : 'SHA-256'}`,
    );
  }
  return value;
}
function integer(value: unknown, min: number, max: number, field: string) {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) ||
    value < min || value > max
  ) throw new Error(`${field} exceeds its integer bound`);
  return value;
}
function strings(value: unknown, allowed: readonly string[], field: string) {
  const values = dataArray(value, allowed.length, field);
  if (values.length !== allowed.length) {
    throw new Error(`${field} does not match its state`);
  }
  const copy = values.map((item) => identity(item, field, 100));
  if (
    new Set(copy).size !== copy.length ||
    copy.some((item) => !allowed.includes(item))
  ) {
    throw new Error(`${field} does not match its state`);
  }
  return Object.freeze(copy);
}

/**
 * Internal service boundary only. Expected pins must come independently from
 * the trusted snapshot RPC. This is not caller authentication or cryptographic
 * verification of PostgreSQL's canonical JSONB digest. Database immutability
 * and the page RPC's whole-inventory currentness check remain required.
 */
export function bindECOSTableSourceManifest(
  raw: unknown,
  expectedInput: ECOSExpectedTableSourceManifest,
): Readonly<ECOSBoundTableSourceManifest> {
  const input = dataObject(
    expectedInput,
    EXPECTED_KEYS,
    'expected manifest scope',
  );
  const expected = Object.freeze({
    jobId: pin(input.jobId, 'jobId', true),
    organizationId: identity(input.organizationId, 'organizationId', 500),
    projectId: identity(input.projectId, 'projectId', 500),
    sourceId: identity(input.sourceId, 'sourceId'),
    sourceSha256: pin(input.sourceSha256, 'sourceSha256'),
    sourceRevision: input.sourceRevision === null
      ? null
      : identity(input.sourceRevision, 'sourceRevision'),
    sourcePageCount: integer(
      input.sourcePageCount,
      1,
      10_000,
      'sourcePageCount',
    ),
    manifestId: pin(input.manifestId, 'manifestId', true),
    manifestSha256: pin(input.manifestSha256, 'manifestSha256'),
  });
  const wire = dataObject(raw, MANIFEST_KEYS, 'table source manifest');
  const scope = {
    schema_version: ECOS_TABLE_SOURCE_MANIFEST_SCHEMA_VERSION,
    publication_mode: 'shadow',
    source_kind: 'other',
    extraction_version: ECOS_NATIVE_TABLE_EXTRACTION_VERSION,
    job_id: expected.jobId,
    organization_id: expected.organizationId,
    project_id: expected.projectId,
    source_id: expected.sourceId,
    source_sha256: expected.sourceSha256,
    source_revision: expected.sourceRevision,
    source_page_count: expected.sourcePageCount,
    manifest_id: expected.manifestId,
    manifest_sha256: expected.manifestSha256,
  };
  if (Object.entries(scope).some(([key, value]) => wire[key] !== value)) {
    throw new Error(
      'table source manifest does not match independently trusted scope and pins',
    );
  }
  const wireItems = dataArray(
    wire.items,
    expected.sourcePageCount,
    'table manifest inventory',
  );
  if (wireItems.length !== expected.sourcePageCount) {
    throw new Error(
      'table manifest must retain every independently registered page',
    );
  }
  const projectionIds = new Set<string>();
  const resultHashes = new Set<string>();
  const items = wireItems.map(
    (value, index): Readonly<ECOSBoundTableSourceItem> => {
      const item = dataObject(value, ITEM_KEYS, 'table manifest item');
      const pageNumber = index + 1;
      if (
        item.page_number !== pageNumber ||
        item.item_key !== `page:${pageNumber}`
      ) {
        throw new Error(
          'table manifest pages must be ordered, exact and contiguous',
        );
      }
      const state = item.state;
      if (
        state !== 'pending' && state !== 'partial' && state !== 'unreadable' &&
        state !== 'failed'
      ) {
        throw new Error(
          'table manifest cannot claim complete or verified source content',
        );
      }
      const reported = state !== 'pending';
      const gapCode = state === 'pending'
        ? 'missing_processing_result'
        : state === 'partial'
        ? 'partially_readable'
        : state === 'unreadable'
        ? 'unreadable_content'
        : 'processing_failed';
      if (item.reported !== reported || item.gap_code !== gapCode) {
        throw new Error('table manifest reported state or gap is inconsistent');
      }
      const methods = strings(
        item.extraction_methods,
        state === 'partial' ? ['structured_table'] : [],
        'extraction methods',
      ) as readonly ECOSExtractionMethod[];
      const limitations = state === 'pending'
        ? ['missing_processing_result']
        : state === 'unreadable'
        ? [...BASE_LIMITATIONS, 'native_ruled_table_unavailable']
        : state === 'failed'
        ? [...BASE_LIMITATIONS, 'native_table_processing_failed']
        : [...BASE_LIMITATIONS];
      const limitationCodes = strings(
        item.limitation_codes,
        limitations,
        'limitation codes',
      );
      const evidenceRecordCount = integer(
        item.evidence_record_count,
        state === 'partial' ? 1 : 0,
        state === 'partial' ? 16 : 0,
        'raw table count',
      );
      const resultSha256 = pin(item.result_sha256, 'item resultSha256');
      if (resultHashes.has(resultSha256)) {
        throw new Error('duplicate page-bound result identity');
      }
      resultHashes.add(resultSha256);
      const projectionId = reported
        ? pin(item.projection_id, 'projectionId', true)
        : null;
      const projectionSha256 = reported
        ? pin(item.projection_sha256, 'projectionSha256')
        : null;
      if (
        !reported &&
        (item.projection_id !== null || item.projection_sha256 !== null)
      ) {
        throw new Error('missing table pages cannot have projection pins');
      }
      if (projectionId) {
        if (projectionIds.has(projectionId)) {
          throw new Error(
            'duplicate page projection identity',
          );
        }
        projectionIds.add(projectionId);
      }
      return Object.freeze({
        pageNumber,
        itemKey: `page:${pageNumber}`,
        state,
        reported,
        extractionMethods: methods,
        evidenceRecordCount,
        limitationCodes,
        gapCode,
        resultSha256,
        projectionId,
        projectionSha256,
      });
    },
  );
  const sourceIdentity = Object.freeze({
    organizationId: expected.organizationId,
    projectId: expected.projectId,
    sourceId: expected.sourceId,
    sourceSha256: expected.sourceSha256,
    sourceRevision: expected.sourceRevision,
    snapshotId: expected.manifestId,
    extractionVersion: ECOS_NATIVE_TABLE_EXTRACTION_VERSION,
  });
  const accountability = buildECOSSourceAccountabilityManifest({
    ...sourceIdentity,
    sourceKind: 'other',
    expectedItemCount: expected.sourcePageCount,
    expectedItems: expectedECOSPageItems(expected.sourcePageCount),
    itemResults: items.filter((item) => item.reported).map((item) => ({
      itemKey: item.itemKey,
      itemKind: 'page',
      ordinal: item.pageNumber,
      sourceIdentity,
      state: item.state,
      extractionMethods: item.extractionMethods,
      evidenceRecordCount: item.evidenceRecordCount,
      limitationCodes: item.limitationCodes,
    })),
  });
  const summary = {
    reported_item_count: accountability.reportedItemCount,
    terminal_item_count: accountability.terminalItemCount,
    usable_item_count: accountability.usableItemCount,
    gap_item_count: accountability.gapItemCount,
    fully_accounted: accountability.fullyAccounted,
    fully_usable: accountability.fullyUsable,
  };
  if (Object.entries(summary).some(([key, value]) => wire[key] !== value)) {
    throw new Error(
      'table manifest coverage does not match independently rebuilt accountability',
    );
  }
  const bound = Object.freeze({
    jobId: expected.jobId,
    manifestId: expected.manifestId,
    manifestSha256: expected.manifestSha256,
    accountability,
    items: Object.freeze(items),
  });
  boundManifests.add(bound);
  return bound;
}

export function assertECOSBoundTableSourceManifest(
  value: unknown,
): asserts value is ECOSBoundTableSourceManifest {
  if (!value || typeof value !== 'object' || !boundManifests.has(value)) {
    throw new Error(
      'table source manifest must originate from the trusted binding boundary',
    );
  }
}

export function assertECOSManifestTableRecords(
  value: unknown,
  manifest: ECOSBoundTableSourceManifest,
): asserts value is ECOSStoredTableRecords {
  assertECOSBoundTableSourceManifest(manifest);
  const origin = value && typeof value === 'object'
    ? projectedPages.get(value)
    : undefined;
  if (!origin || origin.manifest !== manifest) {
    throw new Error(
      'table records must originate from this exact manifest page boundary',
    );
  }
}

/** Copy only bounded JSON data; getters and later caller mutation cannot alter the async readback. */
function snapshotPageData(value: unknown): unknown {
  let nodes = 0, bytes = 0;
  const path = new Set<object>();
  const visit = (part: unknown, depth: number): unknown => {
    if (++nodes > 100_000 || depth > 12) {
      throw new Error('table page readback exceeds its structural budget');
    }
    if (part === null || typeof part === 'boolean') return part;
    if (typeof part === 'number' && Number.isFinite(part)) return part;
    if (typeof part === 'string') {
      if (part.length > 2 * 1024 * 1024 - bytes) {
        throw new Error('table page readback exceeds its byte budget');
      }
      bytes += encoder.encode(part).length;
      if (bytes > 2 * 1024 * 1024) {
        throw new Error('table page readback exceeds its byte budget');
      }
      return part;
    }
    if (!part || typeof part !== 'object' || path.has(part)) {
      throw new Error('table page readback must contain acyclic JSON data');
    }
    path.add(part);
    const array = Array.isArray(part);
    if (
      !array && Object.getPrototypeOf(part) !== Object.prototype &&
      Object.getPrototypeOf(part) !== null
    ) {
      throw new Error('table page readback must contain plain data objects');
    }
    const keys = Reflect.ownKeys(part).filter((key) =>
      !array || key !== 'length'
    );
    if (
      keys.length > 10_000 ||
      (array && (part.length > 10_000 || keys.length !== part.length))
    ) {
      throw new Error('table page readback exceeds its list budget');
    }
    const copy: Record<string, unknown> | unknown[] = array
      ? []
      : Object.create(null);
    for (const [index, key] of keys.entries()) {
      if (typeof key !== 'string' || (array && key !== String(index))) {
        throw new Error('table page readback must contain canonical JSON keys');
      }
      const property = Object.getOwnPropertyDescriptor(part, key);
      if (!property || !Object.hasOwn(property, 'value')) {
        throw new Error(
          'table page readback must contain data properties only',
        );
      }
      bytes += encoder.encode(key).length;
      if (bytes > 2 * 1024 * 1024) {
        throw new Error('table page readback exceeds its byte budget');
      }
      (copy as Record<string, unknown>)[key] = visit(property.value, depth + 1);
    }
    path.delete(part);
    return Object.freeze(copy);
  };
  return visit(value, 0);
}

export async function projectECOSManifestTableRecords(
  rawPage: unknown,
  boundManifest: ECOSBoundTableSourceManifest,
  pageNumber: number,
): Promise<Readonly<ECOSStoredTableRecords>> {
  assertECOSBoundTableSourceManifest(boundManifest);
  integer(
    pageNumber,
    1,
    boundManifest.accountability.expectedItemCount,
    'requested page',
  );
  const item = boundManifest.items[pageNumber - 1];
  if (!item.reported || !item.projectionId || !item.projectionSha256) {
    throw new Error('missing table page has no stored payload');
  }
  const page = dataObject(snapshotPageData(rawPage), [
    'schema_version',
    'publication_mode',
    'manifest_id',
    'manifest_sha256',
    'item_key',
    'result_sha256',
    'stored_page',
  ], 'manifest table page');
  const scope = {
    schema_version: ECOS_MANIFEST_TABLE_PAGE_SCHEMA_VERSION,
    publication_mode: 'shadow',
    manifest_id: boundManifest.manifestId,
    manifest_sha256: boundManifest.manifestSha256,
    item_key: item.itemKey,
    result_sha256: item.resultSha256,
  };
  if (Object.entries(scope).some(([key, value]) => page[key] !== value)) {
    throw new Error(
      'table page readback does not match the bound manifest item',
    );
  }
  const source = boundManifest.accountability;
  const records = await projectECOSStoredTableRecords(page.stored_page, {
    jobId: boundManifest.jobId,
    organizationId: source.organizationId,
    projectId: source.projectId,
    sourceId: source.sourceId,
    sourceSha256: source.sourceSha256,
    sourceRevision: source.sourceRevision,
    sourcePageCount: source.expectedItemCount,
    pageNumber,
    extractionVersion: ECOS_NATIVE_TABLE_EXTRACTION_VERSION,
    sourceKind: 'other',
    manifestId: boundManifest.manifestId,
    snapshotId: source.snapshotId,
    projectionId: item.projectionId,
    projectionSha256: item.projectionSha256,
  });
  if (
    records.projection.source.state !== item.state ||
    records.projection.source.nativeTables.length !== item.evidenceRecordCount
  ) {
    throw new Error(
      'stored table page state or raw table count differs from its manifest item',
    );
  }
  projectedPages.set(records, { manifest: boundManifest, pageNumber });
  return records;
}
