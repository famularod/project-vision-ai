#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const moduleCache = new Map();

function loadTypeScriptModule(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;

  const source = fs.readFileSync(absolutePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: absolutePath,
  }).outputText;
  const moduleUnderTest = { exports: {} };
  moduleCache.set(absolutePath, moduleUnderTest);

  const localRequire = request => {
    if (!request.startsWith('.')) return require(request);
    const resolved = path.resolve(path.dirname(absolutePath), request);
    const withExtension = fs.existsSync(`${resolved}.ts`) ? `${resolved}.ts` : resolved;
    return loadTypeScriptModule(path.relative(root, withExtension));
  };

  new Function('require', 'module', 'exports', compiled)(
    localRequire,
    moduleUnderTest,
    moduleUnderTest.exports,
  );
  return moduleUnderTest.exports;
}

const { extractScheduleItemsFromCommunicationText } = loadTypeScriptModule(
  'services/PIEScheduleCommunicationImport.ts',
);

const result = extractScheduleItemsFromCommunicationText({
  text: [
    'Alex will finish electrical rough-in in Canopy B',
    'by Friday.',
    'Concrete patch is blocked waiting for material.',
    'Sent from my iPhone',
  ].join('\n'),
  sourceName: 'Messages screenshot.png',
  projects: ['Building 2375 Compliance'],
  projectAreas: [{
    id: 'area-canopy-b',
    name: 'Canopy B',
    latitude: 0,
    longitude: 0,
    radiusFeet: 250,
  }],
  recognitionConfidence: 0.94,
  now: new Date('2026-07-13T12:00:00-07:00'),
});

assert.strictEqual(result.items.length, 2, 'Two schedule commitments should be extracted without overlapping duplicates.');
const roughIn = result.items.find(item => item.taskName.toLowerCase().includes('electrical rough-in'));
assert(roughIn, 'Electrical rough-in should be extracted.');
assert.strictEqual(roughIn.finishDate, '07/17/2026', 'Relative weekday dates should resolve from import time.');
assert.strictEqual(roughIn.locationName, 'Canopy B', 'Known areas should be matched from screenshot text.');
assert.strictEqual(roughIn.owner, 'Alex', 'A named commitment owner should be extracted.');
assert.strictEqual(roughIn.status, 'Not Started', 'Future completion language must not be treated as completed work.');

const blocked = result.items.find(item => item.taskName.toLowerCase().includes('concrete patch'));
assert(blocked, 'Blocked concrete work should be extracted.');
assert.strictEqual(blocked.status, 'Waiting', 'Blocked language should become a reviewable Waiting draft status.');
assert.strictEqual(blocked.finishDate, '', 'DAVE must not invent a missing date.');
assert(result.reviewCount >= 1, 'Missing project, area, owner, or date fields should require review.');

const noCommitment = extractScheduleItemsFromCommunicationText({
  text: 'Thanks for the update. See you at the site.',
  sourceName: 'email.png',
  now: new Date('2026-07-13T12:00:00-07:00'),
});
assert.strictEqual(noCommitment.items.length, 0, 'Ordinary message text must not become a schedule activity.');

const moduleConfig = JSON.parse(fs.readFileSync(
  path.join(root, 'modules/dave-text-recognition/expo-module.config.json'),
  'utf8',
));
const nativeSource = fs.readFileSync(
  path.join(root, 'modules/dave-text-recognition/ios/DaveTextRecognitionModule.swift'),
  'utf8',
);
assert.deepStrictEqual(moduleConfig.platforms, ['apple'], 'Screenshot OCR should remain an Apple-local module.');
assert(nativeSource.includes('VNRecognizeTextRequest'), 'Apple Vision must perform local screenshot OCR.');
assert(nativeSource.includes('usesLanguageCorrection = true'), 'Local OCR should use language correction.');

console.log('PASS schedule communication screenshot import');
