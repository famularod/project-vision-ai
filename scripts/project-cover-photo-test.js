#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'services/ProjectCoverPhotoService.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const moduleValue = { exports: {} };
vm.runInNewContext(compiled.outputText, {
  module: moduleValue,
  exports: moduleValue.exports,
  require(request) {
    if (request === 'expo-file-system/legacy') {
      return { documentDirectory: 'file:///documents/' };
    }
    if (request === './SupabaseService') {
      return { createPhotoSignedUrl() {}, uploadPhoto() {} };
    }
    return require(request);
  },
  Date,
  Map,
}, { filename });

const {
  cloudProjectCoverData,
  mergeProjectRecords,
  normalizeProjectRecords,
  projectRecordFromCloud,
  resolveProjectDisplayPhotoUri,
} = moduleValue.exports;

const automatic = 'file:///automatic/latest.jpg';
assert.strictEqual(
  resolveProjectDisplayPhotoUri('automatic', null, automatic),
  automatic,
  'A project without a cover photo must retain automatic image selection.',
);

const selected = {
  localUri: 'file:///documents/project-cover-photos/project-alpha.jpg',
  remotePath: 'project-covers/project-alpha/cover.jpg',
  mimeType: 'image/jpeg',
  updatedAt: '2026-07-12T12:00:00.000Z',
};
assert.strictEqual(
  resolveProjectDisplayPhotoUri('manual', selected, automatic),
  selected.localUri,
  'A selected cover photo must override automatic selection.',
);
assert.strictEqual(
  resolveProjectDisplayPhotoUri('automatic', selected, automatic),
  automatic,
  'Automatic mode must preserve existing automatic project image selection.',
);
assert.strictEqual(
  resolveProjectDisplayPhotoUri('manual', { ...selected, localUri: null }, automatic),
  null,
  'Manual mode must not silently substitute an automatic image while its cover cache hydrates.',
);

const serialized = JSON.stringify([{
  name: 'Alpha',
  coverPhoto: selected,
  coverPhotoMode: 'manual',
}]);
const restarted = normalizeProjectRecords(JSON.parse(serialized));
assert.strictEqual(restarted[0].coverPhoto.localUri, selected.localUri,
  'Restart hydration must preserve the selected local cover photo.');
assert.strictEqual(restarted[0].coverPhotoMode, 'manual',
  'Restart hydration must preserve manual cover mode.');

const projectData = cloudProjectCoverData(selected, 'manual', { organizationId: 'org-1' });
assert.strictEqual(projectData.organizationId, 'org-1',
  'Cover sync must preserve existing project metadata.');
const cloudRecord = projectRecordFromCloud({ name: 'Alpha', data: projectData });
const merged = mergeProjectRecords([], restarted, [cloudRecord]);
assert.strictEqual(merged[0].coverPhoto.remotePath, selected.remotePath,
  'Cloud hydration must preserve the cover storage reference.');
assert.strictEqual(merged[0].coverPhoto.localUri, selected.localUri,
  'Cloud merging must retain a valid local cache reference.');
assert.strictEqual(merged[0].coverPhotoMode, 'manual',
  'Cloud sync must preserve manual cover mode.');

const removedAt = '2026-07-12T13:00:00.000Z';
const removedCloud = projectRecordFromCloud({
  name: 'Alpha',
  data: cloudProjectCoverData(null, 'automatic', { organizationId: 'org-1' }, removedAt),
});
const afterRemoval = mergeProjectRecords([], restarted, [removedCloud]);
assert.strictEqual(afterRemoval[0].coverPhoto, null,
  'A newer cloud removal must clear the selected cover photo.');
assert.strictEqual(afterRemoval[0].coverPhotoMode, 'automatic');
assert.strictEqual(resolveProjectDisplayPhotoUri(
  afterRemoval[0].coverPhotoMode,
  afterRemoval[0].coverPhoto,
  automatic,
), automatic,
  'Removing a cover photo must restore automatic image selection.');

const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'services/SyncService.ts'), 'utf8');
const projectService = fs.readFileSync(path.join(root, 'services/projectService.ts'), 'utf8');
for (const marker of [
  'Set Project Cover',
  'Take New Photo',
  'Choose From Library',
  'Use Best Project Photo',
  'Remove Cover Photo',
  'allowsEditing: true',
  'aspect: [16, 9]',
  'saveCloudProjectCoverPhoto',
  'hydrateProjectCoverPhotoCache',
  'launchCameraAsync',
  'launchImageLibraryAsync',
]) {
  assert(app.includes(marker), `Project cover flow is missing ${marker}.`);
}
const overviewStart = app.indexOf('function HomeScreen');
const overviewEnd = app.indexOf('function OverviewHeroCard');
const overviewSource = app.slice(overviewStart, overviewEnd);
assert(!overviewSource.includes('Set Project Cover') &&
  !overviewSource.includes('ProjectCoverEntryButton') &&
  !overviewSource.includes('onSetProjectCover'),
  'Overview project cards must not expose cover-photo actions.');
const workspaceStart = app.indexOf('function ProjectWorkspaceScreen');
const workspaceSource = app.slice(workspaceStart);
assert(workspaceSource.indexOf('>Set Project Cover<') >= 0 &&
  workspaceSource.indexOf('>Set Project Cover<') < workspaceSource.indexOf(">Today's Priority<"),
  'Project Workspace must show Set Project Cover near the top, before intelligence cards.');
for (const accessibilityLabel of [
  'Take New Photo for project cover',
  'Choose project cover from library',
  'Use Best Project Photo automatically',
  'Remove Cover Photo',
]) {
  assert(workspaceSource.includes(`accessibilityLabel="${accessibilityLabel}"`),
    `Project Workspace is missing accessible cover control: ${accessibilityLabel}.`);
}
assert(app.includes('resolveProjectDisplayPhotoUri('),
  'Project Workspace and Overview must share explicit manual/automatic display behavior.');
assert(app.includes("coverPhotoMode: 'manual'") && app.includes("coverPhotoMode: 'automatic'"),
  'Camera/library selection must choose manual mode and best-photo/removal must choose automatic mode.');
assert(projectService.includes('coverPhotoUpload: coverPhoto?.localUri && coverPhoto.remotePath'),
  'Cover selection must enqueue its cached image for cloud sync.');
assert(sync.includes("path: payload.coverPhotoUpload.remotePath") &&
  sync.includes("return upload.error || upload.message || 'Project cover upload is waiting for cloud sync.'"),
  'Failed cover uploads must remain queued instead of losing cloud persistence.');

console.log('DAVE Project Cover Photo behavioral tests passed.');
