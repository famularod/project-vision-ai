#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'services/PIEPhotoVisionMobileWorkflow.ts'), 'utf8');

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
  summarize.indexOf("status === 'no_suitable_prior_photo'") <
    summarize.indexOf("status === 'analysis_failed_retry'"),
  'No-prior-photo must resolve before unavailable/retry fallback.',
);
assert(
  app.includes("if (summary.status === 'no_prior_photo') return PIE_STATUS_COPY.noPriorPhoto;"),
  'No-prior-photo updates must display No prior photo to compare.',
);
assert(
  workflow.includes('client.functions.invoke') &&
    workflow.includes("'pie-photo-vision'") &&
    app.includes('async function retryPhotoAnalysis') &&
    app.includes('const result = await analyzeProjectPhotoWithVision({'),
  'Retry must rerun the same pie-photo-vision workflow path.',
);
assert(
  workflow.includes('getCurrentSessionAccessToken') &&
    workflow.includes('sessionTokenResult.data') &&
    workflow.includes('Authorization: `Bearer ${sessionTokenResult.data}`') &&
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
    app.includes('Failure category:'),
  'Dev diagnostics must distinguish failure category instead of collapsing every failure into generic unavailable.',
);

assert(
  app.includes("setProjectDetectionStatus('denied')") &&
    app.includes("setProjectDetectionStatus('multiple')") &&
    app.includes("setProjectDetectionStatus(projectName ? 'not_applied' : 'unmatched')") &&
    app.includes("setProjectDetectionStatus('unmatched')") &&
    app.includes("setProjectDetectionStatus(projectName ? 'detected' : 'unmatched')"),
  'GPS defaulting must distinguish denied, multiple, unmatched, not-applied, and detected states.',
);
assert(
  app.includes('overviewProjectSelection === undefined') &&
    app.includes('? detectedProjectName') &&
    app.includes('onNewUpdate(detectedProjectName)'),
  'Detected GPS project must become the active Overview project and New Update target.',
);
assert(
  app.includes('openSelector(\'newUpdate\')') &&
    app.includes('No nearby project matched; showing all projects') &&
    app.includes('Location unavailable; showing all projects') &&
    app.includes('Multiple nearby projects found; choose one to continue') &&
    app.includes('GPS found multiple nearby projects. Choose one of these likely matches.'),
  'GPS fallback must keep All Projects and route New Update through project selection.',
);
assert(
  app.includes('likelyProjectCandidatesFromGps') &&
    app.includes('topCandidates') &&
    app.includes('slice(0, 3)') &&
    app.includes('GPS_CLEAR_WINNER_DISTANCE_FEET') &&
    app.includes("projectDetectionStatus === 'multiple'") &&
    app.includes('projectPickerCandidates'),
  'Multiple similar GPS matches must use a narrowed top-2-to-3 picker instead of the full list.',
);
assert(
  app.includes('PIE_GPS_MATCH_DIAGNOSTIC no_saved_project_area_coordinates') &&
    app.includes('totalProjectAreas') &&
    app.includes('missingSavedCoordinates') &&
    !app.includes('PIE_GPS_MATCH_DIAGNOSTIC coordinates'),
  'Dev GPS diagnostics must flag missing saved project-area coordinates without exposing raw coordinates.',
);
assert(
  app.includes('overviewProjectManuallySelected') &&
    app.includes('setOverviewProjectManuallySelected(true)') &&
    app.includes('Nearby project found; manual selection preserved'),
  'Late GPS matches must not override a manual Overview project selection.',
);

const projectCard = sliceBetween(app, 'function Phase2ProjectCard', 'function ProjectWorkspaceScreen');
assert(
  app.includes('buildProjectCardPIEStatus(project, savedUpdates)'),
  'Project cards must use project-specific PIE status copy.',
);
assert(
  !projectCard.includes('All projects on track — nothing needs your attention.'),
  'Project cards must not render the Overview all-project empty-state string.',
);
assert(
  projectCard.includes('item.attentionCount > 0') &&
    app.includes('attentionCount: buildPhase2AttentionItems(savedUpdates, project).length'),
  'A project with open Needs Attention items must show Attention Needed instead of On Track.',
);
assert(
  !projectCard.includes('Needs Review'),
  'Project card status must not use Needs Review.',
);
[
  'Last update sent',
  'updates analyzing',
  'Analysis unavailable · Retry',
  'Queued update waiting to send',
  'Safety item needs review',
  'No recent updates',
].forEach(marker => {
  assert(app.includes(marker), `Project card status should include ${marker}`);
});

const attentionBuilder = sliceBetween(app, 'function buildPhase2AttentionItems', 'function projectThumbnailUri');
[
  'Safety concern detected',
  'PIE_STATUS_COPY.unavailableRetry',
  'PIE_STATUS_COPY.timeoutRetry',
  'Queued update waiting to send',
  'Send failed · Retry',
  'Update ready to send',
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
    app.includes('stableUiHash'),
  'Open items must have a stable identity instead of spawning a new card per update/photo id.',
);
const stableOpenItemId = sliceBetween(app, 'function stableOpenItemAttentionId', 'function recurringOpenItemContext');
assert(
  stableOpenItemId.includes('update.quickContext || photo.category') &&
    !stableOpenItemId.includes('photo.actionRequired') &&
    !stableOpenItemId.includes('photo.caption'),
  'Stable open-item identity must use category context, not raw caption/action wording.',
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

const homeScreen = sliceBetween(app, 'function HomeScreen', 'function ProjectSelectorSheet');
assert(
  homeScreen.includes('function retryAttentionItem') &&
    homeScreen.includes("item.actionTarget === 'retry_photo_analysis'") &&
    homeScreen.includes('onRetryPhotoAnalysis(update, photo)'),
  'Analysis unavailable Needs Attention retry must rerun photo analysis for the source update/photo.',
);
assert(
  homeScreen.includes("item.actionTarget === 'retry_send'") &&
    homeScreen.includes('onRetryQueuedUpdate(update)'),
  'Queued or failed send Needs Attention retry must route to the source queued update.',
);
assert(
  homeScreen.includes('onOpenUpdate(update)') &&
    homeScreen.includes('onOpenProject(item.projectName)'),
  'Needs Attention cards must route to the relevant update when possible and fall back to project workspace.',
);

const attentionCard = sliceBetween(app, 'function Phase2AttentionCard', 'function Phase2ActivityRow');
assert(
  attentionCard.includes('onRetry?: () => void') &&
    attentionCard.includes('onRetry || onPress'),
  'Retryable Needs Attention cards must expose an inline Retry action distinct from the card tap target.',
);

console.log('PIE UI follow-up tests passed.');
