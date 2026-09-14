export const ECOS_PAGE_SOURCE_EXCERPTS_SCHEMA_VERSION =
  'ecos-page-source-excerpts/2.0' as const;
export const ECOS_NATIVE_PAGE_EXTRACTION_VERSION =
  'ecos-native-page-excerpts/2.0' as const;

export const ECOS_PAGE_EXCERPT_LIMITS = Object.freeze({
  pageTextUtf8Bytes: 128 * 1024,
  excerptTextUtf8Bytes: 16 * 1024,
  excerptCount: 256,
  observedBlockCount: 1_000_000,
  dimensionPoints: 100_000,
});

const BASE_LIMITATIONS = [
  'native_text_only',
  'visual_understanding_pending',
  'semantic_fact_extraction_pending',
] as const;

const FAILURE_LIMITATIONS = new Set([
  'native_extraction_limit_exceeded',
  'invalid_native_block_geometry',
  'unsupported_native_text_encoding',
]);

/** Obtained from the authorized registered source, not the projection itself. */
export interface ECOSExpectedPageSource {
  jobId: string;
  organizationId: string;
  projectId: string;
  sourceId: string;
  sourceSha256: string;
  sourceRevision: string | null;
  pageNumber: number;
  sourcePageCount: number;
  extractionVersion: typeof ECOS_NATIVE_PAGE_EXTRACTION_VERSION;
}

export interface ECOSSourceExcerptProvenance {
  jobId: string;
  organizationId: string;
  projectId: string;
  sourceId: string;
  sourceSha256: string;
  sourceRevision: string | null;
  extractionVersion: typeof ECOS_NATIVE_PAGE_EXTRACTION_VERSION;
  pageNumber: number;
  pageTextSha256: string;
  excerptId: string;
  /** Unicode codepoints, not UTF-16 code units, bytes, or grapheme clusters. */
  textStart: number;
  textEnd: number;
}

export interface ECOSRawSourceExcerpt {
  id: string;
  blockOrdinal: number;
  text: string;
  textStart: number;
  textEnd: number;
  /** x0, y0, x1, y1 in the unrotated crop page, never display-rotated coordinates. */
  bbox: readonly [number, number, number, number];
  provenance: Readonly<ECOSSourceExcerptProvenance>;
  verificationStatus: 'source_text_only_requires_assurance';
}

export interface ECOSPageSourceExcerpts extends ECOSExpectedPageSource {
  schemaVersion: typeof ECOS_PAGE_SOURCE_EXCERPTS_SCHEMA_VERSION;
  verificationStatus: 'source_text_only_requires_assurance';
  state: 'partial' | 'unreadable' | 'failed';
  pageGeometry: Readonly<{
    width: number;
    height: number;
    coordinateSystem: 'pdf_points_top_left';
    coordinateSpace: 'unrotated_crop_page';
  }>;
  pageText: string;
  pageTextSha256: string;
  observedNativeBlockCount: number;
  excerptCount: number;
  excerpts: readonly Readonly<ECOSRawSourceExcerpt>[];
  limitationCodes: readonly string[];
}

const PAGE_KEYS = [
  'schema_version',
  'extraction_version',
  'job_id',
  'organization_id',
  'project_id',
  'source_id',
  'source_sha256',
  'source_revision',
  'page_number',
  'page_width',
  'page_height',
  'coordinate_system',
  'state',
  'page_text',
  'page_text_sha256',
  'observed_native_block_count',
  'excerpts',
  'limitation_codes',
];
const EXCERPT_KEYS = [
  'excerpt_id',
  'block_ordinal',
  'text_start',
  'text_end',
  'bbox',
];
const encoder = new TextEncoder();
// Match Python str.isspace()/str.strip() used by the producer. JavaScript
// trim() differs for NEL, information separators, and U+FEFF (BOM).
const NATIVE_WHITESPACE_CODEPOINTS = new Set([
  0x09,
  0x0a,
  0x0b,
  0x0c,
  0x0d,
  0x1c,
  0x1d,
  0x1e,
  0x1f,
  0x20,
  0x85,
  0xa0,
  0x1680,
  0x2000,
  0x2001,
  0x2002,
  0x2003,
  0x2004,
  0x2005,
  0x2006,
  0x2007,
  0x2008,
  0x2009,
  0x200a,
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
]);

