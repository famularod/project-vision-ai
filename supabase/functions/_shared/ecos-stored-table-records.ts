import {
  type ECOSExpectedTableSource,
  type ECOSTableRecords,
  projectECOSTableRecords,
} from './ecos-table-evidence-records.ts';

export const ECOS_STORED_TABLE_RECORD_SCHEMA_VERSION =
  'ecos-stored-table-records/2.0' as const;
export const ECOS_STORED_TABLE_SOURCE_SCHEMA_VERSION =
  'ecos-stored-page-table-sources/2.0' as const;

export interface ECOSExpectedStoredTableSource extends ECOSExpectedTableSource {
  /** Obtained from the independently trusted current compact projection head. */
  projectionId: string;
  /** PostgreSQL's canonical payload digest, pinned by that trusted head. */
  projectionSha256: string;
}

export interface ECOSStoredTableRecords {
  schemaVersion: typeof ECOS_STORED_TABLE_RECORD_SCHEMA_VERSION;
  verificationStatus: 'structure_only_requires_assurance';
  storage: Readonly<{
    publicationMode: 'shadow';
    projectionId: string;
    projectionSha256: string;
  }>;
  projection: Readonly<ECOSTableRecords>;
}

const STORED_KEYS = [
  'schema_version',
  'publication_mode',
  'job_id',
  'organization_id',
  'project_id',
  'source_id',
  'source_sha256',
  'source_revision',
  'source_page_count',
  'extraction_version',
  'page_number',
  'projection_id',
  'projection_sha256',
  'payload',
] as const;

function storedEnvelope(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('stored table readback must be an object');
  }
  const keys = Object.keys(value);
  if (
    keys.length !== STORED_KEYS.length ||
    keys.some((key) => !STORED_KEYS.includes(key as typeof STORED_KEYS[number]))
  ) throw new Error('stored table readback has missing or unsupported fields');
  // RPC JSON contains data properties, not executable accessors. Snapshot the
  // validated outer envelope before entering the asynchronous consumer.
  const output: Record<string, unknown> = {};
  for (const key of STORED_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(
        'stored table readback must contain only data properties',
      );
    }
    output[key] = descriptor.value;
  }
  return output;
}

function projectionIdentity(value: unknown, kind: 'id' | 'sha256'): string {
  const pattern = kind === 'id'
    ? /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
    : /^[a-f0-9]{64}$/;
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`trusted projection ${kind} is not canonical`);
  }
  return value;
}

/**
 * Internal, service-only diagnostic composition for a readback obtained through
 * an exact registered-source reader (leased worker or current linked manifest).
 * This function performs no network request,
 * authentication or authorization and is not a customer API. Its caller must
 * resolve the trusted current compact head independently, not copy identities
 * out of the untrusted readback into `expected`.
 *
 * The pinned hash is PostgreSQL's canonical JSONB digest. JavaScript JSON string
 * ordering is not that canonical encoding: this adapter compares head identity
 * and relies on the database's immutable projection/hash invariant. It is not a
 * cryptographic verifier of an arbitrary caller-supplied payload.
 *
 * The envelope has no manifest or snapshot fields. Their independently trusted
 * expected values are propagated, NOT claimed verified against this readback.
 * Actual graph-manifest binding, current authority resolution, content Assurance
 * and customer retrieval remain separate stages. A stored source report never
 * becomes a verified fact merely because it was persisted.
 */
export async function projectECOSStoredTableRecords(
  raw: unknown,
  expectedInput: ECOSExpectedStoredTableSource,
): Promise<Readonly<ECOSStoredTableRecords>> {
  if (!expectedInput || typeof expectedInput !== 'object') {
    throw new Error('independently trusted stored source identity is required');
  }
  const projectionId = projectionIdentity(expectedInput.projectionId, 'id');
  const projectionSha256 = projectionIdentity(
    expectedInput.projectionSha256,
    'sha256',
  );
  // Copy only the expected primitive identity fields. The typed consumer checks
  // every field's format and bounds before it can begin asynchronous hashing.
  const expected: ECOSExpectedTableSource = {
    jobId: expectedInput.jobId,
    organizationId: expectedInput.organizationId,
    projectId: expectedInput.projectId,
    sourceId: expectedInput.sourceId,
    sourceSha256: expectedInput.sourceSha256,
    sourceRevision: expectedInput.sourceRevision,
    sourcePageCount: expectedInput.sourcePageCount,
    pageNumber: expectedInput.pageNumber,
    extractionVersion: expectedInput.extractionVersion,
    sourceKind: expectedInput.sourceKind,
    manifestId: expectedInput.manifestId,
    snapshotId: expectedInput.snapshotId,
  };
  const stored = storedEnvelope(raw);
  if (
    stored.schema_version !== ECOS_STORED_TABLE_SOURCE_SCHEMA_VERSION ||
    stored.publication_mode !== 'shadow'
  ) throw new Error('stored table readback is not the supported shadow schema');
  const pairs = [
    ['job_id', expected.jobId],
    ['organization_id', expected.organizationId],
    ['project_id', expected.projectId],
    ['source_id', expected.sourceId],
    ['source_sha256', expected.sourceSha256],
    ['source_revision', expected.sourceRevision],
    ['source_page_count', expected.sourcePageCount],
    ['extraction_version', expected.extractionVersion],
    ['page_number', expected.pageNumber],
    ['projection_id', projectionId],
    ['projection_sha256', projectionSha256],
  ] as const;
  if (pairs.some(([key, value]) => stored[key] !== value)) {
    throw new Error(
      'stored table readback does not match the trusted source and projection head',
    );
  }
  // This consumer synchronously validates and deep-copies the complete nested
  // payload before its first await (the proposed-record digest). Consequently
  // caller mutation during that await cannot alter any retained source cells.
  const pendingProjection = projectECOSTableRecords(stored.payload, expected);
  const projection = await pendingProjection;
  return Object.freeze({
    schemaVersion: ECOS_STORED_TABLE_RECORD_SCHEMA_VERSION,
    verificationStatus: 'structure_only_requires_assurance',
    storage: Object.freeze({
      publicationMode: 'shadow',
      projectionId,
      projectionSha256,
    }),
    projection,
  });
}
