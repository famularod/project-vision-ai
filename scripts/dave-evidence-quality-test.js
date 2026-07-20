#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadTs(relativePath, cache = new Map()) {
  const filename = path.join(root, relativePath);
  if (cache.has(filename)) return cache.get(filename);
  const module = { exports: {} };
  cache.set(filename, module.exports);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const localRequire = request => {
    if (!request.startsWith('.')) return require(request);
    return loadTs(path.relative(root, path.resolve(path.dirname(filename), `${request}.ts`)), cache);
  };
  vm.runInNewContext(compiled.outputText, {
    module,
    exports: module.exports,
    require: localRequire,
    Date,
    Set,
    Map,
    encodeURIComponent,
  }, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}

const { buildProjectEvidenceQuality } = loadTs('services/DAVEProjectEvidenceQuality.ts');
const now = '2026-07-11T12:00:00.000Z';

function build(overrides = {}) {
  return buildProjectEvidenceQuality({
    projectId: 'project-alpha',
    projectName: 'Alpha',
    updates: [],
    documents: [],
    scheduleItems: [],
    now,
    ...overrides,
  });
}

function photo(id, status = 'analysis_complete', comparability = 'strong') {
  return {
    id,
    category: 'Update',
    actionStatus: 'Closed',
    locationCapturedAt: '2026-07-10T10:00:00.000Z',
    photoIntelligence: {
      status,
      comparability,
      priorEvidenceId: status === 'no_suitable_prior_photo' ? null : 'prior-evidence',
      updatedAt: '2026-07-10T10:01:00.000Z',
    },
  };
}

function update(id, photos = []) {
  return {
    id,
    projectName: 'Alpha',
    date: '2026-07-10T10:00:00.000Z',
    photos,
  };
}

const empty = build();
assert.strictEqual(empty.strength, 'Low', 'Missing evidence must produce low evidence strength.');
assert.strictEqual(empty.signals.length, 6, 'All requested evidence signals must be present.');
assert(empty.signals.every(signal => signal.whyItMatters), 'Every weak signal must explain why it matters.');
assert(empty.limitation.includes('does not verify project progress'), 'The model must state its progress boundary.');

const strong = build({
  updates: [update('update-1', [photo('photo-1')]), update('update-2', [photo('photo-2')])],
  documents: [
    { id: 'inspection-1', name: 'Inspection record', category: 'Inspection', status: 'uploaded', createdAt: '2026-07-09T10:00:00.000Z', updatedAt: '2026-07-10T10:00:00.000Z' },
    { id: 'drawing-1', name: 'Drawing', category: 'Drawing', status: 'uploaded', createdAt: '2026-07-09T10:00:00.000Z', updatedAt: '2026-07-10T10:00:00.000Z' },
  ],
  scheduleItems: [{ id: 'schedule-1', projectName: 'Alpha', taskName: 'Inspect', status: 'Waiting', createdAt: '2026-07-10T10:00:00.000Z' }],
});
assert.strictEqual(strong.strength, 'High');
assert.strictEqual(strong.signals.find(signal => signal.key === 'recent_photos').value, '2 in the last 14 days');
assert.strictEqual(strong.signals.find(signal => signal.key === 'inspection_status').value, 'Evidence recorded recently');
assert.strictEqual(strong.signals.find(signal => signal.key === 'analysis_health').value, 'Healthy');
assert(strong.signals.filter(signal => signal.quality === 'strong').every(signal => signal.whyItMatters === null));

const failed = build({ updates: [update('update-failed', [photo('photo-failed', 'comparison_unavailable')])] });
const analysis = failed.signals.find(signal => signal.key === 'analysis_health');
assert.strictEqual(analysis.quality, 'weak');
assert.match(analysis.whyItMatters, /reliable comparison result/i);
assert(!JSON.stringify(failed).match(/work (is )?(complete|incomplete)|percent complete|progressed/i), 'Evidence scoring must not infer progress.');

