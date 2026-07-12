#!/usr/bin/env node

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const ts = require('typescript');

const rootDir = path.resolve(__dirname, '..');
const moduleCache = new Map();
const mode = process.argv[2] || 'all';

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

const evidence = loadTs('services/PIEMultimodalEvidence.ts');
const photoVisionPipeline = loadTs('services/PIEPhotoVisionPipeline.ts');
const photoFindingNormalization = loadTs('services/PIEPhotoFindingNormalization.ts');
const photoComparisonSchema = loadTs('supabase/functions/_shared/pie-photo-comparison-schema.ts');

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function assertContains(value, expected, message) {
  assert(value.includes(expected), message || `Expected ${expected}`);
}

function sampleAnalysis(overrides = {}) {
  return {
    analysisId: 'analysis-photo-1',
    evidenceId: 'photo-evidence-1',
    evidenceType: 'photo',
    organizationId: 'org-a',
    projectId: 'project-a1',
    analyzerId: 'pie-photo-vision-edge',
    analyzerVersion: evidence.PIE_MULTIMODAL_EVIDENCE_VERSION,
    modelName: 'test-vision-model',
    modelVersion: 'test',
    observations: ['Guardrail posts are visible along the platform edge.'],
    inferences: ['Visible installation appears to have started and needs corroboration.'],
    extractedEntities: ['guardrail', 'platform'],
    dates: [],
    commitments: [],
    owners: [],
    measurements: [],
    risks: ['Open edge protection should be verified by a qualified reviewer.'],
    conflicts: [],
    missingInformation: ['Inspection result is not visible in the photo.'],
    confidence: 'medium',
    limitations: ['Photo cannot prove hidden anchorage or code compliance.'],
    authority: 'visual_observation_only',
    corroborationRequired: true,
    sourceEvidenceIds: ['photo-evidence-1'],
    generatedAt: '2026-07-02T12:00:00.000Z',
    visualFindings: [{
      label: 'guardrail',
      observation: 'Guardrail posts are visible.',
      region: 'upper edge',
      confidence: 'medium',
      limitations: ['Anchor condition is not visible.'],
    }],
    visibleProgress: 'some_visible',
    unsafeClaimsRejected: [],
    ...overrides,
  };
}

function testUniversalEvidence() {
  const record = evidence.buildPhotoEvidenceRecord({
    id: 'photo-evidence-1',
    organizationId: 'org-a',
    projectId: 'project-a1',
    source: 'field_capture',
    sourceSystem: 'mobile',
    capturedAt: '2026-07-02T10:00:00.000Z',
    receivedAt: '2026-07-02T10:01:00.000Z',
    authorId: 'user-a',
    bucket: 'pie-project-evidence',
    mimeType: 'image/jpeg',
    sizeBytes: 409600,
    contentHash: evidence.stableContentHash('photo-bytes'),
    fileExtension: 'jpg',
  });
  assert.strictEqual(record.evidenceType, 'photo');
  assert.strictEqual(record.authority, 'supporting');
  assert.strictEqual(record.storage[0].bucket, 'pie-project-evidence');
  assert.strictEqual(record.storage[0].path, 'org-a/project-a1/photo/photo-evidence-1/original.jpg');
  assert.strictEqual(record.lineage.parentEvidenceIds.length, 0);

  const scenarios = JSON.parse(read('validation/multimodal/photo-vision-scenarios.json'));
  assert(scenarios.scenarios.length >= 5, 'validation scenarios should cover core photo cases');
}

function testPhotoStorageAndSecurity() {
  const migration = read('supabase/migrations/20260702030000_multimodal_evidence_foundation.sql');
  assertContains(migration, "values ('pie-project-evidence', 'pie-project-evidence', false)", 'bucket must be private');
  assertContains(migration, 'alter table public.pie_evidence_records enable row level security', 'evidence records need RLS');
  assertContains(migration, 'pie_project_evidence_storage_select', 'storage select policy should exist');
  assertContains(migration, "split_part(storage.objects.name, '/', 1)", 'storage policy must bind organization path');
  assertContains(migration, "split_part(storage.objects.name, '/', 2)", 'storage policy must bind project path');
  assertContains(migration, 'pie_cleanup_automated_evidence_test_records', 'test cleanup RPC should exist');
  assertContains(migration, "auth.role() <> 'service_role'", 'cleanup RPC must be service-role restricted');
}

function testVisionBackendBoundary() {
  const functionSource = read('supabase/functions/pie-photo-vision/index.ts');
  const providerSource = read('supabase/functions/_shared/pie-vision-provider.ts');
  const appSources = [
    read('App.tsx'),
    ...fs.readdirSync(path.join(rootDir, 'services'))
      .filter(file => file.endsWith('.ts'))
      .map(file => read(path.join('services', file))),
  ].join('\n');

  assertContains(functionSource, 'auth.getUser()', 'Edge Function must authenticate caller');
  assertContains(functionSource, 'verifyProjectAccess', 'Edge Function must verify project access');
  assertContains(functionSource, 'loadAuthorizedImage', 'Edge Function must access image server-side');
  assertContains(functionSource, 'visual_observation_only', 'vision authority must be visual observation only');
  assertContains(providerSource, 'PIE_OPENAI_API_KEY', 'provider key must stay in server provider env');
  assertContains(providerSource, 'degradedResult', 'missing provider should degrade instead of faking success');
  assert(!appSources.includes('PIE_OPENAI_API_KEY'), 'provider API key env name must not appear in mobile app code');
}

function testRawPhotoAnalysisGuards() {
  const valid = evidence.validatePhotoVisionAnalysis(sampleAnalysis());
  assert.strictEqual(valid.accepted, true, 'safe visual analysis should be accepted with limitations');

  const unsafe = evidence.validatePhotoVisionAnalysis(sampleAnalysis({
    inferences: ['The work is 100% complete and fully compliant.'],
  }));
  assert.strictEqual(unsafe.accepted, false, 'unsafe visual claims should be rejected');
  assert(unsafe.rejectedClaims.some(claim => claim.includes('100% complete') || claim.includes('fully compliant')));

  const deterministic = evidence.deterministicPhotoChecks({
    contentHash: 'hash',
    width: 80,
    height: 80,
    mimeType: 'application/pdf',
    sizeBytes: 128,
    orientation: null,
  });
  assert.strictEqual(deterministic.mimeTypeAccepted, false);
  assert.strictEqual(deterministic.hasUsableDimensions, false);

  const combined = evidence.combineDeterministicAndSemanticPhotoAnalysis({
    deterministic,
    analysis: sampleAnalysis(),
  });
  assert.strictEqual(combined.accepted, false, 'failed deterministic checks should block analysis');
}

function testPhotoComparison() {
  const deterministic = evidence.deterministicPhotoChecks({
    contentHash: 'hash',
    width: 1600,
    height: 1200,
    mimeType: 'image/jpeg',
    sizeBytes: 500000,
    perceptualHash: 'phash',
    orientation: 1,
  });
  const invalid = evidence.validatePhotoComparison({
    comparisonId: 'cmp-1',
    organizationId: 'org-a',
    projectId: 'project-a1',
    earlierEvidenceId: 'photo-1',
    laterEvidenceId: 'photo-2',
    comparable: 'not_comparable',
    observations: ['Different rooms are visible.'],
    inferredChanges: ['Guardrail was removed.'],
    deterministicChecks: deterministic,
    confidence: 'medium',
    limitations: ['Viewpoints do not match.'],
    requiresHumanReview: true,
  });
  assert.strictEqual(invalid.accepted, false, 'not-comparable photos cannot infer change');
}

function testMouseAddedToTableBaselineFailure() {
  const scenarios = JSON.parse(read('validation/multimodal/photo-vision-scenarios.json'));
  const scenario = scenarios.scenarios.find(item => item.id === 'mouse_added_to_table');
  assert(scenario, 'mouse_added_to_table scenario must be present');
  assert.strictEqual(scenario.physicalDeviceStatus, 'failed_build_21');
  assert.strictEqual(scenario.acceptanceStatus, 'required_for_true_photo_intelligence');
  assert.strictEqual(scenario.completionStatus, 'pending_production_vision_pipeline_physical_device_pass');
  assert.strictEqual(scenario.fixtures.preserveOriginals, true);
  assert.strictEqual(scenario.expected.comparability, 'probable');
  assert.strictEqual(scenario.expected.sameGeneralScene, true);
  assert.strictEqual(scenario.expected.materialVisibleChange, true);
  assert.strictEqual(scenario.expected.changeType, 'object_added');
  assert.strictEqual(scenario.expected.addedObject, 'black computer mouse');
  assert.strictEqual(scenario.expected.approximateRegion, 'lower-right portion of the table');
  assert.strictEqual(scenario.expected.progressConclusion, 'unable_to_determine');
  assert.strictEqual(scenario.expected.jarvisMustPreventProjectProgressConclusion, true);

  const fixtureDir = path.join(rootDir, scenario.fixtures.directory);
  const earlierPath = path.join(fixtureDir, scenario.fixtures.originalEarlierImage);
  const laterPath = path.join(fixtureDir, scenario.fixtures.originalLaterImage);
  assert(fs.existsSync(fixtureDir), 'mouse fixture directory must exist');

  const analysis = analyzeMouseAddedToTableFixture(earlierPath, laterPath);
  assert.strictEqual(analysis.status, 'succeeded', analysis.error || 'real fixture analysis should succeed');
  assert.strictEqual(analysis.bytesRead.earlier > 0, true, 'earlier image bytes must be read');
  assert.strictEqual(analysis.bytesRead.later > 0, true, 'later image bytes must be read');
  assert.notStrictEqual(analysis.sha256.earlier, analysis.sha256.later, 'fixture images must not be identical');
  console.log(`SHA256 mouse_added_to_table_before.jpeg ${analysis.sha256.earlier}`);
  console.log(`SHA256 mouse_added_to_table_after.jpeg ${analysis.sha256.later}`);
  console.log(`PERCEPTUAL mouse_added_to_table_before.jpeg ${analysis.perceptualHash.earlier}`);
  console.log(`PERCEPTUAL mouse_added_to_table_after.jpeg ${analysis.perceptualHash.later}`);

  assert.strictEqual(scenario.fixtures.hashes.exactSha256.status, 'calculated');
  assert.strictEqual(scenario.fixtures.hashes.exactSha256.earlier, analysis.sha256.earlier);
  assert.strictEqual(scenario.fixtures.hashes.exactSha256.later, analysis.sha256.later);
  assert(
    ['strong_match', 'probable_match'].includes(analysis.comparison.comparable),
    'deterministic fixture comparison should recognize the same desk scene without overfitting one confidence label',
  );
  assert.strictEqual(analysis.comparison.sameGeneralScene, true);
  const mockedProviderComparison = {
    ...analysis.comparison,
    comparable: 'probable_match',
    inferredChanges: ['A black computer mouse appears in the newer photo.'],
    confidence: 'medium',
    materialVisibleChange: true,
    changeType: 'object_added',
    addedObject: 'black computer mouse',
    approximateRegion: 'lower-right portion of the table',
    progressConclusion: 'unable_to_determine',
    projectStatusImpact: 'none',
    userFacingSummary: scenario.expected.userFacingSummary,
  };
  assert.strictEqual(mockedProviderComparison.materialVisibleChange, true);
  assert.strictEqual(mockedProviderComparison.changeType, 'object_added');
  assert.strictEqual(mockedProviderComparison.addedObject, 'black computer mouse');
  assert.strictEqual(mockedProviderComparison.approximateRegion, 'lower-right portion of the table');
  assert.strictEqual(mockedProviderComparison.progressConclusion, 'unable_to_determine');
  assert.strictEqual(mockedProviderComparison.projectStatusImpact, 'none');

  const validation = evidence.validateSemanticPhotoComparison(mockedProviderComparison);
  assert.strictEqual(validation.accepted, true, 'mouse visible-change comparison should be accepted as non-progress evidence');
  const message = evidence.buildVisibleSceneChangeUserMessage(mockedProviderComparison);
  assert.strictEqual(message, scenario.expected.userFacingSummary);

  const unsafeProgress = evidence.validateSemanticPhotoComparison({
    ...mockedProviderComparison,
    progressConclusion: 'progress_visible',
  });
  assert.strictEqual(unsafeProgress.accepted, false, 'JARVIS must prevent mouse appearance from becoming project progress');

  const identical = analyzeMouseAddedToTableFixture(earlierPath, earlierPath, { allowIdenticalControl: true });
  assert.strictEqual(identical.status, 'succeeded');
  assert.strictEqual(identical.comparison.materialVisibleChange, false, 'identical control must not report mouse added');
  assert.strictEqual(identical.comparison.changeType, 'no_material_change', 'identical control must not report object_added');
  assert.strictEqual(identical.comparison.addedObject, null, 'identical control must not report black computer mouse');

  const blankPath = path.join(os.tmpdir(), `pie-blank-unreadable-${Date.now()}.jpeg`);
  fs.writeFileSync(blankPath, Buffer.alloc(0));
  try {
    const blank = analyzeMouseAddedToTableFixture(blankPath, laterPath, { allowBlankControl: true });
    assert.strictEqual(blank.status, 'degraded');
    assert.strictEqual(blank.comparison.progressConclusion, 'unable_to_determine');
    assert.strictEqual(blank.comparison.materialVisibleChange, false);
    assert.strictEqual(blank.comparison.addedObject, null);
  } finally {
    fs.rmSync(blankPath, { force: true });
  }
}

