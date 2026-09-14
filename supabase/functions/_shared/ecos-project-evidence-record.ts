import type {
  ECOSExtractionMethod,
  ECOSSourceKind,
} from './ecos-source-accountability.ts';

export const ECOS_PROJECT_EVIDENCE_RECORD_SCHEMA_VERSION =
  'ecos-project-evidence-record/2.0' as const;

export type ECOSProjectFactKind =
  | 'requirement'
  | 'measurement'
  | 'material'
  | 'equipment'
  | 'relationship'
  | 'schedule_activity'
  | 'schedule_date'
  | 'schedule_dependency'
  | 'status'
  | 'progress'
  | 'communication_question'
  | 'communication_response'
  | 'party'
  | 'location'
  | 'observation';

export type ECOSProjectEvidenceValue =
  | Readonly<{ type: 'text'; text: string }>
  | Readonly<{ type: 'number'; amount: number; unit: string }>
  | Readonly<{ type: 'date'; isoDate: string }>
  | Readonly<{ type: 'boolean'; value: boolean }>;

export interface ECOSProjectEvidenceLocator {
  manifestId: string;
  sourceId: string;
  sourceSha256: string;
  snapshotId: string;
  extractionVersion: string;
  itemKey: string;
  pageNumber?: number | null;
  sheetNumber?: string | null;
  regionId?: string | null;
  recordId?: string | null;
}

export interface ECOSProjectEvidenceRecordInput {
  id: string;
  organizationId: string;
  projectId: string;
  sourceKind: ECOSSourceKind;
  factKind: ECOSProjectFactKind;
  subject: string;
  predicate: string;
  value: ECOSProjectEvidenceValue;
  displayStatement: string;
  location?: string | null;
  temporalScope?: string | null;
  qualifiers?: readonly string[];
  extractionMethods: readonly ECOSExtractionMethod[];
  confidence: number;
  locator: ECOSProjectEvidenceLocator;
}

export interface ECOSProjectEvidenceRecord
  extends ECOSProjectEvidenceRecordInput {
  schemaVersion: typeof ECOS_PROJECT_EVIDENCE_RECORD_SCHEMA_VERSION;
  assertionKind: 'proposed_fact';
  verificationStatus: 'structure_only_requires_assurance';
  location: string | null;
  temporalScope: string | null;
  qualifiers: readonly string[];
}

const SOURCE_FACT_KINDS: Readonly<
  Record<ECOSSourceKind, ReadonlySet<ECOSProjectFactKind>>
> = {
  drawing: new Set([
    'requirement',
    'measurement',
    'material',
    'equipment',
    'relationship',
    'location',
  ]),
  specification: new Set([
    'requirement',
    'measurement',
    'material',
    'equipment',
    'relationship',
  ]),
  schedule: new Set([
    'schedule_activity',
    'schedule_date',
    'schedule_dependency',
    'status',
    'progress',
    'party',
    'location',
  ]),
  rfi: new Set([
    'communication_question',
    'communication_response',
    'status',
    'party',
    'requirement',
    'relationship',
    'location',
  ]),
  submittal: new Set([
    'communication_question',
    'communication_response',
    'status',
    'party',
    'requirement',
    'material',
    'equipment',
    'relationship',
    'location',
  ]),
  task: new Set([
    'schedule_date',
    'status',
    'progress',
    'party',
    'location',
    'observation',
    'relationship',
  ]),
  field_note: new Set([
    'status',
    'progress',
    'party',
    'location',
    'observation',
    'relationship',
  ]),
  photo: new Set(['progress', 'location', 'observation', 'relationship']),
  other: new Set([
    'requirement',
    'measurement',
    'material',
    'equipment',
    'relationship',
    'schedule_activity',
    'schedule_date',
    'schedule_dependency',
    'status',
    'progress',
    'communication_question',
    'communication_response',
    'party',
    'location',
    'observation',
  ]),
};

const EXTRACTION_METHODS = new Set<ECOSExtractionMethod>([
  'native_text',
  'ocr',
  'document_vision',
  'vector_geometry',
  'structured_table',
  'application_record',
]);

