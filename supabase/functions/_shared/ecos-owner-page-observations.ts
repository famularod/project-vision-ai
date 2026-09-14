import {
  assertECOSOwnerExecutionResult,
  type ECOSOwnerExecutionRequest,
  type ECOSOwnerExecutionResult,
} from './ecos-owner-source-execution.ts';
import {
  assertECOSLinkedOwnerProjectDocumentIndexes,
  type ECOSLinkedOwnerProjectDocumentIndexes,
} from './ecos-linked-owner-project-document-indexes.ts';
import type { ECOSLinkedOwnerProjectDocumentInventory } from './ecos-linked-owner-project-document-inventory.ts';

/** Exact read-time owner checkpoints, not evidence or image availability.
 * Geometry, OCR hierarchy, table cells and native spans remain RAW observations.
 * No HostedJob conversion, semantic projection, truncation or authorization. */
export type ECOSOwnerRawJSON =
  | null
  | boolean
  | number
  | string
  | readonly ECOSOwnerRawJSON[]
  | { readonly [key: string]: ECOSOwnerRawJSON };
type ObjectJSON = { [key: string]: ECOSOwnerRawJSON };
type Lane = 'native' | 'table' | 'visual';
type State = 'partial' | 'unreadable' | 'failed' | 'not_attempted';
export interface ECOSOwnerPageReadExpectation {
  pageNumber: number;
  expectedAttemptId: string | null;
  expectedPageSha256: string | null;
}
export interface ECOSOwnerIndexedPageSelection {
  sourceId: string;
  pageNumber: number;
}
type OwnerPageIdentity =
  & Pick<
    ECOSOwnerExecutionRequest,
    | 'owner_id'
    | 'project_id'
    | 'execution_id'
    | 'source_id'
    | 'source_sha256'
    | 'source_revision'
    | 'source_page_count'
    | 'extraction_version'
  >
  & { binding_id: string };
