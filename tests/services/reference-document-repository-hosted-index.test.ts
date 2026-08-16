jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));
jest.mock('../../services/SupabaseService', () => ({ uploadPhoto: jest.fn() }));

import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import {
  computeECOSPageGraphSha256,
  hasAuthoritativeECOSPageGraph,
} from '../../services/ECOSHostedPageGraphAuthority';

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

  it('preserves an exact server receipt across normalization and detects later mutation', () => {
    const sourceSha256 = 'a'.repeat(64);
    const persisted = {
      id: 'drawing-2321-authoritative',
      name: 'Authoritative drawing',
      originalFileName: 'authoritative.pdf',
      uri: '',
      category: 'Drawing',
      notes: '',
      isCurrent: true,
      importedAt: '2026-08-09T07:00:00.000Z',
      projectId: 'project-2321',
      contentSha256: sourceSha256,
      indexedContentSha256: sourceSha256,
      ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0' as const,
      ecosVerifiedIndexCommittedSha256: sourceSha256,
      ecosVerifiedIndexCommittedPageCount: 1,
      extractedPages: [{
        pageNumber: 1,
        sheetNumber: 'A101',
        sheetMappingStatus: 'verified' as const,
        sheetMappingSource: 'pdf_bookmark' as const,
        sheetMappingEvidence: [{
          id: 'bookmark-a101',
          pageNumber: 1,
          source: 'pdf_bookmark' as const,
          text: 'A03-A101',
          normalizedBounds: null,
          renderedCorroborated: true as const,
          renderedCorroboratingRegionIds: ['sheet-identity-a101'],
          renderedCorroboratingSources: ['sheet_identity_ocr_page_bound_validated'],
        }],
        documentStructuralIdentity: {
          sheetNumber: 'A101',
          source: 'pdf_bookmark' as const,
          evidence: [{
            id: 'bookmark-a101',
            pageNumber: 1,
            source: 'pdf_bookmark' as const,
            text: 'A03-A101',
            normalizedBounds: null,
            renderedCorroborated: true as const,
            renderedCorroboratingRegionIds: ['sheet-identity-a101'],
            renderedCorroboratingSources: ['sheet_identity_ocr_page_bound_validated'],
          }],
        },
        text: 'Guardrail required.',
        assurance: {
          accepted: true,
          evidenceVersion: 'ecos-hosted-evidence/1.3',
          checks: { sheetMappingUsable: true },
          failureCodes: [],
        },
        regions: [{
          id: 'region-1',
          text: 'Guardrail required.',
          x: 0.1,
          y: 0.2,
          width: 0.4,
          height: 0.05,
          source: 'ocr' as const,
        }, {
          id: 'sheet-identity-a101',
          text: 'A101',
          searchable: true,
          x: 0.82,
          y: 0.9,
          width: 0.12,
          height: 0.04,
          source: 'ocr' as const,
          rawSource: 'sheet_identity_ocr_page_bound_validated',
        }],
      }],
      ecosVerifiedIndexPageGraphSha256: null as string | null,
    };
    persisted.ecosVerifiedIndexPageGraphSha256 = computeECOSPageGraphSha256(
      persisted.extractedPages,
    );

    const normalized = normalizeReferenceDocument(persisted);
    expect(computeECOSPageGraphSha256(normalized.extractedPages)).not.toBe(
      persisted.ecosVerifiedIndexPageGraphSha256,
    );
    expect(hasAuthoritativeECOSPageGraph(normalized)).toBe(true);
    expect(normalized.extractedPages?.[0]).toMatchObject({
      sheetNumber: 'A101',
      sheetMappingStatus: 'verified',
      sheetMappingSource: 'pdf_bookmark',
    });

    normalized.extractedPages![0].regions![0].text = 'Forged after hydration.';
    expect(hasAuthoritativeECOSPageGraph(normalized)).toBe(false);
  });
});
