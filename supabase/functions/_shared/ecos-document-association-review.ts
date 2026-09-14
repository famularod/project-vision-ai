export const ECOS_DOCUMENT_ASSOCIATION_REVIEW_SCHEMA_VERSION =
  'ecos-document-association-review-inventory/2.0' as const;
const SCOPE = 'owner_document_association_review_only' as const;
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_RAW_BYTES = 16 * 1024 * 1024;
const MAX_WIRE_BYTES = 36 * 1024 * 1024;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;

export type ECOSAssociationReviewEntityType =
  | 'document'
  | 'project'
  | 'project_tombstone';
export interface ECOSDocumentAssociationReviewRow {
  entity_key: string;
  entity_type: ECOSAssociationReviewEntityType;
  entity_id: string;
  metadata_sha256: string;
  metadata_json: string | null;
  redaction_reason:
    | null
    | 'organization_scope_missing'
    | 'organization_scope_conflict'
    | 'legacy_tombstone_identity';
}
interface ReviewScope {
  schema_version: typeof ECOS_DOCUMENT_ASSOCIATION_REVIEW_SCHEMA_VERSION;
  publication_mode: 'shadow';
  scope: typeof SCOPE;
  organization_id: string;
  project_id: string;
  owner_id: string;
  epoch_sha256: string;
  total_count: number;
}
export interface ECOSBoundDocumentAssociationReviewPage extends ReviewScope {
  after_entity_key: string | null;
  rows: readonly Readonly<ECOSDocumentAssociationReviewRow>[];
  next_entity_key: string | null;
}
export interface ECOSDocumentAssociationReviewInventory extends ReviewScope {
  rows: readonly Readonly<ECOSDocumentAssociationReviewRow>[];
  document_count: number;
  project_count: number;
  project_tombstone_count: number;
}
export interface ECOSExpectedDocumentAssociationReviewPage {
  organizationId: string;
  projectId: string;
  ownerId: string;
  epochSha256: string | null;
  afterEntityKey: string | null;
  pageLimit: number;
}
export type ECOSAssociationPrimaryState =
  | 'active'
  | 'archived'
  | 'deletion_marker'
  | 'unresolved'
  | 'redacted'
  | 'absent'
  | 'invalid';
export interface ECOSAssociationPrimaryLink {
  recorded_project_id: string | null;
  state: ECOSAssociationPrimaryState;
  project_state: 'active' | 'archived' | 'unresolved' | null;
  deletion_marker: boolean;
}
export interface ECOSAssociationNameHint {
  pointer: string;
  provided_name: string;
  normalized_name: string;
  matched_project_ids: readonly string[];
  archived_project_ids: readonly string[];
  deletion_marker_project_ids: readonly string[];
  verification: 'generation_not_verified';
}
export interface ECOSAssociationUnverifiedIdHint {
  pointer: string;
  project_id: string;
  state: ECOSAssociationPrimaryState;
  verification: 'generation_not_verified';
}
export type ECOSAssociationTargetRelation =
  | 'exact_primary_id_recorded'
  | 'name_candidate_only'
  | 'unverified_id_candidate_only'
  | 'not_indicated'
  | 'unresolved'
  | 'redacted';
