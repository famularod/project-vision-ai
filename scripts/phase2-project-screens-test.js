#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const statusViews = fs.readFileSync(
  path.join(root, 'components/DAVEProjectStatusViews.tsx'),
  'utf8',
);
const uiSource = `${app}\n${statusViews}`;
const projectTruth = fs.readFileSync(path.join(root, 'services/DAVEProjectTruth.ts'), 'utf8');
const projectStatus = fs.readFileSync(
  path.join(root, 'services/DAVEProjectOperationalStatus.ts'),
  'utf8',
);

[
  'function HomeScreen({',
  'ProjectSelectorSheet',
  'Needs Attention',
  'Project Health',
  'Current Focus',
  'All clear',
  "project{scopedProjects.length === 1 ? '' : 's'} reviewed",
  'Nothing due today',
  "currentFocus?.stateLabel || (topPriority ? 'NEEDS SETUP' : 'ALL CLEAR')",
  'Active Projects',
  'Recent Activity',
  'View all activity',
  'Active Projects',
  'Healthy',
  'Needs Setup',
  'At Risk',
  'Blocked',
  'title="Project Management"',
  'label="New Project"',
  "label: 'Healthy'",
  "label: 'At Risk'",
  "title={search ? 'No matching projects' : 'No projects yet'}",
  'accessibilityLabel="Clear project search"',
  'Open Projects',
  'ProjectWorkspace',
  'ProjectTaskControlPanel',
  'Tasks and Schedule',
  'Restoring project status…',
  'Loading projects, schedules, documents, and field updates before showing project health.',
  'deriveDAVEProjectOperationalStatus({',
  'Needs Verification',
  'Schedule: {scheduleStatus}',
  'title="Project Options"',
  'View All Tasks',
  'New Field Update',
  'Recent project activity will show up here.',
  'Attention Needed',
  'Waiting',
  'On Track',
  'overviewAskDaveButton',
  'name="settings-outline"',
  'accessibilityLabel="Open Settings"',
  'const projectIntelligence = liveAuthority.projectTruth.intelligence',
  'buildPIEScheduleReconciliation({',
  'onNewFieldUpdate(projectName)',
].forEach(marker => {
  assert(uiSource.includes(marker), `Phase 2 screen should include ${marker}`);
});

assert(!app.includes("Today's Brief"), 'Overview should not render a separate Today\'s Brief section.');

[
  'Executive Summary',
  'Quick Actions',
  'Dashboard TEST',
].forEach(marker => {
  assert(!app.includes(marker), `Phase 2 Overview should hide ${marker}`);
});

