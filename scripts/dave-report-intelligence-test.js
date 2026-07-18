#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'services/DAVEReportIntelligence.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, moduleUnderTest, moduleUnderTest.exports);
const { buildDAVEReportBriefing, enhanceDAVEReportDraft } = moduleUnderTest.exports;

function truth(projectName, overrides = {}) {
  return {
    projectName,
    generatedAt: '2026-07-16T18:00:00.000Z',
    evidence: { total: 8, connected: 6, unresolved: 2, coveragePercent: 75 },
    briefing: {
      headline: 'Field progress is moving, but electrical closeout needs attention.',
      currentReality: 'Reported installation progress is supported, but completion is not verified.',
      whatChanged: ['New field evidence shows equipment installed in the Pump House.'],
      schedule: 'One high-priority activity is overdue and remains open.',
      risksAndConflicts: ['Completion email conflicts with a newer field note showing unfinished terminations.'],
      verificationNeeded: ['Verify electrical terminations in the field.'],
      nextActions: ['Inspect electrical terminations.'],
      evidenceCoverage: '6 of 8 records connected.',
      confidence: 'medium',
    },
    verificationQueue: [{
      priority: 'high', title: 'Verify Pump House electrical completion',
      requestedAction: 'Inspect the terminations and confirm or reject completion.',
    }],
    schedule: [
      { taskId: 'pump-complete', taskName: 'Set pump', areaName: 'Pump House', status: 'Complete', percentComplete: 100, urgency: 'not_urgent' },
      { taskId: 'pump-active', taskName: 'Terminate pump', areaName: 'Pump House', status: 'In Progress', percentComplete: 60, urgency: 'overdue' },
      { taskId: 'driveway', taskName: 'Place concrete', areaName: 'East Driveway', status: 'Not Started', percentComplete: 0, urgency: 'due_soon' },
      { taskId: 'trash', taskName: 'Install gates', areaName: 'Trash Enclosure', status: 'Waiting', percentComplete: 20, urgency: 'upcoming' },
      { taskId: 'electrical', taskName: 'Final trim', areaName: 'Electrical Room', status: 'Complete', percentComplete: 100, urgency: 'not_urgent' },
    ],
    reasoning: {
      summary: 'DAVE evaluated schedule, email, and field evidence and challenged the completion claim.',
      uncertainties: ['Electrical terminations are outside the available photo view.'],
      decisions: [{
        taskId: 'task-1', taskName: 'Electrical closeout', areaName: 'Pump House', confidence: 'low',
        connections: [{ relationship: 'contradicts' }],
        challenges: [{ impact: 'Incorrect completion could hide remaining critical-path work.' }],
        recommendation: {
          action: 'Inspect and validate electrical closeout.', owner: 'Project manager', timing: 'Today',
          consequenceOfInaction: 'The schedule may report unsupported completion.',
          smallestNextAction: 'Capture one close photo of the terminations.',
        },
      }],
      criticalDecisions: [],
    },
    ...overrides,
  };
}

const briefing = buildDAVEReportBriefing({ truths: [truth('2321 Compliance Project')] });
assert.strictEqual(briefing.overallCondition, 'critical');
assert.match(briefing.conditionLabel, /immediate attention/i);
assert(briefing.criticalRisks.some(item => /critical-path|conflict|completion/i.test(item)));
assert.deepStrictEqual(briefing.decisionsRequired, []);
assert.deepStrictEqual(briefing.nextActions, []);
assert.deepStrictEqual(briefing.uncertainties, []);
assert.strictEqual(briefing.projectConditions[0].currentReality, 'Reported installation progress is supported');
assert.match(briefing.evidenceStatement, /6 current project records/i);
assert.match(briefing.executiveSnapshot, /1 overdue/i);
assert.deepStrictEqual(briefing.dashboard.taskStatus, {
  total: 5, complete: 2, inProgress: 1, notStarted: 1, waiting: 1,
});
assert.deepStrictEqual(briefing.dashboard.scheduleHealth, { onTrack: 1, dueSoon: 1, overdue: 1 });
const pumpArea = briefing.dashboard.workAreas.find(item => item.areaName === 'Pump House');
assert.strictEqual(pumpArea.averagePercent, 80);
assert.strictEqual(pumpArea.calculation, 'unweighted_task_average');
assert.strictEqual(briefing.dashboard.workAreas.find(item => item.areaName === 'Electrical Room').completed, true);

const baseDraft = {
  title: 'Old report', subject: 'Old report', openingLine: 'Team,', closingLine: 'Please let me know if you have any questions.',
  body: '', locationGroups: [{ id: 'group', title: 'Pump House', workAreas: [{
    id: 'area', title: 'Pump House', projectName: '2321 Compliance Project',
    bullets: [
      { text: 'Equipment was visibly installed.' },
      { text: 'Current condition is unknown and needs verification.' },
    ],
  }] }],
};
const pm = enhanceDAVEReportDraft(baseDraft, briefing, 'project_manager');
const executive = enhanceDAVEReportDraft(baseDraft, briefing, 'executive');
assert.match(pm.body, /PROJECT OVERVIEW/);
assert.match(pm.body, /WORK COMPLETED \/ IN PROGRESS/);
assert.match(pm.body, /ACTIVE ISSUES/);
assert(!/NEXT PERIOD \/ ACTIONS/.test(pm.body));
assert.match(pm.body, /WORK AREAS \/ PHOTO NOTES/);
assert(!/REPORT NOTES/.test(pm.body));
assert(!/verification|not verified|uncertain|unknown|missing evidence|low confidence/i.test(pm.body));
assert(!/No material field change|No immediate action|No problem requiring/i.test(pm.body));
assert(!/verified construction progress/i.test(pm.body));
assert.match(executive.body, /PROJECT OVERVIEW/);
assert(!/WORK AREAS \/ PHOTO NOTES/.test(executive.body));
assert.notStrictEqual(pm.body, executive.body);
assert.strictEqual(pm.daveBriefing, briefing);

const screen = fs.readFileSync(path.join(root, 'screens/ReportsScreen.tsx'), 'utf8');
const reporter = fs.readFileSync(path.join(root, 'services/PIEReporter.ts'), 'utf8');
assert(screen.includes('PROJECT CONDITION'));
assert(screen.includes('Task Status'));
assert(screen.includes('Schedule Health'));
assert(screen.includes('What Changed'));
assert(screen.includes('Needs Attention'));
assert(screen.includes('Next Action'));
assert(screen.includes('Progress by Work Area'));
assert(screen.includes('Unweighted average of tasks in each area'));
assert(screen.includes('Completed Areas'));
assert(screen.includes('Full Written Report'));
assert(screen.includes('Project Detail'));
assert(!screen.includes('Validation Requests'));
assert(!screen.includes('Evidence & Uncertainty'));
assert(screen.includes('Review the prepared report, make any edits, and approve it when ready.'));
assert(screen.includes('const [completedAreasOpen, setCompletedAreasOpen] = useState(false)'));
assert(screen.includes('const [writtenReportOpen, setWrittenReportOpen] = useState(false)'));
assert(screen.includes('numberOfLines={3}'));
assert(screen.includes('Work Areas & Photos'));
assert(screen.includes('Report Options'));
assert(screen.includes('Image {reference.imageNumber} —'));
assert(screen.includes('const [optionsOpen, setOptionsOpen] = useState(false)'));
assert(!reporter.includes('Verified construction progress was identified'));

console.log('DAVE report intelligence tests passed.');
