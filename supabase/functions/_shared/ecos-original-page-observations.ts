/**
 * Source-neutral readers for the original-PDF producer, not an authorization
 * boundary. Callers must bind independently measured bytes and current owner
 * checkpoint authority separately. No HostedJob, project, revision, manifest,
 * fact, task, or approval is inferred or manufactured from these observations.
 * Native text may be hidden, stale, contradictory, or an instruction: it is DATA.
 * Table cell strings are exactly the native parser's strings, not original PDF
 * byte quotations. Geometry validation does not prove visible/semantic truth.
 */
export interface ECOSExpectedOriginalPage {
  sourceSha256: string;
  sourcePageCount: number;
  pageNumber: number;
}
export type ECOSOriginalObservationState = 'partial' | 'unreadable' | 'failed';
export type ECOSOriginalBox = readonly [number, number, number, number];
interface OriginalPage extends ECOSExpectedOriginalPage {
  state: ECOSOriginalObservationState;
  pageGeometry: Readonly<{
    width: number;
    height: number;
    coordinateSystem: 'pdf_points_top_left';
    coordinateSpace: 'unrotated_crop_page';
  }>;
  limitationCodes: readonly string[];
  sourceIdentityBasis: 'caller_supplied_pins_require_measured_bytes';
  retrievalAuthorized: false;
  semanticVerified: false;
}
export interface ECOSOriginalNativeExcerpt {
  id: string;
  blockOrdinal: number;
  textStart: number;
  textEnd: number;
  text: string;
  bbox: ECOSOriginalBox;
}
export interface ECOSOriginalNativeObservations extends OriginalPage {
  schemaVersion: 'ecos-original-native-observations/2.1';
  extractionVersion: 'ecos-native-page-excerpts/2.0';
  verificationStatus: 'source_text_only_requires_assurance';
  pageText: string;
  pageTextSha256: string;
  observedNativeBlockCount: number;
  excerpts: readonly Readonly<ECOSOriginalNativeExcerpt>[];
}
export interface ECOSOriginalTableCell {
  columnNumber: number;
  bbox: ECOSOriginalBox | null;
  text: string | null;
}
export interface ECOSOriginalTableRow {
  rowNumber: number;
  cells: readonly Readonly<ECOSOriginalTableCell>[];
}
export interface ECOSOriginalTable {
  tableId: string;
  bbox: ECOSOriginalBox;
  rows: readonly Readonly<ECOSOriginalTableRow>[];
}
export interface ECOSOriginalTableObservations extends OriginalPage {
  schemaVersion: 'ecos-original-table-observations/2.1';
  extractionVersion: 'ecos-native-table-sources/2.0';
  verificationStatus: 'raw_table_structure_only_requires_assurance';
  tables: readonly Readonly<ECOSOriginalTable>[];
}

