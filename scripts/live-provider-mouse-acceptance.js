#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = REQUIRED_ENV.filter(name => !process.env[name]);
if (missing.length > 0) {
  console.log('EXTERNAL_EXECUTION_REQUIRED');
  console.log(`Missing environment variables: ${missing.join(', ')}`);
  console.log('Required command: SUPABASE_URL=<url> SUPABASE_ANON_KEY=<anon-key> SUPABASE_SERVICE_ROLE_KEY=<service-role-key> npm run test:live-provider-mouse');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const fixtureDir = path.join(rootDir, 'validation/multimodal/fixtures/mouse_added_to_table');
const beforePath = path.join(fixtureDir, 'mouse_added_to_table_before.jpeg');
const afterPath = path.join(fixtureDir, 'mouse_added_to_table_after.jpeg');
const expectedBeforeHash = 'f6fd751f3869845c1f7910eaa87fdf5ef2a2e46f97ecb8cc33c1a9fa5ab5dd21';
const expectedAfterHash = 'ddc221e78b324367dc7d7cf70070bea2be24cce244e8d535216e64e98324b15e';
const bucket = 'pie-project-evidence';
const runId = process.env.SUPABASE_PROVIDER_MOUSE_RUN_PREFIX || `pie-provider-mouse-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const organizationId = `${runId}-org`;
const projectId = `${runId}-project`;
const beforeEvidenceId = `${runId}-before`;
const afterEvidenceId = `${runId}-after`;
const requestId = `${runId}-request`;
const beforeStoragePath = `${runId}/mouse_added_to_table_before.jpeg`;
const afterStoragePath = `${runId}/mouse_added_to_table_after.jpeg`;
const now = new Date().toISOString();
const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
};

const service = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, clientOptions);
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, clientOptions);
const cleanupSummary = {
  storageDeleted: 0,
  rowsDeleted: [],
  retained: [],
  failed: [],
};
const state = {
  userId: null,
  email: null,
  projectRecordId: projectId,
  projectName: `${runId} Mouse Acceptance Project`,
};

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sanitizeError(error) {
  if (!error) return 'no error';
  return sanitizeText(String(error.message || error));
}

function sanitizeText(value) {
  let sanitized = String(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/g, '[redacted-jwt]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-openai-key]')
    .replace(/(https?:\/\/[^\s"']+\/storage\/v1\/object\/sign\/[^\s"'?]+)\?[^\s"']+/g, '$1?[redacted-signed-url-query]');
  for (const name of REQUIRED_ENV) {
    const secret = process.env[name];
    if (secret && secret.length > 8) sanitized = sanitized.split(secret).join(`[redacted-${name.toLowerCase()}]`);
  }
  return sanitized;
}

function sanitizeValue(value) {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const sensitiveKey = /authorization|password|jwt|token|secret|service_role|service-role|anon_key|api_key|apikey/i.test(key);
    return [key, sensitiveKey ? '[redacted]' : sanitizeValue(item)];
  }));
}

function stageFailure(stage, message) {
  return new Error(`${stage} failed: ${message}`);
}

async function parseResponseBody(response) {
  if (!response || typeof response.clone !== 'function') return null;
  try {
    return sanitizeValue(await response.clone().json());
  } catch {
    try {
      const text = await response.clone().text();
      return sanitizeText(text);
    } catch {
      return null;
    }
  }
}

function responseFromFunctionError(error) {
  return error?.context || error?.response || error?.cause?.context || error?.cause?.response || null;
}

async function printFunctionFailureDiagnostics(operationName, error) {
  const response = responseFromFunctionError(error);
  const diagnostics = {
    operationName,
    httpStatus: typeof response?.status === 'number' ? response.status : null,
    httpStatusText: typeof response?.statusText === 'string' ? sanitizeText(response.statusText) : null,
    supabaseFunctionsErrorType: error?.name || error?.constructor?.name || 'unknown',
    safeErrorMessage: sanitizeError(error),
    parsedResponseBody: await parseResponseBody(response),
  };
  console.error('EDGE_FUNCTION_FAILURE_DIAGNOSTICS', JSON.stringify(diagnostics, null, 2));
}

async function invokeFunction(userClient, operationName, body) {
  const result = await userClient.functions.invoke('pie-photo-vision', { body });
  if (result.error) {
    await printFunctionFailureDiagnostics(operationName, result.error);
    throw stageFailure(operationName, sanitizeError(result.error));
  }
  return result.data;
}

function readFixture(filePath, expectedHash) {
  assert(fs.existsSync(filePath), `Fixture missing: ${path.relative(rootDir, filePath)}`);
  const bytes = fs.readFileSync(filePath);
  assert(bytes.length > 0, `Fixture empty: ${path.relative(rootDir, filePath)}`);
  const hash = sha256(bytes);
  assert(hash === expectedHash, `Fixture hash mismatch for ${path.basename(filePath)}: ${hash}`);
  return { bytes, hash };
}

async function expectNoError(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${sanitizeError(result.error)}`);
  return result;
}

