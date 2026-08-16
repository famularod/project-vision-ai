import {
  commitReferenceDocumentByteRecovery,
  openReferenceDocumentWithAuthority,
  prepareReferenceDocumentByteRecovery,
  referenceDocumentRecoveryAuthorityMatches,
} from '../../services/ECOSReferenceDocumentAccess';
import type { ReferenceDocument } from '../../types';

const SHA = 'a'.repeat(64);
const document: ReferenceDocument = {
  id: 'drawing-1',
  projectId: 'project-1',
  projectName: 'Hospital',
  projectNames: ['Hospital'],
  name: 'A101',
  originalFileName: 'A101.pdf',
  uri: '',
  mimeType: 'application/pdf',
  category: 'Drawing',
  notes: 'Original note.',
  isCurrent: true,
  importedAt: '2026-08-09T00:00:00.000Z',
  storagePath: 'owner-1/project-1/drawing-1.pdf',
  sizeBytes: 1024,
  contentSha256: SHA,
  indexedContentSha256: SHA,
  drawingRevision: '4',
  drawingNumber: 'A101',
  drawingDiscipline: 'Architectural',
  drawingIssuedAt: '2026-08-09',
  drawingStatus: 'For Construction',
  sourcePageCount: 1,
  webVersionGroupId: 'drawing-family-1',
  ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
  ecosVerifiedIndexCommittedSha256: SHA,
  ecosVerifiedIndexCommittedPageCount: 1,
  ecosVerifiedIndexPageGraphSha256: 'b'.repeat(64),
  ecosHostedIndexEvidenceVersion: 'ecos-hosted-evidence/1.3',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe('ECOS reference document access', () => {
  it('keeps byte preparation side-effect free and rejects a superseded authority at CAS', async () => {
    const pendingRestore = deferred<Readonly<{
      uri: string;
      sizeBytes: number;
      sha256: string;
    }>>();
    let currentDocuments: readonly ReferenceDocument[] = [document];
    const preparation = prepareReferenceDocumentByteRecovery({
      document,
      recover: jest.fn(() => pendingRestore.promise),
    });

    const superseded = { ...document, isCurrent: false, notes: 'Superseded by revision 5.' };
    currentDocuments = [superseded];
    pendingRestore.resolve({
      uri: 'file:///recovered/A101.pdf',
      sizeBytes: 1024,
      sha256: SHA,
    });
    const readable = await preparation;

    expect(currentDocuments).toEqual([superseded]);
    const commit = commitReferenceDocumentByteRecovery({
      documents: currentDocuments,
      expectedDocument: document,
      readableDocument: readable,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });
    expect(commit.status).toBe('stale');
    expect(commit.documents).toBe(currentDocuments);
  });

  it('commits only verified byte fields while preserving a legitimate notes-only update', async () => {
    const latest = {
      ...document,
      notes: 'Reviewed by the PM while recovery was pending.',
      updatedAt: '2026-08-10T11:59:00.000Z',
      cloudUpdatedAt: '2026-08-10T11:59:01.000Z',
    };
    const readable = await prepareReferenceDocumentByteRecovery({
      document,
      recover: jest.fn(async () => ({
        uri: 'file:///recovered/A101.pdf',
        sizeBytes: 1024,
        sha256: SHA,
      })),
    });
    const commit = commitReferenceDocumentByteRecovery({
      documents: [latest],
      expectedDocument: document,
      readableDocument: readable,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    expect(commit.status).toBe('committed');
    if (commit.status !== 'committed') throw new Error('Expected committed recovery.');
    expect(commit.document).toMatchObject({
      uri: 'file:///recovered/A101.pdf',
      sizeBytes: 1024,
      contentSha256: SHA,
      notes: latest.notes,
      cloudUpdatedAt: latest.cloudUpdatedAt,
      isCurrent: true,
    });
    expect(commit.document.updatedAt).toBe('2026-08-10T12:00:00.000Z');
  });

  it.each([
    ['document name', { name: 'A101 superseded' }],
    ['original file name', { originalFileName: 'A101-reissued.pdf' }],
    ['document MIME type', { mimeType: 'application/octet-stream' }],
    ['document category', { category: 'Specifications' }],
    ['project identity', { projectId: 'project-2' }],
    ['current revision state', { isCurrent: false }],
    ['drawing number', { drawingNumber: 'A102' }],
    ['drawing revision', { drawingRevision: '5' }],
    ['drawing discipline', { drawingDiscipline: 'Structural' }],
    ['drawing issued date', { drawingIssuedAt: '2026-08-10' }],
    ['drawing status', { drawingStatus: 'Superseded' }],
    ['source page count', { sourcePageCount: 2 }],
    ['source hash', { contentSha256: 'c'.repeat(64) }],
    ['storage locator', { storagePath: 'owner-1/project-1/drawing-2.pdf' }],
    ['verified commit', { ecosVerifiedIndexCommittedSha256: 'c'.repeat(64) }],
  ] as Array<[string, Partial<ReferenceDocument>]>)('rejects a concurrent %s authority change', (_label, change) => {
    expect(referenceDocumentRecoveryAuthorityMatches(
      document,
      { ...document, ...change },
    )).toBe(false);
  });

  it.each([
    ['missing row', []],
    ['duplicate row', [document, { ...document }]],
  ] as const)('rejects an ambiguous %s at commit', (_label, documents) => {
    const readable = { ...document, uri: 'file:///recovered/A101.pdf' };
    const commit = commitReferenceDocumentByteRecovery({
      documents,
      expectedDocument: document,
      readableDocument: readable,
      updatedAt: '2026-08-10T12:00:00.000Z',
    });

    expect(commit.status).toBe('stale');
    expect(commit.documents).toBe(documents);
  });

  it('rechecks authority after preparation before checking share availability', async () => {
    const pendingPreparation = deferred<ReferenceDocument>();
    let authorityCurrent = true;
    const shareDocument = jest.fn(async () => undefined);
    const isShareAvailable = jest.fn(async () => true);
    const open = openReferenceDocumentWithAuthority({
      document,
      prepareDocument: jest.fn(() => pendingPreparation.promise),
      isAuthorityCurrent: jest.fn(() => authorityCurrent),
      isShareAvailable,
      shareDocument,
    });

    authorityCurrent = false;
    pendingPreparation.resolve({ ...document, uri: 'file:///recovered/A101.pdf' });

    await expect(open).resolves.toBe('stale');
    expect(isShareAvailable).not.toHaveBeenCalled();
    expect(shareDocument).not.toHaveBeenCalled();
  });

  it('rechecks authority after the final await immediately before external share', async () => {
    const pendingAvailability = deferred<boolean>();
    let authorityCurrent = true;
    const readable = { ...document, uri: 'file:///recovered/A101.pdf' };
    const shareDocument = jest.fn(async () => undefined);
    const open = openReferenceDocumentWithAuthority({
      document,
      prepareDocument: jest.fn(async () => readable),
      isAuthorityCurrent: jest.fn(() => authorityCurrent),
      isShareAvailable: jest.fn(() => pendingAvailability.promise),
      shareDocument,
    });

    await Promise.resolve();
    authorityCurrent = false;
    pendingAvailability.resolve(true);

    await expect(open).resolves.toBe('stale');
    expect(shareDocument).not.toHaveBeenCalled();
  });

  it('preserves notes-only concurrency through the final external-share guard', async () => {
    const readable = { ...document, uri: 'file:///recovered/A101.pdf' };
    const latest = { ...document, notes: 'Reviewed by the PM.' };
    const shareDocument = jest.fn(async () => undefined);
    const outcome = await openReferenceDocumentWithAuthority({
      document,
      prepareDocument: jest.fn(async () => readable),
      isAuthorityCurrent: candidate =>
        referenceDocumentRecoveryAuthorityMatches(document, latest) &&
        referenceDocumentRecoveryAuthorityMatches(candidate, latest),
      isShareAvailable: jest.fn(async () => true),
      shareDocument,
    });

    expect(outcome).toBe('shared');
    expect(shareDocument).toHaveBeenCalledTimes(1);
    expect(shareDocument).toHaveBeenCalledWith(readable);
  });
});