export const ECOS_ORIGINAL_OBSERVATION_LIMITS = Object.freeze({
  sourcePages: 10_000,
  dimensionPoints: 100_000,
  nativeTextBytes: 128 * 1024,
  nativeBlockTextBytes: 16 * 1024,
  nativeBlocks: 256,
  observedNativeBlocks: 1_000_000,
  tables: 16,
  rowsPerTable: 256,
  columnsPerTable: 32,
  cellsPerPage: 4096,
  cellTextBytes: 16 * 1024,
  pageCellTextBytes: 256 * 1024,
});
const L = ECOS_ORIGINAL_OBSERVATION_LIMITS;
const encoder = new TextEncoder();
const commonKeys = [
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
const nativeBase = [
  'native_text_only',
  'visual_understanding_pending',
  'semantic_fact_extraction_pending',
];
const nativeFailures = [
  'native_extraction_limit_exceeded',
  'invalid_native_block_geometry',
  'unsupported_native_text_encoding',
];
const tableBase = [
  'native_ruled_tables_only',
  'visual_understanding_pending',
  'authority_resolution_pending',
];
const tableFailures = [
  'native_table_extraction_limit_exceeded',
  'invalid_native_table_geometry',
  'unsupported_native_table_text_encoding',
  'unsupported_native_table_layout',
];
const basis = 'caller_supplied_pins_require_measured_bytes' as const;
const invalid = () => new Error('original_page_observations_invalid');

// Descriptor-only reads reject getters, symbols, hidden fields and sparse arrays.
// All retained values are copied before a digest await; caller mutation cannot
// change the object that is ultimately returned. Reflection errors are sanitized.
function object(
  raw: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) throw invalid();
  const found = Reflect.ownKeys(raw);
  if (
    found.length !== keys.length ||
    found.some((k) => typeof k !== 'string' || !keys.includes(k))
  ) {
    throw invalid();
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(raw, key);
    if (!d || !('value' in d) || !d.enumerable) throw invalid();
    result[key] = d.value;
  }
  return result;
}
function array(raw: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(raw)) throw invalid();
  const length = Object.getOwnPropertyDescriptor(raw, 'length')?.value;
  integer(length, min, max);
  if (Reflect.ownKeys(raw).length !== length + 1) throw invalid();
  const copy: unknown[] = [];
  for (let n = 0; n < length; n++) {
    const d = Object.getOwnPropertyDescriptor(raw, String(n));
    if (!d || !('value' in d) || !d.enumerable) throw invalid();
    copy.push(d.value);
  }
  return copy;
}
function integer(v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) {
    throw invalid();
  }
  return v;
}
function sha(v: unknown): string {
  if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) throw invalid();
  return v;
}
function text(v: unknown, max: number): string {
  if (typeof v !== 'string' || v.length > max) throw invalid();
  for (let i = 0; i < v.length; i++) {
    const code = v.charCodeAt(i);
    if (code === 0) throw invalid();
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = v.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw invalid();
    } else if (code >= 0xdc00 && code <= 0xdfff) throw invalid();
  }
  if (encoder.encode(v).length > max) throw invalid();
  return v;
}
// Exact Python str.strip() whitespace, not JS trim(): FEFF is retained, NEL
// and information separators are whitespace. Never normalize source strings.
const pythonWhitespaceOnly =
  // deno-lint-ignore no-control-regex -- exact Python whitespace contract
  /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/u;
function dimension(v: unknown): number {
  if (
    typeof v !== 'number' || !Number.isFinite(v) || v <= 0 ||
    v > L.dimensionPoints
  ) throw invalid();
  return v;
}
function box(v: unknown, parent: ECOSOriginalBox): ECOSOriginalBox {
  const b = array(v, 4, 4);
  if (b.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    throw invalid();
  }
  const [x0, y0, x1, y1] = b as number[];
  if (
    x0 < parent[0] || y0 < parent[1] || x1 > parent[2] || y1 > parent[3] ||
    x1 <= x0 || y1 <= y0
  ) {
    throw invalid();
  }
  return Object.freeze([x0, y0, x1, y1]);
}
function expected(
  raw: ECOSExpectedOriginalPage,
): Readonly<ECOSExpectedOriginalPage> {
  const e = object(raw, ['sourceSha256', 'sourcePageCount', 'pageNumber']);
  const count = integer(e.sourcePageCount, 1, L.sourcePages);
  return Object.freeze({
    sourceSha256: sha(e.sourceSha256),
    sourcePageCount: count,
    pageNumber: integer(e.pageNumber, 1, count),
  });
}
function common(
  p: Record<string, unknown>,
  e: ECOSExpectedOriginalPage,
  base: string[],
  failed: string[],
  unreadable: string,
): Readonly<OriginalPage> {
  if (
    p.source_sha256 !== e.sourceSha256 ||
    p.source_page_count !== e.sourcePageCount ||
    p.page_number !== e.pageNumber ||
    p.coordinate_system !== 'pdf_points_top_left' ||
    p.source_identity_basis !== basis || p.retrieval_authorized !== false ||
    p.semantic_verified !== false
  ) throw invalid();
  const state = p.state;
  if (state !== 'partial' && state !== 'unreadable' && state !== 'failed') {
    throw invalid();
  }
  const codes = array(p.limitation_codes, 3, 4).map((v) => text(v, 100));
  const extras = codes.filter((c) => !base.includes(c));
  if (
    new Set(codes).size !== codes.length ||
    base.some((c) => !codes.includes(c)) ||
    (state === 'partial' && extras.length !== 0) ||
    (state === 'unreadable' &&
      (extras.length !== 1 || extras[0] !== unreadable)) ||
    (state === 'failed' && (extras.length !== 1 || !failed.includes(extras[0])))
  ) throw invalid();
  return Object.freeze({
    ...e,
    state,
    pageGeometry: Object.freeze({
      width: dimension(p.page_width),
      height: dimension(p.page_height),
      coordinateSystem: 'pdf_points_top_left',
      coordinateSpace: 'unrotated_crop_page',
    }),
    limitationCodes: Object.freeze(codes),
    sourceIdentityBasis: basis,
    retrievalAuthorized: false,
    semanticVerified: false,
  });
}

