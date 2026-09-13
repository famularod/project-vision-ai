#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const DEFAULT_SNAPSHOT = path.resolve(
  __dirname,
  '../validation/ecos/customer-proof-production-shape.json',
);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function required(name) {
  const value = text(process.env[name]);
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function extractDocumentClaim(answer) {
  const evidence = Array.isArray(answer?.supportingEvidence)
    ? answer.supportingEvidence.filter((item) => item?.sourceType === 'document')
    : [];
  if (evidence.length !== 1) throw new Error('exactly_one_document_citation_required');
  const citation = record(evidence[0].documentCitation);
  const region = record(evidence[0].documentRegion);
  const claim = {
    projectId: text(citation.projectId),
    documentId: text(citation.documentId),
    sourceSha256: text(citation.sourceSha256).toLowerCase(),
    evidenceVersion: text(citation.evidenceVersion),
    revision: text(citation.revision),
    pageNumber: Number(citation.pageNumber),
    sheetNumber: text(citation.sheetNumber) || null,
    regionId: text(citation.regionId),
    bounds: {
      x: Number(region.x),
      y: Number(region.y),
      width: Number(region.width),
      height: Number(region.height),
    },
  };
  if (
    !UUID.test(claim.projectId) || !claim.documentId || !SHA.test(claim.sourceSha256) ||
    claim.evidenceVersion !== 'ecos-hosted-evidence/1.3' || !claim.revision ||
    !Number.isInteger(claim.pageNumber) || claim.pageNumber < 1 || !claim.regionId ||
    !validBounds(claim.bounds)
  ) throw new Error('document_citation_incomplete');
  return claim;
}

function validateDocumentSnapshot(snapshot, claim, projectName) {
  if (snapshot?.schemaVersion !== 'ecos-customer-proof-production-shape/1.1') {
    throw new Error('production_shape_schema_invalid');
  }
  const project = record(snapshot.project);
  const documents = Array.isArray(snapshot.documents) ? snapshot.documents : [];
  const document = record(documents.find((item) => text(item?.id) === claim.documentId));
  if (
    text(project.id) !== claim.projectId || text(project.name) !== projectName ||
    text(document.id) !== claim.documentId || document.isCurrent !== true ||
    text(document.sourceSha256).toLowerCase() !== claim.sourceSha256 ||
    text(document.revision) !== claim.revision ||
    Number(document.sourcePageCount) !== Number(document.committedPageCount) ||
    claim.pageNumber > Number(document.sourcePageCount)
  ) throw new Error('answer_does_not_match_production_document_shape');
}

function validateProofAuthorityRows(rows, claim) {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('exact_proof_row_missing');
  const row = record(rows[0]);
  if (
    text(row.document_id) !== claim.documentId || text(row.project_id) !== claim.projectId ||
    text(row.source_sha256).toLowerCase() !== claim.sourceSha256 ||
    text(row.evidence_version) !== claim.evidenceVersion ||
    text(row.source_revision) !== claim.revision || Number(row.page_number) !== claim.pageNumber ||
    normalizeSheet(row.sheet_number) !== normalizeSheet(claim.sheetNumber) ||
    text(row.region_id) !== claim.regionId || !sameBounds(row.region_bounds, claim.bounds)
  ) throw new Error('proof_authority_identity_mismatch');
  const sourceCitation = record(row.source_view_citation);
  const locator = record(sourceCitation.locator);
  if (
    sourceCitation.kind !== 'visual_page' || sourceCitation.selected !== true ||
    text(sourceCitation.source_id) !== claim.documentId ||
    text(sourceCitation.source_sha256).toLowerCase() !== claim.sourceSha256 ||
    text(locator.project_id) !== claim.projectId || Number(locator.page_number) !== claim.pageNumber ||
    !SHA.test(text(locator.raster_sha256).toLowerCase()) ||
    !Number.isInteger(Number(locator.raster_width)) || !Number.isInteger(Number(locator.raster_height))
  ) throw new Error('protected_source_citation_missing');
  return sourceCitation;
}

function validateProtectedSourceResponse(body, expected) {
  if (
    body?.schemaVersion !== 'ecos-owner-source-view/2.2' ||
    text(body?.projectId) !== expected.claim.projectId ||
    text(body?.requestId) !== expected.requestId || body?.preview !== true ||
    body?.read_only !== true || body?.server_checks !== 'owner_before_and_after_source_read_only'
  ) throw new Error('protected_source_envelope_invalid');
  const source = record(body.source);
  const result = record(source.result);
  const png = record(source.png);
  if (
    source.kind !== 'document_page' || result.state !== 'current_exact_page_image' ||
    JSON.stringify(result.citation) !== JSON.stringify(expected.citation) ||
    png.media_type !== 'image/png' || png.encoding !== 'base64' || !text(png.data)
  ) throw new Error('protected_source_payload_invalid');
  const locator = record(expected.citation.locator);
  const bytes = Buffer.from(text(png.data), 'base64');
  if (
    bytes.toString('base64') !== text(png.data) || bytes.length !== Number(locator.raster_byte_count) ||
    digest(bytes) !== text(locator.raster_sha256).toLowerCase() ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.readUInt32BE(16) !== Number(locator.raster_width) ||
    bytes.readUInt32BE(20) !== Number(locator.raster_height)
  ) throw new Error('protected_raster_identity_mismatch');
  return { sha256: digest(bytes), byteCount: bytes.length };
}

function classifyProofRpcFailure(status, body) {
  const code = text(body?.code).toUpperCase();
  const message = `${text(body?.message)} ${text(body?.details)} ${text(body?.hint)}`.toLowerCase();
  if (code === 'PGRST202' || code === '42883' || /could not find the function|does not exist|schema cache/.test(message)) {
    return 'proof_service_missing';
  }
  if (status === 401 || status === 403 || code === '42501') return 'proof_permission_denied';
  if (status >= 500 || code === '57014') return 'proof_service_unavailable';
  return 'proof_request_failed';
}

async function requestJson(url, init, timeoutMs = 140_000) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function run() {
  const supabaseUrl = required('SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = required('SUPABASE_ANON_KEY');
  const accessToken = required('ECOS_OWNER_ACCESS_TOKEN');
  const projectId = required('ECOS_PROJECT_ID').toLowerCase();
  const projectName = required('ECOS_PROJECT_NAME');
  const question = required('ECOS_CUSTOMER_QUESTION');
  const surface = required('ECOS_CUSTOMER_SURFACE');
  if (!['web', 'iphone', 'ipad'].includes(surface)) throw new Error('ECOS_CUSTOMER_SURFACE_invalid');
  const snapshot = readJson(process.env.ECOS_PRODUCTION_SHAPE_PATH || DEFAULT_SNAPSHOT);
  const requestId = crypto.randomUUID().toLowerCase();
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  const asked = await requestJson(`${supabaseUrl}/functions/v1/ecos-ask-project`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      schemaVersion: 'ecos-project-question/2.0',
      clientRequestId: requestId,
      clientSurface: surface,
      projectId,
      projectName,
      question,
    }),
  });
  if (!asked.response.ok) throw new Error(`customer_question_failed:${asked.response.status}:${text(asked.body?.error)}`);
  const claim = extractDocumentClaim(asked.body);
  validateDocumentSnapshot(snapshot, claim, projectName);
  const verified = await requestJson(`${supabaseUrl}/rest/v1/rpc/dave_verify_current_ecos_document_proof`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      p_project_id: claim.projectId,
      p_document_id: claim.documentId,
      p_source_sha256: claim.sourceSha256,
      p_evidence_version: claim.evidenceVersion,
      p_revision: claim.revision,
      p_page_number: claim.pageNumber,
      p_sheet_number: claim.sheetNumber,
      p_region_id: claim.regionId,
    }),
  }, 15_000);
  if (!verified.response.ok) {
    throw new Error(`${classifyProofRpcFailure(verified.response.status, verified.body)}:${verified.response.status}`);
  }
  const citation = validateProofAuthorityRows(verified.body, claim);
  const proofRequestId = crypto.randomUUID().toLowerCase();
  const opened = await requestJson(`${supabaseUrl}/functions/v1/ecos-source-preview`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      schemaVersion: 'ecos-owner-source-view/2.2',
      projectId,
      requestId: proofRequestId,
      answerSchemaVersion: 'ecos-owner-source-answer/2.1',
      citation,
    }),
  });
  if (!opened.response.ok) throw new Error(`protected_source_open_failed:${opened.response.status}`);
  const raster = validateProtectedSourceResponse(opened.body, { requestId: proofRequestId, claim, citation });
  const receipt = {
    schemaVersion: 'ecos-customer-path-proof-gate/1.0',
    completedAt: new Date().toISOString(),
    surface,
    projectId,
    questionSha256: digest(question),
    answerSha256: digest(text(asked.body.answer)),
    citation: {
      documentId: claim.documentId,
      sourceSha256: claim.sourceSha256,
      revision: claim.revision,
      pageNumber: claim.pageNumber,
      sheetNumber: claim.sheetNumber,
      regionId: claim.regionId,
    },
    proofAuthorityVerified: true,
    protectedRasterOpened: true,
    protectedRasterSha256: raster.sha256,
    protectedRasterByteCount: raster.byteCount,
    originalSourceVisibleTestRequired: true,
    passed: true,
  };
  const outputPath = text(process.env.ECOS_OUTPUT_PATH);
  if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(receipt, null, 2));
}

function validBounds(value) {
  const { x, y, width, height } = record(value);
  return [x, y, width, height].every(Number.isFinite) && x >= 0 && y >= 0 &&
    width > 0 && height > 0 && x + width <= 1.000001 && y + height <= 1.000001;
}

function sameBounds(left, right) {
  if (!validBounds(left) || !validBounds(right)) return false;
  return ['x', 'y', 'width', 'height'].every((key) => Math.abs(Number(left[key]) - Number(right[key])) <= 0.000001);
}

function normalizeSheet(value) {
  return text(value).toUpperCase().replace(/\s+/g, '');
}

module.exports = {
  classifyProofRpcFailure,
  extractDocumentClaim,
  run,
  validateDocumentSnapshot,
  validateProofAuthorityRows,
  validateProtectedSourceResponse,
};

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
