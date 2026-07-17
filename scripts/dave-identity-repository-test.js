#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
}

function loadTs(relativePath, externalModules, cache = new Map()) {
  const filename = path.join(root, relativePath);
  if (cache.has(filename)) return cache.get(filename);
  const moduleValue = { exports: {} };
  cache.set(filename, moduleValue.exports);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const localRequire = request => {
    if (externalModules[request]) return externalModules[request];
    if (request.startsWith('.')) {
      return loadTs(path.relative(root, path.resolve(path.dirname(filename), `${request}.ts`)), externalModules, cache);
    }
    return require(request);
  };
  vm.runInNewContext(compiled, {
    module: moduleValue,
    exports: moduleValue.exports,
    require: localRequire,
    Object, Date, Set, Map, Math, JSON, Promise,
  }, { filename });
  cache.set(filename, moduleValue.exports);
  return moduleValue.exports;
}

async function run() {
  const storage = createStorage();
  const external = {
    '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
  };
  const identity = loadTs('services/DAVEIdentity.ts', external);
  const repositoryModule = loadTs('services/DAVEIdentityRepository.ts', external);
  const repository = repositoryModule.createDAVEIdentityRepository(storage);
  const correction = {
    id: 'area-correction-1',
    kind: 'area',
    rawName: 'Pump Hse',
    canonicalName: 'Pump House',
    parentProjectName: '2321 Compliance Project',
    sourceRecordId: 'pm-correction-1',
    confirmedAt: '2026-07-16T12:00:00.000Z',
    confirmedBy: 'Project manager',
  };

  await repository.save(correction);
  assert.strictEqual((await repository.list()).length, 1);
  const restarted = repositoryModule.createDAVEIdentityRepository(storage);
  const hydrated = await restarted.list();
  assert.strictEqual(hydrated[0].canonicalName, 'Pump House');
  const registry = identity.buildDAVEIdentityRegistry({
    projectNames: ['2321 Compliance Project'],
    corrections: hydrated,
  });
  const resolution = identity.resolveDAVEIdentity({
    rawName: 'Pump Hse',
    expectedKind: 'area',
    parentProjectName: '2321 Compliance Project',
    registry,
  });
  assert.strictEqual(resolution.status, 'resolved');
  assert.strictEqual(resolution.entity.canonicalName, 'Pump House');

  await restarted.save({
    ...correction,
    id: 'area-correction-2',
    canonicalName: 'Fire Pump House',
    confirmedAt: '2026-07-16T13:00:00.000Z',
  });
  const superseded = await restarted.list();
  assert.strictEqual(superseded.length, 1);
  assert.strictEqual(superseded[0].canonicalName, 'Fire Pump House');
  await assert.rejects(
    () => restarted.save({ ...superseded[0], canonicalName: 'Different value' }),
    /already exists/,
  );

  assert.strictEqual(await restarted.delete('area-correction-2'), true);
  assert.strictEqual(await restarted.delete('area-correction-2'), false);

  const corruptStorage = createStorage({
    [repositoryModule.DAVE_IDENTITY_STORAGE_KEY]: '{bad-json',
  });
  const recovered = repositoryModule.createDAVEIdentityRepository(corruptStorage);
  assert.strictEqual((await recovered.list()).length, 0);
  assert.strictEqual(corruptStorage.values.has(repositoryModule.DAVE_IDENTITY_STORAGE_KEY), false);

  console.log('PASS DAVE identity correction persistence');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
