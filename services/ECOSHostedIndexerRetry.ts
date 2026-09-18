import type { SupabaseClient } from '@supabase/supabase-js';

export type ECOSHostedRetryOutcome =
  | 'requested'
  | 'not_needed'
  | 'unavailable'
  | 'failed';

/**
 * Asks the database for one more preparation attempt on a document whose
 * hosted indexing stopped. The SQL function checks organization membership
 * and refuses more than one retry per ten minutes per document.
 */
export async function retryECOSHostedPreparation({
  client,
  documentId,
}: {
  client: SupabaseClient | null;
  documentId: string;
}): Promise<{ outcome: ECOSHostedRetryOutcome; message: string }> {
  const id = documentId.trim();
  if (!client || !id) {
    return { outcome: 'unavailable', message: 'Sign in and connect to retry preparation.' };
  }
  const { data, error } = await client.rpc('ecos_retry_hosted_index_job_for_document', {
    p_document_id: id,
  });
  if (error) {
    const text = String(error.message || '').toLowerCase();
    if (error.code === '42883' || error.code === 'PGRST202' || text.includes('could not find the function')) {
      return { outcome: 'unavailable', message: 'Retry is not available yet on this workspace.' };
    }
    return { outcome: 'failed', message: 'Vitruvius could not request a retry. Try again shortly.' };
  }
  return data === true
    ? { outcome: 'requested', message: 'Retry requested. The status updates within a few minutes.' }
    : { outcome: 'not_needed', message: 'A retry is already in progress or was requested recently.' };
}
