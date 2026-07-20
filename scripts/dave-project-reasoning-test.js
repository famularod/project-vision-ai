#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const cache = new Map();
function loadTs(relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  if (cache.has(absolutePath)) return cache.get(absolutePath).exports;
  const moduleUnderTest = { exports: {} };
  cache.set(absolutePath, moduleUnderTest);
  const compiled = ts.transpileModule(fs.readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: absolutePath,
  }).outputText;
  const localRequire = specifier => {
    if (!specifier.startsWith('.')) return require(specifier);
    const base = path.resolve(path.dirname(absolutePath), specifier);
    const resolved = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find(candidate => fs.existsSync(candidate));
    if (!resolved) throw new Error(`Cannot resolve ${specifier}`);
    return loadTs(path.relative(root, resolved));
  };
  new Function('require', 'module', 'exports', compiled)(localRequire, moduleUnderTest, moduleUnderTest.exports);
  return moduleUnderTest.exports;
}

const { buildDAVEEvidenceCorrelations } = loadTs('services/DAVEEvidenceCorrelation.ts');
const { buildDAVEProjectReasoning } = loadTs('services/DAVEProjectReasoning.ts');
const { buildDAVEProjectTruth } = loadTs('services/DAVEProjectTruth.ts');
const NOW = '2026-07-16T18:00:00.000Z';

function task(id, overrides = {}) {
  return {
    id, scheduleProjectName: 'Alpha', projectName: 'Alpha', locationName: 'Pump House', taskName: id,
    startDate: '2026-07-01', finishDate: '2026-07-15', milestone: '', owner: 'Electrical Contractor',
    contractor: 'Electrical Contractor', percentComplete: 60, priority: 'High', status: 'In Progress', notes: '',
    createdAt: '2026-07-01T12:00:00.000Z', completionVerification: null, ...overrides,
  };
}
function evidence(id, kind, summary, recordedAt = '2026-07-16T12:00:00.000Z') {
  return { id, kind, sourceRecordId: id, sourceName: 'Field source', summary, recordedAt };
}
function verification(status, records) {
  return { status, reportedAt: '2026-07-16T12:00:00.000Z', reportedBy: 'Foreman', priorScheduleStatus: 'In Progress', priorPercentComplete: 60,
    verifiedAt: status === 'pm_verified' || status === 'rejected' ? '2026-07-16T16:00:00.000Z' : null,
    verifiedBy: status === 'pm_verified' || status === 'rejected' ? 'Project Manager' : null,
    verificationNote: null, evidence: records };
}
function update(id, taskId, notes, photoProgress = null, date = '2026-07-16T13:00:00.000Z') {
  const photos = photoProgress ? [{
    id: `${id}-photo`, uri: `file:///${id}.jpg`, caption: 'Visible installed equipment.', category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open', selectedAreaName: 'Pump House',
    photoIntelligence: { status: 'analysis_complete', title: 'Comparison', summary: 'Visible change.', visibleChange: 'Additional equipment is visible.', location: 'Pump House', comparisonConfidence: 'high', comparability: 'strong', captureLimitations: ['Electrical terminations are not visible.'], projectProgress: photoProgress, repeatPhotoGuidance: null, authorityMessage: 'PM verification required.', currentObservation: 'Equipment body is installed.', priorEvidenceId: 'prior-photo-evidence', provenance: 'visual_only', updatedAt: date },
  }] : [];
  return { id, projectName: 'Alpha', date, photos, notes, recipients: { contactIds: [] }, scheduleItemId: taskId, scheduleTaskName: taskId, selectedAreaName: 'Pump House', status: 'sent' };
}
function reason(items, updates = []) {
  const correlations = buildDAVEEvidenceCorrelations({ scheduleItems: items, updates, now: NOW });
  return buildDAVEProjectReasoning({ projectId: 'alpha', projectName: 'Alpha', scheduleItems: items, updates, correlations, now: NOW });
}

// A completion email plus a progress photo must not become verified completion.
const reportedTask = task('Install Pump', { completionVerification: verification('reported_complete', [evidence('email-1', 'email', 'Pump installation is complete.')]) });
const reported = reason([reportedTask], [update('update-1', reportedTask.id, '', 'supported')]);
const reportedDecision = reported.decisions[0];
assert.strictEqual(reportedDecision.classification, 'reasonable_inference');
assert.match(reportedDecision.conclusion, /marked complete and is awaiting PM approval/i);
assert(reportedDecision.hypotheses.length >= 4, 'DAVE must consider competing explanations.');
assert(reportedDecision.hypotheses.some(item => /visible or partial scope/i.test(item.statement)));
assert(reportedDecision.challenges.some(item => item.kind === 'authority_gap'));
assert(reportedDecision.reasoningSteps.some(item => item.startsWith('Alternative considered:')));
assert.strictEqual(reportedDecision.recommendation.owner, 'Project manager');
assert.match(reportedDecision.recommendation.consequenceOfInaction, /unsupported task status|overdue or incorrect/i);

