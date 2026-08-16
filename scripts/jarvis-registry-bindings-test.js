#!/usr/bin/env node

const assert = require('node:assert/strict');
const {
  extractNamedJestTests,
  productionSymbolIsDeclared,
} = require('./jarvis-registry-bindings');

assert.deepEqual(
  extractNamedJestTests(`
    describe('scope', () => {
      it('blocks stale work', () => expect(true).toBe(true));
      test("preserves deletion intent", () => expect(true).toBe(true));
    });
  `),
  ['blocks stale work', 'preserves deletion intent'],
);
assert.equal(
  productionSymbolIsDeclared(
    'export async function uploadPendingChanges() { return true; }',
    'uploadPendingChanges',
  ),
  true,
);
assert.equal(
  productionSymbolIsDeclared('// export function uploadPendingChanges() {}', 'uploadPendingChanges'),
  false,
);
assert.deepEqual(
  extractNamedJestTests("// it('fake coverage', () => expect(true).toBe(true));"),
  [],
);

console.log('Jarvis escaped-defect named-test and production-symbol contracts PASS.');
