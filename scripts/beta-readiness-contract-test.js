#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const gate = require('./beta-readiness-gate');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const parse = relative => JSON.parse(read(relative));

const acceptance = read('docs/VITRUVIUS_CONTROLLED_BETA_ACCEPTANCE.md');
for (const required of [
  'does not authorize a build',
  'Physical device, web, offline, and accessibility acceptance',
  'Cloud synchronization is a hard release blocker.',
  'three consecutive',
  'zero pending or retry items',
  'Support, operations, and recovery acceptance',
  'Outside-user pilot',
  'five to ten working project managers',
  'Do not send an invitation until the pilot preflight passes.',
  'remain shadow-only or visibly disabled',
  'at least 90% complete onboarding without a support intervention',
  'Never ask a customer to supply a provider key',
  'Decisions and external actions still required',
]) {
  assert(
    acceptance.includes(required),
    `Controlled beta acceptance must include: ${required}`,
  );
}

const deviceTemplate = parse('validation/beta/device-accessibility-evidence-template.json');
assert.equal(deviceTemplate.schemaVersion, 1);
assert.equal(deviceTemplate.overallStatus, 'pending');
for (const platformName of ['iphone', 'ipad', 'web']) {
  const platform = deviceTemplate.platforms[platformName];
  assert.equal(platform.status, 'pending');
  assert.deepEqual(platform.candidateMetadataEvidenceRefs, []);
  assert.deepEqual(platform.behaviorEvidenceRefs, []);
  for (const key of gate.REQUIRED_DEVICE_JOURNEYS) {
    assert.equal(platform.journeys[key], 'pending');
  }
}
assert.deepEqual(deviceTemplate.evidenceClassification.actualDeviceBehavior, []);
for (const key of gate.REQUIRED_NATIVE_ACCESSIBILITY_CHECKS) {
  assert.equal(deviceTemplate.accessibility.iphone.checks[key], 'pending');
  assert.equal(deviceTemplate.accessibility.ipad.checks[key], 'pending');
}
for (const key of gate.REQUIRED_WEB_ACCESSIBILITY_CHECKS) {
  assert.equal(deviceTemplate.accessibility.web.checks[key], 'pending');
}
for (const key of gate.REQUIRED_RECOVERY_SCENARIOS) {
  assert.equal(deviceTemplate.offlineAndRecovery.scenarios[key], 'pending');
}

const operationsTemplate = parse('validation/beta/operations-recovery-evidence-template.json');
assert.equal(operationsTemplate.schemaVersion, 1);
assert.equal(operationsTemplate.overallStatus, 'pending');
for (const key of gate.REQUIRED_MONITORS) {
  assert.equal(operationsTemplate.monitors[key].status, 'pending');
}
for (const key of gate.REQUIRED_RECOVERY_DRILLS) {
  assert.equal(operationsTemplate.recoveryDrills[key].status, 'pending');
}
for (const key of [
  'recoveryTimeObjectiveMinutes',
  'recoveryPointObjectiveMinutes',
  'incidentNotificationTargetMinutes',
  'pilotCapacityMaxUsers',
  'retentionPolicyRef',
  'supportHours',
  'providerOutagePolicyRef',
]) {
  assert.equal(
    operationsTemplate.approvedDecisions[key],
    null,
    `${key} must stay unclaimed until the product owner approves it.`,
  );
}

const pilotTemplate = parse('validation/beta/outside-user-pilot-evidence-template.json');
assert.equal(pilotTemplate.schemaVersion, 1);
assert.equal(pilotTemplate.overallStatus, 'pending');
assert.deepEqual(pilotTemplate.sessions, []);
for (const key of gate.REQUIRED_PILOT_STEPS) {
  assert.equal(pilotTemplate.sessionTemplate.steps[key], 'pending');
}
for (const key of gate.ASK_ECOS_PILOT_STEPS) {
  assert.equal(pilotTemplate.sessionTemplate.steps[key], 'not_applicable_disabled');
}
assert.equal(pilotTemplate.preflight.pilotInvitationsAuthorized, false);
assert.equal(pilotTemplate.preflight.askEcosMode, 'disabled_for_pilot');
assert.equal(pilotTemplate.preflight.customerSurfaceConfirmedDisabled, false);
assert.equal(pilotTemplate.preflight.askEcosMultiProjectAcceptanceStatus, 'pending');
assert.equal(pilotTemplate.preflight.askEcosExactProofStatus, 'pending');
assert.equal(pilotTemplate.preflight.askEcosNegativeControlStatus, 'pending');
assert.equal(pilotTemplate.sessionTemplate.providerCredentialRequested, false);

const pendingDevice = gate.validateDeviceEvidence(deviceTemplate);
const pendingOperations = gate.validateOperationsEvidence(operationsTemplate);
const pendingPilot = gate.validatePilotEvidence(pilotTemplate);
assert.equal(pendingDevice.ok, false, 'An untouched device template must not pass.');
assert.equal(pendingOperations.ok, false, 'An untouched operations template must not pass.');
assert.equal(pendingPilot.ok, false, 'An untouched pilot template must not pass.');

console.log(
  'Vitruvius beta readiness contracts PASS: templates remain pending, required evidence is explicit, and no automated check claims physical or outside-user proof.',
);