export interface ECOSOwnerPageModalitySummary {
  readonly state: State;
  readonly payload_sha256: string | null;
  readonly payload_bytes: number;
  readonly limitation_codes: readonly string[];
}
export interface ECOSOwnerPageHead {
  readonly attempt_id: string;
  readonly page_sha256: string;
  readonly version: number;
  readonly previous_attempt_id: string | null;
  readonly recorded_at: string;
  readonly modalities: Readonly<Record<Lane, ECOSOwnerPageModalitySummary>>;
}
export interface ECOSOwnerRawModality {
  readonly state: State;
  readonly payload_json: string | null;
  readonly limitation_codes: readonly string[];
  readonly observations: ECOSOwnerRawJSON;
}
export interface ECOSOwnerPageObservationsRead {
  readonly schema_version: 'ecos-owner-page-observation-checkpoint/2.1';
  readonly publication_mode: 'shadow';
  readonly owner_id: string;
  readonly organization_id: string;
  readonly project_id: string;
  readonly execution_id: string;
  readonly binding_id: string;
  readonly source_id: string;
  readonly source_sha256: string;
  readonly source_revision: string | null;
  readonly source_page_count: number;
  readonly extraction_version: 'ecos-owner-native-preview/2.0';
  readonly page_number: number;
  readonly requested_attempt_id: string | null;
  readonly state: 'current' | 'old' | 'stale' | 'missing';
  readonly outcome: 'read';
  readonly head: ECOSOwnerPageHead | null;
  readonly page_json: string | null;
  readonly modalities: Readonly<Record<Lane, ECOSOwnerRawModality>> | null;
  readonly validation: 'raw_checkpoint_identity_and_byte_bounds_only';
  readonly geometry_validation: 'not_performed';
  readonly verification: 'raw_payload_hash_and_modality_headers_only';
  readonly currentness: 'at_page_read_only_not_atomic_with_execution_read';
  readonly image_available: false;
  readonly retrieval_authorized: false;
  readonly semantic_verified: false;
}
export interface ECOSOwnerIndexedPageObservationsRead
  extends Omit<ECOSOwnerPageObservationsRead, 'currentness'> {
  readonly binding_basis: 'complete_owner_index_selected_head';
  readonly inventory_epoch_sha256: string;
  readonly index_epoch_sha256: string;
  readonly currentness: 'at_page_read_only_not_atomic_with_index_snapshot';
}
const MiB = 1024 * 1024;
const limits = { native: MiB, table: 3 * MiB, visual: 4 * MiB };
const lanes: readonly Lane[] = ['native', 'table', 'visual'];
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const origins = new WeakMap<object, {
  request: Readonly<ECOSOwnerExecutionRequest>;
  executionRead: Readonly<ECOSOwnerExecutionResult>;
}>();
const indexedOrigins = new WeakMap<object, {
  inventory: ECOSLinkedOwnerProjectDocumentInventory;
  indexes: ECOSLinkedOwnerProjectDocumentIndexes;
}>();
const reject = (): never => {
  throw new Error('Owner page observations rejected');
};
function unicode(value: string) {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0 || c >= 0xdc00 && c <= 0xdfff) return reject();
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return reject();
    }
  }
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) return reject();
  unicode(value);
  if (encoder.encode(value).length > max) return reject();
  return value;
}
function exact(value: unknown, keys: readonly string[]): ObjectJSON {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return reject();
  }
  const found = Object.keys(value);
  if (
    found.length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) return reject();
  return value as ObjectJSON;
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) || value < min ||
    value > max
  ) return reject();
  return value;
}
function sha(value: unknown): string {
  if (typeof value !== 'string' || !SHA.test(value)) return reject();
  return value;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) return reject();
  return value;
}
function codes(value: ECOSOwnerRawJSON): readonly string[] {
  if (
    !Array.isArray(value) || value.length < 1 || value.length > 32 ||
    value.some((v) =>
      typeof v !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(v)
    ) ||
    new Set(value).size !== value.length
  ) return reject();
  return value as readonly string[];
}
function state(value: ECOSOwnerRawJSON): State {
  if (
    !['partial', 'unreadable', 'failed', 'not_attempted'].includes(
      value as string,
    )
  ) return reject();
  return value as State;
}
function same(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) return reject();
}
async function hash(raw: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(raw)),
    ),
  ].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** Copy the SMALL envelope before the first digest. The large page is a string.
 * Fail accessors/prototypes rather than invoke application code while copying. */
function snapshot(value: unknown): ECOSOwnerRawJSON {
  let nodes = 0;
  function copy(v: unknown, depth: number): ECOSOwnerRawJSON {
    if (++nodes > 2048 || depth > 12) return reject();
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') return text(v, 12 * MiB);
    if (typeof v === 'number') return Number.isFinite(v) ? v : reject();
    if (!v || typeof v !== 'object') return reject();
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (
      array
        ? proto !== Array.prototype
        : proto !== Object.prototype && proto !== null
    ) return reject();
    const descriptors = Object.getOwnPropertyDescriptors(v),
      keys = Reflect.ownKeys(v);
    if (array && (v as unknown[]).length > 128) return reject();
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (
        typeof key !== 'string' ||
        ['__proto__', 'constructor', 'prototype'].includes(key) ||
        !descriptors[key].enumerable ||
        !Object.hasOwn(descriptors[key], 'value')
      ) return reject();
    }
    if (array) {
      if (keys.length !== (v as unknown[]).length + 1) return reject();
      return Array.from({ length: (v as unknown[]).length }, (_, i) => {
        if (!Object.hasOwn(descriptors, String(i))) return reject();
        return copy(descriptors[i].value, depth + 1);
      });
    }
    return Object.fromEntries(
      keys.map((k) => [k, copy(descriptors[k as string].value, depth + 1)]),
    );
  }
  return copy(value, 0);
}
/** Bounded JSON parser: detects duplicate/unsafe keys at EVERY depth and tracks
 * header number tokens so 1.00000000000000001 cannot become integer 1. Unknown
 * raw geometry is retained but deliberately is not interpreted/validated here. */
