import {
  buildECOSProjectEvidenceRecord,
  type ECOSProjectEvidenceRecord,
  type ECOSProjectEvidenceValue,
  type ECOSProjectFactKind,
} from './ecos-project-evidence-record.ts';

export const ECOS_TABLE_RECORD_SCHEMA_VERSION =
  'ecos-table-evidence-records/2.0' as const;
export const ECOS_NATIVE_TABLE_EXTRACTION_VERSION =
  'ecos-native-table-sources/2.0' as const;
const INPUT_SCHEMA = 'ecos-page-table-sources/2.0';
const BASE_LIMITATIONS = [
  'native_ruled_tables_only',
  'visual_understanding_pending',
  'authority_resolution_pending',
];
const FAILED_REASONS = new Set([
  'native_table_extraction_limit_exceeded',
  'invalid_native_table_geometry',
  'unsupported_native_table_text_encoding',
  'unsupported_native_table_layout',
]);
const MAX_CONTEXT_BYTES = 32 * 1024;
const MAX_PROJECTION_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();

export interface ECOSExpectedTableSource {
  jobId: string;
  organizationId: string;
  projectId: string;
  sourceId: string;
  sourceSha256: string;
  sourceRevision: string | null;
  pageNumber: number;
  sourcePageCount: number;
  extractionVersion: typeof ECOS_NATIVE_TABLE_EXTRACTION_VERSION;
  sourceKind: 'schedule' | 'rfi' | 'other';
  manifestId: string;
  snapshotId: string;
}
export interface ECOSTableCell {
  columnNumber: number;
  bbox: readonly [number, number, number, number] | null;
  text: string | null;
}
export interface ECOSTableRow {
  rowNumber: number;
  cells: readonly Readonly<ECOSTableCell>[];
}
export interface ECOSNativeSourceTable {
  tableId: string;
  bbox: readonly [number, number, number, number];
  rows: readonly Readonly<ECOSTableRow>[];
}
export interface ECOSTableCellLocator extends ECOSTableCell {
  tableId: string;
  rowNumber: number;
}
export interface ECOSTableRecordWrapper {
  record: ECOSProjectEvidenceRecord;
  headerCell: Readonly<ECOSTableCellLocator>;
  valueCell: Readonly<ECOSTableCellLocator>;
  subjectCell: Readonly<ECOSTableCellLocator>;
  identityCell: Readonly<ECOSTableCellLocator>;
  rowContext: Readonly<
    {
      tableId: string;
      headers: Readonly<ECOSTableRow>;
      row: Readonly<ECOSTableRow>;
    }
  >;
}
export interface ECOSTableProjectionGap {
  code: string;
  tableId: string | null;
  rowNumber: number | null;
  columnNumber: number | null;
}
export interface ECOSTableRecords {
  schemaVersion: typeof ECOS_TABLE_RECORD_SCHEMA_VERSION;
  verificationStatus: 'structure_only_requires_assurance';
  source: Readonly<
    ECOSExpectedTableSource & {
      state: 'partial' | 'unreadable' | 'failed';
      pageGeometry: Readonly<
        {
          width: number;
          height: number;
          coordinateSystem: 'pdf_points_top_left';
          coordinateSpace: 'unrotated_crop_page';
        }
      >;
      nativeTables: readonly Readonly<ECOSNativeSourceTable>[];
      limitationCodes: readonly string[];
    }
  >;
  records: readonly Readonly<ECOSTableRecordWrapper>[];
  gaps: readonly Readonly<ECOSTableProjectionGap>[];
}

