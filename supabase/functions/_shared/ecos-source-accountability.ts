export const ECOS_SOURCE_ACCOUNTABILITY_SCHEMA_VERSION =
  'ecos-source-accountability/2.0' as const;

export const ECOS_MAX_SOURCE_ITEMS = 10_000;

export type ECOSSourceKind =
  | 'drawing'
  | 'specification'
  | 'schedule'
  | 'rfi'
  | 'submittal'
  | 'task'
  | 'field_note'
  | 'photo'
  | 'other';

export type ECOSSourceItemKind = 'page' | 'record' | 'image';

export type ECOSSourceProcessingState =
  | 'pending'
  | 'processing'
  | 'complete'
  | 'empty'
  | 'partial'
  | 'unreadable'
  | 'unsupported'
  | 'failed'
  | 'superseded';

export type ECOSExtractionMethod =
  | 'native_text'
  | 'ocr'
  | 'document_vision'
  | 'vector_geometry'
  | 'structured_table'
  | 'application_record';

export type ECOSSourceGapCode =
  | 'missing_processing_result'
  | 'processing_incomplete'
  | 'partially_readable'
  | 'unreadable_content'
  | 'unsupported_content'
  | 'processing_failed'
  | 'superseded_source';

export interface ECOSExpectedSourceItem {
  itemKey: string;
  itemKind: ECOSSourceItemKind;
  ordinal: number;
}

export interface ECOSSourceProcessingIdentity {
  organizationId: string;
  projectId: string;
  sourceId: string;
  sourceSha256: string;
  sourceRevision: string | null;
  snapshotId: string;
  extractionVersion: string;
}

export interface ECOSSourceItemResult extends ECOSExpectedSourceItem {
  sourceIdentity: ECOSSourceProcessingIdentity;
  state: ECOSSourceProcessingState;
  extractionMethods: readonly ECOSExtractionMethod[];
  evidenceRecordCount: number;
  limitationCodes?: readonly string[];
}

export interface ECOSSourceAccountabilityInput {
  organizationId: string;
  projectId: string;
  sourceId: string;
  sourceKind: ECOSSourceKind;
  sourceSha256: string;
  sourceRevision?: string | null;
  snapshotId: string;
  extractionVersion: string;
  /** Obtained independently from the source, not from the returned item list. */
  expectedItemCount: number;
  expectedItems: readonly ECOSExpectedSourceItem[];
  itemResults: readonly ECOSSourceItemResult[];
}

export interface ECOSAccountedSourceItem extends ECOSSourceItemResult {
  gapCode: ECOSSourceGapCode | null;
}

export interface ECOSSourceAccountabilityManifest {
  schemaVersion: typeof ECOS_SOURCE_ACCOUNTABILITY_SCHEMA_VERSION;
  organizationId: string;
  projectId: string;
  sourceId: string;
  sourceKind: ECOSSourceKind;
  sourceSha256: string;
  sourceRevision: string | null;
  snapshotId: string;
  extractionVersion: string;
  expectedItemCount: number;
  reportedItemCount: number;
  terminalItemCount: number;
  usableItemCount: number;
  emptyItemCount: number;
  gapItemCount: number;
  processingCoveragePercent: number;
  usableCoveragePercent: number;
  fullyAccounted: boolean;
  fullyUsable: boolean;
  sourceState: ECOSSourceProcessingState;
  items: readonly ECOSAccountedSourceItem[];
}

const SOURCE_KINDS = new Set<ECOSSourceKind>([
  'drawing',
  'specification',
  'schedule',
  'rfi',
  'submittal',
  'task',
  'field_note',
  'photo',
  'other',
]);

const ITEM_KINDS = new Set<ECOSSourceItemKind>(['page', 'record', 'image']);

const PROCESSING_STATES = new Set<ECOSSourceProcessingState>([
  'pending',
  'processing',
  'complete',
  'empty',
  'partial',
  'unreadable',
  'unsupported',
  'failed',
  'superseded',
]);

