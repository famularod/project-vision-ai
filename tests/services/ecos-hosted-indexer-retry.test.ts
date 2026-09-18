import { retryECOSHostedPreparation } from '../../services/ECOSHostedIndexerRetry';

function client(result: { data?: unknown; error?: { code?: string; message?: string } | null }) {
  return { rpc: jest.fn(async () => ({ data: result.data ?? null, error: result.error ?? null })) } as any;
}

describe('retryECOSHostedPreparation', () => {
  it('reports a requested retry', async () => {
    const c = client({ data: true });
    const result = await retryECOSHostedPreparation({ client: c, documentId: ' doc-1 ' });
    expect(result.outcome).toBe('requested');
    expect(c.rpc).toHaveBeenCalledWith('ecos_retry_hosted_index_job_for_document', { p_document_id: 'doc-1' });
  });

  it('distinguishes not-needed, missing function and failure', async () => {
    expect((await retryECOSHostedPreparation({ client: client({ data: false }), documentId: 'd' })).outcome).toBe('not_needed');
    expect((await retryECOSHostedPreparation({ client: client({ error: { code: 'PGRST202', message: 'Could not find the function' } }), documentId: 'd' })).outcome).toBe('unavailable');
    expect((await retryECOSHostedPreparation({ client: client({ error: { code: '42501', message: 'denied' } }), documentId: 'd' })).outcome).toBe('failed');
    expect((await retryECOSHostedPreparation({ client: null, documentId: 'd' })).outcome).toBe('unavailable');
  });
});
