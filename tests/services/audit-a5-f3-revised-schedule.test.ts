import { findExactScheduleTaskForCompletionClaim } from '../../services/DAVECompletionVerification';
import {
  bindPIEScheduleImportBatchProvenance,
  dedupeScheduleImportItems,
  type PIEScheduleImportBatch,
} from '../../services/PIEScheduleImportBatch';
import { normalizeMicrosoftProjectPdfRows } from '../../services/PIEScheduleIntelligence';
import { reconcileCurrentScheduleDocuments, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { scheduleDocumentsAfterApproval } from '../../services/ScheduleDocumentLabels';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import {
  bindStableScheduleImportItemIds,
  buildScheduleImportSourceIdentity,
} from '../../services/ScheduleImportSourceIdentity';
import type { ProjectArea, ReferenceDocument, ScheduleItem } from '../../types';

// Whole-app audit A5 pass 3 F3 (30 Sep 2026): a revised Microsoft Project
// schedule with one task inserted renumbers the ID, row and WBS of every task
// below it. Each revision here goes the approval's way: parse, stable ids,
// batch provenance, merge, document labels, then the list the manager sees.
// Synthetic schedule text only.

type Row = readonly [name: string, indent: number, start: string, finish: string];
type State = Readonly<{ items: ScheduleItem[]; documents: ReferenceDocument[] }>;

const PROJECT = { id: 'project-alpha', name: 'Alpha Tower' };
const EMPTY: State = { items: [], documents: [] };

/** Rows numbered the way Microsoft Project numbers them: ID and WBS follow the row. */
function mspText(rows: readonly Row[]): string {
  const counters: number[] = [];
  return [
    'ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete\tWBS',
    ...rows.map(([name, indent, start, finish], index) => {
      counters.length = indent + 1;
      counters[indent] = (counters[indent] || 0) + 1;
      return [index + 1, name, indent, '5 days', start, finish, '0%', counters.join('.')].join('\t');
    }),
  ].join('\n');
}

function prepare(rows: readonly Row[], version: string, importedAt: string, areas: string[] = []): PIEScheduleImportBatch {
  const text = mspText(rows);
  const parsed = normalizeMicrosoftProjectPdfRows({
    contents: text,
    sourceName: `alpha-${version}.pdf`,
    projects: [PROJECT.name],
    projectAreas: areas.map(name => ({ id: name, name, latitude: 0, longitude: 0, radiusFeet: 100 }) as ProjectArea),
    now: new Date(importedAt),
  });
  const source = buildScheduleImportSourceIdentity({ bytes: new TextEncoder().encode(text), projects: [PROJECT] });
  const document = {
    id: source.documentId, name: `Alpha schedule ${version}`, originalFileName: `alpha-${version}.pdf`, uri: '',
    category: 'Schedules', notes: '', isCurrent: true, importedAt, importBatchId: source.batchId, projectNames: [PROJECT.name],
  } as ReferenceDocument;
  return {
    id: source.batchId, kind: 'schedule_file', sourceCount: 1, sourceLabel: document.originalFileName, message: '',
    items: dedupeScheduleImportItems(bindStableScheduleImportItemIds(parsed, source)),
    documents: [document],
  };
}

function approve(state: State, reviewed: PIEScheduleImportBatch) {
  const batch = bindPIEScheduleImportBatchProvenance(reviewed);
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items,
    imported: batch.items,
    completionMatch: findExactScheduleTaskForCompletionClaim,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, state.documents, batch.id),
    mergeCompletion: item => item,
  });
  const documents = scheduleDocumentsAfterApproval({
    documents: state.documents, approvedDocuments: batch.documents, approvedItems: batch.items,
    updatedAt: batch.documents[0]?.importedAt || '2026-09-30T00:00:00.000Z',
  });
  return { merged, state: { items: [...merged.additions, ...merged.next], documents } as State };
}

const visible = (state: State) =>
  selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents });
/** The n-th visible task of that name (and area), in file order. */
const shown = (state: State, taskName: string, nth = 0, area?: string) => visible(state)
  .filter(item => item.taskName === taskName && (area === undefined || item.locationName === area))
  .sort((left, right) => (left.sourceRowNumber || 0) - (right.sourceRowNumber || 0))[nth];