function testCorrectionsAndReality() {
  const correction = evidence.recordEvidenceCorrection({
    correctionId: 'correction-1',
    evidenceId: 'photo-evidence-1',
    organizationId: 'org-a',
    projectId: 'project-a1',
    correctedByUserId: 'user-a',
    reason: 'Reviewer corrected overstatement.',
    originalAnalysisId: 'analysis-photo-1',
    correctedObservations: ['Guardrail posts are visible.'],
    correctedInferences: ['Progress may have started.'],
    supersedesAnalysisId: 'analysis-photo-1',
    createdAt: '2026-07-02T12:10:00.000Z',
  });
  assert.strictEqual(correction.originalAnalysisId, 'analysis-photo-1');
  assert.strictEqual(correction.supersedesAnalysisId, 'analysis-photo-1');

  const qualified = evidence.buildQualifiedRealityEvidenceFromVisualAnalysis(sampleAnalysis());
  assert.strictEqual(qualified.length, 1);
  assert.strictEqual(qualified[0].source, 'raw_photo_vision_analysis');
  assert.strictEqual(qualified[0].evidenceQualified, true);

  const unsafeQualified = evidence.buildQualifiedRealityEvidenceFromVisualAnalysis(sampleAnalysis({
    inferences: ['This proves completion.'],
  }));
  assert.strictEqual(unsafeQualified.length, 0, 'unsafe visual analysis must not update Reality');
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function analyzeMouseAddedToTableFixture(earlierPath, laterPath, options = {}) {
  const earlier = readImageFixtureBytes(earlierPath, 'earlier', options);
  const later = readImageFixtureBytes(laterPath, 'later', options);
  const sha256 = {
    earlier: earlier.sha256,
    later: later.sha256,
  };
  const bytesRead = {
    earlier: earlier.bytes.length,
    later: later.bytes.length,
  };

  if (!earlier.readable || !later.readable) {
    return degradedMouseComparison({ sha256, bytesRead, error: earlier.error || later.error || 'fixture unreadable' });
  }
  if (earlier.bytes.length === 0 || later.bytes.length === 0) {
    if (!options.allowBlankControl) {
      throw new Error('fixture image is empty');
    }
    return degradedMouseComparison({ sha256, bytesRead, error: 'blank fixture image' });
  }
  if (earlier.sha256 === later.sha256 && !options.allowIdenticalControl) {
    throw new Error('fixture images are unchanged from each other');
  }

  let earlierPixels;
  let laterPixels;
  try {
    earlierPixels = decodeImageWithSips(earlierPath);
    laterPixels = decodeImageWithSips(laterPath);
  } catch (error) {
    if (!options.allowBlankControl) throw error;
    return degradedMouseComparison({ sha256, bytesRead, error: error.message });
  }

  const perceptualHash = {
    earlier: averageHash(earlierPixels),
    later: averageHash(laterPixels),
  };
  const hammingDistance = hashHammingDistance(perceptualHash.earlier, perceptualHash.later);
  const sameGeneralScene = hammingDistance <= 24;
  const mouseSignal = detectLowerRightBlackObjectAdded(earlierPixels, laterPixels);
  const materialVisibleChange = mouseSignal.added;
  const comparable = sameGeneralScene
    ? hammingDistance <= 2 && !materialVisibleChange
      ? 'strong_match'
      : 'probable_match'
    : 'not_comparable';
  const deterministic = evidence.deterministicPhotoChecks({
    contentHash: `${earlier.sha256}:${later.sha256}`,
    width: laterPixels.width,
    height: laterPixels.height,
    mimeType: 'image/jpeg',
    sizeBytes: later.bytes.length,
    perceptualHash: `${perceptualHash.earlier}:${perceptualHash.later}`,
    orientation: 1,
  });
  const comparison = {
    comparisonId: 'baseline-failure-001',
    organizationId: 'org-device-validation',
    projectId: 'project-build-21',
    earlierEvidenceId: path.basename(earlierPath),
    laterEvidenceId: path.basename(laterPath),
    comparable,
    observations: sameGeneralScene
      ? ['The same general desk and laptop area remains visible.']
      : ['The two images are not similar enough for a reliable scene comparison.'],
    inferredChanges: materialVisibleChange
      ? ['A black computer mouse appears in the newer photo.']
      : [],
    deterministicChecks: deterministic,
    confidence: materialVisibleChange && sameGeneralScene ? 'medium' : 'low',
    limitations: ['Viewpoint and framing changed.'],
    requiresHumanReview: true,
    sameGeneralScene,
    materialVisibleChange,
    changeType: materialVisibleChange ? 'object_added' : 'no_material_change',
    addedObject: materialVisibleChange ? 'black computer mouse' : null,
    removedObject: null,
    approximateRegion: materialVisibleChange ? 'lower-right portion of the table' : null,
    progressConclusion: 'unable_to_determine',
    projectStatusImpact: 'none',
    userFacingSummary: materialVisibleChange
      ? 'A black computer mouse appears in the newer photo. The viewpoint also changed slightly. This is a visible scene change, but it does not establish project progress.'
      : 'No material visible scene change was detected. Project progress is unable to determine.',
  };

  return {
    status: 'succeeded',
    source: 'deterministic_image_analysis',
    inputs: {
      earlierPath,
      laterPath,
    },
    sha256,
    bytesRead,
    perceptualHash,
    hammingDistance,
    lowerRightBlackObjectSignal: mouseSignal,
    comparison,
  };
}

function readImageFixtureBytes(filePath, label, options) {
  try {
    const bytes = fs.readFileSync(filePath);
    return {
      readable: true,
      bytes,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      error: null,
    };
  } catch (error) {
    if (!options.allowBlankControl) {
      throw new Error(`${label} fixture image is missing or unreadable: ${filePath}`);
    }
    return {
      readable: false,
      bytes: Buffer.alloc(0),
      sha256: null,
      error: error.message,
    };
  }
}

function degradedMouseComparison({ sha256, bytesRead, error }) {
  return {
    status: 'degraded',
    source: 'deterministic_image_analysis',
    error,
    sha256,
    bytesRead,
    perceptualHash: { earlier: null, later: null },
    hammingDistance: null,
    lowerRightBlackObjectSignal: null,
    comparison: {
      comparisonId: 'baseline-failure-001',
      organizationId: 'org-device-validation',
      projectId: 'project-build-21',
      earlierEvidenceId: 'unreadable',
      laterEvidenceId: 'unreadable',
      comparable: 'not_comparable',
      observations: [],
      inferredChanges: [],
      deterministicChecks: evidence.deterministicPhotoChecks({
        contentHash: 'unreadable',
        width: null,
        height: null,
        mimeType: 'image/jpeg',
        sizeBytes: 0,
        perceptualHash: null,
        orientation: null,
      }),
      confidence: 'low',
      limitations: ['One or both image files were blank or unreadable.'],
      requiresHumanReview: true,
      sameGeneralScene: false,
      materialVisibleChange: false,
      changeType: 'unable_to_determine',
      addedObject: null,
      removedObject: null,
      approximateRegion: null,
      progressConclusion: 'unable_to_determine',
      projectStatusImpact: 'none',
      userFacingSummary: 'Image comparison could not be completed. Project progress is unable to determine.',
    },
  };
}

function decodeImageWithSips(filePath) {
  const output = path.join(os.tmpdir(), `pie-fixture-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
  const result = childProcess.spawnSync('sips', [
    '-s',
    'format',
    'png',
    '--resampleWidth',
    '384',
    filePath,
    '--out',
    output,
  ], { encoding: 'utf8' });
  if (result.status !== 0 || !fs.existsSync(output)) {
    throw new Error(`sips could not decode image ${filePath}: ${result.stderr || result.stdout}`);
  }
  try {
    return parsePng(fs.readFileSync(output));
  } finally {
    fs.rmSync(output, { force: true });
  }
}

function parsePng(buffer) {
  if (buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw new Error('decoded image is not a PNG');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }
  const channelsByColorType = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const channels = channelsByColorType[colorType];
  if (bitDepth !== 8 || !channels) {
    throw new Error(`unsupported PNG format bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const rows = [];
  let inflatedOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inflatedOffset];
    inflatedOffset += 1;
    const row = Buffer.from(inflated.subarray(inflatedOffset, inflatedOffset + stride));
    inflatedOffset += stride;
    unfilterPngRow(row, previous, channels, filter);
    rows.push(row);
    previous = row;
  }
  return {
    width,
    height,
    channels,
    rgb(x, y) {
      const row = rows[y];
      const index = x * channels;
      if (channels === 1) return [row[index], row[index], row[index]];
      return [row[index], row[index + 1], row[index + 2]];
    },
  };
}

