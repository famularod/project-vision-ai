import type { ECOSLinkedOwnerProjectDocumentInventory } from './ecos-linked-owner-project-document-inventory.ts';
import type { ECOSLinkedOwnerProjectDocumentIndexes } from './ecos-linked-owner-project-document-indexes.ts';
import {
  assertECOSOwnerIndexedPageObservationsRead,
  type ECOSOwnerIndexedPageObservationsRead,
} from './ecos-owner-page-observations.ts';

/** A private locator backed by the exact selected raw checkpoint. This is NOT
 * image availability, independent PNG decoding, PDF rendering or model truth. */
export interface ECOSOwnerPageRasterAttestation {
  readonly schema_version:
    | 'ecos-owner-page-raster-attestation/2.1'
    | 'ecos-owner-page-raster-attestation/2.2';
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
  readonly page_attempt_id: string;
  readonly page_sha256: string;
  readonly visual_payload_sha256: string | null;
  readonly image_payload_json?: string;
  readonly image_payload_sha256?: string;
  readonly raster_sha256: string;
  readonly raster_byte_count: number;
  readonly raster_width: number;
  readonly raster_height: number;
  readonly raster_coordinate_system: 'rotated_display_cropbox_pixels_top_left';
  readonly upload_attempt_id: string;
  readonly expected_previous_upload_attempt_id: string | null;
  readonly storage_project_ref: 'xdytqlpsqsseoeuxgzre';
  readonly bucket: 'project-documents';
  readonly object_key: string;
  readonly verification: 'exact_png_sha256_and_independent_decode';
  readonly retrieval_authorized: false;
  readonly semantic_verified: false;
}
export interface ECOSOwnerPageRasterRead {
  readonly state: 'current' | 'missing' | 'old' | 'stale';
  readonly page: Readonly<ECOSOwnerIndexedPageObservationsRead>;
  readonly expected_upload_attempt_id: string | null;
  readonly current_upload_attempt_id: string | null;
  readonly receipt_json: string | null;
  readonly receipt_sha256: string | null;
  readonly attestation: Readonly<ECOSOwnerPageRasterAttestation> | null;
  readonly availability:
    | 'private_locator_requires_verified_download'
    | 'unavailable';
  readonly binding_basis: 'exact_current_indexed_page_and_raster_receipt';
  readonly currentness: 'at_raster_read_only_not_atomic_with_page_or_index';
  readonly raster_bytes_verified: false;
  readonly image_available: false;
  readonly retrieval_authorized: false;
  readonly semantic_verified: false;
}
const encoder = new TextEncoder();
const SHA = /^[a-f0-9]{64}$/;
const UUID4 =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const READ_KEYS =
  'schema_version publication_mode owner_id organization_id project_id execution_id binding_id page_number expected_page_attempt_id expected_page_sha256 expected_upload_attempt_id state current_upload_attempt_id receipt_json receipt_sha256 availability retrieval_authorized semantic_verified'
    .split(' ');
const RECEIPT_KEYS =
  'schema_version publication_mode attestation_json attestation_sha256 version previous_upload_attempt_id committed_at verification retrieval_authorized semantic_verified'
    .split(' ');
const ATTESTATION_KEYS =
  'schema_version publication_mode owner_id organization_id project_id execution_id binding_id source_id source_sha256 source_revision source_page_count extraction_version page_number page_attempt_id page_sha256 visual_payload_sha256 raster_sha256 raster_byte_count raster_width raster_height raster_coordinate_system upload_attempt_id expected_previous_upload_attempt_id storage_project_ref bucket object_key verification retrieval_authorized semantic_verified'
    .split(' ');
const IMAGE_KEYS =
  'schema_version source_sha256 source_page_count page_number state raster_sha256 raster_byte_count raster_width raster_height coordinate_system renderer_sha256 renderer_version requested_dpi ocr_attempted semantic_verified retrieval_authorized'
    .split(' ');