/** The manager records progress (and owner or notes) on the task they see. */
function manage(state: State, taskName: string, patch: Partial<ScheduleItem>, nth = 0, area?: string): State {
  const target = shown(state, taskName, nth, area);
  if (!target) throw new Error(`No visible ${taskName}`);
  const status = (patch.percentComplete ?? 0) >= 100 ? 'Complete' : 'In Progress';
  return {
    ...state,
    items: state.items.map(item => item.id === target.id ? {
      ...item, status, progressSource: 'project_manager', progressConfirmedAt: '2026-08-12T15:00:00.000Z',
      progressConfirmedBy: 'PM', ...patch,
    } : item),
  };
}
const progressOf = (item: ScheduleItem | undefined) => item && [item.percentComplete, item.progressSource ?? null, item.owner];

const V1: Row[] = [
  ['ALPHA TOWER', 0, '8/3/26', '9/25/26'],
  ['Clear site', 1, '8/3/26', '8/7/26'],
  ['Excavate', 1, '8/10/26', '8/14/26'],
  ['Pour footings', 1, '8/17/26', '8/21/26'],
  ['Frame walls', 1, '8/24/26', '8/28/26'],
  ['Paint', 1, '9/14/26', '9/18/26'],
];
const withInsert = (rows: readonly Row[], after: string, row: Row) => {
  const index = rows.findIndex(([name]) => name === after) + 1;
  return [...rows.slice(0, index), row, ...rows.slice(index)];
};
const SURVEY: Row = ['Survey layout', 1, '8/5/26', '8/7/26'];