export interface ECOSDocumentAssociationReviewEntry
  extends ECOSDocumentAssociationReviewRow {
  primary_link: Readonly<ECOSAssociationPrimaryLink>;
  name_hints: readonly Readonly<ECOSAssociationNameHint>[];
  unverified_id_hints: readonly Readonly<ECOSAssociationUnverifiedIdHint>[];
  target_relation: ECOSAssociationTargetRelation;
  review_gaps: readonly string[];
}
export interface ECOSDocumentAssociationReviewPlan {
  schema_version: 'ecos-document-association-review-plan/2.0';
  publication_mode: 'shadow';
  scope: typeof SCOPE;
  organization_id: string;
  project_id: string;
  owner_id: string;
  epoch_sha256: string;
  documents: readonly Readonly<ECOSDocumentAssociationReviewEntry>[];
  document_count: number;
  project_roster_complete_for_hints: boolean;
  name_normalization: 'NFKC_lowercase_unicode_whitespace_collapse_hints_only';
  review_gaps: readonly string[];
  retrieval_authorized: false;
  binding_changes: 'not_performed';
  project_library_completeness: 'not_established';
  verification: 'association_hints_only';
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
  'after_entity_key',
  'rows',
  'next_entity_key',
] as const;
const ROW_KEYS = [
  'entity_key',
  'entity_type',
  'entity_id',
  'metadata_sha256',
  'metadata_json',
  'redaction_reason',
] as const;
const EXPECTED_KEYS = [
  'organizationId',
  'projectId',
  'ownerId',
  'epochSha256',
  'afterEntityKey',
  'pageLimit',
] as const;
const DOCUMENT_KEYS = [
  'source_id',
  'owner_id',
  'name',
  'category',
  'updated_at',
  'data_type',
  'id',
  'organizationId',
  'projectId',
  'projectName',
  'projectNames',
  'projectIds',
  'contentSha256',
  'drawingRevision',
  'isCurrent',
  'drawingStatus',
] as const;
const PROJECT_KEYS = [
  'id',
  'owner_id',
  'name',
  'archived',
  'updated_at',
  'declared_organization_id',
  'embedded_organization_id',
] as const;
const TOMBSTONE_KEYS = [
  'owner_id',
  'entity_type',
  'record_id',
  'deleted_at',
  'created_at',
] as const;
const pageOrigins = new WeakMap<
  object,
  Readonly<ECOSExpectedDocumentAssociationReviewPage>
>();
const inventories = new WeakSet<object>();
const metadata = new WeakMap<object, Readonly<Record<string, unknown>>>();

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
function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
) {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) ||
    value < minimum || value > maximum
  ) throw new Error(`${field} exceeds its integer bound`);
  return value;
}
function entityKey(value: unknown, field: string) {
  const key = text(value, 318, field);
  const type = ['document', 'project', 'project_tombstone'].find((kind) =>
    key.startsWith(`${kind}:`)
  );
  if (!type) throw new Error(`${field} has unsupported entity type`);
  const id = text(key.slice(type.length + 1), 300, `${field} identity`);
  if (
    (type === 'project' && !UUID.test(id)) ||
    (type === 'project_tombstone' && !UUID.test(id) && !SHA.test(id))
  ) {
    throw new Error(`${field} has invalid project identity`);
  }
  return key;
}
/** Exact PostgreSQL UTF-8 COLLATE C order, not locale or UTF-16 order. */
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

/** Valid JSON is scanned only to reject duplicate members/deep ambiguity; raw bytes remain untouched. */
function verifyJSON(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('association metadata JSON is invalid');
  }
  if (!plain(parsed)) {
    throw new Error('association metadata must be a plain object');
  }
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
    throw new Error('association metadata string is incomplete');
  };
  function visit(depth: number) {
    if (depth > 64) {
      throw new Error('association metadata exceeds nesting bound');
    }
    space();
    const opening = raw[position];
    if (opening === '{' || opening === '[') {
      position++;
      const closing = opening === '{' ? '}' : ']';
      const keys = new Set<string>();
      space();
      while (raw[position] !== closing) {
        if (opening === '{') {
          const key = string();
          if (keys.has(key)) {
            throw new Error('association metadata has duplicate members');
          }
          keys.add(key);
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
    else {while (
        position < raw.length && !/[\x20\t\r\n,}\]]/.test(raw[position])
      ) position++;}
  }
  visit(0);
  const pending: unknown[] = [parsed];
  while (pending.length) {
    const item = pending.pop();
    if (
      typeof item === 'string' && (!unicode(item) || item.includes('\u0000'))
    ) throw new Error('association metadata has invalid decoded Unicode');
    if (item !== null && typeof item === 'object') {
      for (const [key, value] of Object.entries(item)) pending.push(key, value);
      Object.freeze(item);
    }
  }
  return parsed;
}

