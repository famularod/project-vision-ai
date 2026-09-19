#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const {
  evaluateAcceptanceCase,
  normalizeAssuredShadowPageRow,
} = require('./ecos-ask-live-acceptance-lib');

const ROOT = path.resolve(__dirname, '..');
const MATRIX_PATH = path.join(
  ROOT,
  'validation',
  'ecos',
  'ask-ecos-end-user-reliability-matrix.json',
);
const OUTPUT_PATH = text(process.env.ECOS_PRIVATE_VALIDATION_OUTPUT)
  ? path.resolve(ROOT, text(process.env.ECOS_PRIVATE_VALIDATION_OUTPUT))
  : path.join(
    ROOT,
    'validation',
    'output',
    'ecos-v2-private-end-user-validation.json',
  );
const FUNCTION_SLUG = 'ecos-ask-project-candidate';
const QUESTION_DELAY_MS = boundedInteger(
  process.env.ECOS_PRIVATE_QUESTION_DELAY_MS,
  10_000,
  60_000,
  10_000,
);
const REQUEST_TIMEOUT_MS = 90_000;
const MAXIMUM_REQUEST_ATTEMPTS = 2;
const PRIVATE_QUESTION_HOURLY_LIMIT = 60;

async function main() {
  const supabaseUrl = required('SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = required('SUPABASE_ANON_KEY');
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const serviceWorkerToken = required('ECOS_SERVICE_WORKER_TOKEN');
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const attempts = loadAttempts();
  const projects = await loadExactProjects(admin, attempts);
  await assertPrivateQuestionCapacity({
    admin,
    ownerId: projects.ownerId,
    requiredSlots: attempts.length,
  });
  const session = await createOwnerSession({
    admin,
    anonKey,
    ownerId: projects.ownerId,
    supabaseUrl,
  });
  const startedAt = new Date().toISOString();
  const results = [];
  let revocationVerified = false;
  let runError = null;

  try {
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      const project = projects.byName.get(attempt.projectName);
      if (!project) throw new Error('private_validation_project_missing');
      const requestStartedAt = Date.now();
      const response = await askCandidate({
        supabaseUrl,
        anonKey,
        accessToken: session.accessToken,
        serviceWorkerToken,
        project,
        question: attempt.question,
      });
      const latencyMs = Date.now() - requestStartedAt;
      const pageRows = await loadCitationPageRows(admin, response);
      const evaluated = evaluateAcceptanceCase(
        { ...attempt.canonicalCase, id: attempt.id, question: attempt.question },
        response,
        { projectName: project.name, pageRows },
      );
      const diagnostics = record(response.diagnostics);
      const failures = [
        ...evaluated.failures,
        ...(response.validationMode === 'shadow'
          ? []
          : ['Response did not identify protected shadow validation mode.']),
        ...(latencyMs <= 60_000
          ? []
          : [`Latency ${latencyMs} ms exceeded the 60-second beta ceiling.`]),
      ];
      const passed = failures.length === 0;
      results.push({
        id: attempt.id,
        familyId: attempt.familyId,
        projectName: attempt.projectName,
        questionSha256: sha256(attempt.question),
        answerSha256: sha256(text(response.answer)),
        passed,
        failures,
        latencyMs,
        assuranceStatus: text(response.assurance?.status),
        verifiedFactCount: Number(response.assurance?.verifiedFactCount) || 0,
        citationCount: evaluated.citations.length,
        traceId: text(diagnostics.traceId),
        clientRequestId: text(diagnostics.clientRequestId),
        evidenceSnapshotId: text(diagnostics.evidenceSnapshotId),
        evidenceDossierId: text(diagnostics.evidenceDossierId),
        evidenceSnapshotSha256: text(diagnostics.evidenceSnapshotSha256),
        evidenceDossierSha256: text(diagnostics.evidenceDossierSha256),
        persisted: diagnostics.persisted === true,
        replayed: diagnostics.replayed === true,
      });
      console.log(
        `[${index + 1}/${attempts.length}] ${passed ? 'PASS' : 'FAIL'} ` +
          `${attempt.familyId} ${latencyMs}ms`,
      );
      failures.forEach((failure) => console.log(`- ${failure}`));
      if (index < attempts.length - 1) await wait(QUESTION_DELAY_MS);
    }
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
  } finally {
    revocationVerified = await revokeOwnerSession({ admin, session });
  }

  const traceIds = results.map((item) => item.traceId).filter(Boolean);
  const dossierIds = results.map((item) => item.evidenceDossierId).filter(Boolean);
  const latencies = results.map((item) => item.latencyMs).sort((a, b) => a - b);
  const integrityFailures = [
    ...(results.length === attempts.length ? [] : ['Not every matrix question completed.']),
    ...(new Set(traceIds).size === attempts.length ? [] : ['Trace identities were not unique and complete.']),
    ...(new Set(dossierIds).size === attempts.length ? [] : ['Dossier identities were not unique and complete.']),
    ...(results.every((item) => item.persisted) ? [] : ['One or more private traces were not persisted.']),
    ...(revocationVerified ? [] : ['Temporary owner session revocation was not verified.']),
    ...(runError ? [`Run stopped safely: ${runError}`] : []),
  ];
  const passedCount = results.filter((item) => item.passed).length;
  const receipt = {
    schemaVersion: 'ecos-v2-private-end-user-validation/1.0',
    validationMode: 'shadow',
    functionSlug: FUNCTION_SLUG,
    retrievalContract: 'ecos-evidence-retrieval/2.3',
    matrixSha256: sha256(fs.readFileSync(MATRIX_PATH)),
    startedAt,
    completedAt: new Date().toISOString(),
    questionDelayMs: QUESTION_DELAY_MS,
    summary: {
      total: attempts.length,
      passed: passedCount,
      failed: attempts.length - passedCount,
      p95LatencyMs: percentile(latencies, 0.95),
      maximumLatencyMs: latencies.at(-1) || 0,
      uniqueTraceCount: new Set(traceIds).size,
      uniqueDossierCount: new Set(dossierIds).size,
      integrityFailures,
      sessionRevocationVerified: revocationVerified,
    },
    results,
  };
  atomicWrite(OUTPUT_PATH, receipt);
  const receiptSha256 = sha256(fs.readFileSync(OUTPUT_PATH));
  console.log(JSON.stringify({
    output: path.relative(ROOT, OUTPUT_PATH),
    receiptSha256,
    summary: receipt.summary,
  }, null, 2));
  if (passedCount !== attempts.length || integrityFailures.length > 0) {
    process.exitCode = 1;
  }
}

