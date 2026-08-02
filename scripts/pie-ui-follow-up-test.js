#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'services/PIEPhotoVisionMobileWorkflow.ts'), 'utf8');

function loadTs(relativePath) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const sandbox = { exports: {}, encodeURIComponent, Set };
  vm.runInNewContext(compiled.outputText, sandbox, { filename });
  return sandbox.exports;
}

const attentionIdentity = loadTs('services/PIEAttentionIdentity.ts');

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert(startIndex >= 0, `missing start marker ${start}`);
  assert(endIndex > startIndex, `missing end marker ${end}`);
  return source.slice(startIndex, endIndex);
}

const summarize = sliceBetween(
  app,
  'function summarizePIEStatusForUpdate',
  'function pieResultsForUpdate',
);
assert(
  summarize.indexOf("assessment.state === 'baseline_only'") <
    summarize.indexOf("assessment.state === 'failed' || assessment.state === 'incomparable'"),
  'No-prior-photo must resolve before unavailable/retry fallback.',
);
assert(
  app.includes("if (summary.status === 'no_prior_photo') return PIE_STATUS_COPY.noPriorPhoto;"),
  'No-prior-photo updates must display the positive shared baseline status.',
);
assert(
    app.includes("noPriorPhoto: 'Baseline saved'") &&
    app.includes('Baseline saved for future comparison.'),
  'Baseline updates must explain future comparison value without presenting a failure.',
);
assert(
    workflow.includes('client.functions.invoke') &&
    workflow.includes("'pie-photo-vision'") &&
    app.includes('async function retryPhotoAnalysis') &&
    app.includes('await analyzePhotoWithAuthHydrationRetry({'),
  'Retry must rerun the same pie-photo-vision workflow path.',
);
assert(
  workflow.includes('getCurrentSessionAccessToken') &&
    workflow.includes('tokenLookup.accessToken') &&
    workflow.includes('Authorization: `Bearer ${tokenLookup.accessToken}`') &&
    !workflow.includes('Authorization: `Bearer ${SUPABASE_ANON_KEY}`'),
  'pie-photo-vision invocation must attach the signed-in user session token, not the anon key.',
);
assert(
  app.includes('applyPhotoIntelligenceResult') &&
    app.includes('pieStatus: summary.status') &&
    app.includes('pieSummary: summary.summary') &&
    app.includes('pieCompletedAt:'),
  'Hydrated analysis results must update update-level PIE status for UI rendering.',
);
assert(
  workflow.includes('failureCategory') &&
    workflow.includes("'network'") &&
    workflow.includes("'auth'") &&
    workflow.includes("'malformed_response'") &&
    workflow.includes("'provider_side'") &&
    workflow.includes("'unknown'") &&
    !app.includes('Failure category:'),
  'Internal diagnostics must distinguish failure categories without exposing them in the PM UI.',
);

