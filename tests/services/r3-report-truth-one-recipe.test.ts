/**
 * R3 item 1 (open item, 6 Oct 2026): the phone's Reports screen and the web's
 * Reports page each built the report's Project Truth with their own copy of
 * the recipe, and neither copy gave the saved tasks to the step that decides
 * whose update it is. A field update on a task's old row (a new master moved
 * the task and hid that row), filed under an older name of the project, was
 * counted for the project by the app (A10 pass 2 F1) and then left out of the
 * report's facts again. Here: the web's side. Synthetic data.
 */
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { buildDailyReportAuthorityScope } from '../../services/ReportAuthorityScope';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined),
}));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const schedule = (id: string, importedAt: string, project = 'Alpha'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: project, projectNames: [project], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
function approveImport(state: State, source: ReferenceDocument, lines: string[]): State {
  const project = source.projectName as string;
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: [project], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') };
}
// The first master, then one that moves Pour slab: its first row is hidden and the new row answers to it.
const first = approveImport({ items: [], documents: [] }, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), [
  'Pour slab,Alpha,Lot,09/15/2026,09/18/2026,0', 'Roofing,Alpha,Lot,11/01/2026,11/10/2026,',
]);
const moved = approveImport(first, schedule('MASTER 2', '2026-09-14T12:00:00.000Z'), [
  'Pour slab,Alpha,Lot,09/22/2026,09/25/2026,0', 'Roofing,Alpha,Lot,11/01/2026,11/10/2026,',
]);
/** Filed on Pour slab's first row before the master moved it, under the project's older name, with no parent kept. */
const onOldRow = {
  id: 'u-old-row', projectName: 'Alpha Tower', date: '2026-09-10T15:00:00.000Z', photos: [], recipients: { contactIds: [] },
  notes: 'Pour slab formwork is set.', scheduleItemId: 'MASTER 1-1', scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
} as unknown as ProjectUpdate;
const webSnapshot = (state: State, updates: ProjectUpdate[]): DAVEWebReadOnlySnapshot => ({
  projects: [{ id: 'project-alpha', name: 'Alpha' }, { id: 'project-beta', name: 'Beta' }] as DAVEWebReadOnlySnapshot['projects'],
  scheduleItems: shown(state) as unknown as DAVEWebReadOnlySnapshot['scheduleItems'],
  knownScheduleItems: state.items,
  projectUpdates: updates.map(update => ({ id: update.id, updateData: update })) as unknown as DAVEWebReadOnlySnapshot['projectUpdates'],
  referenceDocuments: state.documents as unknown as DAVEWebReadOnlySnapshot['referenceDocuments'],
  refreshedAt: '2026-09-16T12:00:00.000Z',
});
const updatesIn = (snapshot: DAVEWebReadOnlySnapshot, project: string) => buildDAVEWebReportTruths(snapshot, project)[0].evidence.records
  .filter(record => record.kind === 'update').map(record => record.sourceRecordId);

describe('R3 item 1: the web report counts a field update by its task\'s hidden row, as the app does', () => {
  it('the scenario: the update names a row that is no longer shown, and the app\'s own scope counts it for Alpha', () => {
    expect(shown(moved).map(item => item.id)).toEqual(['MASTER 2-1', 'MASTER 1-2']);
    const scope = buildDailyReportAuthorityScope({
      selectedProjectName: 'Alpha', selectedProjectNames: ['Alpha'], projectRecords: [{ name: 'Alpha' }, { name: 'Beta' }] as never,
      updates: [onOldRow], scheduleItems: shown(moved), knownScheduleItems: moved.items, referenceDocuments: moved.documents,
    });
    expect(scope.updates.map(update => update.id)).toEqual(['u-old-row']);
  });

  it('the web report\'s facts have the update, on the task as it is shown now', () => {
    const truth = buildDAVEWebReportTruths(webSnapshot(moved, [onOldRow]), 'Alpha')[0];
    const record = truth.evidence.records.find(entry => entry.kind === 'update');
    expect(record).toMatchObject({ sourceRecordId: 'u-old-row', taskId: 'MASTER 2-1' });
  });

  it('an update on another project\'s hidden row stays out, whatever name it was filed under', () => {
    const beta = approveImport(moved, schedule('BETA 1', '2026-09-08T12:00:00.000Z', 'Beta'), ['Pour slab,Beta,Yard,09/15/2026,09/18/2026,0']);
    const betaMoved = approveImport(beta, schedule('BETA 2', '2026-09-15T12:00:00.000Z', 'Beta'), ['Pour slab,Beta,Yard,09/23/2026,09/26/2026,0']);
    const onBetaOldRow = { ...onOldRow, id: 'u-beta-old-row', projectName: 'Alpha', scheduleItemId: 'BETA 1-1', selectedAreaName: 'Yard' } as ProjectUpdate;
    expect(shown(betaMoved).map(item => item.id).sort()).toEqual(['BETA 2-1', 'MASTER 1-2', 'MASTER 2-1']);
    expect(updatesIn(webSnapshot(betaMoved, [onOldRow, onBetaOldRow]), 'Alpha')).toEqual(['u-old-row']);
    expect(updatesIn(webSnapshot(betaMoved, [onOldRow, onBetaOldRow]), 'Beta')).toEqual(['u-beta-old-row']);
  });

  it('guard: an update on a shown task, and one with its parent kept, are counted as before', () => {
    const onShown = { ...onOldRow, id: 'u-shown', projectName: 'Alpha', scheduleItemId: 'MASTER 1-2', scheduleTaskName: 'Roofing' } as ProjectUpdate;
    const withParent = { ...onOldRow, id: 'u-parent', projectName: 'Building 7', scheduleProjectName: 'Alpha' } as ProjectUpdate;
    expect(updatesIn(webSnapshot(moved, [onShown, withParent]), 'Alpha').sort()).toEqual(['u-parent', 'u-shown']);
  });

  it('guard: without the saved tasks (a snapshot built before they were kept) the report reads as before', () => {
    const { knownScheduleItems: _known, ...older } = webSnapshot(moved, [onOldRow]);
    expect(updatesIn(older, 'Alpha')).toEqual([]);
  });
});
