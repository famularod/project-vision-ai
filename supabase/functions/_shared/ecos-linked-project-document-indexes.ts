import {
  assertECOSLinkedProjectDocumentInventory,
  bindECOSLinkedProjectDocumentInventoryPage,
  buildECOSLinkedProjectDocumentPlan,
  type ECOSBoundLinkedProjectDocumentInventoryPage,
  type ECOSLinkedProjectDocumentInventory,
} from './ecos-linked-project-document-inventory.ts';
import {
  bindECOSTableSourceManifest,
  type ECOSBoundTableSourceManifest,
} from './ecos-table-source-manifest.ts';
import {
  bindECOSLinkedDocumentManifest,
  type ECOSLinkedDocumentManifest,
} from './ecos-linked-document-manifest.ts';
import type { ECOSProjectDocumentInventoryRow } from './ecos-project-document-inventory.ts';

const SCHEMA = 'ecos-linked-project-document-indexes/2.0' as const;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_BYTES = 16 * 1024 * 1024;
const encoder = new TextEncoder();
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const STATES = [
  'inventory_gap',
  'job_missing',
  'job_stale',
  'job_ambiguous',
  'project_scope_mismatch',
  'job_in_progress',
  'job_unavailable',
  'manifest_missing',
  'manifest_stale',
  'manifest_current',
] as const;
export type ECOSLinkedProjectDocumentIndexState = typeof STATES[number];
export interface ECOSLinkedProjectDocumentIndexJob {
  job_id: string;
  state: string;
  source_sha256: string;
  source_revision: string | null;
  source_page_count: number;
  target_evidence_version: string;
}
export interface ECOSLinkedProjectDocumentIndexResolution {
  source_id: string;
  state: ECOSLinkedProjectDocumentIndexState;
  job: Readonly<ECOSLinkedProjectDocumentIndexJob> | null;
  manifest: Readonly<ECOSBoundTableSourceManifest> | null;
  linked_manifest: Readonly<ECOSLinkedDocumentManifest> | null;
}
export interface ECOSBoundLinkedProjectDocumentIndexesPage {
  schema_version: typeof SCHEMA;
  publication_mode: 'shadow';
  inventory_page: Readonly<ECOSBoundLinkedProjectDocumentInventoryPage>;
  resolutions: readonly Readonly<ECOSLinkedProjectDocumentIndexResolution>[];
  retrieval_authorized: false;
}
export interface ECOSLinkedProjectDocumentIndexes {
  schema_version: typeof SCHEMA;
  publication_mode: 'shadow';
  organization_id: string;
  owner_id: string;
  project_id: string;
  inventory_epoch_sha256: string;
  total_count: number;
  resolutions: readonly Readonly<ECOSLinkedProjectDocumentIndexResolution>[];
  retrieval_authorized: false;
  answer_readiness: 'not_assessed';
  whole_project_completeness: 'not_assessed';
  currentness: 'page_readbacks_only';
}
export interface ECOSExpectedLinkedProjectDocumentIndexesPage {
  afterSourceId: string | null;
  pageLimit: number;
}
const pageOrigins = new WeakMap<
  object,
  {
    inventory: ECOSLinkedProjectDocumentInventory;
    after: string | null;
    limit: number;
  }
>();
const origins = new WeakMap<object, ECOSLinkedProjectDocumentInventory>();
function object(value: unknown, keys: readonly string[], field: string) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) throw new Error(`${field} must be plain data`);
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) throw new Error(`${field} has missing or unsupported fields`);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !Object.hasOwn(property, 'value')) {
      throw new Error(`${field} must contain data properties only`);
    }
    result[key] = property.value;
  }
  return result;
}
function array(value: unknown, max: number, field: string): unknown[] {
  if (
    !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) throw new Error(`${field} must be a bounded dense data array`);
  return Array.from({ length: value.length }, (_, index) => {
    const prop = Object.getOwnPropertyDescriptor(value, String(index));
    if (!prop?.enumerable || !Object.hasOwn(prop, 'value')) {
      throw new Error(`${field} must contain data properties only`);
    }
    return prop.value;
  });
}
function size(value: unknown) {
  return encoder.encode(JSON.stringify(value)).length;
}
function budget(value: unknown, max: number) {
  if (size(value) > max) {
    throw new Error('Index resolution exceeds retained byte budget');
  }
}
/** Copy all data before receipt awaits. In addition to 2 MiB per page, this
 * boundary caps nesting at 16, total visited values at 200,000, object fields
 * at 64, and each array at 10,000. Exceeding any cap rejects the whole page. */
