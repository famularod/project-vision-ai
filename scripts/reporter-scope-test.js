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
const app = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');
const reportsScreen = fs.readFileSync(path.resolve(__dirname, '../screens/ReportsScreen.tsx'), 'utf8');
const authorityScope = fs.readFileSync(path.resolve(__dirname, '../services/ReportAuthorityScope.ts'), 'utf8');
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

assert(
  reportsScreen.includes("? 'Choose Project' : 'Choose Projects'") &&
    reportsScreen.includes("accessibilityRole={reportType === 'daily_project_update' ? 'radio' : 'checkbox'}") &&
    reportsScreen.includes('onToggleProject(project)'),
  'Reports must expose a single-select project picker and a multi-select combined-project picker.',
);
assert(
  app.includes('buildCombinedReportAuthorityScope({') &&
    app.includes('buildDailyReportAuthorityScope({') &&
    authorityScope.includes('const scheduleItemId = cleanText(update.scheduleItemId)') &&
    authorityScope.includes('const scheduleProjectName = cleanText(update.scheduleProjectName)') &&
    authorityScope.includes('owners?.size === 1') &&
    app.includes('selectedProjectNames={selectedReportProjectNames}'),
  'Visible project selections must scope live authority by exact parent/task identity and reject ambiguous area-only evidence.',
);

console.log('PASS reporter single/combined project scope');