describe('a revised schedule with an inserted task keeps the manager’s progress', () => {
  let v1 = approve(EMPTY, prepare(V1, 'v1', '2026-08-01T12:00:00.000Z')).state;
  v1 = manage(v1, 'Excavate', { percentComplete: 100, owner: 'Crew A' });
  v1 = manage(v1, 'Pour footings', { percentComplete: 40, owner: 'Crew B', notes: 'Pump truck booked' });

  it('the tasks below an inserted row are re-homed with their id, progress, owner and notes', () => {
    const before = { excavate: shown(v1, 'Excavate'), footings: shown(v1, 'Pour footings') };
    const v2Batch = prepare(withInsert(V1, 'Clear site', SURVEY), 'v2', '2026-08-15T12:00:00.000Z');
    // The file renumbered them: the strict import identity no longer matches.
    expect(v2Batch.items.find(item => item.taskName === 'Excavate')).toMatchObject({ sourceActivityId: '4', sourceWbsCode: '1.3', sourceRowNumber: 5 });
    expect(before.excavate).toMatchObject({ sourceActivityId: '3', sourceWbsCode: '1.2', sourceRowNumber: 4 });
    const { merged, state } = approve(v1, v2Batch);

    expect(merged.additions.map(item => item.taskName)).toEqual(['Survey layout']);
    expect(merged.carriedProgressIds).toEqual([]);
    expect(merged.rehomedIds).toHaveLength(5);
    expect(shown(state, 'Excavate')).toMatchObject({ id: before.excavate.id, percentComplete: 100, status: 'Complete', owner: 'Crew A' });
    expect(shown(state, 'Pour footings')).toMatchObject({
      id: before.footings.id, percentComplete: 40, progressSource: 'project_manager', owner: 'Crew B', notes: 'Pump truck booked',
    });
    expect(visible(state).map(item => item.taskName).sort()).toEqual(
      ['Clear site', 'Excavate', 'Frame walls', 'Paint', 'Pour footings', 'Survey layout']);
  });

  it('an insert and shifted dates: progress, owner, notes and a verified completion carry; an owner the file names wins', () => {
    const verified = {
      status: 'pm_verified' as const, reportedAt: '2026-08-14T15:00:00.000Z', reportedBy: 'Field', priorScheduleStatus: 'In Progress' as const,
      priorPercentComplete: 80, verifiedAt: '2026-08-14T16:00:00.000Z', verifiedBy: 'PM', verificationNote: null, evidence: [],
    };
    const saved = manage(v1, 'Excavate', { percentComplete: 100, owner: 'Crew A', notes: 'Spoil hauled off', completionVerification: verified });
    const shifted = withInsert(V1, 'Clear site', SURVEY).map(row =>
      row[0] === 'Excavate' ? ['Excavate', 1, '8/12/26', '8/18/26'] as Row
        : row[0] === 'Pour footings' ? ['Pour footings', 1, '8/19/26', '8/25/26'] as Row
          : row[0] === 'Frame walls' ? ['Frame walls', 1, '8/26/26', '9/1/26'] as Row : row);
    const v2Batch = prepare(shifted, 'v2', '2026-08-15T12:00:00.000Z');
    // The reviewer named an owner for the footings before approving.
    const reviewed = { ...v2Batch, items: v2Batch.items.map(item => item.taskName === 'Pour footings' ? { ...item, owner: 'Crew C' } : item) };
    const { merged, state } = approve(saved, reviewed);

    expect(merged.carriedProgressIds).toHaveLength(2);
    expect(shown(state, 'Excavate')).toMatchObject({
      finishDate: '08/18/2026', percentComplete: 100, status: 'Complete', progressSource: 'project_manager', progressConfirmedBy: 'PM',
      owner: 'Crew A', notes: 'Spoil hauled off', completionVerification: verified,
    });
    expect(shown(state, 'Pour footings')).toMatchObject({
      finishDate: '08/25/2026', percentComplete: 40, owner: 'Crew C', notes: 'Pump truck booked',
    });
    expect(visible(state).filter(item => item.taskName === 'Excavate')).toHaveLength(1);
    // A moved task the manager never touched arrives as the file has it.
    expect(shown(state, 'Frame walls')).toMatchObject({ finishDate: '09/01/2026', percentComplete: 0, owner: '' });
    expect(shown(state, 'Frame walls').progressSource).not.toBe('project_manager');
  });

  it('a task changed in three revisions running keeps the progress recorded on each', () => {
    const paintOn = (start: string, finish: string) => V1.map(row => row[0] === 'Paint' ? ['Paint', 1, start, finish] as Row : row);
    let state = manage(v1, 'Paint', { percentComplete: 20 });
    state = approve(state, prepare(paintOn('9/21/26', '9/25/26'), 'v2', '2026-08-15T12:00:00.000Z')).state;
    expect(progressOf(shown(state, 'Paint'))).toEqual([20, 'project_manager', '']);
    state = manage(state, 'Paint', { percentComplete: 60, owner: 'Painter' });
    const v3 = approve(state, prepare(paintOn('9/28/26', '10/2/26'), 'v3', '2026-09-01T12:00:00.000Z'));
    // The hidden v1 copy no longer makes the match ambiguous.
    expect(v3.state.items.filter(item => item.taskName === 'Paint' && item.progressSource === 'project_manager')).toHaveLength(3);
    expect(v3.merged.carriedProgressIds).toHaveLength(1);
    expect(shown(v3.state, 'Paint')).toMatchObject({ finishDate: '10/02/2026', percentComplete: 60, owner: 'Painter' });
    expect(visible(v3.state).filter(item => item.taskName === 'Paint')).toHaveLength(1);
  });

  it('approving the same revised file again keeps the progress recorded since', () => {
    const shifted = withInsert(V1, 'Clear site', SURVEY).map(row =>
      row[0] === 'Pour footings' ? ['Pour footings', 1, '8/19/26', '8/25/26'] as Row : row);
    const v2Batch = prepare(shifted, 'v2', '2026-08-15T12:00:00.000Z');
    const approved = approve(v1, v2Batch).state;
    // A refresh has since marked the first schedule not current.
    const refreshed = { ...approved, documents: reconcileCurrentScheduleDocuments(approved.documents) };
    expect(refreshed.documents.filter(document => document.isCurrent)).toHaveLength(1);
    const v2 = manage(refreshed, 'Pour footings', { percentComplete: 70 });
    const again = approve(v2, prepare(shifted, 'v2', '2026-08-15T12:00:00.000Z'));
    expect(again.merged.additions).toEqual([]);
    expect(again.merged.carriedProgressIds).toEqual([]);
    expect(shown(again.state, 'Pour footings')).toMatchObject({ finishDate: '08/25/2026', percentComplete: 70 });
  });

  it('a second Accept Selected approval still finds the tasks the first one hid', () => {
    const shifted = withInsert(V1, 'Clear site', SURVEY).map(row =>
      row[0] === 'Pour footings' ? ['Pour footings', 1, '8/19/26', '8/25/26'] as Row : row);
    const v2Batch = prepare(shifted, 'v2', '2026-08-15T12:00:00.000Z');
    const first = approve(v1, { ...v2Batch, items: v2Batch.items.filter(item => item.taskName !== 'Pour footings') }).state;
    expect(shown(first, 'Pour footings')).toBeUndefined();
    const rest = approve(first, { ...v2Batch, items: v2Batch.items.filter(item => item.taskName === 'Pour footings'), documents: [] });
    expect(rest.merged.carriedProgressIds).toHaveLength(1);
    expect(shown(rest.state, 'Pour footings')).toMatchObject({ finishDate: '08/25/2026', percentComplete: 40, owner: 'Crew B' });
  });
});