function parse(raw: string, max: number) {
  text(raw, max);
  let offset = 0, nodes = 0;
  const numbers = new Map<string, string>();
  const ws = () => {
    while (/[\t\n\r ]/.test(raw[offset] ?? '') && offset < raw.length) offset++;
  };
  function string() {
    const start = offset++;
    while (offset < raw.length) {
      const c = raw[offset++];
      if (c === '\\') offset++;
      else if (c === '"') {
        const value = JSON.parse(raw.slice(start, offset));
        unicode(value);
        return value as string;
      }
    }
    return reject();
  }
  function value(path: string, depth: number): ECOSOwnerRawJSON {
    if (++nodes > 400000 || depth > 64) return reject();
    ws();
    const c = raw[offset];
    if (c === '"') return string();
    if (c === '{' || c === '[') {
      const object = c === '{', close = object ? '}' : ']';
      offset++;
      ws();
      const out: ObjectJSON = {}, list: ECOSOwnerRawJSON[] = [];
      if (raw[offset] === close) {
        offset++;
        return object ? out : list;
      }
      while (offset < raw.length) {
        let key = String(list.length);
        if (object) {
          if (raw[offset] !== '"') return reject();
          key = string();
          ws();
          if (
            Object.hasOwn(out, key) ||
            ['__proto__', 'constructor', 'prototype'].includes(key) ||
            raw[offset++] !== ':'
          ) return reject();
        }
        const item = value(`${path}/${key}`, depth + 1);
        if (object) out[key] = item;
        else list.push(item);
        ws();
        const separator = raw[offset++];
        if (separator === close) return object ? out : list;
        if (separator !== ',') return reject();
        ws();
      }
      return reject();
    }
    for (
      const [token, literal] of [['true', true], ['false', false], [
        'null',
        null,
      ]] as const
    ) {
      if (raw.startsWith(token, offset)) {
        offset += token.length;
        return literal;
      }
    }
    const token = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      raw.slice(offset),
    )?.[0];
    if (!token || !Number.isFinite(Number(token))) return reject();
    offset += token.length;
    if (depth <= 3) numbers.set(path, token);
    return Number(token);
  }
  const result = value('', 0);
  ws();
  if (
    offset !== raw.length || !result || typeof result !== 'object' ||
    Array.isArray(result)
  ) return reject();
  return { value: result as ObjectJSON, numbers };
}
function rawInteger(
  parsed: ReturnType<typeof parse>,
  key: string,
  value: unknown,
  min: number,
  max: number,
) {
  if (!/^(0|[1-9][0-9]*)$/.test(parsed.numbers.get(key) ?? '')) return reject();
  return integer(value, min, max);
}
const sharedPayloadKeys = [
  'schema_version',
  'extraction_version',
  'source_sha256',
  'source_page_count',
  'page_number',
  'page_width',
  'page_height',
  'coordinate_system',
  'state',
  'limitation_codes',
  'retrieval_authorized',
  'semantic_verified',
  'source_identity_basis',
];
async function payload(
  lane: Lane,
  raw: string,
  wrapper: ObjectJSON,
  r: Readonly<OwnerPageIdentity>,
  pageNumber: number,
) {
  const parsed = parse(raw, limits[lane]), p = parsed.value;
  if (
    p.state !== wrapper.state || p.retrieval_authorized !== false ||
    p.semantic_verified !== false
  ) return reject();
  codes(p.limitation_codes);
  let source = p, prefix = '';
  if (lane !== 'visual') {
    exact(p, [
      ...sharedPayloadKeys,
      ...(lane === 'native'
        ? [
          'page_text',
          'page_text_sha256',
          'observed_native_block_count',
          'excerpts',
        ]
        : ['tables']),
    ]);
    if (
      p.schema_version !==
        `ecos-original-${
          lane === 'native' ? 'native' : 'table'
        }-observations/2.1` ||
      p.extraction_version !==
        (lane === 'native'
          ? 'ecos-native-page-excerpts/2.0'
          : 'ecos-native-table-sources/2.0') ||
      p.coordinate_system !== 'pdf_points_top_left' ||
      p.source_identity_basis !== 'caller_supplied_pins_require_measured_bytes'
    ) return reject();
    for (const key of ['page_width', 'page_height']) {
      if (
        typeof p[key] !== 'number' || (p[key] as number) < 1e-9 ||
        (p[key] as number) > 100000
      ) return reject();
    }
    same(p.limitation_codes, wrapper.limitation_codes);
    const items = p[lane === 'native' ? 'excerpts' : 'tables'];
    if (
      !Array.isArray(items) || items.length > (lane === 'native' ? 256 : 16) ||
      (p.state === 'partial' ? items.length === 0 : items.length !== 0)
    ) return reject();
    if (lane === 'native') {
      const nativeText = text(p.page_text, 128 * 1024);
      if (
        (p.state === 'partial'
          ? nativeText.length === 0
          : nativeText.length !== 0) ||
        await hash(nativeText) !== sha(p.page_text_sha256)
      ) return reject();
      rawInteger(
        parsed,
        '/observed_native_block_count',
        p.observed_native_block_count,
        0,
        9999999,
      );
    }
  } else {
    exact(p, [
      'schema_version',
      'source',
      'raster',
      'engine',
      'raw_tsv_sha256',
      'raw_tsv_bytes',
      'observed_row_count',
      'observed_word_count',
      'low_engine_confidence_word_count',
      'geometry_conflicts',
      'state',
      'lines',
      'limitation_codes',
      'retrieval_authorized',
      'semantic_verified',
    ]);
    if (
      p.schema_version !== 'ecos-page-visual-observations/2.1' ||
      !['partial', 'unreadable'].includes(p.state as string)
    ) return reject();
    source = exact(p.source, [
      'source_sha256',
      'source_page_count',
      'page_number',
      'rotation_degrees',
      'display_width_points',
      'display_height_points',
      'cropbox',
      'mediabox',
    ]);
    prefix = '/source';
    const raster = exact(p.raster, [
      'sha256',
      'byte_count',
      'width',
      'height',
      'coordinate_system',
      'hash_scope',
      'decode_verified_by_parser',
    ]);
    sha(raster.sha256);
    if (
      raster.coordinate_system !== 'rotated_display_cropbox_pixels_top_left' ||
      raster.hash_scope !== 'exact_png_bytes' ||
      raster.decode_verified_by_parser !== false
    ) return reject();
    const width = rawInteger(parsed, '/raster/width', raster.width, 1, 8000),
      height = rawInteger(parsed, '/raster/height', raster.height, 1, 8000);
    rawInteger(parsed, '/raster/byte_count', raster.byte_count, 1, 32 * MiB);
    const words = rawInteger(
      parsed,
      '/observed_word_count',
      p.observed_word_count,
      0,
      10000,
    );
    if (
      width * height > 24000000 || !Array.isArray(p.lines) ||
      p.lines.length > 16000 || !Array.isArray(p.geometry_conflicts) ||
      (p.state === 'partial' ? words === 0 : words !== 0)
    ) return reject();
  }
  if (
    source.source_sha256 !== r.source_sha256 ||
    rawInteger(
        parsed,
        prefix + '/source_page_count',
        source.source_page_count,
        1,
        10000,
      ) !== r.source_page_count ||
    rawInteger(
        parsed,
        prefix + '/page_number',
        source.page_number,
        1,
        r.source_page_count,
      ) !== pageNumber
  ) return reject();
  return p;
}

