#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const provider = read('providers/PIELiveAuthorityProvider.tsx');
const app = read('App.tsx');
const home = app;
const capture = app;
const buildUpdate = app;
const reports = read('screens/ReportsScreen.tsx');
const projectOverview = app;
const projectAssistant = app;
const piePanel = read('components/PIEPanel.tsx');

assert(provider.includes('buildLivePIECoreIntelligence'), 'Provider must call buildLivePIECoreIntelligence.');
assert(provider.includes('buildRuntime'), 'Provider must build shared Runtime input.');
assert(provider.includes('PIELiveAuthorityProvider'), 'Provider component must exist.');
assert(provider.includes('usePIELiveAuthority'), 'Provider hook must exist.');
assert(provider.includes('inFlightRef'), 'Provider must dedupe concurrent refreshes.');
assert(provider.includes('sequenceRef'), 'Provider must prevent stale refresh overwrite.');
assert(provider.includes('setTimeout'), 'Provider must include background retry behavior.');
assert(provider.includes('refreshAuthority'), 'Provider must expose refreshAuthority.');
assert(provider.includes('invalidateEvidence'), 'Provider must expose invalidateEvidence.');
assert(provider.includes('notifyEvidenceChanged'), 'Provider must expose notifyEvidenceChanged.');
assert(provider.includes('notifyProjectChanged'), 'Provider must expose notifyProjectChanged.');

[
  'ready',
  'degraded_local_only',
  'queued_for_cloud',
  'stale_model',
  'conflict_blocked',
  'blocked_identity',
  'blocked_organization',
  'persistence_failed',
  'unavailable',
].forEach(state => {
  assert(provider.includes(state), `Provider policy must define ${state}.`);
});

assert(app.includes('<PIELiveAuthorityProvider input={liveAuthorityInput}>'), 'App must mount provider above primary screens.');
assert(app.includes('authoritySurfaceForScreen'), 'App must map screens to PIE surfaces.');
assert(app.includes('authorityProjectId'), 'App must provide stable local project IDs.');

[
  ['HomeDashboard', home],
  ['PhotoCapturePanel', capture],
  ['BuildUpdateScreen', buildUpdate],
  ['ReportsScreen', reports],
  ['ProjectOverviewScreen', projectOverview],
  ['ProjectAssistantScreen', projectAssistant],
].forEach(([name, source]) => {
  assert(source.includes('usePIELiveAuthority'), `${name} must consume live authority provider.`);
  assert(!source.includes('buildLivePIECoreIntelligence'), `${name} must not call Core live authority directly.`);
});

assert(buildUpdate.includes('notifyEvidenceChanged'), 'Capture wrapper must notify evidence changes.');
assert(buildUpdate.includes('invalidateEvidence'), 'Capture wrapper must invalidate removed evidence.');
assert(reports.includes('liveAuthority.reportDraft || runtime.response.reportDraft'), 'Review must prefer provider report draft with Runtime recovery only.');
assert(projectOverview.includes('liveAuthority.core.bestNextStep'), 'Project Workspace must prefer provider bestNextStep.');
assert(projectAssistant.includes('liveAuthority.core?.bestNextStep'), 'Project Assistant must prefer provider bestNextStep.');
assert(home.includes('const runtime = liveAuthority.runtime;'), 'Home must consume provider Runtime directly.');
assert(reports.includes('const runtime = liveAuthority.runtime;'), 'Review must consume provider Runtime directly.');
assert(projectOverview.includes('const runtime = liveAuthority.runtime;'), 'Project Workspace must consume provider Runtime directly.');
assert(piePanel.includes('useOptionalPIELiveAuthority'), 'PIEPanel must consume optional provider authority.');
assert(piePanel.includes('liveAuthority?.runtime || fallbackRuntime'), 'PIEPanel must prefer provider Runtime when available.');

console.log('PASS live provider routing');
