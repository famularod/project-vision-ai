export const ECOS_PROJECT_RECORD_INVENTORY_SCHEMA_VERSION =
  'ecos-project-record-inventory/2.0' as const;
const SCOPE = 'exact_project_operational_records_only' as const;
const MAX_RECORD_BYTES = 256 * 1024;
const MAX_PAGE_BYTES = 10 * 1024 * 1024;
const MAX_RAW_BYTES = 32 * 1024 * 1024;
const MAX_WIRE_BYTES = 72 * 1024 * 1024;
const encoder = new TextEncoder();
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;

export type ECOSProjectRecordSourceKind = 'schedule_item' | 'field_note';
export interface ECOSProjectRecordInventoryRow {
  source_key: string;
  source_kind: ECOSProjectRecordSourceKind;
  source_id: string;
  source_sha256: string;
  record_json: string;
  disposition: 'recorded' | 'needs_review' | 'deleted_conflict';
  limitations: readonly string[];
}
interface InventoryScope {
  schema_version: typeof ECOS_PROJECT_RECORD_INVENTORY_SCHEMA_VERSION;
  publication_mode: 'shadow';
  scope: typeof SCOPE;
  organization_id: string;
  project_id: string;
  owner_id: string;
  epoch_sha256: string;
  total_count: number;
}
export interface ECOSBoundProjectRecordInventoryPage extends InventoryScope {
  after_source_key: string | null;
  rows: readonly Readonly<ECOSProjectRecordInventoryRow>[];
  next_source_key: string | null;
}
interface Coverage {
  documents: 'not_assessed';
  project_updates: 'not_assessed';
  photos: 'not_assessed';
  legacy_name_scope: 'not_assessed';
  local_unsynced_records: 'not_assessed';
  verification: 'record_content_only_requires_assurance';
}
export interface ECOSProjectRecordInventory extends InventoryScope, Coverage {
  rows: readonly Readonly<ECOSProjectRecordInventoryRow>[];
}
export interface ECOSExpectedProjectRecordInventoryPage {
  organizationId: string;
  projectId: string;
  ownerId: string;
  epochSha256: string | null;
  afterSourceKey: string | null;
  pageLimit: number;
}
export interface ECOSProjectRecordObservation {
  source_key: string;
  source_kind: ECOSProjectRecordSourceKind;
  source_id: string;
  source_sha256: string;
  pointer: string;
  value: string | number | boolean;
  meaning: 'recorded_value_not_site_verification';
}
export interface ECOSProjectRecordObservations extends Coverage {
  schema_version: 'ecos-project-record-observations/2.0';
  publication_mode: 'shadow';
  scope: typeof SCOPE;
  organization_id: string;
  project_id: string;
  owner_id: string;
  epoch_sha256: string;
  extraction_coverage: 'supported_field_projection_only';
  observations: readonly Readonly<ECOSProjectRecordObservation>[];
}
const coverage: Coverage = Object.freeze({
  documents: 'not_assessed',
  project_updates: 'not_assessed',
  photos: 'not_assessed',
  legacy_name_scope: 'not_assessed',
  local_unsynced_records: 'not_assessed',
  verification: 'record_content_only_requires_assurance',
});
const pageOrigins = new WeakMap<
  object,
  Readonly<ECOSExpectedProjectRecordInventoryPage>
>();
const inventories = new WeakSet<object>();
const rowContent = new WeakMap<
  object,
  { record: Record<string, unknown>; numberTokens: ReadonlyMap<string, string> }