function copiedRow(value: unknown): Readonly<ECOSDocumentAssociationReviewRow> {
  const raw = object(value, ROW_KEYS, 'association entity row');
  if (
    !['document', 'project', 'project_tombstone'].includes(
      raw.entity_type as string,
    )
  ) throw new Error('association entity type unsupported');
  const entity_type = raw.entity_type as ECOSAssociationReviewEntityType;
  const entity_id = text(raw.entity_id, 300, 'entity ID');
  const entity_key = entityKey(raw.entity_key, 'entity key');
  if (entity_key !== `${entity_type}:${entity_id}`) {
    throw new Error('association entity identity mismatch');
  }
  const metadata_sha256 = pin(raw.metadata_sha256, 'metadata hash');
  const redaction_reason = raw.redaction_reason;
  const allowed = entity_type === 'document'
    ? ['organization_scope_missing', 'organization_scope_conflict']
    : entity_type === 'project'
    ? ['organization_scope_conflict']
    : ['legacy_tombstone_identity', 'organization_scope_conflict'];
  if (
    redaction_reason !== null && !allowed.includes(redaction_reason as string)
  ) throw new Error('association redaction reason contradicts entity type');
  if ((redaction_reason === null) !== (raw.metadata_json !== null)) {
    throw new Error('association redaction must remove its metadata');
  }
  if (
    entity_type === 'project_tombstone' &&
    (redaction_reason === 'legacy_tombstone_identity'
      ? !SHA.test(entity_id)
      : !UUID.test(entity_id))
  ) {
    throw new Error('tombstone marker identity contradicts redaction');
  }
  const metadata_json = raw.metadata_json;
  if (
    metadata_json !== null &&
    (typeof metadata_json !== 'string' || !metadata_json ||
      metadata_json.length > MAX_METADATA_BYTES || !unicode(metadata_json) ||
      encoder.encode(metadata_json).length > MAX_METADATA_BYTES)
  ) {
    throw new Error('association metadata exceeds exact UTF-8 byte bound');
  }
  return Object.freeze({
    entity_key,
    entity_type,
    entity_id,
    metadata_sha256,
    metadata_json: metadata_json as string | null,
    redaction_reason:
      redaction_reason as ECOSDocumentAssociationReviewRow['redaction_reason'],
  });
}

