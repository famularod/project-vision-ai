#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

// The workflow's own commands have to be able to run, not only be present
// (independent review R13: the simulator-selection step put backslash-escaped
// double quotes inside a single-quoted `node -e` program, which Node cannot
// parse, and this contract passed because it only looked for markers).
for (const workflowName of fs.readdirSync(path.join(root, '.github', 'workflows'))) {
  const text = fs.readFileSync(path.join(root, '.github', 'workflows', workflowName), 'utf8');
  for (const [, program] of text.matchAll(/node\s+(?:-e|--eval)\s+'([^']*)'/g)) {
    assert.doesNotThrow(
      () => new vm.Script(program),
      `${workflowName} has an inline node program that does not parse: ${program.slice(0, 60)}…`,
    );
  }
  for (const [, script] of text.matchAll(/\bnode\s+(scripts\/[\w./-]+\.js)\b/g)) {
    assert(fs.existsSync(path.join(root, script)), `${workflowName} runs ${script}, which does not exist.`);
  }
}
assert(
  workflow.includes('node scripts/select-ios-simulator.js'),
  'The iOS job must choose its simulator with scripts/select-ios-simulator.js.',
);

// Run the simulator selection the way the job does, against simctl-shaped JSON.
const selector = path.join(root, 'scripts', 'select-ios-simulator.js');
const selectFrom = input => spawnSync(process.execPath, [selector], { input, encoding: 'utf8', timeout: 30_000 });
const simctl = devices => JSON.stringify({ devices });
const chosen = selectFrom(simctl({
  'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [
    { name: 'iPad Pro 13-inch (M5)', udid: 'IPAD-0001', isAvailable: true },
    { name: 'iPhone 17 Pro', udid: 'PHONE-UNAVAILABLE', isAvailable: false },
    { name: 'iPhone 17', udid: 'PHONE-0002', isAvailable: true },
  ],
  'com.apple.CoreSimulator.SimRuntime.watchOS-26-0': [
    { name: 'Apple Watch Ultra', udid: 'WATCH-0003', isAvailable: true },
  ],
}));
assert.equal(chosen.status, 0, `Simulator selection failed: ${chosen.stderr}`);
assert.equal(chosen.stdout, 'PHONE-0002', 'Simulator selection must print the first available iPhone and nothing else.');
const noPhone = selectFrom(simctl({ 'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{ name: 'iPad Air', udid: 'IPAD-0004', isAvailable: true }] }));
assert.equal(noPhone.status, 1, 'With no available iPhone the selection must fail the job.');
assert.equal(noPhone.stdout, '', 'With no available iPhone the selection must print no UDID.');
const notJson = selectFrom('xcrun: error: unable to find utility "simctl"');
assert.equal(notJson.status, 1, 'Output that is not the simulator list must fail the job.');
assert.equal(notJson.stdout, '', 'Output that is not the simulator list must print no UDID.');

console.log(`Maestro contract PASS: ${expectedFlows.length} current flows plus iOS/Android CI wiring.`);
