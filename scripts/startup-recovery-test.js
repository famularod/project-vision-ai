#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const mode = process.argv[2] || 'startup';

function loadStartupRecovery(storage) {
  const cache = new Map();
  function load(relativePath) {
    const normalized = relativePath.endsWith('.ts') ? relativePath : `${relativePath}.ts`;
    const fullPath = path.join(rootDir, normalized);
    if (cache.has(fullPath)) return cache.get(fullPath);
    const source = fs.readFileSync(fullPath, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });
    const sandbox = {
      exports: {},
      require: specifier => {
        if (specifier === '@react-native-async-storage/async-storage') {
          return { __esModule: true, default: storage };
        }
        if (specifier.startsWith('.')) {
          return load(path.join(path.dirname(normalized), specifier));
        }
        return require(specifier);
      },
      console: { info() {}, log() {}, warn() {}, error() {} },
      Date,
      Object,
      JSON,
      RegExp,
      Set,
      Map,
      String,
      Number,
      Boolean,
      Error,
      Math,
      Array,
      Promise,
    };
    vm.runInNewContext(compiled.outputText, sandbox, { filename: fullPath });
    cache.set(fullPath, sandbox.exports);
    return sandbox.exports;
  }
  return load('services/StartupRecovery.ts');
}

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    async getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async setItem(key, value) {
      data.set(key, value);
    },
    async removeItem(key) {
      data.delete(key);
    },
  };
}

async function testStartup() {
  const storage = memoryStorage({
    valid: JSON.stringify([{ id: 'one' }]),
  });
  const recovery = loadStartupRecovery(storage);
  const result = await recovery.readStartupJson('valid', [], 'valid records');
  assert.strictEqual(result.state, 'loaded');
  assert.strictEqual(result.key, 'valid');
  assert.strictEqual(result.label, 'valid records');
  assert.strictEqual(result.found, true);
  assert(Array.isArray(result.value), 'valid JSON should parse');
  const normalized = recovery.normalizeStartupArray(
    result.value,
    record => {
      if (!record.id) throw new Error('missing id');
      return { id: String(record.id) };
    },
    'valid records',
  );
  assert.strictEqual(JSON.stringify(normalized.value), JSON.stringify([{ id: 'one' }]));
  assert.strictEqual(normalized.isolatedRecordCount, 0);

  const fallback = [{ id: 'first-run-default' }];
  const missing = await recovery.readStartupJson('missing', fallback, 'missing records');
  assert.strictEqual(missing.state, 'missing');
  assert.strictEqual(missing.key, 'missing');
  assert.strictEqual(missing.found, false);
  assert.strictEqual(missing.value, fallback, 'only a truly missing key may hydrate its fallback');
}

async function testUpgrade() {
  const exactRaw = JSON.stringify([
    { id: 'old-one', legacy: 'preserve-exactly' },
    { broken: true, legacy: 'quarantine-with-original' },
    { id: 'old-two' },
  ]);
  const storage = memoryStorage({
    older: exactRaw,
  });
  const recovery = loadStartupRecovery(storage);
  const discovered = await recovery.readStartupJsonArray(
    'older',
    [],
    'older records',
    record => Boolean(record && typeof record === 'object' && record.id),
  );
  assert.strictEqual(
    discovered.state,
    'corrupt_quarantined',
    'a malformed row must block the discovering startup instead of being silently skipped',
  );
  assert.strictEqual(discovered.isolatedRecordCount, 1);
  assert.throws(() => discovered.value, /cannot hydrate.*corrupt_quarantined/i);
  assert.strictEqual(
    storage.data.get('older'),
    JSON.stringify([
      { id: 'old-one', legacy: 'preserve-exactly' },
      { id: 'old-two' },
    ]),
    'salvage must preserve only demonstrably valid raw records without normalizing them',
  );
  assert(
    Array.from(storage.data.values()).includes(exactRaw),
    'quarantine must preserve the exact pre-recovery bytes',
  );

  const result = await recovery.readStartupJsonArray(
    'older',
    [],
    'older records',
    record => Boolean(record && typeof record === 'object' && record.id),
  );
  assert.strictEqual(result.state, 'loaded', 'retry should read the verified salvage');
  const normalized = recovery.normalizeStartupArray(
    result.value,
    record => {
      if (!record.id) throw new Error('missing id');
      return { id: String(record.id), migrated: true };
    },
    'older records',
  );
  assert.strictEqual(JSON.stringify(normalized.value), JSON.stringify([
    { id: 'old-one', migrated: true },
    { id: 'old-two', migrated: true },
  ]));
  assert.strictEqual(normalized.isolatedRecordCount, 0);

  storage.data.set('all-invalid', JSON.stringify([{ bad: 1 }, null]));
  const noValidRecords = await recovery.readStartupJsonArray(
    'all-invalid',
    [{ id: 'must-not-be-used' }],
    'all invalid records',
    record => Boolean(record && typeof record === 'object' && record.id),
  );
  assert.strictEqual(noValidRecords.state, 'corrupt_quarantined');
  assert.strictEqual(storage.data.get('all-invalid'), '[]');
  const emptyRetry = await recovery.readStartupJsonArray(
    'all-invalid',
    [{ id: 'must-not-be-used' }],
    'all invalid records',
    record => Boolean(record && typeof record === 'object' && record.id),
  );
  assert.strictEqual(emptyRetry.state, 'loaded');
  assert.deepStrictEqual(Array.from(emptyRetry.value), []);
}

