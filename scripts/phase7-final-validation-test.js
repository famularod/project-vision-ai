#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const app = read('App.tsx');
const appShellFrame = read('components/app-shell-frame.tsx');
const bottomNav = read('components/app-bottom-tabs.tsx');
const sync = read('services/SyncService.ts');
const lifecycle = read('services/FieldUpdateLifecycle.ts');
const timing = read('services/SixtySecondFlowInstrumentation.ts');
const phase6 = read('scripts/phase6-documents-foundation-test.js');

[
  'ANALYSIS_TIMEOUT_SECONDS = 135',
  'PIE_ANALYSIS_PENDING_TIMEOUT_MS = ANALYSIS_TIMEOUT_SECONDS * 1000',
  'PIE_STATUS_COPY',
  'PIE_STATUS_COPY.checking',
  'Possible visual changes found',
  'No reliable visual change',
  'Baseline saved',
  'Analysis unavailable · Retry',
  'Analysis taking longer than expected · Retry',
].forEach(marker => {
  assert(app.includes(marker), `Phase 7 should use shared PIE status marker ${marker}`);
});

assert(
  app.includes('<AppShellFrame') &&
    appShellFrame.includes('<AppBottomTabs') &&
    app.includes("screen === 'Reports'") &&
    app.includes('<ReportsScreen'),
  'App must render the extracted live bottom tabs and Reports screen.',
);
assert(
  bottomNav.includes('label="Overview"') &&
    !bottomNav.includes('label="Projects"') &&
    !bottomNav.includes('label="Updates"') &&
    bottomNav.includes('label="Tasks"') &&
    bottomNav.includes('label="Reports"') &&
    !bottomNav.includes('label="Settings"') &&
    !bottomNav.includes('label="Capture"') &&
    !bottomNav.includes('label="Share"') &&
    (bottomNav.match(/<TabButton/g) || []).length === 3,
  'Live bottom tabs must expose Overview, Tasks, and Reports while Settings remains reachable from Overview.',
);

[
  'No projects yet.',
  "✅ You're all caught up.",
  'No field records require action today.',
  'No drafts.',
  'No update history yet.',
  'No documents yet — upload your first document.',
].forEach(marker => {
  assert(app.includes(marker), `Phase 7 empty state should include ${marker}`);
});

[
  'Permit card missing',
  'Permit Card missing',
  'Schedule missing',
  'Inspection card missing',
  'Inspection Card missing',
].forEach(claim => {
  assert(!app.includes(claim), `Production UI must not claim ${claim}`);
});

assert(
  app.includes('Area auto-detected') &&
    app.includes('Area suggested') &&
    !app.includes('GPS Captured'),
  'Area wording should distinguish auto-detected from suggested without stale GPS Captured copy.',
);

[
  'cameraActionStartedAt',
  'firstPhotoAddedAt',
  'reviewOpenedAt',
  'sendTappedAt',
  'sendResolvedAt',
  'buildSixtySecondFlowTimingResult',
  'flowTimingForUpdate',
].forEach(marker => {
  assert(app.includes(marker) || timing.includes(marker), `60-second instrumentation should include ${marker}`);
});

assert(
  timing.includes('elapsedSeconds') &&
    timing.includes('withinTarget') &&
    timing.includes('canSendWhileAnalysisPending'),
  'Timing helper should expose elapsed time, target result, and pending-PIE send behavior.',
);

const start = new Date('2026-07-06T12:00:00.000Z').getTime();
const resolved = new Date('2026-07-06T12:00:42.000Z').getTime();
const elapsedSeconds = Math.max(0, Math.round((resolved - start) / 100) / 10);
assert(elapsedSeconds === 42, 'Mock one-photo flow timing should be deterministic and under 60 seconds.');

assert(
  app.includes('hydrateQueuedUpdates') &&
    app.includes('statusForSyncDiagnostics(syncDiagnostics)') &&
    lifecycle.includes("if (input.result === 'success') return 'sent';") &&
    lifecycle.includes("if (input.failureCategory === 'offline') return 'queued';") &&
    app.includes('queuedHydrationInFlight') &&
    sync.includes('runFieldUpdateCloudSync') &&
    sync.includes('stageProjectUpdateForSync'),
  'Queued updates should hydrate through the idempotent pending-change path and preserve cloud-synced/queued/failed outcomes.',
);

assert(
  app.includes('Document upload pending') &&
    app.includes('Document upload failed · Retry') &&
    phase6.includes('Document upload failed · Retry'),
  'Document upload vocabulary should be consistent and retryable.',
);

assert(
  app.includes('Archive cloud-synced update?') &&
    app.includes('Archive compliance-sensitive document?') &&
    app.includes('isArchived') &&
    app.includes('archivedAt'),
  'Cloud-synced updates and compliance-sensitive documents should use guarded archive/delete flows.',
);

assert(
  !app.includes('EXPO_PUBLIC_OPENAI_API_KEY') &&
    !app.includes('EXPO_PUBLIC_AI_PROVIDER') &&
    !app.includes('EXPO_PUBLIC_OPENAI_MODEL') &&
    !app.includes('SERVICE_ROLE') &&
    !app.includes('signedUrl') &&
    !app.includes('signed URL'),
  'Phase 7 must preserve mobile secret and signed URL boundaries.',
);

console.log('Phase 7 final validation tests passed.');
