/**
 * Whole-app audit A5 pass 10 M1 (30 Sep 2026): deleting a lookahead could
 * lose David's newer percent on Set Active or Make Current.
 *
 * Master A has Pour slab at 20%; David enters 40%. Lookahead L sets 60%.
 * Master B moves the task, and David enters 70% on the moved row. Delete PDF
 * + Items on L gives the hidden old row its 40% back (A5 pass 9 L1), stamped
 * as confirmed at the delete, with David's own time kept only as when it was
 * judged (progressJudgment). Set Active's carry dates progress by its
 * confirmation, so the old row's 40% looked newer than David's 70%: Set
 * Active on A showed 40%, and Set Active on B again wrote 40% onto B's row
 * and synced it, so 70% was gone everywhere.
 *
 * Now the carry dates progress by when it was judged
 * (scheduleProgressJudgedAt): David's 40% of 10 Sep is older than his 70% of
 * 27 Sep. The phone and the web Make Current use the same carry. Synthetic
 * data.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedOnActivation,
} from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleImportAddsToMaster, scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

const DAVID_40_AT = '2026-09-10T15:00:00.000Z';
const DAVID_70_AT = '2026-09-27T15:00:00.000Z';
const DELETED_AT = '2026-09-28T00:00:00.000Z';
/**
 * The give-back as a build before A5 pass 12 K2 (1 Oct 2026) stamped it: confirmed at the delete (28 Sep),
 * after David's 70% (27 Sep). Since K2 it is confirmed 1 ms after the lookahead's approval (20 Sep), older than
 * the 70% (audit-r2-a5p12-lookahead-give-back-stale-device.test.ts). Rows given back before K2 are still in the
 * cloud, and this test's scenario is theirs, so it keeps their stamp.
 */
const asGivenBackBeforeK2 = (item: ScheduleItem): ScheduleItem => item.progressJudgment
  ? { ...item, progressConfirmedAt: DELETED_AT, progressJudgment: { ...item.progressJudgment, givenBackAt: DELETED_AT } }
  : item;
const schedule = (id: string, importedAt: string, extra: Partial<ReferenceDocument> = {}) => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...extra,
}) as ReferenceDocument;
const masterA = schedule('MASTER A', '2026-08-31T12:00:00.000Z');
const lookahead = schedule('Alpha 3 Week Lookahead', '2026-09-20T12:00:00.000Z', { scheduleRole: 'lookahead' });
const masterB = schedule('MASTER B', '2026-09-26T12:00:00.000Z');

const PERCENT = 'Task,Project,Area,Start,Finish,% Complete';
const NO_PERCENT = 'Task,Project,Area,Start,Finish';
function rows(source: ReferenceDocument, header: string, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [header, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha'],
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
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, documents, source.importBatchId || ''),
    overlay: scheduleImportAddsToMaster({ id: source.importBatchId || '', documents: [source] }, state.documents),
    approvedAt: source.importedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents };
}
/** David enters a percent on the phone. */
const entered = (state: State, id: string, percentComplete: number, at: string): State => ({
  ...state,
  items: state.items.map(item => item.id === id ? {
    ...item, percentComplete, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David',
    progressConfirmedAt: at, updatedAt: at,
  } as ScheduleItem : item),
});
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const pourOf = (items: readonly ScheduleItem[]) => items.find(item => item.taskName === 'Pour slab')!;

/** The phone's Set Active (App.tsx activateReferenceDocument): the schedules after, and the progress carried onto the tasks now shown. */
function setActive(state: State, document: ReferenceDocument, now: string): State {
  const target = state.documents.find(saved => saved.id === document.id)!;
  const documentsAfter = scheduleDocumentsAfterActivation(target, state.documents, 'project');
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}

describe('A5 p10 M1: after deleting a lookahead, Set Active keeps David\'s newer percent', () => {
  const atA = approve({ items: [], documents: [] }, masterA, rows(masterA, PERCENT, ['Pour slab,Alpha,Lot,10/01/2026,10/03/2026,20%']));
  const oldRow = pourOf(atA.items);
  const withL = approve(entered(atA, oldRow.id, 40, DAVID_40_AT), lookahead, rows(lookahead, PERCENT, ['Pour slab,Alpha,Lot,09/28/2026,09/30/2026,60%']));
  const movedState = approve(withL, masterB, rows(masterB, NO_PERCENT, ['Pour slab,Alpha,Lot,10/05/2026,10/07/2026']));
  const movedRow = pourOf(shown(movedState));
  const at70 = entered(movedState, movedRow.id, 70, DAVID_70_AT);

  function deleteLookahead(state: State): State {
    const removed = scheduleItemsOnlyInImportBatch(state.items, lookahead, state.documents);
    const items = state.items.filter(item => !removed.includes(item));
    const documents = state.documents.filter(saved => saved.id !== lookahead.id);
    const changed = new Map(scheduleItemsAfterScheduleDeleted({ items, removed, document: lookahead, documents, updatedAt: DELETED_AT })
      .map(item => [item.id, asGivenBackBeforeK2(item)]));
    return { items: items.map(item => changed.get(item.id) || item), documents };
  }

  it('the scenario: B\'s row holds David\'s 70%; after the delete the hidden old row holds his 40%, confirmed at the delete', () => {
    expect(movedRow.id).not.toBe(oldRow.id);
    const deleted = deleteLookahead(at70);
    expect(pourOf(shown(deleted))).toMatchObject({ id: movedRow.id, percentComplete: 70, progressConfirmedAt: DAVID_70_AT });
    expect(deleted.items.find(item => item.id === oldRow.id)).toMatchObject({
      percentComplete: 40, progressConfirmedAt: DELETED_AT, progressJudgment: { judgedAt: DAVID_40_AT, givenBackAt: DELETED_AT },
    });
  });

  it('Set Active on A shows David\'s 70%, and Set Active on B again keeps 70%', () => {
    const deleted = deleteLookahead(at70);
    const onA = setActive(deleted, masterA, '2026-09-29T09:00:00.000Z');
    expect(pourOf(shown(onA))).toMatchObject({ id: oldRow.id, percentComplete: 70 });
    const onB = setActive(onA, masterB, '2026-09-29T10:00:00.000Z');
    expect(pourOf(shown(onB))).toMatchObject({ id: movedRow.id, percentComplete: 70 });
  });
});