type Data = Record<string, unknown>;
const origins = new WeakMap<object, {
  inventory: ECOSLinkedOwnerProjectDocumentInventory;
  indexes: ECOSLinkedOwnerProjectDocumentIndexes;
  page: ECOSOwnerIndexedPageObservationsRead;
}>();
const fail = (): never => {
  throw new Error('Owner page raster receipt unavailable or changed');
};
function object(value: unknown, keys: readonly string[]): Data {
  if (
    !value || typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(descriptors, k)) ||
    Object.values(descriptors).some((d) =>
      !d.enumerable || !Object.hasOwn(d, 'value')
    )
  ) return fail();
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, d]) => [key, d.value]),
  );
}
function string(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string' || value.length > maximum ||
    encoder.encode(value).length > maximum || value.includes('\0') ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u
      .test(value)
  ) return fail();
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) || value < min ||
    value > max
  ) return fail();
  return value;
}
function upload(value: unknown): string {
  if (typeof value !== 'string' || !UUID4.test(value)) return fail();
  return value;
}
function sha(value: unknown): string {
  if (typeof value !== 'string' || !SHA.test(value)) return fail();
  return value;
}
async function hash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  ].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// Both immutable receipt layers are flat scalar JSON. Scan the EXACT hashed
// text first, rejecting duplicates (including escaped keys), nesting and
// rounded/fractional/exponent numeric tokens before JSON.parse can erase them.
function flat(raw: string, keys: readonly string[]): Data {
  let p = 0;
  const seen = new Set<string>();
  const space = () => {
    while (/[\t\r\n ]/.test(raw[p] ?? '!')) p++;
  };
  const quoted = () => {
    const start = p;
    if (raw[p++] !== '"') return fail();
    while (p < raw.length) {
      const ch = raw[p++];
      if (ch === '\\') {
        p++;
        continue;
      }
      if (ch === '"') return JSON.parse(raw.slice(start, p)) as string;
    }
    return fail();
  };
  space();
  if (raw[p++] !== '{') return fail();
  space();
  while (raw[p] !== '}') {
    const key = quoted();
    if (seen.has(key) || !keys.includes(key)) return fail();
    seen.add(key);
    space();
    if (raw[p++] !== ':') return fail();
    space();
    if (raw[p] === '"') quoted();
    else {
      const start = p;
      while (p < raw.length && !/[},\t\r\n ]/.test(raw[p])) p++;
      if (!/^(?:0|[1-9][0-9]*|true|false|null)$/.test(raw.slice(start, p))) {
        return fail();
      }
    }
    space();
    if (raw[p] === ',') {
      p++;
      space();
      if (raw[p] === '}') return fail();
    } else if (raw[p] !== '}') return fail();
  }
  p++;
  space();
  if (p !== raw.length) return fail();
  return object(JSON.parse(raw), keys);
}
export async function bindECOSOwnerPageRasterRead(
  raw: unknown,
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
  page: Readonly<ECOSOwnerIndexedPageObservationsRead>,
  expectedUploadAttemptId: string | null,
): Promise<Readonly<ECOSOwnerPageRasterRead>> {
  try {
    assertECOSOwnerIndexedPageObservationsRead(page, inventory, indexes);
    if (page.state !== 'current' || !page.head || !page.modalities) {
      return fail();
    }
    if (expectedUploadAttemptId !== null) upload(expectedUploadAttemptId);
    // Copy scalar wire fields before hashing yields. No caller data retained.
    const r = object(raw, READ_KEYS);
    const pins: Data = {
      owner_id: page.owner_id,
      organization_id: page.owner_id,
      project_id: page.project_id,
      execution_id: page.execution_id,
      binding_id: page.binding_id,
      page_number: page.page_number,
      expected_page_attempt_id: page.head.attempt_id,
      expected_page_sha256: page.head.page_sha256,
      expected_upload_attempt_id: expectedUploadAttemptId,
    };
    if (
      Object.keys(pins).some((k) => r[k] !== pins[k]) ||
      r.schema_version !== 'ecos-owner-page-raster-read/2.1' ||
      r.publication_mode !== 'shadow' || r.retrieval_authorized !== false ||
      r.semantic_verified !== false ||
      typeof r.state !== 'string' ||
      !['current', 'old', 'stale', 'missing'].includes(r.state)
    ) return fail();
    if (r.current_upload_attempt_id !== null) {
      upload(r.current_upload_attempt_id);
    }
    let attestation: Readonly<ECOSOwnerPageRasterAttestation> | null = null;
    if (r.state === 'current') {
      const active = upload(r.current_upload_attempt_id);
      if (
        expectedUploadAttemptId !== null &&
          active !== expectedUploadAttemptId ||
        r.availability !== 'private_locator_requires_verified_download'
      ) return fail();
      const receiptJSON = string(r.receipt_json, 20000),
        receiptSHA = sha(r.receipt_sha256);
      const receipt = flat(receiptJSON, RECEIPT_KEYS);
      const attestationJSON = string(receipt.attestation_json, 16384),
        attestationSHA = sha(receipt.attestation_sha256);
      // Branch selection alone trusts nothing. flat() verifies the exact hashed
      // bytes, including duplicate/escaped keys, types and the versioned keyset.
      const independentImage = JSON.parse(attestationJSON)?.schema_version ===
        'ecos-owner-page-raster-attestation/2.2';
      const a = flat(
        attestationJSON,
        independentImage
          ? [...ATTESTATION_KEYS, 'image_payload_json', 'image_payload_sha256']
          : ATTESTATION_KEYS,
      );
      if (
        await hash(receiptJSON) !== receiptSHA ||
        await hash(attestationJSON) !== attestationSHA
      ) return fail();
      if (
        receipt.schema_version !== 'ecos-owner-page-raster-receipt/2.1' ||
        receipt.publication_mode !== 'shadow' ||
        receipt.verification !== 'trusted_service_attested_png_readback' ||
        receipt.retrieval_authorized !== false ||
        receipt.semantic_verified !== false
      ) return fail();
      const version = integer(receipt.version, 1, 32);
      if (receipt.previous_upload_attempt_id !== null) {
        upload(receipt.previous_upload_attempt_id);
      }
      if (
        (version === 1) !== (receipt.previous_upload_attempt_id === null) ||
        receipt.previous_upload_attempt_id === active
      ) return fail();
      const stamp = string(receipt.committed_at, 32), date = Date.parse(stamp);
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(stamp) ||
        !Number.isFinite(date) ||
        new Date(date).toISOString().slice(0, 19) !== stamp.slice(0, 19)
      ) return fail();
      const expected: Data = {
        schema_version: independentImage
          ? 'ecos-owner-page-raster-attestation/2.2'
          : 'ecos-owner-page-raster-attestation/2.1',
        publication_mode: 'shadow',
        owner_id: page.owner_id,
        organization_id: page.owner_id,
        project_id: page.project_id,
        execution_id: page.execution_id,
        binding_id: page.binding_id,
        source_id: page.source_id,
        source_sha256: page.source_sha256,
        source_revision: page.source_revision,
        source_page_count: page.source_page_count,
        extraction_version: page.extraction_version,
        page_number: page.page_number,
        page_attempt_id: page.head.attempt_id,
        page_sha256: page.head.page_sha256,
        visual_payload_sha256: page.head.modalities.visual.payload_sha256,
        upload_attempt_id: active,
        expected_previous_upload_attempt_id: receipt.previous_upload_attempt_id,
        storage_project_ref: 'xdytqlpsqsseoeuxgzre',
        bucket: 'project-documents',
        object_key:
          `v2-rasters/${page.owner_id}/${page.execution_id}/${page.binding_id}/${page.head.attempt_id}/${active}.png`,
        verification: 'exact_png_sha256_and_independent_decode',
        retrieval_authorized: false,
        semantic_verified: false,
      };
      if (
        Object.keys(expected).some((k) => a[k] !== expected[k])
      ) return fail();
      if (independentImage) {
        const imageJSON = string(a.image_payload_json, 4096);
        if (await hash(imageJSON) !== sha(a.image_payload_sha256)) {
          return fail();
        }
        const m = flat(imageJSON, IMAGE_KEYS);
        const pins: Data = {
          schema_version: 'ecos-original-page-image/2.2',
          source_sha256: page.source_sha256,
          source_page_count: page.source_page_count,
          page_number: page.page_number,
          state: 'rendered',
          raster_sha256: a.raster_sha256,
          raster_byte_count: a.raster_byte_count,
          raster_width: a.raster_width,
          raster_height: a.raster_height,
          coordinate_system: a.raster_coordinate_system,
          ocr_attempted: false,
          semantic_verified: false,
          retrieval_authorized: false,
        };
        if (
          Object.keys(pins).some((k) => m[k] !== pins[k]) ||
          m.coordinate_system !== 'rotated_display_cropbox_pixels_top_left'
        ) return fail();
        sha(m.renderer_sha256);
        if (!/^[ -~]{1,256}$/.test(string(m.renderer_version, 256))) {
          return fail();
        }
        integer(m.requested_dpi, 72, 400);
        if (
          integer(m.raster_width, 1, 6000) * integer(m.raster_height, 1, 6000) >
            16_000_000
        ) return fail();
        if (a.visual_payload_sha256 !== null) sha(a.visual_payload_sha256);
      } else {
        // Legacy 2.1 can never attach pixels to a failed/absent OCR payload.
        if (!['partial', 'unreadable'].includes(page.modalities.visual.state)) {
          return fail();
        }
        const observation = page.modalities.visual.observations as {
          raster?: Record<string, unknown>;
        } | null;
        const raster = observation?.raster;
        if (
          !raster || a.raster_sha256 !== raster.sha256 ||
          a.raster_byte_count !== raster.byte_count ||
          a.raster_width !== raster.width ||
          a.raster_height !== raster.height ||
          a.raster_coordinate_system !== raster.coordinate_system ||
          a.raster_coordinate_system !==
            'rotated_display_cropbox_pixels_top_left'
        ) return fail();
        sha(a.visual_payload_sha256);
      }
      sha(a.raster_sha256);
      integer(a.raster_byte_count, 33, 32 * 1024 * 1024);
      if (
        integer(a.raster_width, 1, 8000) * integer(a.raster_height, 1, 8000) >
          24_000_000
      ) return fail();
      attestation = Object.freeze(a) as unknown as Readonly<
        ECOSOwnerPageRasterAttestation
      >;
    } else {
      if (
        r.receipt_json !== null || r.receipt_sha256 !== null ||
        r.availability !== 'unavailable'
      ) return fail();
      // A replaced PAGE returns old with no raster head. An old COPY of the
      // still-current page returns its newer raster head and needs an exact
      // different requested upload. Neither state may expose a locator.
      if (
        r.state === 'old' && r.current_upload_attempt_id !== null &&
        (expectedUploadAttemptId === null ||
          r.current_upload_attempt_id === expectedUploadAttemptId)
      ) return fail();
      if (
        r.state === 'missing' && r.current_upload_attempt_id !== null &&
        (expectedUploadAttemptId === null ||
          r.current_upload_attempt_id === expectedUploadAttemptId)
      ) return fail();
    }
    const result: ECOSOwnerPageRasterRead = Object.freeze({
      state: r.state as ECOSOwnerPageRasterRead['state'],
      page,
      expected_upload_attempt_id: expectedUploadAttemptId,
      current_upload_attempt_id: r.current_upload_attempt_id as string | null,
      receipt_json: r.receipt_json as string | null,
      receipt_sha256: r.receipt_sha256 as string | null,
      attestation,
      availability: r.availability as ECOSOwnerPageRasterRead['availability'],
      binding_basis: 'exact_current_indexed_page_and_raster_receipt',
      currentness: 'at_raster_read_only_not_atomic_with_page_or_index',
      raster_bytes_verified: false,
      image_available: false,
      retrieval_authorized: false,
      semantic_verified: false,
    });
    origins.set(result, { inventory, indexes, page });
    return result;
  } catch {
    return fail();
  }
}
export function assertECOSOwnerPageRasterRead(
  value: unknown,
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
  page: ECOSOwnerIndexedPageObservationsRead,
): asserts value is Readonly<ECOSOwnerPageRasterRead> {
  assertECOSOwnerIndexedPageObservationsRead(page, inventory, indexes);
  const origin = value && typeof value === 'object' ? origins.get(value) : null;
  if (
    !origin || origin.inventory !== inventory || origin.indexes !== indexes ||
    origin.page !== page
  ) return fail();
}
