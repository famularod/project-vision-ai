/**
 * R232 review pass 1, R2 (open item 7.63, Medium; Build 233): a task with no AREA still blocked Approve Report.
 *
 * 966bfefc made "Schedule check: <task> is missing project, area, or finish-date information ..." a flag for review.
 * But the app's own report road (the live provider, buildPIECoreIntelligence) quotes the same sentence again in
 * "Scientific Method identified uncertainty: <task> is missing project, area, or finish-date information ...", and the
 * approval policy read "missing project" in it: "Assign each included item to the correct project", Approve grey. The
 * fixer's test built the report from a hand-made runtime holding the schedule check only.
 *
 * Now a flag's KIND decides: every kind of review flag that quotes another check's sentence after its own lead-in
 * (QUOTING_REVIEW_FLAG_KINDS) never blocks on the words "missing project" / "project assignment"; no evidence still
 * blocks, quoted or not; a flag of any other kind blocks on those words as before. Proved on the app's road with the
 * Scientific Method's flags present (the reviewer's V1 to V7), and on the reporter itself with every quoting kind it
 * makes carrying the sentence. Synthetic data. No network.
 */
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));

import { buildPIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { buildDAVEReportBriefing, enhanceDAVEReportDraft } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildPIEReportDraft } from '../../services/PIEReporter';
import {
  evaluateReportApprovalPolicy,
  QUOTING_REVIEW_FLAG_KINDS,
  SCHEDULE_CHECK_REVIEW_FLAG,
} from '../../services/ReportApprovalPolicy';
import type { ProjectUpdate, ScheduleItem } from '../../types';

jest.setTimeout(240_000);
const P = 'Kestrel Row';
const NOW = '2026-10-15T02:16:00.000Z';
const task = (id: string, name: string, area: string, start: string, finish: string, percent: number) => ({
  id, projectName: P, scheduleProjectName: P, locationName: area, taskName: name, startDate: start, finishDate: finish, milestone: '',
  owner: '', contractor: '', percentComplete: percent, priority: 'Medium', status: percent >= 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started',
  notes: '', createdAt: '2026-10-15T01:53:00.000Z', updatedAt: '2026-10-15T01:55:00.000Z',
}) as unknown as ScheduleItem;
const photo = (id: string, caption: string) => ({
  id, uri: `file:///p/${id}.jpg`, caption, category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
  createdAt: '2026-10-15T01:20:00.000Z', fileName: `${id}.jpg`, mimeType: 'image/jpeg',
});
const update = (id: string, area: string, at: string, notes: string, photos: unknown[] = []) => ({
  id, projectName: P, scheduleProjectName: P, date: at, photos, recipients: { contactIds: [] }, notes, status: 'sent', selectedAreaName: area,
}) as unknown as ProjectUpdate;

const TASKS = [
  task('trim', 'Test trim', 'Site', '01/04/2027', '01/08/2027', 0),
  task('paint', 'Test paint', 'Site', '01/04/2027', '01/08/2027', 65),
  task('steel', 'Set steel', 'Level 2', '10/07/2026', '10/09/2026', 0),
  task('insp', 'Inspection', '', '10/09/2026', '10/12/2026', 0),
  task('pour', 'Pour slab', '', '10/13/2026', '10/13/2026', 0),
  task('grade', 'Test grading', '', '11/02/2026', '11/04/2026', 0),
  task('pave', 'Test paving', '', '11/05/2026', '11/06/2026', 0),
  task('touch', 'Test touch-up', '', '01/11/2027', '01/12/2027', 0),
];
const UPDATES = [
  update('e1', '', '2026-10-15T02:15:00.000Z', 'Test for edited report.'),
  update('l4', 'Level 2', '2026-10-15T02:12:00.000Z', 'Please send the tile layout to the architect.'),
  update('l3', 'Level 2', '2026-10-15T02:11:00.000Z', 'Please schedule the sprinkler inspection.'),
  update('l2', 'Level 2', '2026-10-15T02:10:00.000Z', 'Stair pressurization test failed. Stair finishes are on hold.'),
  update('l1', 'Level 2', '2026-10-15T02:09:00.000Z', 'Radio batteries were swapped.'),
  update('n3', '', '2026-10-15T02:04:00.000Z', 'Concrete washout pit was installed near the gate.'),
  update('n2', '', '2026-10-15T02:03:00.000Z', 'Temporary fencing was installed along the street frontage.'),
  update('n1', '', '2026-10-15T02:02:00.000Z', 'Owner walked the job with the lender.'),
  update('g2', '', '2026-10-15T01:25:00.000Z', 'Neighbor asked about weekend hours.', [photo('gp2', '')]),
  update('g1', 'Site', '2026-10-15T01:20:00.000Z', '', [photo('gp1', 'Gate keypad')]),
];