function snapshot(value: unknown): unknown {
  let nodes = 0, bytes = 0;
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > 200_000 || depth > 16) {
      throw new Error('Index resolution exceeds structural bounds');
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) {
        throw new Error('Index resolution must use safe integers');
      }
      return value;
    }
    if (typeof value === 'string') {
      if (value.length > MAX_PAGE_BYTES || /[\ud800-\udfff]/u.test(value)) {
        throw new Error('Invalid index resolution text');
      }
      bytes += encoder.encode(value).length;
      if (bytes > MAX_PAGE_BYTES) {
        throw new Error('Index resolution exceeds retained byte budget');
      }
      return value;
    }
    if (Array.isArray(value)) {
      return Object.freeze(
        array(value, 10_000, 'Index resolution array').map((item) =>
          visit(item, depth + 1)
        ),
      );
    }
    if (!value || typeof value !== 'object') {
      throw new Error('Index resolution must contain only JSON data');
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length > 64 ||
      keys.some((key) =>
        typeof key !== 'string' || key === '__proto__' ||
        key === 'constructor' || key === 'prototype'
      )
    ) throw new Error('Invalid index resolution object members');
    const raw = object(value, keys as string[], 'Index resolution object');
    const copied: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(raw)) {
      copied[key] = visit(item, depth + 1);
    }
    return Object.freeze(copied);
  }
  const copied = visit(value, 0);
  budget(copied, MAX_PAGE_BYTES);
  return copied;
}
function pin(value: unknown, field: string, uuid = false) {
  if (typeof value !== 'string' || !(uuid ? UUID : SHA).test(value)) {
    throw new Error(`${field} must be canonical`);
  }
  return value;
}
function text(value: unknown, max: number, field: string) {
  if (
    typeof value !== 'string' || !value || value.trim() !== value ||
    encoder.encode(value).length > max ||
    [...value].some((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 || (code >= 127 && code <= 159) ||
        (code >= 0xd800 && code <= 0xdfff);
    })
  ) throw new Error(`${field} must be exact bounded UTF-8`);
  return value;
}
function integer(value: unknown, min: number, max: number, field: string) {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) || value < min ||
    value > max
  ) throw new Error(`${field} exceeds integer bound`);
  return value;
}
const JOB_STATES = [
  'queued',
  'fetching_source',
  'extracting',
  'mapping',
  'awaiting_visual',
  'assuring',
  'ready',
  'needs_review',
  'reconnect_source',
  'temporarily_unavailable',
  'failed_internal',
  'cancelled',
];
function bindJob(value: unknown): Readonly<ECOSLinkedProjectDocumentIndexJob> {
  const raw = object(value, [
    'job_id',
    'state',
    'source_sha256',
    'source_revision',
    'source_page_count',
    'target_evidence_version',
  ], 'Resolved index job');
  if (
    typeof raw.state !== 'string' || !JOB_STATES.includes(raw.state) ||
    raw.target_evidence_version !== 'ecos-hosted-evidence/1.3'
  ) throw new Error('Resolved index job state or evidence version mismatch');
  return Object.freeze({
    job_id: pin(raw.job_id, 'Job ID', true),
    state: raw.state,
    source_sha256: pin(raw.source_sha256, 'Job source hash'),
    source_revision: raw.source_revision === null
      ? null
      : text(raw.source_revision, 300, 'Job source revision'),
    source_page_count: integer(
      raw.source_page_count,
      1,
      10_000,
      'Job page count',
    ),
    target_evidence_version: raw.target_evidence_version,
  });
}
function validateState(
  state: ECOSLinkedProjectDocumentIndexState,
  job: Readonly<ECOSLinkedProjectDocumentIndexJob> | null,
  manifest: unknown,
  registry: Readonly<ECOSProjectDocumentInventoryRow> | null,
) {
  const noJob = [
    'inventory_gap',
    'job_missing',
    'job_stale',
    'job_ambiguous',
    'project_scope_mismatch',
  ].includes(state);
  if (
    (job === null) !== noJob ||
    (manifest !== null) !== (state === 'manifest_current')
  ) {
    throw new Error(
      'Index-resolution state contradicts job or manifest presence',
    );
  }
  if (job === null) return;
  if (
    registry === null || job.source_sha256 !== registry.source_sha256 ||
    job.source_revision !== registry.source_revision ||
    job.source_page_count !== registry.source_page_count
  ) throw new Error('Resolved job differs from exact inventoried source pins');
  // Active claim/lease metadata remains private in the database. Any job state
  // may be in progress while claimed; only the fixed unavailable states may
  // be reported unavailable, and manifest lookups require ready/needs_review.
  if (
    state === 'job_unavailable' &&
    ![
      'reconnect_source',
      'temporarily_unavailable',
      'failed_internal',
      'cancelled',
    ].includes(job.state)
  ) throw new Error('Unavailable job contradicts its reported state');
  if (
    state.startsWith('manifest_') &&
    !['ready', 'needs_review'].includes(job.state)
  ) throw new Error('Manifest resolution requires eligible job state');
}