function hasNativeContent(text: string) {
  for (const character of text) {
    if (!NATIVE_WHITESPACE_CODEPOINTS.has(character.codePointAt(0)!)) {
      return true;
    }
  }
  return false;
}

function hasBoundaryWhitespace(text: string) {
  return NATIVE_WHITESPACE_CODEPOINTS.has(text.codePointAt(0)!) ||
    NATIVE_WHITESPACE_CODEPOINTS.has(text.codePointAt(text.length - 1)!);
}

function objectWithExactKeys(
  value: unknown,
  keys: readonly string[],
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be a bounded object`);
  }
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== keys.length ||
    actualKeys.some((key) => !keys.includes(key))
  ) {
    throw new Error(`${field} contains missing or unsupported fields`);
  }
  return value as Record<string, unknown>;
}

function exactUnicodeText(
  value: unknown,
  field: string,
  maximumBytes: number,
): string {
  if (typeof value !== 'string') throw new Error(`${field} must be text`);
  // UTF-16 code units cannot exceed their valid UTF-8 byte count. Reject an
  // oversized string before allocating its byte buffer or walking all codepoints.
  if (value.length > maximumBytes) {
    throw new Error(`${field} exceeds its byte budget`);
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0) {
      throw new Error(`${field} contains unsupported text encoding`);
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`${field} contains unsupported text encoding`);
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`${field} contains unsupported text encoding`);
    }
  }
  if (encoder.encode(value).length > maximumBytes) {
    throw new Error(`${field} exceeds its byte budget`);
  }
  return value;
}

function exactIdentity(value: unknown, field: string, maximumBytes = 300) {
  const text = exactUnicodeText(value, field, maximumBytes);
  if (
    !text || hasBoundaryWhitespace(text) || [...text].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error(`${field} is not an exact identity`);
  }
  return text;
}

function exactSha(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be one lowercase SHA-256 value`);
  }
  return value;
}

function integer(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
) {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) ||
    value < minimum || value > maximum
  ) {
    throw new Error(`${field} is outside its integer budget`);
  }
  return value;
}

function dimension(value: unknown, field: string) {
  if (
    typeof value !== 'number' || !Number.isFinite(value) || value <= 0 ||
    value > ECOS_PAGE_EXCERPT_LIMITS.dimensionPoints
  ) {
    throw new Error(`${field} is outside its dimension budget`);
  }
  return value;
}

function expectedSource(
  input: ECOSExpectedPageSource,
): Readonly<ECOSExpectedPageSource> {
  if (!input || typeof input !== 'object') {
    throw new Error('independent source identity is required');
  }
  const jobId = exactIdentity(input.jobId, 'expected.jobId', 100);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      jobId,
    )
  ) {
    throw new Error('expected.jobId must be a canonical UUID');
  }
  const sourcePageCount = integer(
    input.sourcePageCount,
    'expected.sourcePageCount',
    1,
    10_000,
  );
  if (input.extractionVersion !== ECOS_NATIVE_PAGE_EXTRACTION_VERSION) {
    throw new Error('expected.extractionVersion is unsupported');
  }
  return Object.freeze({
    jobId,
    organizationId: exactIdentity(
      input.organizationId,
      'expected.organizationId',
      500,
    ),
    projectId: exactIdentity(input.projectId, 'expected.projectId', 500),
    sourceId: exactIdentity(input.sourceId, 'expected.sourceId'),
    sourceSha256: exactSha(input.sourceSha256, 'expected.sourceSha256'),
    sourceRevision: input.sourceRevision === null
      ? null
      : exactIdentity(input.sourceRevision, 'expected.sourceRevision'),
    pageNumber: integer(
      input.pageNumber,
      'expected.pageNumber',
      1,
      sourcePageCount,
    ),
    sourcePageCount,
    extractionVersion: ECOS_NATIVE_PAGE_EXTRACTION_VERSION,
  });
}