/** The Reports screen's road: the live provider's draft, the briefing's report, the approval policy. */
function review(tasks: ScheduleItem[], updates: ProjectUpdate[]) {
  jest.useFakeTimers({ now: Date.parse(NOW), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
  try {
    const truths = buildDAVEReportProjectTruths({
      projects: [{ name: P, projectId: 'report:kestrel row' }], projectRecords: [{ name: P }] as never,
      updates, scheduleItems: tasks, knownScheduleItems: tasks, knownScheduleDocuments: [], projectAreas: [], referenceDocuments: [],
    } as never);
    const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: [P], previousSnapshot: null, scheduleItems: tasks } as never);
    const core = buildPIECoreIntelligence({
      runtimeContext: {
        projectName: P, projectNames: [P], reportType: 'daily_project_update', updates, scheduleItems: tasks, knownScheduleItems: tasks,
        currentUpdate: null, projectAreas: [], contacts: { contacts: [] }, referenceDocuments: [], surface: 'reports',
      } as never,
      reportType: 'daily_project_update' as never, reportProjectNames: [P], organizationId: 'local-unverified-anonymous', projectId: 'project-kestrel',
    } as never);
    const report = enhanceDAVEReportDraft(core.reportDraft as never, briefing, 'project_manager');
    const policy = evaluateReportApprovalPolicy({ report, reportGenerationAllowed: true, authorityState: 'ready', acknowledgedItemIds: [] });
    return {
      flags: report.reviewFlags,
      blocking: policy.items.filter(item => item.kind === 'blocking').map(item => item.text),
      allowedAfterReview: evaluateReportApprovalPolicy({
        report, reportGenerationAllowed: true, authorityState: 'ready', acknowledgedItemIds: policy.pendingAdvisoryIds,
      }).allowed,
    };
  } finally {
    jest.useRealTimers();
  }
}

const SCIENTIFIC = /^Scientific Method identified uncertainty: .* is missing project, area, or finish-date information/;

describe('R2: a task with no area does not block Approve Report on the app\'s road', () => {
  it.each([
    ['V3 one overdue task with no area, one note', [task('insp', 'Inspection', '', '10/09/2026', '10/12/2026', 0)], [UPDATES[0]]],
    ['V4 one task with no area due in a month, one note', [task('grade', 'Test grading', '', '11/02/2026', '11/14/2026', 0)], [UPDATES[0]]],
    ['V5 one overdue task with no area and its own note naming it', [task('insp', 'Inspection', '', '10/09/2026', '10/12/2026', 0)],
      [update('i1', '', '2026-10-15T02:00:00.000Z', 'Inspection is waiting on the inspector.')]],
    ['V7 one task due in 3 days with no area, two notes', [task('pour', 'Pour slab', '', '10/14/2026', '10/17/2026', 0)], UPDATES.slice(0, 2)],
  ])('%s: the Scientific Method quotes the schedule check; it is for review, and approval follows', (_name, tasks, updates) => {
    const result = review(tasks, updates);
    // The road really carries the quote (the hole the hand-made runtime missed).
    expect(result.flags.some(flag => SCIENTIFIC.test(flag))).toBe(true);
    expect(result.blocking).toEqual([]);
    expect(result.allowedAfterReview).toBe(true);
  });

  it('V1 (the tester\'s check-19 project) and V6 (every task given an area): nothing blocks, as on 966bfefc', () => {
    for (const tasks of [TASKS, TASKS.map(item => ({ ...item, locationName: item.locationName || 'Level 2' })) as ScheduleItem[]]) {
      const result = review(tasks, UPDATES);
      expect(result.blocking).toEqual([]);
      expect(result.allowedAfterReview).toBe(true);
    }
  });
});

