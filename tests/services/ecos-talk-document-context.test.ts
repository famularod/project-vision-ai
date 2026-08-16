const mockSearchECOSDocumentCloudIndex = jest.fn();
const mockHydrateECOSDocumentsFromCloudSearch = jest.fn((documents: unknown, _rows: unknown) => documents);

jest.mock('../../services/ECOSDocumentCloudIndex', () => ({
  searchECOSDocumentCloudIndex: (...args: unknown[]) => mockSearchECOSDocumentCloudIndex(...args),
  hydrateECOSDocumentsFromCloudSearch: (documents: unknown, rows: unknown) =>
    mockHydrateECOSDocumentsFromCloudSearch(documents, rows),
}));
jest.mock('../../services/ECOSDocumentReadiness', () => ({
  buildECOSDocumentReadiness: () => ({ eligibleForAnswers: true }),
}));

import { loadECOSTalkReferenceDocuments } from '../../services/ECOSTalkDocumentContext';
import type { ReferenceDocument } from '../../types';

function metadataOnlyDrawing(id: string, projectId: string): ReferenceDocument {
  const sourceSha256 = 'a'.repeat(64);
  return {
    id,
    projectId,
    projectName: 'Shared Name',
    projectNames: ['Shared Name'],
    name: `${id}.pdf`,
    originalFileName: `${id}.pdf`,
    uri: '',
    mimeType: 'application/pdf',
    category: 'Drawing',
    notes: '',
    isCurrent: true,
    importedAt: '2026-08-09T12:00:00.000Z',
    contentSha256: sourceSha256,
    indexedContentSha256: sourceSha256,
    ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
    ecosVerifiedIndexCommittedSha256: sourceSha256,
    ecosVerifiedIndexCommittedPageCount: 1,
    ecosVerifiedIndexPageGraphSha256: 'b'.repeat(64),
    extractedPages: [],
  };
}

describe('ECOS Talk cloud document context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchECOSDocumentCloudIndex.mockResolvedValue([]);
  });

  it('requests metadata-only documents for exact same-name project B and excludes A', async () => {
    const documents = [
      metadataOnlyDrawing('drawing-a', 'project-a'),
      metadataOnlyDrawing('drawing-b', 'project-b'),
    ];
    const client = {} as never;

    await loadECOSTalkReferenceDocuments({
      client,
      documents,
      projectId: 'project-b',
      projectName: 'Shared Name',
      question: 'What is required?',
    });

    expect(mockSearchECOSDocumentCloudIndex).toHaveBeenCalledWith({
      client,
      question: 'What is required?',
      documentIds: ['drawing-b'],
      maximumResults: 24,
    });
  });
});
