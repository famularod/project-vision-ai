/**
 * Audit round 2, A10 pass 6 L2 (30 Sep 2026): the name fallback (79f49d3)
 * linked a field update to the wrong task when its own task left the
 * schedule.
 *
 * Lot has two "Pour slab" tasks: phase 1 finished, phase 2 not started. A
 * field report says phase 1's slab is complete. The new master drops phase 1
 * and moves phase 2; with one row against two saved tasks the import pairs
 * neither, so the shown phase 2 row keeps no earlier ids. The phase 1 report's
 * task id is no task shown, and the fallback took the one task shown named
 * "Pour slab", phase 2: reconciliation warned "Possible progress is not
 * reflected in the schedule … Pour slab complete while … Not Started at 0%".
 *
 * Now the fallback by name applies only when the name was unique in the
 * update's own old schedule too: the update's old row is looked up among
 * every saved task, hidden ones included, and when its schedule had more than
 * one task of that name, the update is matched to none. The summaries take
 * every saved task as knownScheduleItems; the phone's schedule screens, home
 * and live authority, and the web, pass them. Synthetic data.
 */
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEActionInbox } from '../../services/DAVEActionInbox';
import { buildDAVEEvidenceCorrelations } from '../../services/DAVEEvidenceCorrelation';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { buildPIEScheduleReconciliation, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemAnsweringToTaskId, scheduleTaskLinks } from '../../services/ScheduleTaskRevisions';
import { buildVitruviusCommitmentControl } from '../../services/VitruviusCommitmentControl';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

const NOW = '2026-09-27T12:00:00.000Z';
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt,
}) as ReferenceDocument;
const master = schedule('MASTER 0831', '2026-08-31T12:00:00.000Z');
const master2 = schedule('MASTER 0926', '2026-09-26T08:00:00.000Z');

const HEADER = 'Task,Project,Area,Start,Finish,% Complete';
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [HEADER, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha'],
    now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((row, index) => ({
    ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[]): State {
  const documents = [...state.documents, source];
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, documents, source.importBatchId || ''), approvedAt: source.importedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents };
}
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];

// Phase 1 finished (09/01-09/03), phase 2 not started (10/01-10/03); the new master drops phase 1 and moves phase 2.
const before = approve({ items: [], documents: [] }, master, rows(master, [
  'Pour slab,Alpha,Lot,09/01/2026,09/03/2026,100%', 'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,0%', 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%',
]));
const [phase1, phase2] = before.items.filter(item => item.taskName === 'Pour slab').sort((left, right) => left.startDate.localeCompare(right.startDate));
const after = approve(before, master2, rows(master2, ['Pour slab,Alpha,Lot,10/05/2026,10/07/2026,0%', 'Roofing,Alpha,Lot,12/01/2026,12/15/2026,30%']));
const phase2Now = shown(after).find(item => item.taskName === 'Pour slab')!;

const report: ProjectUpdate = {
  id: 'u-phase1-complete', projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-04T15:00:00.000Z', photos: [],
  recipients: { contactIds: [] }, notes: 'Pour slab is complete. Finished and cured.', scheduleItemId: phase1.id,
  scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
} as ProjectUpdate;

const notReflected = (known?: readonly ScheduleItem[]) => buildPIEScheduleReconciliation({
  scheduleItems: shown(after), knownScheduleItems: known, updates: [report], projectName: 'Alpha', now: new Date(NOW),
}).warnings.filter(warning => warning.type === 'field_progress_not_reflected');