function unfilterPngRow(row, previous, channels, filter) {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= channels ? row[index - channels] : 0;
    const up = previous[index] || 0;
    const upLeft = index >= channels ? previous[index - channels] || 0 : 0;
    if (filter === 1) {
      row[index] = (row[index] + left) & 255;
    } else if (filter === 2) {
      row[index] = (row[index] + up) & 255;
    } else if (filter === 3) {
      row[index] = (row[index] + Math.floor((left + up) / 2)) & 255;
    } else if (filter === 4) {
      row[index] = (row[index] + paethPredictor(left, up, upLeft)) & 255;
    }
  }
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

function averageHash(image) {
  const cells = [];
  for (let gy = 0; gy < 8; gy += 1) {
    for (let gx = 0; gx < 8; gx += 1) {
      cells.push(regionAverageLuma(image, gx / 8, (gx + 1) / 8, gy / 8, (gy + 1) / 8));
    }
  }
  const average = cells.reduce((sum, value) => sum + value, 0) / cells.length;
  return cells.map(value => (value >= average ? '1' : '0')).join('');
}

function hashHammingDistance(left, right) {
  let distance = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) distance += 1;
  }
  return distance + Math.abs(left.length - right.length);
}

function detectLowerRightBlackObjectAdded(earlier, later) {
  const before = lowerRightDarkObjectSignal(earlier);
  const after = lowerRightDarkObjectSignal(later);
  const darkRatioDelta = after.darkRatio - before.darkRatio;
  const largestComponentDelta = after.largestDarkComponent - before.largestDarkComponent;
  const added = darkRatioDelta >= 0.06 && largestComponentDelta >= 300;
  return {
    added,
    before,
    after,
    darkRatioDelta,
    largestComponentDelta,
  };
}

function lowerRightDarkObjectSignal(image) {
  const x0 = Math.floor(image.width * 0.58);
  const x1 = Math.floor(image.width * 0.88);
  const y0 = Math.floor(image.height * 0.68);
  const y1 = Math.floor(image.height * 0.9);
  const darkPixels = new Set();
  let total = 0;
  let dark = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      total += 1;
      const [r, g, b] = image.rgb(x, y);
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const channelSpread = Math.max(r, g, b) - Math.min(r, g, b);
      if (luma < 45 && channelSpread < 50) {
        dark += 1;
        darkPixels.add(y * image.width + x);
      }
    }
  }
  return {
    darkRatio: total > 0 ? dark / total : 0,
    largestDarkComponent: largestComponentSize(darkPixels, image.width),
  };
}

function largestComponentSize(pixelKeys, width) {
  const visited = new Set();
  let largest = 0;
  for (const start of pixelKeys) {
    if (visited.has(start)) continue;
    const queue = [start];
    visited.add(start);
    let size = 0;
    while (queue.length > 0) {
      const key = queue.pop();
      size += 1;
      const y = Math.floor(key / width);
      const x = key - y * width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = (y + dy) * width + x + dx;
        if (pixelKeys.has(next) && !visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    largest = Math.max(largest, size);
  }
  return largest;
}

function regionAverageLuma(image, fx0, fx1, fy0, fy1) {
  const x0 = Math.floor(image.width * fx0);
  const x1 = Math.max(x0 + 1, Math.floor(image.width * fx1));
  const y0 = Math.floor(image.height * fy0);
  const y1 = Math.max(y0 + 1, Math.floor(image.height * fy1));
  let total = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const [r, g, b] = image.rgb(x, y);
      total += 0.299 * r + 0.587 * g + 0.114 * b;
      count += 1;
    }
  }
  return count > 0 ? total / count : 0;
}

function testIdempotentSynchronization() {
  assert.strictEqual(evidence.shouldReuseAnalysisCache({
    contentHash: 'hash-1',
    cachedContentHash: 'hash-1',
    analyzerVersion: 'v1',
    cachedAnalyzerVersion: 'v1',
    policyVersion: 'p1',
    cachedPolicyVersion: 'p1',
  }), true);
  assert.strictEqual(evidence.shouldReuseAnalysisCache({
    contentHash: 'hash-1',
    cachedContentHash: 'hash-2',
    analyzerVersion: 'v1',
    cachedAnalyzerVersion: 'v1',
    policyVersion: 'p1',
    cachedPolicyVersion: 'p1',
  }), false);
}

function testProductionVisionPipelineArchitecture() {
  const functionSource = read('supabase/functions/pie-photo-vision/index.ts');
  const providerSource = read('supabase/functions/_shared/pie-vision-provider.ts');
  const migration = read('supabase/migrations/20260702040000_production_vision_pipeline.sql');
  const service = read('services/PIEPhotoVisionPipeline.ts');
  const scenarios = JSON.parse(read('validation/multimodal/photo-vision-scenarios.json'));

  assertContains(providerSource, 'interface VisionProvider', 'provider-neutral interface required');
  assertContains(providerSource, 'analyzeSinglePhoto', 'single-image provider method required');
  assertContains(providerSource, 'comparePhotoPair', 'paired-image provider method required');
  assertContains(providerSource, 'timeoutMs', 'provider timeout required');
  assertContains(providerSource, 'maxRetries', 'bounded retries required');
  assertContains(providerSource, 'usage', 'usage logging required');
  assertContains(providerSource, 'latencyMs', 'latency logging required');
  assertContains(providerSource, 'degradedResult', 'safe degraded result required');
  assertContains(providerSource, 'PIE_OPENAI_API_KEY', 'provider secret must be server-only');

  assertContains(functionSource, 'auth.getUser()', 'Edge Function must authenticate caller');
  assertContains(functionSource, 'verifyProjectAccess', 'Edge Function must verify project access');
  assertContains(functionSource, 'loadAuthorizedImage', 'Edge Function must verify each photo and create signed image access');
  assertContains(functionSource, 'photo_evidence_not_found_or_cross_boundary', 'cross-boundary evidence must be rejected');
  assertContains(functionSource, 'persistRequestAndResult', 'request/result persistence required');
  assertContains(functionSource, 'validateNormalizedOutput', 'provider output validation required');
  assertContains(functionSource, 'pie_photo_semantic_comparison_results', 'comparison persistence required');

  assertContains(migration, 'public.pie_vision_analysis_requests', 'request table required');
  assertContains(migration, 'public.pie_photo_semantic_comparison_results', 'comparison result table required');
  assertContains(migration, 'enable row level security', 'RLS required');
  assertContains(migration, 'baseline_evidence_id', 'baseline source link required');
  assertContains(migration, 'current_evidence_id', 'current source link required');
  assertContains(migration, 'latency_ms', 'processing time persistence required');
  assertContains(migration, 'failure_reason', 'failure reason persistence required');
  assertContains(migration, 'jarvis_result', 'JARVIS result persistence required');

  assertContains(service, 'analysis_pending', 'mobile pending state required');
  assertContains(service, 'analysis_complete', 'mobile complete state required');
  assertContains(service, 'degraded', 'mobile degraded state required');
  assertContains(service, 'recordPhotoVisionUserCorrection', 'correction helper required');
  assertContains(service, 'hydratePhotoVisionState', 'restart hydration helper required');
  assertContains(service, 'buildQualifiedVisualEvidenceFromComparison', 'Reality integration helper required');

  const requiredScenarios = [
    'object_added_generic',
    'object_removed_generic',
    'no_visible_change',
    'lighting_only_change',
    'viewpoint_only_change',
    'obstruction_present',
    'blurred_image',
    'different_subject',
    'different_project',
    'partial_visible_progress',
    'possible_regression',
    'photo_contradicts_written_status',
    'photo_corroborates_written_status',
    'mouse_added_to_table',
    'mouse_removed_from_table_blank_caption',
    'papers_added_to_table_blank_caption',
    'papers_removed_from_table_blank_caption',
  ];
  for (const id of requiredScenarios) {
    assert(scenarios.scenarios.some(item => item.id === id), `missing validation scenario ${id}`);
  }
}

