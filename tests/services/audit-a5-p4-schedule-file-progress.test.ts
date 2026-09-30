import { findExactScheduleTaskForCompletionClaim } from '../../services/DAVECompletionVerification';
import {
  bindPIEScheduleImportBatchProvenance,
  dedupeScheduleImportItems,
  type PIEScheduleImportBatch,
} from '../../services/PIEScheduleImportBatch';
import { normalizeMicrosoftProjectPdfRows } from '../../services/PIEScheduleIntelligence';
import { recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { scheduleDocumentsAfterApproval } from '../../services/ScheduleDocumentLabels';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import {
  bindStableScheduleImportItemIds,
  buildScheduleImportSourceIdentity,
} from '../../services/ScheduleImportSourceIdentity';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// Whole-app audit A5 pass 4 #1 (30 Sep 2026): re-importing an updated
// Microsoft Project schedule ignored the scheduler's % Complete. A task on the
// same dates was re-homed with its old 0%; a task the manager had at 40% whose
// update said 100% (with an earlier actual finish) kept 40%. Each import here
// goes the phone approval's way: parse, stable ids, batch provenance, merge,
// document labels, then the list the manager sees. Synthetic schedule text only.

type Row = readonly [name: string, indent: number, start: string, finish: string, percent?: number];
type State = Readonly<{ items: ScheduleItem[]; documents: ReferenceDocument[] }>;

const PROJECTS = [{ id: 'project-alpha', name: 'Alpha Tower' }, { id: 'project-beta', name: 'Beta Plaza' }];
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

function approve(state: State, reviewed: PIEScheduleImportBatch, approvedAt: string) {
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
  return { merged, state: { items: [...merged.additions, ...merged.next], documents } as State };
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
      progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'PM', updatedAt: at,
    } : item),
  };
}
const progress = (item: ScheduleItem) => [item.percentComplete, item.status];

// A combined master: Alpha Tower and Beta Plaza in one file.
const master = (percent: Record<string, number> = {}, finish: Record<string, string> = {}): Row[] => [
  ['ALPHA TOWER', 0, '7/6/26', '9/25/26'],
  ['Clear site', 1, '7/6/26', '7/10/26', percent['Clear site']],
  ['Excavate', 1, '8/10/26', '8/14/26', percent.Excavate],
  ['Pour footings', 1, '8/17/26', finish['Pour footings'] ?? '8/21/26', percent['Pour footings']],
  ['Frame walls', 1, '8/24/26', '8/28/26', percent['Frame walls']],
  ['Paint', 1, '9/14/26', '9/18/26', percent.Paint],
  ['BETA PLAZA', 0, '7/6/26', '9/25/26'],
  ['Grade lot', 1, '8/3/26', '8/7/26', percent['Grade lot']],
];

