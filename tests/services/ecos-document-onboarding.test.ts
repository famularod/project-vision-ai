import type { ReferenceDocument } from '../../types';
import {
  buildECOSDocumentOnboardingSummary,
  ECOS_CUSTOMER_DOCUMENT_STATUSES,
  resolveECOSCustomerDocumentStatus,
} from '../../services/ECOSDocumentOnboarding';

function document(overrides: Partial<ReferenceDocument> = {}): ReferenceDocument {
  return {
    id: 'document-1',
    name: 'Project Drawing',
    originalFileName: 'project-drawing.pdf',
    uri: 'file:///project-drawing.pdf',
    category: 'Drawing',
    notes: '',
    isCurrent: true,
    importedAt: '2026-08-08T12:00:00.000Z',
    projectName: 'Project A',
    drawingNumber: 'A1.01',
    drawingRevision: '1',
    drawingStatus: 'For Construction',
    extractionStatus: 'pending',
    ...overrides,
  };
}

describe('ECOS document onboarding', () => {
  it('uses exactly the approved customer status vocabulary', () => {
    expect(ECOS_CUSTOMER_DOCUMENT_STATUSES).toEqual([
      'Waiting',
      'Preparing',
      'Prepared',
      'Prepared with limitations',
      'Ready for ECOS',
      'Ready with limitations',
      'Needs Review',
      'Reconnect Files',
      'Temporarily Unavailable',
    ]);
  });

  it('keeps a hosted customer-safe status authoritative', () => {
    ECOS_CUSTOMER_DOCUMENT_STATUSES.forEach(status => {
      expect(resolveECOSCustomerDocumentStatus(document({ ecosHostedIndexStatus: status })))
        .toBe(status);
    });
  });

  it('falls back to review-by-exception when metadata needs attention', () => {
    expect(resolveECOSCustomerDocumentStatus(document({
      drawingNumber: null,
      ecosHostedIndexStatus: null,
    }))).toBe('Needs Review');
  });

  it('fails closed instead of calling a non-current source ready', () => {
    expect(resolveECOSCustomerDocumentStatus(document({
      category: 'Contract',
      isCurrent: false,
      ecosHostedIndexStatus: null,
      extractionStatus: 'complete',
      sourcePageCount: 1,
      searchablePageCount: 1,
      indexedAt: '2026-08-08T13:00:00.000Z',
    }))).toBe('Needs Review');
  });

  it('summarizes background work without provider or credit diagnostics', () => {
    const statuses = ECOS_CUSTOMER_DOCUMENT_STATUSES.map((status, index) => document({
      id: `document-${index}`,
      ecosHostedIndexStatus: status,
      ecosHostedIndexSupportReference: status === 'Temporarily Unavailable'
        ? 'Gemini quota API-credit-provider-secret'
        : null,
    }));

    const summary = buildECOSDocumentOnboardingSummary(statuses);
    const copy = JSON.stringify(summary);

    expect(summary.total).toBe(9);
    expect(summary.statusCounts.map(item => item.status)).toEqual(ECOS_CUSTOMER_DOCUMENT_STATUSES);
    expect(summary.reviewCount).toBe(3);
    expect(summary.reconnectCount).toBe(1);
    expect(summary.preparedCount).toBe(2);
    expect(summary.headline).toBe('A few document details need your review');
    expect(copy).not.toMatch(/Gemini|OpenAI|Google Cloud|Supabase|API|quota|credit|provider|secret/i);
  });

  it('counts accepted-page limitations as visible review-by-exception work', () => {
    const summary = buildECOSDocumentOnboardingSummary([
      document({
        id: 'limited-current',
        ecosHostedIndexStatus: 'Ready with limitations',
        ecosHostedIndexLimitationCount: 2,
      }),
      document({
        id: 'limited-prior',
        isCurrent: false,
        ecosHostedIndexStatus: 'Prepared with limitations',
        ecosHostedIndexLimitationCount: 1,
      }),
    ]);

    expect(summary.readyCount).toBe(1);
    expect(summary.preparedCount).toBe(1);
    expect(summary.reviewCount).toBe(2);
    expect(summary.limitationCount).toBe(3);
    expect(summary.statusCounts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'Prepared with limitations',
        count: 1,
        limitationCount: 1,
      }),
      expect.objectContaining({
        status: 'Ready with limitations',
        count: 1,
        limitationCount: 2,
      }),
    ]));
    expect(summary.headline).toContain('need your review');
  });

  it('tells the customer they may leave while preparation continues', () => {
    const summary = buildECOSDocumentOnboardingSummary([
      document({ ecosHostedIndexStatus: 'Preparing' }),
    ]);

    expect(summary.headline).toContain('preparing');
    expect(summary.detail).toContain('leave this page');
    expect(summary.detail).toContain('background');
  });

  it('explains that prepared non-current evidence must be activated', () => {
    const summary = buildECOSDocumentOnboardingSummary([
      document({ isCurrent: false, ecosHostedIndexStatus: 'Prepared' }),
    ]);

    expect(summary.headline).toContain('awaiting activation');
    expect(summary.detail).toContain('current');
    expect(summary.detail).toContain('Ask ECOS');
  });
});