>();
const PAGE_KEYS = [
  'schema_version',
  'publication_mode',
  'scope',
  'organization_id',
  'project_id',
  'owner_id',
  'epoch_sha256',
  'total_count',
  'after_source_key',
  'rows',
  'next_source_key',
] as const;
const ROW_KEYS = [
  'source_key',
  'source_kind',
  'source_id',
  'source_sha256',
  'record_json',
  'disposition',
  'limitations',
] as const;
const EXPECTED_KEYS = [
  'organizationId',
  'projectId',
  'ownerId',
  'epochSha256',
  'afterSourceKey',
  'pageLimit',
] as const;
const TASK_POINTERS = [
  '/task_name',
  '/item_data/status',
  '/item_data/percentComplete',
  '/item_data/locationName',
  '/item_data/startDate',
  '/item_data/finishDate',
  '/item_data/notes',
  '/item_data/itemType',
  '/item_data/completionVerification',
  '/item_data/completionVerification/status',
] as const;
const NOTE_POINTERS = [
  '/original_text',
  '/status',
  '/action_kind',
  '/action_text',
  '/location_name',
] as const;
const SCALAR_POINTERS = new Set<string>([
  ...TASK_POINTERS,
  ...NOTE_POINTERS,
  '/revision',
]);

function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null);
}
function object(value: unknown, keys: readonly string[], field: string) {
  if (!plain(value)) throw new Error(`${field} must be a plain data object`);
  const names = Reflect.ownKeys(value);
  if (
    names.length !== keys.length ||
    names.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) throw new Error(`${field} has missing or unsupported fields`);
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
    !Array.isArray(value) || value.length > maximum ||
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
function validUnicode(value: string) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function text(value: unknown, maximum: number, field: string) {
  if (
    typeof value !== 'string' || !value || value.length > maximum ||
    value.trim() !== value || [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    }) ||
    !validUnicode(value) || encoder.encode(value).length > maximum
  ) {
    throw new Error(`${field} must be exact bounded UTF-8 text`);
  }
  return value;
}
function pin(value: unknown, field: string, uuid = false) {
  if (typeof value !== 'string' || !(uuid ? UUID : SHA).test(value)) {
    throw new Error(
      `${field} must be a canonical ${uuid ? 'UUID' : 'SHA-256'}`,
    );
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
function sourceKey(value: unknown, field: string) {
  const key = text(value, 314, field);
  const prefix = key.startsWith('schedule_item:')
    ? 'schedule_item:'
    : key.startsWith('field_note:')
    ? 'field_note:'
    : null;
  if (!prefix) throw new Error(`${field} has an unsupported source kind`);
  text(key.slice(prefix.length), 300, `${field} source ID`);
  return key;
}
/** PostgreSQL UTF-8 COLLATE C order, including supplementary codepoints. */
function compare(left: string, right: string) {
  const a = encoder.encode(left), b = encoder.encode(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}
function bytes(value: unknown) {
  return encoder.encode(JSON.stringify(value)).length;
}
function freezeJSON(value: unknown) {
  const queue: unknown[] = [value];
  while (queue.length) {
    const item = queue.pop();
    if (
      typeof item === 'string' &&
      (!validUnicode(item) || item.includes('\u0000'))
    ) {
      throw new Error(
        'raw operational JSON contains unsupported decoded Unicode',
      );
    }
    if (item !== null && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) queue.push(key, child);
      Object.freeze(item);
    }
  }
}

/**
 * JSON.parse alone can round 1.0000000000000001 to integer 1. Keep original
 * number tokens for supported pointers and reject duplicate object members;
 * neither the raw string nor its hash is regenerated from JavaScript values.
 */
function inspectJSON(raw: string): Map<string, string> {
  let position = 0;
  const numbers = new Map<string, string>();
  const space = () => {
    while (/[\x20\t\r\n]/.test(raw[position] ?? '') && position < raw.length) {
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
    throw new Error('record JSON string is incomplete');
  };
  function value(path: string, depth: number) {
    if (depth > 128) throw new Error('record JSON exceeds its nesting bound');
    space();
    const opening = raw[position];
    if (opening === '{' || opening === '[') {
      position++;
      const closing = opening === '{' ? '}' : ']';
      const keys = new Set<string>();
      let index = 0;
      space();
      while (raw[position] !== closing) {
        let key = String(index++);
        if (opening === '{') {
          key = string();
          if (keys.has(key)) {
            throw new Error('record JSON has duplicate object members');
          }
          keys.add(key);
          space();
          position++;
        }
        value(
          `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
          depth + 1,
        );
        space();
        if (raw[position] === closing) break;
        position++;
        space();
      }
      position++;
    } else if (opening === '"') string();
    else {
      const start = position;
      while (position < raw.length && !/[\x20\t\r\n,}\]]/.test(raw[position])) {
        position++;
      }
      const token = raw.slice(start, position);
      if (/^-?\d/.test(token) && SCALAR_POINTERS.has(path)) {
        numbers.set(path, token);
      }
    }
  }
  value('', 0);
  return numbers;
}

function copiedRow(value: unknown): Readonly<ECOSProjectRecordInventoryRow> {
  const raw = object(value, ROW_KEYS, 'operational row');
  const source_id = text(raw.source_id, 300, 'source ID');
  if (raw.source_kind !== 'schedule_item' && raw.source_kind !== 'field_note') {
    throw new Error('operational source kind is unsupported');
  }
  const source_kind = raw.source_kind;
  const source_key = sourceKey(raw.source_key, 'source key');
  if (source_key !== `${source_kind}:${source_id}`) {
    throw new Error('source key identity mismatch');
  }
  const source_sha256 = pin(raw.source_sha256, 'raw record hash');
  const record_json = raw.record_json;
  if (
    typeof record_json !== 'string' || !record_json ||
    record_json.length > MAX_RECORD_BYTES || !validUnicode(record_json) ||
    encoder.encode(record_json).length > MAX_RECORD_BYTES
  ) {
    throw new Error('record JSON exceeds its exact UTF-8 byte bound');
  }
  const limitations = array(raw.limitations, 16, 'operational limitations').map(
    (code) => {
      if (
        typeof code !== 'string' || code.length > 80 ||
        !/^[a-z][a-z0-9_]*$/.test(code)
      ) {
        throw new Error(
          'operational limitation must be a bounded lowercase code',
        );
      }
      return code;
    },
  );
  if (
    limitations.some((code, index) =>
      index > 0 && limitations[index - 1] >= code
    )
  ) {
    throw new Error('operational limitations must be sorted and unique');
  }
  const disposition = limitations.includes('source_deleted_tombstone')
    ? 'deleted_conflict'
    : limitations.length
    ? 'needs_review'
    : 'recorded';
  if (raw.disposition !== disposition) {
    throw new Error('operational disposition contradicts limitations');
  }
  return Object.freeze({
    source_key,
    source_kind,
    source_id,
    source_sha256,
    record_json,
    disposition,
    limitations: Object.freeze(limitations),
  });
}

async function verifyRow(
  row: Readonly<ECOSProjectRecordInventoryRow>,
  scope: InventoryScope,
) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(row.record_json),
  );
  const actual = [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  if (actual !== row.source_sha256) {
    throw new Error('raw operational record hash mismatch');
  }
  let record: unknown;
  try {
    record = JSON.parse(row.record_json);
  } catch {
    throw new Error('raw operational record JSON is invalid');
  }
  if (!plain(record)) {
    throw new Error('raw operational record must be a plain object');
  }
  if (
    record.id !== row.source_id || record.owner_id !== scope.owner_id ||
    record.project_id !== scope.project_id
  ) throw new Error('raw operational record scope mismatch');
  for (const key of ['organizationId', 'organization_id']) {
    if (Object.hasOwn(record, key) && record[key] !== scope.organization_id) {
      throw new Error('raw operational organization scope mismatch');
    }
  }
  const numberTokens = inspectJSON(row.record_json);
  const gap = (invalid: boolean, code: string) => {
    if (invalid && !row.limitations.includes(code)) {
      throw new Error(
        `operational source metadata requires limitation ${code}`,
      );
    }
  };
  if (row.source_kind === 'schedule_item') {
    const item = record.item_data;
    if (
      plain(item) && Object.hasOwn(item, 'organizationId') &&
      item.organizationId !== scope.organization_id
    ) throw new Error('embedded operational organization scope mismatch');
    gap(!plain(item), 'task_data_invalid');
    if (plain(item)) {
      gap(item.id == null, 'task_identity_missing');
      gap(
        item.id != null && item.id !== row.source_id,
        'task_identity_conflict',
      );
      gap(item.projectId == null, 'task_project_identity_missing');
      gap(
        item.projectId != null && item.projectId !== scope.project_id,
        'task_project_identity_conflict',
      );
      gap(
        Object.hasOwn(item, 'ownerId') && item.ownerId !== scope.owner_id,
        'task_owner_identity_conflict',
      );
    }
  } else {
    // Match persisted Field Note semantics, not a claim that its observation is true.
    const boundedNote = (value: unknown, limit: number) =>
      typeof value === 'string' &&
      [...value.replace(/^ +| +$/g, '')].length >= 1 &&
      [...value].length <= limit;
    const status = record.status, action = record.action_kind;
    const lifecycle = (status === 'open' && record.resolved_at == null &&
      record.archived_at == null) ||
      (status === 'resolved' && record.resolved_at != null &&
        record.archived_at == null) ||
      (status === 'archived' && record.archived_at != null &&
        record.resolved_at == null);
    gap(!boundedNote(record.original_text, 10_000), 'field_note_text_invalid');
    gap(
      !['typed', 'voice'].includes(record.source as string),
      'field_note_source_invalid',
    );
    gap(
      !['open', 'resolved', 'archived'].includes(status as string),
      'field_note_status_invalid',
    );
    gap(
      typeof record.revision !== 'number' ||
        !Number.isSafeInteger(record.revision) ||
        record.revision < 1 ||
        !/^[1-9]\d*$/.test(numberTokens.get('/revision') ?? ''),
      'field_note_revision_invalid',
    );
    gap(
      ![
        'none',
        'follow_up',
        'task_candidate',
        'issue_candidate',
        'safety_candidate',
      ].includes(action as string) ||
        (action === 'none' && record.action_text != null) ||
        (record.action_text != null && !boundedNote(record.action_text, 2000)),
      'field_note_action_invalid',
    );
    gap(
      record.created_at == null || record.updated_at == null || !lifecycle,
      'field_note_lifecycle_invalid',
    );
  }
  freezeJSON(record);
  rowContent.set(row, { record, numberTokens });
}

/** Scope is independently authorized by the caller. This boundary does no RPC or authentication. */
export async function bindECOSProjectRecordInventoryPage(
  rawPage: unknown,
  expectedInput: ECOSExpectedProjectRecordInventoryPage,
): Promise<Readonly<ECOSBoundProjectRecordInventoryPage>> {
  const input = object(
    expectedInput,
    EXPECTED_KEYS,
    'expected operational scope',
  );
  const expected = Object.freeze({
    organizationId: text(input.organizationId, 500, 'organization ID'),
    projectId: pin(input.projectId, 'project ID', true),
    ownerId: pin(input.ownerId, 'owner ID', true),
    epochSha256: input.epochSha256 === null
      ? null
      : pin(input.epochSha256, 'expected epoch'),
    afterSourceKey: input.afterSourceKey === null
      ? null
      : sourceKey(input.afterSourceKey, 'expected cursor'),
    pageLimit: integer(input.pageLimit, 1, 16, 'page limit'),
  });
  if (expected.afterSourceKey !== null && expected.epochSha256 === null) {
    throw new Error('continuation pages require an independently pinned epoch');
  }
  const raw = object(rawPage, PAGE_KEYS, 'operational inventory page');
  const scope = Object.freeze({
    schema_version: ECOS_PROJECT_RECORD_INVENTORY_SCHEMA_VERSION,
    publication_mode: 'shadow' as const,
    scope: SCOPE,
    organization_id: expected.organizationId,
    project_id: expected.projectId,
    owner_id: expected.ownerId,
  });
  if (Object.entries(scope).some(([key, value]) => raw[key] !== value)) {
    throw new Error('operational page scope mismatch');
  }
  const epoch_sha256 = pin(raw.epoch_sha256, 'operational epoch');
  if (expected.epochSha256 !== null && epoch_sha256 !== expected.epochSha256) {
    throw new Error('operational epoch changed');
  }
  if (raw.after_source_key !== expected.afterSourceKey) {
    throw new Error('operational request cursor mismatch');
  }
  const total_count = integer(
    raw.total_count,
    0,
    1000,
    'operational total count',
  );
  // Copy every input field before the first digest await; caller mutations cannot change this page.
  const rows = array(raw.rows, expected.pageLimit, 'operational rows').map(
    copiedRow,
  );
  if (
    rows.length > total_count ||
    (expected.afterSourceKey === null &&
      rows.length !== Math.min(expected.pageLimit, total_count)) ||
    (expected.afterSourceKey !== null && rows.length === 0)
  ) throw new Error('operational page row count mismatch');
  let previous = expected.afterSourceKey;
  for (const row of rows) {
    if (previous !== null && compare(previous, row.source_key) >= 0) {
      throw new Error(
        'operational rows must be strictly UTF-8 ordered after cursor',
      );
    }
    previous = row.source_key;
  }
  const next_source_key = raw.next_source_key === null
    ? null
    : sourceKey(raw.next_source_key, 'next cursor');
  if (
    next_source_key !== null && (rows.length !== expected.pageLimit ||
      next_source_key !== rows.at(-1)?.source_key)
  ) throw new Error('operational next cursor must equal last full-page row');
  if (
    expected.afterSourceKey === null && next_source_key !==
      (rows.length < total_count ? rows.at(-1)!.source_key : null)
  ) throw new Error('operational continuation contradicts total count');
  const page = Object.freeze({
    ...scope,
    epoch_sha256,
    total_count,
    after_source_key: expected.afterSourceKey,
    rows: Object.freeze(rows),
    next_source_key,
  });
  if (bytes(page) > MAX_PAGE_BYTES) {
    throw new Error('operational page exceeds its wire byte budget');
  }
  for (const row of rows) await verifyRow(row, page);
  pageOrigins.set(page, expected);
  return page;
}

export function assertECOSBoundProjectRecordInventoryPage(
  value: unknown,
): asserts value is ECOSBoundProjectRecordInventoryPage {
  if (!value || typeof value !== 'object' || !pageOrigins.has(value)) {
    throw new Error('operational page must originate from exact binding');
  }
}
export function assembleECOSProjectRecordInventory(
  inputPages: readonly ECOSBoundProjectRecordInventoryPage[],
): Readonly<ECOSProjectRecordInventory> {
  const pages = array(inputPages, 1000, 'operational pages');
  if (!pages.length) {
    throw new Error(
      'complete operational inventory requires a first page even when empty',
    );
  }
  let first: ECOSBoundProjectRecordInventoryPage | undefined;
  let cursor: string | null = null, rawBytes = 0, wireBytes = 0;
  const rows: Readonly<ECOSProjectRecordInventoryRow>[] = [];
  for (const value of pages) {
    assertECOSBoundProjectRecordInventoryPage(value);
    const page = value, expected = pageOrigins.get(page)!;
    if (first && cursor === null) {
      throw new Error('operational pages continue after terminal page');
    }
    first ??= page;
    if (
      page.organization_id !== first.organization_id ||
      page.project_id !== first.project_id ||
      page.owner_id !== first.owner_id ||
      page.epoch_sha256 !== first.epoch_sha256 ||
      page.total_count !== first.total_count
    ) throw new Error('operational pages mix scope epoch or count');
    if (
      page.after_source_key !== cursor || expected.afterSourceKey !== cursor ||
      (cursor !== null && expected.epochSha256 !== first.epoch_sha256)
    ) throw new Error('operational cursor chain has a gap or duplicate');
    const remaining = first.total_count - rows.length;
    if (page.rows.length !== Math.min(expected.pageLimit, remaining)) {
      throw new Error('operational page omits expected rows');
    }
    if (
      page.next_source_key !==
        (page.rows.length < remaining ? page.rows.at(-1)!.source_key : null)
    ) {
      throw new Error(
        'operational continuation hides or invents remaining rows',
      );
    }
    if (
      rows.length && page.rows.length &&
      compare(rows.at(-1)!.source_key, page.rows[0].source_key) >= 0
    ) {
      throw new Error('operational source keys overlap');
    }
    for (const row of page.rows) {
      rawBytes += encoder.encode(row.record_json).length;
    }
    wireBytes += bytes(page);
    if (rawBytes > MAX_RAW_BYTES || wireBytes > MAX_WIRE_BYTES) {
      throw new Error('operational inventory exceeds its retained byte budget');
    }
    rows.push(...page.rows);
    cursor = page.next_source_key;
  }
  if (cursor !== null || rows.length !== first!.total_count) {
    throw new Error('operational inventory is incomplete');
  }
  const {
    after_source_key: _after,
    next_source_key: _next,
    rows: _rows,
    ...scope
  } = first!;
  const inventory = Object.freeze({
    ...scope,
    ...coverage,
    rows: Object.freeze(rows),
  });
  inventories.add(inventory);
  return inventory;
}
export function assertECOSProjectRecordInventory(
  value: unknown,
): asserts value is ECOSProjectRecordInventory {
  if (!value || typeof value !== 'object' || !inventories.has(value)) {
    throw new Error(
      'operational inventory must originate from complete bound pages',
    );
  }
}

/** Supported field values only. Status is never converted into progress or physical truth. */
export function buildECOSProjectRecordObservations(
  inventory: ECOSProjectRecordInventory,
): Readonly<ECOSProjectRecordObservations> {
  assertECOSProjectRecordInventory(inventory);
  const observations: Readonly<ECOSProjectRecordObservation>[] = [];
  for (const row of inventory.rows) {
    if (row.disposition !== 'recorded') continue;
    const { record, numberTokens } = rowContent.get(row)!;
    const pointers = row.source_kind === 'schedule_item'
      ? TASK_POINTERS
      : NOTE_POINTERS;
    for (const pointer of pointers) {
      let value: unknown = record;
      for (const key of pointer.slice(1).split('/')) {
        value = plain(value) && Object.hasOwn(value, key)
          ? value[key]
          : undefined;
      }
      if (typeof value === 'number') {
        const token = numberTokens.get(pointer);
        if (
          !Number.isSafeInteger(value) || !token ||
          !/^-?(?:0|[1-9]\d*)$/.test(token)
        ) continue;
      } else if (typeof value !== 'string' && typeof value !== 'boolean') {
        continue;
      }
      if (typeof value === 'string' && !value.trim()) continue;
      if (
        pointer === '/item_data/percentComplete' &&
        (typeof value !== 'number' || value < 0 || value > 100)
      ) continue;
      observations.push(
        Object.freeze({
          source_key: row.source_key,
          source_kind: row.source_kind,
          source_id: row.source_id,
          source_sha256: row.source_sha256,
          pointer,
          value,
          meaning: 'recorded_value_not_site_verification',
        }),
      );
    }
  }
  return Object.freeze({
    schema_version: 'ecos-project-record-observations/2.0',
    publication_mode: 'shadow',
    scope: SCOPE,
    organization_id: inventory.organization_id,
    project_id: inventory.project_id,
    owner_id: inventory.owner_id,
    epoch_sha256: inventory.epoch_sha256,
    ...coverage,
    extraction_coverage: 'supported_field_projection_only',
    observations: Object.freeze(observations),
  });
}
