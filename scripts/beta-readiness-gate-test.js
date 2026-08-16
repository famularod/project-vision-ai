#!/usr/bin/env node

const assert = require('node:assert/strict');
const {
  ASK_ECOS_PILOT_STEPS,
  REQUIRED_DEVICE_JOURNEYS,
  REQUIRED_EXACT_BUILD_FUNCTIONS,
  REQUIRED_MONITORS,
  REQUIRED_NATIVE_ACCESSIBILITY_CHECKS,
  REQUIRED_PILOT_STEPS,
  REQUIRED_RECOVERY_DRILLS,
  REQUIRED_RECOVERY_SCENARIOS,
  REQUIRED_WEB_ACCESSIBILITY_CHECKS,
  validateDeviceEvidence,
  validateEvidenceCandidateConsistency,
  validateOperationsEvidence,
  validatePilotEvidence,
  validatePilotPreflight,
} = require('./beta-readiness-gate');

const EVIDENCE = 'validation/beta/evidence/review.txt';
const options = { evidenceExists: value => value === EVIDENCE };
const releaseCandidate = Object.freeze({
  version: '1.0.161',
  build: '161',
  sourceRevision: 'abcdef1234567890',
});

function passMap(keys) {
  return Object.fromEntries(keys.map(key => [key, 'pass']));
}

function devicePlatform(deviceOrBrowser, operatingSystem, evidenceSource = 'physical_device') {
  const documentIds = ['document-a', 'document-b'];
  const photoSha256 = 'a'.repeat(64);
  return {
    status: 'pass',
    evidenceSource,
    deviceOrBrowser,
    operatingSystem,
    installedVersion: releaseCandidate.version,
    installedBuild: releaseCandidate.build,
    installedSourceRevision: releaseCandidate.sourceRevision,
    journeys: passMap(REQUIRED_DEVICE_JOURNEYS),
    coverPropagation: {
      projectId: 'project-a',
      selectedObjectPath: 'project-covers/project-a/selected.jpg',
      replacementObjectPath: 'project-covers/project-a/replacement.jpg',
      removed: true,
    },
    functionMatrix: passMap(REQUIRED_EXACT_BUILD_FUNCTIONS),
    documentParity: {
      expectedCount: documentIds.length,
      observedCount: documentIds.length,
      expectedDocumentIds: [...documentIds],
      observedDocumentIds: [...documentIds],
      openedDocumentId: documentIds[0],
    },
    uploadedPhotoParity: {
      photoId: 'photo-a',
      storageObjectPath: 'project-photos/project-a/update-a/photo-a.jpg',
      sourceByteCount: 4096,
      observedByteCount: 4096,
      sourceSha256: photoSha256,
      observedSha256: photoSha256,
    },
    syncZero: {
      queued: 0,
      conflicts: 0,
      errors: [],
      missingPhotos: [],
      queuedChanges: 0,
      recoveryAvailable: false,
      recoveryCopies: 0,
      lastSyncAt: '2026-08-08T11:59:00.000Z',
      peerPropagation: 'pass',
    },
    candidateMetadataEvidenceRefs: [EVIDENCE],
    behaviorEvidenceRefs: [EVIDENCE],
    exactBuildEvidenceRefs: [EVIDENCE],
  };
}

function validDeviceEvidence() {
  return {
    schemaVersion: 2,
    releaseCandidate,
    recordedAt: '2026-08-08T12:00:00.000Z',
    tester: 'Independent tester',
    overallStatus: 'pass',
    platforms: {
      iphone: devicePlatform('iPhone 16 Pro', 'iOS 19.0'),
      ipad: devicePlatform('iPad Pro', 'iPadOS 19.0'),
      web: devicePlatform('Chrome 140', 'macOS 16.0', 'interactive_web'),
    },
    accessibility: {
      iphone: {
        checks: passMap(REQUIRED_NATIVE_ACCESSIBILITY_CHECKS),
        evidenceRefs: [EVIDENCE],
      },
      ipad: {
        checks: passMap(REQUIRED_NATIVE_ACCESSIBILITY_CHECKS),
        evidenceRefs: [EVIDENCE],
      },
      web: {
        checks: passMap(REQUIRED_WEB_ACCESSIBILITY_CHECKS),
        evidenceRefs: [EVIDENCE],
      },
    },
    offlineAndRecovery: {
      scenarios: passMap(REQUIRED_RECOVERY_SCENARIOS),
      evidenceRefs: [EVIDENCE],
    },
    defects: [],
  };
}

