/**
 * Whole-app audit A10 pass 3 M1 (30 Sep 2026): the scheduler's % Complete was
 * presented as the project manager's judgment. David had Excavate at 40%; the
 * weekly master update said 100%. Approving it keeps the task marked as the
 * manager's, confirmed by "Schedule update", so the newer value wins in sync
 * (A5 pass 4 #1). The summaries read that marking as David's word: Excavate
 * "was verified complete", "A project manager stated that the work was
 * completed", no verification asked; Frame walls, which David never touched
 * and the same file also put at 100%, was flagged as not corroborated.
 *
 * Now a percent a schedule file set reads as the schedule's everywhere a
 * summary decides "manager judgment"; a percent David sets by hand keeps its
 * meaning, and the sync marking is unchanged. Each case goes the phone
 * approval's way (real parser, stable ids, batch provenance, merge, document
 * labels, the shown list) into Project Truth and the report briefing.
 * Synthetic schedule text only.
 */
import { buildDAVEActionInbox } from '../../services/DAVEActionInbox';
import { findExactScheduleTaskForCompletionClaim } from '../../services/DAVECompletionVerification';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing } from '../../services/DAVEReportIntelligence';
import { recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import {
  bindPIEScheduleImportBatchProvenance,
  dedupeScheduleImportItems,
  type PIEScheduleImportBatch,
} from '../../services/PIEScheduleImportBatch';
import { normalizeMicrosoftProjectPdfRows } from '../../services/PIEScheduleIntelligence';
import {
  scheduleCompletionOverridesFieldMatch,
  scheduleHasAuthoritativeProgressJudgment,
  scheduleProgressOverridesFieldMatch,
  selectAuthoritativeScheduleItems,
} from '../../services/PIEScheduleReconciliation';
import { scheduleDocumentsAfterApproval } from '../../services/ScheduleDocumentLabels';
import {
  mergeApprovedScheduleImportItems,
  SCHEDULE_UPDATE_PROGRESS_CONFIRMER,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressIsManagers,
} from '../../services/ScheduleImportMerge';
import {
  bindStableScheduleImportItemIds,
  buildScheduleImportSourceIdentity,
} from '../../services/ScheduleImportSourceIdentity';
import {
  SCHEDULE_FILE_PROGRESS_CONFIRMER,
  scheduleProgressRecordedByManager,
} from '../../services/ScheduleProgressInvariant';
import type { ReferenceDocument, ScheduleItem } from '../../types';

type Row = readonly [name: string, indent: number, start: string, finish: string, percent?: number];
type State = Readonly<{ items: ScheduleItem[]; documents: ReferenceDocument[] }>;

const PROJECTS = [{ id: 'project-alpha', name: 'Alpha Tower' }];
const EMPTY: State = { items: [], documents: [] };

function mspText(rows: readonly Row[]): string {
  const counters: number[] = [];
  return [
    'ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete\tWBS',
    ...rows.map(([name, indent, start, finish, percent = 0], index) => {
      counters.length = indent + 1;
      counters[indent] = (counters[indent] || 0) + 1;
      return [index + 1, name, indent, '5 days', start, finish, `${percent}%`, counters.join('.')].join('\t');
    }),
  ].join('\n');
}

function prepare(rows: readonly Row[], fileName: string, importedAt: string): PIEScheduleImportBatch {
  const text = mspText(rows);
  const parsed = normalizeMicrosoftProjectPdfRows({
    contents: text, sourceName: fileName, projects: PROJECTS.map(project => project.name), now: new Date(importedAt),
  });
  const source = buildScheduleImportSourceIdentity({ bytes: new TextEncoder().encode(text), projects: PROJECTS });
  const document = {
    id: source.documentId, name: fileName.replace(/\.pdf$/, ''), originalFileName: fileName, uri: '',
    category: 'Schedules', notes: '', isCurrent: true, importedAt, importBatchId: source.batchId,
    projectNames: PROJECTS.map(project => project.name),
  } as ReferenceDocument;
  return {
    id: source.batchId, kind: 'schedule_file', sourceCount: 1, sourceLabel: fileName, message: '',
    items: dedupeScheduleImportItems(bindStableScheduleImportItemIds(parsed, source)),
    documents: [document],
  };
}

function approve(state: State, reviewed: PIEScheduleImportBatch, approvedAt: string): State {
  const batch = bindPIEScheduleImportBatchProvenance(reviewed);
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items,
    imported: batch.items,
    completionMatch: findExactScheduleTaskForCompletionClaim,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, state.documents, batch.id),
    mergeCompletion: item => item,
    approvedAt,
  });
  const documents = scheduleDocumentsAfterApproval({
    documents: state.documents, approvedDocuments: batch.documents, approvedItems: batch.items, updatedAt: approvedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents };
}

