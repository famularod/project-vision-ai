#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const cache = new Map();

function load(relative) {
  const absolute = path.resolve(root, relative);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const source = read(relative);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const moduleValue = { exports: {} };
  cache.set(absolute, moduleValue);
  const localRequire = specifier => {
    if (!specifier.startsWith('.')) return require(specifier);
    const base = path.resolve(path.dirname(absolute), specifier);
    const resolved = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]
      .find(candidate => fs.existsSync(candidate));
    if (!resolved) throw new Error(`Cannot resolve ${specifier}`);
    return load(path.relative(root, resolved));
  };
  vm.runInNewContext(compiled.outputText, {
    module: moduleValue,
    exports: moduleValue.exports,
    require: localRequire,
    Date,
    Set,
    Math,
    Object,
  }, { filename: relative });
  return moduleValue.exports;
}

const { buildDAVEProjectWalkContext } = load('services/DAVEProjectWalk.ts');
const now = '2026-07-13T12:00:00.000Z';

function area(id, name, latitude, longitude, overrides = {}) {
  return {
    id,
    name,
    latitude,
    longitude,
    radiusFeet: 250,
    locationCapturedAt: '2026-07-13T08:00:00.000Z',
    ...overrides,
  };
}

function intelligence(overrides = {}) {
  return {
    projectId: 'project-alpha',
    commitments: [],
    actionCenter: {
      priority: 'Open project item',
      reason: 'The project record contains an unresolved item.',
      supportingEvidence: [{ sourceType: 'update', recordId: 'update-global', summary: 'Open update.' }],
      recommendedAction: 'Verify the open project item.',
    },
    dailyBrief: { uncertaintyItems: [] },
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildDAVEProjectWalkContext({
    projectName: 'Alpha',
    projectAreas: [area('area-canopy', 'Canopy B', 34, -118)],
    location: { status: 'resolved', latitude: 34, longitude: -118, accuracyMeters: 5 },
    updates: [],
    scheduleItems: [],
    intelligence: intelligence(),
    now,
    ...overrides,
  });
}

const safety = build({
  updates: [{
    id: 'update-safety',
    projectName: 'Alpha',
    date: '2026-07-13T10:00:00.000Z',
    selectedAreaName: 'Canopy B',
    photos: [{
      id: 'photo-safety',
      category: 'Safety Concern',
      actionStatus: 'Open',
      actionRequired: 'Replace the missing guardrail',
      selectedAreaName: 'Canopy B',
    }],
  }],
});
assert.strictEqual(safety.locationStatus, 'matched');
assert.strictEqual(safety.recommendedArea.name, 'Canopy B');
assert.strictEqual(safety.recommendedArea.confidence, 'high');
assert.strictEqual(safety.prompt.sourceRecordId, 'photo-safety');
assert(safety.prompt.guidance.includes('missing guardrail'));
assert.strictEqual(safety.prompt.areaSpecific, true);

const ambiguous = build({
  projectAreas: [
    area('area-one', 'Area One', 34, -118),
    area('area-two', 'Area Two', 34, -118),
  ],
});
assert.strictEqual(ambiguous.locationStatus, 'ambiguous');
assert.strictEqual(ambiguous.recommendedArea, null, 'Ambiguous GPS must not silently select an area.');

const outside = build({
  location: { status: 'resolved', latitude: 35, longitude: -118, accuracyMeters: 5 },
});
assert.strictEqual(outside.locationStatus, 'outside_mapped_area');
assert.strictEqual(outside.recommendedArea, null);

const notConfigured = build({
  projectAreas: [area('area-canopy', 'Canopy B', 34, -118, { locationCapturedAt: null })],
});
assert.strictEqual(notConfigured.locationStatus, 'not_configured');

const schedule = build({
  updates: [],
  scheduleItems: [{
    id: 'schedule-conduit',
    projectName: 'Alpha',
    locationName: 'Canopy B',
    taskName: 'Conduit rough-in',
    status: 'In Progress',
    priority: 'High',
    finishDate: '2026-07-10',
    createdAt: '2026-07-01T08:00:00.000Z',
  }],
});
assert.strictEqual(schedule.prompt.sourceRecordId, 'schedule-conduit');
assert(schedule.prompt.guidance.includes('Conduit rough-in'));
assert(schedule.prompt.whyItMatters.includes('after 2026-07-10'));

const unavailable = build({ location: { status: 'unavailable' } });
assert.strictEqual(unavailable.locationStatus, 'unavailable');
assert.strictEqual(unavailable.prompt.guidance, 'Verify the open project item.');

const app = read('App.tsx');
const sheet = read('components/DAVEVoiceCaptureSheet.tsx');
assert(app.includes('beginProjectWalkCapture') && app.includes('getCurrentLocationSnapshot()'), 'Capture Memory must resolve current foreground location when opened.');
assert(app.includes('walkContext={projectWalkContext}') && app.includes('buildDAVEProjectWalkContext'), 'Live capture must render the deterministic Project Walk context.');
assert(app.includes("kind: 'location_record'") && app.includes('confirmed: false'), 'GPS recommendations must preserve evidence and still require PM confirmation.');
assert(app.includes('areasConflict') && app.includes('? null'), 'Conflicting transcript and GPS areas must not silently choose one.');
['Project Walk', 'Why:', 'walkContext.locationMessage', 'walkContext.prompt.guidance'].forEach(marker =>
  assert(sheet.includes(marker), `Voice capture must render ${marker}.`));

console.log('PASS DAVE Project Walk context and live-wiring checks');
