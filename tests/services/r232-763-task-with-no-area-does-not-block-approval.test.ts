/**
 * Open item 7.63 (Medium, Build 232's device checks, check 19): a task with no AREA blocked Approve Report with
 * "Assign each included item to the correct project".
 *
 * The schedule-and-field comparison warns of a task that lacks its project, area or finish date in one sentence:
 * "<task> is missing project, area, or finish-date information needed for reliable field comparison." The report
 * quotes it as a review flag ("Schedule check: ..."), and the approval policy blocked any flag whose WORDS said
 * "missing project": so an overdue task added on the computer with no area (the project set) blocked the report as if
 * it had no project. Now the blocking rule reads the flag's KIND: a schedule check is the reviewer's to read and mark
 * reviewed; a flag that the report has no evidence, or is of the wrong project, still blocks. The schedule, the
 * report and the policy are the app's own code. Made-up project and tasks. No network.
 */
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));

import { buildDailyProjectUpdate } from '../../services/PIEReporter';
import { evaluateReportApprovalPolicy, SCHEDULE_CHECK_REVIEW_FLAG } from '../../services/ReportApprovalPolicy';
import { buildPIEScheduleReconciliation } from '../../services/PIEScheduleReconciliation';
import type { ProjectUpdate, ScheduleItem } from '../../types';

const PROJECT = 'Heron Yard';
const NOW = new Date('2026-10-15T02:15:00.000Z');
const task = (id: string, taskName: string, area: string, finish: string) => ({
  id, projectName: PROJECT, scheduleProjectName: PROJECT, locationName: area, taskName,
  startDate: '10/01/2026', finishDate: finish, milestone: '', owner: '', contractor: '',
  percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '',
  createdAt: '2026-10-14T12:00:00.000Z', updatedAt: '2026-10-14T12:00:00.000Z',
}) as unknown as ScheduleItem;
// Added on the computer with no area (the check's steps never ask for one), and overdue.
const TASKS = [task('t-insp', 'Inspection', '', '10/12/2026'), task('t-pour', 'Pour slab', '', '10/13/2026')];
const UPDATES = [{
  id: 'u1', projectName: PROJECT, scheduleProjectName: PROJECT, date: '2026-10-14', photos: [], recipients: { contactIds: [] },
  notes: 'Temporary fencing was installed along the street frontage.', status: 'sent', selectedAreaName: '',
}] as unknown as ProjectUpdate[];

const report = () => {
  const scheduleReconciliation = buildPIEScheduleReconciliation({
    scheduleItems: TASKS, knownScheduleItems: TASKS, updates: UPDATES, projectName: PROJECT, now: NOW,
  });
  return buildDailyProjectUpdate({
    selectedProjectNames: [PROJECT], savedUpdates: UPDATES, scheduleItems: TASKS, generatedAt: NOW,
    runtime: { fusedEvidence: { scheduleReconciliation } },
  } as never);
};

describe('7.63: a task with no area does not block Approve Report', () => {
  it('the report quotes the schedule check (its words say "missing project"); it is for review, and approval follows', () => {
    const draft = report();
    const checks = draft.reviewFlags.filter(flag => flag.startsWith(SCHEDULE_CHECK_REVIEW_FLAG));
    // The very sentence the check met: the task has its project, only its area is missing.
    expect(checks).toContain(`${SCHEDULE_CHECK_REVIEW_FLAG}Inspection is missing project, area, or finish-date information needed for reliable field comparison.`);
    const pending = evaluateReportApprovalPolicy({ report: draft, reportGenerationAllowed: true, authorityState: 'ready' });
    const ofChecks = pending.items.filter(item => item.text.startsWith(SCHEDULE_CHECK_REVIEW_FLAG));
    expect(ofChecks.length).toBeGreaterThan(0);
    expect(ofChecks.map(item => item.kind)).toEqual(ofChecks.map(() => 'advisory'));
    expect(pending.items.filter(item => item.kind === 'blocking')).toEqual([]);
    expect(pending.message).not.toContain('must be fixed in the project');
    // He reads them and marks them reviewed: Approve Report opens.
    const reviewed = evaluateReportApprovalPolicy({
      report: draft, reportGenerationAllowed: true, authorityState: 'ready', acknowledgedItemIds: pending.pendingAdvisoryIds,
    });
    expect(reviewed.allowed).toBe(true);
  });

  it('the kind decides, not the words: a schedule check naming any task stays for review; no evidence, or the wrong project, still blocks', () => {
    const flags = [
      `${SCHEDULE_CHECK_REVIEW_FLAG}Missing project assignment closeout is missing project, area, or finish-date information needed for reliable field comparison.`,
      `${SCHEDULE_CHECK_REVIEW_FLAG}No evidence photos is 2 days overdue, but no task-specific field update confirms current status.`,
    ];
    const reviewOnly = evaluateReportApprovalPolicy({ report: { needsReview: true, reviewFlags: flags }, reportGenerationAllowed: true, authorityState: 'ready' });
    expect(reviewOnly.items.map(item => item.kind)).toEqual(['advisory', 'advisory']);
    for (const flag of ['No supporting evidence was found for this report.', 'Missing project assignment on two updates.']) {
      const policy = evaluateReportApprovalPolicy({ report: { needsReview: true, reviewFlags: [flag] }, reportGenerationAllowed: true, authorityState: 'ready' });
      expect(policy.items[0].kind).toBe('blocking');
      expect(policy.allowed).toBe(false);
    }
  });
});
