#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const {
  LIVE_RESULT_SCHEMA_VERSION,
  acceptanceContractHash,
  evaluateAcceptanceCase,
  loadAcceptanceDefinition,
  normalizeAssuredShadowPageRow,
  pageRowHasCompleteVisualCoverage,
  repoRoot,
  resultPath,
} = require('./ecos-ask-live-acceptance-lib');

const DEFAULT_CASE_DELAY_MS = 1_500;
const MAXIMUM_REQUEST_ATTEMPTS = 2;

async function main() {
  loadLocalEnvironment();
  const definition = loadAcceptanceDefinition();
  const contractHash = acceptanceContractHash();
  const supabaseUrl = requiredEnvironment('EXPO_PUBLIC_SUPABASE_URL');
  const anonKey = requiredEnvironment('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const shadowValidation = String(process.env.ECOS_LIVE_SHADOW_VALIDATION || '').trim().toLowerCase() === 'true';
  const clientSurface = liveClientSurface();
  const hostedReadiness = shadowValidation ||
    String(process.env.ECOS_LIVE_HOSTED_READINESS || 'true').trim().toLowerCase() !== 'false';
  const serviceRoleKey = hostedReadiness ? requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY') : '';
  const serviceWorkerToken = shadowValidation ? requiredEnvironment('ECOS_SERVICE_WORKER_TOKEN') : '';
  const auth = await authenticate({ supabaseUrl, anonKey });
  const client = createAuthenticatedClient({ supabaseUrl, anonKey, accessToken: auth.accessToken });
  const shadowClient = hostedReadiness
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  const project = await resolveProject(client, definition.projectName);
  const readiness = await loadDocumentReadiness({
    client,
    shadowClient,
    shadowValidation,
    hostedReadiness,
    project,
    definition,
  });
  const startedAt = new Date().toISOString();

  console.log('Ask ECOS real-world production acceptance');
  console.log(`Project: ${project.name}`);
  console.log(`Cases: ${definition.cases.length}; required pass rate: 100%`);
  console.log(`Evidence mode: ${shadowValidation ? 'protected hosted shadow' : 'customer-visible production'}`);
  console.log(`Drawing readiness: ${readiness.passed ? 'PASS' : 'FAIL'}`);
  readiness.failures.forEach(failure => console.log(`- ${failure}`));

  const caseResults = [];
  if (readiness.passed) {
    for (let index = 0; index < definition.cases.length; index += 1) {
      const testCase = definition.cases[index];
      console.log(`\n[${index + 1}/${definition.cases.length}] ${testCase.question}`);
      try {
        const response = await askProductionECOS({
          client,
          accessToken: auth.accessToken,
          project,
          question: testCase.question,
          shadowValidation,
          serviceWorkerToken,
          clientSurface,
        });
        const evaluation = evaluateAcceptanceCase(testCase, response, {
          projectName: project.name,
          pageRows: readiness.pageRows,
        });
        caseResults.push(evaluation);
        console.log(`${evaluation.passed ? 'PASS' : 'FAIL'}: ${evaluation.answer}`);
        evaluation.failures.forEach(failure => console.log(`- ${failure}`));
      } catch (error) {
        const message = safeErrorMessage(error);
        caseResults.push({
          id: testCase.id,
          question: testCase.question,
          passed: false,
          failures: [message],
          answer: '',
          assuranceStatus: '',
          confidence: '',
          model: '',
          generatedAt: '',
          citations: [],
        });
        console.log(`FAIL: ${message}`);
      }
      if (index < definition.cases.length - 1) await wait(caseDelayMs());
    }
  } else {
    definition.cases.forEach(testCase => caseResults.push({
      id: testCase.id,
      question: testCase.question,
      passed: false,
      failures: ['Required drawing pages are not ready for a reliable production answer test.'],
      answer: '',
      assuranceStatus: '',
      confidence: '',
      model: '',
      generatedAt: '',
      citations: [],
    }));
  }

  const passed = caseResults.filter(item => item.passed).length;
  const failed = caseResults.length - passed;
  const result = {
    schemaVersion: LIVE_RESULT_SCHEMA_VERSION,
    definitionSchemaVersion: definition.schemaVersion,
    acceptanceContractSha256: contractHash,
    startedAt,
    completedAt: new Date().toISOString(),
    productionHost: new URL(supabaseUrl).host,
    projectId: project.id,
    projectName: project.name,
    authenticatedUserId: auth.userId,
    indexMode: shadowValidation ? 'shadow' : 'live',
    executionBoundary: {
      mode: shadowValidation ? 'diagnostic_shadow' : 'customer_transport_diagnostic',
      functionSlug: 'ecos-ask-project',
      requestTransport: 'supabase_functions_invoke',
      invocationMode: 'transport_equivalent_cli',
      authentication: 'signed_in_user',
      publicationMode: shadowValidation ? 'shadow' : 'live',
      validationMode: shadowValidation ? 'shadow' : null,
      serviceWorkerTokenUsed: shadowValidation,
      clientSurface,
      appInvocationBoundary: null,
    },
    documentReadiness: {
      passed: readiness.passed,
      failures: readiness.failures,
      checkedDocuments: readiness.checkedDocuments,
      checkedPages: readiness.checkedPages,
    },
    summary: {
      total: caseResults.length,
      passed,
      failed,
      passRate: caseResults.length > 0 ? passed / caseResults.length : 0,
    },
    cases: caseResults,
  };
  writeResult(result);

  console.log('\nAsk ECOS production acceptance summary');
  console.log(`PASS ${passed}/${caseResults.length}`);
  console.log(`FAIL ${failed}/${caseResults.length}`);
  console.log(`Evidence: ${path.relative(repoRoot, resultPath)}`);
  if (!readiness.passed || failed > 0 || passed < definition.minimumPassingCases) process.exitCode = 1;
}

function loadLocalEnvironment() {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] != null) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    process.env[match[1]] = value;
  }
}

