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
  "useState<'Needs Review' | 'Drafts' | 'Sent' | 'All'>('Needs Review')",
  'UpdateFilterSheet',
  'Needs Review',
  'Drafts',
  'Sent',
  'All',
  'Nothing needs review — you’re all caught up.',
  'No drafts.',
  'No sent updates yet.',
  'No updates yet.',
  'lifecycleStatusForUpdate',
  'updatePIEAnalysisStatus',
  'Queued — will send when online',
  'Ready to send',
  'Analysis unavailable · Retry',
  'Analysis taking longer than expected · Retry',
  'No photos attached',
  'Retry',
  'stableSendId',
  'Archive sent update',
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
  app.includes("if (activeTab === 'Needs Review') return updateNeedsReview(update);"),
  'Needs Review tab should derive from shared lifecycle and PIE status.',
);
assert(
  app.includes("lifecycle === 'sent'") && app.includes('archiveSavedUpdate'),
  'Sent updates should archive instead of permanently deleting.',
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
