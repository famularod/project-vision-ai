#!/usr/bin/env node

const fs = require('node:fs');
const {
  EXPECTED_MIGRATION_CHAIN,
  EXPECTED_PROJECT_REF,
  SEALED_HISTORICAL_EVIDENCE,
  assertHistoricalCandidate,
  assertHistoricalCoverCandidate,
  assertHistoricalSourceProvenanceRehearsalCandidate,
  assertHistoricalDatabaseTarget,
  assertSealedReceiptBundle,
  postapplyReceiptPath,
  rehearsalReceiptPath,
  repositorySnapshot,
  sha256,
  validateHistoricalEvidenceOrder,
  validateHistoricalRepository,
  validateMigrationEvidence,
} = require('./ecos-build160-migration-evidence-lib');
const {
  postapplyReceiptPath: postFrozenPostapplyReceiptPath,
  rehearsalReceiptPath: postFrozenRehearsalReceiptPath,
  validateEvidence: validatePostFrozenEvidence,
} = require('./vitruvius-postfrozen-migration-evidence-lib');
const {
  postapplyReceiptPath: coverPostapplyReceiptPath,
  rehearsalReceiptPath: coverRehearsalReceiptPath,
  validateEvidence: validateCoverEvidence,
} = require('./vitruvius-cover-hardening-migration-evidence-lib');
const {
  SOURCE_PROVENANCE_DATABASE_TARGET,
  rehearsalReceiptPath: sourceProvenanceRehearsalReceiptPath,
} = require('./vitruvius-source-provenance-migration-evidence-lib');
const {
  SOURCE_PROVENANCE_ACL_DATABASE_TARGET,
  currentCandidate: currentSourceProvenanceAclCandidate,
  assertPredecessorSourceProvenanceEvidence,
  postapplyReceiptPath: sourceProvenanceAclPostapplyReceiptPath,
  rehearsalReceiptPath: sourceProvenanceAclRehearsalReceiptPath,
  validateEvidence: validateSourceProvenanceAclEvidence,
} = require('./vitruvius-source-provenance-acl-migration-evidence-lib');

function readJson(filePath, label) {
  return readReceipt(filePath, label).value;
}