async function createUser() {
  const email = `${runId}@example.invalid`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { automatedTestRunId: runId, purpose: 'live-provider-mouse-acceptance' },
  });
  if (created.error || !created.data.user) throw new Error(`create test user: ${sanitizeError(created.error)}`);
  state.userId = created.data.user.id;
  state.email = email;

  const signedIn = await anon.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) throw new Error(`sign in test user: ${sanitizeError(signedIn.error)}`);
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${signedIn.data.session.access_token}` } },
  });
}

async function createProjectRow() {
  const payload = {
    id: projectId,
    name: state.projectName,
    status: 'Active',
    archived: false,
    is_favorite: false,
    project_data: { automatedTestRunId: runId, organizationId },
  };
  const result = await service.from('projects').insert(payload).select('id').maybeSingle();
  if (!result.error && result.data?.id) {
    state.projectRecordId = result.data.id;
    return;
  }

  const fallback = await service.from('projects').insert({
    name: state.projectName,
    status: 'Active',
    archived: false,
    is_favorite: false,
  }).select('id').maybeSingle();
  if (fallback.error) throw new Error(`create project row: ${sanitizeError(result.error)}; fallback: ${sanitizeError(fallback.error)}`);
  state.projectRecordId = fallback.data?.id ?? null;
}

async function setup(before, after) {
  const userClient = await createUser();
  await expectNoError('create organization', service.from('organizations').upsert({
    id: organizationId,
    name: 'PIE Automated Provider Mouse Acceptance',
  }).select('id'));
  await createProjectRow();
  await expectNoError('create membership', service.from('organization_memberships').insert({
    user_id: state.userId,
    organization_id: organizationId,
    status: 'active',
    role: 'organization_admin',
  }).select('id'));

  await expectNoError('upload before fixture', service.storage.from(bucket).upload(beforeStoragePath, before.bytes, {
    contentType: 'image/jpeg',
    upsert: true,
  }));
  await expectNoError('upload after fixture', service.storage.from(bucket).upload(afterStoragePath, after.bytes, {
    contentType: 'image/jpeg',
    upsert: true,
  }));

  await expectNoError('insert evidence records', service.from('pie_evidence_records').insert([
    evidenceRow(beforeEvidenceId, before.hash, beforeStoragePath),
    evidenceRow(afterEvidenceId, after.hash, afterStoragePath),
  ]).select('id'));
  await expectNoError('insert photo asset rows', service.from('pie_photo_assets').insert([
    photoAssetRow(beforeEvidenceId, before.hash, beforeStoragePath, before.bytes.length),
    photoAssetRow(afterEvidenceId, after.hash, afterStoragePath, after.bytes.length),
  ]).select('evidence_id'));

  return userClient;
}

function evidenceRow(id, hash, storagePath) {
  return {
    id,
    organization_id: organizationId,
    project_id: projectId,
    evidence_type: 'photo',
    source: 'automated_validation_fixture',
    source_system: 'pie-live-provider-mouse-acceptance',
    captured_at: now,
    effective_at: now,
    author_id: state.userId,
    storage_refs: [{ variant: 'original', path: storagePath, bucket }],
    content_hash: hash,
    mime_type: 'image/jpeg',
    authority: 'supporting',
    processing_state: 'queued',
    analyzer_id: 'pie-live-provider-mouse-acceptance',
    analyzer_version: '2026.07.03',
    automated_test_run_id: runId,
    hidden_from_normal_queries: true,
    associations: [{ type: 'validation_case', id: 'mouse_added_to_table' }],
  };
}

function photoAssetRow(evidenceId, hash, storagePath, sizeBytes) {
  return {
    evidence_id: evidenceId,
    organization_id: organizationId,
    project_id: projectId,
    original_storage_path: storagePath,
    content_hash: hash,
    mime_type: 'image/jpeg',
    size_bytes: sizeBytes,
    capture_source: 'upload',
    captured_at: now,
    automated_test_run_id: runId,
    hidden_from_normal_queries: true,
  };
}

async function configCheck(userClient) {
  const data = await invokeFunction(userClient, 'config_check', { operation: 'config_check' });
  if (data?.status !== 'ok') throw stageFailure('config_check', 'config check did not return ok');
  for (const name of ['PIE_VISION_PROVIDER', 'PIE_OPENAI_API_KEY', 'PIE_OPENAI_VISION_MODEL', 'PIE_VISION_TIMEOUT_MS', 'PIE_VISION_MAX_RETRIES']) {
    if (data.secrets?.[name] !== true) throw stageFailure('config_check', `deployed function cannot read ${name}`);
  }
  if (data.providerName !== 'openai') throw stageFailure('config_check', `expected provider openai, got ${data.providerName || 'missing'}`);
  return data;
}

async function invokeVision(userClient) {
  const data = await invokeFunction(userClient, 'paired-photo provider analysis', {
    requestId,
    mode: 'photo_pair',
    organizationId,
    projectId,
    baselineEvidenceId: beforeEvidenceId,
    currentEvidenceId: afterEvidenceId,
    promptVersion: '2026.07.03-live-provider-mouse-acceptance',
    forceReanalysis: true,
  });
  if (data?.status === 'degraded') {
    await printPersistedRequestDiagnostics('DEGRADED_REQUEST_DIAGNOSTICS');
    throw stageFailure('paired-photo provider analysis', 'request status was degraded');
  }
  if (data?.status === 'failed') {
    await printPersistedRequestDiagnostics('FAILED_REQUEST_DIAGNOSTICS');
    throw stageFailure('paired-photo provider analysis', 'request status was failed');
  }
  if (data?.status !== 'succeeded') throw stageFailure('paired-photo provider analysis', `request status was ${data?.status || 'missing'}`);
  if (data?.providerName !== 'openai') throw stageFailure('paired-photo provider analysis', `provider used was ${data?.providerName || 'missing'}`);
  if (!data?.modelName) throw stageFailure('paired-photo provider analysis', 'model used was missing');
  return data;
}

async function maybeSingle(table, query) {
  const result = await query.maybeSingle();
  if (result.error) {
    return { table, error: sanitizeError(result.error), row: null };
  }
  return { table, error: null, row: result.data ?? null };
}

async function loadDiagnosticRows() {
  const [request, analysis, jarvis, comparison, assets, progressAssertions] = await Promise.all([
    maybeSingle(
      'pie_vision_analysis_requests',
      service.from('pie_vision_analysis_requests').select('*').eq('id', requestId),
    ),
    maybeSingle(
      'pie_evidence_analyses',
      service.from('pie_evidence_analyses').select('*').eq('id', `${requestId}:analysis`),
    ),
    maybeSingle(
      'pie_visual_jarvis_results',
      service.from('pie_visual_jarvis_results').select('*').eq('id', `${requestId}:jarvis`),
    ),
    maybeSingle(
      'pie_photo_semantic_comparison_results',
      service.from('pie_photo_semantic_comparison_results').select('*').eq('id', `${requestId}:comparison`),
    ),
    service
      .from('pie_photo_assets')
      .select('evidence_id,size_bytes')
      .in('evidence_id', [beforeEvidenceId, afterEvidenceId]),
    service
      .from('pie_photo_progress_events')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('project_id', projectId),
  ]);

  return {
    request,
    analysis,
    jarvis,
    comparison,
    assets: assets.error
      ? { table: 'pie_photo_assets', error: sanitizeError(assets.error), rows: [] }
      : { table: 'pie_photo_assets', error: null, rows: assets.data ?? [] },
    authoritativeProgressAssertionCount: progressAssertions.error ? null : progressAssertions.count ?? 0,
  };
}

function providerHttpStatusFrom(rows) {
  const failureReason = rows.request.row?.failure_reason;
  const match = typeof failureReason === 'string' ? failureReason.match(/provider_http_(\d+)/) : null;
  const rawStatus = rows.analysis.row?.raw_response?.error?.status || rows.comparison.row?.provider_response?.error?.status;
  return match ? Number(match[1]) : rawStatus ?? null;
}

function providerErrorCodeFrom(rows) {
  const failureReason = rows.request.row?.failure_reason;
  const rawCode = rows.analysis.row?.raw_response?.error?.code || rows.comparison.row?.provider_response?.error?.code;
  if (rawCode) return sanitizeText(rawCode);
  if (typeof failureReason === 'string' && failureReason.startsWith('provider_http_')) return 'provider_http_error';
  return failureReason ? sanitizeText(failureReason) : null;
}

function providerSafeMessageFrom(rows) {
  const message =
    rows.analysis.row?.raw_response?.error?.message ||
    rows.comparison.row?.provider_response?.error?.message ||
    rows.request.row?.failure_reason ||
    rows.analysis.row?.raw_response?.failureReason ||
    null;
  return message ? sanitizeText(message) : null;
}

function safeDiagnosticRows(rows) {
  const visualFindings = rows.analysis.row?.visual_findings || {};
  const comparison = rows.comparison.row || {};
  const comparisonMetrics = comparison.deterministic_metrics || {};
  const jarvis = rows.jarvis.row || {};
  const normalizedComparability =
    comparisonMetrics.normalizedComparability ||
    comparison.comparability_classification ||
    visualFindings.comparabilityClassification ||
    null;
  const rawProviderComparability =
    comparisonMetrics.rawProviderComparability ||
    visualFindings.providerComparabilityClassification ||
    null;
  const rawProviderViewpointAssessment =
    comparisonMetrics.rawProviderViewpointAssessment ||
    visualFindings.viewpointAssessment ||
    comparison.viewpoint_assessment ||
    null;
  const normalizationReasons =
    comparisonMetrics.comparabilityNormalizationReasons ||
    visualFindings.comparabilityNormalizationReasons ||
    [];
  const spatialFindings = spatialFindingsFrom(comparison, visualFindings);
  const mouseSpatialFinding = spatialFindings.find(finding => objectText(finding).includes('mouse')) || null;
  const jarvisResult = comparison.jarvis_result || {};
  return {
    pie_vision_analysis_requests: {
      present: Boolean(rows.request.row),
      error: rows.request.error,
      requestStatus: rows.request.row?.status ?? null,
      failureReason: rows.request.row?.failure_reason ? sanitizeText(rows.request.row.failure_reason) : null,
      latencyMs: rows.request.row?.latency_ms ?? null,
      imageByteSizes: rows.assets.rows.map(row => row.size_bytes ?? null),
      transportMode: rows.assets.rows.length > 0 ? 'signed_url' : null,
    },
    pie_evidence_analyses: {
      present: Boolean(rows.analysis.row),
      error: rows.analysis.error,
      requestStatus: rows.analysis.row?.status ?? null,
      providerName: rows.analysis.row?.provider_name ?? null,
      modelName: rows.analysis.row?.model_name ?? null,
      providerHttpStatus: providerHttpStatusFrom(rows),
      providerErrorCode: providerErrorCodeFrom(rows),
      providerSafeErrorMessage: providerSafeMessageFrom(rows),
      latencyMs: rows.request.row?.latency_ms ?? null,
      normalizedConclusion: visualFindings.conclusion ?? null,
      rawProviderComparability,
      rawViewpointAssessment: rawProviderViewpointAssessment,
      normalizedComparability: visualFindings.comparabilityClassification ?? null,
      comparabilityNormalizationReasons: Array.isArray(normalizationReasons)
        ? normalizationReasons.map(reason => sanitizeText(reason))
        : [],
      spatialLocation: safeSpatialDiagnostic(comparison, visualFindings, mouseSpatialFinding),
    },
    pie_visual_jarvis_results: {
      present: Boolean(rows.jarvis.row),
      error: rows.jarvis.error,
      jarvisDisposition: jarvis.outcome ?? null,
      jarvisAccepted: typeof jarvis.accepted === 'boolean' ? jarvis.accepted : null,
      observationDisposition: jarvisResult.observationDisposition ?? null,
      observationAccepted: typeof jarvisResult.observationAccepted === 'boolean' ? jarvisResult.observationAccepted : null,
      observationReasons: Array.isArray(jarvisResult.observationReasons) ? jarvisResult.observationReasons.map(reason => sanitizeText(reason)) : [],
      progressDisposition: jarvisResult.progressDisposition ?? null,
      progressAccepted: typeof jarvisResult.progressAccepted === 'boolean' ? jarvisResult.progressAccepted : null,
      progressReasons: Array.isArray(jarvisResult.progressReasons) ? jarvisResult.progressReasons.map(reason => sanitizeText(reason)) : [],
      realityDisposition: jarvisResult.realityDisposition ?? null,
      realityEligible: typeof jarvisResult.realityEligible === 'boolean' ? jarvisResult.realityEligible : null,
      authorityBoundaryReasons: Array.isArray(jarvisResult.authorityBoundaryReasons) ? jarvisResult.authorityBoundaryReasons.map(reason => sanitizeText(reason)) : [],
      authoritativeProgressAssertionCount: rows.authoritativeProgressAssertionCount,
      jarvisComparability: normalizedComparability,
      jarvisReasons: [
        ...(Array.isArray(jarvis.rejected_claims) ? jarvis.rejected_claims : []),
        ...(Array.isArray(jarvis.warnings) ? jarvis.warnings : []),
        ...(Array.isArray(jarvis.limitations) ? jarvis.limitations : []),
      ].map(reason => sanitizeText(reason)),
    },
    pie_photo_semantic_comparison_results: {
      present: Boolean(rows.comparison.row),
      error: rows.comparison.error,
      normalizedConclusion: comparison.conclusion ?? null,
      rawProviderComparability,
      rawViewpointAssessment: rawProviderViewpointAssessment,
      normalizedComparability,
      persistedComparability: comparison.comparability_classification ?? null,
      comparabilityNormalizationReasons: Array.isArray(normalizationReasons)
        ? normalizationReasons.map(reason => sanitizeText(reason))
        : [],
      providerHttpStatus: providerHttpStatusFrom(rows),
      providerErrorCode: providerErrorCodeFrom(rows),
      providerSafeErrorMessage: providerSafeMessageFrom(rows),
      jarvisDisposition: comparison.jarvis_result?.accepted === true ? 'accepted' : comparison.jarvis_result?.accepted === false ? 'blocked' : null,
      observationDisposition: jarvisResult.observationDisposition ?? null,
      observationAccepted: typeof jarvisResult.observationAccepted === 'boolean' ? jarvisResult.observationAccepted : null,
      observationReasons: Array.isArray(jarvisResult.observationReasons) ? jarvisResult.observationReasons.map(reason => sanitizeText(reason)) : [],
      progressDisposition: jarvisResult.progressDisposition ?? null,
      progressAccepted: typeof jarvisResult.progressAccepted === 'boolean' ? jarvisResult.progressAccepted : null,
      progressReasons: Array.isArray(jarvisResult.progressReasons) ? jarvisResult.progressReasons.map(reason => sanitizeText(reason)) : [],
      realityDisposition: jarvisResult.realityDisposition ?? null,
      realityEligible: typeof jarvisResult.realityEligible === 'boolean' ? jarvisResult.realityEligible : null,
      authorityBoundaryReasons: Array.isArray(jarvisResult.authorityBoundaryReasons) ? jarvisResult.authorityBoundaryReasons.map(reason => sanitizeText(reason)) : [],
      authoritativeProgressAssertionCount: rows.authoritativeProgressAssertionCount,
      jarvisReasons: Array.isArray(comparison.jarvis_result?.rejectedClaims)
        ? comparison.jarvis_result.rejectedClaims.map(reason => sanitizeText(reason))
        : [],
      spatialLocation: safeSpatialDiagnostic(comparison, visualFindings, mouseSpatialFinding),
    },
  };
}

async function printPersistedRequestDiagnostics(label) {
  const rows = await loadDiagnosticRows();
  console.error(label, JSON.stringify(sanitizeValue(safeDiagnosticRows(rows)), null, 2));
}

async function loadPersistence() {
  const [requestResult, analysisResult, jarvisResult, comparisonResult] = await Promise.all([
    service.from('pie_vision_analysis_requests').select('*').eq('id', requestId).maybeSingle(),
    service.from('pie_evidence_analyses').select('*').eq('id', `${requestId}:analysis`).maybeSingle(),
    service.from('pie_visual_jarvis_results').select('*').eq('id', `${requestId}:jarvis`).maybeSingle(),
    service.from('pie_photo_semantic_comparison_results').select('*').eq('id', `${requestId}:comparison`).maybeSingle(),
  ]);
  for (const [label, result] of [
    ['analysis request', requestResult],
    ['evidence analysis', analysisResult],
    ['JARVIS result', jarvisResult],
    ['semantic comparison', comparisonResult],
  ]) {
    if (result.error || !result.data) throw stageFailure('persistence', `load persisted ${label}: ${sanitizeError(result.error || new Error('missing row'))}`);
  }
  return {
    request: requestResult.data,
    analysis: analysisResult.data,
    jarvis: jarvisResult.data,
    comparison: comparisonResult.data,
  };
}

function flatten(value) {
  return JSON.stringify(value ?? '').toLowerCase();
}

function spatialFindingsFrom(comparison, findings) {
  const metrics = comparison?.deterministic_metrics || {};
  const candidates = [
    metrics.normalizedSpatialFindings,
    comparison?.jarvis_result?.normalizedSpatialFindings,
    findings?.normalizedSpatialFindings,
    comparison?.object_additions,
  ];
  for (const value of candidates) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return [];
}

function objectText(finding) {
  return flatten([
    finding?.normalizedObjectName,
    finding?.rawObjectDescription,
    finding?.object,
    finding?.name,
    finding?.description,
  ]);
}

function locationText(finding) {
  return flatten([
    finding?.rawLocationText,
    finding?.location,
    finding?.region,
    finding?.area,
    finding?.position,
    finding?.approximateRegion,
    finding?.description,
  ]);
}

function normalizedMouseSpatialFinding(comparison, findings) {
  return spatialFindingsFrom(comparison, findings).find(finding => objectText(finding).includes('mouse')) || null;
}

function hasAcceptedMouseLocation(finding) {
  if (!finding) return false;
  const horizontal = finding.imageHorizontalRegion;
  const subjectRelative = finding.subjectRelativeRegion;
  const surface = finding.surfaceOrArea;
  const confidence = finding.locationConfidence;
  const text = locationText(finding);
  const rightSide =
    horizontal === 'right' ||
    subjectRelative === 'right_of_subject' ||
    (subjectRelative === 'beside_subject' && text.includes('right')) ||
    text.includes('right side') ||
    text.includes('right edge') ||
    text.includes('right-hand') ||
    text.includes('lower-right') ||
    text.includes('lower right') ||
    text.includes('bottom right') ||
    text.includes('front-right') ||
    text.includes('front right') ||
    text.includes('foreground right') ||
    text.includes('to the right');
  const validSurface =
    surface === 'table' ||
    surface === 'desk' ||
    text.includes('table') ||
    text.includes('desk') ||
    text.includes('tabletop') ||
    text.includes('desktop');
  const wrongSide = horizontal === 'left' || text.includes('left side') || text.includes('left edge') || text.includes('lower left');
  const wrongSurface = ['floor', 'wall', 'structure'].includes(surface);
  return rightSide && validSurface && confidence !== 'low' && !wrongSide && !wrongSurface;
}

function safeSpatialDiagnostic(comparison, findings, mouseFinding) {
  return sanitizeValue({
    rawProviderObjectAdditionDescription: mouseFinding?.rawObjectDescription || null,
    rawProviderLocationText: mouseFinding?.rawLocationText || null,
    normalizedObjectName: mouseFinding?.normalizedObjectName || null,
    normalizedSpatialRegion: mouseFinding
      ? {
          imageHorizontalRegion: mouseFinding.imageHorizontalRegion || null,
          imageVerticalRegion: mouseFinding.imageVerticalRegion || null,
          subjectRelativeRegion: mouseFinding.subjectRelativeRegion || null,
          surfaceOrArea: mouseFinding.surfaceOrArea || null,
          locationConfidence: mouseFinding.locationConfidence || null,
        }
      : null,
    spatialNormalizationReasons: Array.isArray(mouseFinding?.normalizationReasons)
      ? mouseFinding.normalizationReasons
      : [],
    valueUsedByJarvis: comparison?.jarvis_result?.normalizedSpatialFindings || comparison?.jarvis_result || null,
    valueUsedByLiveAcceptanceHarness: mouseFinding || null,
    allNormalizedSpatialFindings: spatialFindingsFrom(comparison, findings),
  });
}

function validateAcceptance(invokeResult, persisted) {
  const comparison = persisted.comparison;
  const findings = persisted.analysis.visual_findings || {};
  const comparisonMetrics = comparison.deterministic_metrics || {};
  const normalizedComparability =
    comparisonMetrics.normalizedComparability ||
    comparison.comparability_classification ||
    findings.comparabilityClassification;
  const rawProviderComparability =
    comparisonMetrics.rawProviderComparability ||
    findings.providerComparabilityClassification ||
    null;
  const normalizationReasons =
    comparisonMetrics.comparabilityNormalizationReasons ||
    findings.comparabilityNormalizationReasons ||
    [];
  const jarvisDecision = comparison.jarvis_result || {};
  const predicateDiagnostics = {};
  const combined = flatten({ comparison, findings });
  console.log('COMPARABILITY_PATH_DIAGNOSTICS', JSON.stringify(sanitizeValue({
    rawProviderComparability,
    rawViewpointAssessment: comparisonMetrics.rawProviderViewpointAssessment || findings.viewpointAssessment || comparison.viewpoint_assessment,
    normalizedComparability,
    normalizationReasons,
    persistedComparability: comparison.comparability_classification,
    jarvisComparability: comparison.jarvis_result?.comparabilityClassification || normalizedComparability,
  }), null, 2));
  const mouseSpatialFinding = normalizedMouseSpatialFinding(comparison, findings);
  console.log('SPATIAL_LOCATION_PATH_DIAGNOSTICS', JSON.stringify(
    safeSpatialDiagnostic(comparison, findings, mouseSpatialFinding),
    null,
  ));
  console.log('JARVIS_AUTHORITY_PATH_DIAGNOSTICS', JSON.stringify(sanitizeValue({
    observationDisposition: jarvisDecision.observationDisposition || null,
    observationAccepted: typeof jarvisDecision.observationAccepted === 'boolean' ? jarvisDecision.observationAccepted : null,
    observationReasons: Array.isArray(jarvisDecision.observationReasons) ? jarvisDecision.observationReasons : [],
    progressDisposition: jarvisDecision.progressDisposition || null,
    progressAccepted: typeof jarvisDecision.progressAccepted === 'boolean' ? jarvisDecision.progressAccepted : null,
    progressReasons: Array.isArray(jarvisDecision.progressReasons) ? jarvisDecision.progressReasons : [],
    realityDisposition: jarvisDecision.realityDisposition || null,
    realityEligible: typeof jarvisDecision.realityEligible === 'boolean' ? jarvisDecision.realityEligible : null,
    authorityBoundaryReasons: Array.isArray(jarvisDecision.authorityBoundaryReasons) ? jarvisDecision.authorityBoundaryReasons : [],
    authoritativeProgressAssertionCount: Number(jarvisDecision.authoritativeProgressAssertionCount || 0),
  }), null, 2));
  const requirePredicate = (name, passed, message) => {
    predicateDiagnostics[name] = { passed, message: passed ? null : message };
    if (!passed) {
      console.error('JARVIS_ACCEPTANCE_PREDICATE_DIAGNOSTICS', JSON.stringify(sanitizeValue(predicateDiagnostics), null, 2));
      throw stageFailure('JARVIS validation', message);
    }
  };
  requirePredicate('comparabilityAccepted', ['strong', 'probable'].includes(normalizedComparability), `comparability expected strong or probable, got ${normalizedComparability || 'missing'}`);
  requirePredicate('persistedComparabilityMatchesNormalized', comparison.comparability_classification === normalizedComparability, `persisted comparability ${comparison.comparability_classification} did not match normalized comparability ${normalizedComparability}`);
  requirePredicate('sameSceneAdequate', Number(comparison.same_scene_probability) >= 0.5, `same scene probability too low: ${comparison.same_scene_probability}`);
  requirePredicate('blackMouseIdentified', combined.includes('black') && combined.includes('mouse'), 'provider did not identify black computer mouse');
  requirePredicate('semanticLocationAccepted', hasAcceptedMouseLocation(mouseSpatialFinding), 'provider did not identify a semantically valid right-side table/desk mouse location');
  requirePredicate(
    'viewpointLimitationAcknowledged',
    combined.includes('viewpoint') && (combined.includes('slight') || combined.includes('changed') || combined.includes('different') || combined.includes('framing')),
    'provider did not identify slightly changed viewpoint/framing',
  );
  requirePredicate('objectAdditionsContainMouse', flatten(comparison.object_additions).includes('mouse'), 'object_additions does not contain mouse');
  requirePredicate(
    'projectProgressConclusionNonProgress',
    ['unable_to_determine', 'no_material_visible_change'].includes(comparison.conclusion),
    `project progress conclusion expected unable_to_determine or no_material_visible_change, got ${comparison.conclusion}`,
  );
  requirePredicate('persistedJarvisObservationAccepted', persisted.jarvis.accepted === true, 'JARVIS did not accept the limited visual observation');
  requirePredicate('observationAccepted', jarvisDecision.observationAccepted === true, 'observationAccepted expected true');
  requirePredicate(
    'observationDispositionAccepted',
    ['accepted', 'accepted_with_limitations'].includes(jarvisDecision.observationDisposition),
    `observationDisposition expected accepted or accepted_with_limitations, got ${jarvisDecision.observationDisposition || 'missing'}`,
  );
  requirePredicate('progressNotAccepted', jarvisDecision.progressAccepted === false, 'progressAccepted expected false for mouse visible observation');
  requirePredicate(
    'progressDispositionNonProgress',
    ['unable_to_determine', 'unsupported'].includes(jarvisDecision.progressDisposition),
    `progressDisposition expected unable_to_determine or unsupported, got ${jarvisDecision.progressDisposition || 'missing'}`,
  );
  requirePredicate(
    'realityEligibleAsObservation',
    jarvisDecision.realityEligible === true && jarvisDecision.realityDisposition === 'eligible_as_observation',
    'Reality eligibility must be limited to visual observation',
  );
  requirePredicate(
    'zeroAuthoritativeProgressAssertions',
    Number(jarvisDecision.authoritativeProgressAssertionCount || 0) === 0,
    'authoritative progress assertion was created for mouse observation',
  );
  requirePredicate('noProgressVisibleClaimPersisted', !flatten(persisted.jarvis).includes('progress_visible'), 'JARVIS/persisted result classified the mouse as project progress');
  requirePredicate('requestSucceeded', persisted.request.status === 'succeeded', `persisted request status expected succeeded, got ${persisted.request.status}`);
  requirePredicate('invokeJarvisAccepted', invokeResult.jarvis?.accepted === true, 'invoke JARVIS result was not accepted');
  return {
    providerUsed: invokeResult.providerName,
    modelUsed: invokeResult.modelName,
    requestStatus: invokeResult.status,
    analysisLatencyMs: invokeResult.latencyMs,
    normalizedFindings: {
      sameSceneProbability: comparison.same_scene_probability,
      sameSubjectProbability: comparison.same_subject_probability,
      viewpointAssessment: comparison.viewpoint_assessment,
      objectAdditions: comparison.object_additions,
      materialOrStructuralChanges: comparison.material_or_structural_changes,
      comparability: normalizedComparability,
      conclusion: comparison.conclusion,
      confidence: comparison.confidence,
      limitations: comparison.limitations,
    },
    jarvisResult: {
      accepted: persisted.jarvis.accepted,
      outcome: persisted.jarvis.outcome,
      observationDisposition: jarvisDecision.observationDisposition,
      observationAccepted: jarvisDecision.observationAccepted,
      progressDisposition: jarvisDecision.progressDisposition,
      progressAccepted: jarvisDecision.progressAccepted,
      realityDisposition: jarvisDecision.realityDisposition,
      realityEligible: jarvisDecision.realityEligible,
      rejectedClaims: persisted.jarvis.rejected_claims,
      limitations: persisted.jarvis.limitations,
    },
    persistenceResult: {
      requestId,
      analysisId: persisted.analysis.id,
      jarvisId: persisted.jarvis.id,
      comparisonId: persisted.comparison.id,
    },
  };
}

async function deleteRows(table, column, value) {
  const result = await service.from(table).delete().eq(column, value).select(column);
  if (result.error) {
    cleanupSummary.failed.push({ table, reason: sanitizeError(result.error) });
    return;
  }
  cleanupSummary.rowsDeleted.push({ table, count: Array.isArray(result.data) ? result.data.length : 0 });
}

async function cleanup() {
  const removed = await service.storage.from(bucket).remove([beforeStoragePath, afterStoragePath]);
  if (removed.error) cleanupSummary.failed.push({ table: 'storage.objects', reason: sanitizeError(removed.error) });
  else cleanupSummary.storageDeleted = Array.isArray(removed.data) ? removed.data.length : 0;

  await deleteRows('pie_photo_semantic_comparison_results', 'request_id', requestId);
  await deleteRows('pie_visual_jarvis_results', 'id', `${requestId}:jarvis`);
  await deleteRows('pie_evidence_analyses', 'id', `${requestId}:analysis`);
  await deleteRows('pie_vision_analysis_requests', 'id', requestId);
  await deleteRows('pie_photo_assets', 'organization_id', organizationId);
  await deleteRows('pie_evidence_records', 'organization_id', organizationId);
  await deleteRows('organization_memberships', 'organization_id', organizationId);
  if (state.projectRecordId) {
    await deleteRows('projects', 'id', state.projectRecordId);
  } else {
    await deleteRows('projects', 'name', state.projectName);
  }
  await deleteRows('organizations', 'id', organizationId);

  if (state.userId) {
    const result = await service.auth.admin.deleteUser(state.userId);
    if (result.error) cleanupSummary.failed.push({ table: 'auth.users', reason: sanitizeError(result.error) });
    else cleanupSummary.rowsDeleted.push({ table: 'auth.users', count: 1 });
  }
}

async function main() {
  let finalReport = null;
  try {
    const before = readFixture(beforePath, expectedBeforeHash);
    const after = readFixture(afterPath, expectedAfterHash);
    assert(before.hash !== after.hash, 'before and after fixture hashes must differ');

    const userClient = await setup(before, after);
    const config = await configCheck(userClient);
    const invokeResult = await invokeVision(userClient);
    const persisted = await loadPersistence();
    finalReport = validateAcceptance(invokeResult, persisted);

    console.log('Provider used:', finalReport.providerUsed);
    console.log('Model used:', finalReport.modelUsed);
    console.log('Request status:', finalReport.requestStatus);
    console.log('Analysis latency ms:', finalReport.analysisLatencyMs);
    console.log('Config check:', JSON.stringify({
      PIE_VISION_PROVIDER: config.secrets.PIE_VISION_PROVIDER,
      PIE_OPENAI_API_KEY: config.secrets.PIE_OPENAI_API_KEY,
      PIE_OPENAI_VISION_MODEL: config.secrets.PIE_OPENAI_VISION_MODEL,
      PIE_VISION_TIMEOUT_MS: config.secrets.PIE_VISION_TIMEOUT_MS,
      PIE_VISION_MAX_RETRIES: config.secrets.PIE_VISION_MAX_RETRIES,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
    }));
    console.log('Normalized findings:', JSON.stringify(finalReport.normalizedFindings, null, 2));
    console.log('JARVIS result:', JSON.stringify(finalReport.jarvisResult, null, 2));
    console.log('Persistence result:', JSON.stringify(finalReport.persistenceResult, null, 2));
    console.log('Required user-facing statement: A black computer mouse appears in the newer photo. The viewpoint also changed slightly. This is a visible scene change, but it does not establish project progress.');
  } finally {
    await cleanup();
    console.log('Cleanup result:', JSON.stringify(cleanupSummary, null, 2));
  }

  if (cleanupSummary.failed.length > 0) {
    throw new Error('cleanup did not fully complete');
  }
  console.log('PASS live provider mouse acceptance');
}

main().catch(error => {
  console.error(`FAIL live provider mouse acceptance: ${sanitizeError(error)}`);
  process.exit(1);
});
