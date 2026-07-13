#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(file) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const moduleValue = { exports: {} };
  vm.runInNewContext(compiled.outputText, { module: moduleValue, exports: moduleValue.exports, require, Object, Date, Set }, { filename: file });
  return moduleValue.exports;
}

const memory = load('services/DAVECaptureMemory.ts');
const sheet = fs.readFileSync(path.join(root, 'components/DAVECaptureConfirmationSheet.tsx'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'screens/AdminScreen.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');

[
  'Source transcript', 'What I remember', 'Recommended project', 'Recommended location',
  'Person or company', 'Commitment', 'Due date', 'Decision', 'Owner request',
  'Inspection change', 'Schedule change', 'Issue', 'Risk', 'Follow-up',
  'General memory', 'Confidence and limitations', 'Save Memory', 'Cancel',
].forEach(marker => assert(sheet.includes(marker), `Confirmation sheet must render ${marker}.`));
assert(sheet.includes('<Text style={styles.transcript}>{transcript}</Text>'), 'Sheet must render its supplied transcript.');
assert(sheet.includes('buildMemoryConfirmation(working)') && sheet.includes('buildAssignmentUncertainty('), 'Sheet must use deterministic human-language builders.');

assert(sheet.includes("correctCaptureMemory(current, 'project'") && sheet.includes("correctCaptureMemory(current, 'location'"), 'Project and location corrections must be independent.');
assert(sheet.includes('correctCaptureMemory(current, field, value || null'), 'Structured fields must remain editable before save.');
assert(sheet.includes('confirmCaptureMemory(working') && sheet.includes('confirmedCaptureMemoryForSave(confirmed)'), 'Save must cross the confirmation boundary and use only confirmedCaptureMemoryForSave().');
assert(sheet.includes('await onSave(eligible)') && sheet.includes('disabled={isSaving}'), 'Save must await persistence and prevent duplicate taps.');

const cancelBody = sheet.slice(sheet.indexOf('function cancel()'), sheet.indexOf('const limitations'));
assert(cancelBody.includes('cancelCaptureMemory(') && cancelBody.includes('onCancel()') && !cancelBody.includes('onSave('), 'Cancel must save nothing.');

let draft = memory.createCaptureMemory({
  id: 'ui-memory', transcript: 'ABC Electric will finish conduit.', transcriptSourceRecordId: 'ui-transcript', createdAt: '2026-07-12T08:00:00.000Z',
  recommendedProject: { value: 'Canopy B', confidence: 'medium' },
  recommendedLocation: { value: 'Electrical room', confidence: 'low' },
  fields: { commitment: 'Finish conduit.', dueDate: null },
});
assert.strictEqual(draft.fields.dueDate, null, 'Missing date must stay missing.');
assert.throws(() => memory.confirmCaptureMemory(draft, '2026-07-12T08:01:00.000Z'), /Project confirmation/);
draft = memory.correctCaptureMemory(draft, 'project', 'Canopy C', '2026-07-12T08:01:00.000Z');
assert.strictEqual(draft.recommendedLocation.confirmed, false, 'Project correction must not confirm location.');
draft = memory.correctCaptureMemory(draft, 'location', 'Roof level', '2026-07-12T08:02:00.000Z');
draft = memory.correctCaptureMemory(draft, 'commitment', 'Finish and photograph conduit.', '2026-07-12T08:03:00.000Z');
const confirmed = memory.confirmCaptureMemory(draft, '2026-07-12T08:04:00.000Z');
assert.strictEqual(memory.confirmedCaptureMemoryForSave(confirmed).fields.commitment, 'Finish and photograph conduit.');

assert(admin.includes('{__DEV__ ? (') && admin.includes('label="Preview Capture Confirmation"'), 'Developer preview must be guarded by __DEV__.');
const previewIndex = admin.indexOf('label="Preview Capture Confirmation"');
assert(admin.lastIndexOf('{__DEV__ ? (', previewIndex) >= 0, 'Preview entry must not appear in normal production UI.');
assert(admin.includes('await onSaveCaptureMemory(memory)') && admin.includes('saved locally'), 'Confirmed preview memory must cross the supplied local persistence boundary.');
assert(!admin.includes('saveCloudUpdate') && !admin.includes('AsyncStorage.setItem'), 'The confirmation UI must not add cloud persistence or bypass the repository.');
assert(app.includes('localDAVECaptureMemoryRepository.list()') && app.includes('localDAVECaptureMemoryRepository.save(memory)'), 'App must hydrate and save confirmed memories through the repository.');
assert(app.includes('captureMemories={captureMemories}') && app.includes('captureMemories,\n  }),'), 'Selected-project intelligence must refresh from hydrated capture memories.');

['extracted', 'classified', 'processing', 'operation completed', 'contractor commitment detected'].forEach(term => {
  assert(!sheet.toLowerCase().includes(term), `Confirmation sheet leaked internal language: ${term}`);
});

console.log('DAVE Capture Confirmation UI tests passed.');
