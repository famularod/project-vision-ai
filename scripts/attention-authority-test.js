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
const capture = app;
const piePanel = read('components/PIEPanel.tsx');

assert(provider.includes('attention: PIECoreOutput'), 'Provider must expose Attention output.');
assert(provider.includes('attention: currentCore?.attention || null'), 'Provider value must include current scope attention.');
assert(home.includes('liveAuthority.attention || buildPIEAttentionState'), 'Home must prefer provider attention.');
assert(reports.includes('liveAuthority.attention || buildPIEAttentionState'), 'Review must prefer provider attention.');
assert(capture.includes('usePIELiveAuthority'), 'Capture must consume provider authority state.');
assert(capture.includes('liveAuthority.policy.userMessage'), 'Capture must show friendly degraded authority status.');
assert(piePanel.includes('liveAuthority?.runtime || fallbackRuntime'), 'Shared PIEPanel must prefer provider Runtime.');

console.log('PASS attention authority routing');
