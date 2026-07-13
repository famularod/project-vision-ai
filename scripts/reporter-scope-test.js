#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../services/PIEReportScope.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const moduleUnderTest = { exports: {} };

new Function('module', 'exports', compiled)(
  moduleUnderTest,
  moduleUnderTest.exports,
);

const { resolvePIEReportProjectNames } = moduleUnderTest.exports;
const single = resolvePIEReportProjectNames({
  selectedProjectNames: ['Alpha'],
  fallbackProjectNames: ['Alpha', 'Beta'],
});
const combined = resolvePIEReportProjectNames({
  selectedProjectNames: ['Alpha', 'Beta'],
  fallbackProjectNames: ['Alpha', 'Beta'],
});

assert.deepStrictEqual(
  single,
  ['Alpha'],
  'Single Project Update must not pull other projects from saved history.',
);
assert.deepStrictEqual(
  combined,
  ['Alpha', 'Beta'],
  'Combined Project Update must retain every explicitly selected project.',
);

console.log('PASS reporter single/combined project scope');