function validOperationsEvidence() {
  return {
    schemaVersion: 1,
    releaseCandidate,
    recordedAt: '2026-08-08T12:00:00.000Z',
    overallStatus: 'pass',
    ownership: {
      incidentCommander: 'Primary operator',
      supportOwner: 'Support owner',
      securityOwner: 'Security owner',
      privacyOwner: 'Privacy owner',
      supportEmail: 'support@example.com',
      helpCenterRef: 'https://example.com/help',
      serviceStatusProcedureRef: 'docs/status-procedure.md',
    },
    approvedDecisions: {
      recoveryTimeObjectiveMinutes: 120,
      recoveryPointObjectiveMinutes: 60,
      incidentNotificationTargetMinutes: 60,
      pilotCapacityMaxUsers: 10,
      retentionPolicyRef: 'docs/retention.md',
      supportHours: 'Weekdays 08:00-17:00 Pacific',
      providerOutagePolicyRef: 'docs/provider-outage.md',
    },
    monitors: Object.fromEntries(REQUIRED_MONITORS.map(key => [key, {
      status: 'pass',
      alertRoute: 'Primary operator',
      evidenceRefs: [EVIDENCE],
    }])),
    recoveryDrills: Object.fromEntries(REQUIRED_RECOVERY_DRILLS.map(key => [key, {
      status: 'pass',
      performedAt: '2026-08-08T12:00:00.000Z',
      tester: 'Independent tester',
      evidenceRefs: [EVIDENCE],
    }])),
    openRisks: [],
  };
}

function validPilotSession(index) {
  return {
    participantId: `PM_${index}`,
    isProjectManager: true,
    helpedBuildProduct: false,
    consentRecorded: true,
    verbalSetupAssistance: false,
    providerCredentialRequested: false,
    providerSetupConfusion: false,
    onboardingCompleted: true,
    supportInterventions: 0,
    setupSecondsExcludingBackground: 480,
    steps: passMap([...REQUIRED_PILOT_STEPS, ...ASK_ECOS_PILOT_STEPS]),
    evidenceRefs: [EVIDENCE],
    defectRefs: [],
  };
}

function validPilotEvidence() {
  return {
    schemaVersion: 1,
    releaseCandidate,
    preflight: {
      recordedAt: '2026-08-08T11:00:00.000Z',
      approvedBy: 'Product owner',
      pilotInvitationsAuthorized: true,
      askEcosMode: 'accepted_for_pilot',
      askEcosAcceptanceStatus: 'pass',
      askEcosMultiProjectAcceptanceStatus: 'pass',
      askEcosExactProofStatus: 'pass',
      askEcosNegativeControlStatus: 'pass',
      askEcosAcceptedCandidate: releaseCandidate,
      customerSurfaceConfirmedDisabled: false,
      askEcosEvidenceRefs: [EVIDENCE],
    },
    overallStatus: 'pass',
    startedAt: '2026-08-08T12:00:00.000Z',
    completedAt: '2026-08-09T12:00:00.000Z',
    sessions: [1, 2, 3, 4, 5].map(validPilotSession),
    defects: [],
  };
}

assert.equal(validateDeviceEvidence(validDeviceEvidence(), options).ok, true);
assert.equal(validateOperationsEvidence(validOperationsEvidence(), options).ok, true);
assert.equal(validatePilotEvidence(validPilotEvidence(), options).ok, true);
assert.equal(validatePilotPreflight(validPilotEvidence(), options).ok, true);
assert.equal(validateEvidenceCandidateConsistency(
  validDeviceEvidence(),
  validOperationsEvidence(),
  validPilotEvidence(),
).ok, true);

const wrongBuild = validDeviceEvidence();
wrongBuild.platforms.ipad.installedBuild = '160';
const wrongBuildResult = validateDeviceEvidence(wrongBuild, options);
assert.equal(wrongBuildResult.ok, false);
assert(wrongBuildResult.failures.some(value => /ipad installed build/.test(value)));

const accessibilityNotRun = validDeviceEvidence();
accessibilityNotRun.accessibility.iphone.checks.voice_over = 'pending';
assert.equal(validateDeviceEvidence(accessibilityNotRun, options).ok, false);

const sourceChecksOnly = validDeviceEvidence();
sourceChecksOnly.platforms.ipad.behaviorEvidenceRefs = [];
assert.equal(validateDeviceEvidence(sourceChecksOnly, options).ok, false);

const stalePlatformRevision = validDeviceEvidence();
stalePlatformRevision.platforms.web.installedSourceRevision = '1234567';
assert.equal(validateDeviceEvidence(stalePlatformRevision, options).ok, false);

const simulatedNativeEvidence = validDeviceEvidence();
simulatedNativeEvidence.platforms.ipad.evidenceSource = 'simulator';
assert.equal(validateDeviceEvidence(simulatedNativeEvidence, options).ok, false);