async function verifyRow(
  row: Readonly<ECOSDocumentAssociationReviewRow>,
  scope: ReviewScope,
) {
  // A redacted digest is an opaque database pin: unavailable metadata is not claimed verified.
  if (row.metadata_json === null) return;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(row.metadata_json),
  );
  const actual = [...new Uint8Array(digest)].map((b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
  if (actual !== row.metadata_sha256) {
    throw new Error('association metadata hash mismatch');
  }
  const parsed = verifyJSON(row.metadata_json);
  object(
    parsed,
    row.entity_type === 'document'
      ? DOCUMENT_KEYS
      : row.entity_type === 'project'
      ? PROJECT_KEYS
      : TOMBSTONE_KEYS,
    'association metadata',
  );
  if (parsed.owner_id !== scope.owner_id) {
    throw new Error('association metadata owner scope mismatch');
  }
  if (row.entity_type === 'document') {
    if (
      parsed.source_id !== row.entity_id ||
      parsed.organizationId !== scope.organization_id ||
      parsed.data_type !== 'object'
    ) {
      throw new Error(
        'association document metadata identity or organization mismatch',
      );
    }
  } else if (row.entity_type === 'project') {
    if (
      parsed.id !== row.entity_id ||
      [parsed.declared_organization_id, parsed.embedded_organization_id]
        .some((value) => value !== null && value !== scope.organization_id)
    ) throw new Error('association project identity or organization mismatch');
  } else if (
    parsed.entity_type !== 'project' || parsed.record_id !== row.entity_id
  ) {
    throw new Error('association project tombstone identity mismatch');
  }
  metadata.set(row, parsed);
}

/** Local structural binding only; caller authorizes the independent owner/project scope. */
export async function bindECOSDocumentAssociationReviewPage(
  rawPage: unknown,
  expectedInput: ECOSExpectedDocumentAssociationReviewPage,
): Promise<Readonly<ECOSBoundDocumentAssociationReviewPage>> {
  const input = object(
    expectedInput,
    EXPECTED_KEYS,
    'expected association scope',
  );
  const expected = Object.freeze({
    organizationId: text(input.organizationId, 500, 'organization ID'),
    projectId: pin(input.projectId, 'project ID', true),
    ownerId: pin(input.ownerId, 'owner ID', true),
    epochSha256: input.epochSha256 === null
      ? null
      : pin(input.epochSha256, 'expected epoch'),
    afterEntityKey: input.afterEntityKey === null
      ? null
      : entityKey(input.afterEntityKey, 'expected cursor'),
    pageLimit: integer(input.pageLimit, 1, 50, 'association page limit'),
  });
  if (expected.afterEntityKey !== null && expected.epochSha256 === null) {
    throw new Error('continuation requires independently pinned epoch');
  }
  const raw = object(rawPage, PAGE_KEYS, 'association inventory page');
  const scope = {
    schema_version: ECOS_DOCUMENT_ASSOCIATION_REVIEW_SCHEMA_VERSION,
    publication_mode: 'shadow' as const,
    scope: SCOPE,
    organization_id: expected.organizationId,
    project_id: expected.projectId,
    owner_id: expected.ownerId,
  };
  if (Object.entries(scope).some(([key, value]) => raw[key] !== value)) {
    throw new Error('association page does not match independent scope');
  }
  const epoch_sha256 = pin(raw.epoch_sha256, 'association epoch');
  if (expected.epochSha256 !== null && epoch_sha256 !== expected.epochSha256) {
    throw new Error('association epoch changed');
  }
  if (raw.after_entity_key !== expected.afterEntityKey) {
    throw new Error('association request cursor mismatch');
  }
  const total_count = integer(
    raw.total_count,
    0,
    1200,
    'association total count',
  );
  // Every row and scope field is copied before the first asynchronous digest.
  const rows = array(raw.rows, expected.pageLimit, 'association rows').map(
    copiedRow,
  );
  if (
    rows.length > total_count ||
    (expected.afterEntityKey === null &&
      rows.length !== Math.min(expected.pageLimit, total_count)) ||
    (expected.afterEntityKey !== null && !rows.length)
  ) throw new Error('association page row count mismatch');
  let previous = expected.afterEntityKey;
  for (const row of rows) {
    if (previous !== null && compare(previous, row.entity_key) >= 0) {
      throw new Error(
        'association entities must be strictly UTF-8 ordered after cursor',
      );
    }
    previous = row.entity_key;
  }
  const next_entity_key = raw.next_entity_key === null
    ? null
    : entityKey(raw.next_entity_key, 'next entity cursor');
  if (
    next_entity_key !== null &&
    (rows.length !== expected.pageLimit ||
      next_entity_key !== rows.at(-1)?.entity_key)
  ) throw new Error('association next cursor must equal last full-page entity');
  if (
    expected.afterEntityKey === null &&
    next_entity_key !==
      (rows.length < total_count ? rows.at(-1)!.entity_key : null)
  ) throw new Error('association continuation contradicts total count');
  const page = Object.freeze({
    ...scope,
    epoch_sha256,
    total_count,
    after_entity_key: expected.afterEntityKey,
    rows: Object.freeze(rows),
    next_entity_key,
  });
  if (bytes(page) > MAX_PAGE_BYTES) {
    throw new Error('association page exceeds wire budget');
  }
  for (const row of rows) await verifyRow(row, page);
  pageOrigins.set(page, expected);
  return page;
}
export function assertECOSBoundDocumentAssociationReviewPage(
  value: unknown,
): asserts value is ECOSBoundDocumentAssociationReviewPage {
  if (!value || typeof value !== 'object' || !pageOrigins.has(value)) {
    throw new Error('association page must originate from exact binding');
  }
}
export function assembleECOSDocumentAssociationReviewInventory(
  inputPages: readonly ECOSBoundDocumentAssociationReviewPage[],
): Readonly<ECOSDocumentAssociationReviewInventory> {
  const pages = array(inputPages, 1200, 'association pages');
  if (!pages.length) {
    throw new Error(
      'complete association inventory requires its first page even when empty',
    );
  }
  let first: ECOSBoundDocumentAssociationReviewPage | undefined;
  let cursor: string | null = null, rawBytes = 0, wireBytes = 0;
  const rows: Readonly<ECOSDocumentAssociationReviewRow>[] = [];
  const counts = { document: 0, project: 0, project_tombstone: 0 };
  for (const value of pages) {
    assertECOSBoundDocumentAssociationReviewPage(value);
    const page = value, request = pageOrigins.get(page)!;
    if (first && cursor === null) {
      throw new Error('association pages continue after terminal inventory');
    }
    first ??= page;
    if (
      page.organization_id !== first.organization_id ||
      page.project_id !== first.project_id ||
      page.owner_id !== first.owner_id ||
      page.epoch_sha256 !== first.epoch_sha256 ||
      page.total_count !== first.total_count
    ) throw new Error('association pages mix scope epoch or count');
    if (
      page.after_entity_key !== cursor || request.afterEntityKey !== cursor ||
      (cursor !== null && request.epochSha256 !== first.epoch_sha256)
    ) throw new Error('association cursor chain has a gap or duplicate');
    const remaining = first.total_count - rows.length;
    if (page.rows.length !== Math.min(request.pageLimit, remaining)) {
      throw new Error('association page omits expected entities');
    }
    if (
      page.next_entity_key !==
        (page.rows.length < remaining ? page.rows.at(-1)!.entity_key : null)
    ) throw new Error('association cursor hides or invents remaining entities');
    if (
      rows.length && page.rows.length &&
      compare(rows.at(-1)!.entity_key, page.rows[0].entity_key) >= 0
    ) throw new Error('association entities overlap');
    for (const row of page.rows) {
      counts[row.entity_type]++;
      rawBytes += row.metadata_json === null
        ? 0
        : encoder.encode(row.metadata_json).length;
    }
    wireBytes += bytes(page);
    if (
      counts.document > 500 || counts.project > 200 ||
      counts.project_tombstone > 500 || rawBytes > MAX_RAW_BYTES ||
      wireBytes > MAX_WIRE_BYTES
    ) throw new Error('association inventory exceeds complete retained bounds');
    rows.push(...page.rows);
    cursor = page.next_entity_key;
  }
  if (cursor !== null || rows.length !== first!.total_count) {
    throw new Error('association inventory is incomplete');
  }
  const target = rows.find((row) =>
    row.entity_type === 'project' && row.entity_id === first!.project_id
  );
  if (
    !target || target.redaction_reason !== null ||
    metadata.get(target)?.archived !== false ||
    rows.some((row) =>
      row.entity_type === 'project_tombstone' &&
      row.entity_id === first!.project_id
    )
  ) {
    throw new Error(
      'association inventory requires its exact unredacted active target project',
    );
  }
  const redactedProjects = new Set(
    rows.filter((row) =>
      row.entity_type === 'project' &&
      row.redaction_reason === 'organization_scope_conflict'
    ).map((row) => row.entity_id),
  );
  for (const row of rows) {
    if (
      row.entity_type === 'project_tombstone' && UUID.test(row.entity_id) &&
      (redactedProjects.has(row.entity_id) !==
        (row.redaction_reason === 'organization_scope_conflict'))
    ) {
      throw new Error(
        'association tombstone redaction must match its complete project roster',
      );
    }
  }
  const {
    rows: _rows,
    after_entity_key: _after,
    next_entity_key: _next,
    ...scope
  } = first!;
  const inventory = Object.freeze({
    ...scope,
    rows: Object.freeze(rows),
    document_count: counts.document,
    project_count: counts.project,
    project_tombstone_count: counts.project_tombstone,
  });
  inventories.add(inventory);
  return inventory;
}
export function assertECOSDocumentAssociationReviewInventory(
  value: unknown,
): asserts value is ECOSDocumentAssociationReviewInventory {
  if (!value || typeof value !== 'object' || !inventories.has(value)) {
    throw new Error(
      'association inventory must originate from complete bound pages',
    );
  }
}

/** This normalization is deliberately a review hint, never source or project identity. */
function hintName(value: unknown): string | null {
  if (
    typeof value !== 'string' || value.length > 500 ||
    encoder.encode(value).length > 500
  ) return null;
  const normalized = value.normalize('NFKC').toLowerCase().replace(
    /[\p{White_Space}\uFEFF]+/gu,
    ' ',
  ).trim();
  return normalized || null;
}
export function buildECOSDocumentAssociationReviewPlan(
  inventory: ECOSDocumentAssociationReviewInventory,
): Readonly<ECOSDocumentAssociationReviewPlan> {
  assertECOSDocumentAssociationReviewInventory(inventory);
  const projects = new Map(
    inventory.rows.filter((row) => row.entity_type === 'project').map((
      row,
    ) => [row.entity_id, row]),
  );
  const markers = new Set(
    inventory.rows.filter((row) =>
      row.entity_type === 'project_tombstone' && row.redaction_reason === null
    ).map((row) => row.entity_id),
  );
  const globalGaps = new Set<string>();
  const names = new Map<string, string[]>();
  let project_roster_complete_for_hints = true;
  for (const row of projects.values()) {
    const project = metadata.get(row);
    if (!project) {
      project_roster_complete_for_hints = false;
      globalGaps.add('project_roster_redacted');
      continue;
    }
    const name = hintName(project.name);
    if (name === null || typeof project.archived !== 'boolean') {
      project_roster_complete_for_hints = false;
      globalGaps.add('project_roster_metadata_unresolved');
    }
    if (name !== null) {
      const ids = names.get(name) ?? [];
      ids.push(row.entity_id);
      names.set(name, ids);
    }
  }
  if (
    inventory.rows.some((row) =>
      row.redaction_reason === 'legacy_tombstone_identity'
    )
  ) globalGaps.add('legacy_tombstone_identity_unresolved');
  if (markers.size) globalGaps.add('tombstone_generation_not_verified');
  if (
    inventory.rows.some((row) =>
      row.entity_type === 'project_tombstone' &&
      row.redaction_reason === 'organization_scope_conflict'
    )
  ) {
    globalGaps.add('project_tombstone_organization_scope_redacted');
  }
  if ([...markers].some((id) => !projects.has(id))) {
    globalGaps.add('orphan_tombstone_has_no_recoverable_name');
  }
  const link = (value: unknown): Readonly<ECOSAssociationPrimaryLink> => {
    if (value === null) {
      return Object.freeze({
        recorded_project_id: null,
        state: 'absent',
        project_state: null,
        deletion_marker: false,
      });
    }
    if (typeof value !== 'string' || !UUID.test(value)) {
      return Object.freeze({
        recorded_project_id: null,
        state: 'invalid',
        project_state: null,
        deletion_marker: false,
      });
    }
    const row = projects.get(value),
      project = row ? metadata.get(row) : undefined;
    const project_state = project?.archived === true
      ? 'archived'
      : project?.archived === false
      ? 'active'
      : row
      ? 'unresolved'
      : null;
    const state = row?.redaction_reason
      ? 'redacted'
      : markers.has(value)
      ? 'deletion_marker'
      : project_state ?? 'unresolved';
    return Object.freeze({
      recorded_project_id: value,
      state,
      project_state,
      deletion_marker: markers.has(value),
    });
  };
  const documents: Readonly<ECOSDocumentAssociationReviewEntry>[] = [];
  let reportBytes = 4096;
  for (const row of inventory.rows) {
    if (row.entity_type !== 'document') continue;
    const source = metadata.get(row), gaps = new Set<string>();
    const name_hints: Readonly<ECOSAssociationNameHint>[] = [];
    const unverified_id_hints: Readonly<ECOSAssociationUnverifiedIdHint>[] = [];
    let primary_link: Readonly<ECOSAssociationPrimaryLink>;
    let hintBytes = 0;
    const boundHint = (value: unknown) => {
      hintBytes += bytes(value);
      if (hintBytes + reportBytes > MAX_WIRE_BYTES) {
        throw new Error(
          'association review report exceeds complete byte budget',
        );
      }
    };
    if (!source) {
      primary_link = Object.freeze({
        recorded_project_id: null,
        state: 'redacted',
        project_state: null,
        deletion_marker: false,
      });
      gaps.add(row.redaction_reason!);
    } else {
      primary_link = link(source.projectId);
      if (primary_link.deletion_marker) {
        gaps.add('deletion_marker_generation_not_verified');
      }
      if (source.id !== row.entity_id) {
        gaps.add(
          source.id === null
            ? 'document_embedded_identity_missing'
            : 'document_embedded_identity_conflict',
        );
      }
      if (!['active', 'archived'].includes(primary_link.state)) {
        gaps.add(`primary_project_${primary_link.state}`);
      }
      const addName = (provided: unknown, pointer: string) => {
        const normalized = hintName(provided);
        if (normalized === null) {
          gaps.add('project_name_hint_invalid');
          return;
        }
        const matched_project_ids = Object.freeze(
          [...(names.get(normalized) ?? [])].sort(compare),
        );
        const hint = Object.freeze({
          pointer,
          provided_name: provided as string,
          normalized_name: normalized,
          matched_project_ids,
          archived_project_ids: Object.freeze(
            matched_project_ids.filter((id) =>
              metadata.get(projects.get(id)!)?.archived === true
            ),
          ),
          deletion_marker_project_ids: Object.freeze(
            matched_project_ids.filter((id) => markers.has(id)),
          ),
          verification: 'generation_not_verified' as const,
        });
        boundHint(hint);
        name_hints.push(hint);
        gaps.add('name_link_generation_not_verified');
        if (matched_project_ids.length > 1) {
          gaps.add('project_name_hint_ambiguous');
        }
        if (!matched_project_ids.length) {
          gaps.add('project_name_hint_unresolved');
        }
        if (primary_link.recorded_project_id !== null) {
          const primary = projects.get(primary_link.recorded_project_id);
          const primaryName = primary
            ? hintName(metadata.get(primary)?.name)
            : null;
          if (
            pointer === '/projectName' && primaryName !== null &&
            normalized !== primaryName
          ) {
            gaps.add('primary_id_name_disagreement');
          }
          if (
            matched_project_ids.some((id) =>
              id !== primary_link.recorded_project_id
            )
          ) gaps.add('name_hint_matches_other_project');
        }
      };
      if (source.projectName !== null) {
        addName(source.projectName, '/projectName');
      }
      if (source.projectNames !== null) {
        if (!Array.isArray(source.projectNames)) {
          gaps.add('project_names_array_invalid');
        } else {source.projectNames.forEach((name, index) =>
            addName(name, `/projectNames/${index}`)
          );}
      }
      if (source.projectIds !== null) {
        if (!Array.isArray(source.projectIds)) {
          gaps.add('project_ids_array_invalid');
        } else {source.projectIds.forEach((id, index) => {
            if (typeof id !== 'string' || !UUID.test(id)) {
              gaps.add('project_id_hint_invalid');
              return;
            }
            const hint = Object.freeze({
              pointer: `/projectIds/${index}`,
              project_id: id,
              state: link(id).state,
              verification: 'generation_not_verified' as const,
            });
            boundHint(hint);
            unverified_id_hints.push(hint);
            gaps.add('secondary_project_ids_not_authoritative');
          });}
      }
      if (!project_roster_complete_for_hints) {
        gaps.add('name_candidate_completeness_not_proven');
      }
    }
    const target_relation: ECOSAssociationTargetRelation = !source
      ? 'redacted'
      : primary_link.recorded_project_id === inventory.project_id
      ? 'exact_primary_id_recorded'
      : name_hints.some((hint) =>
          hint.matched_project_ids.includes(inventory.project_id)
        )
      ? 'name_candidate_only'
      : unverified_id_hints.some((hint) =>
          hint.project_id === inventory.project_id
        )
      ? 'unverified_id_candidate_only'
      : ['invalid', 'unresolved', 'redacted'].includes(primary_link.state) ||
          !project_roster_complete_for_hints ||
          gaps.has('project_names_array_invalid') ||
          gaps.has('project_ids_array_invalid') ||
          gaps.has('project_name_hint_invalid') ||
          gaps.has('project_id_hint_invalid') ||
          (primary_link.state === 'absent' &&
            gaps.has('project_name_hint_unresolved'))
      ? 'unresolved'
      : 'not_indicated';
    const entry = Object.freeze({
      ...row,
      primary_link,
      name_hints: Object.freeze(name_hints),
      unverified_id_hints: Object.freeze(unverified_id_hints),
      target_relation,
      review_gaps: Object.freeze([...gaps].sort()),
    });
    reportBytes += bytes(entry);
    if (reportBytes > MAX_WIRE_BYTES) {
      throw new Error('association review report exceeds complete byte budget');
    }
    documents.push(entry);
  }
  return Object.freeze({
    schema_version: 'ecos-document-association-review-plan/2.0',
    publication_mode: 'shadow',
    scope: SCOPE,
    organization_id: inventory.organization_id,
    project_id: inventory.project_id,
    owner_id: inventory.owner_id,
    epoch_sha256: inventory.epoch_sha256,
    documents: Object.freeze(documents),
    document_count: documents.length,
    project_roster_complete_for_hints,
    name_normalization: 'NFKC_lowercase_unicode_whitespace_collapse_hints_only',
    review_gaps: Object.freeze([...globalGaps].sort()),
    retrieval_authorized: false,
    binding_changes: 'not_performed',
    project_library_completeness: 'not_established',
    verification: 'association_hints_only',
  });
}
