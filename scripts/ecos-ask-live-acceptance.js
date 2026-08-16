#!/usr/bin/env node

const fs = require('node:fs');
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
const REQUEST_TIMEOUT_MS = 45_000;

async function main() {
  loadLocalEnvironment();
  const definition = loadAcceptanceDefinition();
  const contractHash = acceptanceContractHash();
  const supabaseUrl = requiredEnvironment('EXPO_PUBLIC_SUPABASE_URL');
  const productionHost = new URL(supabaseUrl).host;
  if (productionHost !== definition.productionHost) {
    throw new Error(`Acceptance target host ${productionHost} does not match the sealed production host.`);
  }
  const anonKey = requiredEnvironment('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const shadowValidation = String(process.env.ECOS_LIVE_SHADOW_VALIDATION || '').trim().toLowerCase() === 'true';
  const serviceRoleKey = shadowValidation ? requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY') : '';
  const serviceWorkerToken = shadowValidation ? requiredEnvironment('ECOS_SERVICE_WORKER_TOKEN') : '';
  const auth = await authenticate({ supabaseUrl, anonKey });
  const client = createAuthenticatedClient({ supabaseUrl, anonKey, accessToken: auth.accessToken });
  const shadowClient = shadowValidation
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  const project = await resolveProject(client, definition.projectId, definition.projectName);
  const readiness = await loadDocumentReadiness({ client, shadowClient, shadowValidation, project, definition });
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
          supabaseUrl,
          anonKey,
          accessToken: auth.accessToken,
          project,
          question: testCase.question,
          shadowValidation,
          serviceWorkerToken,
        });
        const evaluation = evaluateAcceptanceCase(testCase, response, {
          projectId: project.id,
          projectName: project.name,
          currentDocuments: readiness.currentDocuments,
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
    productionHost,
    projectId: project.id,
    projectName: project.name,
    authenticatedUserId: auth.userId,
    indexMode: shadowValidation ? 'shadow' : 'live',
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
  const accessToken = String(process.env.ECOS_LIVE_ACCESS_TOKEN || '').trim();
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

function createAuthenticatedClient({ supabaseUrl, anonKey, accessToken }) {
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function resolveProject(client, projectId, projectName) {
  const expectedProjectId = canonicalUuid(projectId);
  if (!expectedProjectId) throw new Error('The acceptance definition has no canonical project id.');
  const { data, error } = await client
    .from('projects')
    .select('id,name,archived')
    .eq('id', expectedProjectId)
    .eq('name', projectName)
    .eq('archived', false)
    .limit(2);
  if (error) throw new Error(`Could not load the production project: ${safeErrorMessage(error)}`);
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error(`Expected the exact active project ${expectedProjectId} named ${projectName}; found ${Array.isArray(data) ? data.length : 0}.`);
  }
  const resolvedId = canonicalUuid(data[0].id);
  if (resolvedId !== expectedProjectId) throw new Error('The project lookup returned a different immutable id.');
  return { id: resolvedId, name: String(data[0].name) };
}

async function loadDocumentReadiness({ client, shadowClient = null, shadowValidation = false, project, definition }) {
  const { data: rawDocuments, error: documentError } = await client
    .from('reference_documents')
    .select('id,owner_id,name,category,document_data,updated_at')
    .limit(500);
  if (documentError) throw new Error(`Could not inspect current drawings: ${safeErrorMessage(documentError)}`);
  const documents = (rawDocuments || []).flatMap(row => {
    const data = record(row.document_data);
    const documentId = authoritativeReferenceDocumentId(row);
    if (!documentId || data.isCurrent !== true || text(data.drawingStatus).toLowerCase() === 'superseded') return [];
    if (!documentMatchesProject(data, project)) return [];
    const sourceOwnerId = canonicalUuid(row.owner_id);
    const revision = exactBoundedText(data.drawingRevision || data.webVersionGroupId, 160);
    const hasOrganizationId = Object.prototype.hasOwnProperty.call(data, 'organizationId');
    const organizationId = hasOrganizationId
      ? exactBoundedText(data.organizationId, 500)
      : null;
    if (!sourceOwnerId || !revision || (hasOrganizationId && !organizationId)) return [];
    return [{
      id: documentId,
      projectId: project.id,
      organizationId,
      sourceOwnerId,
      name: text(data.name) || text(row.name),
      category: text(data.category) || text(row.category),
      revision,
      sourcePageCount: positiveInteger(data.sourcePageCount),
      extractionStatus: text(data.extractionStatus),
      documentIntelligenceVersion: text(data.documentIntelligenceVersion),
      contentSha256: canonicalSha256(data.contentSha256),
      indexedContentSha256: canonicalSha256(data.indexedContentSha256),
      currentSourceSha256: canonicalSha256(data.contentSha256),
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
  const liveStatusByDocument = new Map();
  if (ids.length > 0 && shadowValidation) {
    const { data: jobs, error: jobError } = await shadowClient
      .from('ecos_hosted_index_jobs')
      .select('id,organization_id,project_id,document_id,source_owner_id,source_sha256,source_revision,source_page_count,completed_page_count,assured_page_count,unresolved_region_count,state,mode,committed_evidence_version,updated_at')
      .eq('mode', 'shadow')
      .in('document_id', ids)
      .order('updated_at', { ascending: false })
      .limit(500);
    if (jobError) throw new Error(`Could not inspect hosted shadow jobs: ${safeErrorMessage(jobError)}`);
    const locallyEligibleShadowJobs = [];
    for (const rawJob of jobs || []) {
      const job = record(rawJob);
      const document = requiredDocuments.get(text(job.document_id));
      if (!document) continue;
      if (!shadowJobMatchesDocument(job, document)) continue;
      locallyEligibleShadowJobs.push({ job, document });
    }
    const authorizedShadowJobs = await Promise.all(locallyEligibleShadowJobs.map(async candidate => {
      const { data, error } = await shadowClient.rpc('ecos_hosted_job_matches_reference', {
        p_job_id: text(candidate.job.id),
        p_require_current: true,
      });
      if (error) throw new Error(`Could not verify hosted shadow authority: ${safeErrorMessage(error)}`);
      return data === true ? candidate : null;
    }));
    const exactJobsByDocument = new Map();
    for (const candidate of authorizedShadowJobs) {
      if (!candidate) continue;
      const jobsForDocument = exactJobsByDocument.get(candidate.document.id) || new Map();
      jobsForDocument.set(text(candidate.job.id), candidate.job);
      exactJobsByDocument.set(candidate.document.id, jobsForDocument);
    }
    for (const [documentId, exactJobs] of exactJobsByDocument) {
      if (exactJobs.size === 1) {
        shadowJobsByDocument.set(documentId, [...exactJobs.values()][0]);
      }
    }
    const readyJobIds = [...shadowJobsByDocument.values()]
      .filter(job => text(job.state) === 'ready')
      .map(job => text(job.id))
      .filter(Boolean);
    if (readyJobIds.length > 0) {
      const { data: pages, error: pageError } = await shadowClient
        .from('ecos_hosted_index_pages')
        .select('job_id,organization_id,project_id,document_id,source_sha256,page_number,state,final_page_data,assurance_result,unresolved_region_count')
        .in('job_id', readyJobIds)
        .order('document_id')
        .order('page_number')
        .limit(5_000);
      if (pageError) throw new Error(`Could not inspect hosted shadow page coverage: ${safeErrorMessage(pageError)}`);
      const shadowJobById = new Map([...shadowJobsByDocument.values()]
        .map(job => [text(job.id), job]));
      pageRows = (pages || []).flatMap(rawPage => {
        const page = record(rawPage);
        const job = shadowJobById.get(text(page.job_id));
        const document = job ? requiredDocuments.get(text(job.document_id)) : null;
        if (!job || !document || !shadowPageMatchesJob(page, job, document)) return [];
        return normalizeAssuredShadowPageRow(rawPage).map(row => ({
          ...row,
          project_id: document.projectId,
          source_sha256: document.currentSourceSha256,
          source_revision: document.revision,
          evidence_version: 'ecos-hosted-evidence/1.3',
        }));
      });
    }
  } else if (ids.length > 0) {
    const statusResult = await client.rpc('ecos_hosted_index_status_v2', {
      p_document_ids: ids,
    });
    if (statusResult.error) {
      throw new Error(`Could not inspect exact hosted drawing status: ${safeErrorMessage(statusResult.error)}`);
    }
    for (const rawStatus of Array.isArray(statusResult.data) ? statusResult.data : []) {
      const status = record(rawStatus);
      const document = requiredDocuments.get(text(status.document_id));
      if (
        !document ||
        canonicalUuid(status.project_id) !== document.projectId ||
        liveStatusByDocument.has(document.id)
      ) continue;
      liveStatusByDocument.set(document.id, status);
    }
    const maximumPageCount = Math.max(0, ...[...requiredDocuments.values()]
      .map(document => Math.max(
        document.sourcePageCount,
        positiveInteger(liveStatusByDocument.get(document.id)?.source_page_count),
      )));
    if (maximumPageCount > 10_000) {
      failures.push(`Required drawing page count ${maximumPageCount} exceeds the acceptance bound.`);
    } else if (maximumPageCount > 0) {
      const allPageNumbers = Array.from({ length: maximumPageCount }, (_, index) => index + 1);
      for (let offset = 0; offset < allPageNumbers.length; offset += 24) {
        const pageNumberBatch = allPageNumbers.slice(offset, offset + 24);
        const contextResult = await client.rpc('ecos_load_current_hosted_page_context', {
          p_project_id: project.id,
          p_document_ids: ids,
          p_page_numbers: pageNumberBatch,
        });
        if (contextResult.error) {
          throw new Error(`Could not inspect exact hosted page coverage: ${safeErrorMessage(contextResult.error)}`);
        }
        for (const rawPage of Array.isArray(contextResult.data) ? contextResult.data : []) {
          const row = record(rawPage);
          const document = requiredDocuments.get(text(row.document_id));
          const assurance = record(row.assurance_result);
          const pageNumber = positiveInteger(row.page_number);
          if (
            !document ||
            !pageNumber ||
            assurance.accepted !== true ||
            text(assurance.evidenceVersion) !== 'ecos-hosted-evidence/1.3'
          ) continue;
          pageRows.push({
            ...row,
            document_id: document.id,
            project_id: document.projectId,
            page_number: pageNumber,
            source_sha256: document.currentSourceSha256,
            source_revision: document.revision,
            evidence_version: 'ecos-hosted-evidence/1.3',
          });
        }
      }
    }
  }

  for (const document of requiredDocuments.values()) {
    if (shadowValidation) {
      const job = shadowJobsByDocument.get(document.id);
      if (!document.currentSourceSha256) {
        failures.push(`${document.name} has no valid current source checksum.`);
      } else if (!job) {
        failures.push(`${document.name} has no hosted shadow job for its current source revision.`);
      } else if (text(job.state) !== 'ready') {
        failures.push(`${document.name} hosted shadow job is ${text(job.state) || 'missing'}, not ready.`);
      } else {
        const expectedPages = positiveInteger(job.source_page_count);
        const documentPageNumbers = pageRows
          .filter(row => text(row.document_id) === document.id)
          .map(row => positiveInteger(row.page_number))
          .filter(Boolean);
        const assuredPages = documentPageNumbers.length;
        const contiguousPages = expectedPages > 0 &&
          new Set(documentPageNumbers).size === expectedPages &&
          Math.min(...documentPageNumbers) === 1 &&
          Math.max(...documentPageNumbers) === expectedPages;
        if (!expectedPages || assuredPages !== expectedPages || !contiguousPages) {
          failures.push(`${document.name} has ${assuredPages} of ${expectedPages || 'unknown'} Assurance-approved shadow pages.`);
        }
        if (positiveInteger(job.unresolved_region_count) > 0) {
          failures.push(`${document.name} has unresolved hosted evidence regions.`);
        }
      }
      continue;
    }
    const status = liveStatusByDocument.get(document.id);
    if (!document.currentSourceSha256) {
      failures.push(`${document.name} has no valid current source checksum.`);
    } else if (!status) {
      failures.push(`${document.name} has no exact hosted status receipt.`);
    } else if (
      text(status.state) !== 'ready' ||
      text(status.committed_evidence_version) !== 'ecos-hosted-evidence/1.3' ||
      !['Ready for ECOS', 'Ready with limitations'].includes(text(status.customer_status))
    ) {
      failures.push(`${document.name} is not current and ready under hosted evidence 1.3.`);
    } else {
      const expectedPages = positiveInteger(status.source_page_count) || document.sourcePageCount;
      const documentPageNumbers = pageRows
        .filter(row => text(row.document_id) === document.id)
        .map(row => positiveInteger(row.page_number))
        .filter(Boolean);
      const contiguousPages = expectedPages > 0 &&
        new Set(documentPageNumbers).size === expectedPages &&
        Math.min(...documentPageNumbers) === 1 &&
        Math.max(...documentPageNumbers) === expectedPages;
      if (!expectedPages || documentPageNumbers.length !== expectedPages || !contiguousPages) {
        failures.push(`${document.name} has ${documentPageNumbers.length} of ${expectedPages || 'unknown'} exact hosted pages.`);
      }
    }
  }

  for (const group of uniqueEvidenceGroups(requiredGroups)) {
    const matchingDocuments = [...requiredDocuments.values()].filter(document =>
      regex(group.documentNamePattern).test(document.name)
    );
    const matchingRows = pageRows.filter(row =>
      matchingDocuments.some(document => document.id === text(row.document_id)) &&
      ((group.sheetNumberPatterns || []).length === 0 || (
        row.sheet_mapping_status === 'verified' &&
        (group.sheetNumberPatterns || []).some(pattern => regex(pattern).test(text(row.sheet_number)))
      )) &&
      ((group.pageNumberPatterns || []).length === 0 ||
        (group.pageNumberPatterns || []).some(pattern => regex(pattern).test(String(positiveInteger(row.page_number) || ''))))
    );
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
      projectId: document.projectId,
      revision: document.revision,
      sourceSha256: document.currentSourceSha256,
      evidenceVersion: 'ecos-hosted-evidence/1.3',
      indexedPageCount: pageRows.filter(row => text(row.document_id) === document.id).length,
      indexMode: shadowValidation ? 'shadow' : 'live',
    })),
    checkedPages: pageRows.length,
    currentDocuments: [...requiredDocuments.values()].map(document => ({
      id: document.id,
      name: document.name,
      projectId: document.projectId,
      currentSourceSha256: document.currentSourceSha256,
      revision: document.revision,
    })),
    pageRows,
  };
}

function authoritativeReferenceDocumentId(value) {
  const row = record(value);
  const data = record(row.document_data);
  const durableId = typeof row.id === 'string' && row.id === row.id.trim() && row.id
    ? row.id
    : null;
  const hasEmbeddedId = Object.prototype.hasOwnProperty.call(data, 'id');
  const embeddedId = hasEmbeddedId && typeof data.id === 'string' &&
      data.id === data.id.trim() && data.id
    ? data.id
    : null;
  if (!durableId || (hasEmbeddedId && embeddedId !== durableId)) return null;
  return durableId;
}

async function askProductionECOS({
  supabaseUrl,
  anonKey,
  accessToken,
  project,
  question,
  shadowValidation = false,
  serviceWorkerToken = '',
}) {
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/ecos-ask-project`;
  let lastError = null;
  for (let attempt = 1; attempt <= MAXIMUM_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
          'Content-Type': 'application/json',
          ...(shadowValidation ? { 'x-ecos-worker-token': serviceWorkerToken } : {}),
        },
        body: JSON.stringify({
          schemaVersion: 'ecos-project-question/1.0',
          projectId: project.id,
          projectName: project.name,
          question,
          ...(shadowValidation ? { validationMode: 'shadow' } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) return body;
      const code = text(body?.error) || `http_${response.status}`;
      const retryable = response.status === 409 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAXIMUM_REQUEST_ATTEMPTS) {
        throw new Error(`Ask ECOS returned ${response.status} (${code}).`);
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

function documentMatchesProject(data, project) {
  const expectedProjectId = canonicalUuid(project?.id);
  return expectedProjectId !== null && canonicalUuid(data.projectId) === expectedProjectId;
}

function shadowJobMatchesDocument(jobValue, documentValue) {
  const job = record(jobValue);
  const document = record(documentValue);
  return text(job.mode) === 'shadow' &&
    text(job.state) === 'ready' &&
    text(job.committed_evidence_version) === 'ecos-hosted-evidence/1.3' &&
    canonicalUuid(job.project_id) === canonicalUuid(document.projectId) &&
    (!document.organizationId || (
      typeof job.organization_id === 'string' &&
      job.organization_id === document.organizationId
    )) &&
    text(job.document_id) === document.id &&
    canonicalUuid(job.source_owner_id) === canonicalUuid(document.sourceOwnerId) &&
    canonicalSha256(job.source_sha256) === document.currentSourceSha256 &&
    exactBoundedText(job.source_revision, 160) === document.revision;
}

function shadowPageMatchesJob(pageValue, jobValue, documentValue) {
  const page = record(pageValue);
  const job = record(jobValue);
  const document = record(documentValue);
  const finalPage = record(page.final_page_data);
  const assurance = record(page.assurance_result);
  return text(page.job_id) === text(job.id) &&
    text(page.organization_id) === text(job.organization_id) &&
    canonicalUuid(page.project_id) === canonicalUuid(job.project_id) &&
    text(page.document_id) === document.id &&
    canonicalSha256(page.source_sha256) === document.currentSourceSha256 &&
    canonicalSha256(finalPage.sourceSha256) === document.currentSourceSha256 &&
    text(page.state) === 'assured' &&
    assurance.accepted === true &&
    text(assurance.evidenceVersion) === 'ecos-hosted-evidence/1.3' &&
    nonNegativeInteger(page.unresolved_region_count) === 0;
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
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
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

function canonicalUuid(value) {
  if (typeof value !== 'string' || value !== value.trim()) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : null;
}

function exactBoundedText(value, maximumLength) {
  if (typeof value !== 'string' || value !== value.trim()) return null;
  return value && value.length <= maximumLength && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
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
  authoritativeReferenceDocumentId,
  documentMatchesProject,
  loadDocumentReadiness,
  main,
  resolveProject,
  shadowJobMatchesDocument,
  shadowPageMatchesJob,
};
