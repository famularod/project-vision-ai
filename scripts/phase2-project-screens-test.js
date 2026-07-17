#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const projectTruth = fs.readFileSync(path.join(root, 'services/DAVEProjectTruth.ts'), 'utf8');

[
  'function HomeScreen({',
  'ProjectSelectorSheet',
  'Needs Attention',
  'Project Health',
  "Today's Priority",
  'All clear',
  "project{scopedProjects.length === 1 ? '' : 's'} reviewed",
  'Nothing due today',
  "topPriority ? 'PRIORITY' : 'ALL CLEAR'",
  'Active Projects',
  'Recent Activity',
  'View all activity',
  'Active Projects',
  'Healthy',
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
  'const pmBriefing = projectTruth.briefing',
  'pmBriefing.evidenceCoverage',
  'buildPIEScheduleReconciliation({',
  'onOpenPhotoDifferences',
  'onNewFieldUpdate(projectName)',
].forEach(marker => {
  assert(app.includes(marker), `Phase 2 screen should include ${marker}`);
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
  app.includes('Archived Projects') && app.includes('onReopenProject(projectName)'),
  'Overview must preserve archived-project recovery after removing the duplicate Projects route.',
);
assert(
  projectTruth.includes("evidenceClass: safeVisualEvidence ? 'observation'") &&
    projectTruth.includes('changeFromPrior: hasComparablePrior') &&
    app.includes('pmBriefing.whatChanged.length'),
  'Project brief with findings must show top observed finding text, not only a count.',
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
  app.includes('openLatestProjectPhotoDifference') &&
    app.includes("setScreen('UpdateDetail')") &&
    app.includes('setSelectedDetailUpdate(targetUpdate)'),
  'View photo differences action must open an existing update detail path.',
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
    app.includes("warning.type !== 'schedule_mapping_incomplete'"),
  'Overview must use authoritative schedule rows and surface actionable field reconciliation warnings.',
);
assert(
  app.includes("<Modal visible={visible} animationType=\"slide\" transparent"),
  'Project selector must be a bottom sheet, not a native dropdown.',
);

console.log('Phase 2 project screen tests passed.');