function readReceipt(filePath, label) {
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${label} is missing; run the controlled database evidence step.`);
    }
    throw error;
  }
  try {
    return { value: JSON.parse(bytes), digest: sha256(bytes) };
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function receiptBundle(value, filePath, label) {
  if (!value) return readReceipt(filePath, label);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  return { value, digest: sha256(bytes) };
}

function assertCurrentReceiptBundle(bundle, expectedSha256, label) {
  if (!bundle?.value || !/^[a-f0-9]{64}$/.test(String(bundle.digest || ''))) {
    throw new Error(`${label} is missing or malformed.`);
  }
  if (!/^[a-f0-9]{64}$/.test(String(expectedSha256 || '')) ||
      bundle.digest !== expectedSha256) {
    throw new Error(
      'Source-provenance independent receipt digest is missing or does not match.',
    );
  }
  return bundle.value;
}

function runGate(options = {}) {
  const repository = options.repository || options.current?.repository || repositorySnapshot(options);
  validateHistoricalRepository(repository, options);
  const receiptPaths = options.receiptPaths || {};
  const frozenRehearsalBundle = receiptBundle(
    options.rehearsal,
    receiptPaths.rehearsal || rehearsalReceiptPath,
    'The sealed frozen-five rollback rehearsal receipt',
  );
  const frozenPostapplyBundle = receiptBundle(
    options.postapply,
    receiptPaths.postapply || postapplyReceiptPath,
    'The sealed frozen-five post-apply receipt',
  );
  const postFrozenRehearsalBundle = receiptBundle(
    options.postFrozenRehearsal,
    receiptPaths.postFrozenRehearsal || postFrozenRehearsalReceiptPath,
    'The sealed post-frozen rollback rehearsal receipt',
  );
  const postFrozenPostapplyBundle = receiptBundle(
    options.postFrozenPostapply,
    receiptPaths.postFrozenPostapply || postFrozenPostapplyReceiptPath,
    'The sealed post-frozen post-apply receipt',
  );
  const coverRehearsalBundle = receiptBundle(
    options.coverRehearsal,
    receiptPaths.coverRehearsal || coverRehearsalReceiptPath,
    'The sealed cover-hardening rollback rehearsal receipt',
  );
  const coverPostapplyBundle = receiptBundle(
    options.coverPostapply,
    receiptPaths.coverPostapply || coverPostapplyReceiptPath,
    'The sealed cover-hardening post-apply receipt',
  );
  const sourceProvenanceRehearsalBundle = receiptBundle(
    options.sourceProvenanceRehearsal,
    receiptPaths.sourceProvenanceRehearsal || sourceProvenanceRehearsalReceiptPath,
    'The sealed source-provenance rollback rehearsal receipt',
  );
  const sourceProvenanceAclRehearsalBundle = receiptBundle(
    options.sourceProvenanceAclRehearsal,
    receiptPaths.sourceProvenanceAclRehearsal || sourceProvenanceAclRehearsalReceiptPath,
    'The current source-provenance ACL rollback rehearsal receipt',
  );
  const sourceProvenanceAclPostapplyBundle = receiptBundle(
    options.sourceProvenanceAclPostapply,
    receiptPaths.sourceProvenanceAclPostapply || sourceProvenanceAclPostapplyReceiptPath,
    'The current source-provenance ACL post-apply receipt',
  );
  const rehearsal = assertSealedReceiptBundle(
    frozenRehearsalBundle,
    SEALED_HISTORICAL_EVIDENCE.frozenFive.rehearsalSha256,
    'The frozen-five rollback rehearsal receipt',
  );
  const postapply = assertSealedReceiptBundle(
    frozenPostapplyBundle,
    SEALED_HISTORICAL_EVIDENCE.frozenFive.postapplySha256,
    'The frozen-five post-apply receipt',
  );
  const postFrozenRehearsal = assertSealedReceiptBundle(
    postFrozenRehearsalBundle,
    SEALED_HISTORICAL_EVIDENCE.postFrozen.rehearsalSha256,
    'The post-frozen rollback rehearsal receipt',
  );
  const postFrozenPostapply = assertSealedReceiptBundle(
    postFrozenPostapplyBundle,
    SEALED_HISTORICAL_EVIDENCE.postFrozen.postapplySha256,
    'The post-frozen post-apply receipt',
  );
  const coverRehearsal = assertSealedReceiptBundle(
    coverRehearsalBundle,
    SEALED_HISTORICAL_EVIDENCE.coverHardening.rehearsalSha256,
    'The cover-hardening rollback rehearsal receipt',
  );
  const coverPostapply = assertSealedReceiptBundle(
    coverPostapplyBundle,
    SEALED_HISTORICAL_EVIDENCE.coverHardening.postapplySha256,
    'The cover-hardening post-apply receipt',
  );
  const sourceProvenanceRehearsal = assertSealedReceiptBundle(
    sourceProvenanceRehearsalBundle,
    SEALED_HISTORICAL_EVIDENCE.sourceProvenanceRehearsal.rehearsalSha256,
    'The source-provenance rollback rehearsal receipt',
  );
  const sourceProvenanceAclExpectedDigests = options.sourceProvenanceAclExpectedDigests || {
    rehearsal: process.env.VITRUVIUS_SOURCE_PROVENANCE_ACL_REHEARSAL_RECEIPT_SHA256,
    postapply: process.env.VITRUVIUS_SOURCE_PROVENANCE_ACL_POSTAPPLY_RECEIPT_SHA256,
  };
  const sourceProvenanceAclRehearsal = assertCurrentReceiptBundle(
    sourceProvenanceAclRehearsalBundle,
    sourceProvenanceAclExpectedDigests.rehearsal,
    'The source-provenance ACL rollback rehearsal receipt',
  );
  const sourceProvenanceAclPostapply = assertCurrentReceiptBundle(
    sourceProvenanceAclPostapplyBundle,
    sourceProvenanceAclExpectedDigests.postapply,
    'The source-provenance ACL post-apply receipt',
  );

  const directDatabase = {
    host: `db.${EXPECTED_PROJECT_REF}.supabase.co`,
    port: '5432',
    connectionMode: 'direct',
    sslMode: 'require',
  };
  const managementDatabase = {
    host: `${EXPECTED_PROJECT_REF}.supabase.co`,
    port: 443,
    connectionMode: 'management-api',
    sslMode: 'require',
  };
  for (const [receipt, database, label] of [
    [rehearsal, directDatabase, 'Frozen-five rehearsal'],
    [postapply, directDatabase, 'Frozen-five postapply'],
    [postFrozenRehearsal, directDatabase, 'Post-frozen rehearsal'],
    [postFrozenPostapply, directDatabase, 'Post-frozen postapply'],
    [coverRehearsal, managementDatabase, 'Cover-hardening rehearsal'],
    [coverPostapply, managementDatabase, 'Cover-hardening postapply'],
    [
      sourceProvenanceRehearsal,
      SOURCE_PROVENANCE_DATABASE_TARGET,
      'Source-provenance rehearsal',
    ],
    [
      sourceProvenanceAclRehearsal,
      SOURCE_PROVENANCE_ACL_DATABASE_TARGET,
      'Source-provenance ACL rehearsal',
    ],
    [
      sourceProvenanceAclPostapply,
      SOURCE_PROVENANCE_ACL_DATABASE_TARGET,
      'Source-provenance ACL postapply',
    ],
  ]) {
    assertHistoricalDatabaseTarget(receipt, database, label);
  }

  assertHistoricalCandidate(
    rehearsal.candidate,
    SEALED_HISTORICAL_EVIDENCE.frozenFive,
    EXPECTED_MIGRATION_CHAIN.slice(0, 5),
    'Frozen-five rehearsal',
  );
  assertHistoricalCandidate(
    postapply.candidate,
    SEALED_HISTORICAL_EVIDENCE.frozenFive,
    EXPECTED_MIGRATION_CHAIN.slice(0, 5),
    'Frozen-five postapply',
  );
  assertHistoricalCandidate(
    postFrozenRehearsal.candidate,
    SEALED_HISTORICAL_EVIDENCE.postFrozen,
    EXPECTED_MIGRATION_CHAIN.slice(5, 7),
    'Post-frozen rehearsal',
  );
  assertHistoricalCandidate(
    postFrozenPostapply.candidate,
    SEALED_HISTORICAL_EVIDENCE.postFrozen,
    EXPECTED_MIGRATION_CHAIN.slice(5, 7),
    'Post-frozen postapply',
  );
  assertHistoricalCoverCandidate(coverRehearsal.candidate);
  assertHistoricalCoverCandidate(coverPostapply.candidate);
  if (sourceProvenanceRehearsal?.schemaVersion !== 1 ||
      sourceProvenanceRehearsal.kind !== 'rehearsal' ||
      sourceProvenanceRehearsal.receipt !== 'VITRUVIUS_SOURCE_PROVENANCE_REHEARSAL_OK') {
    throw new Error('The sealed source-provenance rehearsal receipt is malformed.');
  }
  assertHistoricalSourceProvenanceRehearsalCandidate(
    sourceProvenanceRehearsal.candidate,
  );

  validateMigrationEvidence({
    rehearsal,
    postapply,
    current: rehearsal.candidate,
    now: new Date(postapply.finishedAt),
  });
  validatePostFrozenEvidence({
    rehearsal: postFrozenRehearsal,
    postapply: postFrozenPostapply,
    candidate: postFrozenRehearsal.candidate,
    now: new Date(postFrozenPostapply.finishedAt),
  });
  validateCoverEvidence({
    rehearsal: coverRehearsal,
    postapply: coverPostapply,
    candidate: coverRehearsal.candidate,
    now: new Date(coverPostapply.finishedAt),
  });
  const verifiedSourceProvenancePredecessor =
    assertPredecessorSourceProvenanceEvidence({
      repositoryCommit: repository.commit,
    });
  const sourceProvenanceAclCandidate = currentSourceProvenanceAclCandidate({
    priorEvidence: verifiedSourceProvenancePredecessor,
    repository,
  });
  validateSourceProvenanceAclEvidence({
    rehearsal: sourceProvenanceAclRehearsal,
    postapply: sourceProvenanceAclPostapply,
    candidate: sourceProvenanceAclCandidate,
    now: options.now || new Date(),
  });
  validateHistoricalEvidenceOrder({
    frozenFive: { rehearsal, postapply },
    postFrozen: { rehearsal: postFrozenRehearsal, postapply: postFrozenPostapply },
    coverHardening: { rehearsal: coverRehearsal, postapply: coverPostapply },
    sourceProvenance: {
      rehearsal: sourceProvenanceRehearsal,
    },
    sourceProvenanceAcl: {
      rehearsal: sourceProvenanceAclRehearsal,
      postapply: sourceProvenanceAclPostapply,
    },
  });
  return {
    commit: repository.commit,
    migrationCount: EXPECTED_MIGRATION_CHAIN.length,
    rehearsalFinishedAt: sourceProvenanceAclRehearsal.finishedAt,
    postapplyFinishedAt: sourceProvenanceAclPostapply.finishedAt,
  };
}

function main() {
  try {
    const result = runGate();
    console.log('ECOS Build 160 migration evidence gate PASS.');
    console.log(`Candidate commit: ${result.commit}`);
    console.log(`Bound migrations: ${result.migrationCount}`);
    console.log(`Rollback rehearsal: ${result.rehearsalFinishedAt}`);
    console.log(`Post-apply verification: ${result.postapplyFinishedAt}`);
  } catch (error) {
    console.error(`ECOS Build 160 migration evidence gate FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { readJson, readReceipt, runGate };
