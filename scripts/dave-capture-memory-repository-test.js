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
    module: moduleValue, exports: moduleValue.exports, require: localRequire,
    Object, Date, Set, Map, WeakMap, Math, JSON, Promise, encodeURIComponent,
  }, { filename });
  cache.set(filename, moduleValue.exports);
  return moduleValue.exports;
}

async function run() {
  const storage = createStorage();
  const external = {
    '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
  };
  const memory = loadTs('services/DAVECaptureMemory.ts', external);
  const repositoryModule = loadTs('services/DAVECaptureMemoryRepository.ts', external);
  const commitmentsModule = loadTs('services/DAVEProjectCommitments.ts', external);
  const timelineModule = loadTs('services/DAVEProjectTimeline.ts', external);

  const draft = memory.createCaptureMemory({
    id: 'memory-stable-1',
    transcript: 'ABC Electric agreed to finish conduit by Friday in the east electrical room.',
    transcriptSourceRecordId: 'transcript-1',
    createdAt: '2026-07-12T08:00:00.000Z',
    recommendedProject: { value: 'Wrong project', confidence: 'low' },
    recommendedLocation: { value: 'West room', confidence: 'low' },
    fields: {
      peopleOrCompany: 'ABC Electric',
      commitment: 'Finish conduit.',
      dueDate: '2026-07-11',
    },
  });
  const projectCorrected = memory.correctCaptureMemory(
    draft, 'project', 'project-alpha', '2026-07-12T08:01:00.000Z',
  );
  const locationCorrected = memory.correctCaptureMemory(
    projectCorrected, 'location', 'East electrical room', '2026-07-12T08:02:00.000Z',
  );
  const confirmed = memory.confirmCaptureMemory(locationCorrected, '2026-07-12T08:03:00.000Z');
  const saveable = memory.confirmedCaptureMemoryForSave(confirmed);
  assert(saveable, 'Confirmation must produce the only repository-eligible value.');

  const repository = repositoryModule.createDAVECaptureMemoryRepository(storage);
  const saved = await repository.save(saveable);
  assert.strictEqual(saved.id, 'memory-stable-1');
  assert.strictEqual((await repository.list()).length, 1, 'Confirmed memory must save locally.');

  const restartedRepository = repositoryModule.createDAVECaptureMemoryRepository(storage);
  const hydrated = await restartedRepository.read('memory-stable-1');
  assert(hydrated, 'A new repository instance must hydrate saved memory after restart.');
  assert.strictEqual(hydrated.recommendedProject.value, 'project-alpha');
  assert.strictEqual(hydrated.recommendedLocation.value, 'East electrical room');
  assert(hydrated.corrections.some(item => item.field === 'project' && item.previousValue === 'Wrong project'));
  assert(hydrated.corrections.some(item => item.field === 'location' && item.previousValue === 'West room'));
  assert.strictEqual(hydrated.transcript, draft.transcript);
  assert(hydrated.evidence.some(item => item.kind === 'transcript' && item.id === hydrated.transcriptEvidenceId));

  await restartedRepository.save(saveable);
  assert.strictEqual((await restartedRepository.list()).length, 1, 'Repeated save must be idempotent by stable ID.');
  await assert.rejects(
    () => restartedRepository.save({ ...saveable, transcript: 'Different source with the same ID.' }),
    /already exists/,
    'A conflicting duplicate ID must not overwrite evidence.',
  );

  await assert.rejects(() => restartedRepository.save(draft), /confirmed/i,
    'Unconfirmed drafts must be rejected at runtime as well as by TypeScript.');
  const cancelled = memory.cancelCaptureMemory(
    memory.createCaptureMemory({
      id: 'cancelled', transcript: 'Do not save this.', transcriptSourceRecordId: 't-cancelled',
      createdAt: '2026-07-12T09:00:00.000Z',
    }),
    '2026-07-12T09:01:00.000Z',
  );
  await assert.rejects(() => restartedRepository.save(cancelled), /confirmed/i,
    'Cancelled captures must never enter storage.');
  assert.strictEqual((await restartedRepository.list()).length, 1);

  const updated = {
    ...saveable,
    fields: { ...saveable.fields, followUp: 'Confirm the current conduit status with ABC Electric.' },
  };
  await restartedRepository.update(updated);
  assert.strictEqual((await restartedRepository.read(saveable.id)).fields.followUp,
    'Confirm the current conduit status with ABC Electric.');
  await assert.rejects(
    () => restartedRepository.update({ ...updated, corrections: [] }),
    /preserve PM corrections/,
    'Updates must not erase the PM correction history.',
  );

  const commitments = commitmentsModule.buildProjectCommitments({
    projectId: 'project-alpha', projectName: 'Alpha', updates: [], documents: [],
    captureMemories: await restartedRepository.list('project-alpha'), now: '2026-07-13T12:00:00.000Z',
  });
  assert.strictEqual(commitments.length, 1, 'A confirmed spoken commitment must project into Commitments.');
  assert.strictEqual(commitments[0].status, 'Overdue');
  assert.strictEqual(commitments[0].sourceMemoryId, saveable.id);
  assert(commitments[0].linkedEvidence.some(item => item.type === 'transcript'));

  const timeline = timelineModule.buildProjectTimeline({
    projectId: 'project-alpha', projectName: 'Alpha', updates: [], documents: [], scheduleItems: [],
    commitments, captureMemories: await restartedRepository.list('project-alpha'),
    reality: { state: 'At Risk', confidence: 'medium', lastVerifiedAt: null, topRecommendation: null },
    now: '2026-07-13T12:00:00.000Z',
  });
  const memoryEvent = timeline.find(item => item.eventType === 'memory_confirmed');
  assert(memoryEvent, 'A confirmed memory must project into Timeline.');
  assert(memoryEvent.evidence.some(item => item.sourceType === 'transcript'));
  assert.strictEqual(memoryEvent.navigationTarget, 'project_workspace');
  assert(timeline.some(item => item.eventType === 'commitment_created'),
    'A confirmed memory commitment must retain the normal commitment narrative.');

  assert.strictEqual(await restartedRepository.delete(saveable.id), true);
  assert.strictEqual(await restartedRepository.delete(saveable.id), false);
  const memoriesAfterDelete = await restartedRepository.list();
  assert.strictEqual(memoriesAfterDelete.length, 0, 'Delete must persist.');
  const commitmentsAfterDelete = commitmentsModule.buildProjectCommitments({
    projectId: 'project-alpha', projectName: 'Alpha', updates: [], documents: [],
    captureMemories: memoriesAfterDelete, now: '2026-07-13T12:00:00.000Z',
  });
  const timelineAfterDelete = timelineModule.buildProjectTimeline({
    projectId: 'project-alpha', projectName: 'Alpha', updates: [], documents: [], scheduleItems: [],
    commitments: commitmentsAfterDelete, captureMemories: memoriesAfterDelete,
    reality: { state: 'Moving', confidence: 'medium', lastVerifiedAt: null, topRecommendation: null },
    now: '2026-07-13T12:00:00.000Z',
  });
  assert.strictEqual(commitmentsAfterDelete.length, 0, 'Deleting a memory must remove its derived commitment.');
  assert(!timelineAfterDelete.some(item => item.eventType === 'memory_confirmed' || item.eventType === 'commitment_created'),
    'Deleting a memory must remove its memory and commitment timeline events.');

  const corruptRaw = '{not-json';
  const corruptStorage = createStorage({
    [repositoryModule.DAVE_CAPTURE_MEMORY_STORAGE_KEY]: corruptRaw,
  });
  const recoveredRepository = repositoryModule.createDAVECaptureMemoryRepository(corruptStorage);
  await assert.rejects(() => recoveredRepository.list(), /corrupt.*quarantin/i,
    'The operation that discovers corruption must fail closed for App hydration.');
  assert.strictEqual(corruptStorage.values.has(repositoryModule.DAVE_CAPTURE_MEMORY_STORAGE_KEY), false,
    'Corrupted active storage must be removed so restart recovery is stable.');
  const corruptQuarantines = [...corruptStorage.values.entries()].filter(([key]) =>
    key.startsWith(repositoryModule.DAVE_CAPTURE_MEMORY_QUARANTINE_KEY_PREFIX));
  assert.strictEqual(corruptQuarantines.length, 1);
  assert.strictEqual(corruptQuarantines[0][1], corruptRaw,
    'Quarantine must preserve the exact unreadable bytes.');
  assert.strictEqual((await recoveredRepository.list()).length, 0,
    'A safe retry may continue from the now-clean active store.');

  const partiallyCorruptRaw = JSON.stringify({
    schemaVersion: repositoryModule.DAVE_CAPTURE_MEMORY_REPOSITORY_VERSION,
    records: [saveable, { id: 'invalid-memory' }],
  });
  const salvageStorage = createStorage({
    [repositoryModule.DAVE_CAPTURE_MEMORY_STORAGE_KEY]: partiallyCorruptRaw,
  });
  const salvageRepository = repositoryModule.createDAVECaptureMemoryRepository(salvageStorage);
  await assert.rejects(() => salvageRepository.list(), /1 valid record.*safe retry/i,
    'Filtering invalid records must be visible rather than a silent rewrite.');
  const salvageQuarantine = [...salvageStorage.values.entries()].find(([key]) =>
    key.startsWith(repositoryModule.DAVE_CAPTURE_MEMORY_QUARANTINE_KEY_PREFIX));
  assert(salvageQuarantine);
  assert.strictEqual(salvageQuarantine[1], partiallyCorruptRaw);
  assert.deepStrictEqual(
    [...(await salvageRepository.list()).map(item => item.id)],
    [saveable.id],
    'A retry must load only the verified valid record after explicit quarantine.',
  );

  const quarantineFailureStorage = createStorage({
    [repositoryModule.DAVE_CAPTURE_MEMORY_STORAGE_KEY]: corruptRaw,
  }, {
    failSetItem: key => key.startsWith(repositoryModule.DAVE_CAPTURE_MEMORY_QUARANTINE_KEY_PREFIX),
  });
  const blockedRepository = repositoryModule.createDAVECaptureMemoryRepository(quarantineFailureStorage);
  await assert.rejects(() => blockedRepository.list(), /could not be quarantined/i);
  assert.strictEqual(
    quarantineFailureStorage.values.get(repositoryModule.DAVE_CAPTURE_MEMORY_STORAGE_KEY),
    corruptRaw,
    'Quarantine failure must leave the exact active value in place for retry.',
  );

  console.log('DAVE Capture Memory Repository behavioral tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
