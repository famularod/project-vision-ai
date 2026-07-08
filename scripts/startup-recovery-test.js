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
}

async function testUpgrade() {
  const storage = memoryStorage({
    older: JSON.stringify([{ id: 'old-one' }, { broken: true }, { id: 'old-two' }]),
  });
  const recovery = loadStartupRecovery(storage);
  const result = await recovery.readStartupJson('older', [], 'older records');
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
  assert.strictEqual(normalized.isolatedRecordCount, 1);
}

async function testRecovery() {
  const storage = memoryStorage({
    corrupt: '{not-json',
  });
  const recovery = loadStartupRecovery(storage);
  const result = await recovery.readStartupJson('corrupt', [], 'corrupt records');
  assert.deepStrictEqual(result.value, []);
  assert.strictEqual(result.recovered, true);
  assert.strictEqual(storage.data.has('corrupt'), false, 'corrupt value should be removed from active key');
  assert(
    Array.from(storage.data.keys()).some(key => key.startsWith('corrupt.corrupt.')),
    'corrupt value should be quarantined',
  );
}

function testStaticStartupGuards() {
  const app = fs.readFileSync(path.join(rootDir, 'App.tsx'), 'utf8');
  const provider = fs.readFileSync(path.join(rootDir, 'providers/PIELiveAuthorityProvider.tsx'), 'utf8');
  const boundary = fs.readFileSync(path.join(rootDir, 'components/StartupErrorBoundary.tsx'), 'utf8');
  assert(app.includes('<StartupErrorBoundary>'), 'App should mount startup error boundary');
  assert(app.includes('readStartupJson'), 'App should use guarded startup JSON reads');
  assert(app.includes('startup_completed'), 'App should log startup completion');
  assert(provider.includes('safeBuildProviderRuntime'), 'Provider should guard Runtime initialization');
  assert(provider.includes('providerRuntimeContext'), 'Provider should sanitize runtime context');
  assert(boundary.includes('Retry'), 'Error boundary should offer retry');
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