const noninteractiveWebEvidence = validDeviceEvidence();
noninteractiveWebEvidence.platforms.web.evidenceSource = 'automated_source_check';
assert.equal(validateDeviceEvidence(noninteractiveWebEvidence, options).ok, false);

const incompleteCoverPropagation = validDeviceEvidence();
incompleteCoverPropagation.platforms.iphone.coverPropagation.replacementObjectPath =
  incompleteCoverPropagation.platforms.iphone.coverPropagation.selectedObjectPath;
assert.equal(validateDeviceEvidence(incompleteCoverPropagation, options).ok, false);

const mismatchedCrossPlatformTarget = validDeviceEvidence();
mismatchedCrossPlatformTarget.platforms.web.coverPropagation.projectId = 'project-other';
assert.equal(validateDeviceEvidence(mismatchedCrossPlatformTarget, options).ok, false);

for (const key of REQUIRED_EXACT_BUILD_FUNCTIONS) {
  const incompleteFunctionMatrix = validDeviceEvidence();
  incompleteFunctionMatrix.platforms.iphone.functionMatrix[key] = 'pending';
  const result = validateDeviceEvidence(incompleteFunctionMatrix, options);
  assert.equal(result.ok, false, `Missing iPhone exact-build function must fail: ${key}`);
}

const mismatchedDocumentCount = validDeviceEvidence();
mismatchedDocumentCount.platforms.ipad.documentParity.observedCount = 1;
assert.equal(validateDeviceEvidence(mismatchedDocumentCount, options).ok, false);

const mismatchedDocumentList = validDeviceEvidence();
mismatchedDocumentList.platforms.web.documentParity.observedDocumentIds.reverse();
assert.equal(validateDeviceEvidence(mismatchedDocumentList, options).ok, false);

const openedWrongDocument = validDeviceEvidence();
openedWrongDocument.platforms.iphone.documentParity.openedDocumentId = 'document-other';
assert.equal(validateDeviceEvidence(openedWrongDocument, options).ok, false);

const mismatchedPhotoBytes = validDeviceEvidence();
mismatchedPhotoBytes.platforms.ipad.uploadedPhotoParity.observedByteCount = 4095;
assert.equal(validateDeviceEvidence(mismatchedPhotoBytes, options).ok, false);

const mismatchedPhotoDigest = validDeviceEvidence();
mismatchedPhotoDigest.platforms.web.uploadedPhotoParity.observedSha256 = 'b'.repeat(64);
assert.equal(validateDeviceEvidence(mismatchedPhotoDigest, options).ok, false);

for (const key of ['queued', 'conflicts', 'queuedChanges', 'recoveryCopies']) {
  const nonzeroSync = validDeviceEvidence();
  nonzeroSync.platforms.iphone.syncZero[key] = 1;
  const result = validateDeviceEvidence(nonzeroSync, options);
  assert.equal(result.ok, false, `Nonzero iPhone sync field must fail: ${key}`);
}

for (const key of ['errors', 'missingPhotos']) {
  const nonemptySync = validDeviceEvidence();
  nonemptySync.platforms.iphone.syncZero[key] = [{ id: 'unresolved' }];
  const result = validateDeviceEvidence(nonemptySync, options);
  assert.equal(result.ok, false, `Nonempty iPhone sync field must fail: ${key}`);
}

const recoveryStillAvailable = validDeviceEvidence();
recoveryStillAvailable.platforms.ipad.syncZero.recoveryAvailable = true;
assert.equal(validateDeviceEvidence(recoveryStillAvailable, options).ok, false);

const missingLastSync = validDeviceEvidence();
missingLastSync.platforms.web.syncZero.lastSyncAt = null;
assert.equal(validateDeviceEvidence(missingLastSync, options).ok, false);

const futureLastSync = validDeviceEvidence();
futureLastSync.platforms.web.syncZero.lastSyncAt = '2026-08-08T12:01:00.000Z';
assert.equal(validateDeviceEvidence(futureLastSync, options).ok, false);

const peerPropagationFailed = validDeviceEvidence();
peerPropagationFailed.platforms.iphone.syncZero.peerPropagation = 'fail';
assert.equal(validateDeviceEvidence(peerPropagationFailed, options).ok, false);

const missingExactBuildEvidence = validDeviceEvidence();
missingExactBuildEvidence.platforms.ipad.exactBuildEvidenceRefs = [];
assert.equal(validateDeviceEvidence(missingExactBuildEvidence, options).ok, false);