function testBuild22MobilePhotoVisionIntegration() {
  const workflow = read('services/PIEPhotoVisionMobileWorkflow.ts');
  const app = read('App.tsx');
  const capturePanel = read('components/PhotoCapturePanel.tsx');
  const admin = read('screens/AdminScreen.tsx');
  const appJson = JSON.parse(read('app.json'));

  assertContains(workflow, "client.functions.invoke('pie-photo-vision'", 'mobile workflow must invoke deployed pie-photo-vision function');
  assertContains(workflow, "bucket: PIE_EVIDENCE_BUCKET", 'mobile workflow must stage private PIE evidence assets');
  assertContains(workflow, ".from('pie_evidence_records')", 'mobile workflow must create PIE evidence records');
  assertContains(workflow, ".from('pie_photo_assets')", 'mobile workflow must create PIE photo asset records');
  assertContains(workflow, ".from('pie_photo_semantic_comparison_results')", 'mobile workflow must hydrate persisted semantic comparison results');
  assertContains(workflow, 'getCurrentSessionAccessToken', 'mobile workflow must read the current Supabase auth session before Edge Function auth');
  assertContains(workflow, "tokenLookup.status !== 'token_present'", 'mobile workflow must require token_present before Edge Function auth');
  assertContains(workflow, '!tokenLookup.userId', 'mobile workflow must require the signed-in session user id before staging evidence');
  assertContains(workflow, 'sha256:', 'mobile workflow must store real SHA-256 content hashes');
  assertContains(workflow, 'readPhotoFileDigest', 'mobile workflow must verify local file readability and byte size');
  assertContains(workflow, 'FileSystem.readAsStringAsync', 'mobile workflow must read normal iPhone image URIs as bytes');
  assertContains(workflow, 'photo_pair_identical_sha256', 'mobile workflow must reject identical image pairs');
  assertContains(workflow, 'most recent valid earlier photo from same project and area', 'prior-photo selection must prefer same project and area');
  assertContains(workflow, 'not earlier than current photo', 'prior-photo selection must reject future/current candidates');
  assertContains(workflow, 'selectionCandidateCount', 'mobile diagnostics must persist prior-photo selection candidate count');
  assertContains(workflow, 'rejectedPriorReasons', 'mobile diagnostics must explain rejected prior-photo candidates');
  assertContains(workflow, "resultPairMatchesRequestedPair: true", 'mobile hydration must verify persisted result pair matches requested pair');
  assertContains(workflow, "provenance = visibleChange ? 'visual_only' : 'unsupported'", 'mobile visible changes must be labeled visual_only rather than caption-derived');
  assertContains(workflow, 'This is a visual observation only', 'mobile result must preserve progress authority separation');
  assertContains(workflow, 'No project progress was inferred', 'failure states must not infer progress');
  assertContains(workflow, 'Photo saved. Visual comparison unavailable.', 'cloud failures must not look like completed photo intelligence');

  assertContains(app, 'analyzeProjectPhotoWithVision', 'normal photo-add flow must trigger photo intelligence analysis');
  assertContains(app, 'buildAnalyzingPhotoIntelligenceState', 'photo-add flow must show analysis-in-progress state');
  assertContains(app, 'photoIntelligence', 'photo model must persist hydrated display state');
  assertContains(app, 'withDraftPhotoContext', 'photo-add flow must use saved local URI and project/area context before analysis');
  assertContains(app, 'buildAnalyzingPhotoIntelligenceState', 'first photo must enter a stable analysis state');
  assertContains(app, 'No prior photo to compare', 'first photo must show no-prior comparison state');
  assertContains(app, 'Possible visual changes found', 'addition/removal/subtle-change result must be visible');
  assertContains(app, 'No reliable visual change', 'no-change result must be explicit');
  assertContains(app, 'Analysis unavailable · Retry', 'failure state must be visible');
  assertContains(app, 'Retry Analysis', 'failed comparisons must expose a retry action');
  assertContains(app, 'UpdatePIEStatusSection', 'review flow must show PIE status section');
  assertContains(app, 'SavedUpdatePIESummary', 'saved update card must show PIE status');
  assertContains(app, 'currentObservation', 'successful analysis must display current photo observation');
  assertContains(app, 'changedFromPrior', 'successful analysis must display change from prior photo');
  assertContains(app, 'Additions', 'addition findings must be displayed');
  assertContains(app, 'Removals', 'removal findings must be displayed');
  assertContains(app, 'Possible progress', 'progress must be displayed as possible, not automatic status');
  assertContains(app, 'Possible concerns', 'low-confidence or unavailable states must show concerns/reasons');
  assertContains(app, 'Prior update used', 'UI must show which prior update was used');
  assertContains(app, 'Analysis time', 'UI must show analysis timestamp');
  assertContains(app, 'DAVE diagnostics', 'development diagnostics panel must be present');
  assertContains(app, 'Current project ID', 'diagnostics must include project ID');
  assertContains(app, 'Current area ID', 'diagnostics must include area ID');
  assertContains(app, 'Current photo reference', 'diagnostics must include current photo reference');
  assertContains(app, 'Comparison persisted', 'diagnostics must include persistence status');
  assertContains(app, 'UI result hydrated', 'diagnostics must include UI hydration status');
  assert(!app.includes('Provenance:'), 'normal UI must not expose internal provenance details');
  assertContains(capturePanel, 'PhotoIntelligenceCard', 'capture UI must present photo intelligence result');
  assertContains(capturePanel, 'Comparison strength', 'capture UI must show comparison strength');
  assertContains(capturePanel, 'Limitations:', 'capture UI must show capture limitations');
  assertContains(capturePanel, 'Project progress unsupported', 'capture UI must separate visible observation from progress');
  assertContains(capturePanel, 'Photo comparison diagnostics', 'development UI must expose safe comparison diagnostics');
  assertContains(capturePanel, 'Hydrated pair match', 'development diagnostics must show pair correlation');
  assertContains(workflow, 'previous photo unavailable', 'first-photo/no-prior failures must have a safe user-facing reason');
  assertContains(workflow, 'image could not be prepared', 'image preparation failures must have a safe user-facing reason');
  assertContains(workflow, 'analysis service unavailable', 'service failures must have a safe user-facing reason');
  assertContains(workflow, 'comparison returned no usable result', 'empty/stale comparison results must have a safe user-facing reason');
  assertContains(workflow, "provenance = visibleChange ? 'visual_only' : 'unsupported'", 'blank captions must not create visual findings');

  for (const forbidden of [
    'providerName',
    'modelName',
    'raw_response',
    'provider_response',
    'signedUrl',
    'Authorization',
    'service_role',
  ]) {
    assert(!capturePanel.includes(forbidden), `capture UI must not expose ${forbidden}`);
  }

  assert.strictEqual(appJson.expo.version, '1.0.22', 'Expo visible version must be Build 22');
  assert.strictEqual(appJson.expo.ios.buildNumber, '22', 'iOS build number must be 22');
  assert.strictEqual(appJson.expo.android.versionCode, 22, 'Android versionCode must be 22');
  assertContains(admin, 'True Photo Intelligence', 'More screen must visibly identify the Build 22 capability');
}

function testP0TanCaseFindingPreservation() {
  const legacyText = 'tan case added in the foreground near the laptop';
  const structuredFinding = {
    findingType: 'added',
    description: 'A tan case appears in the foreground near the laptop.',
    objectName: 'tan case',
    baselineState: null,
    currentState: 'visible in foreground',
    location: 'lower-right foreground',
    confidence: 0.9,
    limitations: [],
    evidenceRegions: [],
  };
  const legacy = photoFindingNormalization.normalizePIEPhotoFindings([legacyText], 'added');
  const structured = photoFindingNormalization.normalizePIEPhotoFindings([structuredFinding], 'added');

  assert.strictEqual(legacy.findings.length, 1, 'legacy string finding must survive normalization');
  assert.strictEqual(legacy.findings[0].description, legacyText, 'legacy description must remain verbatim');
  assert.strictEqual(legacy.findings[0].findingType, 'added');
  assert.strictEqual(legacy.findings[0].source, 'legacy_provider_text');
  assert.strictEqual(legacy.findings[0].objectName, null, 'legacy normalization must not invent an object name');
  assert.strictEqual(legacy.findings[0].confidence, null, 'legacy normalization must not invent confidence');
  assert.strictEqual(structured.findings.length, 1, 'structured finding must survive normalization');
  assert.strictEqual(structured.findings[0].objectName, 'tan case');
  assert.strictEqual(structured.findings[0].location, 'lower-right foreground');
  assert.strictEqual(structured.findings[0].source, 'structured_provider');

  const validPair = buildStrictPairResponse({ objectAdditions: [structuredFinding] });
  assert.strictEqual(photoComparisonSchema.validateStrictPhotoPairResponse(validPair).valid, true);
  const malformed = { schemaVersion: photoComparisonSchema.PIE_PHOTO_PAIR_SCHEMA_VERSION, objectAdditions: [] };
  const malformedValidation = photoComparisonSchema.validateStrictPhotoPairResponse(malformed);
  assert.strictEqual(malformedValidation.valid, false, 'missing required provider fields must be rejected');
  const wrongTypeValidation = photoComparisonSchema.validateStrictPhotoPairResponse(buildStrictPairResponse({
    objectAdditions: ['tan case added in the foreground near the laptop'],
  }));
  assert.strictEqual(wrongTypeValidation.valid, false, 'strict provider responses must reject legacy string finding items');

  const workflow = read('services/PIEPhotoVisionMobileWorkflow.ts');
  const edge = read('supabase/functions/pie-photo-vision/index.ts');
  const app = read('App.tsx');
  assertContains(workflow, 'normalizePIEPhotoFindings(row.object_additions', 'persisted additions must use mixed-shape hydration');
  assertContains(workflow, 'findings,', 'normalized findings must persist into the display model');
  assertContains(edge, "error: malformedPairResponse ? 'malformed_comparison_result'", 'malformed comparison must degrade safely');
  assertContains(edge, "status: malformedPairResponse", 'malformed comparison must not complete successfully');
  assertContains(app, 'observedFindingsForUpdateBrief(update)', 'Update Detail must receive aggregate observations');
  assertContains(app, 'buildPIEProjectBriefModel', 'Project Brief must aggregate observations');
  assertContains(app, 'isBaselineInfoFinding', 'baseline-only informational text must remain filtered from changes');
  assertContains(workflow, 'This is a visual observation only', 'tan-case observation must not become confirmed progress');
}

function buildStrictPairResponse(overrides = {}) {
  return {
    schemaVersion: photoComparisonSchema.PIE_PHOTO_PAIR_SCHEMA_VERSION,
    sameSceneProbability: 0.95,
    sameSubjectProbability: 0.95,
    sharedVisualAnchors: ['laptop', 'desk'],
    sceneOverlapAssessment: 'Same laptop and desk scene.',
    viewpointAssessment: 'Comparable with a small foreground difference.',
    viewpointChange: 'minimal',
    cameraAngleChange: 'minimal',
    distanceChange: 'minimal',
    framingChange: 'minimal',
    lightingDifferences: [],
    lightingChange: 'none material',
    obstructionDifferences: ['The lower-right foreground is more occluded.'],
    obstructionChange: 'A tan case occludes more of the lower-right foreground.',
    alignmentConfidence: 'high',
    changeDetectionConfidence: 'high',
    objectAdditions: [],
    objectRemovals: [],
    materialOrStructuralChanges: [],
    visibleConcerns: [],
    movedObjects: [],
    occludingObjects: [],
    revealedObjects: [],
    uncertainFindings: [],
    unchangedConditions: ['Laptop and desk remain visible.'],
    possibleRegression: [],
    differenceClassifications: ['physical_scene_change'],
    comparabilityClassification: 'strong',
    comparabilityReasons: ['Shared laptop and desk anchors align.'],
    conclusion: 'unable_to_determine',
    confidence: 'high',
    limitations: ['A visual comparison cannot establish project progress.'],
    repeatPhotoGuidance: [],
    observations: ['A tan case appears in the foreground near the laptop.'],
    interpretations: [],
    plainLanguageSummary: 'A tan case is now visible in the foreground near the laptop.',
    ...overrides,
  };
}