async function testRecovery() {
  const storage = memoryStorage({
    corrupt: '{not-json',
  });
  const recovery = loadStartupRecovery(storage);
  const fallback = [{ id: 'must-not-hydrate' }];
  const result = await recovery.readStartupJson('corrupt', fallback, 'corrupt records');
  assert.strictEqual(result.state, 'corrupt_quarantined');
  assert.strictEqual(result.key, 'corrupt');
  assert.strictEqual(result.recovered, true);
  const corruptFailures = recovery.reconcileStartupHydrationFailures([], [result]);
  assert.strictEqual(corruptFailures.length, 1, 'corrupt required data must block hydration');
  assert.throws(
    () => result.value,
    /cannot hydrate.*corrupt_quarantined/i,
    'corrupt storage must not expose the fallback value',
  );
  assert.strictEqual(storage.data.has('corrupt'), false, 'corrupt value should be removed from active key');
  assert(
    Array.from(storage.data.keys()).some(key => key.startsWith('corrupt.corrupt.')),
    'corrupt value should be quarantined',
  );
  assert(
    Array.from(storage.data.values()).includes('{not-json'),
    'quarantine must preserve the exact corrupt bytes',
  );

  storage.data.set('wrong-shape', JSON.stringify({ records: [] }));
  const wrongShape = await recovery.readStartupJson(
    'wrong-shape',
    [],
    'array records',
    Array.isArray,
  );
  assert.strictEqual(wrongShape.state, 'corrupt_quarantined');
  assert.strictEqual(
    storage.data.has('wrong-shape'),
    false,
    'a valid JSON envelope with the wrong shape must not hydrate as an empty list',
  );

  const unverifiableStorage = memoryStorage({ unsafe: '{broken' });
  unverifiableStorage.setItem = async () => undefined;
  const unverifiableRecovery = loadStartupRecovery(unverifiableStorage);
  const unverifiable = await unverifiableRecovery.readStartupJson(
    'unsafe',
    [],
    'unsafe records',
  );
  assert.strictEqual(unverifiable.state, 'read_failed');
  assert.strictEqual(
    unverifiableStorage.data.get('unsafe'),
    '{broken',
    'active bytes must remain untouched when quarantine cannot be verified',
  );

  const salvageWriteFailureStorage = memoryStorage({
    'partial-write': JSON.stringify([{ id: 'keep' }, { bad: true }]),
  });
  const originalSetItem = salvageWriteFailureStorage.setItem.bind(salvageWriteFailureStorage);
  salvageWriteFailureStorage.setItem = async (key, value) => {
    if (key === 'partial-write') return;
    return originalSetItem(key, value);
  };
  const salvageWriteFailureRecovery = loadStartupRecovery(salvageWriteFailureStorage);
  const salvageWriteFailure = await salvageWriteFailureRecovery.readStartupJsonArray(
    'partial-write',
    [],
    'partial write records',
    record => Boolean(record && typeof record === 'object' && record.id),
  );
  assert.strictEqual(salvageWriteFailure.state, 'read_failed');
  assert.strictEqual(
    salvageWriteFailureStorage.data.get('partial-write'),
    JSON.stringify([{ id: 'keep' }, { bad: true }]),
    'unverified salvage must not be reported as recovered',
  );
  assert(
    Array.from(salvageWriteFailureStorage.data.values()).includes(
      JSON.stringify([{ id: 'keep' }, { bad: true }]),
    ),
    'the exact original bytes must still be quarantined before salvage is attempted',
  );

  const retryStorage = memoryStorage({
    retryable: JSON.stringify([{ id: 'persisted' }]),
  });
  const persistedGet = retryStorage.getItem.bind(retryStorage);
  let failRead = true;
  retryStorage.getItem = async key => {
    if (failRead) throw new Error('temporary storage unavailable');
    return persistedGet(key);
  };
  const retryRecovery = loadStartupRecovery(retryStorage);
  const failed = await retryRecovery.readStartupJson(
    'retryable',
    fallback,
    'retryable records',
  );
  assert.strictEqual(failed.state, 'read_failed');
  assert.strictEqual(failed.key, 'retryable');
  assert.strictEqual(failed.recovered, false);
  const readFailures = recovery.reconcileStartupHydrationFailures(corruptFailures, [failed]);
  assert.strictEqual(readFailures.length, 2, 'each failed required domain must remain visible');
  assert.throws(
    () => failed.value,
    /cannot hydrate.*read_failed/i,
    'a transient read failure must not become fallback hydration',
  );

  failRead = false;
  const retried = await retryRecovery.readStartupJson(
    'retryable',
    fallback,
    'retryable records',
  );
  assert.strictEqual(retried.state, 'loaded');
  assert.strictEqual(JSON.stringify(retried.value), JSON.stringify([{ id: 'persisted' }]));
  const recoveredFailures = recovery.reconcileStartupHydrationFailures(readFailures, [retried]);
  assert.strictEqual(recoveredFailures.length, 1, 'a successful retry must clear only its domain');
}

