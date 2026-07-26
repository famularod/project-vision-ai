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
  const localRequire = request => request.startsWith('.')
    ? loadTs(path.relative(root, path.resolve(path.dirname(filename), `${request}.ts`)), cache)
    : require(request);
  vm.runInNewContext(compiled.outputText, {
    module,
    exports: module.exports,
    require: localRequire,
    Date,
    Set,
    Map,
    WeakMap,
    Math,
    encodeURIComponent,
  }, { filename });
  cache.set(filename, module.exports);
  return module.exports;
}

const moduleCache = new Map();
const { buildProjectIntelligence } = loadTs('services/DAVEIntelligence.ts', moduleCache);
const { askDAVE, answerDAVEQuestion, routeDAVEAskIntent } = loadTs('services/DAVEAsk.ts', moduleCache);
const now = '2026-07-12T12:00:00.000Z';

const intelligence = buildProjectIntelligence({
  projectId: 'project-alpha',
  projectName: 'Alpha',
  now,
  updates: [{
    id: 'update-current',
    projectName: 'Alpha',
    date: '2026-07-11T10:00:00.000Z',
    safetyFlag: true,
    photos: [
      {
        id: 'photo-observation',
        category: 'Update',
        actionRequired: '',
        actionOwner: '',
        actionDueDate: '',
        actionStatus: 'Open',
        locationCapturedAt: '2026-07-11T10:00:00.000Z',
        photoIntelligence: {
          status: 'analysis_complete',
          updatedAt: '2026-07-11T10:01:00.000Z',
          comparisonConfidence: 'high',
          priorEvidenceId: 'baseline-evidence',
          findings: [{
            findingType: 'added',
            description: 'A tan case appears in the foreground near the laptop.',
            confidence: 0.9,
          }],
        },
      },
      {
        id: 'photo-safety',
        category: 'Safety Concern',
        actionRequired: 'Confirm guardrail condition',
        actionOwner: 'Alex',
        actionDueDate: '2026-07-10',
        actionStatus: 'Open',
        locationCapturedAt: '2026-07-11T10:00:00.000Z',
        photoIntelligence: null,
      },
    ],
  }],
  documents: [],
  scheduleItems: [],
});

const supportedQuestions = [
  ['Summarize this project.', 'summarize_project'],
  ['What changed?', 'what_changed'],
  ['Why is this project At Risk?', 'why_at_risk'],
  ['What should I do next?', 'next_action'],
  ['How is this project doing?', 'project_status'],
  ['How is project 2375 going?', 'project_status'],
  ['What needs attention?', 'needs_attention'],
  ['What is the latest field update?', 'latest_field_update'],
  ['What commitments are still open?', 'open_commitments'],
  ['How reliable is the project evidence?', 'evidence_confidence'],
  ['What is overdue?', 'overdue_commitments'],
  ["What's coming up?", 'next_action'],
  ['What commitments are overdue?', 'overdue_commitments'],
  ['What safety issues exist?', 'safety_issues'],
  ['What evidence am I missing?', 'missing_evidence'],
  ['Why did DAVE recommend this?', 'recommendation_reason'],
  ['Show supporting evidence.', 'supporting_evidence'],
  ['What happened this week?', 'happened_this_week'],
  ['What happened since my last update?', 'since_last_update'],
  ['Draft an owner update.', 'draft_owner_update'],
  ['Draft a contractor follow-up.', 'draft_contractor_follow_up'],
];

for (const [question, intent] of supportedQuestions) {
  assert.strictEqual(routeDAVEAskIntent(question), intent, `${question} must route to ${intent}.`);
  const result = askDAVE({ question, intelligence });
  assert.notStrictEqual(result.answer, "I don't have enough project evidence to answer that.",
    `${intent} must return a supported response.`);
  assert(['high', 'medium', 'low'].includes(result.confidence));
  assert(Array.isArray(result.limitations));
  assert(Array.isArray(result.supportingEvidence));
  assert(Array.isArray(result.timelineReferences));
  assert(Array.isArray(result.navigationTargets));
}

const unknown = askDAVE({ question: 'What color should the office walls be?', intelligence });
assert.strictEqual(unknown.answer, "I don't have enough current project information to answer that yet.");
assert.strictEqual(unknown.supportingEvidence.length, 0);
assert.strictEqual(unknown.recommendedNextAction, null);

const changed = askDAVE({ question: 'What changed?', intelligence });
assert.match(changed.answer, /Field observations/);
assert.match(changed.answer, /tan case/i);
assert(changed.supportingEvidence.length > 0);
assert(changed.timelineReferences.some(item => item.eventType === 'qualified_photo_observation'));
assert(!/work progressed significantly|work is complete|percent complete/i.test(changed.answer));

const recommendation = askDAVE({ question: 'Why did DAVE recommend this?', intelligence });
assert(recommendation.recommendedNextAction);
assert(recommendation.supportingEvidence.length > 0, 'Recommendation explanation must cite Reality evidence.');
assert.match(recommendation.answer, /Assessment/);
assert.match(recommendation.answer, /Recommended next step/);

