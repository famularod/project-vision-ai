import type { SupabaseClient } from '@supabase/supabase-js';
import {
  activateECOSCurrentReferenceDocument,
  enqueueECOSHostedIndex,
  loadECOSHostedIndexStatuses,
} from '../../services/ECOSHostedIndexer';

describe('ECOS hosted indexer client boundary', () => {
  it('enqueues only a document identity and accepts a safe job reference', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: 'job-123', error: null });
    const client = { rpc } as unknown as SupabaseClient;

    await expect(enqueueECOSHostedIndex({ client, documentId: ' drawing-1 ' }))
      .resolves.toEqual({ status: 'queued', jobId: 'job-123', message: null });
    expect(rpc).toHaveBeenCalledWith('ecos_enqueue_hosted_index', {
      p_document_id: 'drawing-1',
    });
  });

  it('returns only customer-safe status values', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{
        document_id: 'drawing-1',
        project_id: 'project-1',
        state: 'extracting',
        customer_status: 'Preparing',
        completed_page_count: 4,
        source_page_count: 10,
        progress_percent: 40,
        customer_message: 'Vitruvius is preparing this document in the background.',
        limitation_count: 0,
        support_reference: 'ECOS-ABC123',
        committed_evidence_version: null,
        updated_at: '2026-08-08T12:00:00.000Z',
        ready_at: null,
        provider: 'must-not-be-returned',
        provider_error: 'must-not-be-returned',
      }, {
        document_id: 'drawing-2',
        project_id: 'project-1',
        state: 'ready',
        customer_status: 'Prepared',
        completed_page_count: 10,
        source_page_count: 10,
        progress_percent: 100,
        customer_message: 'Background preparation passed ECOS Assurance.',
        limitation_count: 0,
        support_reference: 'ECOS-DEF456',
        committed_evidence_version: 'ecos-hosted-evidence/1.3',
        updated_at: '2026-08-08T13:00:00.000Z',
        ready_at: '2026-08-08T13:00:00.000Z',
      }],
      error: null,
    });
    const client = { rpc } as unknown as SupabaseClient;

    const result = await loadECOSHostedIndexStatuses({
      client,
      documentIds: ['drawing-1', 'drawing-2'],
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(expect.objectContaining({
      documentId: 'drawing-1',
      customerStatus: 'Preparing',
      progressPercent: 40,
      supportReference: 'ECOS-ABC123',
      limitationCount: 0,
    }));
    expect(result[0]).not.toHaveProperty('provider');
    expect(result[0]).not.toHaveProperty('provider_error');
    expect(result[1]).toMatchObject({
      documentId: 'drawing-2',
      customerStatus: 'Prepared',
      progressPercent: 100,
    });
  });

  it('preserves customer-safe limited states and their accepted-page review count', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{
        document_id: 'drawing-current',
        project_id: 'project-1',
        state: 'ready',
        customer_status: 'Ready with limitations',
        completed_page_count: 8,
        source_page_count: 8,
        progress_percent: 100,
        customer_message: '2 accepted pages passed ECOS Assurance with review limitations.',
        limitation_count: 2,
        support_reference: 'ECOS-LIMITED',
        committed_evidence_version: 'ecos-hosted-evidence/1.3',
        updated_at: '2026-08-09T13:00:00.000Z',
        ready_at: '2026-08-09T13:00:00.000Z',
      }, {
        document_id: 'drawing-prior',
        project_id: 'project-1',
        state: 'ready',
        customer_status: 'Prepared with limitations',
        completed_page_count: 8,
        source_page_count: 8,
        progress_percent: 100,
        customer_message: '1 accepted page passed ECOS Assurance with review limitations.',
        limitation_count: 1,
        support_reference: 'ECOS-PRIOR',
        committed_evidence_version: 'ecos-hosted-evidence/1.3',
        updated_at: '2026-08-09T13:00:00.000Z',
        ready_at: '2026-08-09T13:00:00.000Z',
      }],
      error: null,
    });
    const client = { rpc } as unknown as SupabaseClient;

    await expect(loadECOSHostedIndexStatuses({ client })).resolves.toEqual([
      expect.objectContaining({
        documentId: 'drawing-current',
        customerStatus: 'Ready with limitations',
        limitationCount: 2,
        customerMessage: '2 accepted pages passed ECOS Assurance with review limitations.',
      }),
      expect.objectContaining({
        documentId: 'drawing-prior',
        customerStatus: 'Prepared with limitations',
        limitationCount: 1,
      }),
    ]);
    expect(rpc).toHaveBeenCalledWith('ecos_hosted_index_status_v2', {
      p_document_ids: null,
    });
  });

  it('falls back to v1 status without inventing limitations when v2 is unavailable', async () => {
    const rpc = jest.fn(async (name: string) => name === 'ecos_hosted_index_status_v2'
      ? { data: null, error: { code: 'PGRST202', message: 'function not found' } }
      : {
          data: [{
            document_id: 'drawing-legacy',
            project_id: 'project-1',
            state: 'ready',
            customer_status: 'Ready for ECOS',
            completed_page_count: 1,
            source_page_count: 1,
            progress_percent: 100,
            customer_message: 'This current revision is ready for ECOS.',
            support_reference: 'ECOS-LEGACY',
            committed_evidence_version: 'ecos-hosted-evidence/1.3',
            updated_at: '2026-08-09T13:00:00.000Z',
            ready_at: '2026-08-09T13:00:00.000Z',
          }],
          error: null,
        });
    const client = { rpc } as unknown as SupabaseClient;

    await expect(loadECOSHostedIndexStatuses({ client })).resolves.toEqual([
      expect.objectContaining({
        documentId: 'drawing-legacy',
        customerStatus: 'Ready for ECOS',
        limitationCount: 0,
      }),
    ]);
    expect(rpc.mock.calls.map(call => call[0])).toEqual([
      'ecos_hosted_index_status_v2',
      'ecos_hosted_index_status',
    ]);
  });

  it('never bypasses v2 project authorization by falling back after a permission error', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied for project status' },
    });
    const client = { rpc } as unknown as SupabaseClient;

    await expect(loadECOSHostedIndexStatuses({
      client,
      documentIds: ['drawing-outside-project'],
    })).rejects.toThrow('Vitruvius could not start background document preparation. Try again shortly.');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('ecos_hosted_index_status_v2', {
      p_document_ids: ['drawing-outside-project'],
    });
  });

  it('accepts an empty authorized v2 result without consulting the broader legacy boundary', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
    const client = { rpc } as unknown as SupabaseClient;

    await expect(loadECOSHostedIndexStatuses({
      client,
      documentIds: ['drawing-not-visible-to-this-project-member'],
    })).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('ecos_hosted_index_status_v2', {
      p_document_ids: ['drawing-not-visible-to-this-project-member'],
    });
  });

  it('keeps pre-migration clients compatible', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'function not found' },
      }),
    } as unknown as SupabaseClient;

    await expect(loadECOSHostedIndexStatuses({ client })).resolves.toEqual([]);
    await expect(enqueueECOSHostedIndex({ client, documentId: 'drawing-1' }))
      .resolves.toMatchObject({ status: 'unavailable' });
  });

  it('does not expose backend error details to customers', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'XX000', message: 'Gemini quota secret provider account 123 failed' },
      }),
    } as unknown as SupabaseClient;

    const result = await enqueueECOSHostedIndex({ client, documentId: 'drawing-1' });

    expect(result.status).toBe('failed');
    expect(result.message).toBe('Vitruvius could not start background document preparation. Try again shortly.');
    expect(result.message).not.toMatch(/Gemini|quota|provider|123/i);
  });

  it('activates one exact current revision through the atomic RPC', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        document_id: 'drawing-2',
        updated_at: '2026-08-09T07:30:00.000Z',
        changed_count: 2,
      },
      error: null,
    });
    const client = { rpc } as unknown as SupabaseClient;

    await expect(activateECOSCurrentReferenceDocument({
      client,
      documentId: ' drawing-2 ',
      expectedUpdatedAt: ' 2026-08-09T07:00:00.000Z ',
    })).resolves.toEqual({
      status: 'activated',
      documentId: 'drawing-2',
      updatedAt: '2026-08-09T07:30:00.000Z',
      changedCount: 2,
      message: null,
    });
    expect(rpc).toHaveBeenCalledWith('ecos_activate_current_reference_document', {
      p_document_id: 'drawing-2',
      p_expected_updated_at: '2026-08-09T07:00:00.000Z',
    });
  });

  it('does not expose provider details when current activation fails closed', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: {
          code: 'P0001',
          message: 'ecos_target_not_prepared: Gemini response invalid and API key secret leaked',
        },
      }),
    } as unknown as SupabaseClient;

    const result = await activateECOSCurrentReferenceDocument({
      client,
      documentId: 'drawing-2',
      expectedUpdatedAt: '2026-08-09T07:00:00.000Z',
    });

    expect(result.status).toBe('not_prepared');
    expect(result.message).toMatch(/finish background preparation/i);
    expect(result.message).not.toMatch(/Gemini|API key|secret|leaked/i);
  });
});
