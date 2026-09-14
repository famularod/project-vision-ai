import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  bindECOSOwnerSourceAuthorityContext,
  prepareECOSOwnerSourceAuthorityDecision,
  bindECOSOwnerSourceAuthorityResult,
  bindECOSOwnerSourceAuthorityRead,
} from './ecos-owner-source-authority.ts';

const fixture = JSON.parse(await Deno.readTextFile(Deno.args[0]));
const contextScope = { ownerId: fixture.context.owner_id, reviewProjectId: fixture.context.review_project_id,
  documentId: fixture.context.document_id, projectIds: fixture.context.project_ids };
const readScope = { ownerId: fixture.context.owner_id, projectId: fixture.context.review_project_id,
  documentId: fixture.context.document_id, decisionId: fixture.decision.decision_id };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

Deno.test('real rolled-back database /2.2 context, commit and read bind through actual runtime', async () => {
  const context = await bindECOSOwnerSourceAuthorityContext(fixture.context, contextScope);
  const decision = prepareECOSOwnerSourceAuthorityDecision(context, {
    decisionId: fixture.decision.decision_id, reviewerId: fixture.context.owner_id,
    confirmation: 'exact_project_ids_confirmed',
  });
  assert.deepEqual(decision, fixture.decision);
  const committed = await bindECOSOwnerSourceAuthorityResult(fixture.commit_result, decision);
  assert.equal(committed.receipt.schema_version, 'ecos-document-project-binding-receipt/2.2');
  const read = await bindECOSOwnerSourceAuthorityRead(fixture.current_read, readScope);
  assert.equal(read.state, 'current');
});

Deno.test('canonical context cannot be relabeled as legacy or include an update timestamp', async () => {
  await assert.rejects(() => bindECOSOwnerSourceAuthorityContext({ ...fixture.context,
    schema_version: 'ecos-owner-source-authority-context/2.1' }, contextScope));
  const metadata = JSON.stringify({ ...JSON.parse(fixture.context.document_metadata_json), updated_at: '2026-09-14' });
  await assert.rejects(() => bindECOSOwnerSourceAuthorityContext({ ...fixture.context,
    document_metadata_json: metadata, document_metadata_sha256: hash(metadata) }, contextScope));
});

Deno.test('mixed receipt and decision versions remain invalid even with a fresh envelope hash', async () => {
  const receipt = JSON.parse(fixture.current_read.receipt_json);
  receipt.schema_version = 'ecos-document-project-binding-receipt/2.1';
  const receipt_json = JSON.stringify(receipt);
  await assert.rejects(() => bindECOSOwnerSourceAuthorityRead({ ...fixture.current_read,
    receipt_json, receipt_sha256: hash(receipt_json) }, readScope));
});

Deno.test('wrong owner, project, document and stale state cannot expose a current receipt', async () => {
  for (const [key, value] of Object.entries({ ownerId: '11111111-1111-4111-8111-111111111111',
    projectId: '11111111-1111-4111-8111-111111111111', documentId: 'another-document' })) {
    await assert.rejects(() => bindECOSOwnerSourceAuthorityRead(fixture.current_read, { ...readScope, [key]: value }));
  }
  await assert.rejects(() => bindECOSOwnerSourceAuthorityRead({ ...fixture.current_read, state: 'stale' }, readScope));
});