// Conflicting non-PM sources must lower confidence and require immediate verification.
const conflictingTask = task('Conflicting Task', { completionVerification: verification('conflicting_evidence', [
  evidence('email-conflict', 'email', 'Electrical work is complete.'),
  evidence('screenshot-conflict', 'message_screenshot', 'Electrical terminations remain unfinished.'),
]) });
const conflict = reason([conflictingTask], [update('conflicting-photo', conflictingTask.id, '', 'supported')]);
const conflictDecision = conflict.decisions[0];
assert.strictEqual(conflictDecision.classification, 'unresolved_uncertainty');
assert.strictEqual(conflictDecision.confidence, 'low');
assert.strictEqual(conflictDecision.recommendation.timing, 'Now');
assert(conflictDecision.challenges.some(item => item.kind === 'source_conflict'));

// Schedule-only data must be presented as uncertainty, not truth.
const scheduleOnly = reason([task('Unobserved Task', { finishDate: '2026-08-20' })]);
assert.strictEqual(scheduleOnly.decisions[0].classification, 'unresolved_uncertainty');
assert(scheduleOnly.decisions[0].challenges.some(item => item.kind === 'missing_evidence'));
assert.match(scheduleOnly.decisions[0].conclusion, /not corroborated/i);

// Old evidence must be challenged for recency.
const staleTask = task('Stale Report', { completionVerification: verification('reported_complete', [evidence('old-email', 'email', 'Work complete.', '2026-06-01T12:00:00.000Z')]) });
const stale = reason([staleTask]);
assert(stale.decisions[0].challenges.some(item => item.kind === 'stale_evidence'));
assert.notStrictEqual(stale.decisions[0].confidence, 'high');

// PM decisions become durable learning cues and are the only completion authority.
const verifiedTask = task('Verified Task', { status: 'Complete', percentComplete: 100, completionVerification: verification('pm_verified', [
  evidence('email-verified', 'email', 'Work complete.'), evidence('pm-verified', 'pm_confirmation', 'Inspected and accepted.'),
]) });
const verified = reason([verifiedTask]);
assert.strictEqual(verified.decisions[0].classification, 'supported_conclusion');
assert.strictEqual(verified.decisions[0].confidence, 'high');
assert(verified.decisions[0].connections.some(item => item.relationship === 'completes'));
assert.strictEqual(verified.learnedOutcomeCount, 1);
assert.match(verified.decisions[0].learningCues[0], /preserve its evidence pattern/i);

// A generic field statement is not a PM decision. Newer contrary field evidence
// reopens verification; older field evidence does not supersede later PM truth.
const reopened = reason([verifiedTask], [update('post-verification', verifiedTask.id, 'Connections remain incomplete.', null, '2026-07-16T17:00:00.000Z')]);
assert.strictEqual(reopened.decisions[0].classification, 'unresolved_uncertainty');
assert.strictEqual(reopened.decisions[0].confidence, 'low');
assert.match(reopened.decisions[0].conclusion, /conflicting current status information/i);
assert(reopened.decisions[0].challenges.some(item => item.kind === 'source_conflict'));
const superseded = reason([verifiedTask], [update('pre-verification', verifiedTask.id, 'Connections remain incomplete.', null, '2026-07-16T14:00:00.000Z')]);
assert.strictEqual(superseded.decisions[0].classification, 'supported_conclusion');
assert.match(superseded.decisions[0].conclusion, /verified complete/i);

// Waiting work must create dependency reasoning and owner-specific follow-through.
const waiting = reason([task('Waiting Task', { status: 'Waiting', finishDate: '2026-07-20' })]);
assert(waiting.decisions[0].connections.some(item => item.relationship === 'depends_on'));
assert.strictEqual(waiting.decisions[0].recommendation.timing, 'Today');

// Project Truth must make the deeper reasoning available to the existing UI briefing.
const truth = buildDAVEProjectTruth({ projectId: 'alpha', projectName: 'Alpha', scheduleItems: [reportedTask], updates: [update('truth-update', reportedTask.id, '', 'supported')], now: NOW });
assert.strictEqual(truth.reasoning.decisions.length, 1);
assert.match(truth.briefing.currentReality, /marked complete and is awaiting PM approval/i);
assert.match(truth.briefing.evidenceCoverage, /current project records are linked to project work/i);
assert(truth.verificationQueue.some(item => /Named PM verification|current verification photo|current field update|PM verification/i.test(item.requestedAction)));

console.log('PASS DAVE Project Reasoning and adversarial challenge');
