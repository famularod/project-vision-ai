#!/usr/bin/env node

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  classifyProofRpcFailure,
  extractDocumentClaim,
  validateDocumentSnapshot,
  validateProofAuthorityRows,
  validateProtectedSourceResponse,
} = require('./ecos-customer-path-proof-gate');

const ROOT = path.resolve(__dirname, '..');
const snapshot = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'validation/ecos/customer-proof-production-shape.json'),
  'utf8',
));
const migration = fs.readFileSync(
  path.join(ROOT, 'supabase/migrations/20260913194700_ecos_reapply_atomic_contract_for_owner_runtime.sql'),
  'utf8',
);
const projectId = snapshot.project.id;
const document = snapshot.documents.find((item) => item.name.includes('CIVIL'));
const documentId = document.id;
const sourceSha256 = document.sourceSha256;
const regionId = 'structured-table-fact:relationship:24bf97ccee6a45baca12ec44';
const bounds = { x: 0.608889, y: 0.172222, width: 0.085, height: 0.009167 };
const png = Buffer.alloc(33);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
png.writeUInt32BE(13, 8);
Buffer.from('IHDR').copy(png, 12);
png.writeUInt32BE(2, 16);
png.writeUInt32BE(3, 20);
const rasterSha256 = crypto.createHash('sha256').update(png).digest('hex');

const answer = {
  supportingEvidence: [{
    sourceType: 'document',
    documentCitation: {
      projectId,
      documentId,
      sourceSha256,
      evidenceVersion: 'ecos-hosted-evidence/1.3',
      revision: '1',
      pageNumber: 6,
      sheetNumber: 'C6',
      regionId,
    },
    documentRegion: { id: regionId, ...bounds },
  }],
};
const claim = extractDocumentClaim(answer);
validateDocumentSnapshot(snapshot, claim, snapshot.project.name);

const citation = {
  evidence_id: 'e1',
  context_id: 's1',
  kind: 'visual_page',
  selected: true,
  source_id: documentId,
  source_sha256: sourceSha256,
  image_id: 'I01',
  locator: {
    project_id: projectId,
    page_number: 6,
    raster_sha256: rasterSha256,
    raster_byte_count: png.length,
    raster_width: 2,
    raster_height: 3,
  },
};
assert.deepEqual(validateProofAuthorityRows([{
  document_id: documentId,
  project_id: projectId,
  source_sha256: sourceSha256,
  evidence_version: 'ecos-hosted-evidence/1.3',
  source_revision: '1',
  page_number: 6,
  sheet_number: 'C6',
  region_id: regionId,
  region_bounds: bounds,
  source_view_citation: citation,
}], claim), citation);

const requestId = '77777777-7777-4777-8777-777777777777';
assert.deepEqual(validateProtectedSourceResponse({
  schemaVersion: 'ecos-owner-source-view/2.2',
  projectId,
  requestId,
  preview: true,
  read_only: true,
  server_checks: 'owner_before_and_after_source_read_only',
  source: {
    kind: 'document_page',
    result: { state: 'current_exact_page_image', citation },
    png: { media_type: 'image/png', encoding: 'base64', data: png.toString('base64') },
  },
}, { requestId, claim, citation }), { sha256: rasterSha256, byteCount: 33 });

assert.equal(classifyProofRpcFailure(404, {
  code: 'PGRST202',
  message: 'Could not find the function in the schema cache',
}), 'proof_service_missing');
assert.equal(classifyProofRpcFailure(403, { code: '42501' }), 'proof_permission_denied');

assert.equal((migration.match(/^begin;$/gm) || []).length, 1);
assert.equal((migration.match(/^commit;$/gm) || []).length, 1);
assert.match(migration, /create function public\.dave_verify_current_ecos_document_proof/);
assert.match(migration, /create or replace function public\.ecos_load_project_question_records_v1/);
assert.match(migration, /has_function_privilege\(\s*'anon'/);
assert.match(migration, /grant execute on function public\.dave_verify_current_ecos_document_proof[\s\S]*to authenticated;/);
const proofFunctionSection = migration.slice(
  migration.indexOf('create function public.dave_verify_current_ecos_document_proof'),
  migration.indexOf('create or replace function public.ecos_load_project_question_records_v1'),
);
assert.doesNotMatch(proofFunctionSection, /to authenticated, service_role;/);

console.log('Ask ECOS customer-path proof gate contract passed.');