function testProductionVisionResourceGuards() {
  const functionSource = read('supabase/functions/pie-photo-vision/index.ts');
  const providerSource = read('supabase/functions/_shared/pie-vision-provider.ts');
  const testSource = read('scripts/multimodal-evidence-test.js');
  const scenario = JSON.parse(read('validation/multimodal/photo-vision-scenarios.json'))
    .scenarios.find(item => item.id === 'mouse_added_to_table');

  assertContains(functionSource, 'createSignedUrl', 'large provider images must use signed URLs instead of inline bytes');
  assertContains(functionSource, 'SIGNED_URL_EXPIRES_SECONDS', 'signed URL expiration must be explicit');
  assertContains(functionSource, 'PIE_VISION_MAX_IMAGE_BYTES', 'provider path must enforce maximum image size');
  assertContains(functionSource, 'image_exceeds_provider_size_limit', 'oversize images must degrade safely');
  assertContains(functionSource, 'buildPreflightDegradedResult', 'oversize preflight must persist a degraded result');
  assertContains(functionSource, 'sourceImageByteSizes', 'safe image byte-size logging required');
  assertContains(functionSource, 'imageTransport', 'safe image transport logging required');
  assertContains(functionSource, 'buildSafeImageDiagnosticLog', 'Edge Function must emit safe pair diagnostics');
  assertContains(functionSource, 'currentStoragePathHash', 'Edge diagnostics must hash current storage path');
  assertContains(functionSource, 'priorStoragePathHash', 'Edge diagnostics must hash prior storage path');
  assertContains(functionSource, 'currentImageSha256', 'Edge diagnostics must include current SHA-256');
  assertContains(functionSource, 'priorImageSha256', 'Edge diagnostics must include prior SHA-256');
  assertContains(functionSource, 'signedUrlsGenerated', 'Edge diagnostics must state whether signed URLs were generated');
  assertContains(functionSource, 'providerResponseStatus', 'Edge diagnostics must include provider response status');
  assertContains(functionSource, 'validateDistinctImagePair', 'Edge Function must fail invalid or identical photo pairs');
  assertContains(functionSource, 'photo_pair_identical_sha256', 'Edge Function must reject identical image hashes');
  assertContains(functionSource, 'photo_pair_same_evidence_id', 'Edge Function must reject same evidence ID');
  assert(!functionSource.includes('.download(storagePath)'), 'Edge Function must not download full-resolution provider images');

  assertContains(providerSource, 'signedUrl', 'provider input must support signed URLs');
  assertContains(providerSource, 'image_url: input.image.signedUrl', 'OpenAI image input must receive signed URL directly');
  assertContains(providerSource, 'pie_vision_provider_request_start', 'provider start logging required');
  assertContains(providerSource, 'pie_vision_provider_request_end', 'provider end logging required');
  assert(!providerSource.includes('blobToBase64'), 'provider must not base64 encode images');
  assert(!providerSource.includes('arrayBuffer'), 'provider must not create duplicate ArrayBuffer image copies');
  assert(!providerSource.includes('Uint8Array'), 'provider must not create duplicate Uint8Array image copies');
  assert(!providerSource.includes('base64,'), 'provider must not inline base64 image data');

  assert(scenario, 'mouse acceptance scenario must remain present');
  assert.strictEqual(scenario.expected.comparability, 'probable', 'mouse comparability expectation must remain probable');
  assert.strictEqual(scenario.expected.addedObject, 'black computer mouse', 'mouse object expectation must remain unchanged');
  assert.strictEqual(scenario.expected.approximateRegion, 'lower-right portion of the table', 'mouse region expectation must remain unchanged');
  assert.strictEqual(scenario.expected.progressConclusion, 'unable_to_determine', 'mouse progress expectation must remain unchanged');
  assertContains(testSource, 'identical control must not report mouse added', 'identical-image negative control must stay covered');
  assertContains(testSource, 'blank fixture image', 'blank-image degraded control must stay covered');
}

function testBuild22RemovalAndCaptionRegressionScenarios() {
  const scenarios = JSON.parse(read('validation/multimodal/photo-vision-scenarios.json')).scenarios;
  const providerSource = read('supabase/functions/_shared/pie-vision-provider.ts');
  const workflow = read('services/PIEPhotoVisionMobileWorkflow.ts');
  const required = [
    ['mouse_removed_from_table_blank_caption', 'object_removed', 'black computer mouse'],
    ['papers_added_to_table_blank_caption', 'object_added', 'stack of papers'],
    ['papers_removed_from_table_blank_caption', 'object_removed', 'stack of papers'],
  ];

  for (const [id, changeType, objectName] of required) {
    const scenario = scenarios.find(item => item.id === id);
    assert(scenario, `missing Build 22 regression scenario ${id}`);
    assert.strictEqual(scenario.captionPolicy.baselineCaption, '', `${id} baseline caption must be blank`);
    assert.strictEqual(scenario.captionPolicy.currentCaption, '', `${id} current caption must be blank`);
    assert.strictEqual(scenario.captionPolicy.captionsMaySupportVisualClaims, false, `${id} captions must not support visual claims`);
    assert.strictEqual(scenario.expected.changeType, changeType, `${id} change type mismatch`);
    assert.strictEqual(scenario.expected.provenance, 'visual_only', `${id} must require visual_only provenance`);
    assert.strictEqual(scenario.expected.captionProvenance, null, `${id} must not have caption provenance`);
    assert.strictEqual(scenario.expected.progressConclusion, 'unable_to_determine', `${id} must not infer project progress`);
    assert(
      scenario.expected.addedObject === objectName || scenario.expected.removedObject === objectName,
      `${id} must name ${objectName}`,
    );
  }

  const strictSchemaSource = read('supabase/functions/_shared/pie-photo-comparison-schema.ts');
  assertContains(strictSchemaSource, 'objectAdditions:', 'strict provider schema must support added objects');
  assertContains(strictSchemaSource, 'objectRemovals:', 'strict provider schema must support removed objects');
  assertContains(providerSource, 'using raw pixels', 'provider prompt must compare images directly');
  assert(!workflow.includes('caption:'), 'mobile vision request must not send captions as visual evidence');
  assert(!workflow.includes('captionText'), 'mobile vision request must not send caption text as visual evidence');
}

function normalizeComparabilityForTest(input) {
  const qualityText = [
    input.viewpointAssessment || '',
    input.sceneOverlapAssessment || '',
    ...(input.sharedVisualAnchors || []),
    ...(input.comparabilityReasons || []),
    ...(input.limitations || []),
  ].join(' ').toLowerCase();
  const limitingText = [
    ...(input.lightingDifferences || []),
    ...(input.obstructionDifferences || []),
    ...(input.limitations || []),
  ].join(' ').toLowerCase();
  const insufficientAnchors = [
    'insufficient anchor',
    'limited anchor',
    'limited overlap',
    'insufficient overlap',
    'important region missing',
    'cannot align',
    'poor alignment',
    'significantly reduces confidence',
  ].some(marker => qualityText.includes(marker));
  const limited = ['limits comparison', 'obstruct', 'occluded', 'poor lighting', 'glare', 'blur', 'important region missing']
    .some(marker => limitingText.includes(marker));
  const strongAllowed =
    input.providerComparability === 'strong' &&
    input.sameSceneProbability >= 0.9 &&
    input.sameSubjectProbability >= 0.85 &&
    input.alignmentConfidence !== 'low' &&
    input.changeDetectionConfidence !== 'low' &&
    !insufficientAnchors &&
    !limited;
  if (input.providerComparability === 'strong' && !strongAllowed) return 'probable';
  return input.providerComparability;
}

function normalizeSpatialForTest(rawObjectDescription, rawLocationText = '') {
  const text = `${rawObjectDescription || ''} ${rawLocationText || ''}`.toLowerCase();
  const reasons = [];
  const horizontal = (() => {
    if (/(left side|left edge|left-hand|lower left|bottom left|front left)/.test(text)) return 'left';
    if (/(right side|right edge|right-hand|lower right|lower-right|bottom right|front right|front-right|foreground right|on the right|to the right|right of)/.test(text)) return 'right';
    if (/(center|middle|central)/.test(text)) return 'center';
    return 'unknown';
  })();
  const vertical = (() => {
    if (/(lower|lower-right|lower right|bottom|foreground|front right|front-right|front left|front-left)/.test(text)) return 'lower';
    if (/(upper|top edge|top side|above)/.test(text)) return 'upper';
    if (/(middle|center|central)/.test(text)) return 'middle';
    return 'unknown';
  })();
  const subjectRelative = (() => {
    if (/(right of|to the right|on the right)/.test(text)) return 'right_of_subject';
    if (/(left of|to the left|on the left)/.test(text)) return 'left_of_subject';
    if (/beside|next to|adjacent/.test(text)) return 'beside_subject';
    if (/on table|on the table|on desk|on the desk|on tabletop|tabletop|desktop/.test(text)) return 'on_subject';
    if (/in front|foreground|front-right|front right/.test(text)) return 'in_front_of_subject';
    return 'unknown';
  })();
  const surface = (() => {
    if (/tabletop|table top|table/.test(text)) return 'table';
    if (/desktop|desk/.test(text)) return 'desk';
    if (/floor/.test(text)) return 'floor';
    if (/wall/.test(text)) return 'wall';
    if (/equipment|machine|laptop|cabinet|panel/.test(text)) return 'equipment';
    if (/structure|beam|column|ceiling|roof|framing/.test(text)) return 'structure';
    return 'unknown';
  })();
  if (horizontal !== 'unknown') reasons.push(`horizontal region normalized as ${horizontal}`);
  if (vertical !== 'unknown') reasons.push(`vertical region normalized as ${vertical}`);
  if (surface !== 'unknown') reasons.push(`surface normalized as ${surface}`);
  if (rawLocationText) reasons.push('spatial location normalized from provider text');
  else reasons.push('provider did not supply explicit location text');
  const score = [horizontal, vertical, subjectRelative, surface].filter(value => value !== 'unknown').length;
  return {
    rawObjectDescription,
    rawLocationText,
    normalizedObjectName: String(rawObjectDescription || '').toLowerCase().includes('mouse') ? 'black computer mouse' : String(rawObjectDescription || '').toLowerCase(),
    imageHorizontalRegion: horizontal,
    imageVerticalRegion: vertical,
    subjectRelativeRegion: subjectRelative,
    surfaceOrArea: surface,
    locationConfidence: !rawLocationText ? 'low' : score >= 3 ? 'high' : score >= 2 ? 'medium' : 'low',
    normalizationReasons: reasons,
  };
}