function boundedText(value: unknown, field: string, maximumBytes: number) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (
    !trimmed || new TextEncoder().encode(trimmed).length > maximumBytes ||
    [...trimmed].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) throw new Error(`${field} is not valid bounded text`);
  return trimmed;
}

function optionalBoundedText(
  value: unknown,
  field: string,
  maximumBytes: number,
) {
  return value == null ? null : boundedText(value, field, maximumBytes);
}

function exactIdentity(value: unknown, field: string, maximumBytes = 300) {
  const normalized = boundedText(value, field, maximumBytes);
  if (normalized !== value) {
    throw new Error(`${field} must not change its exact identity`);
  }
  return normalized;
}

function sourceSha256(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('locator.sourceSha256 must be one lowercase SHA-256 value');
  }
  return value;
}

function normalizedValue(
  value: ECOSProjectEvidenceValue,
): ECOSProjectEvidenceValue {
  if (!value || typeof value !== 'object') {
    throw new Error('value must be an object');
  }
  switch (value.type) {
    case 'text':
      return Object.freeze({
        type: 'text',
        text: boundedText(value.text, 'value.text', 2_000),
      });
    case 'number':
      if (
        typeof value.amount !== 'number' || !Number.isFinite(value.amount) ||
        Math.abs(value.amount) > 1_000_000_000_000
      ) {
        throw new Error('value.amount is outside its supported range');
      }
      return Object.freeze({
        type: 'number',
        amount: value.amount,
        unit: boundedText(value.unit, 'value.unit', 100),
      });
    case 'date': {
      const isoDate = boundedText(value.isoDate, 'value.isoDate', 40);
      if (
        !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(isoDate)
      ) {
        throw new Error(
          'value.isoDate must be an exact ISO date or UTC instant',
        );
      }
      const parsed = Date.parse(
        isoDate.length === 10 ? `${isoDate}T00:00:00Z` : isoDate,
      );
      if (!Number.isFinite(parsed)) {
        throw new Error('value.isoDate is not a real date');
      }
      const canonical = new Date(parsed).toISOString();
      const expected = isoDate.length === 10
        ? `${isoDate}T00:00:00.000Z`
        : isoDate.length === 20
        ? isoDate.replace('Z', '.000Z')
        : isoDate;
      if (canonical !== expected) {
        throw new Error('value.isoDate is not a real date');
      }
      return Object.freeze({ type: 'date', isoDate });
    }
    case 'boolean':
      if (typeof value.value !== 'boolean') {
        throw new Error('value.value must be boolean');
      }
      return Object.freeze({ type: 'boolean', value: value.value });
    default:
      throw new Error('value.type is unsupported');
  }
}

/**
 * Validates the shape of a proposed extraction, not its truth. The result is
 * deliberately not a verified fact: source-item existence, exact region/sheet
 * content, and semantic support still require manifest binding and Assurance.
 * Inferences and recommendations are separate, later processing stages.
 */
