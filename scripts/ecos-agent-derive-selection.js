#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  selectQualityFirstModel,
} = require('./ecos-agent-model-selection');

const options = parseArguments(process.argv.slice(2));
const inputPath = path.resolve(options.input);
const outputPath = path.resolve(options.output);
const sourceBytes = fs.readFileSync(inputPath);
const source = JSON.parse(sourceBytes.toString('utf8'));
const integrityFailures = source.summary?.integrityFailures;

if (!Array.isArray(source.summary?.scores) || source.summary.scores.length < 1) {
  throw new Error('source_receipt_scores_missing');
}
if (source.summary.failed !== 0) throw new Error('source_receipt_has_failures');
if (!Array.isArray(integrityFailures) || integrityFailures.length !== 0) {
  throw new Error('source_receipt_integrity_failed');
}

const selection = selectQualityFirstModel(source.summary.scores);
if (!selection.selectedModel) throw new Error('no_eligible_model');

const receipt = {
  schemaVersion: 'ecos-agent-model-selection/1.0',
  generatedAt: new Date().toISOString(),
  sourceReceipt: {
    schemaVersion: source.schemaVersion || null,
    sha256: sha256(sourceBytes),
  },
  activityClass: source.activityClass || null,
  candidateCommit: options.candidateCommit || null,
  selectionPolicy: selection.policy,
  selectedModel: selection.selectedModel,
  rankedScores: selection.rankedScores,
};

atomicWrite(outputPath, receipt);
console.log(JSON.stringify({
  output: outputPath,
  receiptSha256: sha256(fs.readFileSync(outputPath)),
  selectedModel: receipt.selectedModel,
  selectionPolicy: receipt.selectionPolicy,
}, null, 2));

function parseArguments(argumentsList) {
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith('--')) throw new Error(`unexpected_argument:${argument}`);
    const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) =>
      letter.toUpperCase()
    );
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing_value:${argument}`);
    values[key] = value;
    index += 1;
  }
  if (!values.input || !values.output) throw new Error('input_and_output_required');
  return values;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