const EXTRACTION_METHODS = new Set<ECOSExtractionMethod>([
  'native_text',
  'ocr',
  'document_vision',
  'vector_geometry',
  'structured_table',
  'application_record',
]);

const TERMINAL_STATES = new Set<ECOSSourceProcessingState>([
  'complete',
  'empty',
  'partial',
  'unreadable',
  'unsupported',
  'failed',
  'superseded',
]);

const USABLE_STATES = new Set<ECOSSourceProcessingState>([
  'complete',
  'partial',
]);

function exactIdentity(value: unknown, field: string, maximumBytes = 500) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (
    !trimmed || value !== trimmed ||
    new TextEncoder().encode(trimmed).length > maximumBytes ||
    [...trimmed].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error(`${field} is not a valid exact identity`);
  }
  return trimmed;
}

function exactSha256(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('sourceSha256 must be one lowercase SHA-256 value');
  }
  return value;
}

function normalizeSourceIdentity(
  input: ECOSSourceProcessingIdentity,
): Readonly<ECOSSourceProcessingIdentity> {
  if (!input || typeof input !== 'object') {
    throw new Error('sourceIdentity is required');
  }
  return Object.freeze({
    organizationId: exactIdentity(input.organizationId, 'organizationId'),
    projectId: exactIdentity(input.projectId, 'projectId'),
    sourceId: exactIdentity(input.sourceId, 'sourceId', 300),
    sourceSha256: exactSha256(input.sourceSha256),
    sourceRevision: input.sourceRevision === null
      ? null
      : exactIdentity(input.sourceRevision, 'sourceRevision', 300),
    snapshotId: exactIdentity(input.snapshotId, 'snapshotId', 300),
    extractionVersion: exactIdentity(
      input.extractionVersion,
      'extractionVersion',
      300,
    ),
  });
}

function boundedOrdinal(value: unknown, field: string) {
  if (
    !Number.isSafeInteger(value) || Number(value) < 1 ||
    Number(value) > ECOS_MAX_SOURCE_ITEMS
  ) {
    throw new Error(
      `${field} must be an integer from 1 through ${ECOS_MAX_SOURCE_ITEMS}`,
    );
  }
  return Number(value);
}

function boundedEvidenceCount(value: unknown) {
  if (
    !Number.isSafeInteger(value) || Number(value) < 0 ||
    Number(value) > 1_000_000
  ) {
    throw new Error(
      'evidenceRecordCount must be a bounded non-negative integer',
    );
  }
  return Number(value);
}

