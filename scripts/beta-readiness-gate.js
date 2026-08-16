#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_DEVICE_JOURNEYS = Object.freeze([
  'sign_in_and_session_recovery',
  'create_and_edit_task',
  'guided_voice_or_text_capture',
  'field_note_capture_and_desktop_review',
  'document_add_and_background_resume',
  'ask_ecos_and_open_exact_proof',
  'report_review',
]);

const REQUIRED_EXACT_BUILD_FUNCTIONS = Object.freeze([
  'cover_select_propagation',
  'cover_replace_propagation',
  'cover_remove_propagation',
  'document_count_exact',
  'document_list_exact',
  'document_open_exact',
  'uploaded_photo_byte_parity',
  'uploaded_photo_digest_parity',
  'offline_change_saved',
  'restart_restored_pending_work',
  'reconnect_propagated_change',
  'duplicate_write_prevented',
  'conflict_visible_without_overwrite',
]);

const REQUIRED_SYNC_ZERO_COUNTS = Object.freeze([
  'queued',
  'conflicts',
  'queuedChanges',
  'recoveryCopies',
]);

const REQUIRED_NATIVE_ACCESSIBILITY_CHECKS = Object.freeze([
  'voice_over',
  'dynamic_type',
  'reduced_motion',
  'contrast',
  'focus_order',
  'touch_targets',
]);

const REQUIRED_WEB_ACCESSIBILITY_CHECKS = Object.freeze([
  'keyboard_navigation',
  'screen_reader',
  'zoom_200_percent',
  'reduced_motion',
  'contrast',
  'focus_order',
]);

const REQUIRED_RECOVERY_SCENARIOS = Object.freeze([
  'offline_create_and_reconnect',
  'background_foreground_resume',
  'duplicate_write_prevention',
  'sync_conflict_is_visible',
  'restart_with_pending_work',
]);

const REQUIRED_MONITORS = Object.freeze([
  'queue_age',
  'failure_rate',
  'latency',
  'capacity',
  'cost',
]);

const REQUIRED_RECOVERY_DRILLS = Object.freeze([
  'provider_outage_fails_closed',
  'worker_checkpoint_resume',
  'backup_restore',
  'export_restore_disposable_project',
  'deleted_records_do_not_return',
  'cross_tenant_access_denied',
  'application_rollback',
  'customer_safe_incident_reference',
]);

const REQUIRED_PILOT_STEPS = Object.freeze([
  'sign_in',
  'create_project',
  'add_project_documents',
  'leave_and_return_during_processing',
  'understand_ready_or_review_status',
]);