describe('same-named tasks pair in file order and never by ID', () => {
  const QI = (start: string): Row => ['Quality inspection', 1, start, start];
  const V1_QI: Row[] = [
    ['ALPHA TOWER', 0, '8/3/26', '9/25/26'],
    ['Pour footings', 1, '8/3/26', '8/7/26'],
    QI('8/10/26'),
    ['Frame walls', 1, '8/11/26', '8/21/26'],
    QI('8/24/26'),
  ];
  let v1 = approve(EMPTY, prepare(V1_QI, 'v1', '2026-08-01T12:00:00.000Z')).state;
  v1 = manage(v1, 'Quality inspection', { percentComplete: 100, owner: 'Inspector A' }, 0);
  v1 = manage(v1, 'Quality inspection', { percentComplete: 25, owner: 'Inspector B' }, 1);
  const moved = (rows: readonly Row[]) => rows.map(row => row[0] === 'Quality inspection'
    ? QI(row[2] === '8/10/26' ? '8/12/26' : '8/26/26') : row);

  it('two inspections moved by a revision with an inserted row each keep their own progress', () => {
    // Saved order is not file order; the pairing reads the file rows.
    const stored = { ...v1, items: [...v1.items].reverse() };
    const { merged, state } = approve(stored, prepare(moved(withInsert(V1_QI, 'Pour footings', ['Strip forms', 1, '8/8/26', '8/8/26'])), 'v2', '2026-08-15T12:00:00.000Z'));
    expect(merged.carriedProgressIds).toHaveLength(2);
    expect(progressOf(shown(state, 'Quality inspection', 0))).toEqual([100, 'project_manager', 'Inspector A']);
    expect(shown(state, 'Quality inspection', 0).finishDate).toBe('08/12/2026');
    expect(progressOf(shown(state, 'Quality inspection', 1))).toEqual([25, 'project_manager', 'Inspector B']);
    expect(shown(state, 'Quality inspection', 1).finishDate).toBe('08/26/2026');
  });

  it('three inspections against two saved carry nothing to any of them', () => {
    const three = [...moved(withInsert(V1_QI, 'Pour footings', ['Strip forms', 1, '8/8/26', '8/8/26'])), QI('9/4/26')];
    const { merged, state } = approve(v1, prepare(three, 'v2', '2026-08-15T12:00:00.000Z'));
    expect(merged.carriedProgressIds).toEqual([]);
    const inspections = visible(state).filter(item => item.taskName === 'Quality inspection');
    expect(inspections).toHaveLength(3);
    expect(inspections.map(item => item.percentComplete)).toEqual([0, 0, 0]);
    // The rest of the schedule still pairs.
    expect(shown(state, 'Frame walls').id).toBe(shown(v1, 'Frame walls').id);
  });
});