async function authenticate({ supabaseUrl, anonKey }) {
  const accessToken = String(process.env.ECOS_LIVE_ACCESS_TOKEN || '').trim()
    || await receiveAccessTokenFromLocalBrowser();
  if (accessToken) {
    const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data, error } = await client.auth.getUser(accessToken);
    if (error || !data.user) throw new Error('ECOS_LIVE_ACCESS_TOKEN is invalid or expired.');
    return { accessToken, userId: data.user.id };
  }

  const email = String(process.env.ECOS_LIVE_TEST_EMAIL || '').trim();
  const password = String(process.env.ECOS_LIVE_TEST_PASSWORD || '');
  if (!email || !password) {
    throw new Error(
      'Live authentication is required. Set ECOS_LIVE_ACCESS_TOKEN, or set both ECOS_LIVE_TEST_EMAIL and ECOS_LIVE_TEST_PASSWORD. Credentials are never written to the result file.',
    );
  }
  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token || !data.user) {
    throw new Error(`Live sign-in failed: ${safeErrorMessage(error || new Error('No session returned.'))}`);
  }
  return { accessToken: data.session.access_token, userId: data.user.id };
}

async function receiveAccessTokenFromLocalBrowser() {
  if (String(process.env.ECOS_LIVE_BROWSER_AUTH || '').trim().toLowerCase() !== 'true') return '';
  const allowedOrigin = String(process.env.ECOS_LIVE_BROWSER_ORIGIN || 'http://localhost:8097')
    .trim()
    .replace(/\/$/, '');
  if (!/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(allowedOrigin)) {
    throw new Error('ECOS_LIVE_BROWSER_ORIGIN must be an explicit localhost HTTP origin.');
  }
  const nonce = crypto.randomBytes(32).toString('hex');
  const timeoutMs = Math.max(30_000, Math.min(300_000, Number(process.env.ECOS_LIVE_BROWSER_AUTH_TIMEOUT_MS) || 120_000));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, token = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close(() => error ? reject(error) : resolve(token));
    };
    const server = http.createServer((request, response) => {
      const origin = String(request.headers.origin || '').replace(/\/$/, '');
      const corsAllowed = origin === allowedOrigin;
      if (corsAllowed) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      }
      if (request.method === 'OPTIONS') {
        response.statusCode = corsAllowed ? 204 : 403;
        response.end();
        return;
      }
      if (!corsAllowed || request.method !== 'POST' || request.url !== '/authorize') {
        response.statusCode = 403;
        response.end('Forbidden');
        return;
      }
      const chunks = [];
      let bytes = 0;
      request.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 2_048) request.destroy();
        else chunks.push(chunk);
      });
      request.on('end', () => {
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          response.statusCode = 400;
          response.end('Invalid request');
          return;
        }
        const authorization = String(request.headers.authorization || '');
        const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
        if (body?.nonce !== nonce || token.length < 40) {
          response.statusCode = 403;
          response.end('Authorization rejected');
          return;
        }
        response.statusCode = 204;
        response.end();
        finish(null, token);
      });
      request.on('error', error => finish(error));
    });
    server.on('error', error => finish(error));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        finish(new Error('Could not start the local acceptance authorization bridge.'));
        return;
      }
      const authorizationUrl = `${allowedOrigin}/ecos-acceptance?port=${address.port}&nonce=${nonce}`;
      console.log('Open this local Vitruvius authorization page in the already signed-in browser:');
      console.log(authorizationUrl);
    });
    const timeout = setTimeout(() => {
      finish(new Error('Timed out waiting for the signed-in Vitruvius browser authorization.'));
    }, timeoutMs);
  });
}