const baselineOnly = build({ updates: [update('update-baseline', [
  photo('photo-baseline', 'no_suitable_prior_photo', null),
])] });
assert.notStrictEqual(
  baselineOnly.signals.find(signal => signal.key === 'analysis_health').value,
  'Healthy',
  'A baseline-only photo is saved evidence, not a completed comparison.',
);

const notComparable = build({ updates: [update('update-not-comparable', [
  photo('photo-not-comparable', 'analysis_complete', 'not_comparable'),
])] });
assert.notStrictEqual(
  notComparable.signals.find(signal => signal.key === 'analysis_health').value,
  'Healthy',
  'A completed but not-comparable result must not claim healthy comparison coverage.',
);

const scoped = build({
  updates: [{ ...update('other-update', [photo('other-photo')]), projectName: 'Other' }],
  scheduleItems: [{ id: 'other-schedule', projectName: 'Other', taskName: 'Other', status: 'Complete', createdAt: now }],
});
assert.strictEqual(scoped.signals.find(signal => signal.key === 'recent_updates').score, 0, 'Other-project evidence must be excluded.');
assert.strictEqual(scoped.signals.find(signal => signal.key === 'schedule_freshness').score, 0);

const futureDated = build({
  updates: [{
    ...update('future-update', [{
      ...photo('future-photo'),
      locationCapturedAt: '2026-07-12T12:00:00.000Z',
    }]),
    date: '2026-07-12T12:00:00.000Z',
  }],
  documents: [
    { id: 'future-inspection', name: 'Future inspection', category: 'Inspection', status: 'uploaded', createdAt: '2026-07-12T12:00:00.000Z' },
    { id: 'future-document', name: 'Future drawing', category: 'Drawing', status: 'uploaded', createdAt: '2026-07-12T12:00:00.000Z' },
  ],
  scheduleItems: [{ id: 'future-schedule', projectName: 'Alpha', taskName: 'Future task', status: 'Waiting', createdAt: '2026-07-12T12:00:00.000Z' }],
});
assert.strictEqual(futureDated.signals.find(signal => signal.key === 'recent_updates').score, 0);
assert.strictEqual(futureDated.signals.find(signal => signal.key === 'recent_photos').score, 0);
for (const key of ['inspection_status', 'schedule_freshness', 'document_freshness']) {
  const signal = futureDated.signals.find(item => item.key === key);
  assert.strictEqual(signal.score, 0, `${key} must not treat a future timestamp as fresh.`);
  assert.strictEqual(signal.value, 'Future timestamp needs review');
}

const toleratedClockSkew = build({
  scheduleItems: [{
    id: 'near-future-schedule',
    projectName: 'Alpha',
    taskName: 'Near-future task',
    status: 'Waiting',
    createdAt: '2026-07-11T12:04:00.000Z',
  }],
});
assert.strictEqual(
  toleratedClockSkew.signals.find(signal => signal.key === 'schedule_freshness').score,
  2,
  'Small device clock skew within five minutes should remain usable.',
);

const serialized = JSON.stringify(strong);
for (const forbidden of ['diagnostics', 'signedUrl', 'storagePath', 'rawResponse', 'requestId', 'apiKey']) {
  assert(!serialized.includes(forbidden), `${forbidden} must not enter the evidence-quality model.`);
}

const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const workspace = app.slice(
  app.indexOf('function ProjectWorkspaceScreen'),
  app.indexOf('function SavedUpdatesScreen'),
);
const briefIndex = workspace.indexOf('>Project Snapshot<');
const askIndex = workspace.indexOf('<DAVEAskExperience');
const sourceDetailsIndex = workspace.indexOf('>Source details<');
assert(
  briefIndex >= 0 && sourceDetailsIndex > briefIndex && askIndex > sourceDetailsIndex,
  'Project source details must remain available inside the Project Snapshot before Ask Vitruvius.',
);
assert(workspace.includes('pmBriefing.evidenceCoverage'));
assert(!workspace.includes('evidenceQuality.signals.map'),
  'Diagnostic evidence scoring must not lead the PM-facing Project Snapshot.');

console.log('DAVE Evidence Quality behavioral tests passed.');
