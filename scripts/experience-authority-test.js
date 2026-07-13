#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const provider = read('providers/PIELiveAuthorityProvider.tsx');
const app = read('App.tsx');
const home = read('components/HomeDashboard.tsx');
const buildUpdate = read('screens/BuildUpdateScreen.tsx');
const projectAssistant = read('screens/ProjectAssistantScreen.tsx');

assert(provider.includes('experience: PIECoreOutput'), 'Provider must expose Experience output.');
assert(provider.includes('policyForState'), 'Provider must define screen policy by authority state.');
assert(provider.includes('highImpactAutomationAllowed'), 'Provider must block high-impact automation outside ready state.');
assert(provider.includes('reportGenerationAllowed'), 'Provider must control report generation policy.');
assert(app.includes('surface: authoritySurfaceForScreen(screen)'), 'App must send current surface into provider input.');
assert(home.includes('liveAuthority.experience || buildPIEExperience'), 'Home must prefer provider experience.');
assert(home.includes('liveAuthority.policy.userMessage'), 'Home must include friendly authority degraded message.');
assert(buildUpdate.includes('liveAuthority.policy.reportGenerationAllowed'), 'Share must show report authority state.');
assert(projectAssistant.includes('liveAuthority.core?.bestNextStep'), 'Assistant must use provider next best step.');

console.log('PASS experience authority routing');
