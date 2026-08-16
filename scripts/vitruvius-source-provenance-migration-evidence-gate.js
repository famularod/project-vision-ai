#!/usr/bin/env node

const fs = require('node:fs');
const {
  currentCandidate,
  postapplyReceiptPath,
  rehearsalReceiptPath,
  sha256,
  validateEvidence,
} = require('./vitruvius-source-provenance-migration-evidence-lib');

function readReceipt(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} is missing.`);
  const bytes = fs.readFileSync(filePath);
  let value;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  return { value, digest: sha256(bytes) };
}

function suppliedReceipt(value) {
  return {
    value,
    digest: sha256(`${JSON.stringify(value, null, 2)}\n`),
  };
}

function runGate(options = {}) {
  const candidate = options.candidate || currentCandidate(options);
  const rehearsal = options.rehearsal
    ? suppliedReceipt(options.rehearsal)
    : readReceipt(
        options.rehearsalReceiptPath || rehearsalReceiptPath,
        'Source-provenance rehearsal receipt',
      );
  const postapply = options.postapply
    ? suppliedReceipt(options.postapply)
    : readReceipt(
        options.postapplyReceiptPath || postapplyReceiptPath,
        'Source-provenance postapply receipt',
      );
  const expected = options.expectedDigests || {
    rehearsal:
      process.env.VITRUVIUS_SOURCE_PROVENANCE_REHEARSAL_RECEIPT_SHA256,
    postapply:
      process.env.VITRUVIUS_SOURCE_PROVENANCE_POSTAPPLY_RECEIPT_SHA256,
  };
  if (!/^[a-f0-9]{64}$/.test(String(expected.rehearsal || '')) ||
      !/^[a-f0-9]{64}$/.test(String(expected.postapply || '')) ||
      rehearsal.digest !== expected.rehearsal ||
      postapply.digest !== expected.postapply) {
    throw new Error(
      'Source-provenance independent receipt digest is missing or does not match.',
    );
  }
  validateEvidence({
    rehearsal: rehearsal.value,
    postapply: postapply.value,
    candidate,
    now: options.now || new Date(),
  });
  return { candidate };
}

function main() {
  try {
    const result = runGate();
    console.log('VITRUVIUS_SOURCE_PROVENANCE_MIGRATION_EVIDENCE_OK');
    console.log(`Candidate commit: ${result.candidate.repository.commit}`);
  } catch (error) {
    console.error(`Source-provenance evidence gate FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { readReceipt, runGate };