const support = askDAVE({ question: 'Show supporting evidence.', intelligence });
assert(support.supportingEvidence.length > 0);
assert(support.timelineReferences.length > 0);
assert(support.navigationTargets.length > 0);

const thisWeek = askDAVE({ question: 'What happened this week?', intelligence });
assert(thisWeek.timelineReferences.length > 0);
assert(thisWeek.supportingEvidence.length > 0);

const sinceUpdate = askDAVE({ question: 'What happened since my last update?', intelligence });
assert(sinceUpdate.timelineReferences.some(item => item.eventType === 'qualified_photo_observation'));

const ownerDraft = askDAVE({ question: 'Draft an owner update.', intelligence });
assert.match(ownerDraft.answer, /Owner Update/);
assert.match(ownerDraft.answer, /Current status|Field observations|Recommended next step/);
assert(ownerDraft.supportingEvidence.length > 0);

const contractorDraft = askDAVE({ question: 'Draft a contractor follow-up.', intelligence });
assert.match(contractorDraft.answer, /Contractor Follow-up/);
assert(contractorDraft.supportingEvidence.length > 0);

const textAnswer = askDAVE({ question: 'What should I do next?', intelligence, interface: 'text' });
const voiceAnswer = answerDAVEQuestion({ question: 'What should I do next?', intelligence, interface: 'voice' });
assert.strictEqual(JSON.stringify(textAnswer), JSON.stringify(voiceAnswer),
  'Voice and text must use the exact same intelligence path.');

const weakIntelligence = buildProjectIntelligence({
  projectId: 'project-empty',
  projectName: 'Empty',
  updates: [],
  documents: [],
  scheduleItems: [],
  now,
});
const weak = askDAVE({ question: 'Summarize this project.', intelligence: weakIntelligence });
assert.strictEqual(weak.confidence, 'low');
assert(!/^Evidence note:/i.test(weak.answer), 'Low confidence must not bury the answer under diagnostic copy.');
assert(weak.limitations.some(item => /details may be incomplete/i.test(item)));
const weakUnknown = askDAVE({ question: 'Predict the weather.', intelligence: weakIntelligence });
assert.strictEqual(weakUnknown.answer, "I don't have enough current project information to answer that yet.");

const scheduleIntelligence = buildProjectIntelligence({
  projectId: 'project-2375',
  projectName: '2375 Compliance Project',
  updates: [],
  documents: [],
  scheduleItems: [
    {
      id: 'schedule-overdue',
      scheduleProjectName: '2375 Compliance Project',
      projectName: '2375 Compliance Project',
      taskName: 'Electrical rough-in',
      finishDate: '2026-07-10',
      status: 'In Progress',
      percentComplete: 50,
      durationDays: 2,
      createdAt: '2026-07-01T08:00:00.000Z',
    },
    {
      id: 'schedule-complete',
      scheduleProjectName: '2375 Compliance Project',
      projectName: '2375 Compliance Project',
      taskName: 'Underground inspection',
      finishDate: '2026-07-08',
      status: 'Complete',
      percentComplete: 100,
      durationDays: 2,
      createdAt: '2026-07-01T08:00:00.000Z',
    },
    {
      id: 'schedule-upcoming',
      scheduleProjectName: '2375 Compliance Project',
      projectName: '2375 Compliance Project',
      taskName: 'Final electrical inspection',
      finishDate: '2026-07-15',
      status: 'Not Started',
      percentComplete: 0,
      durationDays: 1,
      createdAt: '2026-07-01T08:00:00.000Z',
    },
  ],
  now,
});
const scheduleStatus = askDAVE({ question: 'How is project 2375 going?', intelligence: scheduleIntelligence });
assert.match(scheduleStatus.answer, /1 of 3 tasks complete/i);
assert.match(scheduleStatus.answer, /60% overall progress/i);
assert.match(scheduleStatus.answer, /1 incomplete task is overdue/i);
assert.match(scheduleStatus.answer, /Electrical rough-in/i);
const scheduleAttention = askDAVE({ question: 'What needs attention?', intelligence: scheduleIntelligence });
assert.match(scheduleAttention.answer, /schedule task is overdue/i);
const scheduleOverdue = askDAVE({ question: 'What is overdue?', intelligence: scheduleIntelligence });
assert.match(scheduleOverdue.answer, /Electrical rough-in/i);
const scheduleNext = askDAVE({ question: "What's coming up?", intelligence: scheduleIntelligence });
assert.match(scheduleNext.answer, /Electrical rough-in/i);

const serviceSource = fs.readFileSync(path.join(root, 'services/DAVEAsk.ts'), 'utf8');
for (const forbiddenDependency of [
  'projectRealitySourceRecords',
  'DAVEDailyBriefUpdate',
  'DAVEDailyBriefDocument',
  'DAVEDailyBriefScheduleItem',
  'photoIntelligence',
  '.updates',
  '.documents',
  '.scheduleItems',
]) {
  assert(!serviceSource.includes(forbiddenDependency), `Ask DAVE must not read raw records via ${forbiddenDependency}.`);
}
assert(serviceSource.includes('intelligence: DAVEProjectIntelligence'));
assert(serviceSource.includes('buildDAVECommunicationCenter(intelligence)'));

console.log('DAVE Ask behavioral tests passed.');
