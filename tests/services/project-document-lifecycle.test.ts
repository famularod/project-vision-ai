/**
 * Audit P1-23: stale 'uploading' documents recover to retryable 'failed'
 * at startup; all other statuses pass through untouched.
 */

import { recoverStaleUploadingDocuments } from '../../services/ProjectDocumentLifecycle';

const NOW = '2026-07-18T12:00:00.000Z';

describe('recoverStaleUploadingDocuments (audit P1-23)', () => {
  it('converts stale uploading documents to retryable failed', () => {
    const documents = [
      { id: 'a', status: 'uploading' as const, updatedAt: '2026-07-17T00:00:00Z' },
      { id: 'b', status: 'uploaded' as const, updatedAt: '2026-07-17T00:00:00Z' },
    ];

    const recovered = recoverStaleUploadingDocuments(documents, NOW);

    expect(recovered[0].status).toBe('failed');
    expect(recovered[0].updatedAt).toBe(NOW);
    expect(recovered[1]).toEqual(documents[1]);
  });

  it('leaves local, uploaded, and failed documents untouched', () => {
    const documents = [
      { id: 'a', status: 'local' as const, updatedAt: 't' },
      { id: 'b', status: 'failed' as const, updatedAt: 't' },
      { id: 'c', status: 'uploaded' as const, updatedAt: 't' },
    ];

    expect(recoverStaleUploadingDocuments(documents, NOW)).toEqual(documents);
  });
});