const visible = (state: State) =>
  selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents });
const shown = (state: State, taskName: string) => {
  const matches = visible(state).filter(item => item.taskName === taskName);
  expect(matches).toHaveLength(1);
  return matches[0];
};
function manage(state: State, taskName: string, percentComplete: number, at: string): State {
  const target = shown(state, taskName);
  return {
    ...state,
    items: state.items.map(item => item.id === target.id ? {
      ...item, percentComplete, status: percentComplete >= 100 ? 'Complete' : percentComplete > 0 ? 'In Progress' : 'Not Started',
      progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at,
    } : item),
  };
}

const master = (percent: Record<string, number> = {}): Row[] => [
  ['ALPHA TOWER', 0, '7/6/26', '9/25/26'],
  ['Excavate', 1, '8/10/26', '8/14/26', percent.Excavate],
  ['Frame walls', 1, '8/24/26', '8/28/26', percent['Frame walls']],
];

function truthOf(state: State, now = '2026-09-02T12:00:00.000Z') {
  return buildDAVEProjectTruth({
    projectId: 'project-alpha', projectName: 'Alpha Tower', updates: [],
    scheduleItems: visible(state), referenceDocuments: state.documents, now,
  });
}

const JULY_AT = '2026-07-15T12:00:00.000Z';
const DAVID_AT = '2026-08-25T15:00:00.000Z';
const APPROVED_AT = '2026-09-01T09:00:00.000Z';

/** July's master at 0%; David tracks Excavate at 40%; the 31 Aug update is approved on 1 Sep. */
function afterUpdate(percent: Record<string, number>): State {
  let july = approve(EMPTY, prepare(master(), 'MASTER 7152026.pdf', JULY_AT), JULY_AT);
  july = manage(july, 'Excavate', 40, DAVID_AT);
  return approve(july, prepare(master(percent), 'MASTER UPDATE 8312026.pdf', '2026-08-31T12:00:00.000Z'), APPROVED_AT);
}

/** What every summary concluded about one task, with its name taken out. */
function concluded(truth: ReturnType<typeof truthOf>, item: ScheduleItem) {
  const name = (value: string | null | undefined) => (value || '').split(item.taskName).join('<task>');
  const correlation = truth.correlations.tasks.find(task => task.taskId === item.id)!;
  const decision = truth.reasoning.decisions.find(task => task.taskId === item.id)!;
  const record = truth.evidence.records.find(value => value.id === `schedule:${item.id}`)!;
  return {
    conclusion: correlation.conclusion,
    explanation: correlation.explanation,
    needsVerification: correlation.needsVerification,
    claims: correlation.evidence.map(claim => [claim.kind, claim.authority, name(claim.summary)]),
    reasoning: name(decision.conclusion),
    classification: decision.classification,
    action: decision.recommendation.action,
    challenges: decision.challenges.map(challenge => challenge.kind),
    completionState: truth.schedule.find(task => task.taskId === item.id)!.completionState,
    record: [name(record.summary).replace(/, due [0-9/]+/, ''), record.dispositionReason],
    whatChanged: truth.briefing.whatChanged.filter(line => line.includes(item.taskName)).map(name),
  };
}

