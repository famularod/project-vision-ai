#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const provider = read('providers/PIELiveAuthorityProvider.tsx');
const app = read('App.tsx');
const reports = read('screens/ReportsScreen.tsx');
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
assert(app.includes('authoritySurfaceForMode'), 'App must map stable authority modes to PIE surfaces.');
assert(app.includes('authorityProjectId'), 'App must provide stable local project IDs.');

assert((app.match(/usePIELiveAuthority\(\)/g) || []).length >= 3, 'Home, Capture, and Project Workspace must consume live authority provider.');
assert(!app.includes('buildLivePIECoreIntelligence'), 'Screens must not call Core live authority directly.');
assert(!reports.includes('buildLivePIECoreIntelligence'), 'Reports must not call Core live authority directly.');
assert(
  provider.includes("void runRefresh(core ? 'project_changed' : 'initial_load')") &&
    provider.includes('}, [readyForAuthority, signature]);'),
  'Provider must refresh when its hydrated evidence signature changes.',
);
assert(
  provider.includes('hydrated?: boolean;') &&
    provider.includes('const inputHydrated = input.hydrated !== false;') &&
    provider.includes('if (!authorityReadyRef.current) return;'),
  'Provider must default callers to ready but refuse Core refreshes while hydration is explicitly pending.',
);
assert(
  provider.includes('sequenceRef.current += 1;') &&
    provider.includes('inFlightRef.current = null;') &&
    provider.includes('if (!readyForAuthority) return;'),
  'Provider must invalidate in-flight authority and skip Project Truth persistence when hydration becomes pending.',
);
assert(app.includes('const liveAuthorityInput = useMemo') && app.includes('updates: (') && app.includes('currentUpdate: (') && app.includes('captureMemories,'), 'App must include live evidence in provider input.');
assert(reports.includes('liveAuthority.reportDraft || runtime.response.reportDraft'), 'Review must prefer provider report draft with Runtime recovery only.');
assert(app.includes('liveAuthority.projectTruth.briefing.nextActions'), 'Home must prefer provider-backed Project Truth actions.');
assert(
  app.includes('const projectIntelligence = liveAuthority.projectTruth.intelligence;'),
  'Project Workspace must consume provider Project Truth intelligence directly.',
);
assert(reports.includes('const runtime = liveAuthority.runtime;'), 'Review must consume provider Runtime directly.');
assert(piePanel.includes('useOptionalPIELiveAuthority'), 'PIEPanel must consume optional provider authority.');
assert(piePanel.includes('liveAuthority?.runtime || fallbackRuntime'), 'PIEPanel must prefer provider Runtime when available.');

console.log('PASS live provider routing');