function object(value: unknown, keys: readonly string[], field: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const found = Object.keys(value);
  if (
    found.length !== keys.length || found.some((key) => !keys.includes(key))
  ) throw new Error(`${field} contains missing or unsupported fields`);
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, field: string) {
  if (typeof value !== 'string') throw new Error(`${field} must be text`);
  if (value.length > maximum) {
    throw new Error(`${field} exceeds its byte budget`);
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0) throw new Error(`${field} has unsupported text encoding`);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`${field} has unsupported text encoding`);
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`${field} has unsupported text encoding`);
    }
  }
  if (encoder.encode(value).length > maximum) {
    throw new Error(`${field} exceeds its byte budget`);
  }
  return value;
}
const PYTHON_WHITESPACE = new Set([
  9,
  10,
  11,
  12,
  13,
  28,
  29,
  30,
  31,
  32,
  133,
  160,
  5760,
  8192,
  8193,
  8194,
  8195,
  8196,
  8197,
  8198,
  8199,
  8200,
  8201,
  8202,
  8232,
  8233,
  8239,
  8287,
  12288,
]);
function identity(value: unknown, field: string, max = 300) {
  const valueText = text(value, max, field);
  if (
    !valueText || PYTHON_WHITESPACE.has(valueText.codePointAt(0)!) ||
    PYTHON_WHITESPACE.has(valueText.codePointAt(valueText.length - 1)!) ||
    [...valueText].some((char) =>
      char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
    )
  ) throw new Error(`${field} is not an exact identity`);
  return valueText;
}
function integer(value: unknown, min: number, max: number, field: string) {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) || value < min ||
    value > max
  ) throw new Error(`${field} exceeds its integer budget`);
  return value;
}
function dimension(value: unknown) {
  if (
    typeof value !== 'number' || !Number.isFinite(value) || value <= 0 ||
    value > 100_000
  ) throw new Error('page dimensions are invalid');
  return value;
}
function box(
  value: unknown,
  parent: readonly number[],
  field: string,
): readonly [number, number, number, number] {
  if (
    !Array.isArray(value) || value.length !== 4 ||
    value.some((n) => typeof n !== 'number' || !Number.isFinite(n))
  ) throw new Error(`${field} geometry is invalid`);
  const [x0, y0, x1, y1] = value as number[];
  if (
    x0 < parent[0] || y0 < parent[1] || x1 > parent[2] || y1 > parent[3] ||
    x1 <= x0 || y1 <= y0
  ) throw new Error(`${field} geometry is outside its parent`);
  return Object.freeze([x0, y0, x1, y1]);
}
function independentlyExpected(
  input: ECOSExpectedTableSource,
): Readonly<ECOSExpectedTableSource> {
  if (!input || typeof input !== 'object') {
    throw new Error('independent source identity is required');
  }
  const jobId = identity(input.jobId, 'expected jobId');
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      jobId,
    )
  ) throw new Error('expected jobId must be a canonical UUID');
  if (
    typeof input.sourceSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.sourceSha256)
  ) throw new Error('expected sourceSha256 must be lowercase SHA-256');
  if (input.extractionVersion !== ECOS_NATIVE_TABLE_EXTRACTION_VERSION) {
    throw new Error('expected extraction version is unsupported');
  }
  if (!['schedule', 'rfi', 'other'].includes(input.sourceKind)) {
    throw new Error('expected source kind is unsupported');
  }
  const sourcePageCount = integer(
    input.sourcePageCount,
    1,
    10_000,
    'sourcePageCount',
  );
  return Object.freeze({
    jobId,
    organizationId: identity(input.organizationId, 'organizationId', 500),
    projectId: identity(input.projectId, 'projectId', 500),
    sourceId: identity(input.sourceId, 'sourceId'),
    sourceSha256: input.sourceSha256,
    sourceRevision: input.sourceRevision === null
      ? null
      : identity(input.sourceRevision, 'sourceRevision'),
    pageNumber: integer(input.pageNumber, 1, sourcePageCount, 'pageNumber'),
    sourcePageCount,
    extractionVersion: ECOS_NATIVE_TABLE_EXTRACTION_VERSION,
    sourceKind: input.sourceKind,
    manifestId: identity(input.manifestId, 'manifestId'),
    snapshotId: identity(input.snapshotId, 'snapshotId'),
  });
}
type Field =
  | 'id'
  | 'name'
  | 'planned_start'
  | 'planned_finish'
  | 'actual_start'
  | 'actual_finish'
  | 'reported_start'
  | 'reported_finish'
  | 'percent'
  | 'predecessors'
  | 'area'
  | 'status'
  | 'question'
  | 'response';
