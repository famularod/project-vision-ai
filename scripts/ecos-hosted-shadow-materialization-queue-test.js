const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = read('supabase/migrations/20260808101000_ecos_hosted_shadow_materialization_queue.sql');
const worker = read('workers/ecos-indexer/ecos_indexer/worker.py');

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const between = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex >= 0 && endIndex > startIndex, `Could not isolate ${start}`);
  return source.slice(startIndex, endIndex);
};

const triggerBody = between(
  migration,
  'create or replace function public.ecos_sync_hosted_shadow_page_chunks()',
  'create or replace function public.ecos_materialize_next_hosted_shadow_page(',
);
const materializerBody = between(
  migration,
  'create or replace function public.ecos_materialize_next_hosted_shadow_page(',
  'create or replace function public.ecos_require_complete_shadow_materialization()',
);
const readyGuardBody = between(
  migration,
  'create or replace function public.ecos_require_complete_shadow_materialization()',
  'drop trigger if exists ecos_hosted_shadow_ready_materialization_guard',
);

expect(
  migration.includes('public.ecos_hosted_shadow_materialization_queue'),
  'A durable materialization queue is required',
);
expect(
  migration.includes('force row level security') &&
    migration.includes('to service_role'),
  'The queue and RPC must remain service-only',
);
expect(
  triggerBody.includes("selected_mode is distinct from 'shadow'") &&
    triggerBody.includes('insert into public.ecos_hosted_shadow_materialization_queue'),
  'The checkpoint trigger must enqueue shadow jobs only',
);
for (const forbidden of [
  'ecos_refresh_hosted_shadow_page(',
  'ecos_append_hosted_shadow_region_text(',
  'jsonb_array_elements(',
  'ecos_hosted_shadow_chunks chunk',
]) {
  expect(!triggerBody.includes(forbidden), `Checkpoint trigger still performs expensive work: ${forbidden}`);
}
expect(
  materializerBody.includes("auth.role() <> 'service_role'") &&
    materializerBody.includes("job.mode = 'shadow'") &&
    materializerBody.includes('for update skip locked'),
  'The one-page materializer must validate the shadow worker lease',
);
expect(
  materializerBody.includes('public.ecos_refresh_hosted_shadow_page(') &&
    materializerBody.includes('public.ecos_append_hosted_shadow_region_text('),
  'Page and assured-region search evidence must both be materialized',
);
expect(
  materializerBody.indexOf('delete from public.ecos_hosted_shadow_materialization_queue') >
    materializerBody.indexOf('public.ecos_append_hosted_shadow_region_text('),
  'The durable queue item may be deleted only after all shadow evidence is materialized',
);
expect(
  readyGuardBody.includes("new.mode = 'shadow'") &&
    readyGuardBody.includes("new.state = 'ready'") &&
    readyGuardBody.includes('Shadow search materialization is incomplete'),
  'Shadow jobs must fail closed while materialization remains queued',
);
for (const forbidden of [
  'ecos_hosted_document_pages',
  'ecos_hosted_document_chunks',
  "mode = 'live'",
  'create or replace function public.ecos_commit_hosted_index_job',
  'delete from public.ecos_hosted_index_pages',
  'update public.ecos_hosted_index_pages',
]) {
  expect(!migration.includes(forbidden), `Migration crosses the protected boundary: ${forbidden}`);
}

const drainMethod = worker.indexOf('def drain_shadow_materializations(');
const processMethod = worker.indexOf('def process(');
const download = worker.indexOf('source = self.gateway.download_source(job)', processMethod);
const initialDrain = worker.indexOf('self.drain_shadow_materializations(job)', processMethod);
const checkpoint = worker.indexOf('"ecos_checkpoint_hosted_index_page"', processMethod);
const postCheckpointDrain = worker.indexOf(
  'self.drain_shadow_materializations(job, max_pages=1)',
  checkpoint,
);
const commit = worker.indexOf('"ecos_commit_hosted_index_job"', checkpoint);
const shadowCommit = worker.indexOf('"ecos_commit_hosted_shadow_preparation_job"', checkpoint);

expect(drainMethod >= 0, 'Worker must provide a bounded shadow queue drain');
expect(initialDrain > processMethod && initialDrain < download, 'A crash-surviving queue must drain before source reprocessing');
expect(postCheckpointDrain > checkpoint && postCheckpointDrain < commit, 'Each checkpoint must materialize in a separate RPC before commit');
expect(
  shadowCommit > checkpoint && shadowCommit < commit,
  'Shadow preparation must commit through its non-publishing verified boundary',
);
expect(
  worker.includes('"ecos_materialize_next_hosted_shadow_page"') &&
    worker.includes('if job.mode != "shadow":'),
  'Worker materialization must remain shadow-only',
);

console.log('ECOS hosted shadow materialization queue contract: PASS');