function createAuthenticatedClient({ supabaseUrl, anonKey, accessToken }) {
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function resolveProject(client, projectName) {
  const { data, error } = await client
    .from('projects')
    .select('id,name,archived')
    .eq('name', projectName)
    .eq('archived', false)
    .limit(2);
  if (error) throw new Error(`Could not load the production project: ${safeErrorMessage(error)}`);
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error(`Expected exactly one active project named ${projectName}; found ${Array.isArray(data) ? data.length : 0}.`);
  }
  return { id: String(data[0].id), name: String(data[0].name) };
}

async function loadDocumentReadiness({
  client,
  shadowClient = null,
  shadowValidation = false,
  hostedReadiness = shadowValidation,
  project,
  definition,
}) {
  // Use the same bounded owner-scoped metadata RPC as the live app. Directly
  // selecting every document_data payload can deserialize multi-megabyte page
  // indexes before the client-side project filter runs and exceed PostgREST's
  // statement timeout.
  const { data: rawDocuments, error: documentError } = await client
    .rpc('dave_list_reference_document_metadata');
  if (documentError) throw new Error(`Could not inspect current drawings: ${safeErrorMessage(documentError)}`);
  const documents = (rawDocuments || []).flatMap(row => {
    const data = record(row.document_data);
    const documentId = text(data.id) || text(row.id);
    if (!documentId || data.isCurrent !== true || text(data.drawingStatus).toLowerCase() === 'superseded') return [];
    if (!documentMatchesProject(data, project)) return [];
    return [{
      id: documentId,
      name: text(data.name) || text(row.name),
      category: text(data.category) || text(row.category),
      sourcePageCount: positiveInteger(data.sourcePageCount),
      extractionStatus: text(data.extractionStatus),
      documentIntelligenceVersion: text(data.documentIntelligenceVersion),
      contentSha256: canonicalSha256(data.contentSha256),
      indexedContentSha256: canonicalSha256(data.indexedContentSha256),
      currentSourceSha256: canonicalSha256(
        data.contentSha256 || data.webFileFingerprint || data.indexedContentSha256,
      ),
    }];
  });
  const requiredGroups = definition.cases.flatMap(testCase => testCase.expectedEvidence || []);
  const requiredDocuments = new Map();
  const failures = [];
  for (const group of requiredGroups) {
    const matches = documents.filter(document => regex(group.documentNamePattern).test(document.name));
    if (matches.length === 0) {
      failures.push(`No current production drawing matches /${group.documentNamePattern}/i.`);
      continue;
    }
    matches.forEach(document => requiredDocuments.set(document.id, document));
  }
  const ids = [...requiredDocuments.keys()];
  let pageRows = [];
  const shadowJobsByDocument = new Map();
  if (ids.length > 0 && hostedReadiness) {
    if (!shadowClient) {
      throw new Error('Hosted readiness requires the protected operator client.');
    }
    const { data: jobs, error: jobError } = await shadowClient
      .from('ecos_hosted_index_jobs')
      .select('id,document_id,source_sha256,source_page_count,completed_page_count,assured_page_count,unresolved_region_count,state,mode,updated_at')
      .eq('mode', 'shadow')
      .in('document_id', ids)
      .order('updated_at', { ascending: false })
      .limit(500);
    if (jobError) throw new Error(`Could not inspect hosted shadow jobs: ${safeErrorMessage(jobError)}`);
    for (const rawJob of jobs || []) {
      const job = record(rawJob);
      const document = requiredDocuments.get(text(job.document_id));
      if (!document || shadowJobsByDocument.has(document.id)) continue;
      if (canonicalSha256(job.source_sha256) !== document.currentSourceSha256) continue;
      shadowJobsByDocument.set(document.id, job);
    }
    const readyJobIds = [...shadowJobsByDocument.values()]
      .filter(job => text(job.state) === 'ready')
      .map(job => text(job.id))
      .filter(Boolean);
    if (readyJobIds.length > 0) {
      const requestedPairs = [...shadowJobsByDocument.entries()].flatMap(([documentId, job]) =>
        Array.from({ length: positiveInteger(job.source_page_count) }, (_, index) => ({
          documentId,
          pageNumber: index + 1,
        }))
      );
      const identityRows = [];
      for (let offset = 0; offset < requestedPairs.length; offset += 200) {
        const batch = requestedPairs.slice(offset, offset + 200);
        const identityResult = await shadowClient.rpc(
          'ecos_load_hosted_shadow_page_identity_pairs_v22',
          {
            p_project_id: project.id,
            p_document_ids: batch.map(pair => pair.documentId),
            p_page_numbers: batch.map(pair => pair.pageNumber),
            p_result_limit: batch.length,
          },
        );
        if (identityResult.error) {
          throw new Error(`Could not inspect hosted page identities: ${safeErrorMessage(identityResult.error)}`);
        }
        identityRows.push(...(identityResult.data || []));
      }
      pageRows = identityRows.map(row => ({
        document_id: text(row.document_id),
        page_number: positiveInteger(row.page_number),
        sheet_number: text(row.sheet_number),
        sheet_mapping_status: text(row.sheet_mapping_status),
        source_sha256: canonicalSha256(row.source_sha256),
        visual_coverage: {},
      }));

      const highResolutionPairs = new Map();
      for (const group of uniqueEvidenceGroups(requiredGroups).filter(item => item.requireHighResolutionCoverage)) {
        const documentIds = new Set(
          [...requiredDocuments.values()]
            .filter(document => regex(group.documentNamePattern).test(document.name))
            .map(document => document.id),
        );
        for (const row of pageRows) {
          if (!pageMatchesEvidenceGroup(row, documentIds, group)) continue;
          highResolutionPairs.set(
            `${row.document_id}:${row.page_number}`,
            { documentId: row.document_id, pageNumber: row.page_number },
          );
        }
      }
      const detailedRows = [];
      const pagesByDocument = new Map();
      for (const pair of highResolutionPairs.values()) {
        const pageNumbers = pagesByDocument.get(pair.documentId) || [];
        pageNumbers.push(pair.pageNumber);
        pagesByDocument.set(pair.documentId, pageNumbers);
      }
      for (const [documentId, pageNumbers] of pagesByDocument.entries()) {
        const detailResult = await shadowClient.rpc(
          'ecos_load_hosted_shadow_page_context_v21',
          {
            p_document_ids: [documentId],
            p_page_numbers: [...new Set(pageNumbers)],
            p_result_limit: [...new Set(pageNumbers)].length,
          },
        );
        if (detailResult.error) {
          throw new Error(`Could not inspect hosted visual coverage: ${safeErrorMessage(detailResult.error)}`);
        }
        detailedRows.push(...(detailResult.data || []).flatMap(rawPage =>
          normalizeAssuredShadowPageRow({
            ...rawPage,
            state: 'assured',
            unresolved_region_count: 0,
          })
        ));
      }
      const detailedByPair = new Map(
        detailedRows.map(row => [`${text(row.document_id)}:${positiveInteger(row.page_number)}`, row]),
      );
      pageRows = pageRows.map(row => ({
        ...row,
        visual_coverage: detailedByPair.get(`${row.document_id}:${row.page_number}`)?.visual_coverage || {},
      }));
    }
  } else if (ids.length > 0) {
    const { data, error } = await client
      .from('ecos_document_pages')
      .select('document_id,page_number,sheet_number,sheet_mapping_status,visual_coverage,source_sha256,index_schema_version')
      .in('document_id', ids)
      .order('document_id')
      .order('page_number')
      .limit(2_000);
    if (error) throw new Error(`Could not inspect drawing page coverage: ${safeErrorMessage(error)}`);
    pageRows = data || [];
  }

  for (const document of requiredDocuments.values()) {
    if (hostedReadiness) {
      const job = shadowJobsByDocument.get(document.id);
      if (!document.currentSourceSha256) {
        failures.push(`${document.name} has no valid current source checksum.`);
      } else if (!job) {
        failures.push(`${document.name} has no hosted shadow job for its current source revision.`);
      } else if (text(job.state) !== 'ready') {
        failures.push(`${document.name} hosted shadow job is ${text(job.state) || 'missing'}, not ready.`);
      } else {
        const expectedPages = positiveInteger(job.source_page_count);
        const assuredPages = pageRows.filter(row => text(row.document_id) === document.id).length;
        if (!expectedPages || assuredPages !== expectedPages) {
          failures.push(`${document.name} has ${assuredPages} of ${expectedPages || 'unknown'} Assurance-approved shadow pages.`);
        }
        if (positiveInteger(job.unresolved_region_count) > 0) {
          failures.push(`${document.name} has unresolved hosted evidence regions.`);
        }
      }
      continue;
    }
    if (document.extractionStatus !== 'complete') {
      failures.push(`${document.name} extraction status is ${document.extractionStatus || 'missing'}, not complete.`);
    }
    if (document.documentIntelligenceVersion !== 'ecos-document-intelligence/2.0') {
      failures.push(`${document.name} is not indexed with Document Intelligence 2.0.`);
    }
    if (document.contentSha256 && document.indexedContentSha256 && document.contentSha256 !== document.indexedContentSha256) {
      failures.push(`${document.name} index does not match its current source revision.`);
    }
  }

  for (const group of uniqueEvidenceGroups(requiredGroups)) {
    const matchingDocuments = [...requiredDocuments.values()].filter(document =>
      regex(group.documentNamePattern).test(document.name)
    );
    const matchingDocumentIds = new Set(matchingDocuments.map(document => document.id));
    const matchingRows = pageRows.filter(row => pageMatchesEvidenceGroup(row, matchingDocumentIds, group));
    if (matchingRows.length === 0) {
      const location = [
        ...(group.sheetNumberPatterns || []).map(pattern => `sheet ${pattern}`),
        ...(group.pageNumberPatterns || []).map(pattern => `PDF page ${pattern}`),
      ].join(' or ');
      failures.push(`No verified indexed page matches /${group.documentNamePattern}/i on ${location}.`);
      continue;
    }
    if (group.requireHighResolutionCoverage && !matchingRows.some(pageRowHasCompleteVisualCoverage)) {
      const location = [
        ...(group.sheetNumberPatterns || []).map(pattern => `sheet ${pattern}`),
        ...(group.pageNumberPatterns || []).map(pattern => `PDF page ${pattern}`),
      ].join(' or ');
      failures.push(`Expected ${location} in /${group.documentNamePattern}/i lacks complete high-resolution coverage.`);
    }
  }

  return {
    passed: failures.length === 0,
    failures: [...new Set(failures)],
    checkedDocuments: [...requiredDocuments.values()].map(document => ({
      id: document.id,
      name: document.name,
      extractionStatus: document.extractionStatus,
      documentIntelligenceVersion: document.documentIntelligenceVersion,
      sourcePageCount: document.sourcePageCount,
      indexedPageCount: pageRows.filter(row => text(row.document_id) === document.id).length,
      indexMode: shadowValidation ? 'shadow' : hostedReadiness ? 'hosted-live' : 'legacy-live',
    })),
    checkedPages: pageRows.length,
    pageRows,
  };
}