describe('Drywall on Level 1 and Level 2 never swap progress', () => {
  const V1_LEVELS: Row[] = [
    ['ALPHA TOWER', 0, '8/3/26', '9/25/26'],
    ['LEVEL 1', 1, '8/3/26', '8/21/26'],
    ['Frame walls', 2, '8/3/26', '8/7/26'],
    ['Drywall', 2, '8/10/26', '8/14/26'],
    ['LEVEL 2', 1, '8/17/26', '9/4/26'],
    ['Drywall', 2, '8/17/26', '8/21/26'],
    ['Paint', 2, '8/24/26', '8/28/26'],
  ];
  const revised = (rows: readonly Row[]) => withInsert(rows, 'Frame walls', ['Fire caulk', 2, '8/8/26', '8/8/26'])
    .map(row => row[0] === 'Drywall' ? ['Drywall', 2, row[2], row[2] === '8/10/26' ? '8/17/26' : '8/26/26'] as Row : row);
  // Headings the project does not know leave both Drywall rows with no area.
  let unmapped = approve(EMPTY, prepare(V1_LEVELS, 'v1', '2026-08-01T12:00:00.000Z')).state;
  unmapped = manage(unmapped, 'Drywall', { percentComplete: 90 }, 0);
  unmapped = manage(unmapped, 'Drywall', { percentComplete: 10 }, 1);

  it('with no area on either, each keeps its own through an insert', () => {
    expect(visible(unmapped).filter(item => item.taskName === 'Drywall').map(item => item.locationName)).toEqual(['', '']);
    const { state } = approve(unmapped, prepare(revised(V1_LEVELS), 'v2', '2026-08-15T12:00:00.000Z'));
    expect([shown(state, 'Drywall', 0), shown(state, 'Drywall', 1)].map(item => [item.finishDate, item.percentComplete]))
      .toEqual([['08/17/2026', 90], ['08/26/2026', 10]]);
  });

  it('saved with no area, then revised with both areas known: unchanged rows re-home to their own; moved ones carry nothing', () => {
    const punchList: Row = ['Punch list', 1, '9/21/26', '9/25/26'];
    const same = approve(unmapped, prepare([...V1_LEVELS, punchList], 'v2', '2026-08-15T12:00:00.000Z', ['Level 1', 'Level 2'])).state;
    expect(progressOf(shown(same, 'Drywall', 0, 'Level 1'))).toEqual([90, 'project_manager', '']);
    expect(progressOf(shown(same, 'Drywall', 0, 'Level 2'))).toEqual([10, 'project_manager', '']);
    const { merged, state } = approve(unmapped, prepare(revised(V1_LEVELS), 'v2', '2026-08-15T12:00:00.000Z', ['Level 1', 'Level 2']));
    expect(merged.carriedProgressIds).toEqual([]);
    expect(shown(state, 'Drywall', 0, 'Level 1').percentComplete).toBe(0);
    expect(shown(state, 'Drywall', 0, 'Level 2').percentComplete).toBe(0);
  });

  it('a Level 2 Drywall saved with no area never gives its progress to a new Level 1 Drywall', () => {
    const noLevel1Drywall = V1_LEVELS.filter((row, index) => index !== 3);
    let saved = approve(EMPTY, prepare(noLevel1Drywall, 'v1', '2026-08-01T12:00:00.000Z')).state;
    saved = manage(saved, 'Drywall', { percentComplete: 10 });
    expect(shown(saved, 'Drywall').locationName).toBe('');
    const { merged, state } = approve(saved, prepare(revised(V1_LEVELS), 'v2', '2026-08-15T12:00:00.000Z', ['Level 1', 'Level 2']));
    expect(merged.carriedProgressIds).toEqual([]);
    expect(shown(state, 'Drywall', 0, 'Level 1').percentComplete).toBe(0);
  });

  it('with both areas known, each pairs only with its own level', () => {
    let mapped = approve(EMPTY, prepare(V1_LEVELS, 'v1', '2026-08-01T12:00:00.000Z', ['Level 1', 'Level 2'])).state;
    mapped = manage(mapped, 'Drywall', { percentComplete: 90 }, 0, 'Level 1');
    mapped = manage(mapped, 'Drywall', { percentComplete: 10 }, 0, 'Level 2');
    const { state } = approve(mapped, prepare(revised(V1_LEVELS), 'v2', '2026-08-15T12:00:00.000Z', ['Level 1', 'Level 2']));
    expect(shown(state, 'Drywall', 0, 'Level 1')).toMatchObject({ finishDate: '08/17/2026', percentComplete: 90 });
    expect(shown(state, 'Drywall', 0, 'Level 2')).toMatchObject({ finishDate: '08/26/2026', percentComplete: 10 });
  });
});

describe('the strict import identity still de-duplicates one file', () => {
  it('a row repeated in one approval re-homes its saved task once and is not added again', () => {
    const row = (id: string, importBatchId: string) => ({
      id, importBatchId, sourceDocumentId: `doc-${importBatchId}`, projectName: 'Alpha Tower', locationName: '', taskName: 'Deliver panels',
      startDate: '09/01/2026', finishDate: '09/02/2026', milestone: '', owner: '', contractor: '', status: 'Not Started',
      percentComplete: 0, priority: 'Medium', notes: '', createdAt: '2026-09-01T00:00:00.000Z',
    }) as ScheduleItem;
    const merged = mergeApprovedScheduleImportItems({
      existing: [row('saved', 'b1')],
      imported: [row('first', 'b2'), row('repeat', 'b2')],
      completionMatch: () => null,
      mergeCompletion: item => item,
    });
    expect(merged.rehomedIds).toEqual(['saved']);
    expect(merged.additions).toEqual([]);
  });
});