export async function bindECOSOwnerPageObservationsRead(
  raw: unknown,
  request: Readonly<ECOSOwnerExecutionRequest>,
  executionRead: Readonly<ECOSOwnerExecutionResult>,
  expected: ECOSOwnerPageReadExpectation,
): Promise<Readonly<ECOSOwnerPageObservationsRead>> {
  try {
    assertECOSOwnerExecutionResult(executionRead, request);
    if (
      executionRead.outcome !== 'read' ||
      !executionRead.binding_matches_request || !executionRead.source ||
      !['queued', 'running', 'released', 'failed', 'expired'].includes(
        executionRead.state,
      )
    ) return reject();
    const result = await bindRawPageRead(raw, {
      owner_id: request.owner_id,
      project_id: request.project_id,
      execution_id: request.execution_id,
      binding_id: request.request_id,
      source_id: request.source_id,
      source_sha256: request.source_sha256,
      source_revision: request.source_revision,
      source_page_count: request.source_page_count,
      extraction_version: request.extraction_version,
    }, expected);
    if (result.binding_id !== executionRead.binding_id) return reject();
    origins.set(result, { request, executionRead });
    return result;
  } catch {
    return reject();
  }
}
/** Shared identity/hash mechanics only. This private core cannot establish an
 * execution-request or inventory brand and is never a public trust entrypoint. */