async function assertPrivateQuestionCapacity({ admin, ownerId, requiredSlots }) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('dave_ai_operation_requests')
    .select('started_at')
    .eq('owner_id', ownerId)
    .eq('operation_type', 'project_question')
    .gt('started_at', since)
    .order('started_at', { ascending: true });
  if (error) throw error;
  const rows = data || [];
  const availableSlots = Math.max(
    0,
    PRIVATE_QUESTION_HOURLY_LIMIT - rows.length,
  );
  if (availableSlots >= requiredSlots) return;
  const slotsThatMustClear = requiredSlots - availableSlots;
  const clearanceRow = rows[slotsThatMustClear - 1];
  const clearanceTime = Date.parse(clearanceRow?.started_at || '') +
    60 * 60 * 1000 + 2_000;
  const fullWindowAt = Number.isFinite(clearanceTime)
    ? new Date(clearanceTime).toISOString()
    : 'unknown';
  throw new Error(
    `private_validation_capacity_insufficient:${availableSlots}/${requiredSlots}:full_window_at_${fullWindowAt}`,
  );
}

function loadAttempts() {
  const matrix = readJson(MATRIX_PATH);
  const familyFilter = text(process.env.ECOS_PRIVATE_FAMILY_FILTER);
  const canonicalCases = new Map();
  for (const relativePath of matrix.canonicalSuites || []) {
    const suite = readJson(path.join(ROOT, relativePath));
    for (const testCase of suite.cases || []) {
      canonicalCases.set(`${suite.projectName}::${testCase.id}`, testCase);
    }
  }
  return (matrix.families || []).flatMap((family) => {
    if (familyFilter && text(family.id) !== familyFilter) return [];
    const canonicalCase = canonicalCases.get(
      `${family.projectName}::${family.canonicalCaseId}`,
    );
    if (!canonicalCase) throw new Error('private_validation_canonical_case_missing');
    return (family.variants || []).map((question, index) => ({
      id: `${family.id}-variant-${index + 1}`,
      familyId: family.id,
      projectName: family.projectName,
      question,
      canonicalCase,
    }));
  });
}

