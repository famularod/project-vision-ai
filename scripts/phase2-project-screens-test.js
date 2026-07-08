#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');

[
  'title="Overview"',
  'ProjectSelectorSheet',
  'All projects on track — nothing needs your attention.',
  'Needs Attention',
  'Your recent updates will show up here.',
  'title="Projects"',
  'Open Projects',
  'ProjectWorkspace',
  'PIE Project Brief',
  'Latest observations',
  'View photo differences',
  'New Field Update',
  'Recent project activity will show up here.',
  'Attention Needed',
  'Waiting',
  'On Track',
  'buildPIEProjectBriefModel(projectName, savedUpdates)',
  'onOpenPhotoDifferences',
  'onNewFieldUpdate(projectName)',
].forEach(marker => {
  assert(app.includes(marker), `Phase 2 screen should include ${marker}`);
});

[
  'Executive Summary',
  'Quick Actions',
  'Dashboard TEST',
].forEach(marker => {
  assert(!app.includes(marker), `Phase 2 Overview should hide ${marker}`);
});

assert(
  app.includes("onSelect={openProjectWorkspace}"),
  'Project cards should open Project Workspace.',
);
assert(
  app.includes("onNewUpdate={createNewUpdate}"),
  'Overview New Update should use the existing capture entry point.',
);
assert(
  app.includes('observedFindingsForUpdateBrief') &&
    app.includes('Observed: {observation.context} — {observation.text}') &&
    app.includes('observations: dedupedObservations.slice(0, 3)'),
  'Project brief with findings must show top observed finding text, not only a count.',
);
assert(
  app.includes('isSafeObservedBriefFinding') &&
    app.includes('work completed|progress increased|finished|quality issue|schedule.*risk|at risk|completed') &&
    app.includes('Possible visual changes found. Review details before using in an update.'),
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
  app.includes('PIE Summary') &&
    app.includes('Observed findings') &&
    app.includes('Possible interpretations') &&
    app.includes('Retry Analysis'),
  'Update detail must show PIE summary, observed findings, interpretations, and retry analysis.',
);
assert(
  app.includes("resolveProjectForDetectedArea("),
  'Overview should support GPS-based project defaulting.',
);
assert(
  app.includes("<Modal visible={visible} animationType=\"slide\" transparent"),
  'Project selector must be a bottom sheet, not a native dropdown.',
);

console.log('Phase 2 project screen tests passed.');