async function bindRawPageRead(
  raw: unknown,
  request: Readonly<OwnerPageIdentity>,
  expected: ECOSOwnerPageReadExpectation,
): Promise<Readonly<ECOSOwnerPageObservationsRead>> {
  try {
    const e = exact(snapshot(expected), [
      'pageNumber',
      'expectedAttemptId',
      'expectedPageSha256',
    ]);
    const pageNumber = integer(e.pageNumber, 1, request.source_page_count);
    if (e.expectedAttemptId !== null) uuid(e.expectedAttemptId);
    if (e.expectedPageSha256 !== null) {
      sha(e.expectedPageSha256);
      if (e.expectedAttemptId === null) return reject();
    }
    const r = exact(snapshot(raw), [
      'schema_version',
      'publication_mode',
      'owner_id',
      'organization_id',
      'project_id',
      'execution_id',
      'binding_id',
      'source_id',
      'source_sha256',
      'source_revision',
      'source_page_count',
      'extraction_version',
      'page_number',
      'requested_attempt_id',
      'state',
      'outcome',
      'head',
      'page_json',
      'validation',
      'image_available',
      'retrieval_authorized',
      'semantic_verified',
    ]);
    if (encoder.encode(JSON.stringify(r)).length > 25 * MiB) return reject();
    for (
      const key of [
        'owner_id',
        'project_id',
        'execution_id',
        'source_id',
        'source_sha256',
        'source_revision',
        'source_page_count',
        'extraction_version',
      ] as const
    ) same(r[key], request[key]);
    if (
      r.organization_id !== request.owner_id ||
      r.binding_id !== request.binding_id ||
      r.page_number !== pageNumber ||
      r.requested_attempt_id !== e.expectedAttemptId ||
      r.schema_version !== 'ecos-owner-page-observation-checkpoint/2.1' ||
      r.publication_mode !== 'shadow' || r.outcome !== 'read' ||
      !['current', 'old', 'stale', 'missing'].includes(r.state as string) ||
      r.validation !== 'raw_checkpoint_identity_and_byte_bounds_only' ||
      r.image_available !== false || r.retrieval_authorized !== false ||
      r.semantic_verified !== false
    ) return reject();
    let head: ECOSOwnerPageHead | null = null;
    if (r.head !== null) {
      const h = exact(r.head, [
        'attempt_id',
        'page_sha256',
        'version',
        'previous_attempt_id',
        'recorded_at',
        'modalities',
      ]);
      uuid(h.attempt_id);
      sha(h.page_sha256);
      integer(h.version, 1, 32);
      if (h.previous_attempt_id !== null) uuid(h.previous_attempt_id);
      if (
        (h.version === 1) !== (h.previous_attempt_id === null) ||
        h.previous_attempt_id === h.attempt_id
      ) return reject();
      const stamp = text(h.recorded_at, 32), date = Date.parse(stamp);
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/
          .test(stamp) ||
        !Number.isFinite(date) ||
        new Date(date).toISOString().slice(0, 19) !== stamp.slice(0, 19)
      ) return reject();
      const modalities = exact(h.modalities, lanes);
      for (const lane of lanes) {
        const m = exact(modalities[lane], [
          'state',
          'payload_sha256',
          'payload_bytes',
          'limitation_codes',
        ]);
        state(m.state);
        codes(m.limitation_codes);
        integer(m.payload_bytes, 0, limits[lane]);
        if (m.payload_sha256 === null) {
          if (
            m.payload_bytes !== 0 ||
            !['failed', 'not_attempted'].includes(m.state as string)
          ) return reject();
        } else {
          sha(m.payload_sha256);
          if (
            (m.payload_bytes as number) < 2 || m.state === 'not_attempted' ||
            lane === 'visual' && m.state === 'failed'
          ) return reject();
        }
      }
      head = h as unknown as ECOSOwnerPageHead;
    }
    let modalities: Record<Lane, ECOSOwnerRawModality> | null = null;
    if (r.state === 'current') {
      if (
        !head ||
        e.expectedAttemptId !== null &&
          e.expectedAttemptId !== head.attempt_id ||
        e.expectedPageSha256 !== null &&
          e.expectedPageSha256 !== head.page_sha256
      ) return reject();
      const pageRaw = text(r.page_json, 12 * MiB);
      if (await hash(pageRaw) !== head.page_sha256) return reject();
      const parsed = parse(pageRaw, 12 * MiB),
        p = exact(parsed.value, [
          'schema_version',
          'source_sha256',
          'source_revision',
          'source_page_count',
          'page_number',
          'extraction_version',
          'modalities',
        ]);
      if (
        p.schema_version !== 'ecos-owner-page-observations/2.1' ||
        p.source_sha256 !== request.source_sha256 ||
        p.source_revision !== request.source_revision ||
        p.extraction_version !== request.extraction_version ||
        rawInteger(
            parsed,
            '/source_page_count',
            p.source_page_count,
            1,
            10000,
          ) !== request.source_page_count ||
        rawInteger(
            parsed,
            '/page_number',
            p.page_number,
            1,
            request.source_page_count,
          ) !== pageNumber
      ) return reject();
      const slots = exact(p.modalities, lanes);
      modalities = {} as Record<Lane, ECOSOwnerRawModality>;
      for (const lane of lanes) {
        const s = exact(slots[lane], [
            'state',
            'payload_json',
            'limitation_codes',
          ]),
          summary = head.modalities[lane];
        if (s.state !== summary.state) return reject();
        same(s.limitation_codes, summary.limitation_codes);
        let observations: ECOSOwnerRawJSON = null;
        if (s.payload_json === null) {
          if (summary.payload_sha256 !== null || summary.payload_bytes !== 0) {
            return reject();
          }
        } else {
          const rawPayload = text(s.payload_json, limits[lane]);
          if (
            encoder.encode(rawPayload).length !== summary.payload_bytes ||
            await hash(rawPayload) !== summary.payload_sha256
          ) return reject();
          observations = await payload(
            lane,
            rawPayload,
            s,
            request,
            pageNumber,
          );
        }
        modalities[lane] = {
          state: summary.state,
          payload_json: s.payload_json as string | null,
          limitation_codes: summary.limitation_codes,
          observations,
        };
      }
    } else {
      if (r.page_json !== null) return reject();
      if (
        r.state === 'old' &&
        (!head || e.expectedAttemptId === null ||
          e.expectedAttemptId === head.attempt_id)
      ) return reject();
      if (
        r.state === 'missing' && head &&
        (e.expectedAttemptId === null ||
          e.expectedAttemptId === head.attempt_id)
      ) return reject();
    }
    const result = {
      ...r,
      head,
      modalities,
      geometry_validation: 'not_performed',
      verification: 'raw_payload_hash_and_modality_headers_only',
      currentness: 'at_page_read_only_not_atomic_with_execution_read',
    } as unknown as ECOSOwnerPageObservationsRead;
    // Separate retained serialized representation bound (not a total RSS claim).
    // Includes exact raw strings PLUS parsed modality objects; never truncate.
    if (encoder.encode(JSON.stringify(result)).length > 64 * MiB) {
      return reject();
    }
    freeze(result);
    return result;
  } catch {
    return reject();
  }
}
export async function bindECOSOwnerIndexedPageObservationsRead(
  raw: unknown,
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
  selection: ECOSOwnerIndexedPageSelection,
): Promise<Readonly<ECOSOwnerIndexedPageObservationsRead>> {
  try {
    assertECOSLinkedOwnerProjectDocumentIndexes(indexes, inventory);
    const selected = exact(snapshot(selection), ['sourceId', 'pageNumber']);
    const source = indexes.sources.find((s) =>
      s.source.source_id === selected.sourceId
    );
    const execution = source?.resolution.execution;
    if (
      !source || !execution ||
      !['execution_current', 'execution_in_progress'].includes(
        source.resolution.resolution_state,
      )
    ) return reject();
    const pageNumber = integer(
      selected.pageNumber,
      1,
      execution.source_page_count,
    );
    const head = source.pages.find((p) => p.page_number === pageNumber)?.head;
    if (!head) return reject();
    const result = await bindRawPageRead(raw, {
      owner_id: inventory.owner_id,
      project_id: inventory.project_id,
      execution_id: execution.execution_id,
      binding_id: execution.binding_id,
      source_id: source.source.source_id,
      source_sha256: execution.source_sha256,
      source_revision: execution.source_revision,
      source_page_count: execution.source_page_count,
      extraction_version: execution.extraction_version,
    }, {
      pageNumber,
      expectedAttemptId: head.attempt_id,
      expectedPageSha256: head.page_sha256,
    });
    if (result.state !== 'current' || !result.head) return reject();
    for (
      const key of [
        'attempt_id',
        'page_sha256',
        'version',
        'previous_attempt_id',
        'recorded_at',
      ] as const
    ) same(result.head[key], head[key]);
    for (const lane of lanes) {
      for (
        const key of [
          'state',
          'payload_sha256',
          'payload_bytes',
          'limitation_codes',
        ] as const
      ) same(result.head.modalities[lane][key], head.modalities[lane][key]);
    }
    const bound: ECOSOwnerIndexedPageObservationsRead = Object.freeze({
      ...result,
      binding_basis: 'complete_owner_index_selected_head',
      inventory_epoch_sha256: inventory.epoch_sha256,
      index_epoch_sha256: indexes.index_epoch_sha256,
      currentness: 'at_page_read_only_not_atomic_with_index_snapshot',
    });
    indexedOrigins.set(bound, { inventory, indexes });
    return bound;
  } catch {
    return reject();
  }
}
export function assertECOSOwnerIndexedPageObservationsRead(
  value: unknown,
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
): asserts value is Readonly<ECOSOwnerIndexedPageObservationsRead> {
  assertECOSLinkedOwnerProjectDocumentIndexes(indexes, inventory);
  const origin = value && typeof value === 'object'
    ? indexedOrigins.get(value)
    : null;
  if (!origin || origin.inventory !== inventory || origin.indexes !== indexes) {
    return reject();
  }
}
export function assertECOSOwnerPageObservationsRead(
  value: unknown,
  request: Readonly<ECOSOwnerExecutionRequest>,
  executionRead: Readonly<ECOSOwnerExecutionResult>,
): asserts value is Readonly<ECOSOwnerPageObservationsRead> {
  const origin = value && typeof value === 'object' ? origins.get(value) : null;
  if (
    !origin || origin.request !== request ||
    origin.executionRead !== executionRead
  ) return reject();
  assertECOSOwnerExecutionResult(executionRead, request);
}