function pageMatchesEvidenceGroup(row, documentIds, group) {
  return documentIds.has(text(row.document_id)) &&
    ((group.sheetNumberPatterns || []).length === 0 || (
      row.sheet_mapping_status === 'verified' &&
      (group.sheetNumberPatterns || []).some(pattern => regex(pattern).test(text(row.sheet_number)))
    )) &&
    ((group.pageNumberPatterns || []).length === 0 ||
      (group.pageNumberPatterns || []).some(pattern =>
        regex(pattern).test(String(positiveInteger(row.page_number) || ''))
      ));
}

async function askProductionECOS({
  client,
  accessToken,
  project,
  question,
  shadowValidation = false,
  serviceWorkerToken = '',
  clientSurface = 'web',
}) {
  const clientRequestId = crypto.randomUUID();
  let lastError = null;
  for (let attempt = 1; attempt <= MAXIMUM_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const { data, error, response } = await client.functions.invoke('ecos-ask-project', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(shadowValidation ? { 'x-ecos-worker-token': serviceWorkerToken } : {}),
        },
        body: {
          schemaVersion: 'ecos-project-question/2.0',
          clientRequestId,
          clientSurface,
          projectId: project.id,
          projectName: project.name,
          question,
          ...(shadowValidation ? { validationMode: 'shadow' } : {}),
        },
      });
      if (!error) return data;
      const body = response
        ? await response.clone().json().catch(() => null)
        : null;
      const status = response?.status || 0;
      const code = text(body?.error) || `http_${status}`;
      const retryable = status === 409 || status === 429 || status >= 500 || status === 0;
      if (!retryable || attempt === MAXIMUM_REQUEST_ATTEMPTS) {
        throw new Error(`Ask ECOS returned ${status} (${code}).`);
      }
      const retrySeconds = Math.min(60, Math.max(2, Number(body?.retryAfterSeconds) || 5));
      await wait(retrySeconds * 1_000);
    } catch (error) {
      lastError = error;
      if (attempt === MAXIMUM_REQUEST_ATTEMPTS) throw error;
      await wait(2_000 * attempt);
    }
  }
  throw lastError || new Error('Ask ECOS request failed.');
}