/**
 * Validates an exact native-source representation for later bounded retrieval.
 * Quote presence is NOT semantic support, visibility, or factual correctness.
 * Hidden PDF text, conflicting statements and document instructions remain DATA;
 * no verified fact, inference, recommendation, or answer-ready flag is emitted.
 * Callers must supply scope from an independently authorized source registration.
 */
export async function parseECOSPageSourceExcerpts(
  value: unknown,
  independentlyExpected: ECOSExpectedPageSource,
): Promise<Readonly<ECOSPageSourceExcerpts>> {
  const expected = expectedSource(independentlyExpected);
  const page = objectWithExactKeys(value, PAGE_KEYS, 'source projection');
  if (page.schema_version !== ECOS_PAGE_SOURCE_EXCERPTS_SCHEMA_VERSION) {
    throw new Error('source projection schema version is unsupported');
  }
  const identityPairs = [
    ['job_id', expected.jobId],
    ['organization_id', expected.organizationId],
    ['project_id', expected.projectId],
    ['source_id', expected.sourceId],
    ['source_sha256', expected.sourceSha256],
    ['source_revision', expected.sourceRevision],
    ['page_number', expected.pageNumber],
    ['extraction_version', expected.extractionVersion],
  ] as const;
  if (identityPairs.some(([key, identity]) => page[key] !== identity)) {
    throw new Error(
      'source projection does not match its independent source identity',
    );
  }
  if (page.coordinate_system !== 'pdf_points_top_left') {
    throw new Error('source projection coordinate system is unsupported');
  }
  const width = dimension(page.page_width, 'page_width');
  const height = dimension(page.page_height, 'page_height');
  const state = page.state;
  if (state !== 'partial' && state !== 'unreadable' && state !== 'failed') {
    throw new Error(
      'native source text cannot claim complete or verified evidence',
    );
  }
  const pageText = exactUnicodeText(
    page.page_text,
    'page_text',
    ECOS_PAGE_EXCERPT_LIMITS.pageTextUtf8Bytes,
  );
  const pageTextSha256 = exactSha(page.page_text_sha256, 'page_text_sha256');
  const codepoints = Array.from(pageText);
  const observedNativeBlockCount = integer(
    page.observed_native_block_count,
    'observed_native_block_count',
    0,
    ECOS_PAGE_EXCERPT_LIMITS.observedBlockCount,
  );
  if (
    !Array.isArray(page.limitation_codes) || page.limitation_codes.length > 4
  ) {
    throw new Error('source projection limitations are invalid');
  }
  const limitationCodes = page.limitation_codes.map((code) =>
    exactIdentity(code, 'limitation code', 100)
  );
  if (
    new Set(limitationCodes).size !== limitationCodes.length ||
    BASE_LIMITATIONS.some((code) => !limitationCodes.includes(code))
  ) {
    throw new Error(
      'source projection must retain every native-content limitation',
    );
  }
  const extras = limitationCodes.filter((code) =>
    !(BASE_LIMITATIONS as readonly string[]).includes(code)
  );
  if (
    (state === 'partial' && extras.length !== 0) ||
    (state === 'unreadable' &&
      (extras.length !== 1 || extras[0] !== 'native_text_unavailable')) ||
    (state === 'failed' &&
      (extras.length !== 1 || !FAILURE_LIMITATIONS.has(extras[0])))
  ) {
    throw new Error(
      'source projection limitations do not match its processing state',
    );
  }
  if (
    !Array.isArray(page.excerpts) ||
    page.excerpts.length > ECOS_PAGE_EXCERPT_LIMITS.excerptCount
  ) {
    throw new Error('source projection exceeds its excerpt budget');
  }
  if (state !== 'partial' && (pageText !== '' || page.excerpts.length !== 0)) {
    throw new Error(
      'unreadable or failed source projection cannot retain apparently usable text',
    );
  }
  if (
    (state === 'unreadable' && observedNativeBlockCount !== 0) ||
    (state === 'partial' &&
      (!hasNativeContent(pageText) || page.excerpts.length < 1 ||
        observedNativeBlockCount !== page.excerpts.length))
  ) {
    throw new Error(
      'source projection counts do not match its processing state',
    );
  }
  let previousEnd = -1;
  const excerpts = page.excerpts.map(
    (raw: unknown, index: number): Readonly<ECOSRawSourceExcerpt> => {
      const excerpt = objectWithExactKeys(raw, EXCERPT_KEYS, 'source excerpt');
      const blockOrdinal = integer(
        excerpt.block_ordinal,
        'block_ordinal',
        1,
        ECOS_PAGE_EXCERPT_LIMITS.excerptCount,
      );
      const id = exactIdentity(excerpt.excerpt_id, 'excerpt_id');
      if (
        blockOrdinal !== index + 1 ||
        id !== `page:${expected.pageNumber}:block:${blockOrdinal}`
      ) {
        throw new Error(
          'source excerpt does not match its ordered page identity',
        );
      }
      const textStart = integer(
        excerpt.text_start,
        'text_start',
        0,
        codepoints.length,
      );
      const textEnd = integer(
        excerpt.text_end,
        'text_end',
        1,
        codepoints.length,
      );
      if (
        textStart !== previousEnd + 1 || textEnd <= textStart ||
        (index > 0 && codepoints[previousEnd] !== '\n')
      ) {
        throw new Error(
          'source excerpt spans must cover exact ordered Unicode codepoints',
        );
      }
      const text = codepoints.slice(textStart, textEnd).join('');
      if (
        !hasNativeContent(text) ||
        encoder.encode(text).length >
          ECOS_PAGE_EXCERPT_LIMITS.excerptTextUtf8Bytes
      ) {
        throw new Error(
          'source excerpt text is empty or exceeds its byte budget',
        );
      }
      previousEnd = textEnd;
      if (
        !Array.isArray(excerpt.bbox) || excerpt.bbox.length !== 4 ||
        excerpt.bbox.some((coordinate) =>
          typeof coordinate !== 'number' || !Number.isFinite(coordinate)
        )
      ) {
        throw new Error('source excerpt bbox is invalid');
      }
      const [x0, y0, x1, y1] = excerpt.bbox as number[];
      if (
        x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0 || x1 > width || y1 > height
      ) {
        throw new Error(
          'source excerpt bbox is outside its unrotated crop page',
        );
      }
      const provenance = Object.freeze({
        jobId: expected.jobId,
        organizationId: expected.organizationId,
        projectId: expected.projectId,
        sourceId: expected.sourceId,
        sourceSha256: expected.sourceSha256,
        sourceRevision: expected.sourceRevision,
        extractionVersion: expected.extractionVersion,
        pageNumber: expected.pageNumber,
        pageTextSha256,
        excerptId: id,
        textStart,
        textEnd,
      });
      return Object.freeze({
        id,
        blockOrdinal,
        text,
        textStart,
        textEnd,
        bbox: Object.freeze([x0, y0, x1, y1]) as readonly [
          number,
          number,
          number,
          number,
        ],
        provenance,
        verificationStatus: 'source_text_only_requires_assurance',
      });
    },
  );
  if (state === 'partial' && previousEnd !== codepoints.length) {
    throw new Error('source excerpt spans omit trailing page content');
  }
  // All arrays/objects and identities were copied before yielding for the hash.
  const actualDigest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(pageText),
  );
  const actualSha256 = Array.from(
    new Uint8Array(actualDigest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  if (actualSha256 !== pageTextSha256) {
    throw new Error('source page text hash does not match its exact content');
  }
  return Object.freeze({
    schemaVersion: ECOS_PAGE_SOURCE_EXCERPTS_SCHEMA_VERSION,
    ...expected,
    verificationStatus: 'source_text_only_requires_assurance',
    state,
    pageGeometry: Object.freeze({
      width,
      height,
      coordinateSystem: 'pdf_points_top_left',
      coordinateSpace: 'unrotated_crop_page',
    }),
    pageText,
    pageTextSha256,
    observedNativeBlockCount,
    excerptCount: excerpts.length,
    excerpts: Object.freeze(excerpts),
    limitationCodes: Object.freeze(limitationCodes),
  });
}
