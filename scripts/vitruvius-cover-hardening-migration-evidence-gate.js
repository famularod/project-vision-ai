#!/usr/bin/env node

const fs = require('node:fs');
const {
  currentCandidate, postapplyReceiptPath, rehearsalReceiptPath,
  sha256, validateEvidence,
} = require('./vitruvius-cover-hardening-migration-evidence-lib');

function readReceipt(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} is missing.`);
  const bytes = fs.readFileSync(filePath);
  return { value: JSON.parse(bytes), digest: sha256(bytes) };
}
function runGate(options = {}) {
  const candidate = options.candidate || currentCandidate(options);
  const rehearsal = options.rehearsal
    ? { value: options.rehearsal, digest: sha256(`${JSON.stringify(options.rehearsal, null, 2)}\n`) }
    : readReceipt(rehearsalReceiptPath, 'Cover hardening rehearsal receipt');
  const postapply = options.postapply
    ? { value: options.postapply, digest: sha256(`${JSON.stringify(options.postapply, null, 2)}\n`) }
    : readReceipt(postapplyReceiptPath, 'Cover hardening postapply receipt');
  const expected = options.expectedDigests || {
    rehearsal: process.env.VITRUVIUS_COVER_HARDENING_REHEARSAL_RECEIPT_SHA256,
    postapply: process.env.VITRUVIUS_COVER_HARDENING_POSTAPPLY_RECEIPT_SHA256,
  };
  if (rehearsal.digest !== expected.rehearsal || postapply.digest !== expected.postapply) {
    throw new Error('Cover hardening independent receipt digest is missing or does not match.');
  }
  validateEvidence({
    rehearsal: rehearsal.value, postapply: postapply.value,
    candidate, now: options.now || new Date(),
  });
  return { candidate };
}
function main() {
  try {
    const result = runGate();
    console.log('VITRUVIUS_COVER_HARDENING_MIGRATION_EVIDENCE_OK');
    console.log(`Candidate commit: ${result.candidate.repository.commit}`);
  } catch (error) {
    console.error(`Cover hardening evidence gate FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
if (require.main === module) main();
module.exports = { runGate };
