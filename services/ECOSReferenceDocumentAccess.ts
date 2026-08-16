import type { ReferenceDocument } from '../types';

export type ReferenceDocumentByteRecoveryRequest = Readonly<{
  documentId: string;
  storagePath: string;
  originalFileName: string;
  expectedSizeBytes: number;
  expectedSha256: string;
}>;

export type RecoveredReferenceDocumentBytes = Readonly<{
  uri: string;
  sizeBytes: number;
  sha256: string;
}>;

export type ReferenceDocumentByteRecoveryCommit =
  | Readonly<{
      status: 'stale';
      documents: readonly ReferenceDocument[];
      document: null;
      changed: false;
    }>
  | Readonly<{
      status: 'committed';
      documents: readonly ReferenceDocument[];
      document: ReferenceDocument;
      changed: boolean;
    }>;

export type ReferenceDocumentOpenOutcome = 'shared' | 'stale' | 'unavailable';

/**
 * Restores and verifies local bytes without mutating document authority, React
 * state, or the durable sync queue. The caller must use the exact-authority CAS
 * below before publishing the recovered URI back into shared document state.
 */
export async function prepareReferenceDocumentByteRecovery({
  document,
  recover,
}: Readonly<{
  document: ReferenceDocument;
  recover: (
    request: ReferenceDocumentByteRecoveryRequest,
  ) => Promise<RecoveredReferenceDocumentBytes>;
}>): Promise<ReferenceDocument> {
  const documentId = clean(document.id);
  const storagePath = clean(document.storagePath);
  const originalFileName = clean(document.originalFileName);
  const expectedSizeBytes = positiveSafeInteger(document.sizeBytes);
  const expectedSha256 =
    canonicalSha256(document.contentSha256) ||
    canonicalSha256(document.webFileFingerprint);
  if (
    !documentId || !storagePath || !originalFileName ||
    !expectedSizeBytes || !expectedSha256
  ) {
    throw new Error(
      'This older cloud document does not include the checksum needed for safe recovery.',
    );
  }

  const restored = await recover({
    documentId,
    storagePath,
    originalFileName,
    expectedSizeBytes,
    expectedSha256,
  });
  const restoredUri = clean(restored.uri);
  const restoredSizeBytes = positiveSafeInteger(restored.sizeBytes);
  const restoredSha256 = canonicalSha256(restored.sha256);
  if (
    !restoredUri ||
    restoredSizeBytes !== expectedSizeBytes ||
    restoredSha256 !== expectedSha256
  ) {
    throw new Error('The recovered document bytes did not match the exact source record.');
  }

  return {
    ...document,
    uri: restoredUri,
    sizeBytes: restoredSizeBytes,
    contentSha256: restoredSha256,
  };
}

/**
 * Compare-and-swap for recovered byte metadata. Authority fields must still
 * match the exact record captured before recovery. Harmless concurrent edits
 * such as notes and display metadata are inherited from the latest record;
 * captured authority is never spread back over current state.
 */
export function commitReferenceDocumentByteRecovery({
  documents,
  expectedDocument,
  readableDocument,
  updatedAt,
}: Readonly<{
  documents: readonly ReferenceDocument[];
  expectedDocument: ReferenceDocument;
  readableDocument: ReferenceDocument;
  updatedAt: string;
}>): ReferenceDocumentByteRecoveryCommit {
  const matchingIndexes = documents
    .map((document, index) => document.id === expectedDocument.id ? index : -1)
    .filter(index => index >= 0);
  if (matchingIndexes.length !== 1) return staleCommit(documents);

  const currentIndex = matchingIndexes[0];
  const currentDocument = documents[currentIndex];
  if (
    !referenceDocumentRecoveryAuthorityMatches(expectedDocument, currentDocument) ||
    !referenceDocumentRecoveryAuthorityMatches(expectedDocument, readableDocument)
  ) return staleCommit(documents);

  const expectedSha256 =
    canonicalSha256(expectedDocument.contentSha256) ||
    canonicalSha256(expectedDocument.webFileFingerprint);
  const readableSha256 = canonicalSha256(readableDocument.contentSha256);
  const expectedSizeBytes = positiveSafeInteger(expectedDocument.sizeBytes);
  const readableSizeBytes = positiveSafeInteger(readableDocument.sizeBytes);
  const readableUri = clean(readableDocument.uri);
  if (
    !expectedSha256 ||
    readableSha256 !== expectedSha256 ||
    !expectedSizeBytes ||
    readableSizeBytes !== expectedSizeBytes ||
    !readableUri
  ) return staleCommit(documents);

  const changed =
    currentDocument.uri !== readableUri ||
    currentDocument.sizeBytes !== readableSizeBytes ||
    canonicalSha256(currentDocument.contentSha256) !== readableSha256;
  if (!changed) {
    return {
      status: 'committed',
      documents,
      document: currentDocument,
      changed: false,
    };
  }

  const committedDocument: ReferenceDocument = {
    ...currentDocument,
    uri: readableUri,
    sizeBytes: readableSizeBytes,
    contentSha256: readableSha256,
    updatedAt,
  };
  const nextDocuments = documents.map((document, index) =>
    index === currentIndex ? committedDocument : document
  );
  return {
    status: 'committed',
    documents: nextDocuments,
    document: committedDocument,
    changed: true,
  };
}

