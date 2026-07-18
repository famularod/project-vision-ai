#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const moduleCache = new Map();
const memoryStore = new Map();
const AsyncStorage = {
  getItem: async key => memoryStore.has(key) ? memoryStore.get(key) : null,
  setItem: async (key, value) => {
    memoryStore.set(key, value);
  },
  removeItem: async key => {
    memoryStore.delete(key);
  },
};

function loadTs(relativePath) {
  const normalized = relativePath.endsWith('.ts') ? relativePath : `${relativePath}.ts`;
  const fullPath = path.join(rootDir, normalized);
  if (moduleCache.has(fullPath)) return moduleCache.get(fullPath);
  const source = fs.readFileSync(fullPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const sandbox = {
    exports: {},
    require: specifier => {
      if (specifier === '@react-native-async-storage/async-storage') {
        return { __esModule: true, default: AsyncStorage };
      }
      if (specifier.startsWith('.')) {
        return loadTs(path.join(path.dirname(normalized), specifier));
      }
      return require(specifier);
    },
    console,
    Date,
    Object,
    JSON,
    RegExp,
    Set,
    Map,
    String,
    Number,
    Boolean,
    Error,
    Promise,
    Math,
    Array,
  };
  vm.runInNewContext(compiled.outputText, sandbox, { filename: fullPath });
  moduleCache.set(fullPath, sandbox.exports);
  return sandbox.exports;
}

const photoIntel = loadTs('services/PIEPhotoProgressIntelligence.ts');
const photoStorage = loadTs('services/PIEPhotoProgressIntelligenceStorage.ts');
const reality = loadTs('services/PIERealityModel.ts');

const mode = process.argv[2] || 'all';

function photo(id, caption, date, overrides = {}) {
  return {
    id,
    uri: `file:///photos/${id}.jpg`,
    caption,
    category: overrides.category || 'Update',
    actionRequired: overrides.actionRequired || '',
    actionOwner: overrides.actionOwner || '',
    actionDueDate: '',
    actionStatus: overrides.actionStatus || 'In Progress',
    fileName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    selectedAreaId: 'area-canopy-b',
    selectedAreaName: overrides.areaName || 'Canopy B',
    gpsLatitude: overrides.gpsLatitude ?? 33.1234,
    gpsLongitude: overrides.gpsLongitude ?? -117.1234,
    gpsAccuracy: 12,
    locationCapturedAt: date,
  };
}

function update(id, projectName, date, photos, overrides = {}) {
  return {
    id,
    projectName,
    date,
    photos,
    notes: overrides.notes || '',
    recipients: { contactIds: [] },
    selectedAreaId: 'area-canopy-b',
    selectedAreaName: overrides.areaName || 'Canopy B',
    gpsLatitude: overrides.gpsLatitude ?? 33.1234,
    gpsLongitude: overrides.gpsLongitude ?? -117.1234,
    gpsAccuracy: 12,
    locationCapturedAt: date,
  };
}

function realityModel() {
  return reality.buildPIERealityModel({
    organizationId: 'org-photo',
    projectId: 'project-2375',
    generatedAt: '2026-07-02T12:00:00.000Z',
    objects: [
      {
        id: 'obj-canopy-b',
        organizationId: 'org-photo',
        projectId: 'project-2375',
        type: 'area',
        name: 'Canopy B guardrail',
        projectName: 'Building 2375',
        areaName: 'Canopy B',
        status: 'in_progress',
        confidence: 'high',
        evidenceType: 'schedule',
        evidenceId: 'schedule-guardrail',
        classification: 'fact',
      },
    ],
  });
}

function build(overrides = {}) {
  return photoIntel.buildPIEPhotoProgressIntelligence({
    organizationId: 'org-photo',
    projectId: 'project-2375',
    projectName: 'Building 2375',
    realityModel: realityModel(),
    scheduleItems: overrides.scheduleItems || [],
    updates: overrides.updates || [
      update('u1', 'Building 2375', '2026-06-12T09:00:00.000Z', [
        photo('p1', 'Canopy B platform facing north before guardrail installation.', '2026-06-12T09:00:00.000Z'),
      ]),
      update('u2', 'Building 2375', '2026-07-01T09:00:00.000Z', [
        photo('p2', 'Canopy B platform facing north guardrail and toe board installed.', '2026-07-01T09:00:00.000Z', { actionStatus: 'Closed' }),
      ]),
    ],
    now: new Date('2026-07-02T12:00:00.000Z'),
  });
}

function assertProgressEvent(result) {
  assert(result.sequences.length >= 1, 'sequence should exist');
  assert(result.progressEvents.length >= 1, 'progress event should be created');
  assert(result.qualifiedRealityEvidence.length >= 1, 'qualified reality evidence should be generated');
  assert(result.progressEvents[0].observation, 'observation should be present');
  assert(result.progressEvents[0].inferredMeaning, 'inference should be present');
}

function testSequences() {
  const result = build();
  assert(result.sequences[0].organizationId === 'org-photo', 'sequence should keep organization');
  assert(result.sequences[0].projectId === 'project-2375', 'sequence should keep project');
  assert(result.sequences[0].photoIds.length === 2, 'same subject/viewpoint photos should group');
  assertProgressEvent(result);
}

function testComparison() {
  const result = build();
  const assessment = result.comparabilityAssessments[0];
  assert(['strong_match', 'probable_match'].includes(assessment.classification), 'same viewpoint should be comparable');
  assert(assessment.normalizationOperations.includes('orientation_normalized'), 'normalization operations should be recorded');

  const weak = build({
    updates: [
      update('u1', 'Building 2375', '2026-06-12T09:00:00.000Z', [
        photo('p1', 'Canopy B platform facing north before guardrail installation.', '2026-06-12T09:00:00.000Z'),
      ]),
      update('u2', 'Building 2375', '2026-07-01T09:00:00.000Z', [
        photo('p2', 'Warehouse dock looking south with material staged.', '2026-07-01T09:00:00.000Z', {
          areaName: 'Warehouse Dock',
          gpsLatitude: 33.1999,
          gpsLongitude: -117.1999,
        }),
      ], { areaName: 'Warehouse Dock', gpsLatitude: 33.1999, gpsLongitude: -117.1999 }),
    ],
  });
  assert(weak.progressEvents.length === 0, 'different viewpoints should not create confident progress');
  assert(weak.repeatPhotoGuidance.length >= 1 || weak.sequences.length >= 2, 'weak comparison should avoid unsupported conclusion');
}

function testProgress() {
  const result = build({
    scheduleItems: [{
      id: 'schedule-guardrail',
      projectName: 'Building 2375',
      locationName: 'Canopy B',
      taskName: 'Canopy B guardrail installation',
      startDate: '2026-06-01',
      finishDate: '2026-07-01',
      milestone: 'Platform safety',
      owner: 'Field team',
      contractor: 'Steel contractor',
      percentComplete: 100,
      priority: 'High',
      status: 'Complete',
      notes: '',
      createdAt: '2026-06-01T00:00:00.000Z',
    }],
  });
  assertProgressEvent(result);
  assert(result.progressEstimate.estimatedProgress !== null, 'structured scope may produce bounded estimate');
}

function testVisualJarvis() {
  const incomplete = build({
    scheduleItems: [{
      id: 'schedule-complete',
      projectName: 'Building 2375',
      locationName: 'Canopy B',
      taskName: 'Canopy B guardrail',
      startDate: '2026-06-01',
      finishDate: '2026-07-01',
      milestone: 'Inspection',
      owner: 'Field team',
      contractor: 'Steel contractor',
      percentComplete: 100,
      priority: 'High',
      status: 'Complete',
      notes: '',
      createdAt: '2026-06-01T00:00:00.000Z',
    }],
    updates: [
      update('u1', 'Building 2375', '2026-06-12T09:00:00.000Z', [
        photo('p1', 'Canopy B platform facing north before guardrail installation.', '2026-06-12T09:00:00.000Z'),
      ]),
      update('u2', 'Building 2375', '2026-07-01T09:00:00.000Z', [
        photo('p2', 'Canopy B platform facing north guardrail still in progress, incomplete.', '2026-07-01T09:00:00.000Z'),
      ]),
    ],
  });
  assert(incomplete.visualJarvisValidation.outcome !== 'supported' || incomplete.progressEvents[0].contradictingEvidenceIds.length > 0, 'JARVIS should validate contradictions');

  const regression = build({
    updates: [
      update('u1', 'Building 2375', '2026-06-12T09:00:00.000Z', [
        photo('p1', 'Canopy B platform facing north guardrail installed.', '2026-06-12T09:00:00.000Z'),
      ]),
      update('u2', 'Building 2375', '2026-07-01T09:00:00.000Z', [
        photo('p2', 'Canopy B platform facing north missing guardrail and safety removed.', '2026-07-01T09:00:00.000Z'),
      ]),
    ],
  });
  assert(regression.regressionCandidates.length >= 1, 'regression candidate should be created');
  assert(regression.regressionCandidates[0].reviewStatus === 'human_review_required', 'regression requires validation');
}

function testRepeatGuidance() {
  const obstructed = build({
    updates: [
      update('u1', 'Building 2375', '2026-06-12T09:00:00.000Z', [
        photo('p1', 'Canopy B platform facing north guardrail started.', '2026-06-12T09:00:00.000Z'),
      ]),
      update('u2', 'Building 2375', '2026-07-01T09:00:00.000Z', [
        photo('p2', 'Canopy B platform facing north blocked by stored material.', '2026-07-01T09:00:00.000Z'),
      ]),
    ],
  });
  assert(obstructed.repeatPhotoGuidance.length >= 1, 'obstruction should request better photo');
  assert(/unobstructed|same/.test(obstructed.repeatPhotoGuidance[0].instruction), 'guidance should be targeted');
}

function testUi() {
  const home = fs.readFileSync(path.join(rootDir, 'App.tsx'), 'utf8');
  const capture = home;
  const bottomNav = fs.readFileSync(path.join(rootDir, 'components/app-bottom-tabs.tsx'), 'utf8');
  const forbidden = ['Compare Photos', 'Analyze Progress', 'Run Visual Review', 'Calculate Progress', 'Validate Image'];
  forbidden.forEach(label => {
    assert(!home.includes(label) && !capture.includes(label), `${label} should not appear as a routine UI control`);
  });
  assert(home.includes('Visible progress detected') || home.includes('conciseProgressCard'), 'Home should expose concise progress card');
  assert(capture.includes('Repeat photo needed'), 'Capture should expose repeat-photo guidance');
  assert(!bottomNav.includes('Photo Progress'), 'No new permanent tab should be added');
}

function testEdgeCases() {
  const duplicate = build({
    updates: [
      update('u1', 'Building 2375', '2026-06-12T09:00:00.000Z', [
        photo('p1', 'Canopy B platform facing north guardrail started.', '2026-06-12T09:00:00.000Z'),
      ]),
      update('u2', 'Building 2375', '2026-06-12T09:00:00.000Z', [
        photo('p2', 'Canopy B platform facing north guardrail started.', '2026-06-12T09:00:00.000Z', { actionStatus: 'In Progress' }),
      ]),
    ],
  });
  assert(duplicate.progressEvents.length === 0, 'duplicate photo should not create false progress');

  const wrongProject = photoIntel.buildPIEPhotoProgressIntelligence({
    organizationId: 'org-photo',
    projectId: 'project-2375',
    projectName: 'Building 2375',
    updates: [
      update('u1', 'Building 2375', '2026-06-12T09:00:00.000Z', [
        photo('p1', 'Canopy B platform facing north guardrail started.', '2026-06-12T09:00:00.000Z'),
      ]),
      update('u2', 'Building 9999', '2026-07-01T09:00:00.000Z', [
        photo('p2', 'Canopy B platform facing north guardrail installed.', '2026-07-01T09:00:00.000Z'),
      ]),
    ],
  });
  assert(wrongProject.progressEvents.length === 0, 'wrong project photo should not affect sequence');

  const lighting = build({
    updates: [
      update('u1', 'Building 2375', '2026-06-12T09:00:00.000Z', [
        photo('p1', 'Canopy B platform facing north guardrail started.', '2026-06-12T09:00:00.000Z'),
      ]),
      update('u2', 'Building 2375', '2026-07-01T09:00:00.000Z', [
        photo('p2', 'Canopy B platform facing north guardrail started dark glare shadow.', '2026-07-01T09:00:00.000Z'),
      ]),
    ],
  });
  assert(!lighting.progressEvents.some(event => event.progressDirection === 'progressed'), 'lighting-only difference should not create progress');

  const partial = build({
    updates: [
      update('u1', 'Building 2375', '2026-06-12T09:00:00.000Z', [
        photo('p1', 'Canopy B platform facing north before guardrail installation.', '2026-06-12T09:00:00.000Z'),
      ]),
      update('u2', 'Building 2375', '2026-07-01T09:00:00.000Z', [
        photo('p2', 'Canopy B platform facing north guardrail rough-in in progress.', '2026-07-01T09:00:00.000Z'),
      ]),
    ],
  });
  assert(partial.progressEstimate.estimatedProgress === null, 'partial progress without structured scope should not invent percentage');
}

async function testPersistence() {
  const result = build();
  await photoStorage.clearPhotoProgressIntelligenceForTesting('org-photo', 'project-2375');
  const saved = await photoStorage.savePhotoProgressIntelligence(result);
  assert(saved.currentAnalysis.progressEvents.length === result.progressEvents.length, 'current photo analysis should persist');
  assert(saved.sequences.length >= result.sequences.length, 'photo sequences should persist');
  assert(saved.cacheEntries.length >= result.cacheEntries.length, 'input signatures should persist');
  const hydrated = await photoStorage.loadLatestPhotoProgressIntelligence('org-photo', 'project-2375');
  assert(hydrated.progressEvents[0].id === result.progressEvents[0].id, 'hydrated analysis should match saved result');
  const otherProject = await photoStorage.loadLatestPhotoProgressIntelligence('org-photo', 'other-project');
  assert(otherProject === null, 'photo intelligence storage must be project isolated');
}

const tests = {
  'photo-sequences': testSequences,
  'photo-comparison': testComparison,
  'photo-progress': testProgress,
  'visual-jarvis': testVisualJarvis,
  'repeat-photo-guidance': testRepeatGuidance,
  'photo-progress-ui': testUi,
  persistence: testPersistence,
  edge: testEdgeCases,
};

async function run(selected) {
  if (selected === 'all') {
    for (const [name, test] of Object.entries(tests)) {
      await test();
      console.log(`PASS ${name}`);
    }
    return;
  }
  const test = tests[selected];
  if (!test) {
    throw new Error(`Unknown photo progress test mode: ${selected}`);
  }
  await test();
  console.log(`PASS ${selected}`);
}

run(mode).catch(error => {
  console.error(error);
  process.exit(1);
});
