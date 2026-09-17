/**
 * Dependency-free server counterpart of app/services/ECOSProtectedDocumentPage.ts.
 * Preserve the same strict v2.2 source contract. This verifies identity and bytes,
 * NOT the meaning of pixels. Cross-runtime fixtures exercise protocol parity.
 */
type ECOSDocumentProofClaim = Readonly<{
  documentId: string; projectId: string; sourceSha256: string;
  revision: string; pageNumber: number;
}>;
export const ECOS_PROTECTED_SOURCE_ENDPOINT =
  'https://xdytqlpsqsseoeuxgzre.supabase.co/functions/v1/ecos-source-preview';
const PROTOCOL = 'ecos-owner-source-view/2.2';
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;

type Data = Record<string, unknown>;

export type ECOSProtectedSourceCitation = Readonly<{
  evidence_id: string;
  context_id: string;
  kind: 'visual_page';
  selected: true;
  source_id: string;
  source_sha256: string;
  image_id: 'I01';
  locator: Readonly<{
    organization_id: string;
    project_id: string;
    owner_id: string;
    source_id: string;
    source_sha256: string;
    source_revision: string;
    source_page_count: number;
    page_number: number;
    execution_id: string;
    binding_id: string;
    extraction_version: 'ecos-owner-native-preview/2.0';
    authority_decision_id: string;
    authority_receipt_sha256: string;
    managed_attempt_id: string;
    managed_receipt_sha256: string;
    page_attempt_id: string;
    page_sha256: string;
    image_id: 'I01';
    locator_schema_version: 'ecos-owner-raster-source-locator/2.2';
    image_payload_sha256: string;
    visual_payload_sha256: string | null;
    raster_sha256: string;
    raster_byte_count: number;
    raster_width: number;
    raster_height: number;
    upload_attempt_id: string;
    raster_receipt_sha256: string;
    pixel_box: readonly [0, 0, number, number];
    coordinate_system: 'rotated_display_cropbox_pixels_top_left';
    anchor_kind: 'whole_verified_page_image_not_text_quote';
  }>;
}>;

export type ECOSProtectedDocumentPage = Readonly<{
  dataUrl: string;
  width: number;
  height: number;
  sha256: string;
}>;

export class ECOSProtectedDocumentPageError extends Error {
  constructor(message = 'The protected cited page could not be safely opened.') {
    super(message);
    this.name = 'ECOSProtectedDocumentPageError';
  }
}

export function normalizeECOSProtectedSourceCitation(
  raw: unknown,
  claim: ECOSDocumentProofClaim,
): ECOSProtectedSourceCitation | null {
  try {
    const citation = exactObject(raw, [
      'evidence_id', 'context_id', 'kind', 'selected', 'source_id',
      'source_sha256', 'image_id', 'locator',
    ]);
    const locator = exactObject(citation.locator, [
      'organization_id', 'project_id', 'owner_id', 'source_id',
      'source_sha256', 'source_revision', 'source_page_count', 'page_number',
      'execution_id', 'binding_id', 'extraction_version',
      'authority_decision_id', 'authority_receipt_sha256',
      'managed_attempt_id', 'managed_receipt_sha256', 'page_attempt_id',
      'page_sha256', 'image_id', 'locator_schema_version',
      'image_payload_sha256', 'visual_payload_sha256', 'raster_sha256',
      'raster_byte_count', 'raster_width', 'raster_height',
      'upload_attempt_id', 'raster_receipt_sha256', 'pixel_box',
      'coordinate_system', 'anchor_kind',
    ]);
    if (
      citation.evidence_id !== 'e1' || citation.context_id !== 's1' ||
      citation.kind !== 'visual_page' || citation.selected !== true ||
      citation.image_id !== 'I01' || locator.image_id !== 'I01' ||
      citation.source_id !== claim.documentId ||
      citation.source_sha256 !== claim.sourceSha256 ||
      locator.source_id !== claim.documentId ||
      locator.source_sha256 !== claim.sourceSha256 ||
      locator.project_id !== claim.projectId ||
      locator.source_revision !== claim.revision ||
      locator.page_number !== claim.pageNumber ||
      locator.organization_id !== locator.owner_id ||
      locator.extraction_version !== 'ecos-owner-native-preview/2.0' ||
      locator.locator_schema_version !== 'ecos-owner-raster-source-locator/2.2' ||
      locator.coordinate_system !== 'rotated_display_cropbox_pixels_top_left' ||
      locator.anchor_kind !== 'whole_verified_page_image_not_text_quote'
    ) return null;
    for (const value of [
      locator.organization_id, locator.project_id, locator.owner_id,
      locator.execution_id, locator.binding_id, locator.authority_decision_id,
      locator.managed_attempt_id, locator.page_attempt_id,
    ]) if (!validUuid(value)) return null;
    if (!validUuid(locator.upload_attempt_id, true)) return null;
    for (const value of [
      citation.source_sha256, locator.authority_receipt_sha256,
      locator.managed_receipt_sha256, locator.page_sha256,
      locator.image_payload_sha256, locator.raster_sha256,
      locator.raster_receipt_sha256,
    ]) if (!validSha(value)) return null;
    if (locator.visual_payload_sha256 !== null && !validSha(locator.visual_payload_sha256)) {
      return null;
    }
    const pageCount = positiveInteger(locator.source_page_count, 10_000);
    const byteCount = positiveInteger(locator.raster_byte_count, MAX_IMAGE_BYTES);
    const width = positiveInteger(locator.raster_width, 8_000);
    const height = positiveInteger(locator.raster_height, 8_000);
    if (
      !pageCount || claim.pageNumber > pageCount || !byteCount || byteCount < 33 ||
      !width || !height || width * height > 24_000_000 ||
      !Array.isArray(locator.pixel_box) || locator.pixel_box.length !== 4 ||
      locator.pixel_box[0] !== 0 || locator.pixel_box[1] !== 0 ||
      locator.pixel_box[2] !== width || locator.pixel_box[3] !== height
    ) return null;
    return deepFreeze({
      evidence_id: 'e1',
      context_id: 's1',
      kind: 'visual_page',
      selected: true,
      source_id: claim.documentId,
      source_sha256: claim.sourceSha256,
      image_id: 'I01',
      locator: {
        ...locator,
        pixel_box: [0, 0, width, height],
      },
    }) as unknown as ECOSProtectedSourceCitation;
  } catch {
    return null;
  }
}