function uniqueStrings(
  values: readonly string[] | undefined,
  field: string,
  maximumValues: number,
) {
  if (values === undefined) return Object.freeze([]) as readonly string[];
  if (!Array.isArray(values) || values.length > maximumValues) {
    throw new Error(`${field} exceeds its bounded list`);
  }
  const normalized = values.map((value, index) =>
    exactIdentity(value, `${field}[${index}]`, 200)
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} contains a duplicate value`);
  }
  return Object.freeze(normalized);
}

function gapForState(
  state: ECOSSourceProcessingState,
): ECOSSourceGapCode | null {
  switch (state) {
    case 'pending':
    case 'processing':
      return 'processing_incomplete';
    case 'partial':
      return 'partially_readable';
    case 'unreadable':
      return 'unreadable_content';
    case 'unsupported':
      return 'unsupported_content';
    case 'failed':
      return 'processing_failed';
    case 'complete':
    case 'empty':
      return null;
    case 'superseded':
      return 'superseded_source';
  }
}

function sourceStateFor(
  items: readonly ECOSAccountedSourceItem[],
): ECOSSourceProcessingState {
  const states = new Set(items.map((item) => item.state));
  if (states.has('pending')) return 'pending';
  if (states.has('processing')) return 'processing';
  if (states.size === 1 && states.has('superseded')) return 'superseded';
  if (states.size === 1 && states.has('unsupported')) return 'unsupported';
  if (states.size === 1 && states.has('unreadable')) return 'unreadable';
  if (states.size === 1 && states.has('failed')) return 'failed';
  if (states.size === 1 && states.has('complete')) return 'complete';
  if (states.size === 1 && states.has('empty')) return 'empty';
  return 'partial';
}

function percent(numerator: number, denominator: number) {
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function normalizeExpectedItem(
  item: ECOSExpectedSourceItem,
  index: number,
): ECOSExpectedSourceItem {
  if (!item || typeof item !== 'object') {
    throw new Error(`expectedItems[${index}] must be an object`);
  }
  if (!ITEM_KINDS.has(item.itemKind)) {
    throw new Error(`expectedItems[${index}].itemKind is unsupported`);
  }
  return Object.freeze({
    itemKey: exactIdentity(
      item.itemKey,
      `expectedItems[${index}].itemKey`,
      300,
    ),
    itemKind: item.itemKind,
    ordinal: boundedOrdinal(item.ordinal, `expectedItems[${index}].ordinal`),
  });
}

function normalizeResult(
  result: ECOSSourceItemResult,
  expected: ECOSExpectedSourceItem,
  sourceIdentity: Readonly<ECOSSourceProcessingIdentity>,
  index: number,
): ECOSAccountedSourceItem {
  if (!result || typeof result !== 'object') {
    throw new Error(`itemResults[${index}] must be an object`);
  }
  if (!PROCESSING_STATES.has(result.state)) {
    throw new Error(`itemResults[${index}].state is unsupported`);
  }
  const resultIdentity = normalizeSourceIdentity(result.sourceIdentity);
  if (
    Object.keys(sourceIdentity).some((key) =>
      resultIdentity[key as keyof ECOSSourceProcessingIdentity] !==
        sourceIdentity[key as keyof ECOSSourceProcessingIdentity]
    )
  ) {
    throw new Error(
      `itemResults[${index}] does not match the exact source processing identity`,
    );
  }
  if (
    result.itemKind !== expected.itemKind ||
    result.ordinal !== expected.ordinal
  ) {
    throw new Error(
      `itemResults[${index}] does not match its expected source item`,
    );
  }
  if (
    !Array.isArray(result.extractionMethods) ||
    result.extractionMethods.length > 8
  ) {
    throw new Error(
      `itemResults[${index}].extractionMethods exceeds its bounded list`,
    );
  }
  const methods = result.extractionMethods.map((method) => {
    if (!EXTRACTION_METHODS.has(method)) {
      throw new Error(
        `itemResults[${index}] has an unsupported extraction method`,
      );
    }
    return method;
  });
  if (new Set(methods).size !== methods.length) {
    throw new Error(`itemResults[${index}] has duplicate extraction methods`);
  }
  if (
    (USABLE_STATES.has(result.state) || result.state === 'empty') &&
    methods.length === 0
  ) {
    throw new Error(
      `itemResults[${index}] requires a completed extraction method`,
    );
  }
  const evidenceRecordCount = boundedEvidenceCount(result.evidenceRecordCount);
  if (USABLE_STATES.has(result.state) && evidenceRecordCount === 0) {
    throw new Error(
      `itemResults[${index}] cannot be usable without evidence records`,
    );
  }
  if (!USABLE_STATES.has(result.state) && evidenceRecordCount !== 0) {
    throw new Error(
      `itemResults[${index}] cannot retain evidence in state ${result.state}`,
    );
  }
  const limitationCodes = uniqueStrings(
    result.limitationCodes,
    `itemResults[${index}].limitationCodes`,
    32,
  );
  const gapCode = gapForState(result.state);
  if (gapCode && limitationCodes.length === 0) {
    throw new Error(`itemResults[${index}] must explain its processing gap`);
  }
  if (result.state === 'complete' && limitationCodes.length > 0) {
    throw new Error(
      `itemResults[${index}] cannot hide limitations in a complete result`,
    );
  }
  if (
    result.state === 'empty' &&
    (limitationCodes.length !== 1 ||
      limitationCodes[0] !== 'empty_content_verified')
  ) {
    throw new Error(
      `itemResults[${index}] requires explicit empty_content_verified assurance`,
    );
  }
  return Object.freeze({
    ...expected,
    sourceIdentity: resultIdentity,
    state: result.state,
    extractionMethods: Object.freeze(methods),
    evidenceRecordCount,
    limitationCodes,
    gapCode,
  });
}

/**
 * Produces a complete, bounded inventory for one immutable source revision.
 * Missing processing results become explicit pending gaps; they are never
 * omitted or mistaken for a source that contained no useful information.
 */
export function buildECOSSourceAccountabilityManifest(
  input: ECOSSourceAccountabilityInput,
): ECOSSourceAccountabilityManifest {
  if (!input || typeof input !== 'object') {
    throw new Error('source input is required');
  }
  if (!SOURCE_KINDS.has(input.sourceKind)) {
    throw new Error('sourceKind is unsupported');
  }
  const sourceIdentity = normalizeSourceIdentity({
    ...input,
    sourceRevision: input.sourceRevision === undefined
      ? null
      : input.sourceRevision,
  });
  const expectedItemCount = boundedOrdinal(
    input.expectedItemCount,
    'expectedItemCount',
  );
  if (
    !Array.isArray(input.expectedItems) || input.expectedItems.length < 1 ||
    input.expectedItems.length > ECOS_MAX_SOURCE_ITEMS
  ) {
    throw new Error(
      `expectedItems must contain 1 through ${ECOS_MAX_SOURCE_ITEMS} entries`,
    );
  }
  if (input.expectedItems.length !== expectedItemCount) {
    throw new Error(
      'expectedItems must account for the independently measured expectedItemCount',
    );
  }
  if (
    !Array.isArray(input.itemResults) ||
    input.itemResults.length > ECOS_MAX_SOURCE_ITEMS
  ) {
    throw new Error(`itemResults exceeds ${ECOS_MAX_SOURCE_ITEMS} entries`);
  }

  const expectedItems = input.expectedItems.map(normalizeExpectedItem);
  const expectedByKey = new Map<string, ECOSExpectedSourceItem>();
  const ordinals = new Set<number>();
  for (const item of expectedItems) {
    if (expectedByKey.has(item.itemKey)) {
      throw new Error('expectedItems contains a duplicate itemKey');
    }
    if (ordinals.has(item.ordinal)) {
      throw new Error('expectedItems contains a duplicate ordinal');
    }
    expectedByKey.set(item.itemKey, item);
    ordinals.add(item.ordinal);
  }
  for (let ordinal = 1; ordinal <= expectedItemCount; ordinal += 1) {
    if (!ordinals.has(ordinal)) {
      throw new Error('expectedItems must contain contiguous source ordinals');
    }
  }

  const resultsByKey = new Map<string, ECOSSourceItemResult>();
  for (const [index, result] of input.itemResults.entries()) {
    const itemKey = exactIdentity(
      result?.itemKey,
      `itemResults[${index}].itemKey`,
      300,
    );
    if (!expectedByKey.has(itemKey)) {
      throw new Error('itemResults contains an unexpected itemKey');
    }
    if (resultsByKey.has(itemKey)) {
      throw new Error('itemResults contains a duplicate itemKey');
    }
    resultsByKey.set(itemKey, result);
  }

  const items = expectedItems
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((expected) => {
      const result = resultsByKey.get(expected.itemKey);
      if (result) {
        return normalizeResult(
          result,
          expected,
          sourceIdentity,
          expected.ordinal - 1,
        );
      }
      return Object.freeze({
        ...expected,
        sourceIdentity,
        state: 'pending' as const,
        extractionMethods: Object.freeze([]) as readonly ECOSExtractionMethod[],
        evidenceRecordCount: 0,
        limitationCodes: Object.freeze(['missing_processing_result']),
        gapCode: 'missing_processing_result' as const,
      });
    });

  const terminalItemCount =
    items.filter((item) => TERMINAL_STATES.has(item.state)).length;
  const usableItemCount =
    items.filter((item) => USABLE_STATES.has(item.state)).length;
  const emptyItemCount = items.filter((item) => item.state === 'empty').length;
  const gapItemCount = items.filter((item) => item.gapCode !== null).length;

  return Object.freeze({
    schemaVersion: ECOS_SOURCE_ACCOUNTABILITY_SCHEMA_VERSION,
    ...sourceIdentity,
    sourceKind: input.sourceKind,
    expectedItemCount,
    reportedItemCount: resultsByKey.size,
    terminalItemCount,
    usableItemCount,
    emptyItemCount,
    gapItemCount,
    processingCoveragePercent: percent(terminalItemCount, expectedItemCount),
    usableCoveragePercent: percent(usableItemCount, expectedItemCount),
    fullyAccounted: terminalItemCount === expectedItemCount,
    fullyUsable: items.every((item) => item.state === 'complete'),
    sourceState: sourceStateFor(items),
    items: Object.freeze(items),
  });
}

/**
 * Revalidates a persisted receipt instead of trusting its summary booleans.
 * The registered source count and snapshot still need to be obtained from a
 * trusted inventory producer; this structural check does not authenticate them
 * or establish that an extraction claim is factually correct.
 */
export function validateECOSSourceAccountabilityManifest(
  value: unknown,
): ECOSSourceAccountabilityManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('source manifest is required');
  }
  const manifest = value as ECOSSourceAccountabilityManifest;
  if (manifest.schemaVersion !== ECOS_SOURCE_ACCOUNTABILITY_SCHEMA_VERSION) {
    throw new Error('source manifest has an unsupported schemaVersion');
  }
  if (
    !Array.isArray(manifest.items) ||
    manifest.items.length > ECOS_MAX_SOURCE_ITEMS
  ) {
    throw new Error('source manifest has an invalid item inventory');
  }
  const expectedItems = manifest.items.map((item, index) =>
    normalizeExpectedItem(item, index)
  );
  const rebuilt = buildECOSSourceAccountabilityManifest({
    ...manifest,
    expectedItems,
    itemResults: manifest.items.filter((item) =>
      item.gapCode !== 'missing_processing_result'
    ),
  });
  const summaryFields = [
    'expectedItemCount',
    'reportedItemCount',
    'terminalItemCount',
    'usableItemCount',
    'emptyItemCount',
    'gapItemCount',
    'processingCoveragePercent',
    'usableCoveragePercent',
    'fullyAccounted',
    'fullyUsable',
    'sourceState',
  ] as const;
  for (const field of summaryFields) {
    if (manifest[field] !== rebuilt[field]) {
      throw new Error(`source manifest has an inconsistent ${field}`);
    }
  }
  const originalByKey = new Map(
    manifest.items.map((item) => [item.itemKey, item]),
  );
  for (const item of rebuilt.items) {
    const original = originalByKey.get(item.itemKey)!;
    if (
      original.state !== item.state || original.gapCode !== item.gapCode ||
      original.evidenceRecordCount !== item.evidenceRecordCount ||
      JSON.stringify(original.extractionMethods) !==
        JSON.stringify(item.extractionMethods) ||
      JSON.stringify(original.limitationCodes) !==
        JSON.stringify(item.limitationCodes) ||
      JSON.stringify(normalizeSourceIdentity(original.sourceIdentity)) !==
        JSON.stringify(item.sourceIdentity)
    ) {
      throw new Error(
        `source manifest has an inconsistent item ${item.itemKey}`,
      );
    }
  }
  return rebuilt;
}

export function expectedECOSPageItems(pageCount: number) {
  const count = boundedOrdinal(pageCount, 'pageCount');
  return Object.freeze(
    Array.from({ length: count }, (_, index) =>
      Object.freeze({
        itemKey: `page:${index + 1}`,
        itemKind: 'page' as const,
        ordinal: index + 1,
      })),
  );
}