describe('a schedule update brings the scheduler’s % Complete (A5 pass 4 #1)', () => {
  let july = approve(EMPTY, prepare(master(), 'MASTER 7152026.pdf', '2026-07-15T12:00:00.000Z'), '2026-07-15T12:00:00.000Z').state;
  july = manage(july, 'Pour footings', 40, '2026-08-18T15:00:00.000Z');
  july = manage(july, 'Paint', 30, '2026-08-20T15:00:00.000Z');
  const august = prepare(master(
    { Excavate: 100, 'Frame walls': 60, 'Pour footings': 100, 'Grade lot': 100, Paint: 10 },
    { 'Pour footings': '8/20/26' },
  ), 'MASTER UPDATE 8312026.pdf', '2026-08-31T12:00:00.000Z');

  it('a task on the same dates takes the file’s percent in place; one the manager moved takes the higher', () => {
    const before = { excavate: shown(july, 'Excavate'), frame: shown(july, 'Frame walls'), paint: shown(july, 'Paint') };
    const { merged, state } = approve(july, august, '2026-09-01T09:00:00.000Z');

    // Same dates: the same task, now as far along as the scheduler says.
    expect(shown(state, 'Excavate')).toMatchObject({ id: before.excavate.id, percentComplete: 100, status: 'Complete' });
    expect(shown(state, 'Frame walls')).toMatchObject({ id: before.frame.id, percentComplete: 60, status: 'In Progress' });
    expect(progress(shown(state, 'Grade lot'))).toEqual([100, 'Complete']);
    // The manager's 40%; the file says 100% with an earlier actual finish.
    expect(shown(state, 'Pour footings')).toMatchObject({ finishDate: '08/20/2026', percentComplete: 100, status: 'Complete' });
    // The manager's 30% is never lowered by the file's 10%.
    expect(shown(state, 'Paint')).toMatchObject({
      id: before.paint.id, percentComplete: 30, progressSource: 'project_manager', progressConfirmedBy: 'PM',
    });
    expect(merged.carriedProgressIds).toEqual([]);
    expect(merged.fileProgressIds).toHaveLength(4);
  });

  it('a raised manager task keeps its rank, so a device still holding the manager’s 40% cannot win it back', () => {
    const manager = manage(july, 'Excavate', 40, '2026-08-25T15:00:00.000Z');
    const stale = shown(manager, 'Excavate');
    const { state } = approve(manager, august, '2026-09-01T09:00:00.000Z');
    const raised = shown(state, 'Excavate');
    expect(raised).toMatchObject({
      id: stale.id, percentComplete: 100, status: 'Complete', progressSource: 'project_manager',
      progressConfirmedAt: '2026-09-01T09:00:00.000Z', progressConfirmedBy: 'Schedule update',
    });
    // Another phone starts with the old copy and reads the cloud's.
    const [onOtherPhone] = recoverDAVEScheduleRecords({ local: [stale], cloud: [raised], allowCloudOnly: true });
    expect(progress(onOtherPhone)).toEqual([100, 'Complete']);
    // A task the file updated from another file's value, likewise.
    const frame = { before: shown(july, 'Frame walls'), after: shown(approve(july, august, '2026-09-01T09:00:00.000Z').state, 'Frame walls') };
    const [frameElsewhere] = recoverDAVEScheduleRecords({ local: [frame.before], cloud: [frame.after], allowCloudOnly: true });
    expect(progress(frameElsewhere)).toEqual([60, 'In Progress']);
  });

  it('a later file may lower what an earlier file said (a scheduler’s correction), never what the manager said', () => {
    let state = approve(july, august, '2026-09-01T09:00:00.000Z').state;
    const september = prepare(master(
      { Excavate: 100, 'Frame walls': 50, 'Pour footings': 100, 'Grade lot': 100, Paint: 0 },
      { 'Pour footings': '8/20/26' },
    ), 'MASTER UPDATE 9142026.pdf', '2026-09-14T12:00:00.000Z');
    state = approve(state, september, '2026-09-15T09:00:00.000Z').state;
    expect(progress(shown(state, 'Frame walls'))).toEqual([50, 'In Progress']);
    expect(progress(shown(state, 'Paint'))).toEqual([30, 'In Progress']);
    // A value the file raised is the file's: the next file may correct it.
    const october = prepare(master(
      { Excavate: 90, 'Frame walls': 50, 'Pour footings': 100, 'Grade lot': 100 },
      { 'Pour footings': '8/20/26' },
    ), 'MASTER UPDATE 10012026.pdf', '2026-10-01T12:00:00.000Z');
    expect(progress(shown(approve(state, october, '2026-10-01T13:00:00.000Z').state, 'Excavate'))).toEqual([90, 'In Progress']);
  });

  it('approving an older file again changes no progress', () => {
    const approved = approve(july, august, '2026-09-01T09:00:00.000Z').state;
    const september = prepare(master(
      { Excavate: 100, 'Frame walls': 80, 'Pour footings': 100, 'Grade lot': 100 },
      { 'Pour footings': '8/20/26' },
    ), 'MASTER UPDATE 9142026.pdf', '2026-09-14T12:00:00.000Z');
    const newer = approve(approved, september, '2026-09-15T09:00:00.000Z').state;
    const again = approve(newer, august, '2026-09-16T09:00:00.000Z');
    expect(again.merged.fileProgressIds).toEqual([]);
    expect(progress(shown(again.state, 'Frame walls'))).toEqual([80, 'In Progress']);
  });
});