assert(
  app.includes("setProjectDetectionStatus('denied')") &&
    app.includes("setProjectDetectionStatus('multiple')") &&
    app.includes("setProjectDetectionStatus('unmatched')") &&
    app.includes("setProjectDetectionStatus(projectName ? 'detected' : 'unmatched')"),
  'GPS defaulting must distinguish denied, multiple, unmatched, and detected states.',
);
assert(
  app.includes("projectDetectionStatus === 'detected' ? detectedProjectName : null") &&
    app.includes("setProjectDetectionStatus('multiple')") &&
    app.includes('setDetectedProjectName(null)'),
  'A clear GPS match may seed a new update, while an ambiguous match must require project selection.',
);
assert(
  app.includes('likelyProjectCandidatesFromGps') &&
    app.includes('topCandidates') &&
    app.includes('slice(0, 3)') &&
    app.includes('GPS_CLEAR_WINNER_DISTANCE_FEET') &&
    app.includes('gpsCandidates.ambiguous') &&
    app.includes('gpsCandidates.topCandidates.length === 0'),
  'Multiple similar GPS matches must preserve only the narrowed top-2-to-3 candidate set.',
);
assert(
  app.includes('PIE_GPS_MATCH_DIAGNOSTIC no_saved_project_area_coordinates') &&
    app.includes('totalProjectAreas') &&
    app.includes('missingSavedCoordinates') &&
    !app.includes('PIE_GPS_MATCH_DIAGNOSTIC coordinates'),
  'Dev GPS diagnostics must flag missing saved project-area coordinates without exposing raw coordinates.',
);
const overviewScreen = sliceBetween(app, 'function HomeScreen', 'function SelectProjectScreen');
assert(
  app.includes('buildProjectCardPIEStatus([], scopedFieldUpdates)'),
  'Overview project cards must use the exact parent-scoped DAVE status copy.',
);
assert(
  !overviewScreen.includes('All projects on track — nothing needs your attention.'),
  'Project cards must not render the Overview all-project empty-state string.',
);
assert(
  app.includes('const attentionItems = buildPhase2AttentionItems(scopedFieldUpdates, null);') &&
    app.includes('hasAttention: attentionItems.length > 0') &&
    app.includes("const needsAttention = operationalStatus.status !== 'Healthy';") &&
    overviewScreen.includes("<Text style={[styles.overviewProjectHealth, { color: healthColor }]}>{health}</Text>"),
  'Overview project cards must derive and display operational health from current attention items.',
);
assert(
  !overviewScreen.includes('Needs Review'),
  'Project card status must not use Needs Review.',
);
[
  'Last update cloud synced',
  'updates analyzing',
  'Analysis unavailable · Retry',
  'Queued update waiting to sync',
  'Safety item needs review',
  'No recent updates',
].forEach(marker => {
  assert(app.includes(marker), `Project card status should include ${marker}`);
});

const attentionBuilder = sliceBetween(app, 'function buildPhase2AttentionItems', 'function stableOpenItemAttentionId');
[
  'Safety concern detected',
  'PIE_STATUS_COPY.unavailableRetry',
  'PIE_STATUS_COPY.timeoutRetry',
  'Queued update waiting to sync',
  'Sync failed · Retry',
  'Update ready to sync',
  'Missing recipients',
  'Blocker tagged',
  'Document upload failed · Retry',
  'areaLabel',
  'retryable: true',
  "statusRole: 'safety'",
  "statusRole: 'needsRetry'",
  "actionTarget: 'retry_photo_analysis'",
  "actionTarget: 'retry_send'",
  'updateId: update.id',
  'photoId: photo.id',
].forEach(marker => {
  assert(attentionBuilder.includes(marker), `Needs Attention should include ${marker}`);
});
assert(
  !attentionBuilder.includes('Open item needs follow-up'),
  'Needs Attention must not use repeated generic Open item needs follow-up copy.',
);
assert(
  attentionBuilder.includes('stableOpenItemAttentionId') &&
    app.includes('function stableOpenItemAttentionId') &&
    app.includes('buildStableAttentionItemId') &&
    app.includes('dedupeAttentionItemsById(items)'),
  'Open items must have a stable identity instead of spawning a new card per update/photo id.',
);
const stableOpenItemId = sliceBetween(app, 'function stableOpenItemAttentionId', 'function recurringOpenItemContext');
assert(
  stableOpenItemId.includes('attentionCategoryForPhotoCategory(photo.category)') &&
    stableOpenItemId.includes('updateId: update.id') &&
    stableOpenItemId.includes('photoId: photo.id') &&
    !stableOpenItemId.includes('photo.actionRequired') &&
    !stableOpenItemId.includes('photo.caption') &&
    !stableOpenItemId.includes('title') &&
    !stableOpenItemId.includes('detail'),
  'Stable open-item identity must use category context, not raw caption/action wording.',
);

