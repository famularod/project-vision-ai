#!/usr/bin/env node

const path = require('node:path');

const { runGate } = require('./ecos-ask-live-evidence-gate');
const repoRoot = path.resolve(__dirname, '..');

const outcome = runGate(new Date(), {
  definitionPath: path.join(repoRoot, 'validation', 'ecos', 'ask-ecos-2321-real-world-cases.json'),
  resultPath: path.join(repoRoot, 'validation', 'output', 'ecos-ask-2321-live-acceptance.json'),
});
if (!outcome.passed) process.exitCode = 1;