assert(
  app.includes('onPress={() => onOpenProject(row.project)}'),
  'Project cards should open Project Workspace.',
);
assert(
  app.includes('statusReady={projectStatusReady}') &&
    app.includes('if (!statusReady)') &&
    app.includes('const requiredLocalHydrationDomains = [') &&
    app.includes('updatesLocalLoaded') &&
    app.includes('deletedUpdateTombstonesLoaded') &&
    app.includes('projectsLocalLoaded') &&
    app.includes('deletedProjectNamesLocalLoaded') &&
    app.includes('archivedProjectsLoaded') &&
    app.includes('projectAreasLocalLoaded') &&
    app.includes('referenceDocumentsLocalLoaded') &&
    app.includes('projectDocumentsLoaded') &&
    app.includes('scheduleItemsLocalLoaded') &&
    app.includes('captureMemoriesLoaded') &&
    app.includes('identityCorrectionsLoaded') &&
    app.includes('scheduleIdentityReady') &&
    app.includes('displayNameLoaded') &&
    app.includes('contactsLoaded') &&
    app.includes('draftLoaded') &&
    app.includes('const startupHydrationReady = isStartupHydrationReady(') &&
    app.includes('requiredLocalHydrationDomains,') &&
    app.includes('startupHydration.failures,') &&
    app.includes('hydrated: projectStatusReady'),
  'Status surfaces and the shared authority must wait for the complete local project snapshot.',
);
assert(
  app.includes('const health = row.health;') &&
    app.includes('right.priorityRank - left.priorityRank') &&
    !app.includes("row.severity === 'high' ? 'Blocked'"),
  'Overview must render the canonical project health instead of translating generic severity into Blocked.',
);
assert(
  projectStatus.includes("status: 'Blocked'") &&
    projectStatus.includes("status: 'At Risk'") &&
    projectStatus.includes("status: 'Needs Setup'") &&
    projectStatus.includes('priorityRank') &&
    projectStatus.includes('needsVerification') &&
    projectStatus.includes("input.scheduleHealth === 'Blocked'") &&
    projectStatus.includes('if (primaryWarning)'),
  'Canonical project health must reserve Blocked for actual blocking input and keep conflicts reviewable.',
);
assert(
  (
    app.includes('findCurrentDAVEConfirmedBlockerForScopes(') ||
    app.includes('findCurrentDAVEConfirmedBlocker(scopedFieldUpdates)')
  ) &&
    app.includes('updateHasOpenDAVESafetyConcern(update)') &&
    app.includes('updateHasOpenDAVEBlocker(update)') &&
    app.includes('currentConfirmedBlocker?.id === update.id'),
  'Project health must use current unresolved blocker and safety evidence only.',
);
assert(
  app.split('operationalScheduleItemsForProject(').length >= 3,
  'Overview and Workspace must reconcile the same canonical project schedule slice.',
);
assert(!app.includes('>Project Snapshot<'), 'The retired Project Brief/Snapshot must stay hidden.');
assert(!app.includes('<DAVEAskExperience'), 'The suggested-question Project Assistant must stay hidden.');
assert(
  app.includes('Archived Projects') && app.includes('onReopenProject(projectName)'),
  'Overview must preserve archived-project recovery after removing the duplicate Projects route.',
);
assert(
    projectTruth.includes("evidenceClass: safeVisualEvidence ? 'observation'") &&
    projectTruth.includes('changeFromPrior: hasComparablePrior') &&
    app.includes('buildPIEProjectBriefModel') &&
    app.includes('const observations = brief.observations'),
  'Observed photo findings must remain available to concise Overview activity without restoring Project Brief.',
);
assert(
  projectTruth.includes("intelligence?.provenance === 'visual_only'") &&
    projectTruth.includes("progressClaim = safeVisualEvidence") &&
    projectTruth.includes("evidenceClass === 'observation'"),
  'Project brief must not render interpretation-tier or overclaiming text as confirmed observations.',
);
assert(
  app.includes('pieResultHasCompletedVisualComparison') &&
    app.includes("result.status === 'analysis_complete'") &&
    app.includes("result.status === 'completed_with_limitations'") &&
    app.includes('selectedPriorPhotoId'),
  'Project brief must only count completed comparisons against a prior photo as visual changes.',
);
assert(
  app.includes('pieResultIsBaselineOnly') &&
    app.includes('No visual changes compared yet.') &&
    app.includes('baseline photo') &&
    app.includes('saved for future comparisons'),
  'No-prior baseline updates must show a baseline summary instead of possible visual changes.',
);
assert(
  app.includes('isBaselineInfoFinding') &&
    app.includes('first visual baseline|baseline saved|no earlier photo|no prior photo|future comparison') &&
    app.includes('dedupePIEProjectBriefObservations'),
  'Baseline informational text must be excluded and repeated observations must be deduped.',
);
assert(
  app.includes('Information') &&
    app.includes('Baseline saved for future comparison.') &&
    app.includes("pieSummary.status === 'no_prior_photo'"),
  'Update detail no-prior state must show informational baseline copy, not an observed finding.',
);
assert(
  app.includes('Photo Analysis') &&
    app.includes('Observed findings') &&
    app.includes('Possible interpretations') &&
    app.includes('Retry Analysis'),
  'Update detail must show photo analysis, observed findings, interpretations, and retry analysis.',
);
assert(
  app.includes("resolveProjectForDetectedArea("),
  'Overview should support GPS-based project defaulting.',
);
assert(
  app.includes('authoritativeScheduleItems') &&
    app.includes('reconciliationWarnings: scheduleReconciliation.warnings') &&
    projectStatus.includes('ACTIONABLE_WARNING_TYPES') &&
    projectStatus.includes('highestSeverityWarning(actionableWarnings)'),
  'Overview must use authoritative schedule rows and surface actionable field reconciliation warnings.',
);
assert(
  app.includes("<Modal visible={visible} animationType=\"slide\" transparent"),
  'Project selector must be a bottom sheet, not a native dropdown.',
);

console.log('Phase 2 project screen tests passed.');
