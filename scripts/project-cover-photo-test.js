#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'services/ProjectCoverPhotoService.ts');
const authorityFilename = path.join(root, 'services/ProjectCoverCommitAuthority.ts');
const authoritySource = fs.readFileSync(authorityFilename, 'utf8');
const authorityCompiled = ts.transpileModule(authoritySource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const authorityModuleValue = { exports: {} };
vm.runInNewContext(authorityCompiled.outputText, {
  module: authorityModuleValue,
  exports: authorityModuleValue.exports,
  require(request) {
    if (request === './SupabaseService') return {};
    return require(request);
  },
  JSON,
}, { filename: authorityFilename });
const source = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, {
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
    if (request === 'expo-crypto') {
      return { randomUUID: () => '33333333-3333-4333-8333-333333333333' };
    }
    if (request === './ProjectCoverCommitAuthority') {
      return authorityModuleValue.exports;
    }
    if (request === './FileSizePreflight') {
      return {
        hashExpoFileSha256: async () => ({
          sha256: 'a'.repeat(64),
          sizeBytes: 1234,
        }),
      };
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
  coverPhotoForProject,
  exactProjectUpdatesForCover,
  exactProjectRecordForCoverName,
  mergeProjectRecords,
  normalizeProjectRecords,
  projectRecordFromCloud,
  resolveProjectCoverPhotoUri,
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
const exactSelected = {
  ...selected,
  remotePath: 'project-covers/11111111-1111-4111-8111-111111111111/cover.jpg',
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
assert.strictEqual(
  resolveProjectCoverPhotoUri([{
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Alpha',
    coverPhoto: exactSelected,
    coverPhotoMode: 'manual',
  }], '11111111-1111-4111-8111-111111111111', automatic),
  exactSelected.localUri,
  'Every project surface must resolve the same manual cover using canonical project context.',
);
assert.strictEqual(
  resolveProjectCoverPhotoUri([{
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Alpha',
    coverPhoto: selected,
    coverPhotoMode: 'automatic',
  }], '11111111-1111-4111-8111-111111111111', automatic),
  automatic,
  'A unique exact project must retain its legitimate automatic photo flow.',
);
assert.strictEqual(
  coverPhotoForProject([{
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Alpha',
    coverPhoto: { ...selected, remotePath: 'project-covers/project-beta/cover.jpg' },
    coverPhotoMode: 'manual',
  }], '11111111-1111-4111-8111-111111111111'),
  null,
  'A foreign name-derived storage object must not become a unique project cover fallback.',
);
assert.strictEqual(
  coverPhotoForProject([{
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Alpha',
    coverPhoto: {
      ...selected,
      remotePath: 'project-covers/project-alpha/cover.jpg',
    },
    coverPhotoMode: 'manual',
  }], '11111111-1111-4111-8111-111111111111'),
  null,
  'Even a currently unique display name must not authorize a legacy name-derived cover path.',
);
assert.strictEqual(
  coverPhotoForProject([{
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Alpha',
    coverPhoto: {
      ...selected,
      remotePath: 'project-covers/11111111-1111-4111-8111-111111111111/cover.jpg',
    },
    coverPhotoMode: 'manual',
    coverPhotoUpdatedAt: '2026-07-12T12:01:00.000Z',
  }], '11111111-1111-4111-8111-111111111111'),
  null,
  'A manual cover must not cross a mismatched cover revision receipt.',
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
assert(
  source.includes('function coverPhotoCacheRevision') &&
    source.includes('coverPhotoCacheUri(exactId, coverPhoto, extension)'),
  'Cover photo cache keys must include the selected remote revision.',
);
assert(
  source.includes('incomingCover.remotePath === localCover?.remotePath') &&
    source.includes('incomingCover.updatedAt === localCover?.updatedAt'),
  'A newer remote cover revision must not inherit a stale local cache URI.',
);

const projectData = cloudProjectCoverData(selected, 'manual', { organizationId: 'org-1' });
assert.strictEqual(projectData.organizationId, 'org-1',
  'Cover sync must preserve existing project metadata.');
const alphaProjectId = '11111111-1111-4111-8111-111111111111';
const cloudRecord = projectRecordFromCloud({
  id: alphaProjectId,
  name: 'Alpha',
  data: projectData,
});
const merged = mergeProjectRecords([], restarted, [cloudRecord]);
assert.strictEqual(merged[0].id, alphaProjectId,
  'Cloud hydration must preserve the immutable project ID.');
assert.strictEqual(merged[0].coverPhoto.remotePath, selected.remotePath,
  'Cloud hydration must preserve the cover storage reference.');
assert.strictEqual(merged[0].coverPhoto.localUri, null,
  'A name-only local cache must not be donated to an exact cloud project by display name.');
assert.strictEqual(merged[0].coverPhotoMode, 'manual',
  'Cloud sync must preserve manual cover mode.');

const sameNameProjects = mergeProjectRecords([], [], [
  projectRecordFromCloud({
    id: alphaProjectId,
    name: 'Same Display Name',
    data: cloudProjectCoverData({
      ...selected,
      localUri: 'file:///project-a.jpg',
      remotePath: `project-covers/${alphaProjectId}/cover.jpg`,
    }, 'manual', null),
  }),
  projectRecordFromCloud({
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Same Display Name',
    data: cloudProjectCoverData({
      ...selected,
      localUri: 'file:///project-b.jpg',
      remotePath: 'project-covers/22222222-2222-4222-8222-222222222222/cover.jpg',
    }, 'manual', null),
  }),
]);
assert.strictEqual(sameNameProjects.length, 2,
  'Different immutable project IDs must remain distinct even when their display names match.');
assert.strictEqual(sameNameProjects[0].id, alphaProjectId,
  'Same-name project normalization must preserve the first immutable project identity.');
assert.strictEqual(sameNameProjects[1].id, '22222222-2222-4222-8222-222222222222',
  'Same-name project normalization must preserve the second immutable project identity.');
assert.strictEqual(
  coverPhotoForProject(sameNameProjects.slice().reverse(), alphaProjectId).remotePath,
  `project-covers/${alphaProjectId}/cover.jpg`,
  'Cover reads must resolve the requested immutable project ID, independent of array order.',
);
const hydratedSameNameProjects = sameNameProjects.map(project => ({
  ...project,
  coverPhoto: project.coverPhoto ? {
    ...project.coverPhoto,
    localUri: project.id === alphaProjectId
      ? 'file:///project-a.jpg'
      : 'file:///project-b.jpg',
  } : null,
}));
assert.strictEqual(
  resolveProjectCoverPhotoUri(
    hydratedSameNameProjects,
    '22222222-2222-4222-8222-222222222222',
    automatic,
  ),
  'file:///project-b.jpg',
  'Same-name project B must retain its own exact cover authority.',
);
assert.strictEqual(
  resolveProjectCoverPhotoUri(sameNameProjects, null, automatic),
  null,
  'A missing immutable project ID must fail closed without cross-project photo fallback.',
);
assert.deepStrictEqual(
  Array.from(exactProjectUpdatesForCover([
    { id: 'update-a', projectId: alphaProjectId },
    { id: 'update-b', projectId: '22222222-2222-4222-8222-222222222222' },
    { id: 'legacy-update', projectId: null },
  ], '22222222-2222-4222-8222-222222222222'), update => update.id),
  ['update-b'],
  'Automatic cover selection must receive only updates bound to the requested exact project.',
);
assert.strictEqual(
  exactProjectRecordForCoverName(sameNameProjects, 'Same Display Name'),
  null,
  'A name-only UI selection must fail closed when two immutable projects share the display name.',
);
const legacySharedCoverProjects = sameNameProjects.map(project => ({
  ...project,
  coverPhoto: {
    ...selected,
    remotePath: 'project-covers/project-same-display-name/cover.jpg',
  },
}));
assert.strictEqual(
  coverPhotoForProject(legacySharedCoverProjects, alphaProjectId),
  null,
  'A legacy name-derived cover object must be quarantined once the display name is authority-ambiguous.',
);
const collidingLegacySlugProjects = [
  {
    id: alphaProjectId,
    name: 'A B',
    coverPhoto: {
      ...selected,
      remotePath: 'project-covers/project-a-b/cover.jpg',
    },
    coverPhotoMode: 'manual',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'A-B',
    coverPhoto: {
      ...selected,
      remotePath: 'project-covers/project-a-b/cover.jpg',
    },
    coverPhotoMode: 'manual',
  },
];
assert.strictEqual(coverPhotoForProject(collidingLegacySlugProjects, alphaProjectId), null,
  'Legacy cover authority must fail closed when distinct display names derive the same storage slug.');
assert.strictEqual(
  coverPhotoForProject(collidingLegacySlugProjects, '22222222-2222-4222-8222-222222222222'),
  null,
  'No exact project may claim a legacy storage slug shared by another exact project name.',
);
const canonicalLegacyCollisionProjects = [
  {
    id: 'project-alpha',
    name: 'Other',
    coverPhoto: {
      ...selected,
      remotePath: 'project-covers/project-alpha/cover.jpg',
    },
    coverPhotoMode: 'manual',
  },
  {
    id: alphaProjectId,
    name: 'Alpha',
    coverPhoto: {
      ...selected,
      remotePath: 'project-covers/project-alpha/cover.jpg',
    },
    coverPhotoMode: 'manual',
  },
];
assert.strictEqual(
  coverPhotoForProject(canonicalLegacyCollisionProjects, 'project-alpha'),
  null,
  'A retired name-derived project identifier must not become immutable cover authority.',
);
assert.strictEqual(
  coverPhotoForProject(canonicalLegacyCollisionProjects, alphaProjectId),
  null,
  'A legacy cover path must not collide with another project canonical ID.',
);

const ambiguousLegacy = normalizeProjectRecords([
  { id: alphaProjectId, name: 'Same Display Name' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Same Display Name' },
  { name: 'Same Display Name', data: { legacyOnly: true } },
]);
assert.strictEqual(ambiguousLegacy.length, 2,
  'An ambiguous name-only record must not be merged into either same-name project.');
assert(ambiguousLegacy.every(project => project.id),
  'No ambiguous legacy identity may survive beside duplicate immutable project records.');

const archivedSiblingRebind = mergeProjectRecords([], [{
  name: 'Archived Shared Name',
  coverPhoto: {
    ...selected,
    localUri: 'file:///archived-project-a.jpg',
    remotePath: 'project-covers/project-archived-shared-name/cover.jpg',
  },
  coverPhotoMode: 'manual',
}], [{
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Archived Shared Name',
  coverPhoto: null,
  coverPhotoMode: 'automatic',
}]);
assert.strictEqual(archivedSiblingRebind.length, 1,
  'A stale name-only cover record must be quarantined when one exact same-name project remains.');
assert.strictEqual(archivedSiblingRebind[0].id, '22222222-2222-4222-8222-222222222222');
assert.strictEqual(archivedSiblingRebind[0].coverPhoto, null,
  'Archiving a same-name sibling must never promote its stale cover into the remaining project.');

const deletedMerge = mergeProjectRecords(
  ['Starter Project'],
  [{ name: 'Local Deleted Project' }],
  [{ name: 'Cloud Deleted Project' }],
  ['Starter Project', 'Local Deleted Project', 'Cloud Deleted Project'],
);
assert.deepStrictEqual(
  Array.from(deletedMerge),
  [],
  'Deleted-project tombstones must block starter, local, and stale cloud records from reappearing.',
);

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
const coverSync = fs.readFileSync(path.join(root, 'services/ProjectCoverSync.ts'), 'utf8');
const projectService = fs.readFileSync(path.join(root, 'services/projectService.ts'), 'utf8');
const projectActionSheet = fs.readFileSync(
  path.join(root, 'components/project-action-sheet.tsx'),
  'utf8',
);
for (const marker of [
  'title="Project Options"',
  '<Text style={styles.sectionLabel}>Cover Photo</Text>',
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
const overviewEnd = app.indexOf('function Phase2ActivityRow');
assert(overviewStart >= 0 && overviewEnd > overviewStart,
  'The reachable Overview source boundary must remain discoverable.');
const overviewSource = app.slice(overviewStart, overviewEnd);
assert(!overviewSource.includes('Set Project Cover') &&
  !overviewSource.includes('ProjectCoverEntryButton') &&
  !overviewSource.includes('onSetProjectCover'),
  'Overview project cards must not expose cover-photo actions.');
const workspaceStart = app.indexOf('function ProjectWorkspaceScreen');
const workspaceSource = app.slice(workspaceStart);
assert(
  workspaceSource.includes('title="Project Options"') &&
    workspaceSource.includes('<Text style={styles.sectionLabel}>Cover Photo</Text>'),
  'Project Workspace must keep cover-photo controls in Project Options.',
);
assert(
  projectActionSheet.includes('export function MoreOptionRow') &&
    projectActionSheet.includes('accessibilityRole="button"') &&
    projectActionSheet.includes('accessibilityLabel={label}'),
  'Project option rows must expose accessible button labels.',
);
assert(
  projectActionSheet.includes('accessibilityLabel={`Close ${title}`}'),
  'Project Options must expose an accessible close control tied to the sheet title.',
);
assert((app.match(/resolveProjectCoverPhotoUri\(/g) || []).length >= 2,
  'Overview and Project Workspace must use the canonical project cover resolver.');
assert(app.includes('projectRecords={projectRecords}'),
  'Projects must receive project cover records instead of selecting an independent thumbnail.');
assert(app.includes('coverPhotoUri={resolveProjectCoverPhotoUri('),
  'Project Workspace must receive the canonical resolved project cover URI.');
assert(app.includes("coverPhotoMode: 'manual'") && app.includes("coverPhotoMode: 'automatic'"),
  'Camera/library selection must choose manual mode and best-photo/removal must choose automatic mode.');
assert(projectService.includes("coverPhotoUpload: coverPhotoMode === 'manual' && coverPhoto?.localUri && coverPhoto.remotePath"),
  'Cover selection must enqueue its cached image for cloud sync.');
assert(projectService.includes('coverPhotoCommit: mutation'),
  'Cover selection must enqueue its exact predecessor and target authority receipt.');
assert(projectService.includes('id: exactProjectId'),
  'Cover cloud mutations must carry the selected immutable project ID.');
assert(sync.includes('uploadAndCommitProjectCoverMutation({') &&
  sync.includes('commitProjectCoverPhoto({') &&
  coverSync.includes('An RPC transport failure is ambiguous') &&
  coverSync.includes("return { outcome: 'retry'"),
  'Indeterminate cover commits must retain their immutable upload for an idempotent retry.');
assert(
  authoritySource.includes('project-covers/${projectId}/revisions/${attemptId}') &&
    source.includes('Crypto.randomUUID()'),
  'Every manual cover write must use a unique immutable revision object path.',
);
assert(sync.includes('Cover photo updates require one exact project ID and storage path.'),
  'The offline queue must reject name-only cover authority before persistence.');
assert(!app.slice(app.indexOf('async function persistSelectedProjectCoverPhoto'), app.indexOf('function resumeDraft'))
  .includes("project.name.toLowerCase() === projectName.toLowerCase()"),
  'Cover handlers must not select or mutate projects by display name.');
assert(/exactProjectUpdatesForCover\(\s*activeSavedUpdates,\s*selectedWorkspaceCoverProject\?\.id,?\s*\)/.test(app) &&
  app.includes('exactProjectUpdatesForCover(savedUpdates, coverProject?.id)'),
  'Workspace and overview automatic covers must receive only exact-project update photos.');
assert(app.includes('projectId: persistedExactProjectId(value.projectId)'),
  'Mobile schedule normalization must preserve the exact project ID.');
assert(app.includes('setDraft({ ...createDraft(project.name), projectId })'),
  'A new mobile field update must start with the selected exact project ID.');
assert(app.includes('projectId: onlyProject?.id || null') &&
  app.includes('projectId: importedProject?.id || null'),
  'Mobile schedule reference documents must persist selected exact project IDs.');
assert(!app.includes('projectId: importedProjectName ? authorityProjectId(importedProjectName) : null'),
  'Schedule approval must not manufacture reference-document authority from a display name.');
assert(app.includes("throw new Error('Choose one project with a confirmed project ID before adding a document.')"),
  'Mobile project-document creation must fail closed without one exact project record.');

console.log('DAVE Project Cover Photo behavioral tests passed.');