export async function bindECOSLinkedProjectDocumentIndexesPage(
  rawPage: unknown,
  inventory: Readonly<ECOSLinkedProjectDocumentInventory>,
  input: ECOSExpectedLinkedProjectDocumentIndexesPage,
): Promise<Readonly<ECOSBoundLinkedProjectDocumentIndexesPage>> {
  assertECOSLinkedProjectDocumentInventory(inventory);
  const expected = object(
    input,
    ['afterSourceId', 'pageLimit'],
    'Expected index-resolution page',
  );
  const limit = integer(
    expected.pageLimit,
    1,
    25,
    'Index-resolution page limit',
  );
  const after = expected.afterSourceId === null
    ? null
    : text(expected.afterSourceId, 300, 'Index-resolution cursor');
  const offset = after === null
    ? 0
    : inventory.rows.findIndex((row) => row.source_id === after) + 1;
  if (after !== null && offset === 0) {
    throw new Error('Index-resolution cursor is not in complete inventory');
  }
  const selected = inventory.rows.slice(offset, offset + limit);
  const raw = object(snapshot(rawPage), [
    'schema_version',
    'publication_mode',
    'inventory_page',
    'resolutions',
    'retrieval_authorized',
  ], 'Index-resolution page');
  if (
    raw.schema_version !== SCHEMA || raw.publication_mode !== 'shadow' ||
    raw.retrieval_authorized !== false
  ) throw new Error('Index-resolution protocol or authority mismatch');
  const resolutionRows = array(
    raw.resolutions,
    limit,
    'Source index resolutions',
  );
  const inventory_page = await bindECOSLinkedProjectDocumentInventoryPage(
    raw.inventory_page,
    {
      organizationId: inventory.organization_id,
      ownerId: inventory.owner_id,
      projectId: inventory.project_id,
      epochSha256: inventory.epoch_sha256,
      afterSourceId: after,
      pageLimit: limit,
    },
  );
  if (
    inventory_page.total_count !== inventory.total_count ||
    JSON.stringify(inventory_page.rows) !== JSON.stringify(selected) ||
    inventory_page.next_source_id !==
      (offset + selected.length < inventory.rows.length
        ? selected.at(-1)!.source_id
        : null) ||
    resolutionRows.length !== selected.length
  ) {
    throw new Error(
      'Index-resolution page differs from exact complete inventory subset',
    );
  }
  const plan = buildECOSLinkedProjectDocumentPlan(inventory);
  const resolutions: Readonly<ECOSLinkedProjectDocumentIndexResolution>[] = [];
  for (let index = 0; index < selected.length; index++) {
    const source = selected[index],
      row = object(resolutionRows[index], [
        'source_id',
        'state',
        'job',
        'manifest',
      ], 'Source index resolution');
    if (
      row.source_id !== source.source_id ||
      !STATES.includes(row.state as ECOSLinkedProjectDocumentIndexState)
    ) throw new Error('Index-resolution identity, order or state mismatch');
    const state = row.state as ECOSLinkedProjectDocumentIndexState;
    const eligible =
      plan.items[offset + index].next_step === 'needs_index_resolution';
    if ((state === 'inventory_gap') !== !eligible) {
      throw new Error(
        'Index resolution contradicts retained inventory eligibility',
      );
    }
    // Job-state and manifest presence checks are deliberately independent of
    // native-table coverage; a current partial manifest is never an answer.
    const job = row.job === null ? null : bindJob(row.job);
    let manifest: Readonly<ECOSBoundTableSourceManifest> | null = null;
    let linked_manifest: Readonly<ECOSLinkedDocumentManifest> | null = null;
    validateState(state, job, row.manifest, source.registry_row);
    if (state === 'manifest_current') {
      const rawManifest = row.manifest as Record<string, unknown>;
      // Manifest ID/hash are pins from this service readback, not independently
      // selected external pins. Exact job/source/scope come from separate fields
      // and the original privately bound inventory; the DB validates currentness.
      manifest = bindECOSTableSourceManifest(rawManifest, {
        jobId: job!.job_id,
        organizationId: inventory.organization_id,
        projectId: inventory.project_id,
        sourceId: source.source_id,
        sourceSha256: job!.source_sha256,
        sourceRevision: job!.source_revision,
        sourcePageCount: job!.source_page_count,
        manifestId: pin(rawManifest.manifest_id, 'Manifest ID', true),
        manifestSha256: pin(rawManifest.manifest_sha256, 'Manifest hash'),
      });
      linked_manifest = bindECOSLinkedDocumentManifest(
        inventory,
        source.source_id,
        manifest,
      );
    }
    resolutions.push(
      Object.freeze({
        source_id: source.source_id,
        state,
        job,
        manifest,
        linked_manifest,
      }),
    );
  }
  const page = Object.freeze({
    schema_version: SCHEMA,
    publication_mode: 'shadow' as const,
    inventory_page,
    resolutions: Object.freeze(resolutions),
    retrieval_authorized: false as const,
  });
  budget(page, MAX_PAGE_BYTES);
  pageOrigins.set(page, { inventory, after, limit });
  return page;
}