function testStaticStartupGuards() {
  const app = fs.readFileSync(path.join(rootDir, 'App.tsx'), 'utf8');
  const provider = fs.readFileSync(path.join(rootDir, 'providers/PIELiveAuthorityProvider.tsx'), 'utf8');
  const boundary = fs.readFileSync(path.join(rootDir, 'components/StartupErrorBoundary.tsx'), 'utf8');
  const hydrationBoundary = fs.readFileSync(path.join(rootDir, 'components/StartupHydrationBoundary.tsx'), 'utf8');
  assert(app.includes('<StartupErrorBoundary>'), 'App should mount startup error boundary');
  assert(app.includes('readStartupJson'), 'App should use guarded startup JSON reads');
  assert(
    app.includes('readStartupJsonArray<ProjectUpdate>') &&
      app.includes('isStartupSavedUpdateRecord') &&
      app.includes('isStartupProjectAreaRecord') &&
      app.includes('isStartupScheduleItemRecord'),
    'Stored array domains must validate individual legacy-aware records before normalization',
  );
  assert(app.includes('<StartupHydrationBoundary'), 'App should block live actions until required hydration succeeds');
  assert(app.includes('enabled: startupHydrationReady &&'), 'Persistence hooks must remain disabled while hydration is blocked');
  assert(app.includes('if (!startupHydrationReady || !updatesLoaded'), 'Background update save and sync must wait for hydration');
  assert(app.includes('startup_completed'), 'App should log startup completion');
  assert(provider.includes('safeBuildProviderRuntime'), 'Provider should guard Runtime initialization');
  assert(provider.includes('providerRuntimeContext'), 'Provider should sanitize runtime context');
  assert(boundary.includes('Retry'), 'Error boundary should offer retry');
  assert(hydrationBoundary.includes('Retry Recovery'), 'Hydration failure should offer recovery retry');
  assert(hydrationBoundary.includes('Nothing will be saved, synced, restored, backed up, or exported'), 'Hydration failure should explain the blocked safety state');
  assert(!boundary.includes('stack trace'), 'Error boundary should not expose stack traces to the user');
}

async function run() {
  if (mode === 'startup') {
    await testStartup();
    testStaticStartupGuards();
    console.log('PASS startup');
    return;
  }
  if (mode === 'upgrade') {
    await testUpgrade();
    testStaticStartupGuards();
    console.log('PASS startup-upgrade');
    return;
  }
  if (mode === 'recovery') {
    await testRecovery();
    testStaticStartupGuards();
    console.log('PASS startup-recovery');
    return;
  }
  throw new Error(`Unknown startup test mode: ${mode}`);
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
