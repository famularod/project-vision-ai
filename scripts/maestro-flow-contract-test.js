#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const flowDirectory = path.join(root, 'e2e', 'maestro');
const expectedFlows = [
  '01-app-launches.yaml',
  '02-bottom-navigation.yaml',
  '03-projects-opens.yaml',
  '04-project-overview-opens.yaml',
  '05-capture-starts.yaml',
  '06-reports-opens.yaml',
  '07-more-admin-opens.yaml',
  '08-task-filters-read-only.yaml',
];
const requiredVisibleText = {
  '01-app-launches.yaml': ['Active Projects', 'Overview', 'Tasks', 'Talk', 'Reports'],
  '02-bottom-navigation.yaml': ['Work requiring attention', 'Prepared Report'],
  '03-projects-opens.yaml': ['2321 Compliance Project', '2375 Compliance Project', 'Add project'],
  '04-project-overview-opens.yaml': ['Tasks and Schedule', 'New Field Update'],
  '05-capture-starts.yaml': ['Capture Evidence', 'Take Photo'],
  '06-reports-opens.yaml': ['Prepared Report', 'Report Options', 'Approve Report'],
  '07-more-admin-opens.yaml': ['Open Settings', 'Sync Now', 'Export Complete Backup'],
  '08-task-filters-read-only.yaml': ['Work requiring attention', '7 Days', 'All'],
};

for (const name of expectedFlows) {
  const filePath = path.join(flowDirectory, name);
  assert(fs.existsSync(filePath), `Missing Maestro flow: ${name}`);
  const source = fs.readFileSync(filePath, 'utf8');
  assert.match(source, /^appId:\s*\$\{APP_ID\}/m, `${name} must use the injected app id.`);
  assert.match(source, /-\s+launchApp\b/, `${name} must launch the app.`);
  assert.doesNotMatch(source, /Project Brief|Project Vision AI|Building 2375 Compliance/, `${name} contains stale product copy.`);
  for (const text of requiredVisibleText[name]) {
    assert(source.includes(text), `${name} does not cover the current "${text}" control.`);
  }
}

for (const name of [
  '01-app-launches.yaml',
  '02-bottom-navigation.yaml',
  '03-projects-opens.yaml',
  '04-project-overview-opens.yaml',
  '06-reports-opens.yaml',
  '07-more-admin-opens.yaml',
  '08-task-filters-read-only.yaml',
]) {
  const source = fs.readFileSync(path.join(flowDirectory, name), 'utf8');
  assert.match(source, /-\s+takeScreenshot:/, `${name} must capture visual evidence.`);
}

const readOnlyFilterFlow = fs.readFileSync(
  path.join(flowDirectory, '08-task-filters-read-only.yaml'),
  'utf8',
);
assert.doesNotMatch(
  readOnlyFilterFlow,
  /\b(?:inputText|eraseText|Save|Delete|Discard|Approve Report|Take Photo)\b/,
  'The task-filter evidence flow must remain read-only.',
);

const workflowPath = path.join(root, '.github', 'workflows', 'mobile-e2e.yml');
assert(fs.existsSync(workflowPath), 'The iOS/Android Maestro CI workflow is missing.');
const workflow = fs.readFileSync(workflowPath, 'utf8');
for (const marker of ['maestro-ios', 'maestro-android', 'npm run test:e2e:maestro']) {
  assert(workflow.includes(marker), `Maestro CI workflow is missing ${marker}.`);
}
assert.doesNotMatch(
  workflow,
  /\b(?:eas\s+(?:build|submit|update)|supabase\s+functions\s+deploy)\b/i,
  'Maestro CI must not deploy builds or backend functions.',
);

console.log(`Maestro contract PASS: ${expectedFlows.length} current flows plus iOS/Android CI wiring.`);
