#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'services/FieldUpdateLifecycle.ts'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
});
const sandbox = { exports: {} };
vm.runInNewContext(compiled.outputText, sandbox, {
  filename: 'services/FieldUpdateLifecycle.ts',
});

const {
  fieldUpdateLifecycleLabel,
  fieldUpdateLifecycleState,
  persistedStatusForSyncResult,
} = sandbox.exports;

assert.strictEqual(fieldUpdateLifecycleState('sent'), 'cloud_synced');
assert.strictEqual(fieldUpdateLifecycleLabel('sent'), 'Cloud Synced');
assert.strictEqual(fieldUpdateLifecycleLabel('queued'), 'Waiting to Sync');
assert.strictEqual(fieldUpdateLifecycleLabel('ready_to_send'), 'Ready to Sync');
assert.strictEqual(fieldUpdateLifecycleLabel('failed'), 'Sync Failed');

const successful = persistedStatusForSyncResult({
  result: 'success',
  failureCategory: null,
});
assert.strictEqual(successful, 'sent', 'legacy storage token must remain compatible');
assert.strictEqual(
  fieldUpdateLifecycleLabel(successful),
  'Cloud Synced',
  'a cloud write must never be presented as external delivery',
);
assert.strictEqual(
  persistedStatusForSyncResult({ result: 'failed', failureCategory: 'offline' }),
  'queued',
);
assert.strictEqual(
  persistedStatusForSyncResult({ result: 'failed', failureCategory: 'auth' }),
  'failed',
);

const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
for (const misleadingCopy of [
  'Last update sent',
  'Original message was sent while analysis was unresolved',
  'Sent updates are communication records',
  'Archive sent update',
]) {
  assert(
    !app.includes(misleadingCopy),
    `App still exposes misleading lifecycle copy: ${misleadingCopy}`,
  );
}
assert(
  app.includes('fieldUpdateLifecycleLabel(status)'),
  'filter labels must use the truthful lifecycle label map',
);

console.log('PASS field-update lifecycle semantics');
