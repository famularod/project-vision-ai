#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'services/SyncService.ts'), 'utf8');
const updatesScreen = app.slice(
  app.indexOf('function SavedUpdatesScreen'),
  app.indexOf('function UpdateFilterSheet'),
);

[
  'title="Updates"',
  "useState<'Needs Attention' | 'Drafts' | 'History'>",
  "(['Needs Attention', 'Drafts', 'History'] as const)",
  'UpdateFilterSheet',
  'Needs Attention',
  'Drafts',
  'History',
  "✅ You're all caught up.",
  'No updates require your attention today.',
  "Ready to capture today&apos;s work?",
  'No drafts.',
  'No update history yet.',
  "type UpdateTimelineGroup = 'Today' | 'Yesterday' | 'Earlier'",
  'updateTimelineGroup(update.date)',
  'relativeUpdateTimestamp(update.date)',
  'updatePhotoStatusPill',
  'lifecycleStatusForUpdate',
  'updatePIEAnalysisStatus',
  "Queued — will send when you're back online",
  'Ready to send',
  'Analysis unavailable · Retry',
  'Analysis taking longer than expected · Retry',
  'No photos attached',
  'Retry',
  'stableSendId',
  'Archive sent update',
  'Delete failed update',
  'Remove from device',
  'DELETED_UPDATES_STORAGE_KEY',
  'mergeSavedUpdatesWithTombstones',
  'removeProjectUpdateFromSyncQueue',
  'ReadOnlyUpdateDetailScreen',
  'screenForUpdateResume(update)',
  'ANALYSIS_TIMEOUT_SECONDS',
  'PIE_ANALYSIS_PENDING_TIMEOUT_MS = ANALYSIS_TIMEOUT_SECONDS * 1000',
].forEach(marker => {
  assert(app.includes(marker), `Phase 5 Updates screen should include ${marker}`);
});

assert(
  !app.includes('Filter by Area'),
  'Updates screen should not show the old wall of area chips.',
);
assert(
  !updatesScreen.includes('iconOnlyDangerButton'),
  'Updates cards should not have always-visible red trash icons.',
);
assert(
  app.includes("if (activeTab === 'Needs Attention') return updateNeedsReview(update);"),
  'Needs Attention tab should derive from shared lifecycle and DAVE status.',
);
assert(
  !updatesScreen.includes('Needs Your Attention') &&
    !updatesScreen.includes("(['Needs Review', 'Drafts', 'Sent', 'All'] as const)"),
  'Updates should rely on the active three-tab queue without a redundant section title.',
);
assert(
  updatesScreen.includes('group !== previousGroup') &&
    updatesScreen.includes('styles.updateGroupHeader'),
  'Updates should render timeline headers only at group boundaries.',
);
assert(
  app.includes("lifecycle === 'sent'") && app.includes('archiveSavedUpdate'),
  'Sent updates should archive instead of permanently deleting.',
);
assert(
  app.includes('const tombstone = buildUpdateTombstone(') &&
    app.includes('deletedUpdate,') &&
    app.includes("action === 'archive_sent_update'") &&
    app.includes("mergeDecision: 'tombstoned'"),
  'Deleted and archived updates must record local tombstones to prevent resurrection.',
);
assert(
  app.includes('{__DEV__ && update.deleteDiagnostics') &&
    app.includes('update.deleteDiagnostics.sourceAfterReload') &&
    app.includes('update.deleteDiagnostics.mergeDecision') &&
    app.includes('update.deleteDiagnostics.orphanedPhotoCountIgnored'),
  'Developer diagnostics must expose safe delete/merge state without raw cloud details.',
);
assert(
  sync.includes('removeProjectUpdateFromSyncQueue') &&
    sync.includes("item.entity !== 'project_update'") &&
    sync.includes('payload.id !== updateId'),
  'Deleting a failed update must remove matching project_update work from the pending sync queue.',
);
assert(
  app.includes('recipientNames') && app.includes('contactNamesById'),
  'Search should include local recipient names without blocking lookups.',
);
assert(
  sync.includes("id: `project-update-${update.id}`") &&
    sync.includes('queue.filter(item => item.id !== queueItem.id)'),
  'Inline retry should reuse Phase 4 stable queue id behavior.',
);
assert(
  !app.includes('EXPO_PUBLIC_OPENAI_API_KEY') &&
    !app.includes('EXPO_PUBLIC_AI_PROVIDER') &&
    !app.includes('EXPO_PUBLIC_OPENAI_MODEL'),
  'Mobile code must not reference public OpenAI configuration.',
);

console.log('Phase 5 updates screen tests passed.');