const SCHEDULE_HEADERS: Readonly<Record<string, Field>> = Object.freeze({
  id: 'id',
  activityid: 'id',
  taskid: 'id',
  activitynumber: 'id',
  activity: 'name',
  activityname: 'name',
  task: 'name',
  taskname: 'name',
  taskdescription: 'name',
  activitydescription: 'name',
  plannedstart: 'planned_start',
  scheduledstart: 'planned_start',
  plannedfinish: 'planned_finish',
  scheduledfinish: 'planned_finish',
  actualstart: 'actual_start',
  actualfinish: 'actual_finish',
  start: 'reported_start',
  finish: 'reported_finish',
  '%complete': 'percent',
  percentcomplete: 'percent',
  'completion%': 'percent',
  'progress%': 'percent',
  progress: 'percent',
  predecessors: 'predecessors',
  predecessor: 'predecessors',
  dependencies: 'predecessors',
  dependson: 'predecessors',
  area: 'area',
  location: 'area',
  locationarea: 'area',
  status: 'status',
});
const RFI_HEADERS: Readonly<Record<string, Field>> = Object.freeze({
  id: 'id',
  rfiid: 'id',
  rfinumber: 'id',
  'rfi#': 'id',
  rfi: 'id',
  question: 'question',
  rfiquestion: 'question',
  response: 'response',
  rfiresponse: 'response',
  answer: 'response',
  status: 'status',
  area: 'area',
  location: 'area',
  locationarea: 'area',
});
function headerKey(value: string | null) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9%#]/g, '');
}
function oneLine(value: string | null) {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}
function fieldFor(headers: Readonly<Record<string, Field>>, key: string) {
  return Object.hasOwn(headers, key) ? headers[key] : undefined;
}
function tableFamily(
  header: ECOSTableRow,
  sourceKind: ECOSExpectedTableSource['sourceKind'],
): 'schedule' | 'rfi' | null {
  if (sourceKind !== 'other') return sourceKind;
  const scheduleFields = header.cells.map((cell) =>
    fieldFor(SCHEDULE_HEADERS, headerKey(cell.text))
  );
  const rfiFields = header.cells.map((cell) =>
    fieldFor(RFI_HEADERS, headerKey(cell.text))
  );
  const schedule = scheduleFields.includes('id') &&
    scheduleFields.includes('name');
  const rfi = rfiFields.includes('id') && rfiFields.includes('question');
  return schedule === rfi ? null : schedule ? 'schedule' : 'rfi';
}
function repeatedHeader(
  row: ECOSTableRow,
  header: ECOSTableRow,
  idColumn: number,
  subjectColumn: number,
) {
  return row.cells.every((cell, column) =>
    headerKey(cell.text) === headerKey(header.cells[column].text)
  ) ||
    (headerKey(row.cells[idColumn].text) ===
        headerKey(header.cells[idColumn].text) &&
      headerKey(row.cells[subjectColumn].text) ===
        headerKey(header.cells[subjectColumn].text));
}
function summaryRow(id: string, name: string) {
  return ['total', 'subtotal', 'summary', 'grandtotal'].includes(
    headerKey(id),
  ) || ['total', 'subtotal', 'summary', 'grandtotal'].includes(headerKey(name));
}
function cellLocator(
  table: ECOSNativeSourceTable,
  row: ECOSTableRow,
  column: number,
): Readonly<ECOSTableCellLocator> {
  return Object.freeze({
    tableId: table.tableId,
    rowNumber: row.rowNumber,
    ...row.cells[column],
  });
}
function fieldValue(
  field: Field,
  cell: ECOSTableCell,
  header: ECOSTableCell,
): {
  kind: ECOSProjectFactKind;
  predicate: string;
  value: ECOSProjectEvidenceValue;
  qualifier?: string;
} | { gap: string } {
  const raw = oneLine(cell.text);
  if (!raw) return { gap: 'missing_value' };
  if (raw.length > 2_000 || encoder.encode(raw).length > 2_000) {
    return { gap: 'proposed_value_text_too_large' };
  }
  if (
    [
      'planned_start',
      'planned_finish',
      'actual_start',
      'actual_finish',
      'reported_start',
      'reported_finish',
    ].includes(field)
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return { gap: 'ambiguous_or_unsupported_date' };
    }
    const parsed = Date.parse(`${raw}T00:00:00Z`);
    if (
      !Number.isFinite(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== raw
    ) return { gap: 'invalid_date' };
    return {
      kind: 'schedule_date',
      predicate: `${field.startsWith('reported_') ? '' : 'reported '}${
        field.replace('_', ' ')
      } date`,
      value: { type: 'date', isoDate: raw },
      ...(field.startsWith('reported_')
        ? {
          qualifier: 'Header does not distinguish planned versus actual date',
        }
        : {}),
    };
  }
  if (field === 'percent') {
    const match = /^(\d+(?:\.\d+)?)\s*(%)?$/.exec(raw);
    if (!match) return { gap: 'unsupported_percent_value' };
    if (!match[2] && !/(%|percent)/i.test(header.text ?? '')) {
      return { gap: 'missing_explicit_percent_unit' };
    }
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100) {
      return { gap: 'percent_outside_range' };
    }
    return {
      kind: 'progress',
      predicate: 'reported percent complete',
      value: { type: 'number', amount, unit: 'percent' },
    };
  }
  const mapping: Partial<
    Record<Field, readonly [ECOSProjectFactKind, string]>
  > = {
    name: ['schedule_activity', 'reported schedule activity'],
    predecessors: [
      'schedule_dependency',
      'reported unresolved predecessor identifiers',
    ],
    area: ['location', 'reported area'],
    status: ['status', 'reported status'],
    question: ['communication_question', 'reported RFI question'],
    response: ['communication_response', 'reported RFI response'],
  };
  const mapped = mapping[field];
  if (!mapped) return { gap: 'unsupported_field' };
  return {
    kind: mapped[0],
    predicate: mapped[1],
    value: { type: 'text', text: raw },
  };
}

