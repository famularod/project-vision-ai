#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(file, modules = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const moduleValue = { exports: {} };
  vm.runInNewContext(compiled.outputText, { module: moduleValue, exports: moduleValue.exports, require: request => modules[request] || require(request), Object, Date, Set }, { filename: file });
  return moduleValue.exports;
}

const memory = load('services/DAVECaptureMemory.ts');
const language = load('services/DAVEConversationLanguage.ts', { './DAVECaptureMemory': memory });

const draft = memory.createCaptureMemory({
  id: 'memory-1',
  transcript: 'ABC Electric agreed to finish the conduit by Friday in the electrical room.',
  transcriptSourceRecordId: 'transcript-record-1',
  createdAt: '2026-07-12T08:00:00.000Z',
  recommendedProject: { value: 'Canopy B', confidence: 'medium', evidenceIds: ['project-evidence-1'] },
  recommendedLocation: { value: 'Electrical room', confidence: 'high', evidenceIds: ['location-evidence-1'] },
  fields: { peopleOrCompany: 'ABC Electric', commitment: 'Finish the conduit by Friday.', dueDate: null },
});

assert(Object.isFrozen(draft) && Object.isFrozen(draft.fields));
assert.strictEqual(memory.confirmedCaptureMemoryForSave(draft), null, 'Unconfirmed memory must never be saveable.');
assert.strictEqual(draft.fields.dueDate, null, 'A missing calendar date must remain missing.');
assert(draft.evidence.some(item => item.kind === 'transcript' && item.sourceRecordId === 'transcript-record-1'));

const correctedProject = memory.correctCaptureMemory(draft, 'project', 'Canopy C', '2026-07-12T08:01:00.000Z');
assert.strictEqual(correctedProject.recommendedProject.value, 'Canopy C');
assert.strictEqual(correctedProject.recommendedProject.confirmed, true);
assert.strictEqual(correctedProject.recommendedLocation.confirmed, false, 'Project correction must not silently confirm location.');
const confirmedLocation = memory.confirmCaptureLocation(correctedProject, 'Electrical room');
const confirmed = memory.confirmCaptureMemory(confirmedLocation, '2026-07-12T08:02:00.000Z');
assert.strictEqual(memory.confirmedCaptureMemoryForSave(confirmed), confirmed);
assert.strictEqual(confirmed.transcript, draft.transcript, 'Confirmation must preserve transcript evidence.');

const ambiguous = memory.createCaptureMemory({ id: 'memory-2', transcript: 'They will call tomorrow.', transcriptSourceRecordId: 't2', createdAt: '2026-07-12T09:00:00.000Z' });
assert.strictEqual(ambiguous.recommendedProject.value, null);
assert.throws(() => memory.confirmCaptureMemory(ambiguous, '2026-07-12T09:01:00.000Z'), /Project confirmation/);
const cancelled = memory.cancelCaptureMemory(ambiguous, '2026-07-12T09:02:00.000Z');
assert.strictEqual(memory.confirmedCaptureMemoryForSave(cancelled), null, 'Cancellation must save nothing.');

const disagreement = language.buildRespectfulDisagreement(true);
assert.strictEqual(disagreement, 'I remember it differently. Would you like to see what I’m basing that on?');
assert(disagreement.includes('basing that on'), 'Respectful disagreement must offer evidence.');
assert.strictEqual(language.buildAssignmentUncertainty('Canopy B', 'the electrical room'), 'I think that belongs to Canopy B, in the electrical room. Is that right?');

const outputs = [
  language.buildMemoryConfirmation(draft), language.buildAssignmentUncertainty(null, null),
  language.buildCorrectionAcknowledgement('project'), disagreement,
  language.buildSaveConfirmation('Canopy C'), language.buildFollowUpPrompt(null),
  language.buildInsufficientEvidence('due date'),
];
outputs.forEach(output => assert(!language.conversationLanguageUsesInternalTerminology(output), `Human language leaked software terminology: ${output}`));

console.log('DAVE Capture Memory framework tests passed.');
