const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const EVIDENCE_VERSION = 'ecos-hosted-evidence/1.3';

const required = name => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const enabled = name => ['1', 'true', 'yes'].includes(
  String(process.env[name] || '').trim().toLowerCase(),
);

const sha256File = filePath => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  stream.on('error', reject);
  stream.on('data', chunk => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
});

const findLocalSources = fileName => {
  const query = `kMDItemFSName == '${fileName.replaceAll("'", "\\'")}'c`;
  const candidates = execFileSync('mdfind', [query], { encoding: 'utf8' })
    .split('\n').map(value => value.trim()).filter(Boolean);
  return [
    ...candidates.filter(value => value.includes('/Compliance Project Approved/2375 Approved/')),
    ...candidates.filter(value => value.includes('/Downloads/')),
    ...candidates,
  ].filter((value, index, values) => values.indexOf(value) === index);
};

async function main() {
  const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
  const bucket = required('ECOS_GCS_STAGING_BUCKET');
  const projectName = String(process.env.ECOS_SHADOW_PROJECT_NAME || '2375 Compliance Project').trim();
  const requestedDocumentId = String(process.env.ECOS_SHADOW_DOCUMENT_ID || '').trim();
  const locatorOnly = enabled('ECOS_SHADOW_LOCATOR_ONLY');
  const { data: documents, error } = await supabase
    .from('reference_documents')
    .select('id,owner_id,document_data');
  if (error) throw error;
  const drawings = documents.filter(row => {
    const value = row.document_data || {};
    return value.isCurrent === true
      && value.drawingStatus !== 'Superseded'
      && value.category === 'Drawing'
      && (!requestedDocumentId || String(row.id) === requestedDocumentId)
      && (value.projectName === projectName || (value.projectNames || []).includes(projectName));
  });
  if (!drawings.length) throw new Error(`No current drawings found for ${projectName}`);

  let staged = 0;
  const skipped = [];
  for (const row of drawings) {
    const value = row.document_data || {};
    const fileName = String(value.originalFileName || `${value.name || row.id}.pdf`).trim();
    const candidates = findLocalSources(fileName);
    if (!candidates.length) {
      skipped.push(`${value.name || row.id}: local source not found`);
      continue;
    }
    const expectedSha = String(value.contentSha256 || value.webFileFingerprint || '').toLowerCase();
    let localPath = candidates[0];
    let sourceSha = await sha256File(localPath);
    if (expectedSha && sourceSha !== expectedSha) {
      for (const candidate of candidates.slice(1)) {
        const candidateSha = await sha256File(candidate);
        if (candidateSha === expectedSha) {
          localPath = candidate;
          sourceSha = candidateSha;
          break;
        }
      }
    }
    if (expectedSha && sourceSha !== expectedSha) {
      skipped.push(`${value.name || row.id}: local source does not match the selected revision`);
      continue;
    }
    const { data: memberships, error: membershipError } = await supabase
      .from('organization_memberships')
      .select('organization_id,created_at')
      .eq('user_id', row.owner_id)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1);
    if (membershipError) throw membershipError;
    const organizationId = String(value.organizationId || memberships?.[0]?.organization_id || '').trim();
    if (!organizationId) {
      skipped.push(`${value.name || row.id}: no active organization`);
      continue;
    }
    const objectName = `shadow/${organizationId}/${row.id}/${sourceSha}.pdf`;
    let existingShadowJob = null;
    if (locatorOnly) {
      const existing = await supabase
        .from('ecos_hosted_index_jobs')
        .select('id,state,claimed_by,source_sha256,mode')
        .eq('organization_id', organizationId)
        .eq('document_id', String(row.id))
        .eq('source_sha256', sourceSha)
        .eq('mode', 'shadow')
        .maybeSingle();
      if (existing.error) throw existing.error;
      existingShadowJob = existing.data;
      if (!existingShadowJob) {
        throw new Error(`${value.name || row.id}: exact-checksum shadow job not found`);
      }
      if (
        existingShadowJob.claimed_by
        || ['fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring']
          .includes(existingShadowJob.state)
      ) {
        throw new Error(`${value.name || row.id}: shadow job is actively processing`);
      }
    }
    execFileSync('gcloud', ['storage', 'cp', '--quiet', localPath, `gs://${bucket}/${objectName}`], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    if (locatorOnly) {
      const prepared = await supabase
        .from('ecos_hosted_index_jobs')
        .update({
          source_provider: 'managed_upload',
          source_locator: { gcsBucket: bucket, gcsObject: objectName },
        })
        .eq('id', existingShadowJob.id)
        .eq('source_sha256', sourceSha)
        .eq('mode', 'shadow')
        .eq('state', existingShadowJob.state)
        .is('claimed_by', null)
        .select('id,state,source_provider,source_locator')
        .maybeSingle();
      if (prepared.error) throw prepared.error;
      if (!prepared.data) {
        throw new Error(`${value.name || row.id}: shadow job changed during locator preparation`);
      }
      if (
        prepared.data.source_provider !== 'managed_upload'
        || prepared.data.source_locator?.gcsBucket !== bucket
        || prepared.data.source_locator?.gcsObject !== objectName
      ) {
        throw new Error(
          `${value.name || row.id}: shadow job did not accept the exact managed source locator`,
        );
      }
      staged += 1;
      console.log(`PREPARED ${path.basename(localPath)}`);
      continue;
    }
    const configuration = await supabase.from('ecos_hosted_index_configuration').upsert({
      organization_id: organizationId,
      publication_mode: 'shadow',
      enabled: true,
    }, { onConflict: 'organization_id' });
    if (configuration.error) throw configuration.error;
    const insert = await supabase.from('ecos_hosted_index_jobs').upsert({
      organization_id: organizationId,
      project_id: String(value.projectId || value.projectName || projectName),
      document_id: String(row.id),
      source_owner_id: row.owner_id,
      source_provider: 'managed_upload',
      source_locator: { gcsBucket: bucket, gcsObject: objectName },
      source_sha256: sourceSha,
      source_page_count: Number(value.sourcePageCount) || null,
      source_revision: String(value.drawingRevision || value.webVersionGroupId || '').trim() || null,
      mode: 'shadow',
      state: 'queued',
      target_evidence_version: EVIDENCE_VERSION,
      failure_diagnostics: { targetEvidenceVersion: EVIDENCE_VERSION },
      customer_message: 'Vitruvius is validating this document in shadow mode.',
      requested_by: row.owner_id,
    }, { onConflict: 'organization_id,document_id,source_sha256,mode' });
    if (insert.error) throw insert.error;
    staged += 1;
    console.log(`STAGED ${path.basename(localPath)}`);
  }
  console.log(
    locatorOnly
      ? `ECOS shadow locator preparation: ${staged} prepared; ${skipped.length} skipped`
      : `ECOS shadow staging: ${staged} queued; ${skipped.length} skipped`,
  );
  for (const message of skipped) console.log(`SKIPPED ${message}`);
  if (!staged) process.exitCode = 1;
}

main().catch(error => {
  console.error(`ECOS shadow staging failed: ${error.message}`);
  process.exit(1);
});
