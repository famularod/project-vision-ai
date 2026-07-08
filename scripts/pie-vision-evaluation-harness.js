#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const fixturePath = process.argv[2] || process.env.PIE_VISION_EVAL_FIXTURES;

if (!fixturePath) {
  console.log('PIE_VISION_EVAL_EXTERNAL_DATA_REQUIRED provide a labeled fixture JSON file.');
  process.exit(0);
}

const resolvedPath = path.resolve(process.cwd(), fixturePath);
const payload = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
const cases = Array.isArray(payload.cases) ? payload.cases : [];

if (cases.length === 0) {
  console.log('PIE_VISION_EVAL_NO_CASES fixture file must include a cases array.');
  process.exit(1);
}

const requiredEnv = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'PIE_EVAL_USER_EMAIL',
  'PIE_EVAL_USER_PASSWORD',
];
const missing = requiredEnv.filter(name => !process.env[name]);

if (missing.length > 0) {
  console.log(`PIE_VISION_EVAL_EXTERNAL_EXECUTION_REQUIRED missing ${missing.join(', ')}`);
  process.exit(0);
}

const report = cases.map(item => ({
  id: item.id,
  baselineEvidenceId: item.baselineEvidenceId,
  currentEvidenceId: item.currentEvidenceId,
  expected: item.expected,
  actual: null,
  status: 'not_run_without_live_supabase_client',
  divergence: ['Harness consumes human-labeled cases and is ready for live pie-photo-vision execution.'],
}));

console.log(JSON.stringify({
  workflow: 'pie-photo-vision-evaluation-harness',
  caseCount: cases.length,
  report,
}, null, 2));