/** The sentence the schedule check says of a task with no area. */
const SENTENCE = 'Inspection is missing project, area, or finish-date information needed for reliable field comparison';
const quoting = (situationState: string, escalate: boolean) => ({
  recommendedEvidence: [SENTENCE],
  scientificResult: { primaryUncertainty: { uncertainty: SENTENCE }, challenges: [{ weakestAssumption: SENTENCE }] },
  patternIntelligence: { earlyWarnings: [{ warning: SENTENCE }] },
  beliefsNeedingVerification: [{ statement: SENTENCE }],
  predictiveReality: {
    confidence: 'medium', risks: [{ confidence: 'medium', verificationNeeded: SENTENCE, risk: SENTENCE }], opportunities: [],
    noActionForecast: { readinessForecast: { readiness: 'Ready' } },
  },
  situationIntelligence: {
    situationState,
    situationSummary: { whatNeedsVerification: SENTENCE },
    situationUnknowns: [{ recommendedEvidence: SENTENCE }],
    situationPriorities: [],
  },
  executiveReasoning: { executiveReadiness: 'Ready', biggestRisk: { likelyToGrow: true, risk: SENTENCE }, decisionNeeds: [{ decisionNeeded: SENTENCE }] },
  executiveJudgment: {
    executiveReadiness: 'Ready',
    highestValueAction: { type: 'escalate', action: SENTENCE, score: { readiness: 'Needs Review' }, governance: { whatWouldChangeRecommendation: [SENTENCE] } },
    executiveRisks: [{ shouldEscalate: true, risk: SENTENCE }],
    escalationAnalysis: { shouldEscalate: escalate, justification: SENTENCE },
  },
  waitForEvidenceReasoning: { shouldWaitForEvidence: true, smallestEvidenceRequest: SENTENCE },
  decisionTiming: { recommendation: 'wait_for_evidence', reason: SENTENCE },
  decisionMemory: { whenNotToActReasons: [{ explanation: SENTENCE }] },
  fusedEvidence: { scheduleReconciliation: { warnings: [{ type: 'missing_schedule_data', severity: 'high', summary: `${SENTENCE}.` }] } },
});
const flagsOf = (runtime: Record<string, unknown>) => buildPIEReportDraft({
  reportType: 'daily_project_update',
  savedUpdates: [update('u1', 'Level 2', '2026-10-15T02:10:00.000Z', 'Steel columns were set on line A.')],
  scheduleItems: [task('insp', 'Inspection', '', '10/09/2026', '10/12/2026', 0)],
  selectedProjectNames: [P],
  runtime: runtime as never,
  generatedAt: new Date(NOW),
} as never).reviewFlags;

describe('R2: every kind of review flag the reporter makes that quotes another check', () => {
  it('quotes the sentence under its own lead-in, a known kind, and never blocks on it', () => {
    const flags = [...flagsOf(quoting('blocked', true)), ...flagsOf(quoting('needs_verification', false))];
    const carrying = Array.from(new Set(flags.filter(flag => flag.includes(SENTENCE))));
    expect(carrying.length).toBeGreaterThanOrEqual(18);
    const policy = evaluateReportApprovalPolicy({
      report: { needsReview: true, reviewFlags: carrying }, reportGenerationAllowed: true, authorityState: 'ready',
    });
    expect(policy.items.filter(item => item.kind === 'blocking').map(item => item.text)).toEqual([]);
    // Each one is a known kind, and every known kind was made (the list is the reporter's, not a guess).
    const kinds = [SCHEDULE_CHECK_REVIEW_FLAG, ...QUOTING_REVIEW_FLAG_KINDS];
    expect(carrying.filter(flag => !kinds.some(kind => flag.startsWith(kind)))).toEqual([]);
    expect(QUOTING_REVIEW_FLAG_KINDS.filter(kind => !carrying.some(flag => flag.startsWith(kind)))).toEqual([]);
    expect(evaluateReportApprovalPolicy({
      report: { needsReview: true, reviewFlags: carrying }, reportGenerationAllowed: true, authorityState: 'ready',
      acknowledgedItemIds: policy.pendingAdvisoryIds,
    }).allowed).toBe(true);
  });

  it('guard: what blocked before still blocks (no evidence, quoted or not; those words in a flag of another kind)', () => {
    for (const flag of [
      'No supporting evidence was found for this report.',
      'Missing project assignment on two updates.',
      'Scientific Method identified uncertainty: No supporting evidence was found for this report..',
      'Executive action needs verification: no evidence for the Level 2 pour.',
    ]) {
      const policy = evaluateReportApprovalPolicy({ report: { needsReview: true, reviewFlags: [flag] }, reportGenerationAllowed: true, authorityState: 'ready' });
      expect({ flag, kinds: policy.items.map(item => item.kind) }).toEqual({ flag, kinds: ['blocking'] });
      expect(policy.allowed).toBe(false);
    }
  });
});
