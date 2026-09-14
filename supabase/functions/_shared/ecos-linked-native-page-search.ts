import {
  assertECOSLinkedProjectDocumentInventory,
  type ECOSLinkedProjectDocumentInventory,
} from './ecos-linked-project-document-inventory.ts';
import {
  assertECOSLinkedProjectDocumentIndexes,
  type ECOSLinkedProjectDocumentIndexes,
} from './ecos-linked-project-document-indexes.ts';
import { compareSourceIds } from './ecos-project-document-inventory.ts';
import {
  ECOS_NATIVE_PAGE_EXTRACTION_VERSION,
  type ECOSPageSourceExcerpts,
  parseECOSPageSourceExcerpts,
} from './ecos-page-source-excerpts.ts';

const SCHEMA = 'ecos-linked-native-page-search/2.0' as const;
export const ECOS_LINKED_NATIVE_SEARCH_RPC =
  'ecos_search_linked_native_page_sources' as const;
export const ECOS_NATIVE_SEARCH_MAX_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();
const SHA = /^[a-f0-9]{64}$/;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ELIGIBLE = new Set([
  'manifest_current',
  'manifest_missing',
  'manifest_stale',
]);
export interface ECOSNativeSearchSource {
  source_id: string;
  index_state: string;
  job_id: string | null;
  source_sha256: string | null;
  source_revision: string | null;
  source_page_count: number | null;
  manifest_id: string | null;
  manifest_sha256: string | null;
  native_page_count: number;
  partial_page_count: number;
  unreadable_page_count: number;
  failed_page_count: number;
  missing_page_count: number | null;
}
export interface ECOSLinkedNativePageSearchHit {
  source_id: string;
  job_id: string;
  source_sha256: string;
  source_revision: string | null;
  source_page_count: number;
  page_number: number;
  projection_id: string;
  projection_sha256: string;
  page_text_sha256: string;
  rank: number;
  page: Readonly<ECOSPageSourceExcerpts>;
}
export interface ECOSLinkedNativePageSearch {
  schema_version: typeof SCHEMA;
  publication_mode: 'shadow';
  organization_id: string;
  project_id: string;
  owner_id: string;
  inventory_epoch_sha256: string;
  search_epoch_sha256: string;
  query: string;
  lexemes: readonly string[];
  total_source_count: number;
  total_registered_page_count: number;
  total_matching_page_count: number;
  has_more: boolean;
  hits: readonly Readonly<ECOSLinkedNativePageSearchHit>[];
  sources: readonly Readonly<ECOSNativeSearchSource>[];
  retrieval_authorized: false;
  verification: 'native_text_only_requires_assurance';
  semantic_discovery: 'not_implemented';
}
export interface ECOSExpectedNativePageSearch {
  query: string;
  expectedSearchEpoch: string | null;
  limit: number;
}
const origins = new WeakMap<object, {
  inventory: ECOSLinkedProjectDocumentInventory;
  indexes: ECOSLinkedProjectDocumentIndexes;
}>();
const OUTER_KEYS = [
  'schema_version',
  'publication_mode',
  'organization_id',
  'project_id',
  'owner_id',
  'inventory_epoch_sha256',
  'search_epoch_sha256',
  'query',
  'lexemes',
  'total_source_count',
  'total_registered_page_count',
  'total_matching_page_count',
  'has_more',
  'hits',
  'sources',
  'retrieval_authorized',
  'verification',
  'semantic_discovery',
];
const SOURCE_KEYS = [
  'source_id',
  'index_state',
  'job_id',
  'source_sha256',
  'source_revision',
  'source_page_count',
  'manifest_id',
  'manifest_sha256',
  'native_page_count',
  'partial_page_count',
  'unreadable_page_count',
  'failed_page_count',
  'missing_page_count',
];
const HIT_KEYS = [
  'source_id',
  'job_id',
  'source_sha256',
  'source_revision',
  'source_page_count',
  'page_number',
  'projection_id',
  'projection_sha256',
  'page_text_sha256',
  'rank',
  'payload_json',
];
function object(value: unknown, keys: readonly string[]) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error('Native search requires plain data objects');
  }
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    throw new Error('Native search has missing or unsupported fields');
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const p = Object.getOwnPropertyDescriptor(value, key);
    if (!p?.enumerable || !Object.hasOwn(p, 'value')) {
      throw new Error('Native search forbids executable properties');
    }
    result[key] = p.value;
  }
  return result;
}
function array(value: unknown, max: number): unknown[] {
  if (
    !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) throw new Error('Native search array exceeds its data bound');
  return Array.from({ length: value.length }, (_, index) => {
    const p = Object.getOwnPropertyDescriptor(value, String(index));
    if (!p?.enumerable || !Object.hasOwn(p, 'value')) {
      throw new Error('Native search requires dense data arrays');
    }
    return p.value;
  });
}
function pin(value: unknown, uuid = false): string {
  if (typeof value !== 'string' || !(uuid ? UUID : SHA).test(value)) {
    throw new Error('Native search pin is invalid');
  }
  return value;
}
function integer(value: unknown, max: number, min = 0): number {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) || value < min ||
    value > max
  ) {
    throw new Error('Native search count is invalid');
  }
  return value;
}
function unicode(value: unknown, bytes: number): string {
  if (
    typeof value !== 'string' || value.length > bytes ||
    /[\ud800-\udfff]/u.test(
      value.replace(/[\ud800-\udbff][\udc00-\udfff]/gu, ''),
    ) ||
    encoder.encode(value).length > bytes
  ) throw new Error('Native search text exceeds encoding bounds');
  return value;
}
export function validateECOSNativePageSearchQuery(value: unknown): string {
  const query = unicode(value, 16 * 1024);
  if (
    !query.trim() || [...query].length > 4000 || [...query].some((char) => {
      const code = char.codePointAt(0)!;
      return (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
        (code >= 127 && code <= 159);
    })
  ) throw new Error('Native search query is invalid');
  return query;
}
function scalarSnapshot(raw: Record<string, unknown>) {
  for (const item of Object.values(raw)) {
    if (
      item !== null && !['string', 'number', 'boolean'].includes(typeof item)
    ) {
      throw new Error('Native search metadata must contain scalar data');
    }
    if (typeof item === 'string') unicode(item, 1024 * 1024);
    if (typeof item === 'number' && !Number.isFinite(item)) {
      throw new Error('Native search number is invalid');
    }
  }
  return raw;
}
async function sha256(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
/** JSONB cannot emit duplicate keys. Reject them rather than normalizing a
 * fabricated hash-matching JSON string; parse errors never include source text. */
function payloadObject(value: string): unknown {
  try {
    const scopes: (Set<string> | null)[] = [];
    let nodes = 0;
    for (let index = 0; index < value.length; index++) {
      const c = value[index];
      if (c === '{' || c === '[') {
        if (++nodes > 10_000 || scopes.length >= 12) throw new Error();
        scopes.push(c === '{' ? new Set<string>() : null);
      } else if (c === '}' || c === ']') {
        scopes.pop();
      } else if (c === '"') {
        const start = index++;
        while (index < value.length && value[index] !== '"') {
          if (value[index] === '\\') index++;
          index++;
        }
        let after = index + 1;
        while (after < value.length && /\s/u.test(value[after])) after++;
        if (value[after] === ':') {
          const key = JSON.parse(value.slice(start, index + 1));
          const scope = scopes.at(-1);
          if (
            !scope || scope.has(key) ||
            ['__proto__', 'constructor', 'prototype'].includes(key)
          ) throw new Error();
          scope.add(key);
        }
      }
    }
    return JSON.parse(value);
  } catch {
    throw new Error('Native search payload is invalid JSON data');
  }
}

/** Verify an internal read-only response against independently bound complete
 * inventories. Rank/lexemes are database search observations, not proof of
 * meaning, relevance, exhaustive recall or factual correctness. */
export async function bindECOSLinkedNativePageSearch(
  raw: unknown,
  inventory: Readonly<ECOSLinkedProjectDocumentInventory>,
  indexes: Readonly<ECOSLinkedProjectDocumentIndexes>,
  expected: ECOSExpectedNativePageSearch,
): Promise<Readonly<ECOSLinkedNativePageSearch>> {
  assertECOSLinkedProjectDocumentInventory(inventory);
  assertECOSLinkedProjectDocumentIndexes(indexes, inventory);
  const request = object(expected, ['query', 'expectedSearchEpoch', 'limit']);
  const query = validateECOSNativePageSearchQuery(request.query);
  const limit = integer(request.limit, 8, 1);
  const expectedEpoch = request.expectedSearchEpoch === null
    ? null
    : pin(request.expectedSearchEpoch);
  const input = object(raw, OUTER_KEYS);
  // Snapshot the whole bounded response before the first digest await, including
  // later hits, so transport mutation cannot change a candidate mid-validation.
  const rawSources = array(input.sources, 600).map((row) =>
    scalarSnapshot(object(row, SOURCE_KEYS))
  );
  const rawHits = array(input.hits, 8).map((row) =>
    scalarSnapshot(object(row, HIT_KEYS))
  );
  const lexemes = array(input.lexemes, 64).map((item) => {
    const lexeme = unicode(item, 16 * 1024);
    if (
      !lexeme || lexeme.trim() !== lexeme || [...lexeme].some((c) => {
        const code = c.codePointAt(0)!;
        return code < 32 || (code >= 127 && code <= 159);
      })
    ) throw new Error('Invalid native search lexeme');
    return lexeme;
  });
  const outer = scalarSnapshot(
    Object.fromEntries(
      Object.entries(input).filter(([key]) =>
        !['sources', 'hits', 'lexemes'].includes(key)
      ),
    ),
  );
  if (
    encoder.encode(
      JSON.stringify({ ...outer, sources: rawSources, hits: rawHits, lexemes }),
    ).length > ECOS_NATIVE_SEARCH_MAX_BYTES
  ) {
    throw new Error('Native search response exceeds byte budget');
  }
  const exact = {
    schema_version: SCHEMA,
    publication_mode: 'shadow',
    organization_id: inventory.organization_id,
    project_id: inventory.project_id,
    owner_id: inventory.owner_id,
    inventory_epoch_sha256: inventory.epoch_sha256,
    query,
    total_source_count: inventory.total_count,
    retrieval_authorized: false,
    verification: 'native_text_only_requires_assurance',
    semantic_discovery: 'not_implemented',
  } as const;
  if (Object.entries(exact).some(([key, value]) => outer[key] !== value)) {
    throw new Error('Native search scope or query changed');
  }
  const epoch = pin(outer.search_epoch_sha256);
  if (expectedEpoch !== null && epoch !== expectedEpoch) {
    throw new Error('Native search epoch changed');
  }
  if (
    lexemes.some((word, index) =>
      index > 0 && compareSourceIds(lexemes[index - 1], word) >= 0
    )
  ) {
    throw new Error('Native search lexemes must be unique canonical order');
  }
  if (rawSources.length !== inventory.rows.length) {
    throw new Error('Native search omitted source coverage');
  }
  let registered = 0, partial = 0;
  const sources = rawSources.map(
    (source, index): Readonly<ECOSNativeSearchSource> => {
      const row = inventory.rows[index],
        resolution = indexes.resolutions[index];
      const count = row.registry_row?.source_page_count ?? null;
      const identity = {
        source_id: row.source_id,
        index_state: resolution.state,
        job_id: resolution.job?.job_id ?? null,
        source_sha256: row.registry_row?.source_sha256 ?? null,
        source_revision: row.registry_row?.source_revision ?? null,
        source_page_count: count,
        manifest_id: resolution.manifest?.manifestId ?? null,
        manifest_sha256: resolution.manifest?.manifestSha256 ?? null,
      };
      if (
        Object.entries(identity).some(([key, value]) => source[key] !== value)
      ) throw new Error('Native search source inventory changed');
      const native = integer(source.native_page_count, count ?? 0);
      const readable = integer(source.partial_page_count, native);
      const unreadable = integer(source.unreadable_page_count, native);
      const failed = integer(source.failed_page_count, native);
      if (
        native !== readable + unreadable + failed ||
        source.missing_page_count !==
          (count === null ? null : count - native) ||
        (!ELIGIBLE.has(resolution.state) && native !== 0)
      ) throw new Error('Native search page accounting is inconsistent');
      registered += count ?? 0;
      partial += readable;
      return Object.freeze({
        ...identity,
        native_page_count: native,
        partial_page_count: readable,
        unreadable_page_count: unreadable,
        failed_page_count: failed,
        missing_page_count: count === null ? null : count - native,
      });
    },
  );
  if (registered > 5000) {
    throw new Error('Native search exceeds registered page budget');
  }
  const total = integer(outer.total_matching_page_count, partial);
  if (
    outer.total_registered_page_count !== registered ||
    rawHits.length !== Math.min(limit, total) ||
    typeof outer.has_more !== 'boolean' || outer.has_more !== (total > limit) ||
    (!lexemes.length && total !== 0)
  ) {
    throw new Error('Native search result count or truncation is inconsistent');
  }
  const projectionIds = new Set<string>(), pageIds = new Set<string>();
  const perSource = new Map<string, number>();
  const hits: Readonly<ECOSLinkedNativePageSearchHit>[] = [];
  for (const rawHit of rawHits) {
    const index = inventory.rows.findIndex((row) =>
      row.source_id === rawHit.source_id
    );
    const source = sources[index], resolution = indexes.resolutions[index];
    if (
      !source || !resolution.job || !ELIGIBLE.has(resolution.state) ||
      source.source_page_count === null || !source.partial_page_count
    ) {
      throw new Error('Native search hit has no eligible exact source');
    }
    const identity = {
      source_id: source.source_id,
      job_id: resolution.job.job_id,
      source_sha256: resolution.job.source_sha256,
      source_revision: resolution.job.source_revision,
      source_page_count: resolution.job.source_page_count,
    };
    if (
      Object.entries(identity).some(([key, value]) => rawHit[key] !== value)
    ) throw new Error('Native hit source pins changed');
    const number = integer(rawHit.page_number, source.source_page_count, 1);
    const projection = pin(rawHit.projection_id, true),
      digest = pin(rawHit.projection_sha256),
      textDigest = pin(rawHit.page_text_sha256);
    if (
      typeof rawHit.rank !== 'number' || !Number.isFinite(rawHit.rank) ||
      rawHit.rank < 0 || rawHit.rank >= 1
    ) throw new Error('Native search rank is invalid');
    const pageKey = JSON.stringify([source.source_id, number]);
    if (projectionIds.has(projection) || pageIds.has(pageKey)) {
      throw new Error('Native search duplicated a source page');
    }
    projectionIds.add(projection);
    pageIds.add(pageKey);
    const seen = (perSource.get(source.source_id) ?? 0) + 1;
    if (seen > source.partial_page_count) {
      throw new Error('Native hits exceed reported source coverage');
    }
    perSource.set(source.source_id, seen);
    const payload = unicode(rawHit.payload_json, 1024 * 1024);
    if (await sha256(payload) !== digest) {
      throw new Error('Native projection payload hash is invalid');
    }
    const page = await parseECOSPageSourceExcerpts(payloadObject(payload), {
      jobId: identity.job_id,
      organizationId: inventory.organization_id,
      projectId: inventory.project_id,
      sourceId: identity.source_id,
      sourceSha256: identity.source_sha256,
      sourceRevision: identity.source_revision,
      sourcePageCount: identity.source_page_count,
      pageNumber: number,
      extractionVersion: ECOS_NATIVE_PAGE_EXTRACTION_VERSION,
    });
    if (page.state !== 'partial' || page.pageTextSha256 !== textDigest) {
      throw new Error('Native search hit is not matching partial source text');
    }
    const hit = Object.freeze({
      ...identity,
      page_number: number,
      projection_id: projection,
      projection_sha256: digest,
      page_text_sha256: textDigest,
      rank: rawHit.rank,
      page,
    });
    const previous = hits.at(-1);
    if (
      previous && (previous.rank < hit.rank || (previous.rank === hit.rank &&
        (compareSourceIds(previous.source_id, hit.source_id) > 0 ||
          (previous.source_id === hit.source_id &&
            previous.page_number >= hit.page_number))))
    ) {
      throw new Error('Native search hit ranking is not deterministic');
    }
    hits.push(hit);
  }
  const result = Object.freeze({
    ...exact,
    search_epoch_sha256: epoch,
    lexemes: Object.freeze(lexemes),
    total_registered_page_count: registered,
    total_matching_page_count: total,
    has_more: total > limit,
    sources: Object.freeze(sources),
    hits: Object.freeze(hits),
  });
  // Parsed excerpts retain their text alongside pageText. Bound that retained
  // representation separately, without truncating qualifiers or later hits.
  if (
    encoder.encode(JSON.stringify(result)).length > ECOS_NATIVE_SEARCH_MAX_BYTES
  ) {
    throw new Error('Native search retained result exceeds byte budget');
  }
  origins.set(result, { inventory, indexes });
  return result;
}
export function assertECOSLinkedNativePageSearch(
  value: unknown,
  inventory: Readonly<ECOSLinkedProjectDocumentInventory>,
  indexes: Readonly<ECOSLinkedProjectDocumentIndexes>,
): asserts value is ECOSLinkedNativePageSearch {
  assertECOSLinkedProjectDocumentInventory(inventory);
  assertECOSLinkedProjectDocumentIndexes(indexes, inventory);
  const origin = value && typeof value === 'object'
    ? origins.get(value)
    : undefined;
  if (!origin || origin.inventory !== inventory || origin.indexes !== indexes) {
    throw new Error(
      'Native search must belong to these exact input inventories',
    );
  }
}