export async function readBoundedText(response: Response, maximum: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!response.body) throw new ECOSProtectedDocumentPageError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, {once: true});
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (!(value instanceof Uint8Array) || chunks.length >= 65_536) {
        throw new ECOSProtectedDocumentPageError();
      }
      size += value.byteLength;
      if (size > maximum) throw new ECOSProtectedDocumentPageError();
      chunks.push(value.slice());
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
    try { reader.releaseLock(); } catch { /* best effort */ }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ECOSProtectedDocumentPageError();
  }
}

export async function validateSourceResponse(
  raw: unknown,
  expected: Readonly<{
    requestId: string;
    projectId: string;
    citation: ECOSProtectedSourceCitation;
  }>,
): Promise<ECOSProtectedDocumentPage> {
  const root = exactObject(raw, [
    'schemaVersion', 'projectId', 'requestId', 'preview', 'read_only',
    'server_checks', 'source',
  ]);
  if (
    root.schemaVersion !== PROTOCOL || root.projectId !== expected.projectId ||
    root.requestId !== expected.requestId || root.preview !== true ||
    root.read_only !== true ||
    root.server_checks !== 'owner_before_and_after_source_read_only'
  ) throw new ECOSProtectedDocumentPageError();
  const source = exactObject(root.source, ['kind', 'result', 'png']);
  if (source.kind !== 'document_page') throw new ECOSProtectedDocumentPageError();
  const result = exactObject(source.result, [
    'schema_version', 'state', 'citation', 'page', 'raster', 'image_relation',
    'authorization', 'highlight', 'coordinate_relationship', 'freshness',
    'inventory_epoch_sha256', 'index_epoch_sha256', 'semantic_verified',
    'whole_answer_verified', 'atomic_project_snapshot', 'retrieval_authorized',
  ]);
  if (
    result.schema_version !== 'ecos-owner-document-source-view/2.1' ||
    result.state !== 'current_exact_page_image' ||
    !same(result.citation, expected.citation) ||
    result.image_relation !== 'exact_cited_visual_receipt' ||
    result.authorization !== 'caller_required_before_and_after' ||
    result.highlight !== null ||
    result.coordinate_relationship !== 'native_pdf_points_and_rotated_raster_pixels_not_converted' ||
    result.freshness !== 'fresh_sequential_source_page_and_raster_readbacks_only' ||
    result.semantic_verified !== false || result.whole_answer_verified !== false ||
    result.atomic_project_snapshot !== false || result.retrieval_authorized !== false ||
    !validSha(result.inventory_epoch_sha256) || !validSha(result.index_epoch_sha256)
  ) throw new ECOSProtectedDocumentPageError();
  const locator = expected.citation.locator;
  const page = exactObject(result.page, [
    'organization_id', 'project_id', 'owner_id', 'source_id', 'source_sha256',
    'source_revision', 'source_page_count', 'page_number', 'execution_id',
    'binding_id', 'extraction_version', 'authority_decision_id',
    'authority_receipt_sha256', 'managed_attempt_id',
    'managed_receipt_sha256', 'page_attempt_id', 'page_sha256',
  ]);
  for (const key of Object.keys(page)) {
    if (!same(page[key], (locator as unknown as Data)[key])) {
      throw new ECOSProtectedDocumentPageError();
    }
  }
  const raster = exactObject(result.raster, [
    'locator_schema_version', 'image_payload_sha256', 'visual_payload_sha256',
    'raster_sha256', 'raster_byte_count', 'raster_width', 'raster_height',
    'upload_attempt_id', 'raster_receipt_sha256', 'pixel_box',
    'coordinate_system', 'anchor_kind',
  ]);
  for (const key of Object.keys(raster)) {
    if (!same(raster[key], (locator as unknown as Data)[key])) {
      throw new ECOSProtectedDocumentPageError();
    }
  }
  const png = exactObject(source.png, ['media_type', 'encoding', 'data']);
  if (png.media_type !== 'image/png' || png.encoding !== 'base64' || typeof png.data !== 'string') {
    throw new ECOSProtectedDocumentPageError();
  }
  const base64 = png.data;
  if (
    base64.length % 4 || base64.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) throw new ECOSProtectedDocumentPageError();
  let bytes: Uint8Array;
  try { bytes = toByteArray(base64); } catch { throw new ECOSProtectedDocumentPageError(); }
  if (
    bytes.length !== locator.raster_byte_count || fromByteArray(bytes) !== base64 ||
    (await digest(bytes)) !== locator.raster_sha256 ||
    bytes.length < 33 || bytes.length > MAX_IMAGE_BYTES ||
    !same([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  ) throw new ECOSProtectedDocumentPageError();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(8) !== 13 ||
    !same([...bytes.slice(12, 16)], [73, 72, 68, 82]) ||
    view.getUint32(16) !== locator.raster_width ||
    view.getUint32(20) !== locator.raster_height
  ) throw new ECOSProtectedDocumentPageError();
  return Object.freeze({
    dataUrl: `data:image/png;base64,${base64}`,
    width: locator.raster_width,
    height: locator.raster_height,
    sha256: locator.raster_sha256,
  });
}

function exactObject(value: unknown, keys: readonly string[]): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ECOSProtectedDocumentPageError();
  }
  const names = Object.keys(value);
  if (names.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new ECOSProtectedDocumentPageError();
  }
  return value as Data;
}

