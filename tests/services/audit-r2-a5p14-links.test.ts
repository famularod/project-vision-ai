/**
 * Audit round 2, A5 pass 14 (1 Oct 2026): which task a field report links to.
 *
 * L1 (caused by 97190fb): master F has Pour slab; master M moves it, so M's
 * row lists F's. A "Pour slab is complete" report is filed on M's row. David
 * deletes M with its items while M is current: F is retired, nothing is
 * shown, and the delete writes M's row id onto F's hidden row (fd00285).
 * He approves corrected master N straight away; N's rows come in fresh (no
 * task was shown to pair with), so none lists anything. The report stays
 * current evidence (F's hidden row lists M's), but 97190fb made a deleted row
 * a saved row lists answer only through that chain, so it linked to no task:
 * reconciliation said "0 activities matched field evidence" and "Scheduled
 * work lacks recent field evidence" for N's Pour slab. Before 97190fb it
 * linked to N's Pour slab by its unique name.
 *
 * Now the twin guard looks at the schedule of each saved row that lists the
 * deleted id (its own schedule is gone): a name unique there falls back as
 * any other; a name shared there (97190fb's phase 1 / phase 2) still links
 * to nothing.
 *
 * Real CSV normalizer, the phone's merge, activation and delete helpers, the
 * shown-schedule pick and reconciliation. Synthetic data.
 */
import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { buildPIEScheduleReconciliation, scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleTaskLinks } from '../../services/ScheduleTaskRevisions';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

type State = { items: ScheduleItem[]; documents: ReferenceDocument[]; tombstones?: DAVESyncTombstone[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const named = (items: readonly ScheduleItem[], name: string) => items.find(item => item.taskName === name)!;
const row = (state: State, id: string) => state.items.find(item => item.id === id);

/** Approving a master merges its rows (paired with the rows shown) and makes it current (App.tsx). */
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[]): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''), approvedAt: source.importedAt,
  });
  return {
    items: [...merged.additions, ...merged.next],
    documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
    tombstones: state.tombstones,
  };
}

/** "Delete PDF + Items" as the phone does it (App.tsx), through the shared delete helper. */
function deleteWithItems(state: State, document: ReferenceDocument, at: string): State {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at })
    .map(item => [item.id, item]));
  const tombstones = [...removedIds].map(recordId => ({ entityType: 'schedule_item', recordId, deletedAt: at }) as DAVESyncTombstone);
  return { items: kept.map(item => saved.get(item.id) || item), documents, tombstones: [...(state.tombstones || []), ...tombstones] };
}

describe('A5 p14 L1: a report on a deleted newer master\'s row still links by a name unique in the schedule that lists it', () => {
  const schedule = (id: string, importedAt: string): ReferenceDocument => ({
    id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
    projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
  }) as ReferenceDocument;
  const F = schedule('MASTER F', '2026-08-31T12:00:00.000Z');
  const M = schedule('MASTER M', '2026-09-26T08:00:00.000Z');
  const N = schedule('MASTER N', '2026-09-30T14:00:00.000Z');
  const DELETED_M_AT = '2026-09-30T12:00:00.000Z';
  const NOW = new Date('2026-10-01T15:00:00.000Z');
  function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
    return (normalizeScheduleImport({
      contents: ['Task,Project,Area,Start,Finish', ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv',
      projects: ['Alpha'], now: new Date(source.importedAt),
    }).items as ScheduleItem[]).map((item, index) => ({
      ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
    }));
  }

  const FRAMING = 'Framing,Alpha,Lot,10/10/2026,10/20/2026';
  const onF = approve({ items: [], documents: [] }, F, rows(F, ['Pour slab,Alpha,Lot,10/01/2026,10/05/2026', FRAMING]));
  const fPour = named(onF.items, 'Pour slab');
  const onM = approve(onF, M, rows(M, ['Pour slab,Alpha,Lot,10/02/2026,10/06/2026', FRAMING]));
  const mPour = named(shown(onM), 'Pour slab');
  const deleted = deleteWithItems(onM, M, DELETED_M_AT);
  const onN = approve(deleted, N, rows(N, ['Pour slab,Alpha,Lot,10/03/2026,10/07/2026', FRAMING]));
  const nPour = named(shown(onN), 'Pour slab');

  const report: ProjectUpdate = {
    id: 'u-pour-complete', projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-29T16:00:00.000Z', photos: [],
    recipients: { contactIds: [] }, notes: 'Pour slab is complete.', scheduleItemId: mPour.id, scheduleTaskName: 'Pour slab',
    selectedAreaName: 'Lot',
  } as ProjectUpdate;

  it('the scenario: M\'s row lists F\'s; after the delete nothing is shown and F\'s hidden row lists M\'s; N\'s Pour slab lists nothing', () => {
    expect(mPour.revisedFromTaskIds).toEqual([fPour.id]);
    expect(onN.tombstones!.map(entry => entry.recordId)).toEqual([mPour.id]);
    expect(shown(deleted)).toEqual([]);
    expect(row(onN, fPour.id)!.revisedFromTaskIds).toEqual([mPour.id]);
    expect(nPour.id).not.toBe(fPour.id);
    expect(nPour.revisedFromTaskIds).toBeUndefined();
    expect(shown(onN).filter(item => item.taskName === 'Pour slab')).toEqual([nPour]);
  });

  it('the report stays current evidence and links to N\'s Pour slab by its unique name (it linked to no task)', () => {
    const split = partitionProjectUpdatesByDeletedTask([report], onN.tombstones!, update => update, { scheduleItems: onN.items });
    expect(split.active.map(update => update.id)).toEqual([report.id]);
    expect(scheduleTaskLinks(shown(onN), onN.items)(report)).toEqual({ item: nPour, basis: 'stored_task_name' });
  });

  it('reconciliation matches the report to N\'s Pour slab and no longer says it lacks recent field evidence', () => {
    const reconciliation = buildPIEScheduleReconciliation({
      scheduleItems: shown(onN), knownScheduleItems: onN.items, updates: [report], projectName: 'Alpha', now: NOW,
    });
    expect(reconciliation.matches.filter(match => match.updateId === report.id).map(match => match.scheduleItemId)).toEqual([nPour.id]);
    expect(reconciliation.summary).toContain('1 activities matched field evidence');
    expect(reconciliation.warnings.filter(warning => warning.scheduleItemId === nPour.id).map(warning => warning.title))
      .not.toContain('Scheduled work lacks recent field evidence');
  });

  it('97190fb still holds: when the schedule that lists the deleted row had two tasks of that name, the report links to none', () => {
    const twinsOnF = approve({ items: [], documents: [] }, F, rows(F, [
      'Pour slab,Alpha,Lot,10/01/2026,10/05/2026', 'Pour slab,Alpha,Lot,11/01/2026,11/05/2026', FRAMING,
    ]));
    const phase1 = twinsOnF.items.find(item => item.startDate === '10/01/2026')!;
    // M moved phase 1; the report on M's row; the delete wrote M's row id onto F's hidden phase-1 row.
    const hiddenPhase1 = { ...phase1, revisedFromTaskIds: [mPour.id] } as ScheduleItem;
    const known = [...twinsOnF.items.map(item => item.id === phase1.id ? hiddenPhase1 : item), nPour];
    expect(scheduleTaskLinks([nPour], known)(report)).toBeNull();
    // Control: the same report on a row nothing lists links by its unique name.
    expect(scheduleTaskLinks([nPour], known)({ ...report, scheduleItemId: 'row-nobody-lists' })).toEqual({ item: nPour, basis: 'stored_task_name' });
  });
});