async function loadExactProjects(admin, attempts) {
  const names = [...new Set(attempts.map((attempt) => attempt.projectName))];
  const { data, error } = await admin
    .from('projects')
    .select('id,name,owner_id')
    .eq('archived', false)
    .in('name', names);
  if (error) throw error;
  const rows = (data || []).filter((row) => names.includes(text(row.name)));
  if (rows.length !== names.length) throw new Error('private_validation_exact_projects_missing');
  if (names.some((name) => rows.filter((row) => text(row.name) === name).length !== 1)) {
    throw new Error('private_validation_project_identity_ambiguous');
  }
  const ownerIds = [...new Set(rows.map((row) => text(row.owner_id)).filter(Boolean))];
  if (ownerIds.length !== 1) throw new Error('private_validation_owner_identity_ambiguous');
  return {
    ownerId: ownerIds[0],
    byName: new Map(rows.map((row) => [text(row.name), { id: text(row.id), name: text(row.name) }])),
  };
}

async function createOwnerSession({ admin, anonKey, ownerId, supabaseUrl }) {
  const user = await admin.auth.admin.getUserById(ownerId);
  const email = text(user.data?.user?.email);
  if (user.error || !email) throw new Error('private_validation_owner_user_missing');
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = text(link.data?.properties?.hashed_token);
  if (link.error || !tokenHash) throw new Error('private_validation_owner_link_failed');
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  const accessToken = text(verified.data?.session?.access_token);
  if (verified.error || !accessToken) throw new Error('private_validation_owner_session_failed');
  return { accessToken, client };
}

async function revokeOwnerSession({ admin, session }) {
  const revoked = await admin.auth.admin.signOut(session.accessToken, 'local');
  if (revoked.error) return false;
  const verification = await session.client.auth.getUser(session.accessToken);
  return Boolean(verification.error || !verification.data?.user);
}

async function askCandidate({
  supabaseUrl,
  anonKey,
  accessToken,
  serviceWorkerToken,
  project,
  question,
}) {
  const clientRequestId = crypto.randomUUID();
  let lastError = null;
  for (let attempt = 1; attempt <= MAXIMUM_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(
        `${supabaseUrl}/functions/v1/${FUNCTION_SLUG}`,
        {
          method: 'POST',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'x-ecos-worker-token': serviceWorkerToken,
          },
          body: JSON.stringify({
            schemaVersion: 'ecos-project-question/2.0',
            clientRequestId,
            clientSurface: 'web',
            projectId: project.id,
            projectName: project.name,
            question,
            validationMode: 'shadow',
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      const body = await response.json().catch(() => null);
      if (response.ok) return body;
      const code = text(body?.error) || `http_${response.status}`;
      const retryable = response.status === 409 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAXIMUM_REQUEST_ATTEMPTS) {
        throw new Error(`Candidate returned ${response.status} (${code}).`);
      }
      await wait(Math.min(60, Math.max(2, Number(body?.retryAfterSeconds) || 5)) * 1_000);
    } catch (error) {
      lastError = error;
      if (attempt === MAXIMUM_REQUEST_ATTEMPTS) throw error;
      await wait(attempt * 2_000);
    }
  }
  throw lastError || new Error('private_validation_request_failed');
}

async function loadCitationPageRows(admin, response) {
  const citations = (response.supportingEvidence || [])
    .map((item) => record(item.documentCitation))
    .filter((item) => text(item.documentId) && positiveInteger(item.pageNumber));
  const documentIds = [...new Set(citations.map((item) => text(item.documentId)))];
  const pageNumbers = [...new Set(citations.map((item) => positiveInteger(item.pageNumber)))];
  if (documentIds.length === 0 || pageNumbers.length === 0) return [];
  const result = await admin.rpc('ecos_load_hosted_shadow_page_context_v21', {
    p_document_ids: documentIds,
    p_page_numbers: pageNumbers,
    p_result_limit: 100,
  });
  if (result.error) throw result.error;
  return (result.data || []).flatMap((page) =>
    normalizeAssuredShadowPageRow({
      ...page,
      state: 'assured',
      unresolved_region_count: 0,
    })
  );
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  return values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function required(name) {
  const value = text(process.env[name]);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