describe('a schedule file’s % Complete reads as the schedule’s, not the manager’s (A10 pass 3 M1)', () => {
  it('Excavate, raised from David’s 40% by the file, concludes as Frame walls, which David never touched', () => {
    const state = afterUpdate({ Excavate: 100, 'Frame walls': 100 });
    const excavate = shown(state, 'Excavate');
    const frame = shown(state, 'Frame walls');
    // The sync marking stays: the raised task keeps the manager's rank.
    expect(excavate).toMatchObject({
      percentComplete: 100, status: 'Complete', progressSource: 'project_manager',
      progressConfirmedBy: 'Schedule update', progressConfirmedAt: APPROVED_AT,
    });
    expect(frame.progressSource ?? null).toBeNull();

    const truth = truthOf(state);
    expect(concluded(truth, excavate)).toEqual(concluded(truth, frame));
    expect(concluded(truth, excavate)).toEqual({
      conclusion: 'schedule_only',
      explanation: 'The current schedule records this task complete at 100%.',
      needsVerification: false,
      claims: [['schedule', 'schedule', '<task>: Complete, 100% complete.']],
      reasoning: 'The schedule state for <task> is not corroborated by current field evidence.',
      classification: 'unresolved_uncertainty',
      action: 'Verify the current task condition.',
      challenges: ['missing_evidence'],
      completionState: 'scheduled',
      record: ['<task>: Complete, 100% complete.', 'Schedule activity is connected to the project.'],
      whatChanged: [],
    });
    expect(truth.briefing.risksAndConflicts).toEqual(expect.arrayContaining([
      'Excavate: ECOS cannot distinguish an accurate schedule from a stale one.',
      'Frame walls: ECOS cannot distinguish an accurate schedule from a stale one.',
    ]));
    const report = buildDAVEReportBriefing({ truths: [truth] });
    expect(report.whatChanged.join('\n')).not.toMatch(/verified complete/i);
    expect(JSON.stringify(truth)).not.toMatch(/project manager stated|project manager judgment|Schedule update recorded/i);

    // Another phone still holding David's 40% takes the file's 100% (unchanged).
    const stale = shown(manage(approve(EMPTY, prepare(master(), 'MASTER 7152026.pdf', JULY_AT), JULY_AT), 'Excavate', 40, DAVID_AT), 'Excavate');
    const [onOtherPhone] = recoverDAVEScheduleRecords({ local: [stale], cloud: [excavate], allowCloudOnly: true });
    expect([onOtherPhone.percentComplete, onOtherPhone.status]).toEqual([100, 'Complete']);
  });

  it('a 100% David sets by hand is still his verified completion', () => {
    const state = manage(afterUpdate({ Excavate: 100, 'Frame walls': 100 }), 'Excavate', 100, '2026-09-02T08:00:00.000Z');
    const excavate = shown(state, 'Excavate');
    expect(excavate).toMatchObject({ progressSource: 'project_manager', progressConfirmedBy: 'David' });
    const truth = truthOf(state);
    expect(concluded(truth, excavate)).toMatchObject({
      conclusion: 'verified_complete',
      explanation: 'A project manager stated that the work was completed. That statement is the authoritative completion evidence.',
      claims: [['pm_confirmation', 'verified', 'David recorded <task> as Complete, 100% complete.']],
      reasoning: '<task> is verified complete.',
      completionState: 'pm_verified',
      record: ['<task>: Complete, 100% complete — project manager judgment.', 'The project manager progress judgment is direct project evidence.'],
      whatChanged: ['<task> was verified complete.'],
    });
    expect(concluded(truth, shown(state, 'Frame walls')).conclusion).toBe('schedule_only');
    expect(buildDAVEReportBriefing({ truths: [truth] }).whatChanged.join('\n')).toMatch(/Excavate was verified complete/);
  });

  it('below 100%: the file’s 60% is the schedule’s; David’s own 60% is his', () => {
    const state = afterUpdate({ Excavate: 60, 'Frame walls': 60 });
    const excavate = shown(state, 'Excavate');
    expect(excavate).toMatchObject({ percentComplete: 60, progressSource: 'project_manager', progressConfirmedBy: 'Schedule update' });
    const truth = truthOf(state);
    const raised = concluded(truth, excavate);
    expect(raised).toMatchObject({
      conclusion: 'schedule_only',
      explanation: 'The schedule records in progress at 60% complete. No connected field, photo, or communication evidence is available.',
      claims: [['schedule', 'schedule', '<task>: In Progress, 60% complete.']],
      record: ['<task>: In Progress, 60% complete.', 'Schedule activity is connected to the project.'],
    });
    const frame = concluded(truth, shown(state, 'Frame walls'));
    expect([raised.conclusion, raised.explanation, raised.claims]).toEqual([frame.conclusion, frame.explanation, frame.claims]);
    // Excavate finished 14 Aug: the inbox asks for its field status.
    const now = new Date('2026-09-02T12:00:00.000Z');
    const action = (items: readonly ScheduleItem[], id: string) =>
      buildDAVEActionInbox({ scheduleItems: items, now }).items.find(item => item.scheduleItemId === id)!.requestedAction;
    expect(action(visible(state), excavate.id)).toBe('Confirm current field status and the next accountable step.');

    const byDavid = manage(state, 'Excavate', 60, '2026-09-02T08:00:00.000Z');
    const truthByDavid = truthOf(byDavid);
    expect(concluded(truthByDavid, shown(byDavid, 'Excavate'))).toMatchObject({
      explanation: 'A project manager recorded in progress at 60% complete. That professional judgment is the current progress evidence.',
      claims: [['pm_confirmation', 'verified', 'David recorded <task> as In Progress, 60% complete.']],
    });
    expect(action(visible(byDavid), excavate.id))
      .toBe('Set the recovery date and next accountable step while preserving the project manager progress judgment.');
  });

  it('field evidence against a file’s completion is weighed as the schedule’s, not the manager’s', () => {
    const state = afterUpdate({ Excavate: 100, 'Frame walls': 100 });
    const raised = shown(state, 'Excavate');
    const byDavid = shown(manage(state, 'Excavate', 100, '2026-09-02T08:00:00.000Z'), 'Excavate');
    const undated = { capturedAt: null };
    const older = { capturedAt: '2026-08-30T12:00:00.000Z' };
    const newer = { capturedAt: '2026-09-01T12:00:00.000Z' };
    // Without dates only the manager's own word stands over the field.
    expect(scheduleCompletionOverridesFieldMatch(raised, undated)).toBe(false);
    expect(scheduleCompletionOverridesFieldMatch(byDavid, undated)).toBe(true);
    // With dates, the file's completion stands over older field evidence only.
    expect(scheduleCompletionOverridesFieldMatch(raised, older)).toBe(true);
    expect(scheduleCompletionOverridesFieldMatch(raised, newer)).toBe(false);
    expect(scheduleHasAuthoritativeProgressJudgment(raised)).toBe(false);
    expect(scheduleHasAuthoritativeProgressJudgment(byDavid)).toBe(true);

    const raisedSixty = shown(afterUpdate({ Excavate: 60 }), 'Excavate');
    expect(scheduleHasAuthoritativeProgressJudgment(raisedSixty)).toBe(false);
    expect(scheduleProgressOverridesFieldMatch(raisedSixty, undated)).toBe(false);
    expect(scheduleProgressOverridesFieldMatch({ ...raisedSixty, progressConfirmedBy: 'David' }, undated)).toBe(true);
  });

  it('which copy of a task shows is unchanged: a raised task keeps the manager’s rank', () => {
    const current = {
      id: 'doc-current', name: 'MASTER UPDATE', originalFileName: 'MASTER UPDATE.pdf', uri: '', category: 'Schedules',
      notes: '', isCurrent: true, importedAt: APPROVED_AT, importBatchId: 'batch-current', projectNames: ['Alpha Tower'],
    } as ReferenceDocument;
    const task = {
      projectName: 'Alpha Tower', scheduleProjectName: 'Alpha Tower', locationName: '', taskName: 'Excavate',
      startDate: '08/10/2026', finishDate: '08/14/2026', milestone: '', owner: '', contractor: '', priority: 'Normal', notes: '',
      createdAt: JULY_AT, importedAt: JULY_AT,
    };
    const active = { ...task, id: 'active', sourceDocumentId: 'doc-current', importBatchId: 'batch-current', percentComplete: 50, status: 'In Progress' } as ScheduleItem;
    const orphan = {
      ...task, id: 'orphan', sourceDocumentId: 'doc-removed', importBatchId: 'batch-removed', percentComplete: 100, status: 'Complete',
      progressSource: 'project_manager', progressConfirmedBy: 'Schedule update', progressConfirmedAt: APPROVED_AT,
    } as ScheduleItem;
    expect(selectAuthoritativeScheduleItems({ scheduleItems: [active, orphan], scheduleDocuments: [current] }).map(item => item.id))
      .toEqual(['orphan']);
  });

  it('the summaries and the merge read the same marking', () => {
    expect(SCHEDULE_FILE_PROGRESS_CONFIRMER).toBe(SCHEDULE_UPDATE_PROGRESS_CONFIRMER);
    const base = shown(afterUpdate({ Excavate: 100 }), 'Excavate');
    for (const progressSource of ['project_manager', 'schedule_import', null] as const) {
      for (const progressConfirmedBy of ['Schedule update', 'David', null]) {
        const item = { ...base, progressSource, progressConfirmedBy, completionVerification: null };
        expect(scheduleProgressRecordedByManager(item)).toBe(scheduleProgressIsManagers(item));
      }
    }
  });
});
