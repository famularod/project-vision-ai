const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const MUTATION_GATE = 'isolated-fixture-only';
const EVIDENCE_VERSION = 'ecos-hosted-evidence/1.3';
const SCHEMA_VERSION = 'ecos-drawing-page-analysis/2.0';

const help = `
ECOS hosted evidence 1.3 live post-migration validation

This script creates one isolated organization, user, shadow job, exception,
page, queue row, and shadow chunk. It removes them in a finally block.

Required environment:
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  ECOS_V13_VALIDATION_EXPECTED_URL=<exact SUPABASE_URL>
  ECOS_V13_VALIDATION_ALLOW_MUTATION=${MUTATION_GATE}

Run only against the explicitly approved live/staging project after all six
evidence 1.3 migrations have been applied. This script does not apply or deploy
migrations and does not reset or reindex real documents.
`.trim();

const required = name => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const clone = value => JSON.parse(JSON.stringify(value));
const iso = milliseconds => new Date(Date.now() + milliseconds).toISOString();

async function noError(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function expectRpcDenied(label, promise) {
  const result = await promise;
  expect(Boolean(result.error), `${label}: protected RPC unexpectedly executed`);
  console.log(`PASS ${label}`);
}

async function expectRpcRevoked(label, promise) {
  const result = await promise;
  expect(Boolean(result.error), `${label}: legacy RPC unexpectedly executed`);
  const diagnostics = [
    result.error.code,
    result.error.message,
    result.error.details,
    result.error.hint,
  ].filter(Boolean).join(' ');
  expect(
    /42501|PGRST202|permission denied|could not find the function|schema cache/i.test(diagnostics),
    `${label}: RPC failed for a reason other than EXECUTE revocation: ${diagnostics}`,
  );
  console.log(`PASS ${label}`);
}

async function expectRpcError(label, promise, messagePattern) {
  const result = await promise;
  expect(Boolean(result.error), `${label}: RPC unexpectedly succeeded`);
  if (messagePattern) {
    expect(
      messagePattern.test(String(result.error.message || '')),
      `${label}: unexpected error: ${result.error.message}`,
    );
  }
  console.log(`PASS ${label}`);
}

function evidenceFixture({ fingerprint, bounds, providerBounds }) {
  const visionProvider = 'ecos-v13-live-validation-vision';
  const model = 'coordinate-fixture-v1';
  const assuranceProvider = 'ecos-v13-live-validation-assurance';
  const assuranceModel = 'coordinate-fixture-v1';
  const evidenceText = 'PCC paving thickness 6 inches';
  return {
    schemaVersion: SCHEMA_VERSION,
    evidenceVersion: EVIDENCE_VERSION,
    exceptionFingerprint: fingerprint,
    evidenceText,
    visionProvider,
    model,
    assuranceProvider,
    assuranceModel,
    confidence: 0.99,
    facts: [{
      statement: evidenceText,
      evidenceText,
      evidenceVersion: EVIDENCE_VERSION,
      exceptionFingerprint: fingerprint,
      visionProvider,
      model,
      assuranceProvider,
      assuranceModel,
      confidence: 0.99,
      corroboratedCandidateIndexes: [0],
      bounds,
      providerBounds,
    }],
  };
}

function assuranceFixture(fingerprint) {
  return {
    accepted: true,
    method: 'bounded_visual_exception_v2',
    schemaVersion: SCHEMA_VERSION,
    evidenceVersion: EVIDENCE_VERSION,
    exceptionFingerprint: fingerprint,
    assuranceProvider: 'ecos-v13-live-validation-assurance',
    assuranceModel: 'coordinate-fixture-v1',
    minimumConfidence: 0.99,
    acceptedFactCount: 1,
  };
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(help);
    return;
  }

  const url = required('SUPABASE_URL').replace(/\/+$/, '');
  const expectedUrl = required('ECOS_V13_VALIDATION_EXPECTED_URL').replace(/\/+$/, '');
  expect(url === expectedUrl, 'SUPABASE_URL does not match ECOS_V13_VALIDATION_EXPECTED_URL');
  expect(
    process.env.ECOS_V13_VALIDATION_ALLOW_MUTATION === MUTATION_GATE,
    `Set ECOS_V13_VALIDATION_ALLOW_MUTATION=${MUTATION_GATE} only for the approved isolated-fixture run`,
  );
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = required('SUPABASE_ANON_KEY');
  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(url, serviceKey, clientOptions);
  const anonymous = createClient(url, anonKey, clientOptions);

  const runId = crypto.randomBytes(8).toString('hex');
  const organizationId = `ecos-v13-validation-${runId}`;
  const projectId = `project-${runId}`;
  const documentId = `document-${runId}`;
  const sourceSha256 = crypto.createHash('sha256').update(`source-${runId}`).digest('hex');
  const claimToken = crypto.randomUUID();
  const fingerprint = crypto.createHash('sha256').update(`exception-${runId}`).digest('hex');
  const alternateFingerprint = crypto.createHash('sha256').update(`stale-${runId}`).digest('hex');
  const regionKey = `low-confidence-ocr-${runId}`;
  const password = `${crypto.randomBytes(24).toString('base64url')}A1!`;
  let user = null;
  let organizationInserted = false;
  let jobId = null;

  const exceptionBounds = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
  // Exact deterministic Edge -> worker -> DB fixture:
  // tile {0.1,0.2,0.3,0.4} plus tile-local {250,250,500,500}
  // maps to provider {175,300,150,200}, then worker-normalized bounds below.
  const factBounds = { x: 0.175, y: 0.3, width: 0.15, height: 0.2 };
  const providerBounds = { x: 175, y: 300, width: 150, height: 200 };
  const evidence = evidenceFixture({ fingerprint, bounds: factBounds, providerBounds });
  const assurance = assuranceFixture(fingerprint);

  const resolveArgs = overrides => ({
    p_job_id: jobId,
    p_claim_token: claimToken,
    p_page_number: 1,
    p_region_key: regionKey,
    p_bounds: exceptionBounds,
    p_reason: 'Live evidence 1.3 isolated coordinate contract',
    p_evidence_version: EVIDENCE_VERSION,
    p_exception_fingerprint: fingerprint,
    p_normalized_evidence: evidence,
    p_assurance_result: assurance,
    ...overrides,
  });

  try {
    const created = await service.auth.admin.createUser({
      email: `ecos-v13-${runId}@example.invalid`,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw created.error || new Error('Could not create isolated validation user');
    }
    user = created.data.user;
    await noError(
      await service.from('organizations').insert({
        id: organizationId,
        name: `ECOS evidence 1.3 validation ${runId}`,
      }),
      'create isolated organization',
    );
    organizationInserted = true;
    await noError(
      await service.from('ecos_hosted_index_configuration').insert({
        organization_id: organizationId,
        publication_mode: 'shadow',
        enabled: true,
      }),
      'create isolated hosted-index configuration',
    );
    const insertedJobs = await noError(
      await service.from('ecos_hosted_index_jobs').insert({
        organization_id: organizationId,
        project_id: projectId,
        document_id: documentId,
        source_owner_id: user.id,
        source_provider: 'managed_upload',
        source_locator: {},
        source_sha256: sourceSha256,
        source_page_count: 1,
        source_scan_status: 'clean',
        source_scan_engine: 'ecos-v13-live-validation',
        source_scan_at: new Date().toISOString(),
        mode: 'shadow',
        state: 'extracting',
        claim_token: claimToken,
        claimed_by: `ecos-v13-validation-${runId}`,
        lease_expires_at: iso(15 * 60 * 1000),
        committed_evidence_version: EVIDENCE_VERSION,
        requested_by: user.id,
      }).select('id'),
      'create isolated shadow job',
    );
    jobId = insertedJobs[0].id;

    const authenticated = createClient(url, anonKey, clientOptions);
    await noError(
      await authenticated.auth.signInWithPassword({ email: user.email, password }),
      'sign in isolated authenticated client',
    );

    const protectedCalls = client => [
      ['reserve v2', client.rpc('ecos_reserve_hosted_visual_region_v2', {
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_page_number: 1,
        p_region_key: regionKey,
        p_evidence_version: EVIDENCE_VERSION,
        p_exception_fingerprint: fingerprint,
        p_estimated_cost_microusd: 0,
      })],
      ['upsert v2', client.rpc('ecos_upsert_hosted_visual_exception_v2', {
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_page_number: 1,
        p_region_key: regionKey,
        p_bounds: exceptionBounds,
        p_reason: 'Unauthorized isolated validation call',
        p_evidence_version: EVIDENCE_VERSION,
        p_exception_fingerprint: fingerprint,
      })],
      ['resolve v2', client.rpc('ecos_resolve_hosted_visual_exception_v2', resolveArgs())],
      ['materializer', client.rpc('ecos_materialize_next_hosted_shadow_page', {
        p_job_id: jobId,
        p_claim_token: claimToken,
      })],
    ];
    for (const [name, promise] of protectedCalls(anonymous)) {
      await expectRpcDenied(`anon denial: ${name}`, promise);
    }
    for (const [name, promise] of protectedCalls(authenticated)) {
      await expectRpcDenied(`authenticated denial: ${name}`, promise);
    }

    const wrongClaim = await service.rpc(
      'ecos_resolve_hosted_visual_exception_v2',
      resolveArgs({ p_claim_token: crypto.randomUUID() }),
    );
    if (wrongClaim.error) throw new Error(`wrong claim validation: ${wrongClaim.error.message}`);
    expect(wrongClaim.data === false, 'Wrong claim token was accepted');
    console.log('PASS wrong claim rejection');

    await noError(
      await service.from('ecos_hosted_index_jobs')
        .update({ lease_expires_at: iso(-60 * 1000) })
        .eq('id', jobId),
      'expire isolated claim',
    );
    const expiredClaim = await service.rpc('ecos_resolve_hosted_visual_exception_v2', resolveArgs());
    if (expiredClaim.error) throw new Error(`expired claim validation: ${expiredClaim.error.message}`);
    expect(expiredClaim.data === false, 'Expired claim was accepted');
    console.log('PASS expired claim rejection');
    await noError(
      await service.from('ecos_hosted_index_jobs')
        .update({ lease_expires_at: iso(15 * 60 * 1000) })
        .eq('id', jobId),
      'restore isolated claim',
    );

    await expectRpcError(
      'stale evidence version rejection',
      service.rpc('ecos_resolve_hosted_visual_exception_v2', resolveArgs({
        p_evidence_version: 'ecos-hosted-evidence/1.2',
      })),
      /Assured schema-v2 visual evidence required/,
    );
    await expectRpcError(
      'stale exception fingerprint rejection',
      service.rpc('ecos_resolve_hosted_visual_exception_v2', resolveArgs({
        p_exception_fingerprint: alternateFingerprint,
      })),
      /Assured schema-v2 visual evidence required/,
    );
    const malformedEvidence = clone(evidence);
    malformedEvidence.facts[0].model = 'mismatched-model';
    await expectRpcError(
      'malformed provenance rejection',
      service.rpc('ecos_resolve_hosted_visual_exception_v2', resolveArgs({
        p_normalized_evidence: malformedEvidence,
      })),
      /Every visual fact must retain exact assured provenance/,
    );
    const edgeOnlyEvidence = evidenceFixture({
      fingerprint,
      bounds: { x: 0.4, y: 0.2, width: 0.001, height: 0.001 },
      providerBounds: { x: 400, y: 200, width: 1, height: 1 },
    });
    await expectRpcError(
      'one-pixel edge-only bounds rejection',
      service.rpc('ecos_resolve_hosted_visual_exception_v2', resolveArgs({
        p_normalized_evidence: edgeOnlyEvidence,
      })),
      /does not materially overlap the exact exception bounds/,
    );

    const firstResolve = await service.rpc('ecos_resolve_hosted_visual_exception_v2', resolveArgs());
    if (firstResolve.error) throw new Error(`first resolve: ${firstResolve.error.message}`);
    expect(firstResolve.data === true, 'First resolve did not insert the exact exception row');
    const firstCount = await service.from('ecos_hosted_visual_exceptions')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId).eq('page_number', 1).eq('region_key', regionKey);
    if (firstCount.error) throw new Error(`first resolve count: ${firstCount.error.message}`);
    expect(firstCount.count === 1, `First resolve created ${firstCount.count} rows`);
    console.log('PASS first atomic resolve insert');

    const repeatResolve = await service.rpc('ecos_resolve_hosted_visual_exception_v2', resolveArgs());
    if (repeatResolve.error) throw new Error(`repeat resolve: ${repeatResolve.error.message}`);
    expect(repeatResolve.data === true, 'Repeat resolve was not idempotently accepted');
    const repeatCount = await service.from('ecos_hosted_visual_exceptions')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId).eq('page_number', 1).eq('region_key', regionKey);
    if (repeatCount.error) throw new Error(`repeat resolve count: ${repeatCount.error.message}`);
    expect(repeatCount.count === 1, `Repeat resolve created ${repeatCount.count} rows`);
    console.log('PASS repeat atomic resolve');

    const concurrent = await Promise.all([
      service.rpc('ecos_resolve_hosted_visual_exception_v2', resolveArgs()),
      service.rpc('ecos_resolve_hosted_visual_exception_v2', resolveArgs()),
    ]);
    for (const result of concurrent) {
      if (result.error) throw new Error(`concurrent resolve: ${result.error.message}`);
      expect(result.data === true, 'Concurrent resolve was not idempotently accepted');
    }
    const concurrentCount = await service.from('ecos_hosted_visual_exceptions')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId).eq('page_number', 1).eq('region_key', regionKey);
    if (concurrentCount.error) throw new Error(`concurrent resolve count: ${concurrentCount.error.message}`);
    expect(concurrentCount.count === 1, `Concurrent resolves created ${concurrentCount.count} rows`);
    console.log('PASS concurrent atomic resolve');
    console.log('PASS Edge -> worker -> DB exact tile coordinate fixture');

    const missingJob = crypto.randomUUID();
    const missingClaim = crypto.randomUUID();
    const legacyCalls = [
      ['legacy upsert', service.rpc('ecos_upsert_hosted_visual_exception', {
        p_job_id: missingJob,
        p_claim_token: missingClaim,
        p_page_number: 1,
        p_region_key: regionKey,
        p_bounds: exceptionBounds,
        p_reason: 'Must remain revoked',
      })],
      ['legacy resolve', service.rpc('ecos_resolve_hosted_visual_exception', {
        p_job_id: missingJob,
        p_claim_token: missingClaim,
        p_page_number: 1,
        p_region_key: regionKey,
        p_normalized_evidence: {},
        p_assurance_result: {},
      })],
      ['legacy reserve', service.rpc('ecos_reserve_hosted_visual_region', {
        p_job_id: missingJob,
        p_claim_token: missingClaim,
        p_page_number: 1,
        p_region_key: regionKey,
        p_estimated_cost_microusd: 0,
      })],
      ['legacy versioned reserve', service.rpc('ecos_reserve_hosted_visual_region_versioned', {
        p_job_id: missingJob,
        p_claim_token: missingClaim,
        p_page_number: 1,
        p_region_key: regionKey,
        p_evidence_version: EVIDENCE_VERSION,
        p_estimated_cost_microusd: 0,
      })],
    ];
    for (const [name, promise] of legacyCalls) {
      await expectRpcRevoked(`service-role revocation: ${name}`, promise);
    }

    await noError(
      await service.from('ecos_hosted_shadow_chunks').insert({
        job_id: jobId,
        organization_id: organizationId,
        project_id: projectId,
        document_id: documentId,
        source_sha256: sourceSha256,
        page_number: 1,
        region_id: 'rollback-sentinel',
        chunk_index: 0,
        chunk_text: `rollback sentinel ${runId}`,
        metadata: { validationRun: runId },
      }),
      'insert rollback sentinel chunk',
    );
    await noError(
      await service.from('ecos_hosted_shadow_materialization_queue').insert({
        job_id: jobId,
        page_number: 1,
        operation: 'refresh',
      }),
      'insert rollback queue fixture',
    );
    await expectRpcError(
      'materializer empty-output rollback',
      service.rpc('ecos_materialize_next_hosted_shadow_page', {
        p_job_id: jobId,
        p_claim_token: claimToken,
      }),
      /Accepted shadow page produced no durable search chunks/,
    );
    const queueAfterRollback = await service.from('ecos_hosted_shadow_materialization_queue')
      .select('job_id', { count: 'exact', head: true }).eq('job_id', jobId).eq('page_number', 1);
    if (queueAfterRollback.error) throw new Error(`queue rollback check: ${queueAfterRollback.error.message}`);
    expect(queueAfterRollback.count === 1, 'Materializer failure consumed the queue item');
    const chunkAfterRollback = await service.from('ecos_hosted_shadow_chunks')
      .select('job_id', { count: 'exact', head: true })
      .eq('job_id', jobId).eq('page_number', 1).eq('region_id', 'rollback-sentinel');
    if (chunkAfterRollback.error) throw new Error(`chunk rollback check: ${chunkAfterRollback.error.message}`);
    expect(chunkAfterRollback.count === 1, 'Materializer failure did not roll back its chunk deletion');
    console.log('PASS materializer transaction rollback and queue retention');

    await expectRpcError(
      'ready rejection with pending queue',
      service.from('ecos_hosted_index_jobs').update({ state: 'ready' }).eq('id', jobId),
      /Shadow search materialization is incomplete/,
    );
    const stateAfterQueueGuard = await noError(
      await service.from('ecos_hosted_index_jobs').select('state').eq('id', jobId).single(),
      'read state after queue guard',
    );
    expect(stateAfterQueueGuard.state !== 'ready', 'Queue guard allowed ready state');

    await noError(
      await service.from('ecos_hosted_shadow_materialization_queue').delete().eq('job_id', jobId),
      'clear isolated queue fixture',
    );
    await noError(
      await service.from('ecos_hosted_shadow_chunks').delete().eq('job_id', jobId),
      'clear isolated chunk fixture',
    );
    await noError(
      await service.from('ecos_hosted_index_pages').insert({
        job_id: jobId,
        organization_id: organizationId,
        project_id: projectId,
        document_id: documentId,
        page_number: 1,
        source_sha256: sourceSha256,
        state: 'assured',
        final_page_data: { regions: [] },
        assurance_result: { accepted: true },
        unresolved_region_count: 0,
      }),
      'insert accepted page without materialized chunks',
    );
    await noError(
      await service.from('ecos_hosted_shadow_materialization_queue').delete().eq('job_id', jobId),
      'remove trigger-created queue for missing-chunk guard fixture',
    );
    await expectRpcError(
      'ready rejection with accepted page missing chunks',
      service.from('ecos_hosted_index_jobs').update({ state: 'ready' }).eq('id', jobId),
      /An accepted shadow page has no durable search chunks/,
    );
    await noError(
      await service.from('ecos_hosted_index_pages').delete().eq('job_id', jobId),
      'remove missing-chunk page fixture',
    );
    await noError(
      await service.from('ecos_hosted_shadow_materialization_queue').delete().eq('job_id', jobId),
      'remove page-delete queue fixture',
    );

    await noError(
      await service.from('ecos_hosted_visual_exceptions')
        .update({ evidence_version: 'ecos-hosted-evidence/1.2' })
        .eq('job_id', jobId).eq('region_key', regionKey),
      'make isolated resolved evidence stale',
    );
    await expectRpcError(
      'ready rejection with stale resolved evidence',
      service.from('ecos_hosted_index_jobs').update({ state: 'ready' }).eq('id', jobId),
      /Resolved visual evidence is stale or unassured/,
    );
    const finalState = await noError(
      await service.from('ecos_hosted_index_jobs').select('state').eq('id', jobId).single(),
      'read state after stale-evidence guard',
    );
    expect(finalState.state !== 'ready', 'Stale-evidence guard allowed ready state');
    console.log('PASS all ready-state rejection guards');

    console.log('ECOS hosted evidence 1.3 live post-migration validation: PASS');
  } finally {
    if (organizationInserted) {
      const cleanup = await service.from('organizations').delete().eq('id', organizationId);
      if (cleanup.error) console.error(`Cleanup warning (organization): ${cleanup.error.message}`);
    }
    if (user) {
      const cleanupUser = await service.auth.admin.deleteUser(user.id);
      if (cleanupUser.error) console.error(`Cleanup warning (user): ${cleanupUser.error.message}`);
    }
  }
}

main().catch(error => {
  console.error(`ECOS hosted evidence 1.3 live post-migration validation: FAIL - ${error.message}`);
  process.exit(1);
});