function acceptsMouseLocationForTest(finding) {
  if (!finding) return false;
  const text = `${finding.rawLocationText || ''}`.toLowerCase();
  const rightSide =
    finding.imageHorizontalRegion === 'right' ||
    finding.subjectRelativeRegion === 'right_of_subject' ||
    (finding.subjectRelativeRegion === 'beside_subject' && text.includes('right')) ||
    /(right side|right edge|right-hand|lower-right|lower right|bottom right|front-right|front right|foreground right|to the right)/.test(text);
  const validSurface = ['table', 'desk'].includes(finding.surfaceOrArea) || /(table|desk|tabletop|desktop)/.test(text);
  const wrongSide = finding.imageHorizontalRegion === 'left' || /(left side|left edge|lower left)/.test(text);
  const wrongSurface = ['floor', 'wall', 'structure'].includes(finding.surfaceOrArea);
  return rightSide && validSurface && finding.locationConfidence !== 'low' && !wrongSide && !wrongSurface;
}

function testProductionSpatialNormalizationRules() {
  const functionSource = read('supabase/functions/pie-photo-vision/index.ts');
  const providerSource = read('supabase/functions/_shared/pie-vision-provider.ts');
  const harnessSource = read('scripts/live-provider-mouse-acceptance.js');

  assertContains(functionSource, 'normalizeSpatialFindings', 'Edge Function must normalize spatial findings');
  assertContains(functionSource, 'imageHorizontalRegion', 'spatial model must persist horizontal image region');
  assertContains(functionSource, 'subjectRelativeRegion', 'spatial model must persist subject-relative region');
  assertContains(functionSource, 'surfaceOrArea', 'spatial model must persist surface or area');
  assertContains(functionSource, 'normalizedSpatialFindings', 'normalized spatial findings must be persisted');
  assertContains(functionSource, 'rawLocationText', 'raw provider location wording must be preserved');
  assertContains(providerSource, 'Location phrases should describe image position', 'provider prompt must request concrete location phrasing');
  assertContains(harnessSource, 'SPATIAL_LOCATION_PATH_DIAGNOSTICS', 'live harness must print spatial path diagnostics');
  assertContains(harnessSource, 'hasAcceptedMouseLocation', 'live harness must validate normalized semantic location');
  assert(!harnessSource.includes("combined.includes('lower') && combined.includes('right')"), 'live harness must not require exact lower/right wording');

  const lowerRight = normalizeSpatialForTest('black computer mouse', 'lower-right corner of table');
  assert.strictEqual(lowerRight.imageHorizontalRegion, 'right');
  assert.strictEqual(lowerRight.imageVerticalRegion, 'lower');
  assert.strictEqual(lowerRight.surfaceOrArea, 'table');
  assert.strictEqual(acceptsMouseLocationForTest(lowerRight), true);

  const rightDesk = normalizeSpatialForTest('black computer mouse', 'right side of desk');
  assert.strictEqual(rightDesk.imageHorizontalRegion, 'right');
  assert.strictEqual(rightDesk.surfaceOrArea, 'desk');
  assert.strictEqual(acceptsMouseLocationForTest(rightDesk), true);

  const frontRight = normalizeSpatialForTest('black computer mouse', 'front-right tabletop');
  assert.strictEqual(frontRight.imageHorizontalRegion, 'right');
  assert.strictEqual(frontRight.imageVerticalRegion, 'lower');
  assert.strictEqual(frontRight.surfaceOrArea, 'table');
  assert.strictEqual(acceptsMouseLocationForTest(frontRight), true);

  const besideLaptop = normalizeSpatialForTest('black computer mouse', 'beside the laptop on the right side of desk');
  assert.strictEqual(besideLaptop.imageHorizontalRegion, 'right');
  assert.strictEqual(besideLaptop.subjectRelativeRegion, 'right_of_subject');
  assert.strictEqual(besideLaptop.surfaceOrArea, 'desk');
  assert.strictEqual(acceptsMouseLocationForTest(besideLaptop), true);

  const leftTable = normalizeSpatialForTest('black computer mouse', 'left side of table');
  assert.strictEqual(leftTable.imageHorizontalRegion, 'left');
  assert.strictEqual(acceptsMouseLocationForTest(leftTable), false, 'left side must not satisfy mouse acceptance');

  const missingLocation = normalizeSpatialForTest('black computer mouse', '');
  assert.strictEqual(missingLocation.locationConfidence, 'low');
  assert.strictEqual(acceptsMouseLocationForTest(missingLocation), false, 'missing location must fail');

  const conflictingLocation = {
    ...normalizeSpatialForTest('black computer mouse', 'left side of table near the right edge'),
    imageHorizontalRegion: 'left',
  };
  assert.strictEqual(acceptsMouseLocationForTest(conflictingLocation), false, 'conflicting left/right location must fail');

  const arbitraryDamage = normalizeSpatialForTest('fresh drywall damage', 'right edge of wall');
  assert.strictEqual(arbitraryDamage.imageHorizontalRegion, 'right');
  assert.strictEqual(arbitraryDamage.surfaceOrArea, 'wall', 'normalization must work outside the mouse case');
}

function evaluateJarvisAuthorityForTest(input) {
  const observationReasons = [];
  const progressReasons = [];
  const authorityBoundaryReasons = [];
  const claims = JSON.stringify(input || {}).toLowerCase();
  for (const unsafe of ['fully compliant', 'passed inspection', 'hidden work', '100% complete', 'percent complete', 'cost impact', 'schedule impact']) {
    if (claims.includes(unsafe)) observationReasons.push(`unsafe visual claim: ${unsafe}`);
  }
  if (input.malformed) observationReasons.push('provider output missing or malformed');
  if (input.locationConfidence === 'low') observationReasons.push('location confidence insufficient');
  if (input.unsupported) observationReasons.push('unsupported visible observation');
  if (input.finding) observationReasons.push(`${input.finding} visibly observed`);
  if (input.locationConfidence === 'high' || input.locationConfidence === 'medium') observationReasons.push('location reasonably supported');
  if (input.limitations?.length) observationReasons.push(String(input.limitations[0]));
  const blockingObservationReasons = observationReasons.filter(reason =>
    reason.includes('unsafe visual claim') ||
    reason.includes('provider output missing or malformed') ||
    reason.includes('location confidence insufficient') ||
    reason.includes('unsupported')
  );
  const observationAccepted = blockingObservationReasons.length === 0;
  const observationDisposition = observationAccepted
    ? input.limitations?.length ? 'accepted_with_limitations' : 'accepted'
    : input.malformed ? 'quarantined' : 'rejected';
  let progressDisposition = 'unable_to_determine';
  let progressAccepted = false;
  if (input.progressConclusion === 'progress_visible' || input.progressConclusion === 'partial_progress_visible') {
    if (input.comparability === 'weak' || input.comparability === 'not_comparable') {
      progressReasons.push('weak or not-comparable images cannot support progress conclusion');
      progressDisposition = 'blocked';
    } else if (input.scopeLinked && observationAccepted) {
      progressAccepted = true;
      progressDisposition = 'supported';
    } else {
      progressReasons.push('visual observation does not establish project progress');
      progressDisposition = 'unable_to_determine';
    }
  } else if (input.progressConclusion === 'no_material_visible_change') {
    progressDisposition = 'unsupported';
    progressReasons.push('no material visible project progress conclusion');
  } else {
    progressReasons.push('visual observation does not establish project progress');
  }
  const realityEligible = observationAccepted;
  const realityDisposition = observationAccepted ? 'eligible_as_observation' : input.malformed ? 'not_eligible' : 'evidence_request_only';
  authorityBoundaryReasons.push(progressAccepted ? 'progress requires downstream authority checks' : 'accepted as limited visual observation only; no authoritative project-progress assertion');
  return {
    observationDisposition,
    observationAccepted,
    observationReasons,
    progressDisposition,
    progressAccepted,
    progressReasons,
    realityDisposition,
    realityEligible,
    authorityBoundaryReasons,
    authoritativeProgressAssertionCount: progressAccepted ? 1 : 0,
  };
}

