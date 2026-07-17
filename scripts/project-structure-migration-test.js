#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');

const mappings = [
  ['2321 North Side Lot', '2321 Compliance Project'],
  ['3 Hour Fire wall', '2321 Compliance Project'],
  ['Building 2321  East Driveway', '2321 Compliance Project'],
  ['Building 2375 Compliance', '2375 Compliance Project'],
  ['Canopy A', '2375 Compliance Project'],
  ['Canopy B', '2375 Compliance Project'],
  ['Canopy C', '2375 Compliance Project'],
];

for (const [legacyName, parentProject] of mappings) {
  assert(app.includes(`legacyName: '${legacyName}', parentProject: '${parentProject}'`),
    `${legacyName} must migrate to ${parentProject}.`);
}

const defaults = app.slice(
  app.indexOf('const DEFAULT_PROJECTS = ['),
  app.indexOf('];', app.indexOf('const DEFAULT_PROJECTS = [')) + 2,
);
assert(defaults.includes("'2321 Compliance Project'") && defaults.includes("'2375 Compliance Project'"),
  'Only the two parent projects should be seeded.');
assert(!defaults.includes('Canopy') && !defaults.includes('Driveway'),
  'Work areas must not be seeded as projects.');

assert(
  app.includes("normalizeStoredUpdateRecord,\n        'saved updates'") &&
    app.includes("normalizeStoredUpdateRecord,\n        'cloud saved updates'") &&
    app.includes('return migrateLegacyProjectUpdate(normalizeUpdate('),
  'Both local and cloud field updates must be assigned to their parent project during hydration.');
assert(app.includes('normalizeScheduleItems(result.value).map(migrateLegacyScheduleItem)'),
  'Schedule tasks must be assigned to their parent project.');
assert(app.includes('normalizeProjectDocuments(result.value).map(migrateLegacyProjectDocument)'),
  'Project documents must follow the parent project.');
assert(app.includes('LEGACY_WORK_CONTAINER_MIGRATIONS.map(item => item.legacyName)'),
  'Obsolete containers must be tombstoned so cloud hydration cannot recreate them.');

const cloudMigration = app.slice(
  app.indexOf("const completed = await AsyncStorage.getItem("),
  app.indexOf(
    "return () => {\n    active = false;",
    app.indexOf("const completed = await AsyncStorage.getItem("),
  ),
);
assert(cloudMigration.indexOf('await synchronizeLocalData({') < cloudMigration.indexOf('await deleteCloudProject('),
  'Parent project data must sync before obsolete cloud containers are deleted.');
assert(cloudMigration.includes("tokenResult.data?.status !== 'token_present'"),
  'Cloud migration must wait for a real authenticated session.');
assert(cloudMigration.includes('remainingLegacyProjects?.length === 0'),
  'A previously completed cloud cleanup must be marked complete without repeating the full migration.');
assert(cloudMigration.includes('projectStructureErrors.length > 0') &&
  cloudMigration.includes('syncResult.queued > 0') &&
  cloudMigration.includes('syncResult.conflicts > 0'),
  'Cloud deletion must stop for parent-project, schedule, queue, or conflict failures.');

console.log('Project structure migration checks passed.');
