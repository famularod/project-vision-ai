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
  'New Field Update',
  'Recent project activity will show up here.',
  'Attention Needed',
  'Waiting',
  'On Track',
  'buildPIEBriefText(projectName, savedUpdates)',
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
  app.includes("resolveProjectForDetectedArea("),
  'Overview should support GPS-based project defaulting.',
);
assert(
  app.includes("<Modal visible={visible} animationType=\"slide\" transparent"),
  'Project selector must be a bottom sheet, not a native dropdown.',
);

console.log('Phase 2 project screen tests passed.');
