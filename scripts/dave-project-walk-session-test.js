#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function createStorage(initial = {}, options = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) {
      if (options.failSetItem?.(key, value)) throw new Error('injected set failure');
      values.set(key, value);
    },
    async removeItem(key) { values.delete(key); },
  };
}

function loadTs(relativePath, externalModules = {}, cache = new Map()) {
  const filename = path.join(root, relativePath);
  if (cache.has(filename)) return cache.get(filename);
  const moduleValue = { exports: {} };
  cache.set(filename, moduleValue.exports);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const localRequire = request => {
    if (externalModules[request]) return externalModules[request];
    if (request.startsWith('.')) {
      return loadTs(path.relative(root, path.resolve(path.dirname(filename), `${request}.ts`)), externalModules, cache);
    }
    return require(request);
  };
  vm.runInNewContext(compiled.outputText, {
    module: moduleValue,
    exports: moduleValue.exports,
    require: localRequire,
    Object,
    Date,
    Set,
    Map,
    Number,
    JSON,
  }, { filename });
  cache.set(filename, moduleValue.exports);
  return moduleValue.exports;
}

async function run() {
  const storage = createStorage();
  const external = {
    '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
  };
  const sessionModule = loadTs('services/DAVEProjectWalkSession.ts', external);
  const repositoryModule = loadTs('services/DAVEProjectWalkSessionRepository.ts', external);
  const repository = repositoryModule.createDAVEProjectWalkSessionRepository(storage);
  const started = sessionModule.startDAVEProjectWalkSession({
    id: 'walk-alpha-1',
    projectId: 'project-alpha',
    projectName: 'Alpha',
    startedAt: '2026-07-13T15:00:00.000Z',
  });

  assert.strictEqual(started.status, 'active');
  assert.strictEqual(started.projectId, 'project-alpha');
  assert(Object.isFrozen(started) && Object.isFrozen(started.memoryIds));
  assert.throws(() => sessionModule.startDAVEProjectWalkSession({
    id: 'walk-name-only',
    projectName: 'Alpha',
    startedAt: '2026-07-13T15:00:00.000Z',
  }), /project id/i, 'A Project Walk must not persist name-only project authority.');
  assert.throws(() => sessionModule.startDAVEProjectWalkSession({
    id: 'walk-padded-id',
    projectId: ' project-alpha ',
    projectName: 'Alpha',
    startedAt: '2026-07-13T15:00:00.000Z',
  }), /project id/i, 'A Project Walk must reject a noncanonical supplied project ID.');
  await repository.start(started);
  await assert.rejects(
    () => repository.start(sessionModule.startDAVEProjectWalkSession({
      id: 'walk-beta-1', projectId: 'project-beta', projectName: 'Beta', startedAt: '2026-07-13T15:01:00.000Z',
    })),
    /already active for Alpha/,
  );

  const withFirst = await repository.addMemory(
    started.id, 'memory-1', '2026-07-13T15:02:00.000Z',
  );
  assert.deepStrictEqual([...withFirst.memoryIds], ['memory-1']);
  const idempotent = await repository.addMemory(
    started.id, 'memory-1', '2026-07-13T15:03:00.000Z',
  );
  assert.deepStrictEqual([...idempotent.memoryIds], ['memory-1']);

  const restartedRepository = repositoryModule.createDAVEProjectWalkSessionRepository(storage);
  const hydrated = await restartedRepository.readActive();
  assert(hydrated, 'The active walk must hydrate after an app/repository restart.');
  assert.strictEqual(hydrated.projectId, 'project-alpha');
  assert.strictEqual(hydrated.projectName, 'Alpha');
  assert.deepStrictEqual([...hydrated.memoryIds], ['memory-1']);

  const withSecond = await restartedRepository.addMemory(
    hydrated.id, 'memory-2', '2026-07-13T15:04:00.000Z',
  );
  const afterDelete = await restartedRepository.removeMemory(
    hydrated.id, 'memory-1', '2026-07-13T15:05:00.000Z',
  );
  assert.deepStrictEqual([...withSecond.memoryIds], ['memory-1', 'memory-2']);
  assert.deepStrictEqual([...afterDelete.memoryIds], ['memory-2']);

  const completed = await restartedRepository.complete(
    hydrated.id, '2026-07-13T15:06:00.000Z',
  );
  assert.strictEqual(completed.status, 'completed');
  assert.strictEqual(completed.completedAt, '2026-07-13T15:06:00.000Z');
  assert.strictEqual(await restartedRepository.readActive(), null);

  const empty = sessionModule.startDAVEProjectWalkSession({
    id: 'walk-empty', projectId: 'project-alpha', projectName: 'Alpha', startedAt: '2026-07-13T16:00:00.000Z',
  });
  await restartedRepository.start(empty);
  await assert.rejects(
    () => restartedRepository.complete(empty.id, '2026-07-13T16:01:00.000Z'),
    /at least one observation/,
  );
  const cancelled = await restartedRepository.cancel(empty.id, '2026-07-13T16:02:00.000Z');
  assert.strictEqual(cancelled.status, 'cancelled');
  assert.strictEqual(await restartedRepository.readActive(), null);

  const sessionRaw = JSON.stringify(started);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(repositoryModule.projectWalkSessionRemovalOperationForProject(
      sessionRaw,
      'project-alpha',
    ))),
    {
      kind: 'remove_if_unchanged',
      key: repositoryModule.DAVE_PROJECT_WALK_SESSION_STORAGE_KEY,
      expectedValue: sessionRaw,
    },
    'Project deletion must be able to remove the exact active session in its durable transaction.',
  );
  assert.strictEqual(
    repositoryModule.projectWalkSessionRemovalOperationForProject(sessionRaw, 'project-beta'),
    null,
    'Deleting a different same-name project must preserve the exact session.',
  );
  const cleanupStorage = createStorage();
  const cleanupRepository = repositoryModule.createDAVEProjectWalkSessionRepository(cleanupStorage);
  await cleanupRepository.start(started);
  assert.strictEqual(await cleanupRepository.deleteActiveForProject('project-beta'), false);
  assert.strictEqual((await cleanupRepository.readActive()).id, started.id);
  assert.strictEqual(await cleanupRepository.deleteActiveForProject('project-alpha'), true);
  assert.strictEqual(await cleanupRepository.readActive(), null);

  const concurrentStorage = createStorage();
  const concurrentRepositoryA = repositoryModule.createDAVEProjectWalkSessionRepository(
    concurrentStorage,
  );
  const concurrentRepositoryB = repositoryModule.createDAVEProjectWalkSessionRepository(
    concurrentStorage,
  );
  const concurrentResults = await Promise.allSettled([
    concurrentRepositoryA.start(sessionModule.startDAVEProjectWalkSession({
      id: 'walk-concurrent-a', projectId: 'project-alpha', projectName: 'Alpha', startedAt: '2026-07-13T17:00:00.000Z',
    })),
    concurrentRepositoryB.start(sessionModule.startDAVEProjectWalkSession({
      id: 'walk-concurrent-b', projectId: 'project-beta', projectName: 'Beta', startedAt: '2026-07-13T17:00:00.000Z',
    })),
  ]);
  assert.strictEqual(concurrentResults.filter(result => result.status === 'fulfilled').length, 1,
    'Concurrent starts must serialize so only one active Project Walk can win.');
  assert.strictEqual(concurrentResults.filter(result => result.status === 'rejected').length, 1);

  const validInactiveStorage = createStorage({
    [repositoryModule.DAVE_PROJECT_WALK_SESSION_STORAGE_KEY]: JSON.stringify(completed),
  });
  const validInactiveRepository = repositoryModule.createDAVEProjectWalkSessionRepository(
    validInactiveStorage,
  );
  assert.strictEqual(await validInactiveRepository.readActive(), null,
    'A valid completed session remains normal inactive data.');
  assert(![...validInactiveStorage.values.keys()].some(key =>
    key.startsWith(repositoryModule.DAVE_PROJECT_WALK_SESSION_QUARANTINE_KEY_PREFIX)),
  'Valid inactive sessions must not be quarantined.');

  const corruptRaw = '{bad-json';
  const corruptStorage = createStorage({
    [repositoryModule.DAVE_PROJECT_WALK_SESSION_STORAGE_KEY]: corruptRaw,
  });
  const corruptRepository = repositoryModule.createDAVEProjectWalkSessionRepository(corruptStorage);
  await assert.rejects(() => corruptRepository.readActive(), /corrupt.*quarantin/i,
    'Corrupt Project Walk hydration must surface an error to App.');
  assert.strictEqual(
    corruptStorage.values.has(repositoryModule.DAVE_PROJECT_WALK_SESSION_STORAGE_KEY),
    false,
    'Corrupted active session storage must be removed safely.',
  );
  const corruptQuarantine = [...corruptStorage.values.entries()].find(([key]) =>
    key.startsWith(repositoryModule.DAVE_PROJECT_WALK_SESSION_QUARANTINE_KEY_PREFIX));
  assert(corruptQuarantine);
  assert.strictEqual(corruptQuarantine[1], corruptRaw,
    'Project Walk quarantine must preserve exact raw bytes.');
  assert.strictEqual(await corruptRepository.readActive(), null,
    'A retry may safely continue after quarantine removes the corrupt active value.');

  const quarantineFailureStorage = createStorage({
    [repositoryModule.DAVE_PROJECT_WALK_SESSION_STORAGE_KEY]: corruptRaw,
  }, {
    failSetItem: key => key.startsWith(
      repositoryModule.DAVE_PROJECT_WALK_SESSION_QUARANTINE_KEY_PREFIX,
    ),
  });
  const blockedRepository = repositoryModule.createDAVEProjectWalkSessionRepository(
    quarantineFailureStorage,
  );
  await assert.rejects(() => blockedRepository.readActive(), /could not be quarantined/i);
  assert.strictEqual(
    quarantineFailureStorage.values.get(repositoryModule.DAVE_PROJECT_WALK_SESSION_STORAGE_KEY),
    corruptRaw,
    'A failed walk quarantine must not overwrite or remove active bytes.',
  );

  const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  [
    'Project Walk in progress',
    'Start Project Walk',
    'Add Observation',
    'Finish Walk',
    'End Walk',
    'Observation saved',
  ].forEach(marker => assert(app.includes(marker), `Project Walk UI must include ${marker}.`));
  assert(app.includes('localDAVEProjectWalkSessionRepository.readActive()'),
    'App must hydrate the active Project Walk after restart.');
  assert(app.includes('localDAVEProjectWalkSessionRepository.addMemory(') &&
    app.includes('.complete(session.id, new Date().toISOString())') &&
    app.includes('.cancel(sessionId, new Date().toISOString())'),
  'App must persist the observation, finish, and cancel lifecycle.');
  assert(app.includes('walkSession.projectId !== memory.projectId') &&
    app.includes('memory.projectId === session.projectId'),
  'App must bind every saved and finished Project Walk memory to the session project ID.');
  assert(app.includes("setScreen('BuildUpdate')") && app.includes('sourceWalkSessionId,'),
    'Finish Walk must route through the existing Update Preview and preserve session traceability.');
  assert(app.includes('legacyUnusedWalkMemories') && app.includes('!projectWalkMemoryIds.has(memory.id)'),
    'Active-session observations must not also appear in the legacy prepare button.');
  assert(app.includes('projectWalkSessionRemovalOperationForProject(') &&
    app.includes('removedProjectWalkSession') &&
    app.includes('projectWalkSession: DAVE_PROJECT_WALK_SESSION_STORAGE_KEY'),
  'Exact-project deletion and backup restore must include the active walk-session key atomically.');
  assert(app.includes('projectId: session.projectId,\n        projectName: null,') &&
    app.includes('currentProject.name,\n        sessionMemories,'),
  'Finish Walk must resolve the current project name from the immutable session project ID.');
  assert(app.includes('projectId: existing.projectId,\n        projectName: null,') &&
    app.includes('openProjectWorkspace(existingProject.name)'),
  'Resume Walk must use the current exact project record instead of a stale stored display name.');

  console.log('PASS DAVE Project Walk session lifecycle and persistence checks');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
