#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readJson = relativePath => JSON.parse(
  fs.readFileSync(path.join(root, relativePath), 'utf8'),
);

const policy = readJson('validation/jarvis/release-evidence-policy.json');
const template = readJson('validation/jarvis/device-evidence-template.json');
const visual = readJson('validation/jarvis/visual-regression-baselines.json');
const defects = readJson('validation/jarvis/escaped-defects.json');

assert.equal(policy.schemaVersion, 1);
assert.deepEqual(policy.identity, {
  product: 'Vitruvius',
  intelligenceEngine: 'Core',
  qaSystem: 'Jarvis',
  qaNameStatus: 'working_name',
});
assert.deepEqual(policy.requiredPlatforms, ['iphone', 'ipad', 'web']);
assert(policy.requiredDeviceJourneys.length >= 6);
assert(policy.requiredDeviceJourneys.some(journey => journey.id === 'three-client-sync'));
assert(policy.requiredDeviceJourneys.some(journey => journey.id === 'documents-drawings'));

const budgetIds = new Set();
for (const budget of policy.performanceBudgets) {
  assert(budget.id && !budgetIds.has(budget.id), `Duplicate performance budget: ${budget.id}`);
  budgetIds.add(budget.id);
  assert(Number.isFinite(budget.maximumMs) && budget.maximumMs > 0);
  assert(['physical_device', 'live_three_client'].includes(budget.source));
  assert.equal(budget.releaseBlockingAfterBaseline, true);
}
assert(budgetIds.has('primary-navigation-feedback'));
assert(budgetIds.has('task-save-local-confirmation'));
assert(budgetIds.has('peer-sync-propagation'));
assert.equal(policy.certificationRules.automatedPassCertifiesPhysicalDevices, false);
assert.equal(policy.certificationRules.automatedPassCertifiesExternalProviders, false);

assert.equal(template.schemaVersion, 1);
assert.equal(template.overallStatus, 'pending');
for (const platform of policy.requiredPlatforms) {
  assert.equal(template.platforms[platform]?.status, 'pending');
}
assert.equal(template.visualReview.status, 'pending');
assert.equal(template.externalProviders.status, 'pending');

assert.equal(visual.schemaVersion, 1);
assert.equal(visual.status, 'baseline_required');
assert.equal(visual.comparisonMode, 'advisory_until_approved');
for (const platform of policy.requiredPlatforms) {
  const definition = visual.platforms.find(item => item.id === platform);
  assert(definition, `Missing visual definition for ${platform}`);
  assert(definition.surfaces.includes('overview'));
  assert(definition.surfaces.includes('tasks'));
  assert(definition.surfaces.includes('documents'));
  assert(definition.surfaces.includes('reports'));
}
for (const rule of [
  'no_text_clipping',
  'no_mid_word_wrapping',
  'no_hidden_controls',
  'no_horizontal_overflow',
]) {
  assert(visual.reviewRules.includes(rule), `Missing visual review rule: ${rule}`);
}

assert(defects.defects.length >= 25);
for (const defect of defects.defects) {
  assert(defect.manualValidation?.trim(), `${defect.id} needs a manual replay step.`);
  assert(defect.limitations?.trim(), `${defect.id} needs an honest automation limitation.`);
}

console.log(
  `Jarvis release-evidence contracts PASS: ${policy.requiredDeviceJourneys.length} device journeys, `
  + `${policy.performanceBudgets.length} performance budgets, `
  + `${visual.platforms.length} visual platforms, and ${defects.defects.length} historical defect families.`,
);