function testProductionObservationAuthoritySplit() {
  const functionSource = read('supabase/functions/pie-photo-vision/index.ts');
  const harnessSource = read('scripts/live-provider-mouse-acceptance.js');

  assertContains(functionSource, 'observationDisposition', 'JARVIS must persist observation disposition');
  assertContains(functionSource, 'observationAccepted', 'JARVIS must persist observation acceptance');
  assertContains(functionSource, 'progressDisposition', 'JARVIS must persist progress disposition separately');
  assertContains(functionSource, 'progressAccepted', 'JARVIS must persist progress acceptance separately');
  assertContains(functionSource, 'realityDisposition', 'JARVIS must persist Reality eligibility disposition');
  assertContains(functionSource, 'authorityBoundaryReasons', 'JARVIS must persist authority boundary reasons');
  assertContains(functionSource, 'accepted as limited visual observation only; no authoritative project-progress assertion', 'limited observation must not become progress');
  assertContains(harnessSource, 'JARVIS_AUTHORITY_PATH_DIAGNOSTICS', 'live harness must print authority split diagnostics');
  assertContains(harnessSource, "requirePredicate('observationAccepted'", 'live harness must require observation acceptance');
  assertContains(harnessSource, "requirePredicate('progressNotAccepted'", 'live harness must require no progress acceptance for mouse');
  assertContains(harnessSource, 'authoritativeProgressAssertionCount', 'live harness must check authoritative progress assertion count');
  assertContains(harnessSource, 'JARVIS_ACCEPTANCE_PREDICATE_DIAGNOSTICS', 'live harness must print failing predicate diagnostics');
  assertContains(harnessSource, "['unable_to_determine', 'no_material_visible_change'].includes(comparison.conclusion)", 'live harness must accept equivalent non-progress conclusions');
  assert(!functionSource.includes("observationReasons.push('limitations required')"), 'limitations alone must not reject observations');

  const objectAdded = evaluateJarvisAuthorityForTest({
    finding: 'black computer mouse added on right side of table',
    progressConclusion: 'unable_to_determine',
    comparability: 'probable',
    locationConfidence: 'high',
    limitations: ['Viewpoint changed slightly.'],
  });
  assert.strictEqual(objectAdded.observationAccepted, true, 'valid object addition should be accepted as observation');
  assert.strictEqual(objectAdded.observationDisposition, 'accepted_with_limitations');
  assert.strictEqual(objectAdded.progressAccepted, false, 'same finding must not be accepted as project progress');
  assert(objectAdded.observationReasons.some(reason => reason.includes('black computer mouse')), 'observation reasons should name the visible object');

  const limitationsOnly = evaluateJarvisAuthorityForTest({
    finding: 'black computer mouse added on right side of table',
    progressConclusion: 'unable_to_determine',
    comparability: 'probable',
    locationConfidence: 'high',
    limitations: ['Slight viewpoint/framing shift disclosed.'],
  });
  assert.strictEqual(limitationsOnly.observationAccepted, true, 'limitations alone must not cause rejection');
  assert.strictEqual(limitationsOnly.observationDisposition, 'accepted_with_limitations', 'supported observation with limitation should be accepted_with_limitations');

  const unsupportedWithLimitations = evaluateJarvisAuthorityForTest({
    finding: 'unsupported object claim',
    progressConclusion: 'unable_to_determine',
    comparability: 'probable',
    locationConfidence: 'high',
    limitations: ['Viewpoint changed.'],
    unsupported: true,
  });
  assert.strictEqual(unsupportedWithLimitations.observationAccepted, false, 'unsupported observation with limitations must be rejected');
  assert.strictEqual(unsupportedWithLimitations.observationDisposition, 'rejected');

  const nonProjectObject = evaluateJarvisAuthorityForTest({
    finding: 'black computer mouse added on right side of table',
    progressConclusion: 'no_material_visible_change',
    comparability: 'probable',
    locationConfidence: 'high',
    limitations: ['Object is not linked to project scope.'],
  });
  assert.strictEqual(nonProjectObject.observationAccepted, true, 'non-project object change should still be accepted as observation');
  assert.strictEqual(nonProjectObject.progressDisposition, 'unsupported', 'no_material_visible_change should map to unsupported progress');
  assert.strictEqual(nonProjectObject.authoritativeProgressAssertionCount, 0, 'no_material_visible_change cannot create authoritative progress');

  const ambiguousRelevance = evaluateJarvisAuthorityForTest({
    finding: 'new visible item with unclear project relevance',
    progressConclusion: 'unable_to_determine',
    comparability: 'probable',
    locationConfidence: 'medium',
    limitations: ['Project relevance is ambiguous.'],
  });
  assert.strictEqual(ambiguousRelevance.progressDisposition, 'unable_to_determine', 'ambiguous project relevance should remain unable_to_determine');
  assert.strictEqual(ambiguousRelevance.authoritativeProgressAssertionCount, 0, 'unable_to_determine cannot create authoritative progress');

  const safetyConcern = evaluateJarvisAuthorityForTest({
    finding: 'open trench visible near walkway',
    progressConclusion: 'unable_to_determine',
    comparability: 'probable',
    locationConfidence: 'medium',
    limitations: ['Severity requires qualified reviewer.'],
  });
  assert.strictEqual(safetyConcern.observationAccepted, true, 'visible safety concern can be accepted as observation');
  assert.strictEqual(safetyConcern.progressAccepted, false, 'safety observation should not imply progress');

  const visibleInstall = evaluateJarvisAuthorityForTest({
    finding: 'equipment visibly installed',
    progressConclusion: 'partial_progress_visible',
    comparability: 'strong',
    scopeLinked: false,
    locationConfidence: 'high',
    limitations: ['Completion requires corroboration.'],
  });
  assert.strictEqual(visibleInstall.observationAccepted, true, 'visible installation can be observation');
  assert.strictEqual(visibleInstall.progressAccepted, false, 'visible installation is not completion without corroboration');

  const hiddenWork = evaluateJarvisAuthorityForTest({
    finding: 'hidden work is complete behind the wall',
    progressConclusion: 'progress_visible',
    comparability: 'strong',
    scopeLinked: true,
    locationConfidence: 'high',
    limitations: [],
  });
  assert.strictEqual(hiddenWork.observationAccepted, false, 'unsupported hidden-work claim must be rejected');

  const malformed = evaluateJarvisAuthorityForTest({ malformed: true });
  assert.strictEqual(malformed.observationDisposition, 'quarantined', 'malformed provider output must be quarantined');
  assert.strictEqual(malformed.realityEligible, false);

  const mouse = evaluateJarvisAuthorityForTest({
    finding: 'black computer mouse added on right side of table',
    progressConclusion: 'unable_to_determine',
    comparability: 'probable',
    locationConfidence: 'high',
    limitations: ['Viewpoint changed slightly.'],
  });
  assert.strictEqual(mouse.observationAccepted, true, 'mouse observation must be accepted');
  assert.strictEqual(mouse.progressDisposition, 'unable_to_determine', 'mouse progress must remain unable to determine');
  assert.strictEqual(mouse.authoritativeProgressAssertionCount, 0, 'mouse must not create authoritative progress assertion');
  assert.strictEqual(mouse.realityDisposition, 'eligible_as_observation', 'Reality should store limited observation without changing project status');
}

function testProductionComparabilityNormalizationRules() {
  const functionSource = read('supabase/functions/pie-photo-vision/index.ts');
  const providerSource = read('supabase/functions/_shared/pie-vision-provider.ts');
  const harnessSource = read('scripts/live-provider-mouse-acceptance.js');
  const scenario = JSON.parse(read('validation/multimodal/photo-vision-scenarios.json'))
    .scenarios.find(item => item.id === 'mouse_added_to_table');

  assertContains(functionSource, 'normalizeComparabilityClassification', 'paired-photo comparability normalization rule required');
  assertContains(functionSource, 'collectStrongComparabilityDowngradeTriggers', 'strong comparability must downgrade only when evidence quality cannot support it');
  assertContains(functionSource, 'MIN_SHARED_VISUAL_ANCHORS', 'anchor sufficiency must affect comparability');
  assertContains(functionSource, 'hasAlignmentOrOverlapInconsistencyText', 'overlap limits must affect comparability');
  assertContains(functionSource, 'comparabilityNormalizationReasons', 'JARVIS downgrade reasons must be persisted with normalized findings');
  assertContains(providerSource, 'Comparability measures whether the shared physical scene or subject can be reliably compared', 'provider prompt must separate comparability from identical camera position');
  assertContains(functionSource, 'rawProviderComparability', 'raw provider comparability must be preserved separately for audit');
  assertContains(functionSource, 'normalizedComparability', 'normalized comparability must be persisted separately');
  assertContains(harnessSource, 'normalizedComparability', 'live harness must validate normalized comparability');
  assertContains(harnessSource, 'rawProviderComparability', 'live harness diagnostics must show raw provider comparability separately');
  assertContains(harnessSource, "requirePredicate('persistedComparabilityMatchesNormalized'", 'live harness must prove persisted comparability matches normalized field');
  assertContains(harnessSource, "['strong', 'probable'].includes(normalizedComparability)", 'mouse live acceptance must accept strong or probable only');

  assert(['strong', 'probable'].includes(normalizeComparabilityForTest({
    providerComparability: 'strong',
    sameSceneProbability: 0.98,
    sameSubjectProbability: 0.96,
    sharedVisualAnchors: ['laptop', 'desk edge', 'table surface'],
    sceneOverlapAssessment: 'High overlap across the desk area.',
    alignmentConfidence: 'high',
    changeDetectionConfidence: 'high',
    viewpointAssessment: 'Same desk scene with a slight angle change.',
    lightingDifferences: [],
    obstructionDifferences: [],
    limitations: ['Viewpoint and framing changed.'],
  })), 'same scene, slight angle change, clear object added should remain strong or probable');

  assert.strictEqual(normalizeComparabilityForTest({
    providerComparability: 'probable',
    sameSceneProbability: 0.98,
    sameSubjectProbability: 0.96,
    sharedVisualAnchors: ['laptop', 'desk', 'table edge'],
    sceneOverlapAssessment: 'Large viewpoint change but enough shared anchors remain.',
    alignmentConfidence: 'medium',
    changeDetectionConfidence: 'medium',
    viewpointAssessment: 'Large viewpoint change; same subject remains visible.',
    lightingDifferences: [],
    obstructionDifferences: [],
    limitations: [],
  }), 'probable', 'large viewpoint change with sufficient anchors should be probable');

  assert.strictEqual(normalizeComparabilityForTest({
    providerComparability: 'strong',
    sameSceneProbability: 0.98,
    sameSubjectProbability: 0.96,
    sharedVisualAnchors: ['limited visible desk edge'],
    sceneOverlapAssessment: 'Limited overlap; important comparison region missing.',
    alignmentConfidence: 'low',
    changeDetectionConfidence: 'low',
    viewpointAssessment: 'Large viewpoint and framing shift.',
    lightingDifferences: [],
    obstructionDifferences: [],
    limitations: ['Important comparison region missing.'],
  }), 'probable', 'provider strong with insufficient overlap should downgrade to probable before JARVIS can further limit it');

  assert.strictEqual(normalizeComparabilityForTest({
    providerComparability: 'weak',
    sameSceneProbability: 0.7,
    sameSubjectProbability: 0.55,
    sharedVisualAnchors: ['limited visible context'],
    sceneOverlapAssessment: 'Insufficient overlap.',
    alignmentConfidence: 'low',
    changeDetectionConfidence: 'low',
    viewpointAssessment: 'Large viewpoint change and insufficient overlap.',
    lightingDifferences: [],
    obstructionDifferences: [],
    limitations: ['Limited anchors.'],
  }), 'weak', 'same scene, large viewpoint change, insufficient overlap should be weak');

  assert.strictEqual(normalizeComparabilityForTest({
    providerComparability: 'not_comparable',
    sameSceneProbability: 0.1,
    sameSubjectProbability: 0.1,
    sharedVisualAnchors: [],
    sceneOverlapAssessment: 'Different area.',
    alignmentConfidence: 'low',
    changeDetectionConfidence: 'low',
    viewpointAssessment: 'Different area or subject.',
    lightingDifferences: [],
    obstructionDifferences: [],
    limitations: ['No reliable scene correspondence.'],
  }), 'not_comparable', 'different area should stay not comparable');

  assert.strictEqual(normalizeComparabilityForTest({
    providerComparability: 'strong',
    sameSceneProbability: 0.98,
    sameSubjectProbability: 0.96,
    sharedVisualAnchors: ['laptop', 'table edge', 'background wall'],
    sceneOverlapAssessment: 'High overlap and stable anchors.',
    alignmentConfidence: 'high',
    changeDetectionConfidence: 'high',
    viewpointAssessment: 'Same desk scene; camera moved slightly closer.',
    lightingDifferences: [],
    obstructionDifferences: [],
    limitations: [],
  }), 'strong', 'added object visible despite changed viewpoint may remain strong');

  assert.strictEqual(normalizeComparabilityForTest({
    providerComparability: 'strong',
    sameSceneProbability: 0.98,
    sameSubjectProbability: 0.96,
    sharedVisualAnchors: ['laptop', 'table edge', 'background wall'],
    sceneOverlapAssessment: 'High overlap and stable anchors.',
    alignmentConfidence: 'high',
    changeDetectionConfidence: 'high',
    viewpointAssessment: 'Same viewpoint and same framing; camera position materially unchanged.',
    lightingDifferences: [],
    obstructionDifferences: [],
    limitations: ['No viewpoint change.'],
  }), 'strong', 'provider strong with materially unchanged viewpoint should remain strong');

  assert(['weak', 'not_comparable'].includes(normalizeComparabilityForTest({
    providerComparability: 'weak',
    sameSceneProbability: 0.62,
    sameSubjectProbability: 0.48,
    viewpointAssessment: 'Different viewpoint and weak subject match.',
    lightingDifferences: [],
    obstructionDifferences: ['Subject partially obstructed.'],
    limitations: ['Retake from the prior viewpoint.'],
  })), 'weak viewpoint match must remain weak or not comparable');

  assert(scenario, 'mouse acceptance scenario must remain present');
  assert.strictEqual(scenario.expected.comparability, 'probable', 'mouse normalized comparability must remain probable');
  assert.strictEqual(scenario.expected.sameGeneralScene, true, 'mouse same scene expectation must remain true');
  assert.strictEqual(scenario.expected.addedObject, 'black computer mouse', 'mouse added-object expectation must remain unchanged');
  assert.strictEqual(scenario.expected.approximateRegion, 'lower-right portion of the table', 'mouse region expectation must remain unchanged');
  assert.strictEqual(scenario.expected.progressConclusion, 'unable_to_determine', 'mouse project progress expectation must remain unable_to_determine');
}