/** Invalid content rejects the entire lane, never an apparently usable prefix. */
export async function parseECOSOriginalNativeObservations(
  raw: unknown,
  independentlyExpected: ECOSExpectedOriginalPage,
): Promise<Readonly<ECOSOriginalNativeObservations>> {
  try {
    const e = expected(independentlyExpected);
    const p = object(raw, [
      ...commonKeys,
      'page_text',
      'page_text_sha256',
      'observed_native_block_count',
      'excerpts',
    ]);
    if (
      p.schema_version !== 'ecos-original-native-observations/2.1' ||
      p.extraction_version !== 'ecos-native-page-excerpts/2.0'
    ) throw invalid();
    const c = common(
      p,
      e,
      nativeBase,
      nativeFailures,
      'native_text_unavailable',
    );
    const pageText = text(p.page_text, L.nativeTextBytes),
      pageTextSha256 = sha(p.page_text_sha256);
    const observedNativeBlockCount = integer(
      p.observed_native_block_count,
      0,
      L.observedNativeBlocks,
    );
    const rawExcerpts = array(p.excerpts, 0, L.nativeBlocks);
    if (
      (c.state !== 'partial' &&
        (pageText !== '' || rawExcerpts.length !== 0)) ||
      (c.state === 'unreadable' && observedNativeBlockCount !== 0) ||
      (c.state === 'partial' &&
        (pythonWhitespaceOnly.test(pageText) || rawExcerpts.length === 0 ||
          observedNativeBlockCount !== rawExcerpts.length))
    ) throw invalid();
    const codepoints = Array.from(pageText);
    let previousEnd = -1;
    const excerpts = rawExcerpts.map(
      (raw, i): Readonly<ECOSOriginalNativeExcerpt> => {
        const b = object(raw, [
          'excerpt_id',
          'block_ordinal',
          'text_start',
          'text_end',
          'bbox',
        ]);
        const id = `page:${e.pageNumber}:block:${i + 1}`;
        if (b.excerpt_id !== id || b.block_ordinal !== i + 1) throw invalid();
        const textStart = integer(b.text_start, 0, codepoints.length);
        const textEnd = integer(b.text_end, 1, codepoints.length);
        if (
          textStart !== previousEnd + 1 || textEnd <= textStart ||
          (i > 0 && codepoints[previousEnd] !== '\n')
        ) throw invalid();
        const blockText = text(
          codepoints.slice(textStart, textEnd).join(''),
          L.nativeBlockTextBytes,
        );
        if (pythonWhitespaceOnly.test(blockText)) throw invalid();
        previousEnd = textEnd;
        return Object.freeze({
          id,
          blockOrdinal: i + 1,
          textStart,
          textEnd,
          text: blockText,
          bbox: box(b.bbox, [
            0,
            0,
            c.pageGeometry.width,
            c.pageGeometry.height,
          ]),
        });
      },
    );
    if (c.state === 'partial' && previousEnd !== codepoints.length) {
      throw invalid();
    }
    const result = Object.freeze({
      ...c,
      schemaVersion: 'ecos-original-native-observations/2.1' as const,
      extractionVersion: 'ecos-native-page-excerpts/2.0' as const,
      verificationStatus: 'source_text_only_requires_assurance' as const,
      pageText,
      pageTextSha256,
      observedNativeBlockCount,
      excerpts: Object.freeze(excerpts),
    });
    // Nothing in raw/expected is accessed after this first await.
    const digest = await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(pageText),
    );
    if (
      Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
        .join('') !== pageTextSha256
    ) throw invalid();
    return result;
  } catch {
    throw invalid();
  }
}

