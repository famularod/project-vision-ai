import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceDocumentExtractedPage } from '../types';
import { withNormalizedECOSSheetProvenance } from './ECOSSheetProvenance';

export type ECOSDocumentIndexJob = Readonly<{
  id: string;
  documentId: string;
  sourceSha256: string;
  sourcePageCount: number;
  completedPages: readonly ReferenceDocumentExtractedPage[];
}>;

export async function beginOrResumeECOSDocumentIndexJob({
  client,
  ownerId,
  documentId,
  sourceSha256,
  sourcePageCount,
}: {
  client: SupabaseClient;
  ownerId: string;
  documentId: string;
  sourceSha256: string;
  sourcePageCount: number;
}): Promise<ECOSDocumentIndexJob> {
  const canonicalSha = canonicalSha256(sourceSha256);
  if (!canonicalSha) throw new Error('A verified source fingerprint is required to resume indexing.');
  const { data: existing, error: selectError } = await client
    .from('ecos_document_index_jobs')
    .select('id,document_id,source_sha256,source_page_count,status')
    .eq('owner_id', ownerId)
    .eq('document_id', documentId)
    .eq('source_sha256', canonicalSha)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message || 'The ECOS index checkpoint could not be loaded.');

  let row = existing;
  if (!row) {
    const inserted = await client
      .from('ecos_document_index_jobs')
      .insert({
        owner_id: ownerId,
        document_id: documentId,
        source_sha256: canonicalSha,
        source_page_count: Math.max(1, Math.floor(sourcePageCount)),
        status: 'running',
      })
      .select('id,document_id,source_sha256,source_page_count,status')
      .single();
    if (inserted.error || !inserted.data) {
      throw new Error(inserted.error?.message || 'The ECOS index checkpoint could not be started.');
    }
    row = inserted.data;
  } else if (row.status !== 'running') {
    const resumed = await client
      .from('ecos_document_index_jobs')
      .update({ status: 'running', failure_message: null, updated_at: new Date().toISOString() })
      .eq('owner_id', ownerId)
      .eq('id', row.id)
      .select('id,document_id,source_sha256,source_page_count,status')
      .single();
    if (resumed.error || !resumed.data) throw new Error(resumed.error?.message || 'The ECOS index checkpoint could not resume.');
    row = resumed.data;
  }

  const pages = await loadECOSDocumentIndexJobPages({ client, ownerId, jobId: String(row.id) });
  return Object.freeze({
    id: String(row.id),
    documentId: String(row.document_id),
    sourceSha256: String(row.source_sha256),
    sourcePageCount: Number(row.source_page_count),
    completedPages: Object.freeze(pages),
  });
}

export async function checkpointECOSDocumentIndexPage({
  client,
  ownerId,
  jobId,
  page,
}: {
  client: SupabaseClient;
  ownerId: string;
  jobId: string;
  page: ReferenceDocumentExtractedPage;
}) {
  const { error } = await client.from('ecos_document_index_job_pages').upsert({
    owner_id: ownerId,
    job_id: jobId,
    page_number: page.pageNumber,
    page_data: page,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'owner_id,job_id,page_number' });
  if (error) throw new Error(error.message || `ECOS could not checkpoint page ${page.pageNumber}.`);
  // Recompute after every checkpoint. A retry can replace a previously
  // complete page with an incomplete payload; keeping the old count made a
  // job say 100% while every committed page had lost its visual coverage.
  const count = await client
    .from('ecos_document_index_job_pages')
    .select('page_number', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .eq('job_id', jobId)
    .contains('page_data', { visualCoverage: { coverageComplete: true } });
  if (count.error) throw new Error(count.error.message || 'ECOS could not verify the index checkpoint.');
  const updated = await client.from('ecos_document_index_jobs').update({
    completed_page_count: count.count || 0,
    updated_at: new Date().toISOString(),
  }).eq('owner_id', ownerId).eq('id', jobId);
  if (updated.error) throw new Error(updated.error.message || 'ECOS could not update index progress.');
}

export async function setECOSDocumentIndexJobStatus({
  client,
  ownerId,
  jobId,
  status,
  failureMessage = null,
}: {
  client: SupabaseClient;
  ownerId: string;
  jobId: string;
  status: 'running' | 'ready' | 'committed' | 'failed' | 'cancelled';
  failureMessage?: string | null;
}) {
  const { error } = await client.from('ecos_document_index_jobs').update({
    status,
    failure_message: failureMessage?.slice(0, 2_000) || null,
    updated_at: new Date().toISOString(),
  }).eq('owner_id', ownerId).eq('id', jobId);
  if (error) throw new Error(error.message || 'ECOS could not update the index job.');
}

export async function commitECOSDocumentIndexJob({
  client,
  jobId,
  extractionMethod,
}: {
  client: SupabaseClient;
  jobId: string;
  extractionMethod?: string | null;
}) {
  const { data, error } = await client.rpc('ecos_commit_verified_index_job', {
    p_job_id: jobId,
    p_extraction_method: extractionMethod?.trim() || null,
  });
  if (error) {
    throw new Error(error.message || 'ECOS could not commit the verified document index.');
  }
  const row = Array.isArray(data) ? data[0] : data;
  const indexedPages = Number(row?.indexed_pages);
  const indexedChunks = Number(row?.indexed_chunks);
  if (!Number.isInteger(indexedPages) || indexedPages < 1 ||
      !Number.isInteger(indexedChunks) || indexedChunks < 1) {
    throw new Error('ECOS could not verify the committed document index.');
  }
  return Object.freeze({ indexedPages, indexedChunks });
}

async function loadECOSDocumentIndexJobPages({
  client,
  ownerId,
  jobId,
}: {
  client: SupabaseClient;
  ownerId: string;
  jobId: string;
}) {
  const { data, error } = await client
    .from('ecos_document_index_job_pages')
    .select('page_number,page_data')
    .eq('owner_id', ownerId)
    .eq('job_id', jobId)
    .order('page_number', { ascending: true })
    .limit(10_000);
  if (error) throw new Error(error.message || 'The ECOS index pages could not be resumed.');
  return (data || []).flatMap(row => {
    const page = normalizePage(row.page_data);
    return page && page.pageNumber === Number(row.page_number) ? [page] : [];
  });
}

function normalizePage(value: unknown): ReferenceDocumentExtractedPage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const page = value as ReferenceDocumentExtractedPage;
  return Number.isInteger(page.pageNumber) && page.pageNumber > 0
    ? withNormalizedECOSSheetProvenance(page, { requireAssurance: false })
    : null;
}

function canonicalSha256(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}
