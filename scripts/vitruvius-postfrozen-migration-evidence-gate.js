#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  currentCandidate,
  postapplyReceiptPath,
  rehearsalReceiptPath,
  sha256,
  validateEvidence,
} = require('./vitruvius-postfrozen-migration-evidence-lib');

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} is missing.`);
  const bytes = fs.readFileSync(filePath, 'utf8');
  return { value: JSON.parse(bytes), digest: sha256(bytes) };
}

function receiptBundle(value, filePath, label) {
  if (value) {
    const bytes = `${JSON.stringify(value, null, 2)}\n`;
    return { value, digest: sha256(bytes) };
  }
  return readJson(filePath, label);
}

function requireIndependentDigest(actual, expected, label) {
  if (!/^[a-f0-9]{64}$/.test(String(expected || '')) || actual !== expected) {
    throw new Error(`${label} independent receipt digest is missing or does not match.`);
  }
}

function runGate(options = {}) {
  const candidate = options.candidate || currentCandidate(options);
  const rehearsalBundle = receiptBundle(options.rehearsal,
    rehearsalReceiptPath,
    'Post-frozen rollback rehearsal receipt',
  );
  const postapplyBundle = receiptBundle(options.postapply,
    postapplyReceiptPath,
    'Post-frozen post-apply receipt',
  );
  const expectedDigests = options.expectedDigests || {
    rehearsal: process.env.VITRUVIUS_POSTFROZEN_REHEARSAL_RECEIPT_SHA256,
    postapply: process.env.VITRUVIUS_POSTFROZEN_POSTAPPLY_RECEIPT_SHA256,
  };
  requireIndependentDigest(
    rehearsalBundle.digest,
    expectedDigests?.rehearsal,
    'Post-frozen rehearsal',
  );
  requireIndependentDigest(
    postapplyBundle.digest,
    expectedDigests?.postapply,
    'Post-frozen postapply',
  );
  const rehearsal = rehearsalBundle.value;
  const postapply = postapplyBundle.value;
  validateEvidence({ rehearsal, postapply, candidate, now: options.now || new Date() });
  return { candidate, rehearsal, postapply };
}

function main() {
  try {
    const result = runGate();
    console.log('VITRUVIUS_POSTFROZEN_MIGRATION_EVIDENCE_OK');
    console.log(`Candidate commit: ${result.candidate.repository.commit}`);
  } catch (error) {
    console.error(`Post-frozen migration evidence gate FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { runGate };