const stableInput = {
  updateId: 'update-123',
  photoId: 'photo-456',
  category: 'open_issue',
  itemType: 'open_item',
  subtype: 'photo_action',
};
const originalId = attentionIdentity.buildStableAttentionItemId({
  ...stableInput,
  caption: 'Original caption',
  actionRequired: 'Original action wording',
});
const editedWordingId = attentionIdentity.buildStableAttentionItemId({
  ...stableInput,
  caption: 'Completely rewritten caption',
  actionRequired: 'Completely rewritten action wording',
});
assert.strictEqual(originalId, editedWordingId, 'caption and action wording edits must not change attention identity');

const safetyId = attentionIdentity.buildStableAttentionItemId({
  ...stableInput,
  category: 'safety_concern',
  itemType: 'safety_observation',
});
assert.notStrictEqual(originalId, safetyId, 'different categories for the same update/photo must receive different IDs');
assert.strictEqual(
  originalId,
  attentionIdentity.buildStableAttentionItemId(JSON.parse(JSON.stringify(stableInput))),
  'the same category/update identity must survive reload serialization',
);
const dedupedAttention = attentionIdentity.dedupeAttentionItemsById([
  { id: originalId, title: 'Original wording' },
  { id: originalId, title: 'Edited wording' },
  { id: safetyId, title: 'Safety wording' },
]);
assert.strictEqual(dedupedAttention.length, 2, 'Needs Attention must dedupe repeated stable identities');
assert.strictEqual(dedupedAttention[0].title, 'Original wording', 'deduplication must preserve the first ranked item');
assert(
  app.includes('function buildUpdateTombstone') &&
    app.includes('function upsertDeletedUpdateTombstone') &&
    app.includes("mergeDecision: 'tombstoned'"),
  'stable attention identity must not affect delete/archive tombstone behavior',
);
assert(
  !attentionBuilder.includes('Permit card missing') &&
    !attentionBuilder.includes('Schedule missing') &&
    !attentionBuilder.includes('Inspection card missing'),
  'Needs Attention must not show unsupported missing-document claims.',
);
assert(
  app.includes('const ATTENTION_PRIORITY') &&
    app.indexOf('safety: 0') < app.indexOf('sendIssue: 1') &&
    app.indexOf('sendIssue: 1') < app.indexOf('analysisIssue: 2') &&
    app.indexOf('analysisIssue: 2') < app.indexOf('readyToSend: 3') &&
    app.indexOf('readyToSend: 3') < app.indexOf('blocker: 4') &&
    app.indexOf('blocker: 4') < app.indexOf('documentIssue: 5') &&
    app.indexOf('documentIssue: 5') < app.indexOf('otherOpenItem: 6') &&
    attentionBuilder.includes('.sort((a, b) => a.priority - b.priority'),
  'Safety and higher-priority attention items must sort first.',
);

const savedUpdatesScreen = sliceBetween(app, 'function SavedUpdatesScreen', 'function UpdateFilterSheet');
assert(
  savedUpdatesScreen.includes('function retryUpdate(update: ProjectUpdate)') &&
    savedUpdatesScreen.includes('if (targetPhoto) onRetryPhotoAnalysis(update, targetPhoto)') &&
    savedUpdatesScreen.includes('updateCanInlineRetry(update)'),
  'Analysis unavailable Needs Attention retry must rerun photo analysis for the source update/photo.',
);
assert(
  savedUpdatesScreen.includes("lifecycle === 'queued' || lifecycle === 'failed'") &&
    savedUpdatesScreen.includes('onRetryQueuedUpdate(update)'),
  'Queued or failed send Needs Attention retry must route to the source queued update.',
);
assert(
  savedUpdatesScreen.includes('renderUpdateCard(item, index, () => onOpen(item))'),
  'Needs Attention cards must route to their source update.',
);

const updateHistoryCard = sliceBetween(app, 'function UpdateHistoryCard', 'function UpdateOverflowMenu');
assert(
  updateHistoryCard.includes('onRetry?: () => void') &&
    updateHistoryCard.includes('onPress={onRetry}') &&
    updateHistoryCard.includes('onPress={onOpen}'),
  'Retryable Needs Attention cards must expose an inline Retry action distinct from the card tap target.',
);

console.log('PIE UI follow-up tests passed.');