export function assertECOSBoundLinkedProjectDocumentIndexesPage(
  value: unknown,
  inventory: Readonly<ECOSLinkedProjectDocumentInventory>,
): asserts value is ECOSBoundLinkedProjectDocumentIndexesPage {
  assertECOSLinkedProjectDocumentInventory(inventory);
  if (
    !value || typeof value !== 'object' ||
    pageOrigins.get(value)?.inventory !== inventory
  ) {
    throw new Error(
      'Index-resolution page must originate from this exact inventory',
    );
  }
}
export function assembleECOSLinkedProjectDocumentIndexes(
  input: readonly ECOSBoundLinkedProjectDocumentIndexesPage[],
  inventory: Readonly<ECOSLinkedProjectDocumentInventory>,
): Readonly<ECOSLinkedProjectDocumentIndexes> {
  assertECOSLinkedProjectDocumentInventory(inventory);
  const pages = array(input, 600, 'Index-resolution pages');
  if (!pages.length) {
    throw new Error(
      'Index resolution requires first page even for empty inventory',
    );
  }
  const resolutions: Readonly<ECOSLinkedProjectDocumentIndexResolution>[] = [];
  let cursor: string | null = null, retained = 0;
  const jobIds = new Set<string>(), manifestIds = new Set<string>();
  for (const [index, value] of pages.entries()) {
    assertECOSBoundLinkedProjectDocumentIndexesPage(value, inventory);
    const origin = pageOrigins.get(value)!;
    if (
      (index > 0 && cursor === null) || origin.after !== cursor ||
      value.inventory_page.after_source_id !== cursor
    ) throw new Error('Index-resolution page chain has a gap or duplicate');
    const remaining = inventory.total_count - resolutions.length;
    if (value.resolutions.length !== Math.min(origin.limit, remaining)) {
      throw new Error('Index resolution omits remaining inventory sources');
    }
    for (const resolution of value.resolutions) {
      if (
        resolution.source_id !== inventory.rows[resolutions.length].source_id
      ) {
        throw new Error(
          'Index resolution source order differs from complete inventory',
        );
      }
      if (resolution.job !== null) {
        if (jobIds.has(resolution.job.job_id)) {
          throw new Error(
            'Index resolution reuses a job across different sources',
          );
        }
        jobIds.add(resolution.job.job_id);
      }
      if (resolution.manifest !== null) {
        if (manifestIds.has(resolution.manifest.manifestId)) {
          throw new Error(
            'Index resolution reuses a manifest across different sources',
          );
        }
        manifestIds.add(resolution.manifest.manifestId);
      }
      resolutions.push(resolution);
    }
    retained += size(value);
    if (retained > MAX_BYTES) {
      throw new Error('Index resolution exceeds retained byte budget');
    }
    cursor = value.inventory_page.next_source_id;
  }
  if (cursor !== null || resolutions.length !== inventory.total_count) {
    throw new Error('Index-resolution enumeration is incomplete');
  }
  const result = Object.freeze({
    schema_version: SCHEMA,
    publication_mode: 'shadow' as const,
    organization_id: inventory.organization_id,
    owner_id: inventory.owner_id,
    project_id: inventory.project_id,
    inventory_epoch_sha256: inventory.epoch_sha256,
    total_count: inventory.total_count,
    resolutions: Object.freeze(resolutions),
    retrieval_authorized: false as const,
    answer_readiness: 'not_assessed' as const,
    whole_project_completeness: 'not_assessed' as const,
    currentness: 'page_readbacks_only' as const,
  });
  budget(result, MAX_BYTES);
  origins.set(result, inventory);
  return result;
}
export function assertECOSLinkedProjectDocumentIndexes(
  value: unknown,
  inventory: Readonly<ECOSLinkedProjectDocumentInventory>,
): asserts value is ECOSLinkedProjectDocumentIndexes {
  assertECOSLinkedProjectDocumentInventory(inventory);
  if (!value || typeof value !== 'object' || origins.get(value) !== inventory) {
    throw new Error(
      'Index-resolution snapshot must originate from this exact complete inventory',
    );
  }
}
