#!/usr/bin/env node

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const reportPrefixArgIndex = process.argv.indexOf('--report-prefix');
const reportPrefix =
  reportPrefixArgIndex >= 0 ? process.argv[reportPrefixArgIndex + 1] : null;

const REQUIRED_ENV = reportPrefix
  ? ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
  : [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ];

const missingEnv = REQUIRED_ENV.filter(name => !process.env[name]);
if (missingEnv.length > 0) {
  console.log('EXTERNAL EXECUTION REQUIRED');
  console.log(`Missing environment variables: ${missingEnv.join(', ')}`);
  console.log(
    'Required command: SUPABASE_URL=<url> SUPABASE_ANON_KEY=<anon-key> SUPABASE_SERVICE_ROLE_KEY=<service-role-key> npm run test:rls-live',
  );
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
};

const service = createClient(supabaseUrl, serviceRoleKey, clientOptions);
const anon = anonKey ? createClient(supabaseUrl, anonKey, clientOptions) : null;

const runId = process.env.SUPABASE_RLS_TEST_RUN_PREFIX || `pie-rls-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const testTenantPrefix = process.env.SUPABASE_RLS_TEST_TENANT_PREFIX || 'pie-rls-validation';
const now = new Date().toISOString();
const state = {
  userIds: [],
  projectNames: [],
};

function logPass(name) {
  console.log(`PASS ${name}`);
}

function fail(message) {
  throw new Error(message);
}

function sanitizeError(error) {
  if (!error) return 'no error';
  return String(error.message || error).replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/g, '[redacted-jwt]');
}

function tableId(table, suffix) {
  return `${runId}-${table}-${suffix}`;
}

function expectRows(data, expected, label) {
  const count = Array.isArray(data) ? data.length : data ? 1 : 0;
  if (count !== expected) {
    fail(`${label}: expected ${expected} row(s), got ${count}`);
  }
}

async function expectAllowed(label, promise, expectedRows = 1) {
  const { data, error } = await promise;
  if (error) fail(`${label}: expected allowed, got ${sanitizeError(error)}`);
  expectRows(data, expectedRows, label);
  logPass(label);
  return data;
}

async function expectDenied(label, promise) {
  const { data, error } = await promise;
  const count = Array.isArray(data) ? data.length : data ? 1 : 0;
  if (!error && count > 0) {
    fail(`${label}: expected denied, got ${count} row(s)`);
  }
  logPass(label);
}

function org(id) {
  return `${runId}-${id}`;
}

function project(id) {
  return `${testTenantPrefix}-${id}`;
}

function testOrg(id) {
  return `${testTenantPrefix}-${id}`;
}

function actor(userId, organizationId) {
  return {
    id: userId,
    organizationId,
    role: 'organization_admin',
    source: 'live-rls-test',
  };
}

function realityModelRow(id, organizationId, projectId, userId) {
  return {
    id,
    organization_id: organizationId,
    project_id: projectId,
    model_version: 1,
    status: 'authoritative',
    generated_at: now,
    last_synchronized_at: now,
    source_evidence_cutoff_at: now,
    confidence: 'high',
    readiness: 'Ready',
    expected_future_state: 'Temporary live RLS test state',
    summary: { testRunId: runId },
    created_by: userId,
  };
}

function executiveJudgmentRow(id, organizationId, projectId, realityModelId) {
  return {
    id,
    organization_id: organizationId,
    project_id: projectId,
    reality_model_id: realityModelId,
    reality_model_version: 1,
    reality_snapshot_id: `${id}-snapshot`,
    judgment_time: now,
    situation_summary: 'Temporary live RLS test judgment',
    primary_recommendation: `Validate RLS behavior for ${runId}`,
    alternatives_considered: [],
    tradeoffs: {},
    risks: [],
    constraints: [],
    opportunities: [],
    resource_considerations: [],
    priority_rationale: `Live test ${runId}`,
    escalation_rationale: 'No escalation',
    authority_requirement: 'organization_admin',
    no_action_option: `Do not validate ${runId}`,
    confidence: 'high',
    uncertainty: [],
    supporting_reality_object_ids: [],
    supporting_assertion_ids: [],
    active_conflict_ids: [],
    active_uncertainty_ids: [],
    evidence_cutoff_time: now,
    conditions_that_would_change_recommendation: [],
    immutable: true,
  };
}

function photoSequenceRow(id, organizationId, projectId) {
  return {
    id,
    organization_id: organizationId,
    project_id: projectId,
    stable_key: `${id}-stable`,
    project_name: projectId,
    area_name: 'Live RLS Area',
    subject: 'Temporary live RLS photo sequence',
    approximate_viewpoint: 'North elevation',
    photo_ids: [`${id}-photo-1`, `${id}-photo-2`],
    identity_confidence: 'high',
    first_capture_date: now,
    last_capture_date: now,
  };
}

function progressEventRow(id, organizationId, projectId, sequenceId) {
  return {
    id,
    organization_id: organizationId,
    project_id: projectId,
    photo_sequence_id: sequenceId,
    affected_reality_object_ids: [],
    earlier_photo_id: `${id}-earlier`,
    later_photo_id: `${id}-later`,
    observation: 'Temporary live RLS progress event',
    inferred_meaning: 'RLS parent-child boundary is being tested',
    progress_category: 'installation',
    progress_direction: 'advanced',
    confidence: 'high',
    comparability_score: 91,
    corroborating_evidence_ids: [],
    contradicting_evidence_ids: [],
    verification_status: 'verified',
    review_status: 'ready',
    source_signature: `${id}-signature`,
  };
}

function conflictRow(id, organizationId, projectId, eventId) {
  return {
    id,
    organization_id: organizationId,
    project_id: projectId,
    event_id: eventId,
    conflict_type: 'live_rls_test',
    summary: 'Temporary live RLS progress conflict',
    evidence_ids: [],
    review_required: true,
  };
}

function comparabilityRow(id, organizationId, projectId) {
  return {
    id,
    organization_id: organizationId,
    project_id: projectId,
    earlier_photo_id: `${id}-earlier`,
    later_photo_id: `${id}-later`,
    classification: 'comparable',
    score: 93,
    reasons: ['temporary live RLS test'],
    limitations: [],
    normalization_operations: [],
    duplicate_detected: false,
    input_signature: `${id}-input`,
  };
}

function decisionRecordRow(id, organizationId, projectId, userId) {
  return {
    id,
    organization_id: organizationId,
    project_id: projectId,
    current_status: 'proposed',
    current_version: 1,
    immutable_snapshot: {
      id,
      projectId,
      testRunId: runId,
      summary: 'Temporary live RLS decision record',
    },
    outcome_plan: null,
    implementation_assessment: null,
    created_by: actor(userId, organizationId),
    close_blockers: [],
  };
}

function decisionVersionRow(decisionId, organizationId, projectId, userId, version) {
  return {
    decision_id: decisionId,
    organization_id: organizationId,
    project_id: projectId,
    version,
    snapshot: {
      decisionId,
      projectId,
      version,
      testRunId: runId,
      summary: 'Temporary live RLS decision version',
    },
    created_by: actor(userId, organizationId),
    reason: 'live RLS test',
  };
}

function syncDecisionPayload(id, organizationId, projectId, userId) {
  const createdBy = actor(userId, organizationId);
  return {
    id,
    organizationId,
    projectId,
    currentStatus: 'proposed',
    currentVersion: 1,
    immutableSnapshot: {
      id,
      projectId,
      summary: 'Temporary duplicate sync RLS decision',
    },
    outcomePlan: null,
    implementationAssessment: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
    closeBlockers: [],
    versions: [
      {
        version: 1,
        snapshot: { id, projectId, version: 1, testRunId: runId },
        createdBy,
        createdAt: now,
        reason: 'initial sync',
      },
    ],
    actualOutcomes: [],
    auditEvents: [],
  };
}

async function createUser(label) {
  const email = `${runId}-${label}@example.invalid`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { testRunId: runId, label },
  });
  if (error || !data.user) fail(`create user ${label}: ${sanitizeError(error)}`);
  state.userIds.push(data.user.id);

  const client = createClient(supabaseUrl, anonKey, clientOptions);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session) {
    fail(`sign in user ${label}: ${sanitizeError(signIn.error)}`);
  }
  return { client, id: data.user.id, email };
}

async function createProjectRows(projects) {
  for (const item of projects) {
    state.projectNames.push(item.name);
  }

  const payloads = projects.map(item => ({
    id: `${runId}-${item.id}`,
    name: item.name,
    owner_id: item.ownerId,
    status: 'Active',
    archived: false,
    is_favorite: false,
    project_data: {
      testRunId: runId,
      organizationId: item.organizationId,
    },
  }));

  let result = await service.from('projects').insert(payloads).select('id,name');
  if (!result.error) {
    logPass('service setup projects with organization metadata');
    return;
  }

  const fallbackPayloads = projects.map(item => ({
    name: item.name,
    owner_id: item.ownerId,
    status: 'Active',
    archived: false,
    is_favorite: false,
  }));
  result = await service.from('projects').insert(fallbackPayloads).select('id,name');
  if (result.error) {
    fail(`service setup projects: ${sanitizeError(result.error)}`);
  }
  logPass('service setup projects with product schema fallback');
}

async function setup() {
  const userA = await createUser('user-a');
  const userB = await createUser('user-b');

  const orgA = testOrg('org-a');
  const orgB = testOrg('org-b');
  const projectA1 = project('project-a1');
  const projectA2 = project('project-a2');
  const projectB1 = project('project-b1');

  await expectAllowed(
    'service setup organizations',
    service.from('organizations').upsert([
      { id: orgA, name: 'PIE Automated Validation Org A' },
      { id: orgB, name: 'PIE Automated Validation Org B' },
    ]).select('id'),
    2,
  );

  await createProjectRows([
    { id: projectA1, name: `${runId} Project A1`, organizationId: orgA, ownerId: userA.id },
    { id: projectA2, name: `${runId} Project A2`, organizationId: orgA, ownerId: userA.id },
    { id: projectB1, name: `${runId} Project B1`, organizationId: orgB, ownerId: userB.id },
  ]);

  await expectAllowed(
    'service setup organization memberships',
    service.from('organization_memberships').insert([
      { user_id: userA.id, organization_id: orgA, status: 'active', role: 'organization_admin' },
      { user_id: userB.id, organization_id: orgB, status: 'active', role: 'organization_admin' },
    ]).select('id'),
    2,
  );

  return { userA, userB, orgA, orgB, projectA1, projectA2, projectB1 };
}

async function seedOrgBRows(ctx) {
  const realityB = realityModelRow(tableId('reality', 'b'), ctx.orgB, ctx.projectB1, ctx.userB.id);
  const judgmentB = executiveJudgmentRow(tableId('judgment', 'b'), ctx.orgB, ctx.projectB1, realityB.id);
  const sequenceB = photoSequenceRow(tableId('sequence', 'b'), ctx.orgB, ctx.projectB1);
  const eventB = progressEventRow(tableId('event', 'b'), ctx.orgB, ctx.projectB1, sequenceB.id);
  const conflictB = conflictRow(tableId('conflict', 'b'), ctx.orgB, ctx.projectB1, eventB.id);
  const comparabilityB = comparabilityRow(tableId('comparability', 'b'), ctx.orgB, ctx.projectB1);
  const decisionB = decisionRecordRow(tableId('decision', 'b'), ctx.orgB, ctx.projectB1, ctx.userB.id);
  const versionB = decisionVersionRow(decisionB.id, ctx.orgB, ctx.projectB1, ctx.userB.id, 1);

  await expectAllowed('service setup org b reality row', service.from('pie_reality_models').insert(realityB).select('id'));
  await expectAllowed('service setup org b executive row', service.from('pie_executive_judgments').insert(judgmentB).select('id'));
  await expectAllowed('service setup org b photo sequence row', service.from('pie_photo_sequences').insert(sequenceB).select('id'));
  await expectAllowed('service setup org b progress event row', service.from('pie_photo_progress_events').insert(eventB).select('id'));
  await expectAllowed('service setup org b conflict row', service.from('pie_photo_progress_conflicts').insert(conflictB).select('id'));
  await expectAllowed('service setup org b comparability row', service.from('pie_photo_comparability_results').insert(comparabilityB).select('id'));
  await expectAllowed('service setup org b decision row', service.from('pie_decision_records').insert(decisionB).select('id'));
  await expectAllowed('service setup org b decision version row', service.from('pie_decision_versions').insert(versionB).select('id'));

  return { realityB, judgmentB, sequenceB, eventB, conflictB, comparabilityB, decisionB };
}

async function runLiveAssertions(ctx) {
  const realityA = realityModelRow(tableId('reality', 'a'), ctx.orgA, ctx.projectA1, ctx.userA.id);
  const judgmentA = executiveJudgmentRow(tableId('judgment', 'a'), ctx.orgA, ctx.projectA1, realityA.id);
  const sequenceA = photoSequenceRow(tableId('sequence', 'a'), ctx.orgA, ctx.projectA1);
  const eventA = progressEventRow(tableId('event', 'a'), ctx.orgA, ctx.projectA1, sequenceA.id);
  const conflictA = conflictRow(tableId('conflict', 'a'), ctx.orgA, ctx.projectA1, eventA.id);
  const comparabilityA = comparabilityRow(tableId('comparability', 'a'), ctx.orgA, ctx.projectA1);
  const decisionA = decisionRecordRow(tableId('decision', 'a'), ctx.orgA, ctx.projectA1, ctx.userA.id);
  const versionA = decisionVersionRow(decisionA.id, ctx.orgA, ctx.projectA1, ctx.userA.id, 1);
  const orgBRows = await seedOrgBRows(ctx);

  const insertCases = [
    ['pie_reality_models', realityA],
    ['pie_executive_judgments', judgmentA],
    ['pie_photo_sequences', sequenceA],
    ['pie_photo_progress_events', eventA],
    ['pie_photo_progress_conflicts', conflictA],
    ['pie_photo_comparability_results', comparabilityA],
    ['pie_decision_records', decisionA],
    ['pie_decision_versions', versionA],
  ];

  for (const [table, row] of insertCases) {
    await expectAllowed(`user a authorized insert ${table}`, ctx.userA.client.from(table).insert(row).select('*'));
  }

  const rowSelectors = [
    ['pie_reality_models', realityA.id, orgBRows.realityB.id],
    ['pie_executive_judgments', judgmentA.id, orgBRows.judgmentB.id],
    ['pie_photo_sequences', sequenceA.id, orgBRows.sequenceB.id],
    ['pie_photo_progress_events', eventA.id, orgBRows.eventB.id],
    ['pie_photo_progress_conflicts', conflictA.id, orgBRows.conflictB.id],
    ['pie_photo_comparability_results', comparabilityA.id, orgBRows.comparabilityB.id],
    ['pie_decision_records', decisionA.id, orgBRows.decisionB.id],
  ];

  for (const [table, orgAId, orgBId] of rowSelectors) {
    await expectAllowed(`user a authorized select ${table}`, ctx.userA.client.from(table).select('*').eq('id', orgAId));
    await expectDenied(`anonymous denied select ${table}`, anon.from(table).select('*').eq('id', orgAId));
    await expectDenied(`user a denied org b select ${table}`, ctx.userA.client.from(table).select('*').eq('id', orgBId));
    await expectDenied(`user b denied org a select ${table}`, ctx.userB.client.from(table).select('*').eq('id', orgAId));
  }

  await expectAllowed(
    'user a authorized select pie_decision_versions',
    ctx.userA.client.from('pie_decision_versions').select('*').eq('decision_id', decisionA.id),
  );
  await expectDenied(
    'anonymous denied select pie_decision_versions',
    anon.from('pie_decision_versions').select('*').eq('decision_id', decisionA.id),
  );
  await expectDenied(
    'user a denied org b select pie_decision_versions',
    ctx.userA.client.from('pie_decision_versions').select('*').eq('decision_id', orgBRows.decisionB.id),
  );
  await expectDenied(
    'user b denied org a select pie_decision_versions',
    ctx.userB.client.from('pie_decision_versions').select('*').eq('decision_id', decisionA.id),
  );

  await expectDenied(
    'anonymous denied insert pie_reality_models',
    anon.from('pie_reality_models').insert(realityModelRow(tableId('reality', 'anon-denied'), ctx.orgA, ctx.projectA1, null)).select('*'),
  );

  const unauthorizedInserts = [
    ['pie_reality_models', realityModelRow(tableId('reality', 'unauth-org-b'), ctx.orgB, ctx.projectB1, ctx.userA.id)],
    ['pie_executive_judgments', executiveJudgmentRow(tableId('judgment', 'unauth-org-b'), ctx.orgB, ctx.projectB1, orgBRows.realityB.id)],
    ['pie_photo_sequences', photoSequenceRow(tableId('sequence', 'unauth-org-b'), ctx.orgB, ctx.projectB1)],
    ['pie_photo_progress_events', progressEventRow(tableId('event', 'unauth-org-b'), ctx.orgB, ctx.projectB1, orgBRows.sequenceB.id)],
    ['pie_photo_progress_conflicts', conflictRow(tableId('conflict', 'unauth-org-b'), ctx.orgB, ctx.projectB1, orgBRows.eventB.id)],
    ['pie_photo_comparability_results', comparabilityRow(tableId('comparability', 'unauth-org-b'), ctx.orgB, ctx.projectB1)],
    ['pie_decision_records', decisionRecordRow(tableId('decision', 'unauth-org-b'), ctx.orgB, ctx.projectB1, ctx.userA.id)],
    ['pie_decision_versions', decisionVersionRow(orgBRows.decisionB.id, ctx.orgB, ctx.projectB1, ctx.userA.id, 2)],
  ];

  for (const [table, row] of unauthorizedInserts) {
    await expectDenied(`user a denied org b insert ${table}`, ctx.userA.client.from(table).insert(row).select('*'));
  }

  await expectDenied(
    'parent-child organization mismatch rejected for progress event',
    ctx.userA.client
      .from('pie_photo_progress_events')
      .insert(progressEventRow(tableId('event', 'org-mismatch'), ctx.orgA, ctx.projectA1, orgBRows.sequenceB.id))
      .select('*'),
  );
  await expectDenied(
    'parent-child project mismatch rejected for progress event',
    ctx.userA.client
      .from('pie_photo_progress_events')
      .insert(progressEventRow(tableId('event', 'project-mismatch'), ctx.orgA, ctx.projectA2, sequenceA.id))
      .select('*'),
  );
  await expectDenied(
    'parent-child organization mismatch rejected for progress conflict',
    ctx.userA.client
      .from('pie_photo_progress_conflicts')
      .insert(conflictRow(tableId('conflict', 'org-mismatch'), ctx.orgA, ctx.projectA1, orgBRows.eventB.id))
      .select('*'),
  );
  await expectDenied(
    'parent-child project mismatch rejected for progress conflict',
    ctx.userA.client
      .from('pie_photo_progress_conflicts')
      .insert(conflictRow(tableId('conflict', 'project-mismatch'), ctx.orgA, ctx.projectA2, eventA.id))
      .select('*'),
  );

  await expectDenied(
    'cross-organization update fails',
    ctx.userB.client.from('pie_photo_sequences').update({ subject: 'blocked' }).eq('id', sequenceA.id).select('*'),
  );
  await expectDenied(
    'cross-project parent-child update fails',
    ctx.userA.client.from('pie_photo_progress_events').update({ project_id: ctx.projectA2 }).eq('id', eventA.id).select('*'),
  );

  await expectAllowed(
    'authorized upsert update allowed pie_reality_models',
    ctx.userA.client.from('pie_reality_models').update({ status: 'needs_review' }).eq('id', realityA.id).select('*'),
  );
  await expectDenied(
    'immutable executive judgment update denied',
    ctx.userA.client.from('pie_executive_judgments').update({ primary_recommendation: 'mutated' }).eq('id', judgmentA.id).select('*'),
  );
  await expectDenied(
    'immutable executive judgment delete denied',
    ctx.userA.client.from('pie_executive_judgments').delete().eq('id', judgmentA.id).select('*'),
  );
  await expectAllowed(
    'update allowed pie_photo_sequences',
    ctx.userA.client.from('pie_photo_sequences').update({ subject: 'Temporary live RLS photo sequence updated' }).eq('id', sequenceA.id).select('*'),
  );
  await expectAllowed(
    'update allowed pie_photo_progress_events',
    ctx.userA.client.from('pie_photo_progress_events').update({ review_status: 'reviewed' }).eq('id', eventA.id).select('*'),
  );
  await expectAllowed(
    'update allowed pie_photo_progress_conflicts',
    ctx.userA.client.from('pie_photo_progress_conflicts').update({ summary: 'Temporary live RLS progress conflict updated' }).eq('id', conflictA.id).select('*'),
  );
  await expectAllowed(
    'update allowed pie_photo_comparability_results',
    ctx.userA.client.from('pie_photo_comparability_results').update({ score: 94 }).eq('id', comparabilityA.id).select('*'),
  );
  await expectAllowed(
    'update allowed pie_decision_records',
    ctx.userA.client.from('pie_decision_records').update({ current_status: 'approved', current_version: 2 }).eq('id', decisionA.id).select('*'),
  );
  await expectDenied(
    'update denied pie_decision_versions',
    ctx.userA.client.from('pie_decision_versions').update({ reason: 'mutated' }).eq('decision_id', decisionA.id).select('*'),
  );

  const syncId = tableId('decision-sync', 'idempotent');
  const syncPayload = syncDecisionPayload(syncId, ctx.orgA, ctx.projectA1, ctx.userA.id);
  await expectAllowed(
    'duplicate synchronization first rpc succeeds',
    ctx.userA.client.rpc('save_pie_decision_record_atomic', {
      decision_payload: syncPayload,
      actor_payload: actor(ctx.userA.id, ctx.orgA),
    }),
  );
  await expectAllowed(
    'duplicate synchronization second rpc is idempotent',
    ctx.userA.client.rpc('save_pie_decision_record_atomic', {
      decision_payload: syncPayload,
      actor_payload: actor(ctx.userA.id, ctx.orgA),
    }),
  );
  await expectAllowed(
    'duplicate synchronization created one version',
    service.from('pie_decision_versions').select('id').eq('decision_id', syncId).eq('version', 1),
  );
}

async function cleanup() {
  const summary = {
    deleted: [],
    retained: [],
    failed: [],
  };

  const countByPrefix = async (table, column = 'id') => {
    const { count, error } = await service
      .from(table)
      .select(column, { count: 'exact', head: true })
      .like(column, `${runId}%`);
    if (error) {
      summary.failed.push({ table, count: 0, reason: sanitizeError(error) });
      return 0;
    }
    return count || 0;
  };

  const deleteByIdPrefix = async (table, column = 'id') => {
    const before = await countByPrefix(table, column);
    if (before === 0) {
      summary.deleted.push({ table, count: 0 });
      return;
    }
    const { data, error } = await service.from(table).delete().like(column, `${runId}%`).select(column);
    if (error) {
      summary.failed.push({ table, count: before, reason: sanitizeError(error) });
      return;
    }
    summary.deleted.push({ table, count: Array.isArray(data) ? data.length : before });
  };

  const retainByIdPrefix = async (table, column, classification) => {
    const count = await countByPrefix(table, column);
    if (count > 0) summary.retained.push({ table, count, classification });
  };

  await deleteByIdPrefix('pie_photo_progress_conflicts');
  await deleteByIdPrefix('pie_photo_progress_events');
  await deleteByIdPrefix('pie_photo_comparability_results');
  await deleteByIdPrefix('pie_photo_sequences');
  await deleteByIdPrefix('pie_reality_models');
  await retainByIdPrefix(
    'pie_executive_judgments',
    'id',
    'retained immutable automated validation record',
  );
  await retainByIdPrefix(
    'pie_decision_versions',
    'decision_id',
    'retained append-only Layer 4 automated validation record',
  );
  await retainByIdPrefix(
    'pie_decision_records',
    'id',
    'retained Layer 4 decision root for append-only validation history',
  );

  for (const name of state.projectNames) {
    const { data, error } = await service.from('projects').delete().eq('name', name).select('id');
    if (error) {
      summary.failed.push({ table: 'projects', count: 1, reason: sanitizeError(error) });
    } else {
      summary.deleted.push({ table: 'projects', count: Array.isArray(data) ? data.length : 0 });
    }
  }

  const { data: membershipData, error: membershipError } = await service
    .from('organization_memberships')
    .delete()
    .in('user_id', state.userIds.length ? state.userIds : ['00000000-0000-0000-0000-000000000000'])
    .select('id');
  if (membershipError) {
    summary.failed.push({ table: 'organization_memberships', count: state.userIds.length, reason: sanitizeError(membershipError) });
  } else {
    summary.deleted.push({ table: 'organization_memberships', count: Array.isArray(membershipData) ? membershipData.length : 0 });
  }

  summary.retained.push({
    table: 'organizations',
    count: 2,
    classification: 'retained dedicated automated validation tenant; no active test memberships remain after cleanup',
  });

  for (const userId of state.userIds) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) {
      summary.failed.push({ table: 'auth.users', count: 1, reason: sanitizeError(error) });
    } else {
      summary.deleted.push({ table: 'auth.users', count: 1 });
    }
  }

  return summary;
}

function printCleanupSummary(summary) {
  const deleted = summary.deleted.reduce((total, item) => total + item.count, 0);
  const retained = summary.retained.reduce((total, item) => total + item.count, 0);
  const failed = summary.failed.reduce((total, item) => total + item.count, 0);

  console.log(`CLEANUP deleted=${deleted} retained=${retained} failed=${failed}`);
  summary.deleted.forEach(item => console.log(`CLEANUP DELETED ${item.table} count=${item.count}`));
  summary.retained.forEach(item =>
    console.log(`CLEANUP RETAINED ${item.table} count=${item.count} classification=${item.classification}`),
  );
  summary.failed.forEach(item =>
    console.log(`CLEANUP FAILED ${item.table} count=${item.count} reason=${item.reason}`),
  );
}

async function reportRemainingRecords(prefix) {
  if (!prefix) fail('report prefix is required');
  const targets = [
    ['pie_executive_judgments', 'id'],
    ['pie_decision_versions', 'decision_id'],
    ['pie_decision_records', 'id'],
    ['pie_photo_progress_conflicts', 'id'],
    ['pie_photo_progress_events', 'id'],
    ['pie_photo_comparability_results', 'id'],
    ['pie_photo_sequences', 'id'],
    ['pie_reality_models', 'id'],
    ['organizations', 'id'],
    ['organization_memberships', 'organization_id'],
  ];

  console.log(`REMAINING LIVE RLS TEST RECORDS prefix=${prefix}`);
  for (const [table, column] of targets) {
    const { count, error } = await service
      .from(table)
      .select(column, { count: 'exact', head: true })
      .like(column, `${prefix}%`);
    if (error) {
      console.log(`REMAINING ${table}.${column} ERROR ${sanitizeError(error)}`);
    } else {
      console.log(`REMAINING ${table}.${column} count=${count || 0}`);
    }
  }

  const { count: projectCount, error: projectError } = await service
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .like('name', `%${prefix}%`);
  if (projectError) {
    console.log(`REMAINING projects.name ERROR ${sanitizeError(projectError)}`);
  } else {
    console.log(`REMAINING projects.name count=${projectCount || 0}`);
  }
}

(async () => {
  if (reportPrefix) {
    await reportRemainingRecords(reportPrefix);
    return;
  }

  let failed = false;
  let cleanupSummary = null;
  try {
    console.log(`LIVE_RLS_TEST_RUN_PREFIX=${runId}`);
    console.log(`LIVE_RLS_TEST_TENANT_PREFIX=${testTenantPrefix}`);
    const ctx = await setup();
    await runLiveAssertions(ctx);
    console.log('PASS live authenticated RLS test');
    console.log('Authorization model: organization authorization plus parent-child project consistency; no true per-project user authorization is proven.');
  } catch (error) {
    failed = true;
    console.error(`FAIL live authenticated RLS test: ${sanitizeError(error)}`);
  } finally {
    cleanupSummary = await cleanup();
    printCleanupSummary(cleanupSummary);
  }

  const hasCleanupFailures = cleanupSummary.failed.length > 0;
  const retainedImmutableCount = cleanupSummary.retained.reduce((total, item) => total + item.count, 0);

  if (failed || hasCleanupFailures) {
    console.log('FINAL RESULT: FAIL');
    process.exit(1);
  }

  if (retainedImmutableCount > 0) {
    console.log('FINAL RESULT: PASS WITH RETAINED IMMUTABLE TEST RECORDS');
    return;
  }

  console.log('FINAL RESULT: PASS');
  if (failed) process.exit(1);
})();
