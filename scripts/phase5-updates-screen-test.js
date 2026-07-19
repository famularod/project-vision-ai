#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'services/SyncService.ts'), 'utf8');
const supabase = fs.readFileSync(path.join(root, 'services/SupabaseService.ts'), 'utf8');
const updateService = fs.readFileSync(path.join(root, 'services/updateService.ts'), 'utf8');
const deleteControl = fs.readFileSync(path.join(root, 'components/update-delete-control.tsx'), 'utf8');
const updatesScreen = app.slice(
  app.indexOf('function SavedUpdatesScreen'),
  app.indexOf('function UpdateFilterSheet'),
);
const updateCard = app.slice(
  app.indexOf('function UpdateHistoryCard'),
  app.indexOf('function UpdateOverflowMenu'),
);
const updateDetail = app.slice(
  app.indexOf('function ReadOnlyUpdateDetailScreen'),
  app.indexOf('function ProjectsScreen'),
);

[
  'title="Field Activity"',
  "useState<'Needs Action' | 'Drafts' | 'All Activity'>",
  "(['Needs Action', 'Drafts', 'All Activity'] as const)",
  'UpdateFilterSheet',
  'Needs Action',
  'Drafts',
  'All Activity',
  "✅ You're all caught up.",
  'No field records require action today.',
  'No drafts.',
  'No update history yet.',
  "type UpdateTimelineGroup = 'Today' | 'Yesterday' | 'Earlier'",
  'updateTimelineGroup(update.date)',
  'relativeUpdateTimestamp(update.date)',
  'updatePhotoStatusPill',
  'lifecycleStatusForUpdate',
  'updatePIEAnalysisStatus',
  "Queued — will sync when you're back online",
  'Ready to sync',
  'Analysis unavailable · Retry',
  'Analysis taking longer than expected · Retry',
  'No photos attached',
  'Retry',
  'stableSendId',
  'Archive cloud-synced update',
  'Delete This Update',
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
  app.includes("if (activeTab === 'Needs Action') return updateNeedsReview(update);"),
  'Needs Action tab should derive from shared lifecycle and DAVE status.',
);
assert(
  !updatesScreen.includes('Needs Your Attention') &&
    !updatesScreen.includes("(['Needs Review', 'Drafts', 'Sent', 'All'] as const)"),
  'Updates should rely on the active three-tab queue without a redundant section title.',
);
assert(
  updatesScreen.indexOf('title="Field Activity"') <
    updatesScreen.indexOf('styles.updateSearchPanel') &&
    updatesScreen.indexOf('styles.updateSearchPanel') <
    updatesScreen.indexOf('styles.updateSegmentRow') &&
    updatesScreen.includes('renderItem={renderUpdate}') &&
    !updatesScreen.includes('ListFooterComponent') &&
    !updatesScreen.includes('label="New Update"'),
  'Field Activity must remain a focused searchable record, with capture launched from Overview or a project.',
);
assert(
  updatesScreen.includes('accessibilityRole="tab"') &&
    updatesScreen.includes('accessibilityState={{ selected }}') &&
    updatesScreen.includes('accessibilityRole="button"') &&
    app.includes('updateSegment: {') &&
    app.includes('minHeight: 44'),
  'Updates tabs and cards must expose large accessible touch targets.',
);
assert(
  updateCard.includes('styles.updateCardMedia') &&
    updateCard.includes('styles.updateCardProject') &&
    updateCard.includes('styles.updateCardSummary') &&
    updateCard.includes('relativeUpdateTimestamp(update.date)') &&
    updateCard.includes('styles.updateCardType') &&
    updateCard.includes('styles.updatePhotoStatusPill') &&
    updateCard.includes('name="chevron-forward"'),
  'Each update card must keep its large thumbnail, project, summary, relative time, type, status, and chevron.',
);
assert(
  updatesScreen.includes('group !== previousGroup') &&
    updatesScreen.includes('styles.updateGroupHeader'),
  'Updates should render timeline headers only at group boundaries.',
);
assert(
  app.includes('archiveSavedUpdate') &&
    app.includes('persistAndQueueProjectUpdateDeletion') &&
    updateService.includes('queueProjectUpdateDelete(update)') &&
    app.includes("'delete_update_everywhere'"),
  'Cloud-synced updates should support both archive and permanent owner-scoped deletion.',
);
assert(
  app.includes('const tombstone = buildUpdateTombstone(') &&
    app.includes('deletedUpdate,') &&
    app.includes("'delete_update_everywhere'") &&
    app.includes("action === 'archive_sent_update'") &&
    app.includes("mergeDecision: 'tombstoned'"),
  'Deleted and archived updates must record local tombstones to prevent resurrection.',
);
assert(
  updateDetail.includes('<UpdateDeleteControl onDelete={onDelete} />') &&
    deleteControl.includes('accessibilityLabel="Permanently delete this saved update"') &&
    deleteControl.includes('Delete This Update') &&
    deleteControl.includes('stops it from affecting project status and related warnings'),
  'Read-only update detail must expose a visible, plain-language delete action.',
);
assert(
  app.includes("updateDetailReturnScreenRef = useRef<AppScreen>('SavedUpdates')") &&
    app.includes("onOpenUpdate={update => openSavedUpdate(update, 'Schedule')}") &&
    app.includes('setScreen(updateDetailReturnScreenRef.current)') &&
    app.includes("onOpenUpdate={update => openSavedUpdate(update, 'ProjectWorkspace')}") &&
    updateDetail.includes('{backLabel}') &&
    app.includes('update.scheduleTaskName') &&
    app.includes('cloud record will be deleted automatically when sync is available') &&
    app.includes('updateDeletionInFlightRef.current') &&
    app.includes('upsertSavedUpdateUnlessDeleted') &&
    app.includes('await reconcileProjectUpdateDeletionJournal(tombstones)'),
  'Update deletion must identify the exact source and return Action Inbox users to Tasks.',
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
    sync.includes("if (item.operation === 'delete') return true") &&
    sync.includes('payload.id !== updateId'),
  'Cleanup must remove stale update work while preserving a queued permanent delete.',
);
assert(
  sync.includes("if (item.operation === 'delete')") &&
    sync.includes('deleteProjectUpdate({') &&
    supabase.includes(".from(PROJECT_UPDATES_TABLE)\n    .delete()") &&
    supabase.includes(".eq('owner_id', owner.data)") &&
    supabase.includes(".eq('id', updateId)"),
  'Permanent field-update deletion must be queued and owner-scoped in the cloud.',
);
assert(
  app.includes('recipientNames') && app.includes('contactNamesById'),
  'Search should include local recipient names without blocking lookups.',
);
assert(
  sync.includes('id: projectUpdateQueueItemId(update.id)') &&
    sync.includes('queue.filter(existing => existing.id !== queueItem.id)'),
  'Inline retry should reuse Phase 4 stable queue id behavior.',
);
assert(
  !app.includes('EXPO_PUBLIC_OPENAI_API_KEY') &&
    !app.includes('EXPO_PUBLIC_AI_PROVIDER') &&
    !app.includes('EXPO_PUBLIC_OPENAI_MODEL'),
  'Mobile code must not reference public OpenAI configuration.',
);

console.log('Phase 5 updates screen tests passed.');