export function buildECOSProjectEvidenceRecord(
  input: ECOSProjectEvidenceRecordInput,
): ECOSProjectEvidenceRecord {
  if (!input || typeof input !== 'object') {
    throw new Error('evidence record input is required');
  }
  if (!Object.hasOwn(SOURCE_FACT_KINDS, input.sourceKind)) {
    throw new Error('sourceKind is unsupported');
  }
  const allowedFactKinds = SOURCE_FACT_KINDS[input.sourceKind];
  if (!allowedFactKinds.has(input.factKind)) {
    throw new Error(
      `${input.factKind} is not a direct ${input.sourceKind} fact`,
    );
  }
  if (
    !Array.isArray(input.extractionMethods) ||
    input.extractionMethods.length < 1 ||
    input.extractionMethods.length > 8
  ) throw new Error('extractionMethods must be a bounded non-empty list');
  const extractionMethods = input.extractionMethods.map((method) => {
    if (!EXTRACTION_METHODS.has(method)) {
      throw new Error('extractionMethods contains an unsupported method');
    }
    return method;
  });
  if (new Set(extractionMethods).size !== extractionMethods.length) {
    throw new Error('extractionMethods contains duplicates');
  }
  if (
    typeof input.confidence !== 'number' ||
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 || input.confidence > 1
  ) throw new Error('confidence must be a number from zero through one');
  if (!input.locator || typeof input.locator !== 'object') {
    throw new Error('locator is required');
  }
  const pageNumber = input.locator.pageNumber == null
    ? null
    : input.locator.pageNumber;
  if (
    pageNumber != null &&
    (typeof pageNumber !== 'number' || !Number.isSafeInteger(pageNumber) ||
      pageNumber < 1 || pageNumber > 10_000)
  ) throw new Error('locator.pageNumber is outside its supported range');
  const qualifiers = input.qualifiers == null ? [] : input.qualifiers;
  if (!Array.isArray(qualifiers) || qualifiers.length > 32) {
    throw new Error('qualifiers exceeds its bounded list');
  }
  const normalizedQualifiers = qualifiers.map((value, index) =>
    boundedText(value, `qualifiers[${index}]`, 300)
  );
  if (new Set(normalizedQualifiers).size !== normalizedQualifiers.length) {
    throw new Error('qualifiers contains duplicates');
  }
  const locator = Object.freeze({
    manifestId: exactIdentity(input.locator.manifestId, 'locator.manifestId'),
    sourceId: exactIdentity(input.locator.sourceId, 'locator.sourceId'),
    sourceSha256: sourceSha256(input.locator.sourceSha256),
    snapshotId: exactIdentity(input.locator.snapshotId, 'locator.snapshotId'),
    extractionVersion: exactIdentity(
      input.locator.extractionVersion,
      'locator.extractionVersion',
    ),
    itemKey: exactIdentity(input.locator.itemKey, 'locator.itemKey'),
    pageNumber,
    sheetNumber: input.locator.sheetNumber == null
      ? null
      : exactIdentity(input.locator.sheetNumber, 'locator.sheetNumber', 100),
    regionId: input.locator.regionId == null
      ? null
      : exactIdentity(input.locator.regionId, 'locator.regionId'),
    recordId: input.locator.recordId == null
      ? null
      : exactIdentity(input.locator.recordId, 'locator.recordId'),
  });
  if (
    input.sourceKind === 'drawing' &&
    pageNumber == null
  ) {
    throw new Error(
      'drawing facts require an exact page locator; a sheet label alone is not verified',
    );
  }
  if (
    ['schedule', 'rfi', 'submittal', 'task', 'field_note', 'photo'].includes(
      input.sourceKind,
    ) &&
    locator.recordId == null
  ) {
    throw new Error(
      `${input.sourceKind} facts require an exact record locator`,
    );
  }

  const value = normalizedValue(input.value);
  if (input.factKind === 'measurement' && value.type !== 'number') {
    throw new Error('measurement requires a numeric value and unit');
  }
  if (input.factKind === 'schedule_date' && value.type !== 'date') {
    throw new Error('schedule_date requires an exact date value');
  }
  if (
    input.factKind === 'progress' && (value.type !== 'number' ||
      value.amount < 0 || value.amount > 100 ||
      !['percent', '%'].includes(value.unit))
  ) {
    throw new Error(
      'progress requires a numeric percent from zero through 100',
    );
  }

  return Object.freeze({
    schemaVersion: ECOS_PROJECT_EVIDENCE_RECORD_SCHEMA_VERSION,
    assertionKind: 'proposed_fact',
    verificationStatus: 'structure_only_requires_assurance',
    id: exactIdentity(input.id, 'id'),
    organizationId: exactIdentity(input.organizationId, 'organizationId', 500),
    projectId: exactIdentity(input.projectId, 'projectId', 500),
    sourceKind: input.sourceKind,
    factKind: input.factKind,
    subject: boundedText(input.subject, 'subject', 1_000),
    predicate: boundedText(input.predicate, 'predicate', 300),
    value,
    displayStatement: boundedText(
      input.displayStatement,
      'displayStatement',
      4_000,
    ),
    location: optionalBoundedText(input.location, 'location', 500),
    temporalScope: optionalBoundedText(
      input.temporalScope,
      'temporalScope',
      500,
    ),
    qualifiers: Object.freeze(normalizedQualifiers),
    extractionMethods: Object.freeze(extractionMethods),
    confidence: input.confidence,
    locator,
  });
}