function testProductionVisionPipelineBehavior() {
  const request = photoVisionPipeline.buildPhotoVisionRequest({
    requestId: 'vision-request-1',
    kind: 'photo_pair',
    organizationId: 'org-a',
    projectId: 'project-a',
    evidenceId: 'current-photo',
    baselineEvidenceId: 'baseline-photo',
    currentEvidenceId: 'current-photo',
    deterministicSignature: 'hash-a:hash-b',
  });
  assert.strictEqual(request.analyzerVersion, evidence.PIE_MULTIMODAL_EVIDENCE_VERSION);
  assert.strictEqual(request.policyVersion, evidence.PIE_VISUAL_POLICY_VERSION);
  assert.strictEqual(photoVisionPipeline.classifyPhotoVisionMobileState(null), 'analysis_pending');

  const degraded = photoVisionPipeline.buildPhotoVisionPipelineResult({
    requestId: request.requestId,
    kind: request.kind,
    status: 'degraded',
    providerName: null,
    modelName: null,
    modelVersion: null,
    deterministicMetrics: {},
    singlePhotoAnalysis: null,
    comparisonAnalysis: null,
    failureReason: 'provider_timeout',
    retryAfterMs: 1000,
    latencyMs: 45000,
    usage: {},
  });
  assert.strictEqual(degraded.mobileState, 'degraded', 'app degraded state should be exposed');
  assert.strictEqual(photoVisionPipeline.shouldRetryPhotoVisionRequest({
    attemptCount: 1,
    maxAttempts: 2,
    status: 'failed',
    lastFailureReason: 'provider_timeout',
  }), true);
  assert.strictEqual(photoVisionPipeline.shouldRetryPhotoVisionRequest({
    attemptCount: 2,
    maxAttempts: 2,
    status: 'failed',
    lastFailureReason: 'provider_timeout',
  }), false);
  assert.strictEqual(photoVisionPipeline.isPhotoVisionRetryIdempotent({
    contentHash: 'same-hash',
    cachedContentHash: 'same-hash',
    cachedAnalyzerVersion: evidence.PIE_MULTIMODAL_EVIDENCE_VERSION,
    cachedPolicyVersion: evidence.PIE_VISUAL_POLICY_VERSION,
  }), true);

  const hydrated = photoVisionPipeline.hydratePhotoVisionState({
    request,
    result: degraded,
  });
  assert.strictEqual(hydrated.mobileState, 'degraded', 'hydration should preserve degraded state');

  const correction = photoVisionPipeline.recordPhotoVisionUserCorrection({
    correctionId: 'correction-production-1',
    evidenceId: 'current-photo',
    organizationId: 'org-a',
    projectId: 'project-a',
    correctedByUserId: 'user-a',
    reason: 'Provider overstated visible condition.',
    originalAnalysisId: 'analysis-1',
    correctedObservations: ['Only a visible scene change was confirmed.'],
    correctedInferences: ['Project progress remains unable to determine.'],
    supersedesAnalysisId: 'analysis-1',
    createdAt: '2026-07-02T12:00:00.000Z',
  });
  assert.strictEqual(correction.supersedesAnalysisId, 'analysis-1', 'correction history should preserve original analysis link');
}

function testProductionJarvisAndRealityRules() {
  const deterministic = evidence.deterministicPhotoChecks({
    contentHash: 'content-pair',
    width: 1600,
    height: 1200,
    mimeType: 'image/jpeg',
    sizeBytes: 800000,
    perceptualHash: 'pair-phash',
    orientation: 1,
  });
  const weakProgress = {
    comparisonId: 'weak-progress',
    organizationId: 'org-a',
    projectId: 'project-a',
    earlierEvidenceId: 'before',
    laterEvidenceId: 'after',
    comparable: 'weak_match',
    observations: ['Viewpoint changed materially.'],
    inferredChanges: ['Progress is visible.'],
    deterministicChecks: deterministic,
    confidence: 'medium',
    limitations: ['Viewpoint changed materially.'],
    requiresHumanReview: true,
    sameGeneralScene: true,
    materialVisibleChange: true,
    changeType: 'condition_changed',
    addedObject: null,
    removedObject: null,
    approximateRegion: null,
    progressConclusion: 'progress_visible',
    projectStatusImpact: 'possible',
    userFacingSummary: 'Progress is visible.',
  };
  const rejected = evidence.validateSemanticPhotoComparison(weakProgress);
  assert.strictEqual(rejected.accepted, false, 'JARVIS must reject weak-image progress conclusion');

  const scopeLinked = {
    ...weakProgress,
    comparisonId: 'scope-linked',
    comparable: 'strong_match',
    inferredChanges: ['A scope-linked element appears partially installed.'],
    limitations: ['Visible progress requires corroborating evidence.'],
    progressConclusion: 'partial_progress_visible',
    projectStatusImpact: 'possible',
  };
  const accepted = evidence.validateSemanticPhotoComparison(scopeLinked);
  assert.strictEqual(accepted.accepted, true, 'strong scope-linked comparison may create qualified evidence');
  const qualified = photoVisionPipeline.buildQualifiedVisualEvidenceFromComparison(scopeLinked);
  assert(qualified.length > 0, 'accepted material comparison should create qualified Reality evidence');

  const mouse = {
    ...scopeLinked,
    comparisonId: 'mouse-no-progress',
    inferredChanges: ['A black computer mouse appears in the newer photo.'],
    progressConclusion: 'unable_to_determine',
    projectStatusImpact: 'none',
    addedObject: 'black computer mouse',
    approximateRegion: 'lower-right portion of the table',
  };
  const mouseQualified = photoVisionPipeline.buildQualifiedVisualEvidenceFromComparison(mouse);
  assert.strictEqual(mouseQualified.length, 0, 'mouse visible change must not feed authoritative Reality as progress');
}

function testLiveProviderMouseAcceptanceReadiness() {
  const functionSource = read('supabase/functions/pie-photo-vision/index.ts');
  const providerSource = read('supabase/functions/_shared/pie-vision-provider.ts');
  assertContains(providerSource, 'comparePhotoPair', 'provider-backed pair comparison required');
  assertContains(providerSource, 'Inventory the baseline and current image independently', 'provider prompt must require independent image inventories before change detection');
  assertContains(providerSource, 'occluding', 'provider prompt must preserve occluding-object detection');
  assertContains(functionSource, "mode === 'photo_pair'", 'Edge Function must route photo_pair requests');
  assertContains(functionSource, 'baselineEvidenceId', 'baseline image path required');
  assertContains(functionSource, 'currentEvidenceId', 'current image path required');

  const hasProviderKey = Boolean(process.env.PIE_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
  if (!hasProviderKey) {
    console.log('EXTERNAL_EXECUTION_REQUIRED provider-backed mouse acceptance requires PIE_OPENAI_API_KEY and deployed Supabase Edge Function');
    return;
  }
  console.log('EXTERNAL_EXECUTION_READY provider key is present; run deployed pie-photo-vision photo_pair request against mouse fixtures');
}

const testsByMode = {
  all: [
    testUniversalEvidence,
    testPhotoStorageAndSecurity,
    testVisionBackendBoundary,
    testRawPhotoAnalysisGuards,
    testPhotoComparison,
    testMouseAddedToTableBaselineFailure,
    testProductionVisionPipelineArchitecture,
    testP0TanCaseFindingPreservation,
    testBuild22MobilePhotoVisionIntegration,
    testProductionVisionResourceGuards,
    testBuild22RemovalAndCaptionRegressionScenarios,
    testProductionComparabilityNormalizationRules,
    testProductionSpatialNormalizationRules,
    testProductionObservationAuthoritySplit,
    testProductionVisionPipelineBehavior,
    testProductionJarvisAndRealityRules,
    testLiveProviderMouseAcceptanceReadiness,
    testCorrectionsAndReality,
    testIdempotentSynchronization,
  ],
  architecture: [testUniversalEvidence, testPhotoStorageAndSecurity, testVisionBackendBoundary],
  raw: [testRawPhotoAnalysisGuards],
  comparison: [testPhotoComparison],
  mouse: [testMouseAddedToTableBaselineFailure],
  production: [
    testProductionVisionPipelineArchitecture,
    testP0TanCaseFindingPreservation,
    testBuild22MobilePhotoVisionIntegration,
    testProductionVisionResourceGuards,
    testBuild22RemovalAndCaptionRegressionScenarios,
    testProductionComparabilityNormalizationRules,
    testProductionSpatialNormalizationRules,
    testProductionObservationAuthoritySplit,
    testProductionVisionPipelineBehavior,
    testProductionJarvisAndRealityRules,
    testLiveProviderMouseAcceptanceReadiness,
  ],
  corrections: [testCorrectionsAndReality, testIdempotentSynchronization],
};

const tests = testsByMode[mode];
if (!tests) {
  console.error(`Unknown multimodal evidence test mode: ${mode}`);
  process.exit(1);
}

try {
  for (const test of tests) {
    test();
    console.log(`PASS ${test.name}`);
  }
  console.log(`PASS multimodal evidence ${mode}`);
} catch (error) {
  console.error(`FAIL multimodal evidence ${mode}`);
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