export function parseStrictJSON(text: string): unknown {
  let index = 0;
  const whitespace = () => {
    while (index < text.length && /[\x20\t\r\n]/.test(text[index])) index += 1;
  };
  const stringToken = () => {
    const start = index++;
    while (index < text.length) {
      if (text[index] === '"') {
        try {
          return JSON.parse(text.slice(start, ++index));
        } catch {
          throw new ECOSProtectedDocumentPageError();
        }
      }
      if (text[index++] === '\\') index += 1;
    }
    throw new ECOSProtectedDocumentPageError();
  };
  let nodes = 0;
  const visit = (depth: number): void => {
    if (++nodes > 48_000 || depth > 24) throw new ECOSProtectedDocumentPageError();
    whitespace();
    if (text[index] === '"') { stringToken(); return; }
    if (text[index] === '{' || text[index] === '[') {
      const object = text[index++] === '{';
      const end = object ? '}' : ']';
      const seen = new Set<string>();
      whitespace();
      if (text[index] === end) { index += 1; return; }
      while (true) {
        if (object) {
          if (text[index] !== '"') throw new ECOSProtectedDocumentPageError();
          const key = stringToken();
          if (seen.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
            throw new ECOSProtectedDocumentPageError();
          }
          seen.add(key);
          whitespace();
          if (text[index++] !== ':') throw new ECOSProtectedDocumentPageError();
        }
        visit(depth + 1);
        whitespace();
        if (text[index] === end) { index += 1; return; }
        if (text[index++] !== ',') throw new ECOSProtectedDocumentPageError();
        whitespace();
      }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/
      .exec(text.slice(index));
    if (!token) throw new ECOSProtectedDocumentPageError();
    index += token[0].length;
  };
  visit(0);
  whitespace();
  if (index !== text.length) throw new ECOSProtectedDocumentPageError();
  try { return JSON.parse(text); } catch { throw new ECOSProtectedDocumentPageError(); }
}

function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => same(value, right[index]));
  }
  const a = left as Data;
  const b = right as Data;
  return Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
}

function validUuid(value: unknown, versionFour = false): value is string {
  return typeof value === 'string' && UUID.test(value) && (!versionFour || value[14] === '4');
}

function validSha(value: unknown): value is string {
  return typeof value === 'string' && SHA.test(value);
}

function positiveInteger(value: unknown, maximum: number) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum
    ? value
    : null;
}

async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}

function toByteArray(value: string): Uint8Array {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

function fromByteArray(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