const ASK_ECOS_PILOT_STEPS = Object.freeze([
  'ask_supported_question',
  'open_exact_proof',
]);

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validIsoDate(value) {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function nonEmptyUniqueStrings(value) {
  return Array.isArray(value) && value.length > 0 &&
    value.every(nonEmptyString) && new Set(value).size === value.length;
}

function evidenceRefs(value) {
  return Array.isArray(value) ? value.filter(nonEmptyString) : [];
}

function isBlockingDefect(defect) {
  const item = record(defect);
  if (!['critical', 'high'].includes(item.severity)) return false;
  if (['resolved', 'closed'].includes(item.status)) return false;
  if (item.status === 'accepted' &&
      nonEmptyString(item.acceptedBy) &&
      validIsoDate(item.acceptedAt) &&
      nonEmptyString(item.acceptanceRationale)) {
    return false;
  }
  return true;
}

function validateReleaseCandidate(candidate, failures, label) {
  const value = record(candidate);
  if (!nonEmptyString(value.version)) failures.push(`${label} version is missing.`);
  if (!nonEmptyString(value.build)) failures.push(`${label} build is missing.`);
  if (!/^[0-9a-f]{7,40}$/i.test(value.sourceRevision || '')) {
    failures.push(`${label} source revision must be a 7-40 character Git revision.`);
  }
  return value;
}

function requirePassMap(map, requiredKeys, label, failures) {
  const value = record(map);
  for (const key of requiredKeys) {
    if (value[key] !== 'pass') failures.push(`${label} ${key} did not pass.`);
  }
}

function observedFailures(map, requiredKeys, label, failures) {
  const value = record(map);
  const failed = [];
  for (const key of requiredKeys) {
    if (!['pass', 'fail'].includes(value[key])) {
      failures.push(`${label} ${key} was not completed.`);
    } else if (value[key] === 'fail') {
      failed.push(key);
    }
  }
  return failed;
}

function requireEvidence(value, label, failures, evidenceExists) {
  const refs = evidenceRefs(value);
  if (refs.length === 0) {
    failures.push(`${label} has no durable evidence reference.`);
    return;
  }
  for (const ref of refs) {
    if (!evidenceExists(ref)) failures.push(`${label} evidence does not exist: ${ref}`);
  }
}

function validateExactBuildPlatformEvidence(platform, platformName, recordedAt, failures,
  evidenceExists) {
  requirePassMap(
    platform.functionMatrix,
    REQUIRED_EXACT_BUILD_FUNCTIONS,
    `${platformName} exact-build function`,
    failures,
  );

  const cover = record(platform.coverPropagation);
  if (!nonEmptyString(cover.projectId) ||
      !nonEmptyString(cover.selectedObjectPath) ||
      !nonEmptyString(cover.replacementObjectPath) ||
      cover.selectedObjectPath === cover.replacementObjectPath ||
      cover.removed !== true) {
    failures.push(`${platformName} cover select, replace, and remove result is incomplete.`);
  }

  const documents = record(platform.documentParity);
  if (!positiveInteger(documents.expectedCount) ||
      documents.observedCount !== documents.expectedCount) {
    failures.push(`${platformName} exact document count does not match.`);
  }
  if (!nonEmptyUniqueStrings(documents.expectedDocumentIds) ||
      !nonEmptyUniqueStrings(documents.observedDocumentIds) ||
      documents.expectedDocumentIds.length !== documents.expectedCount ||
      JSON.stringify(documents.observedDocumentIds) !==
        JSON.stringify(documents.expectedDocumentIds)) {
    failures.push(`${platformName} exact document list does not match.`);
  }
  if (!nonEmptyString(documents.openedDocumentId) ||
      !Array.isArray(documents.expectedDocumentIds) ||
      !documents.expectedDocumentIds.includes(documents.openedDocumentId)) {
    failures.push(`${platformName} did not open a document from the exact expected list.`);
  }

  const photo = record(platform.uploadedPhotoParity);
  if (!nonEmptyString(photo.photoId) || !nonEmptyString(photo.storageObjectPath)) {
    failures.push(`${platformName} uploaded photo identity is missing.`);
  }
  if (!positiveInteger(photo.sourceByteCount) ||
      photo.observedByteCount !== photo.sourceByteCount) {
    failures.push(`${platformName} uploaded photo byte count does not match.`);
  }
  if (!/^[a-f0-9]{64}$/.test(photo.sourceSha256 || '') ||
      photo.observedSha256 !== photo.sourceSha256) {
    failures.push(`${platformName} uploaded photo digest does not match.`);
  }

  const sync = record(platform.syncZero);
  for (const key of REQUIRED_SYNC_ZERO_COUNTS) {
    if (sync[key] !== 0) failures.push(`${platformName} sync-zero ${key} is not zero.`);
  }
  for (const key of ['errors', 'missingPhotos']) {
    if (!Array.isArray(sync[key]) || sync[key].length !== 0) {
      failures.push(`${platformName} sync-zero ${key} is not empty.`);
    }
  }
  if (sync.recoveryAvailable !== false) {
    failures.push(`${platformName} sync-zero recovery state is not clear.`);
  }
  if (!validIsoDate(sync.lastSyncAt)) {
    failures.push(`${platformName} sync-zero lastSyncAt is missing or invalid.`);
  } else if (validIsoDate(recordedAt) && Date.parse(sync.lastSyncAt) > Date.parse(recordedAt)) {
    failures.push(`${platformName} sync-zero lastSyncAt is later than the evidence record.`);
  }
  if (sync.peerPropagation !== 'pass') {
    failures.push(`${platformName} sync-zero peer propagation did not pass.`);
  }
  requireEvidence(
    platform.exactBuildEvidenceRefs,
    `${platformName} exact-build function matrix`,
    failures,
    evidenceExists,
  );
}

function exactBuildTarget(platform) {
  const cover = record(platform.coverPropagation);
  const documents = record(platform.documentParity);
  const photo = record(platform.uploadedPhotoParity);
  return {
    projectId: cover.projectId,
    selectedCoverObjectPath: cover.selectedObjectPath,
    replacementCoverObjectPath: cover.replacementObjectPath,
    expectedDocumentCount: documents.expectedCount,
    expectedDocumentIds: documents.expectedDocumentIds,
    photoId: photo.photoId,
    photoStorageObjectPath: photo.storageObjectPath,
    photoSourceByteCount: photo.sourceByteCount,
    photoSourceSha256: photo.sourceSha256,
  };
}

function validateDeviceEvidence(input, options = {}) {
  const failures = [];
  const value = record(input);
  const evidenceExists = options.evidenceExists || (() => true);
  const candidate = validateReleaseCandidate(
    value.releaseCandidate,
    failures,
    'Device evidence release candidate',
  );

  if (value.schemaVersion !== 2) failures.push('Device evidence schemaVersion must be 2.');
  if (value.overallStatus !== 'pass') failures.push('Device evidence overallStatus must be pass.');
  if (!validIsoDate(value.recordedAt)) failures.push('Device evidence recordedAt is missing or invalid.');
  if (!nonEmptyString(value.tester)) failures.push('Device evidence tester is missing.');

  const platforms = record(value.platforms);
  for (const platformName of ['iphone', 'ipad', 'web']) {
    const platform = record(platforms[platformName]);
    if (platform.status !== 'pass') failures.push(`${platformName} status did not pass.`);
    if (!nonEmptyString(platform.operatingSystem)) {
      failures.push(`${platformName} operating system or browser version is missing.`);
    }
    if (!nonEmptyString(platform.deviceOrBrowser)) {
      failures.push(`${platformName} device or browser is missing.`);
    }
    const expectedEvidenceSource = platformName === 'web'
      ? 'interactive_web'
      : 'physical_device';
    if (platform.evidenceSource !== expectedEvidenceSource) {
      failures.push(`${platformName} evidence source must be ${expectedEvidenceSource}.`);
    }
    if (platform.installedVersion !== candidate.version) {
      failures.push(`${platformName} installed version does not match the release candidate.`);
    }
    if (platform.installedBuild !== candidate.build) {
      failures.push(`${platformName} installed build does not match the release candidate.`);
    }
    if (platform.installedSourceRevision !== candidate.sourceRevision) {
      failures.push(`${platformName} installed source revision does not match the release candidate.`);
    }
    requirePassMap(
      platform.journeys,
      REQUIRED_DEVICE_JOURNEYS,
      `${platformName} journey`,
      failures,
    );
    requireEvidence(
      platform.candidateMetadataEvidenceRefs,
      `${platformName} candidate metadata`,
      failures,
      evidenceExists,
    );
    requireEvidence(
      platform.behaviorEvidenceRefs,
      `${platformName} actual behavior review`,
      failures,
      evidenceExists,
    );
    validateExactBuildPlatformEvidence(
      platform,
      platformName,
      value.recordedAt,
      failures,
      evidenceExists,
    );
  }
  const iphoneTarget = exactBuildTarget(record(platforms.iphone));
  for (const platformName of ['ipad', 'web']) {
    if (JSON.stringify(exactBuildTarget(record(platforms[platformName]))) !==
        JSON.stringify(iphoneTarget)) {
      failures.push(`${platformName} exact-build target does not match the iPhone target.`);
    }
  }

  const accessibility = record(value.accessibility);
  for (const platformName of ['iphone', 'ipad']) {
    requirePassMap(
      record(accessibility[platformName]).checks,
      REQUIRED_NATIVE_ACCESSIBILITY_CHECKS,
      `${platformName} accessibility`,
      failures,
    );
    requireEvidence(
      record(accessibility[platformName]).evidenceRefs,
      `${platformName} accessibility review`,
      failures,
      evidenceExists,
    );
  }
  requirePassMap(
    record(accessibility.web).checks,
    REQUIRED_WEB_ACCESSIBILITY_CHECKS,
    'web accessibility',
    failures,
  );
  requireEvidence(
    record(accessibility.web).evidenceRefs,
    'web accessibility review',
    failures,
    evidenceExists,
  );

  const recovery = record(value.offlineAndRecovery);
  requirePassMap(recovery.scenarios, REQUIRED_RECOVERY_SCENARIOS, 'recovery scenario', failures);
  requireEvidence(
    recovery.evidenceRefs,
    'offline and recovery review',
    failures,
    evidenceExists,
  );

  const blockers = Array.isArray(value.defects)
    ? value.defects.filter(isBlockingDefect)
    : [];
  if (blockers.length > 0) failures.push(`${blockers.length} blocking device defect(s) remain open.`);

  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

function validateEvidenceCandidateConsistency(deviceInput, operationsInput, pilotInput) {
  const failures = [];
  const expected = record(record(deviceInput).releaseCandidate);
  for (const [label, input] of [
    ['Operations evidence', operationsInput],
    ['Pilot evidence', pilotInput],
  ]) {
    const candidate = record(record(input).releaseCandidate);
    for (const key of ['version', 'build', 'sourceRevision']) {
      if (candidate[key] !== expected[key]) {
        failures.push(`${label} ${key} does not match the device evidence release candidate.`);
      }
    }
  }
  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

function validateOperationsEvidence(input, options = {}) {
  const failures = [];
  const value = record(input);
  const evidenceExists = options.evidenceExists || (() => true);
  validateReleaseCandidate(
    value.releaseCandidate,
    failures,
    'Operations evidence release candidate',
  );

  if (value.schemaVersion !== 1) failures.push('Operations evidence schemaVersion must be 1.');
  if (value.overallStatus !== 'pass') failures.push('Operations evidence overallStatus must be pass.');
  if (!validIsoDate(value.recordedAt)) failures.push('Operations evidence recordedAt is missing or invalid.');

  const contacts = record(value.ownership);
  for (const key of ['incidentCommander', 'supportOwner', 'securityOwner', 'privacyOwner']) {
    if (!nonEmptyString(contacts[key])) failures.push(`Operations owner ${key} is missing.`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contacts.supportEmail || '')) {
    failures.push('A working support email is required.');
  }
  if (!nonEmptyString(contacts.helpCenterRef)) failures.push('Help center reference is missing.');
  if (!nonEmptyString(contacts.serviceStatusProcedureRef)) {
    failures.push('Service-status procedure reference is missing.');
  }

  const decisions = record(value.approvedDecisions);
  for (const key of [
    'recoveryTimeObjectiveMinutes',
    'recoveryPointObjectiveMinutes',
    'incidentNotificationTargetMinutes',
  ]) {
    if (!positiveNumber(decisions[key])) failures.push(`Approved decision ${key} is missing.`);
  }
  if (!Number.isInteger(decisions.pilotCapacityMaxUsers) ||
      decisions.pilotCapacityMaxUsers < 5 ||
      decisions.pilotCapacityMaxUsers > 10) {
    failures.push('Approved decision pilotCapacityMaxUsers must be between 5 and 10.');
  }
  for (const key of ['retentionPolicyRef', 'supportHours', 'providerOutagePolicyRef']) {
    if (!nonEmptyString(decisions[key])) failures.push(`Approved decision ${key} is missing.`);
  }

  const monitors = record(value.monitors);
  for (const key of REQUIRED_MONITORS) {
    const monitor = record(monitors[key]);
    if (monitor.status !== 'pass') failures.push(`Operations monitor ${key} did not pass.`);
    if (!nonEmptyString(monitor.alertRoute)) {
      failures.push(`Operations monitor ${key} has no alert route.`);
    }
    requireEvidence(monitor.evidenceRefs, `Operations monitor ${key}`, failures, evidenceExists);
  }

  const drills = record(value.recoveryDrills);
  for (const key of REQUIRED_RECOVERY_DRILLS) {
    const drill = record(drills[key]);
    if (drill.status !== 'pass') failures.push(`Recovery drill ${key} did not pass.`);
    if (!validIsoDate(drill.performedAt)) failures.push(`Recovery drill ${key} has no valid date.`);
    if (!nonEmptyString(drill.tester)) failures.push(`Recovery drill ${key} has no tester.`);
    requireEvidence(drill.evidenceRefs, `Recovery drill ${key}`, failures, evidenceExists);
  }

  const blockers = Array.isArray(value.openRisks)
    ? value.openRisks.filter(isBlockingDefect)
    : [];
  if (blockers.length > 0) failures.push(`${blockers.length} blocking operations risk(s) remain open.`);

  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}

function validatePilotPreflight(input, options = {}) {
  const failures = [];
  const value = record(input);
  const evidenceExists = options.evidenceExists || (() => true);
  const candidate = validateReleaseCandidate(
    value.releaseCandidate,
    failures,
    'Pilot preflight release candidate',
  );
  const preflight = record(value.preflight);
  if (!validIsoDate(preflight.recordedAt)) failures.push('Pilot preflight date is missing or invalid.');
  if (!nonEmptyString(preflight.approvedBy)) failures.push('Pilot preflight approver is missing.');
  if (preflight.pilotInvitationsAuthorized !== true) {
    failures.push('Outside-user pilot invitations have not been authorized.');
  }
  if (preflight.askEcosMode === 'disabled_for_pilot') {
    if (preflight.customerSurfaceConfirmedDisabled !== true) {
      failures.push('Ask ECOS must be visibly disabled for the pilot release candidate.');
    }
  } else if (preflight.askEcosMode === 'accepted_for_pilot') {
    if (preflight.askEcosAcceptanceStatus !== 'pass') {
      failures.push('Ask ECOS acceptance has not passed for the pilot release candidate.');
    }
    if (preflight.askEcosMultiProjectAcceptanceStatus !== 'pass') {
      failures.push('Ask ECOS multi-project live acceptance has not passed.');
    }
    if (preflight.askEcosExactProofStatus !== 'pass') {
      failures.push('Ask ECOS exact-proof acceptance has not passed.');
    }
    if (preflight.askEcosNegativeControlStatus !== 'pass') {
      failures.push('Ask ECOS negative-control acceptance has not passed.');
    }
    const acceptedCandidate = record(preflight.askEcosAcceptedCandidate);
    for (const key of ['version', 'build', 'sourceRevision']) {
      if (acceptedCandidate[key] !== candidate[key]) {
        failures.push(`Ask ECOS accepted ${key} does not match the pilot release candidate.`);
      }
    }
  } else {
    failures.push('Ask ECOS pilot mode must be disabled_for_pilot or accepted_for_pilot.');
  }
  requireEvidence(
    preflight.askEcosEvidenceRefs,
    'Ask ECOS pilot preflight',
    failures,
    evidenceExists,
  );
  return Object.freeze({
    ok: failures.length === 0,
    failures: Object.freeze(failures),
    askEcosMode: preflight.askEcosMode || null,
  });
}

function validatePilotEvidence(input, options = {}) {
  const failures = [];
  const value = record(input);
  const evidenceExists = options.evidenceExists || (() => true);
  const preflight = validatePilotPreflight(value, { evidenceExists });
  failures.push(...preflight.failures);

  if (value.schemaVersion !== 1) failures.push('Pilot evidence schemaVersion must be 1.');
  if (value.overallStatus !== 'pass') failures.push('Pilot evidence overallStatus must be pass.');
  if (!validIsoDate(value.startedAt) || !validIsoDate(value.completedAt)) {
    failures.push('Pilot start and completion dates are required.');
  }
  const preflightRecordedAt = record(value.preflight).recordedAt;
  if (validIsoDate(value.startedAt) && validIsoDate(preflightRecordedAt) &&
      Date.parse(value.startedAt) < Date.parse(preflightRecordedAt)) {
    failures.push('Pilot started before the required preflight was recorded.');
  }

  const sessions = Array.isArray(value.sessions) ? value.sessions : [];
  if (sessions.length < 5 || sessions.length > 10) {
    failures.push('Outside-user pilot requires 5-10 participant sessions.');
  }
  const participantIds = new Set();
  let completedWithoutSupport = 0;
  let completedWithinTarget = 0;
  let providerConfusionCount = 0;

  for (const rawSession of sessions) {
    const session = record(rawSession);
    const id = session.participantId;
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(id || '')) {
      failures.push('Pilot participant IDs must be pseudonymous IDs without names or email addresses.');
    } else if (participantIds.has(id)) {
      failures.push(`Pilot participant ID is duplicated: ${id}`);
    } else {
      participantIds.add(id);
    }
    if (session.isProjectManager !== true) failures.push(`${id || 'participant'} is not confirmed as a project manager.`);
    if (session.helpedBuildProduct !== false) failures.push(`${id || 'participant'} helped build the product.`);
    if (session.consentRecorded !== true) failures.push(`${id || 'participant'} is missing pilot consent.`);
    if (session.verbalSetupAssistance !== false) failures.push(`${id || 'participant'} received verbal setup assistance.`);
    if (session.providerCredentialRequested !== false) {
      failures.push(`${id || 'participant'} was asked for a provider credential or provider account.`);
    }
    if (session.providerSetupConfusion !== false) {
      providerConfusionCount += 1;
    }
    if (!Number.isInteger(session.supportInterventions) || session.supportInterventions < 0) {
      failures.push(`${id || 'participant'} support-intervention count is missing or invalid.`);
    }
    if (session.onboardingCompleted === true && session.supportInterventions === 0) {
      completedWithoutSupport += 1;
    }
    if (positiveNumber(session.setupSecondsExcludingBackground) &&
        session.setupSecondsExcludingBackground <= 600) {
      completedWithinTarget += 1;
    }
    const failedSteps = observedFailures(
      session.steps,
      REQUIRED_PILOT_STEPS,
      `${id || 'participant'} step`,
      failures,
    );
    if (preflight.askEcosMode === 'accepted_for_pilot') {
      failedSteps.push(...observedFailures(
        session.steps,
        ASK_ECOS_PILOT_STEPS,
        `${id || 'participant'} Ask ECOS step`,
        failures,
      ));
    } else if (preflight.askEcosMode === 'disabled_for_pilot') {
      for (const key of ASK_ECOS_PILOT_STEPS) {
        if (record(session.steps)[key] !== 'not_applicable_disabled') {
          failures.push(`${id || 'participant'} ${key} must be not_applicable_disabled while Ask ECOS is disabled.`);
        }
      }
    }
    requireEvidence(session.evidenceRefs, `${id || 'participant'} pilot session`, failures, evidenceExists);
    if (failedSteps.length > 0 && session.onboardingCompleted === true) {
      failures.push(`${id || 'participant'} is marked complete despite a failed onboarding step.`);
    }
    if (session.onboardingCompleted !== true || failedSteps.length > 0) {
      const refs = Array.isArray(session.defectRefs) ? session.defectRefs.filter(nonEmptyString) : [];
      if (refs.length === 0) failures.push(`${id || 'participant'} incomplete onboarding has no defect reference.`);
    }
  }

  const denominator = sessions.length || 1;
  if (completedWithoutSupport / denominator < 0.9) {
    failures.push('Fewer than 90% of pilot participants completed onboarding without support intervention.');
  }
  if (completedWithinTarget / denominator < 0.9) {
    failures.push('Fewer than 90% of pilot participants completed setup within ten minutes, excluding background work.');
  }
  if (providerConfusionCount > 0) {
    failures.push(`${providerConfusionCount} pilot participant(s) reported provider or API setup confusion.`);
  }

  const defects = Array.isArray(value.defects) ? value.defects : [];
  const defectIds = new Set(defects.map(defect => record(defect).id).filter(nonEmptyString));
  for (const rawSession of sessions) {
    const session = record(rawSession);
    for (const ref of Array.isArray(session.defectRefs) ? session.defectRefs : []) {
      if (!defectIds.has(ref)) failures.push(`Pilot session references an unknown defect: ${ref}`);
    }
  }
  const blockers = defects.filter(isBlockingDefect);
  if (blockers.length > 0) failures.push(`${blockers.length} blocking pilot defect(s) remain open.`);

  return Object.freeze({
    ok: failures.length === 0,
    failures: Object.freeze(failures),
    metrics: Object.freeze({
      participants: sessions.length,
      completedWithoutSupport,
      completedWithinTarget,
      providerConfusionCount,
    }),
  });
}

function parseJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--device', '--operations', '--pilot'].includes(key)) continue;
    values[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return values;
}

function formatSection(name, result) {
  const lines = [`${name}: ${result.ok ? 'PASS' : 'FAIL'}`];
  for (const failure of result.failures) lines.push(`- ${failure}`);
  return lines.join('\n');
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (!args.device || !args.operations || !args.pilot) {
    process.stderr.write(
      'Usage: node scripts/beta-readiness-gate.js --device <json> --operations <json> --pilot <json>\n',
    );
    return 1;
  }
  const root = process.cwd();
  const evidenceExists = ref => {
    if (/^https:\/\//i.test(ref)) return true;
    return fs.existsSync(path.resolve(root, ref));
  };
  const deviceInput = parseJson(args.device);
  const operationsInput = parseJson(args.operations);
  const pilotInput = parseJson(args.pilot);
  const candidate = validateEvidenceCandidateConsistency(
    deviceInput,
    operationsInput,
    pilotInput,
  );
  const device = validateDeviceEvidence(deviceInput, { evidenceExists });
  const operations = validateOperationsEvidence(operationsInput, { evidenceExists });
  const pilot = validatePilotEvidence(pilotInput, { evidenceExists });
  const ok = candidate.ok && device.ok && operations.ok && pilot.ok;
  process.stdout.write([
    `Vitruvius controlled beta evidence: ${ok ? 'PASS' : 'FAIL'}`,
    formatSection('Exact release candidate', candidate),
    formatSection('Physical device, web, offline, and accessibility', device),
    formatSection('Support, operations, and recovery', operations),
    formatSection('Outside-user pilot', pilot),
    '',
  ].join('\n'));
  return ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(
      `Vitruvius controlled beta evidence FAIL: ${error instanceof Error ? error.message : 'Evidence could not be read.'}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = {
  ASK_ECOS_PILOT_STEPS,
  REQUIRED_DEVICE_JOURNEYS,
  REQUIRED_EXACT_BUILD_FUNCTIONS,
  REQUIRED_MONITORS,
  REQUIRED_NATIVE_ACCESSIBILITY_CHECKS,
  REQUIRED_PILOT_STEPS,
  REQUIRED_RECOVERY_DRILLS,
  REQUIRED_RECOVERY_SCENARIOS,
  REQUIRED_WEB_ACCESSIBILITY_CHECKS,
  runCli,
  validateDeviceEvidence,
  validateEvidenceCandidateConsistency,
  validateOperationsEvidence,
  validatePilotEvidence,
  validatePilotPreflight,
};