/**
 * Projects native table associations, never verified site facts or task writes.
 * Native parser cell strings are source representations, not byte-exact PDF
 * quotes. Full rows, headers, unknown columns, qualifications and conflicts
 * remain available to subsequent visual/content Assurance.
 */
export async function projectECOSTableRecords(
  raw: unknown,
  expectedInput: ECOSExpectedTableSource,
): Promise<Readonly<ECOSTableRecords>> {
  const expected = independentlyExpected(expectedInput);
  const page = object(raw, [
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
    'tables',
    'limitation_codes',
  ], 'table source');
  const pairs = [
    ['job_id', expected.jobId],
    ['organization_id', expected.organizationId],
    ['project_id', expected.projectId],
    ['source_id', expected.sourceId],
    ['source_sha256', expected.sourceSha256],
    ['source_revision', expected.sourceRevision],
    ['page_number', expected.pageNumber],
    ['extraction_version', expected.extractionVersion],
  ] as const;
  if (pairs.some(([key, value]) => page[key] !== value)) {
    throw new Error('table source does not match independent source identity');
  }
  if (
    page.schema_version !== INPUT_SCHEMA ||
    page.coordinate_system !== 'pdf_points_top_left'
  ) throw new Error('table source schema or coordinates unsupported');
  const width = dimension(page.page_width),
    height = dimension(page.page_height);
  const state = page.state;
  if (state !== 'partial' && state !== 'unreadable' && state !== 'failed') {
    throw new Error('native tables cannot claim complete or verified content');
  }
  if (
    !Array.isArray(page.limitation_codes) || page.limitation_codes.length > 4
  ) throw new Error('table source limitations invalid');
  const limitations = page.limitation_codes.map((value) =>
    identity(value, 'limitation code', 100)
  );
  const extras = limitations.filter((code) => !BASE_LIMITATIONS.includes(code));
  if (
    new Set(limitations).size !== limitations.length ||
    BASE_LIMITATIONS.some((code) => !limitations.includes(code)) ||
    (state === 'partial' && extras.length !== 0) ||
    (state === 'unreadable' &&
      (extras.length !== 1 ||
        extras[0] !== 'native_ruled_table_unavailable')) ||
    (state === 'failed' &&
      (extras.length !== 1 || !FAILED_REASONS.has(extras[0])))
  ) throw new Error('table source limitations do not match state');
  if (
    !Array.isArray(page.tables) || page.tables.length > 16 ||
    (state === 'partial' && page.tables.length === 0) ||
    (state !== 'partial' && page.tables.length !== 0)
  ) throw new Error('table source count or state is invalid');
  let totalCells = 0, totalTextBytes = 0;
  const tables = page.tables.map(
    (tableValue: unknown, index: number): Readonly<ECOSNativeSourceTable> => {
      const table = object(tableValue, ['table_id', 'bbox', 'rows'], 'table');
      if (table.table_id !== `page:${expected.pageNumber}:table:${index + 1}`) {
        throw new Error('table identity is not contiguous');
      }
      const bbox = box(table.bbox, [0, 0, width, height], 'table');
      if (
        !Array.isArray(table.rows) || table.rows.length < 1 ||
        table.rows.length > 256
      ) throw new Error('table row budget invalid');
      let columns = 0;
      const rows = table.rows.map(
        (rowValue: unknown, rowIndex: number): Readonly<ECOSTableRow> => {
          const row = object(rowValue, ['row_number', 'cells'], 'table row');
          if (row.row_number !== rowIndex + 1) {
            throw new Error('table row identity is not contiguous');
          }
          if (
            !Array.isArray(row.cells) || row.cells.length < 1 ||
            row.cells.length > 32 || (columns && row.cells.length !== columns)
          ) throw new Error('table columns are not bounded and rectangular');
          columns = row.cells.length;
          totalCells += columns;
          if (totalCells > 4096) {
            throw new Error('table page exceeds total cell budget');
          }
          const cells = row.cells.map(
            (cellValue: unknown, column: number): Readonly<ECOSTableCell> => {
              const cell = object(
                cellValue,
                ['column_number', 'bbox', 'text'],
                'table cell',
              );
              if (cell.column_number !== column + 1) {
                throw new Error('table column identity is not contiguous');
              }
              if (cell.bbox === null) {
                if (cell.text !== null) {
                  throw new Error(
                    'missing or merged cell must not inherit text',
                  );
                }
                return Object.freeze({
                  columnNumber: column + 1,
                  bbox: null,
                  text: null,
                });
              }
              const cellText = text(cell.text, 16 * 1024, 'cell text');
              totalTextBytes += encoder.encode(cellText).length;
              if (totalTextBytes > 256 * 1024) {
                throw new Error(
                  'table page exceeds total text budget',
                );
              }
              return Object.freeze({
                columnNumber: column + 1,
                bbox: box(cell.bbox, bbox, 'cell'),
                text: cellText,
              });
            },
          );
          return Object.freeze({
            rowNumber: rowIndex + 1,
            cells: Object.freeze(cells),
          });
        },
      );
      const cellsWithGeometry = rows.flatMap((row) => row.cells).filter((
        cell,
      ) => cell.bbox !== null);
      const inventory = new Set(
        cellsWithGeometry.map((cell) => JSON.stringify(cell.bbox)),
      );
      const columnOrigins = [
        ...new Set(cellsWithGeometry.map((cell) => cell.bbox![0])),
      ].sort((a, b) => a - b);
      const rowOrigins = [
        ...new Set(cellsWithGeometry.map((cell) => cell.bbox![1])),
      ].sort((a, b) => a - b);
      if (
        inventory.size !== cellsWithGeometry.length ||
        columnOrigins.length !== columns || rowOrigins.length !== rows.length ||
        rows.some((row, rowIndex) =>
          row.cells.some((cell, columnIndex) =>
            cell.bbox !== null &&
            (cell.bbox[0] !== columnOrigins[columnIndex] ||
              cell.bbox[1] !== rowOrigins[rowIndex])
          )
        )
      ) {
        throw new Error(
          'table cell geometry does not match its canonical row and column identities',
        );
      }
      return Object.freeze({
        tableId: String(table.table_id),
        bbox,
        rows: Object.freeze(rows),
      });
    },
  );
  for (let index = 1; index < tables.length; index++) {
    const previous = tables[index - 1].bbox, current = tables[index].bbox;
    if (
      current[1] < previous[1] ||
      (current[1] === previous[1] && current[0] < previous[0])
    ) throw new Error('table ordering must be top then left');
  }
  const source = Object.freeze({
    ...expected,
    state,
    pageGeometry: Object.freeze({
      width,
      height,
      coordinateSystem: 'pdf_points_top_left' as const,
      coordinateSpace: 'unrotated_crop_page' as const,
    }),
    nativeTables: Object.freeze(tables),
    limitationCodes: Object.freeze(limitations),
  });
  const gaps: Readonly<ECOSTableProjectionGap>[] = [],
    records: Readonly<ECOSTableRecordWrapper>[] = [];
  const baseBytes = encoder.encode(
    JSON.stringify({
      schemaVersion: ECOS_TABLE_RECORD_SCHEMA_VERSION,
      verificationStatus: 'structure_only_requires_assurance',
      source,
      records: [],
      gaps: [],
    }),
  ).length;
  let recordsBytes = 0, gapsBytes = 0, pageBudgetExceeded = false;
  const checkBudget = () => {
    if (baseBytes + recordsBytes + gapsBytes > MAX_PROJECTION_BYTES) {
      pageBudgetExceeded = true;
      records.length = 0;
      recordsBytes = 0;
    }
  };
  const gap = (
    code: string,
    tableId: string | null = null,
    rowNumber: number | null = null,
    columnNumber: number | null = null,
  ) => {
    const value = Object.freeze({ code, tableId, rowNumber, columnNumber });
    gapsBytes += encoder.encode(JSON.stringify(value)).length +
      (gaps.length ? 1 : 0);
    gaps.push(value);
    checkBudget();
  };
  // A register may span several separate tables on the same page. Preserve
  // each occurrence and flag conflicts page-wide without merging by task ID.
  const identityCounts = new Map<string, number>();
  for (const table of tables) {
    const header = table.rows[0],
      family = tableFamily(header, expected.sourceKind);
    if (!family) continue;
    const aliases = family === 'schedule' ? SCHEDULE_HEADERS : RFI_HEADERS;
    const otherAliases = family === 'schedule' ? RFI_HEADERS : SCHEDULE_HEADERS;
    const fields = header.cells.map((cell) =>
      fieldFor(aliases, headerKey(cell.text))
    );
    const recognized = fields.filter((field) => field !== undefined);
    const idColumn = fields.indexOf('id'),
      subjectColumn = fields.indexOf(
        family === 'schedule' ? 'name' : 'question',
      );
    if (
      idColumn < 0 || subjectColumn < 0 ||
      new Set(recognized).size !== recognized.length ||
      header.cells.some((cell, column) =>
        cell.bbox === null || !oneLine(cell.text) ||
        (!fields[column] && fieldFor(otherAliases, headerKey(cell.text)))
      )
    ) continue;
    for (const row of table.rows.slice(1)) {
      const id = oneLine(row.cells[idColumn].text),
        name = oneLine(row.cells[subjectColumn].text);
      if (
        !id || !name || repeatedHeader(row, header, idColumn, subjectColumn) ||
        summaryRow(id, name)
      ) continue;
      const key = JSON.stringify([family, id]);
      identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
    }
  }
  if (state !== 'partial') {
    gap(state === 'unreadable' ? 'native_ruled_table_unavailable' : extras[0]);
  }
  for (const table of tables) {
    const header = table.rows[0];
    let family: 'schedule' | 'rfi' = expected.sourceKind === 'rfi'
      ? 'rfi'
      : 'schedule';
    if (expected.sourceKind === 'other') {
      const scheduleFields = header.cells.map((cell) =>
        fieldFor(SCHEDULE_HEADERS, headerKey(cell.text))
      );
      const rfiFields = header.cells.map((cell) =>
        fieldFor(RFI_HEADERS, headerKey(cell.text))
      );
      const schedule = scheduleFields.includes('id') &&
        scheduleFields.includes('name');
      const rfi = rfiFields.includes('id') && rfiFields.includes('question');
      if (schedule === rfi) {
        gap(
          schedule ? 'ambiguous_table_family' : 'unsupported_table_family',
          table.tableId,
        );
        continue;
      }
      family = schedule ? 'schedule' : 'rfi';
    }
    const aliases = family === 'schedule' ? SCHEDULE_HEADERS : RFI_HEADERS;
    const otherAliases = family === 'schedule' ? RFI_HEADERS : SCHEDULE_HEADERS;
    const fields = header.cells.map((cell) =>
      fieldFor(aliases, headerKey(cell.text))
    );
    let headerInvalid = false;
    const seen = new Set<Field>();
    for (const [column, cell] of header.cells.entries()) {
      if (cell.bbox === null || !oneLine(cell.text)) {
        gap('missing_or_merged_header', table.tableId, 1, column + 1);
        headerInvalid = true;
        continue;
      }
      const field = fields[column];
      if (field) {
        if (seen.has(field)) {
          gap('duplicate_header_mapping', table.tableId, 1, column + 1);
          headerInvalid = true;
        }
        seen.add(field);
      } else {
        gap(
          fieldFor(otherAliases, headerKey(cell.text))
            ? 'mixed_source_headers'
            : 'unsupported_column',
          table.tableId,
          1,
          column + 1,
        );
        if (fieldFor(otherAliases, headerKey(cell.text))) headerInvalid = true;
      }
    }
    const idColumn = fields.indexOf('id');
    const subjectColumn = fields.indexOf(
      family === 'schedule' ? 'name' : 'question',
    );
    if (idColumn < 0 || subjectColumn < 0) {
      gap('missing_required_headers', table.tableId, 1);
      headerInvalid = true;
    }
    if (headerInvalid) {
      for (const row of table.rows.slice(1)) {
        gap('row_skipped_unresolved_header', table.tableId, row.rowNumber);
      }
      continue;
    }
    if (table.rows.length === 1) {
      gap('no_data_rows', table.tableId);
      continue;
    }
    for (const row of table.rows.slice(1)) {
      if (repeatedHeader(row, header, idColumn, subjectColumn)) {
        gap('repeated_header_row', table.tableId, row.rowNumber);
        continue;
      }
      const id = oneLine(row.cells[idColumn].text),
        name = oneLine(row.cells[subjectColumn].text);
      if (
        !id || !name || row.cells[idColumn].bbox === null ||
        row.cells[subjectColumn].bbox === null
      ) {
        gap('missing_required_row_identity', table.tableId, row.rowNumber);
        continue;
      }
      if (summaryRow(id, name)) {
        gap('summary_row_skipped', table.tableId, row.rowNumber);
        continue;
      }
      if (
        encoder.encode(id).length > 200 ||
        (family === 'schedule' && encoder.encode(name).length > 700)
      ) {
        gap('row_identity_too_large', table.tableId, row.rowNumber);
        continue;
      }
      const context = Object.freeze({
        tableId: table.tableId,
        headers: header,
        row,
      });
      if (
        header.cells.concat(row.cells).reduce(
          (sum, cell) => sum + encoder.encode(cell.text ?? '').length,
          0,
        ) > MAX_CONTEXT_BYTES
      ) {
        gap('row_context_too_large', table.tableId, row.rowNumber);
        continue;
      }
      const duplicate =
        (identityCounts.get(JSON.stringify([family, id])) ?? 0) > 1;
      if (duplicate) {
        gap('duplicate_source_id', table.tableId, row.rowNumber, idColumn + 1);
      }
      const areaColumn = fields.indexOf('area');
      let location = areaColumn < 0
        ? null
        : oneLine(row.cells[areaColumn].text) || null;
      if (location && encoder.encode(location).length > 500) {
        gap(
          'location_context_too_large',
          table.tableId,
          row.rowNumber,
          areaColumn + 1,
        );
        location = null;
      }
      const subject = family === 'schedule'
        ? `Activity ${id}: ${name}`
        : `RFI ${id}`;
      for (const [column, field] of fields.entries()) {
        if (!field || field === 'id') continue;
        if (pageBudgetExceeded) continue;
        const cell = row.cells[column];
        if (cell.bbox === null) {
          gap(
            'missing_or_merged_cell',
            table.tableId,
            row.rowNumber,
            column + 1,
          );
          continue;
        }
        const projected = fieldValue(field, cell, header.cells[column]);
        if ('gap' in projected) {
          gap(projected.gap, table.tableId, row.rowNumber, column + 1);
          continue;
        }
        const idMaterial = JSON.stringify([
          expected.organizationId,
          expected.projectId,
          expected.sourceId,
          expected.sourceSha256,
          expected.sourceRevision,
          expected.pageNumber,
          table.tableId,
          row.rowNumber,
          column + 1,
          expected.snapshotId,
          expected.extractionVersion,
          ECOS_TABLE_RECORD_SCHEMA_VERSION,
          expected.sourceKind,
          family,
          header,
          row,
        ]);
        const digest = Array.from(
          new Uint8Array(
            await crypto.subtle.digest('SHA-256', encoder.encode(idMaterial)),
          ),
          (n) => n.toString(16).padStart(2, '0'),
        ).join('');
        let record: ECOSProjectEvidenceRecord;
        try {
          record = buildECOSProjectEvidenceRecord({
            id: `table-record:${digest}`,
            organizationId: expected.organizationId,
            projectId: expected.projectId,
            sourceKind: expected.sourceKind,
            factKind: projected.kind,
            subject,
            predicate: projected.predicate,
            value: projected.value,
            displayStatement: `${subject}: ${projected.predicate}: ${
              projected.value.type === 'text'
                ? projected.value.text
                : projected.value.type === 'date'
                ? projected.value.isoDate
                : projected.value.type === 'number'
                ? `${projected.value.amount} ${projected.value.unit}`
                : String(projected.value.value)
            }`,
            location,
            temporalScope: `Reported source revision: ${
              expected.sourceRevision ?? 'not specified'
            }`,
            qualifiers: [
              'Reported source value, not verified current site state',
              'Native cell association requires visual and semantic Assurance',
              'Current authority and out-of-table qualifications remain unresolved',
              ...(family === 'schedule'
                ? [
                  'Schedule row type and hierarchy unresolved; not authorized for task creation',
                ]
                : []),
              'Typed value whitespace normalized; original cells retained in row context',
              ...(duplicate
                ? [
                  'Duplicate source ID; resolve this independent row occurrence',
                ]
                : []),
              ...(projected.qualifier ? [projected.qualifier] : []),
            ],
            extractionMethods: ['structured_table'],
            confidence: 0,
            locator: {
              manifestId: expected.manifestId,
              snapshotId: expected.snapshotId,
              extractionVersion: expected.extractionVersion,
              sourceId: expected.sourceId,
              sourceSha256: expected.sourceSha256,
              itemKey: `page:${expected.pageNumber}`,
              pageNumber: expected.pageNumber,
              regionId: `${table.tableId}:row:${row.rowNumber}:column:${
                column + 1
              }`,
              recordId: `${table.tableId}:row:${row.rowNumber}:id:${id}`,
            },
          });
        } catch {
          gap(
            'proposed_record_contract_rejected',
            table.tableId,
            row.rowNumber,
            column + 1,
          );
          continue;
        }
        const wrapper = Object.freeze({
          record,
          headerCell: cellLocator(table, header, column),
          valueCell: cellLocator(table, row, column),
          subjectCell: cellLocator(table, row, subjectColumn),
          identityCell: cellLocator(table, row, idColumn),
          rowContext: context,
        });
        recordsBytes += encoder.encode(JSON.stringify(wrapper)).length +
          (records.length ? 1 : 0);
        records.push(wrapper);
        checkBudget();
      }
    }
  }
  if (pageBudgetExceeded) gap('proposed_record_page_limit_exceeded');
  return Object.freeze({
    schemaVersion: ECOS_TABLE_RECORD_SCHEMA_VERSION,
    verificationStatus: 'structure_only_requires_assurance',
    source,
    records: Object.freeze(records),
    gaps: Object.freeze(gaps),
  });
}
