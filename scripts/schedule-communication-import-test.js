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
    const withExtension = fs.existsSync(`${resolved}.ts`)
      ? `${resolved}.ts`
      : fs.existsSync(path.join(resolved, 'index.ts'))
        ? path.join(resolved, 'index.ts')
        : resolved;
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
const {
  normalizeImportedScheduleNote,
  normalizeMicrosoftProjectPdfRows,
  normalizeScheduleImport,
} = loadTypeScriptModule(
  'services/PIEScheduleIntelligence.ts',
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
assert.strictEqual(
  roughIn.notes,
  'Alex will finish electrical rough-in in Canopy B by Friday.',
  'Communication imports should retain only the human-authored message, not extraction metadata.',
);

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

const structuredPdfItems = normalizeMicrosoftProjectPdfRows({
  contents: [
    'ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete\tActual Start\tActual Finish\tPredecessors',
    '2\tPLZ 2321 THIRD STREET CAMPUS\t0\t30 days\tMon 6/22/26\tFri 7/31/26\t0%\tNA\tNA\t',
    '3\tPHASE 2 - NORTH LOT & DRIVEWAY\t1\t20 days\tMon 6/22/26\tFri 7/17/26\t0%\tNA\tNA\t',
    '4\tGRADING AND PAVING\t2\t10 days\tMon 6/22/26\tFri 7/3/26\t0%\tNA\tNA\t',
    '6\tSAWCUT NEW TRENCH, BREAK & REMOVE\t3\t1 day\tWed 7/1/26\tWed 7/1/26\t0%\tNA\tNA\t4',
    '5\tPLACE CONCRETE PAVING (NORTH LOT)\t3\t2 days\tThu 7/2/26\tFri 7/3/26\t50%\tNA\tNA\t4',
    '412\tPLACE CONCRETE PAVING (EAST DRIVEWAY)\t3\t2 days\tFri 7/10/26\tMon 7/13/26\t0%\tNA\tNA\t5',
    '413\tSITE CLEANUP\t3\t1 day\tTue 7/14/26\tTue 7/14/26\t0%\tNA\tNA\t412',
    '407\tPLZ 2375 THIRD STREET CAMPUS\t0\t30 days\tMon 6/22/26\tFri 7/31/26\t0%\tNA\tNA\t',
    '408\tCANOPY B\t1\t10 days\tMon 6/22/26\tFri 7/3/26\t0%\tNA\tNA\t',
    '409\tFORM COLUMN CONCRETE BASES\t2\t1 day\tThu 7/2/26\tThu 7/2/26\t100%\tNA\tNA\t408',
    '410\tUTILITY CORRIDOR\t1\t5 days\tMon 7/6/26\tFri 7/10/26\t0%\tNA\tNA\t',
    '411\tINSTALL UNKNOWN UTILITY\t2\t1 day\tFri 7/10/26\tFri 7/10/26\t0%\tNA\tNA\t410',
    '414\tSITE CLEANUP\t2\t1 day\tTue 7/14/26\tTue 7/14/26\t0%\tNA\tNA\t411',
  ].join('\n'),
  sourceName: 'PLZ 2321 and 2375 lookahead.pdf',
  projects: [
    '2321 North Side Lot',
    '2321 Trash Enclosure',
    'Building 2321 East Driveway',
    'Building 2375 Compliance',
    'Canopy B',
  ],
  projectAreas: [
    { id: 'north-lot', name: 'North Lot', latitude: 0, longitude: 0, radiusFeet: 250 },
    { id: 'east-driveway', name: 'East Driveway', latitude: 0, longitude: 0, radiusFeet: 250 },
    { id: 'canopy-b', name: 'Canopy B', latitude: 0, longitude: 0, radiusFeet: 250 },
  ],
  now: new Date('2026-07-13T12:00:00-07:00'),
});

assert.strictEqual(structuredPdfItems.length, 7, 'Only leaf activities should become review items; summary rows must stay context only.');
const commaTask = structuredPdfItems.find(item => item.taskName.includes('BREAK & REMOVE'));
assert(commaTask, 'Commas inside Microsoft Project task names must not shift TSV columns.');
assert.strictEqual(commaTask.scheduleProjectName, '2321 Compliance Project', 'Comma-containing tasks must retain their Gantt parent project.');
assert(
  structuredPdfItems.every(item => item.notes === ''),
  'Microsoft Project metadata must not be auto-populated into the PM-facing Notes field.',
);
const northLotTask = structuredPdfItems.find(item => item.taskName.includes('CONCRETE PAVING'));
assert(northLotTask, 'The North Lot leaf activity should be extracted.');
assert.strictEqual(northLotTask.projectName, '2321 North Side Lot', 'The 2321 schedule branch should map to the 2321 project.');
assert.strictEqual(northLotTask.scheduleProjectName, '2321 Compliance Project', 'The 2321 Gantt branch should retain its main compliance project.');
assert.strictEqual(northLotTask.locationName, 'North Lot', 'The North Lot task should inherit only the North Lot area.');
assert.strictEqual(northLotTask.finishDate, '07/03/2026', 'Microsoft Project finish dates should be normalized.');
assert.strictEqual(northLotTask.status, 'In Progress', 'Microsoft Project percent complete should determine status.');
assert.strictEqual(northLotTask.durationDays, 2, 'Duration should remain structured schedule data instead of being copied into Notes.');

const canopyTask = structuredPdfItems.find(item => item.taskName.includes('COLUMN CONCRETE'));
assert(canopyTask, 'The Canopy B leaf activity should be extracted.');
assert.strictEqual(canopyTask.projectName, 'Building 2375 Compliance', 'The 2375 schedule branch should map to the 2375 project.');
assert.strictEqual(canopyTask.scheduleProjectName, '2375 Compliance Project', 'The 2375 Gantt branch should retain its main compliance project.');
assert.strictEqual(canopyTask.locationName, 'Canopy B', 'The Canopy B task should inherit only the Canopy B area.');
assert.strictEqual(canopyTask.status, 'Complete', 'Completed Microsoft Project activities should remain complete.');

const eastDrivewayTask = structuredPdfItems.find(item => item.taskName.includes('EAST DRIVEWAY'));
assert(eastDrivewayTask, 'An explicitly named East Driveway activity should be extracted.');
assert.strictEqual(eastDrivewayTask.projectName, 'Building 2321 East Driveway', 'A clearly different saved sub-project should override inherited project context.');
assert.strictEqual(eastDrivewayTask.locationName, 'East Driveway', 'A clearly different saved area should override inherited area context.');

const unknownAreaTask = structuredPdfItems.find(item => item.taskName.includes('UNKNOWN UTILITY'));
assert(unknownAreaTask, 'An activity under an unmapped area should still be available for review.');
assert.strictEqual(unknownAreaTask.projectName, 'Building 2375 Compliance', 'Known project context should be retained under an unknown area.');
assert.strictEqual(unknownAreaTask.locationName, '', 'DAVE must not guess an area when the PDF heading cannot be matched to a saved area.');

const repeatedSiteCleanupTasks = structuredPdfItems.filter(item => item.taskName === 'SITE CLEANUP');
assert.strictEqual(repeatedSiteCleanupTasks.length, 2, 'The same type of work at both locations must remain two separate tasks.');
assert.deepStrictEqual(
  repeatedSiteCleanupTasks.map(item => item.scheduleProjectName).sort(),
  ['2321 Compliance Project', '2375 Compliance Project'],
  'Identically named work must retain the Gantt branch that identifies its main project.',
);

const genericMultiProjectItems = normalizeMicrosoftProjectPdfRows({
  contents: [
    'ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete\tActual Start\tActual Finish\tPredecessors',
    '1\tALPHA MEDICAL CENTER\t0\t10 days\tMon 7/13/26\tFri 7/24/26\t0%\tNA\tNA\t',
    '2\tSITE CLEANUP\t1\t1 day\tThu 7/23/26\tThu 7/23/26\t0%\tNA\tNA\t1',
    '3\tBETA LOGISTICS HUB\t0\t10 days\tMon 7/13/26\tFri 7/24/26\t0%\tNA\tNA\t',
    '4\tSITE CLEANUP\t1\t1 day\tThu 7/23/26\tThu 7/23/26\t0%\tNA\tNA\t3',
    '5\tGAMMA WATER PLANT\t0\t10 days\tMon 7/13/26\tFri 7/24/26\t0%\tNA\tNA\t',
    '6\tSTARTUP TESTING\t1\t1 day\tFri 7/24/26\tFri 7/24/26\t0%\tNA\tNA\t5',
  ].join('\n'),
  sourceName: 'multi-project-master-schedule.pdf',
  now: new Date('2026-07-13T12:00:00-07:00'),
});
assert.deepStrictEqual(
  genericMultiProjectItems.map(item => item.scheduleProjectName),
  ['ALPHA MEDICAL CENTER', 'BETA LOGISTICS HUB', 'GAMMA WATER PLANT'],
  'Every top-level Gantt project must become its own parent without a fixed project-name list or project-count limit.',
);
assert.strictEqual(
  genericMultiProjectItems.filter(item => item.taskName === 'SITE CLEANUP').length,
  2,
  'Repeated task names in different arbitrary projects must remain separate activities.',
);

const structuredExplicitNoteItems = normalizeMicrosoftProjectPdfRows({
  contents: [
    'ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete\tNotes',
    '1\tALPHA MEDICAL CENTER\t0\t10 days\tMon 7/13/26\tFri 7/24/26\t0%\t',
    '2\tSITE CLEANUP\t1\t1 day\tThu 7/23/26\tThu 7/23/26\t0%\tCoordinate gate access with security.',
  ].join('\n'),
  sourceName: 'schedule-with-notes.pdf',
  now: new Date('2026-07-13T12:00:00-07:00'),
});
assert.strictEqual(
  structuredExplicitNoteItems[0]?.notes,
  'Coordinate gate access with security.',
  'An explicitly labeled Microsoft Project Notes column should remain visible to the PM.',
);

const unlabeledMetadataImport = normalizeScheduleImport({
  contents: [
    'Task,Project,Area,Start,Finish,Milestone,Owner,Status,Actual Start,Contractor,WBS,% Complete,Float,Priority,Critical,Duration',
    'Roofing,Alpha Medical Center,Roof,,,,Alex,In Progress,Imported metadata,Roofing Co,A100,25%,0,,yes,3 days',
  ].join('\n'),
  sourceName: 'schedule-without-notes.csv',
  now: new Date('2026-07-13T12:00:00-07:00'),
});
assert.strictEqual(
  unlabeledMetadataImport.items[0]?.notes,
  '',
  'An unlabeled schedule column must never fall back into the PM-facing Notes field.',
);

const explicitNotesImport = normalizeScheduleImport({
  contents: [
    'Task,Project,Area,Start,Finish,Milestone,Owner,Status,Notes,Contractor,WBS,% Complete,Float,Priority,Critical,Duration',
    'Roofing,Alpha Medical Center,Roof,,,,Alex,In Progress,Protect finished lobby floors.,Roofing Co,A100,25%,0,,yes,3 days',
  ].join('\n'),
  sourceName: 'schedule-with-notes.csv',
  now: new Date('2026-07-13T12:00:00-07:00'),
});
assert.strictEqual(
  explicitNotesImport.items[0]?.notes,
  'Protect finished lobby floors.',
  'Only an explicitly labeled Notes, Comments, or Remarks value should populate schedule Notes.',
);
assert.strictEqual(
  explicitNotesImport.items[0]?.durationDays,
  3,
  'Duration should remain structured schedule data without being copied into Notes.',
);

for (const noteHeader of ['Comments', 'Remarks']) {
  const labeledNoteImport = normalizeScheduleImport({
    contents: [
      `Task,Project,Area,Start,Finish,Milestone,Owner,Status,${noteHeader}`,
      'Roofing,Alpha Medical Center,Roof,,,,Alex,In Progress,Protect finished lobby floors.',
    ].join('\n'),
    sourceName: `schedule-with-${noteHeader.toLowerCase()}.csv`,
    now: new Date('2026-07-13T12:00:00-07:00'),
  });
  assert.strictEqual(
    labeledNoteImport.items[0]?.notes,
    'Protect finished lobby floors.',
    `${noteHeader} should be treated as an explicitly labeled PM-facing note column.`,
  );
}

assert.strictEqual(
  normalizeImportedScheduleNote(
    'Activity ID: 124. Duration: 2 days. Imported from a structured Microsoft Project PDF; verify highlighted fields before approval.',
    'legacy-schedule.pdf',
  ),
  '',
  'Previously generated Microsoft Project metadata should be removed when saved tasks reload.',
);
assert.strictEqual(
  normalizeImportedScheduleNote(
    'Coordinate shutdown with facilities. Activity ID: 124. Duration: 2 days. Imported from a structured Microsoft Project PDF; verify highlighted fields before approval.',
    'legacy-schedule.pdf',
  ),
  'Coordinate shutdown with facilities.',
  'Legacy cleanup must preserve a PM-authored note that precedes generated Microsoft Project metadata.',
);
assert.strictEqual(
  normalizeImportedScheduleNote(
    'Coordinate shutdown with operations. WBS: A100 Duration: 2 days Critical: yes Schedule confidence: high.',
    'legacy-schedule.csv',
  ),
  'Coordinate shutdown with operations.',
  'Legacy cleanup should preserve a genuine note while removing its generated metadata suffix.',
);
assert.strictEqual(
  normalizeImportedScheduleNote(
    'Manual note: coordinate with the owner before shutdown.',
    null,
  ),
  'Manual note: coordinate with the owner before shutdown.',
  'A manually entered note must remain unchanged.',
);
assert.strictEqual(
  normalizeImportedScheduleNote(
    'Protect finished lobby floors.',
    'schedule-with-notes.csv',
  ),
  'Protect finished lobby floors.',
  'Hydration cleanup must preserve a legitimate note from an explicitly labeled source column.',
);
assert.strictEqual(
  normalizeImportedScheduleNote(
    'Extracted locally from Messages screenshot.png. Original message: Crew will mobilize Monday. Extraction confidence: 90%. The message does not independently verify field status. Review this extracted activity before relying on it.',
    'Messages screenshot.png',
  ),
  'Crew will mobilize Monday.',
  'Legacy communication imports should keep the original message while removing extraction boilerplate.',
);

const moduleConfig = JSON.parse(fs.readFileSync(
  path.join(root, 'modules/dave-text-recognition/expo-module.config.json'),
  'utf8',
));
const nativeSource = fs.readFileSync(
  path.join(root, 'modules/dave-text-recognition/ios/DaveTextRecognitionModule.swift'),
  'utf8',
);
const scheduleIntelligenceSource = fs.readFileSync(
  path.join(root, 'services/PIEScheduleIntelligence.ts'),
  'utf8',
);
assert.deepStrictEqual(moduleConfig.platforms, ['apple'], 'Screenshot OCR should remain an Apple-local module.');
assert(nativeSource.includes('VNRecognizeTextRequest'), 'Apple Vision must perform local screenshot OCR.');
assert(nativeSource.includes('PDFDocument(url: pdfUrl)'), 'Apple PDFKit must extract embedded PDF text locally.');
assert(nativeSource.includes('AsyncFunction("extractTextFromPdf")'), 'The native module must expose PDF text extraction to the app.');
assert(nativeSource.includes('selection.selectionsByLine()'), 'PDFKit extraction must preserve visually aligned Microsoft Project rows.');
assert(nativeSource.includes('microsoft_project_tsv'), 'Structured Microsoft Project rows must be explicitly identified for deterministic parsing.');
assert(
  scheduleIntelligenceSource.includes(".split('\\n')") &&
    scheduleIntelligenceSource.includes(".join('\\n')"),
  'PDF text cleanup must retain schedule row boundaries extracted by PDFKit.',
);
assert(nativeSource.includes('usesLanguageCorrection = true'), 'Local OCR should use language correction.');
assert(
  nativeSource.includes('DispatchQueue.global(qos: .userInitiated).async') &&
    nativeSource.includes('promise.resolve(result)'),
  'Screenshot OCR must explicitly resolve from a background queue so it cannot block the app UI.',
);
assert(
  nativeSource.includes('downsampleImage(at: imageUrl, maximumDimension: 1_600)') &&
    nativeSource.includes('CGImageSourceCreateThumbnailAtIndex') &&
    nativeSource.includes('request.recognitionLevel = .fast'),
  'Screenshot OCR should downsample before decoding and use the responsive recognition path.',
);

console.log('PASS schedule communication screenshot import');
