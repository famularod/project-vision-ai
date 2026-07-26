#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const file = path.join(__dirname, '..', 'services', 'DAVEConversationFramework.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const moduleValue = { exports: {} };
vm.runInNewContext(compiled.outputText, { module: moduleValue, exports: moduleValue.exports, Object }, { filename: file });
const framework = moduleValue.exports;

let state = framework.createConversationSnapshot();
for (const next of ['listening', 'understanding', 'confirming', 'saving', 'follow_up', 'idle']) {
  state = framework.transitionConversation(state, next);
  assert(Object.isFrozen(state));
}
assert.strictEqual(state.state, 'idle');
assert.strictEqual(state.revision, 6);
assert.throws(() => framework.transitionConversation(state, 'saving'), /Invalid DAVE conversation transition/);

let cancelled = framework.transitionConversation(framework.transitionConversation(state, 'listening'), 'cancelled');
cancelled = framework.recoverConversation(cancelled);
assert.strictEqual(cancelled.state, 'idle');

let failed = framework.transitionConversation(framework.transitionConversation(state, 'listening'), 'failed', 'Could not understand the memory.');
assert.strictEqual(failed.failureReason, 'Could not understand the memory.');
failed = framework.recoverConversation(failed);
assert.strictEqual(failed.state, 'idle');

assert(Object.isFrozen(framework.DAVE_CONVERSATION_TRANSITIONS));
console.log('DAVE Conversation Framework tests passed.');