const mismatchedEvidenceCandidate = validPilotEvidence();
mismatchedEvidenceCandidate.releaseCandidate = {
  ...releaseCandidate,
  build: '160',
};
assert.equal(validateEvidenceCandidateConsistency(
  validDeviceEvidence(),
  validOperationsEvidence(),
  mismatchedEvidenceCandidate,
).ok, false);

const missingRecoveryDecision = validOperationsEvidence();
missingRecoveryDecision.approvedDecisions.recoveryTimeObjectiveMinutes = null;
assert.equal(validateOperationsEvidence(missingRecoveryDecision, options).ok, false);

const openSecurityRisk = validOperationsEvidence();
openSecurityRisk.openRisks.push({ severity: 'critical', status: 'open' });
assert.equal(validateOperationsEvidence(openSecurityRisk, options).ok, false);

const unownedRiskAcceptance = validOperationsEvidence();
unownedRiskAcceptance.openRisks.push({ severity: 'high', status: 'accepted' });
assert.equal(validateOperationsEvidence(unownedRiskAcceptance, options).ok, false);

const authorizedRiskAcceptance = validOperationsEvidence();
authorizedRiskAcceptance.openRisks.push({
  severity: 'high',
  status: 'accepted',
  acceptedBy: 'Product owner',
  acceptedAt: '2026-08-08T12:00:00.000Z',
  acceptanceRationale: 'Bounded pilot risk with feature disabled.',
});
assert.equal(validateOperationsEvidence(authorizedRiskAcceptance, options).ok, true);

const tooFewParticipants = validPilotEvidence();
tooFewParticipants.sessions = tooFewParticipants.sessions.slice(0, 4);
assert.equal(validatePilotEvidence(tooFewParticipants, options).ok, false);

const providerConfusion = validPilotEvidence();
providerConfusion.sessions[0].providerSetupConfusion = true;
assert.equal(validatePilotEvidence(providerConfusion, options).ok, false);

const missingAskAcceptance = validPilotEvidence();
missingAskAcceptance.preflight.askEcosAcceptanceStatus = 'pending';
assert.equal(validatePilotPreflight(missingAskAcceptance, options).ok, false);

const incompleteMultiProjectAcceptance = validPilotEvidence();
incompleteMultiProjectAcceptance.preflight.askEcosMultiProjectAcceptanceStatus = 'pending';
assert.equal(validatePilotPreflight(incompleteMultiProjectAcceptance, options).ok, false);

const staleAskAcceptance = validPilotEvidence();
staleAskAcceptance.preflight.askEcosAcceptedCandidate = {
  ...releaseCandidate,
  build: '160',
};
assert.equal(validatePilotPreflight(staleAskAcceptance, options).ok, false);

const disabledAskPilot = validPilotEvidence();
disabledAskPilot.preflight.askEcosMode = 'disabled_for_pilot';
disabledAskPilot.preflight.askEcosAcceptanceStatus = 'pending';
disabledAskPilot.preflight.askEcosMultiProjectAcceptanceStatus = 'pending';
disabledAskPilot.preflight.askEcosExactProofStatus = 'pending';
disabledAskPilot.preflight.askEcosNegativeControlStatus = 'pending';
disabledAskPilot.preflight.askEcosAcceptedCandidate = {
  version: null,
  build: null,
  sourceRevision: null,
};
disabledAskPilot.preflight.customerSurfaceConfirmedDisabled = true;
for (const session of disabledAskPilot.sessions) {
  for (const key of ASK_ECOS_PILOT_STEPS) session.steps[key] = 'not_applicable_disabled';
}
assert.equal(validatePilotEvidence(disabledAskPilot, options).ok, true);

const ninetyPercentPilot = validPilotEvidence();
ninetyPercentPilot.sessions = Array.from({ length: 10 }, (_, index) => validPilotSession(index + 1));
ninetyPercentPilot.sessions[9].onboardingCompleted = false;
ninetyPercentPilot.sessions[9].supportInterventions = 1;
ninetyPercentPilot.sessions[9].steps.open_exact_proof = 'fail';
ninetyPercentPilot.sessions[9].defectRefs = ['BETA-001'];
ninetyPercentPilot.defects = [{
  id: 'BETA-001',
  severity: 'moderate',
  status: 'open',
  summary: 'One participant could not find exact proof.',
}];
assert.equal(validatePilotEvidence(ninetyPercentPilot, options).ok, true);

const missingEvidence = validPilotEvidence();
missingEvidence.sessions[0].evidenceRefs = ['validation/beta/evidence/missing.txt'];
assert.equal(validatePilotEvidence(missingEvidence, options).ok, false);

console.log(
  'Vitruvius beta evidence gate PASS: candidate matching, device/accessibility, recovery operations, and outside-PM pilot thresholds fail closed.',
);
