#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(
  root,
  'supabase/migrations/20260809040523_ecos_hosted_exact_target_claim.sql',
), 'utf8');

const requireText = (text, label) => {
  assert(migration.includes(text), `${label}: missing ${text}`);
};

for (const [text, label] of [
  ['create or replace function public.ecos_claim_exact_hosted_index_job(', 'additive exact RPC'],
  ["auth.role() <> 'service_role'", 'service identity guard'],
  ["normalized_source_sha256 !~ '^[a-f0-9]{64}$'", 'checksum shape guard'],
  ["normalized_mode <> 'shadow'", 'shadow-only guard'],
  ["normalized_evidence_version <> 'ecos-hosted-evidence/1.3'", 'evidence 1.3 guard'],
  ["job.id = p_job_id", 'exact job guard'],
  ['job.source_sha256 = normalized_source_sha256', 'exact source guard'],
  ['job.mode = normalized_mode', 'exact mode guard'],
  ['config.enabled = true', 'enabled configuration guard'],
  ['config.publication_mode = normalized_mode', 'configuration mode guard'],
  ['job.committed_evidence_version is null', 'uncommitted contract guard'],
  ['job.target_evidence_version', 'durable evidence contract marker'],
  ["nullif(trim(job.failure_diagnostics->>'targetEvidenceVersion'), ''),\n      job.target_evidence_version", 'fresh reset marker precedence'],
  ["job.state in ('queued', 'temporarily_unavailable')", 'claimable state guard'],
  ['coalesce(job.next_attempt_at, now()) <= now()', 'retry due guard'],
  ['job.lease_expires_at is null or job.lease_expires_at < now()', 'target lease guard'],
  ['job.retry_count < job.max_retry_count', 'retry cap guard'],
  ['active_job.lease_expires_at >= now()', 'organization active lease guard'],
  [') < config.max_concurrent_jobs', 'organization concurrency guard'],
  ["pg_advisory_xact_lock(hashtext('ecos_hosted_index_global_claim'))", 'shared claim lock'],
  ['for update of job skip locked', 'row claim lock'],
  ['where job.id = selected_job.id', 'single-row update'],
  ['from public, anon, authenticated', 'public role revocation'],
  ['to service_role', 'service-only grant'],
]) requireText(text, label);

assert.equal(
  migration.includes('create or replace function public.ecos_claim_hosted_index_job('),
  false,
  'The additive migration must not replace the ordinary production claim path',
);

const now = 1000;
const exact = {
  jobId: '59736b43-7f82-49ed-876a-bdf6342810a0',
  sourceSha: 'a'.repeat(64),
  mode: 'shadow',
  evidenceVersion: 'ecos-hosted-evidence/1.3',
};
const baselineJob = {
  id: exact.jobId,
  sourceSha: exact.sourceSha,
  mode: 'shadow',
  targetEvidenceVersion: exact.evidenceVersion,
  committedEvidenceVersion: null,
  state: 'queued',
  nextAttemptAt: null,
  leaseExpiresAt: null,
  retryCount: 0,
  maxRetryCount: 8,
};
const baselineConfig = {
  enabled: true,
  publicationMode: 'shadow',
  maxConcurrentJobs: 2,
};

const eligible = (job, config, target = exact, activeOrganizationJobs = 0) => (
  job.id === target.jobId
  && job.sourceSha === target.sourceSha
  && job.mode === target.mode
  && target.mode === 'shadow'
  && target.evidenceVersion === 'ecos-hosted-evidence/1.3'
  && job.targetEvidenceVersion === target.evidenceVersion
  && job.committedEvidenceVersion === null
  && config.enabled === true
  && config.publicationMode === target.mode
  && (
    (
      ['queued', 'temporarily_unavailable'].includes(job.state)
      && (job.nextAttemptAt === null || job.nextAttemptAt <= now)
      && (job.leaseExpiresAt === null || job.leaseExpiresAt < now)
    )
    || (
      ['fetching_source', 'extracting', 'mapping', 'awaiting_visual', 'assuring'].includes(job.state)
      && job.leaseExpiresAt !== null
      && job.leaseExpiresAt < now
    )
  )
  && job.retryCount < job.maxRetryCount
  && activeOrganizationJobs < config.maxConcurrentJobs
);

assert.equal(eligible(baselineJob, baselineConfig), true, 'The current exact target must be claimable');

const rejectCases = [
  ['wrong job id', { job: { ...baselineJob, id: '00000000-0000-0000-0000-000000000000' } }],
  ['wrong source SHA', { job: { ...baselineJob, sourceSha: 'b'.repeat(64) } }],
  ['wrong job mode', { job: { ...baselineJob, mode: 'live' } }],
  ['disabled config', { config: { ...baselineConfig, enabled: false } }],
  ['wrong config mode', { config: { ...baselineConfig, publicationMode: 'live' } }],
  ['wrong evidence contract', { job: { ...baselineJob, targetEvidenceVersion: 'ecos-hosted-evidence/1.2' } }],
  ['already committed', { job: { ...baselineJob, committedEvidenceVersion: exact.evidenceVersion } }],
  ['active target lease', { job: { ...baselineJob, leaseExpiresAt: now + 1 } }],
  ['active processing lease', { job: { ...baselineJob, state: 'extracting', leaseExpiresAt: now + 1 } }],
  ['retry not due', { job: { ...baselineJob, nextAttemptAt: now + 1 } }],
  ['retry cap reached', { job: { ...baselineJob, retryCount: 8 } }],
  ['organization capacity full', { activeOrganizationJobs: 2 }],
];

for (const [label, overrides] of rejectCases) {
  assert.equal(
    eligible(
      overrides.job || baselineJob,
      overrides.config || baselineConfig,
      overrides.target || exact,
      overrides.activeOrganizationJobs || 0,
    ),
    false,
    `${label} must fail closed`,
  );
}

assert.equal(
  eligible({ ...baselineJob, state: 'extracting', leaseExpiresAt: now - 1 }, baselineConfig),
  true,
  'An exact stale lease remains recoverable under the ordinary retry guard',
);

console.log(`ECOS hosted exact-target claim contract PASS: ${rejectCases.length} fail-closed cases`);