/**
 * Runs the native open/share workflow with a live authority check after every
 * asynchronous preparation boundary. The final check and share invocation are
 * adjacent, so no JavaScript task can interleave between them.
 */
export async function openReferenceDocumentWithAuthority({
  document,
  prepareDocument,
  isAuthorityCurrent,
  isShareAvailable,
  shareDocument,
}: Readonly<{
  document: ReferenceDocument;
  prepareDocument: (document: ReferenceDocument) => Promise<ReferenceDocument>;
  isAuthorityCurrent: (document: ReferenceDocument) => boolean;
  isShareAvailable: () => Promise<boolean>;
  shareDocument: (document: ReferenceDocument) => Promise<void>;
}>): Promise<ReferenceDocumentOpenOutcome> {
  const readableDocument = await prepareDocument(document);
  if (!isAuthorityCurrent(readableDocument)) return 'stale';

  if (!await isShareAvailable()) return 'unavailable';

  if (!isAuthorityCurrent(readableDocument)) return 'stale';
  await shareDocument(readableDocument);
  return 'shared';
}

export function referenceDocumentRecoveryAuthorityMatches(
  left: ReferenceDocument,
  right: ReferenceDocument,
): boolean {
  return authorityKey(left) === authorityKey(right);
}

function authorityKey(document: ReferenceDocument): string {
  return JSON.stringify({
    id: clean(document.id),
    name: clean(document.name),
    originalFileName: clean(document.originalFileName),
    mimeType: clean(document.mimeType),
    category: clean(document.category),
    projectId: clean(document.projectId),
    projectName: clean(document.projectName),
    projectNames: normalizedProjectNames(document.projectNames),
    importBatchId: clean(document.importBatchId),
    isCurrent: document.isCurrent === true,
    storagePath: clean(document.storagePath),
    sizeBytes: positiveSafeInteger(document.sizeBytes),
    contentSha256: canonicalSha256(document.contentSha256),
    indexedContentSha256: canonicalSha256(document.indexedContentSha256),
    drawingNumber: clean(document.drawingNumber),
    drawingRevision: clean(document.drawingRevision),
    drawingDiscipline: clean(document.drawingDiscipline),
    drawingIssuedAt: clean(document.drawingIssuedAt),
    drawingStatus: clean(document.drawingStatus),
    sourcePageCount: nonNegativeSafeInteger(document.sourcePageCount),
    webFileFingerprint: canonicalSha256(document.webFileFingerprint),
    webVersionGroupId: clean(document.webVersionGroupId),
    verifiedCommitVersion: clean(document.ecosVerifiedIndexCommitVersion),
    verifiedCommittedSha256: canonicalSha256(
      document.ecosVerifiedIndexCommittedSha256,
    ),
    verifiedCommittedPageCount: positiveSafeInteger(
      document.ecosVerifiedIndexCommittedPageCount,
    ),
    verifiedPageGraphSha256: canonicalSha256(
      document.ecosVerifiedIndexPageGraphSha256,
    ),
    hostedEvidenceVersion: clean(document.ecosHostedIndexEvidenceVersion),
  });
}

function normalizedProjectNames(values: readonly string[] | null | undefined) {
  return Array.from(new Set((values || []).map(clean).filter(Boolean))).sort();
}

function staleCommit(
  documents: readonly ReferenceDocument[],
): ReferenceDocumentByteRecoveryCommit {
  return {
    status: 'stale',
    documents,
    document: null,
    changed: false,
  };
}

function positiveSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function canonicalSha256(value: unknown): string | null {
  const normalized = clean(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
