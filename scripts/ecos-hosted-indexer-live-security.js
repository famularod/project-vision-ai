const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const required = name => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const id = prefix => `${prefix}-${crypto.randomBytes(8).toString('hex')}`;

async function main() {
  const url = required('SUPABASE_URL');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = required('SUPABASE_ANON_KEY');
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const password = `${crypto.randomBytes(24).toString('base64url')}A1!`;
  const runId = crypto.randomBytes(8).toString('hex');
  const organizationA = id('ecos-security-a');
  const organizationB = id('ecos-security-b');
  const projectA = id('project-a');
  const projectB = id('project-b');
  const documentA = id('document-a');
  const documentB = id('document-b');
  let userA;
  let userB;

  try {
    const createdA = await service.auth.admin.createUser({
      email: `ecos-security-a-${runId}@example.invalid`, password, email_confirm: true,
    });
    const createdB = await service.auth.admin.createUser({
      email: `ecos-security-b-${runId}@example.invalid`, password, email_confirm: true,
    });
    if (createdA.error || !createdA.data.user) throw createdA.error || new Error('Could not create tenant A user');
    if (createdB.error || !createdB.data.user) throw createdB.error || new Error('Could not create tenant B user');
    userA = createdA.data.user;
    userB = createdB.data.user;

    const organizationInsert = await service.from('organizations').insert([
      { id: organizationA, name: 'ECOS security tenant A' },
      { id: organizationB, name: 'ECOS security tenant B' },
    ]);
    if (organizationInsert.error) throw organizationInsert.error;
    const membershipInsert = await service.from('organization_memberships').insert([
      { user_id: userA.id, organization_id: organizationA, status: 'active', role: 'organization_admin' },
      { user_id: userB.id, organization_id: organizationB, status: 'active', role: 'organization_admin' },
    ]);
    if (membershipInsert.error) throw membershipInsert.error;
    const configInsert = await service.from('ecos_hosted_index_configuration').insert([
      { organization_id: organizationA, publication_mode: 'shadow' },
      { organization_id: organizationB, publication_mode: 'shadow' },
    ]);
    if (configInsert.error) throw configInsert.error;

    const jobInsert = await service.from('ecos_hosted_index_jobs').insert([
      {
        organization_id: organizationA, project_id: projectA, document_id: documentA,
        source_owner_id: userA.id, source_provider: 'managed_upload', source_locator: {},
        source_sha256: 'a'.repeat(64), mode: 'shadow', state: 'queued',
        requested_by: userA.id,
      },
      {
        organization_id: organizationB, project_id: projectB, document_id: documentB,
        source_owner_id: userB.id, source_provider: 'managed_upload', source_locator: {},
        source_sha256: 'b'.repeat(64), mode: 'shadow', state: 'queued',
        requested_by: userB.id,
      },
    ]).select('id,organization_id');
    if (jobInsert.error) throw jobInsert.error;
    const jobA = jobInsert.data.find(job => job.organization_id === organizationA);
    const jobB = jobInsert.data.find(job => job.organization_id === organizationB);

    const chunkInsert = await service.from('ecos_hosted_document_chunks').insert([
      {
        organization_id: organizationA, project_id: projectA, document_id: documentA,
        page_number: 1, region_id: 'a', chunk_index: 0,
        chunk_text: `tenant isolation alpha ${runId}`, sheet_number: 'A1',
        metadata: { assurance: { accepted: true } },
      },
      {
        organization_id: organizationB, project_id: projectB, document_id: documentB,
        page_number: 1, region_id: 'b', chunk_index: 0,
        chunk_text: `tenant isolation beta ${runId}`, sheet_number: 'B1',
        metadata: { assurance: { accepted: true } },
      },
    ]);
    if (chunkInsert.error) throw chunkInsert.error;

    const clientA = createClient(url, anonKey, { auth: { persistSession: false } });
    const clientB = createClient(url, anonKey, { auth: { persistSession: false } });
    const signInA = await clientA.auth.signInWithPassword({ email: userA.email, password });
    const signInB = await clientB.auth.signInWithPassword({ email: userB.email, password });
    if (signInA.error) throw signInA.error;
    if (signInB.error) throw signInB.error;

    const statusA = await clientA.rpc('ecos_hosted_index_status');
    const statusB = await clientB.rpc('ecos_hosted_index_status');
    if (statusA.error) throw statusA.error;
    if (statusB.error) throw statusB.error;
    expect(statusA.data.some(row => row.document_id === documentA), 'Tenant A could not read its own safe status');
    expect(!statusA.data.some(row => row.document_id === documentB), 'Tenant A read tenant B status');
    expect(statusB.data.some(row => row.document_id === documentB), 'Tenant B could not read its own safe status');
    expect(!statusB.data.some(row => row.document_id === documentA), 'Tenant B read tenant A status');

    const searchA = await clientA.rpc('ecos_search_hosted_document_chunks', {
      p_search_query: `tenant isolation ${runId}`, p_result_limit: 20,
    });
    const searchB = await clientB.rpc('ecos_search_hosted_document_chunks', {
      p_search_query: `tenant isolation ${runId}`, p_result_limit: 20,
    });
    if (searchA.error) throw searchA.error;
    if (searchB.error) throw searchB.error;
    expect(searchA.data.some(row => row.document_id === documentA), 'Tenant A could not search its own evidence');
    expect(!searchA.data.some(row => row.document_id === documentB), 'Tenant A searched tenant B evidence');
    expect(searchB.data.some(row => row.document_id === documentB), 'Tenant B could not search its own evidence');
    expect(!searchB.data.some(row => row.document_id === documentA), 'Tenant B searched tenant A evidence');

    const crossCancel = await clientA.rpc('ecos_cancel_hosted_index', { p_job_id: jobB.id });
    if (crossCancel.error) throw crossCancel.error;
    expect(crossCancel.data === false, 'Tenant A cancelled tenant B work');
    const ownCancel = await clientA.rpc('ecos_cancel_hosted_index', { p_job_id: jobA.id });
    if (ownCancel.error) throw ownCancel.error;
    expect(ownCancel.data === true, 'Tenant A could not cancel its own queued work');

    const protectedJobs = await clientA.from('ecos_hosted_index_jobs').select('*').limit(1);
    expect(Boolean(protectedJobs.error), 'Authenticated client read protected job diagnostics');
    const protectedUsage = await clientA.from('ecos_hosted_index_usage').select('*').limit(1);
    expect(Boolean(protectedUsage.error), 'Authenticated client read protected cost telemetry');
    const workerClaim = await clientA.rpc('ecos_claim_hosted_index_job', {
      p_worker_id: 'unauthorized-client', p_lease_seconds: 300,
    });
    expect(Boolean(workerClaim.error), 'Authenticated customer invoked protected worker claim');

    console.log('ECOS hosted indexer live tenant isolation: PASS');
  } finally {
    await service.from('organizations').delete().in('id', [organizationA, organizationB]);
    if (userA) await service.auth.admin.deleteUser(userA.id);
    if (userB) await service.auth.admin.deleteUser(userB.id);
  }
}

main().catch(error => {
  console.error(`ECOS hosted indexer live tenant isolation: FAIL - ${error.message}`);
  process.exit(1);
});
