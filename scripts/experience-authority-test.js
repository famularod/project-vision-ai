#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const provider = read('providers/PIELiveAuthorityProvider.tsx');
const app = read('App.tsx');
const home = app;
const reports = read('screens/ReportsScreen.tsx');

assert(provider.includes('experience: PIECoreOutput'), 'Provider must expose Experience output.');
assert(provider.includes('policyForState'), 'Provider must define screen policy by authority state.');
assert(provider.includes('highImpactAutomationAllowed'), 'Provider must block high-impact automation outside ready state.');
assert(provider.includes('reportGenerationAllowed'), 'Provider must control report generation policy.');
assert(app.includes('surface: authoritySurfaceForMode(authorityMode)'), 'App must send the stable authority mode into provider input.');
assert(home.includes('liveAuthority.projectTruth.briefing.nextActions'), 'Home must prefer provider-backed Project Truth actions.');
assert(reports.includes('liveAuthority.policy.reportGenerationAllowed'), 'Reports must enforce report authority state.');
assert(
  reports.includes('Current project data is still loading. Refresh before approving.'),
  'Reports must show a concise authority-block reason.',
);
assert(
  reports.includes('evaluateReportApprovalPolicy({') &&
    reports.includes('reportGenerationAllowed,') &&
    reports.includes('disabled={!reportApprovalAllowed}'),
  'Report approval must be disabled while authority or report policy blocks generation.',
);

console.log('PASS experience authority routing');