describe('A10 p6 L2: the name fallback never takes a task whose name its own old schedule shared', () => {
  it('the scenario: one Pour slab shown, unpaired, and the phase 1 report names a hidden row', () => {
    expect(shown(after).filter(item => item.taskName === 'Pour slab')).toHaveLength(1);
    expect(phase2Now).toMatchObject({ percentComplete: 0, startDate: '10/05/2026' });
    expect(phase2Now).not.toHaveProperty('revisedFromTaskIds');
    expect(after.items.some(item => item.id === phase1.id)).toBe(true);
    // Without every saved task, the fallback still takes phase 2 (what David saw).
    expect(notReflected()).toHaveLength(1);
  });

  it('with every saved task known: phase 1\'s schedule had two Pour slabs, so the report matches none', () => {
    expect(scheduleItemAnsweringToTaskId(shown(after), phase1.id, report, after.items)).toBeNull();
    expect(scheduleItemAnsweringToTaskId(shown(after), phase2.id, report, after.items)).toBeNull();
    expect(notReflected(after.items)).toEqual([]);
  });

  it('every summary that resolves a task id takes the guard', () => {
    const items = shown(after);
    const correlation = buildDAVEEvidenceCorrelations({ scheduleItems: items, knownScheduleItems: after.items, updates: [report], now: NOW });
    expect(correlation.tasks.flatMap(task => task.evidence).filter(claim => claim.kind === 'field_update')).toEqual([]);
    const truth = buildDAVEProjectTruth({
      projectId: 'project-alpha', projectName: 'Alpha', updates: [report], scheduleItems: items, knownScheduleItems: after.items,
      referenceDocuments: after.documents, now: NOW,
    });
    expect(truth.entityLinks.filter(link => link.targetType === 'schedule-task' && link.targetId === phase2Now.id && link.sourceEvidenceId.startsWith('update:'))).toEqual([]);
    const withAction = { ...report, photos: [{
      id: 'p-1', uri: 'file:///p-1.jpg', caption: 'Edge', category: 'Open Issue', actionRequired: 'Patch the edge', actionOwner: 'Acme',
      actionDueDate: '', actionStatus: 'Open', selectedAreaName: 'Lot',
    }] } as unknown as ProjectUpdate;
    const inbox = buildDAVEActionInbox({ scheduleItems: items, knownScheduleItems: after.items, updates: [withAction], now: new Date(NOW) });
    expect(inbox.items.find(item => item.kind === 'field_action')?.scheduleItemId).toBe(phase1.id);
    const control = buildVitruviusCommitmentControl({ projectNames: ['Alpha'], scheduleItems: items, knownScheduleItems: after.items, updates: [report], now: new Date(NOW) });
    expect(control.items.find(item => item.id === phase2Now.id)?.latestFieldUpdateAt ?? null).toBeNull();
  });

  it('a name unique in the old schedule still falls back (a row saved before the earlier ids were kept)', () => {
    const single = approve({ items: [], documents: [] }, master, rows(master, ['Pour slab,Alpha,Lot,09/28/2026,09/30/2026,40%']));
    const oldId = single.items[0].id;
    const moved = approve(single, master2, rows(master2, ['Pour slab,Alpha,Lot,09/29/2026,10/01/2026,40%']));
    const legacy = moved.items.map(({ revisedFromTaskIds: _earlier, ...item }) => item as ScheduleItem);
    const shownLegacy = shown({ ...moved, items: legacy });
    const update = { ...report, scheduleItemId: oldId };
    expect(scheduleTaskLinks(shownLegacy, legacy)(update)).toMatchObject({ basis: 'stored_task_name' });
  });

  it('a Pour slab of another area in the old schedule does not count against it', () => {
    const twoAreas = approve({ items: [], documents: [] }, master, rows(master, [
      'Pour slab,Alpha,Lot,09/28/2026,09/30/2026,40%', 'Pour slab,Alpha,Deck,09/28/2026,09/30/2026,10%',
    ]));
    const lotId = twoAreas.items.find(item => item.locationName === 'Lot')!.id;
    const moved = approve(twoAreas, master2, rows(master2, ['Pour slab,Alpha,Lot,09/29/2026,10/01/2026,40%']));
    const legacy = moved.items.map(({ revisedFromTaskIds: _earlier, ...item }) => item as ScheduleItem);
    const update = { ...report, scheduleItemId: lotId };
    expect(scheduleTaskLinks(shown({ ...moved, items: legacy }), legacy)(update)?.item.locationName).toBe('Lot');
  });

  it('the phone and the web pass every saved task to the summaries', () => {
    const app = read('App.tsx');
    expect(app).toContain('knownScheduleItems={scheduleItems}');
    expect(app.match(/knownScheduleItems,/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(read('services/DAVEWebReadOnlyRepository.ts')).toContain('knownScheduleItems: Object.freeze(reconciledScheduleItems)');
    expect(read('services/DAVEWebOperations.ts')).toContain('knownScheduleItems: snapshot.knownScheduleItems');
  });
});
