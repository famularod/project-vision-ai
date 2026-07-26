#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const moduleCache = new Map();

function loadTypeScriptModule(relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const moduleUnderTest = { exports: {} };
  moduleCache.set(absolutePath, moduleUnderTest);
  const compiled = ts.transpileModule(fs.readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
  }).outputText;
  const localRequire = specifier => {
    if (!specifier.startsWith('.')) return require(specifier);
    const base = path.resolve(path.dirname(absolutePath), specifier);
    const resolved = [`${base}.ts`, path.join(base, 'index.ts'), base]
      .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!resolved) throw new Error(`Cannot resolve ${specifier}`);
    return loadTypeScriptModule(path.relative(root, resolved));
  };
  new Function('require', 'module', 'exports', compiled)(
    localRequire,
    moduleUnderTest,
    moduleUnderTest.exports,
  );
  return moduleUnderTest.exports;
}

const { buildDAVEReportBriefing, buildPMReportReviewWarnings, enhanceDAVEReportDraft } =
  loadTypeScriptModule('services/DAVEReportIntelligence.ts');

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
      { taskId: 'pump-complete', taskName: 'Set pump', areaName: 'Pump House', status: 'Complete', percentComplete: 100, durationWeight: 1, urgency: 'not_urgent' },
      { taskId: 'pump-active', taskName: 'Terminate pump', areaName: 'Pump House', status: 'In Progress', percentComplete: 60, durationWeight: 3, urgency: 'overdue' },
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
assert.deepStrictEqual(
  briefing.nextActions.map(item => item.taskName),
  ['Terminate pump', 'Install gates', 'Place concrete'],
  'Current overdue, waiting, and due-soon schedule work must create direct PM actions.',
);
assert.match(briefing.nextActions[0].action, /recovery date and accountable next step/i);
assert.match(briefing.nextActions[1].action, /resolve the blocker/i);
assert.match(briefing.nextActions[2].action, /crew, materials, and access/i);
assert(briefing.nextActions.every(item => item.owner === 'Project manager' && item.confidence === 'high'));
assert.strictEqual(briefing.projectConditions[0].currentReality, '2 of 5 tasks complete; 1 in progress; 1 waiting; 1 not started.');
assert.deepStrictEqual(briefing.currentWork.map(item => item.split(':')[0]), [
  'Terminate pump (Pump House)',
  'Install gates (Trash Enclosure)',
  'Place concrete (East Driveway)',
]);
assert(!Object.prototype.hasOwnProperty.call(briefing, 'uncertainties'));
assert(!Object.prototype.hasOwnProperty.call(briefing, 'evidenceStatement'));
assert.match(briefing.executiveSnapshot, /1 overdue/i);
assert.deepStrictEqual(briefing.dashboard.taskStatus, {
  total: 5, complete: 2, open: 3, inProgress: 1, notStarted: 1, waiting: 1,
});
assert.deepStrictEqual(briefing.dashboard.scheduleHealth, { onTrack: 0, blocked: 1, dueSoon: 1, overdue: 1 });
const pumpArea = briefing.dashboard.workAreas.find(item => item.areaName === 'Pump House');
assert.strictEqual(pumpArea.averagePercent, 70);
assert.strictEqual(pumpArea.calculation, 'schedule_duration_weighted_average');
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
assert.match(pm.body, /PROJECT STATUS/);
assert.match(pm.body, /ACTIVE WORK/);
assert.match(pm.body, /RECENT CHANGES/);
assert.match(pm.body, /SCHEDULE ISSUES/);
assert.match(pm.body, /NEXT STEPS/);
assert.match(pm.body, /WORK AREAS \/ PHOTO NOTES/);
assert(!/REPORT NOTES/.test(pm.body));
assert(!/verification|not verified|uncertain|unknown|missing evidence|low confidence/i.test(pm.body));
assert(!/No material field change|No immediate action|No problem requiring/i.test(pm.body));
assert(!/verified construction progress/i.test(pm.body));
assert.match(executive.body, /PROJECT STATUS/);
assert(!/WORK AREAS \/ PHOTO NOTES/.test(executive.body));
assert.notStrictEqual(pm.body, executive.body);
assert.strictEqual(pm.daveBriefing, briefing);

assert.deepStrictEqual(buildPMReportReviewWarnings([
  'One or more action items need an owner.',
  'missing owner',
  'One or more evidence items need a confirmed location.',
  'Some source evidence has low confidence.',
]), [
  'Assign an owner to each report action.',
  'Assign each included item to the correct work area.',
  'Review the highlighted project detail and correct anything inaccurate.',
]);

const screen = fs.readFileSync(path.join(root, 'screens/ReportsScreen.tsx'), 'utf8');
const reporter = fs.readFileSync(path.join(root, 'services/PIEReporter.ts'), 'utf8');
assert(screen.includes('CURRENT PROJECT STATUS'));
assert(screen.includes('Task Status'));
assert(screen.includes('Schedule Health'));
assert(screen.includes("flexBasis: '47%'"));
assert(screen.includes('numberOfLines={1}'));
assert(screen.includes('minimumFontScale={0.85}'));
assert(screen.includes('Current Work'));
assert(screen.includes('Recent Changes'));
assert(screen.includes('Needs Attention'));
assert(screen.includes('Next Steps'));
assert(screen.includes('Progress by Work Area'));
assert(screen.includes('Progress based on scheduled task duration'));
assert(screen.includes('Completed Areas'));
assert(screen.includes('Full Written Report'));
assert(screen.includes('Project Status Details'));
assert(!screen.includes('Validation Requests'));
assert(!screen.includes('Evidence & Uncertainty'));
assert(screen.includes('Report Check'));
assert(screen.includes('Fix before approval'));
assert(!screen.includes("expanded ? 'Hide review details' : 'Review details'"));
assert(!screen.includes('title="Supporting Evidence"'));
assert(screen.includes('const [completedAreasOpen, setCompletedAreasOpen] = useState(false)'));
assert(screen.includes('const [writtenReportOpen, setWrittenReportOpen] = useState(false)'));
assert(!screen.includes('numberOfLines={3}'));
assert(screen.includes('Work Areas & Photos'));
assert(screen.includes('Report Options'));
assert(screen.includes('Photo {reference.imageNumber} —'));
assert(screen.includes('const [optionsOpen, setOptionsOpen] = useState(false)'));
assert(!reporter.includes('Verified construction progress was identified'));

console.log('DAVE report intelligence tests passed.');