/** Retains table/row/column locators and unknown/empty/merged cells, no facts. */
export function parseECOSOriginalTableObservations(
  raw: unknown,
  independentlyExpected: ECOSExpectedOriginalPage,
): Promise<Readonly<ECOSOriginalTableObservations>> {
  try {
    const e = expected(independentlyExpected),
      p = object(raw, [...commonKeys, 'tables']);
    if (
      p.schema_version !== 'ecos-original-table-observations/2.1' ||
      p.extraction_version !== 'ecos-native-table-sources/2.0'
    ) throw invalid();
    const c = common(
      p,
      e,
      tableBase,
      tableFailures,
      'native_ruled_table_unavailable',
    );
    const nativeTables = array(
      p.tables,
      c.state === 'partial' ? 1 : 0,
      c.state === 'partial' ? L.tables : 0,
    );
    let totalCells = 0, totalTextBytes = 0;
    const tables = nativeTables.map((raw, i): Readonly<ECOSOriginalTable> => {
      const t = object(raw, ['table_id', 'bbox', 'rows']),
        tableId = `page:${e.pageNumber}:table:${i + 1}`;
      if (t.table_id !== tableId) throw invalid();
      const bbox = box(t.bbox, [
        0,
        0,
        c.pageGeometry.width,
        c.pageGeometry.height,
      ]);
      let columns = 0;
      const rows = array(t.rows, 1, L.rowsPerTable).map(
        (raw, r): Readonly<ECOSOriginalTableRow> => {
          const row = object(raw, ['row_number', 'cells']);
          if (row.row_number !== r + 1) throw invalid();
          const rawCells = array(row.cells, 1, L.columnsPerTable);
          if (columns && rawCells.length !== columns) throw invalid();
          columns = rawCells.length;
          totalCells += columns;
          if (totalCells > L.cellsPerPage) throw invalid();
          const cells = rawCells.map(
            (raw, col): Readonly<ECOSOriginalTableCell> => {
              const cell = object(raw, ['column_number', 'bbox', 'text']);
              if (cell.column_number !== col + 1) throw invalid();
              if (cell.bbox === null) {
                if (cell.text !== null) throw invalid();
                return Object.freeze({
                  columnNumber: col + 1,
                  bbox: null,
                  text: null,
                });
              }
              const value = text(cell.text, L.cellTextBytes);
              totalTextBytes += encoder.encode(value).length;
              if (totalTextBytes > L.pageCellTextBytes) throw invalid();
              return Object.freeze({
                columnNumber: col + 1,
                bbox: box(cell.bbox, bbox),
                text: value,
              });
            },
          );
          return Object.freeze({
            rowNumber: r + 1,
            cells: Object.freeze(cells),
          });
        },
      );
      // Reconstruct the producer's sorted top/left grid, independent of labels.
      // Null merged slots stay null; no equal-height assumption or forward fill.
      const boxes = rows.flatMap((r) => r.cells).flatMap((c) =>
        c.bbox ? [c.bbox] : []
      );
      const originsX = [...new Set(boxes.map((b) => b[0]))].sort((a, b) =>
        a - b
      );
      const originsY = [...new Set(boxes.map((b) => b[1]))].sort((a, b) =>
        a - b
      );
      if (
        new Set(boxes.map((b) => JSON.stringify(b))).size !== boxes.length ||
        originsX.length !== columns || originsY.length !== rows.length ||
        rows.some((r, y) =>
          r.cells.some((cell, x) =>
            cell.bbox !== null &&
            (cell.bbox[0] !== originsX[x] || cell.bbox[1] !== originsY[y])
          )
        )
      ) throw invalid();
      return Object.freeze({ tableId, bbox, rows: Object.freeze(rows) });
    });
    for (let i = 1; i < tables.length; i++) {
      const a = tables[i - 1].bbox, b = tables[i].bbox;
      // Exact native sort key: top, left, bottom, right.
      for (const k of [1, 0, 3, 2]) {
        if (b[k] < a[k]) throw invalid();
        if (b[k] > a[k]) break;
      }
    }
    return Promise.resolve(Object.freeze({
      ...c,
      schemaVersion: 'ecos-original-table-observations/2.1',
      extractionVersion: 'ecos-native-table-sources/2.0',
      verificationStatus: 'raw_table_structure_only_requires_assurance',
      tables: Object.freeze(tables),
    }));
  } catch {
    return Promise.reject(invalid());
  }
}