function liveClientSurface() {
  const value = text(process.env.ECOS_LIVE_CLIENT_SURFACE || 'web').toLowerCase();
  if (value === 'web' || value === 'iphone' || value === 'ipad' || value === 'android') return value;
  throw new Error('ECOS_LIVE_CLIENT_SURFACE must be web, iphone, ipad, or android.');
}

function documentMatchesProject(data, project) {
  if (text(data.projectId) === project.id) return true;
  if (normalize(data.projectName) === normalize(project.name)) return true;
  return Array.isArray(data.projectNames) && data.projectNames.some(name => normalize(name) === normalize(project.name));
}

function uniqueEvidenceGroups(groups) {
  const seen = new Set();
  return groups.filter(group => {
    const key = JSON.stringify({
      documentNamePattern: group.documentNamePattern,
      sheetNumberPatterns: group.sheetNumberPatterns,
      pageNumberPatterns: group.pageNumberPatterns,
      requireHighResolutionCoverage: group.requireHighResolutionCoverage,
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function writeResult(result) {
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  const temporaryPath = `${resultPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, resultPath);
}

function requiredEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function caseDelayMs() {
  const value = Number(process.env.ECOS_LIVE_CASE_DELAY_MS);
  return Number.isFinite(value) && value >= 0 ? Math.min(30_000, Math.round(value)) : DEFAULT_CASE_DELAY_MS;
}

function safeErrorMessage(error) {
  const structuredParts = error && typeof error === 'object'
    ? ['message', 'code', 'details', 'hint']
      .flatMap(key => typeof error[key] === 'string' && error[key].trim()
        ? [`${key}: ${error[key].trim()}`]
        : [])
    : [];
  const message = error instanceof Error
    ? error.message
    : structuredParts.length > 0
      ? structuredParts.join('; ')
      : String(error || 'Unknown error');
  return message.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer <redacted>').slice(0, 1_000);
}

function regex(pattern) {
  return new RegExp(pattern, 'ims');
}

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalize(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function canonicalSha256(value) {
  const normalized = text(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Ask ECOS production acceptance could not run: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  askProductionECOS,
  authenticate,
  loadDocumentReadiness,
  main,
  resolveProject,
  safeErrorMessage,
};
