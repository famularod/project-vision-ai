#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');

function sliceBetween(start, end) {
  const startIndex = app.indexOf(start);
  const endIndex = app.indexOf(end, startIndex);
  assert(startIndex >= 0 && endIndex > startIndex, `Expected ${start} before ${end}.`);
  return app.slice(startIndex, endIndex);
}

const normalization = sliceBetween(
  'function normalizeProjectAreas',
  'function resolveReferenceDocumentUri',
);
assert(normalization.includes('if (!Array.isArray(value)) return DEFAULT_PROJECT_AREAS'),
  'Defaults should remain the first-run and corrupt-storage fallback.');
assert(normalization.includes('return value.map(item => normalizeProjectArea'),
  'A valid stored area list must remain authoritative.');
assert(!normalization.includes('...DEFAULT_PROJECT_AREAS') && !normalization.includes('mergeProjectAreas'),
  'Startup must not recreate deleted default areas.');

const deletion = sliceBetween('function deleteProjectArea', 'async function useCurrentLocationForArea');
assert(deletion.includes('prev.filter(item => item.id !== areaId)'),
  'Area deletion must remove the selected record.');
assert(deletion.includes("recordDAVESyncTombstone('project_area', areaId)")
  && deletion.includes("removeOperationalRecordFromSyncQueue('project_area', areaId)"),
  'Area deletion must persist a tombstone and remove stale queued writes.');

const taskAreaEditing = sliceBetween('function ScheduleItemRow', 'function scheduleWarningIsUserActionable');
assert(taskAreaEditing.includes('<AreaRow') && taskAreaEditing.includes('projectAreas={projectAreas}'),
  'Expanded task cards must provide the shared Area selector.');
assert(taskAreaEditing.includes("onUpdate({ locationName: area?.name || '' })"),
  'Choosing an Area must save the task location through the normal task update path.');

console.log('Project area deletion persistence checks passed.');
