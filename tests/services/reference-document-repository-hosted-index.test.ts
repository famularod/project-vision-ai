jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));
jest.mock('../../services/SupabaseService', () => ({ uploadPhoto: jest.fn() }));

import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';

describe('reference document hosted-index normalization', () => {
  it('preserves customer-safe hosted progress and limitation fields across a serialized refresh round trip', () => {
    const persisted = JSON.parse(JSON.stringify({
      id: 'drawing-2321-e25',
      name: 'Electrical E-2.5',
      originalFileName: '2321-electrical.pdf',
      uri: '',
      category: 'Drawing',
      notes: '',
      isCurrent: true,
      importedAt: '2026-08-09T07:00:00.000Z',
      ecosHostedIndexStatus: 'Ready with limitations',
      ecosHostedIndexProgressPercent: 42.5,
      ecosHostedIndexCustomerMessage: '2 accepted pages passed ECOS Assurance with review limitations.',
      ecosHostedIndexLimitationCount: 2,
      ecosHostedIndexSupportReference: 'ECOS-2321-ABCD1234',
      ecosHostedIndexEvidenceVersion: 'ecos-hosted-evidence/1.3',
      ecosHostedIndexUpdatedAt: '2026-08-09T07:01:00.000Z',
    }));
    const normalized = normalizeReferenceDocument(persisted);

    expect(normalized).toMatchObject({
      ecosHostedIndexStatus: 'Ready with limitations',
      ecosHostedIndexProgressPercent: 42.5,
      ecosHostedIndexCustomerMessage: '2 accepted pages passed ECOS Assurance with review limitations.',
      ecosHostedIndexLimitationCount: 2,
      ecosHostedIndexSupportReference: 'ECOS-2321-ABCD1234',
      ecosHostedIndexEvidenceVersion: 'ecos-hosted-evidence/1.3',
      ecosHostedIndexUpdatedAt: '2026-08-09T07:01:00.000Z',
    });
  });

  it('fails closed for invalid hosted status and progress values', () => {
    const normalized = normalizeReferenceDocument({
      id: 'drawing-2321-invalid',
      name: 'Invalid hosted state',
      originalFileName: 'invalid.pdf',
      uri: '',
      category: 'Drawing',
      notes: '',
      isCurrent: true,
      importedAt: '2026-08-09T07:00:00.000Z',
      ecosHostedIndexStatus: 'Complete' as never,
      ecosHostedIndexProgressPercent: 101,
      ecosHostedIndexCustomerMessage: '   ',
      ecosHostedIndexLimitationCount: -1,
      ecosHostedIndexSupportReference: '   ',
      ecosHostedIndexEvidenceVersion: '   ',
      ecosHostedIndexUpdatedAt: '   ',
    });

    expect(normalized).toMatchObject({
      ecosHostedIndexStatus: null,
      ecosHostedIndexProgressPercent: null,
      ecosHostedIndexCustomerMessage: null,
      ecosHostedIndexLimitationCount: null,
      ecosHostedIndexSupportReference: null,
      ecosHostedIndexEvidenceVersion: null,
      ecosHostedIndexUpdatedAt: null,
    });
  });
});
