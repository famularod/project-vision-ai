/**
 * Audit round 2, A10 pass 10 L1 (1 Oct 2026): a field report on an abandoned
 * newer master's row linked to no task once the revision chain branched.
 *
 * Lot has two "Pour slab" tasks on master A (phase 1 and phase 2: same name,
 * project and area). Master B moves phase 1, and a field report is filed on
 * B's row. David makes A current again, then imports a corrected master D,
 * which moves phase 1 again. The import pairs only with the rows shown, so
 * D's row records A's phase 1, not B's row. The report then linked to no
 * task in reconciliation, correlation, Project Truth or the inbox, on the
 * phone and the web, and Home said "Pour slab: scheduled work lacks recent
 * field evidence" on D's phase 1: no shown row lists B's row (the forward
 * link), A's phase 1 is hidden (the backward link, A10 pass 9 L1), and the
 * twin guard (A10 pass 6 L2) rightly refuses the name.
 *
 * The rarer form: masters A, B and C (C current, its row listing A's phase 1
 * and B's row). Delete PDF + Items on B (C's row answers to B's, so the
 * delete hands nothing over), then Make Current back to A: B's row is gone,
 * so its own record of the row it replaced went with it.
 *
 * Now, after the backward step, the report also links to the one task shown,
 * in its app project, that answers to a row the saved row replaced (D's
 * phase 1 lists A's); and for a deleted row, through the saved rows that list
 * it: those rows and the rows they replaced (C's row lists A's phase 1, which
 * is shown). Only when exactly one task shown answers. These tests run the
 * real import, merge, Make Current, delete, scope and summary builders, and
 * the web's snapshot. Synthetic data.
 */
import type { DAVESyncTombstone, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEActionInbox } from '../../services/DAVEActionInbox';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import { buildDAVEEvidenceCorrelations } from '../../services/DAVEEvidenceCorrelation';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { buildPIEScheduleReconciliation, scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { buildDailyReportAuthorityScope } from '../../services/ReportAuthorityScope';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleTaskLinks } from '../../services/ScheduleTaskRevisions';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() },
}));

const PROJECT = 'Lot Project';
const NOW = '2026-09-30T12:00:00.000Z';
const DELETED_AT = '2026-09-29T20:00:00.000Z';
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: `file:///docs/${id}.csv`, category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: PROJECT, projectNames: [PROJECT], importBatchId: `batch-${id}`, cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt,
}) as ReferenceDocument;
const A = schedule('MASTER A', '2026-08-31T12:00:00.000Z');
const B = schedule('MASTER B', '2026-09-26T08:00:00.000Z');
const C = schedule('MASTER C', '2026-09-27T08:00:00.000Z');
const D = schedule('MASTER D', '2026-09-29T08:00:00.000Z');
const HEADER = 'Task,Project,Area,Start,Finish,% Complete';
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [HEADER, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: [PROJECT],
    now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((row, index) => ({
    ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
type State = { items: ScheduleItem[]; documents: ReferenceDocument[]; tombstones?: DAVESyncTombstone[] };
/** Approving a master merges its rows (paired with the rows shown) and makes it current (App.tsx). */
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[]): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''), approvedAt: source.importedAt,
  });
  return { ...state, items: [...merged.additions, ...merged.next], documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') };
}
const makeCurrent = (state: State, document: ReferenceDocument): State => ({
  ...state, documents: scheduleDocumentsAfterActivation(state.documents.find(saved => saved.id === document.id)!, state.documents, 'project'),
});
/** "Delete PDF + Items" as the phone does it (App.tsx), through the shared delete helper. */
function deleteWithItems(state: State, document: ReferenceDocument): State {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: DELETED_AT })
    .map(item => [item.id, item]));
  const tombstones = [...removedIds].map(recordId => ({ entityType: 'schedule_item', recordId, deletedAt: DELETED_AT }) as DAVESyncTombstone);
  return { items: kept.map(item => saved.get(item.id) || item), documents, tombstones: [...(state.tombstones || []), ...tombstones] };
}
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const pours = (items: readonly ScheduleItem[]) => items.filter(item => item.taskName === 'Pour slab');
const newPour = (state: State, before: State) => pours(shown(state)).find(item => !before.items.some(saved => saved.id === item.id))!;

// Phase 1 under way (40%), phase 2 not started; each later master moves phase 1 by a day.
const PHASE_2 = `Pour slab,${PROJECT},Lot,10/20/2026,10/22/2026,0%`;
const phase1On = (day: number) => `Pour slab,${PROJECT},Lot,09/${day}/2026,10/0${day - 26}/2026,40%`;
const onA = approve({ items: [], documents: [] }, A, rows(A, [phase1On(28), PHASE_2]));
const [phase1, phase2] = pours(onA.items).sort((left, right) => left.startDate.localeCompare(right.startDate));
const onB = approve(onA, B, rows(B, [phase1On(29), PHASE_2]));
const bRow = newPour(onB, onA);

// Filed on B's row while B was current, with an open action on its photo.
const report: ProjectUpdate = {
  id: 'u-pour-complete', projectName: PROJECT, scheduleProjectName: PROJECT, date: '2026-09-26T15:00:00.000Z',
  photos: [{
    id: 'p-1', uri: 'file:///p-1.jpg', caption: 'Edge', category: 'Open Issue', actionRequired: 'Patch the east edge', actionOwner: 'Acme Concrete',
    actionDueDate: '', actionStatus: 'Open', selectedAreaName: 'Lot',
  }],
  recipients: { contactIds: [] }, notes: 'Pour slab is complete.', scheduleItemId: bRow.id, scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
} as unknown as ProjectUpdate;

// The main case: Make Current back to A, then corrected master D moves phase 1 again (from A's row, the one shown).
const backOnA = makeCurrent(onB, A);
const onD = approve(backOnA, D, rows(D, [phase1On(30), PHASE_2]));
const dRow = newPour(onD, backOnA);

// The rarer form: C moves phase 1 again from B's row (C current); delete B with its items; Make Current back to A.
const onC = approve(onB, C, rows(C, [phase1On(30), PHASE_2]));
const cRow = newPour(onC, onB);
const rarer = makeCurrent(deleteWithItems(onC, B), A);

const LACKS = /lacks recent field evidence|no task-specific field update confirms current status/i;

/** What each summary links the report to, through the daily report's scope (the web's scope takes no saved tasks). */
function linked(items: readonly ScheduleItem[], known: readonly ScheduleItem[], updates: readonly ProjectUpdate[], documents: readonly ReferenceDocument[], scopeKnown = true) {
  const scope = buildDailyReportAuthorityScope({
    selectedProjectName: PROJECT, selectedProjectNames: [PROJECT], projectRecords: [{ id: 'p-lot', name: PROJECT }], updates, scheduleItems: items,
    knownScheduleItems: scopeKnown ? known : undefined, referenceDocuments: documents,
  });
  const reconciliation = buildPIEScheduleReconciliation({
    scheduleItems: scope.scheduleItems, knownScheduleItems: known, updates: scope.updates, projectName: PROJECT, now: new Date(NOW),
  });
  const correlation = buildDAVEEvidenceCorrelations({ scheduleItems: scope.scheduleItems, knownScheduleItems: known, updates: scope.updates, now: NOW });
  const truth = buildDAVEProjectTruth({
    projectId: 'p-lot', projectName: PROJECT, updates: scope.updates, scheduleItems: scope.scheduleItems, knownScheduleItems: known,
    referenceDocuments: scope.referenceDocuments, now: NOW,
  });
  const inbox = buildDAVEActionInbox({
    scheduleItems: scope.scheduleItems, knownScheduleItems: known, updates: scope.updates, reconciliationWarnings: reconciliation.warnings, now: new Date(NOW),
  });
  return {
    inScope: scope.updates.map(update => update.id),
    reconciliation: reconciliation.matches.filter(match => match.updateId === report.id).map(match => match.scheduleItemId),
    lacksEvidence: reconciliation.warnings.filter(warning => warning.type === 'scheduled_work_without_recent_evidence').map(warning => warning.scheduleItemId),
    correlation: correlation.tasks
      .filter(task => task.evidence.some(claim => claim.kind === 'field_update' && claim.sourceRecordId === report.id)).map(task => task.taskId),
    truth: truth.entityLinks
      .filter(link => link.targetType === 'schedule-task' && link.sourceEvidenceId === `update:${report.id}`).map(link => link.targetId),
    inboxAction: inbox.items.filter(item => item.kind === 'field_action').map(item => item.scheduleItemId),
    inboxLacks: inbox.items.filter(item => LACKS.test(`${item.title}: ${item.summary}`)).map(item => item.scheduleItemId),
  };
}
function expectLinkedTo(said: ReturnType<typeof linked>, id: string) {
  expect(said).toMatchObject({ inScope: [report.id], reconciliation: [id], correlation: [id], truth: [id], inboxAction: [id] });
  // What Home showed: "Pour slab: scheduled work lacks recent field evidence".
  expect(said.lacksEvidence).not.toContain(id);
  expect(said.inboxLacks).not.toContain(id);
}
async function webSnapshot(state: State) {
  jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue({
    projects: [{ id: 'p-lot', name: PROJECT, archived: false }],
    scheduleItems: state.items.map(item => ({ id: item.id, item_data: item })),
    referenceDocuments: state.documents.map(document => ({ id: document.id, document_data: document })),
    projectUpdates: [{ id: report.id, project_name: PROJECT, update_data: report }],
    syncTombstones: (state.tombstones || []).map(entry => ({
      id: `t-${entry.recordId}`, entity_type: entry.entityType, record_id: entry.recordId, deleted_at: entry.deletedAt,
    })),
  } as never);
  return loadDAVEWebReadOnlySnapshot();
}

describe('A10 p10 L1: a report on an abandoned newer master\'s row, once the chain branched', () => {
  it('the scenario: B\'s row lists A\'s phase 1; D, imported with A current, records only A\'s phase 1', () => {
    expect(bRow.revisedFromTaskIds).toEqual([phase1.id]);
    expect(dRow.revisedFromTaskIds).toEqual([phase1.id]);
    expect(pours(shown(onD)).map(item => item.id).sort()).toEqual([dRow.id, phase2.id].sort());
  });

  it('the phone: the report links to D\'s phase 1 in reconciliation, correlation, Project Truth and the inbox', () => {
    expect(scheduleTaskLinks(shown(onD), onD.items)(report)).toEqual({ item: dRow, basis: 'earlier_task_id' });
    expectLinkedTo(linked(shown(onD), onD.items, [report], onD.documents), dRow.id);
  });

  it('the web: its snapshot\'s summaries link it to D\'s phase 1 too', async () => {
    const snapshot = await webSnapshot(onD);
    const updates = snapshot.projectUpdates.map(update => update.updateData);
    expect(updates.map(update => update.id)).toEqual([report.id]);
    expectLinkedTo(linked(snapshot.scheduleItems, snapshot.knownScheduleItems!, updates, snapshot.referenceDocuments, false), dRow.id);
  });

  it('the rarer form: C\'s row listed B\'s, B was deleted with its items, then A made current: the report links to A\'s phase 1', () => {
    expect(cRow.revisedFromTaskIds).toEqual([phase1.id, bRow.id]);
    expect(rarer.tombstones!.map(entry => entry.recordId)).toEqual([bRow.id]);
    expect(rarer.items.some(item => item.id === bRow.id)).toBe(false);
    // Still current evidence: C's hidden row answers to B's (A10 pass 6 M1).
    const split = partitionProjectUpdatesByDeletedTask([report], rarer.tombstones!, update => update, { scheduleItems: rarer.items });
    expect(split.active.map(update => update.id)).toEqual([report.id]);
    expect(scheduleTaskLinks(shown(rarer), rarer.items)(report)).toEqual({ item: phase1, basis: 'earlier_task_id' });
    expectLinkedTo(linked(shown(rarer), rarer.items, split.active, rarer.documents), phase1.id);
  });

  it('the rarer form on the web', async () => {
    const snapshot = await webSnapshot(rarer);
    const updates = snapshot.projectUpdates.map(update => update.updateData);
    expect(updates.map(update => update.id)).toEqual([report.id]);
    expectLinkedTo(linked(snapshot.scheduleItems, snapshot.knownScheduleItems!, updates, snapshot.referenceDocuments, false), phase1.id);
  });

  it('with the A8 pass 11 L1 delete hand-over: deleting B and A with their items, in either order, keeps the report on D\'s phase 1', () => {
    for (const order of [[B, A], [A, B]]) {
      const deleted = order.reduce(deleteWithItems, onD);
      expect(deleted.tombstones!.map(entry => entry.recordId).sort()).toEqual([bRow.id, phase1.id].sort());
      // D's phase 1 answers to B's row now; the twins leave no name to fall back on.
      expect(deleted.items.find(item => item.id === dRow.id)!.revisedFromTaskIds).toEqual(expect.arrayContaining([bRow.id, phase1.id]));
      const split = partitionProjectUpdatesByDeletedTask([report], deleted.tombstones!, update => update, { scheduleItems: deleted.items });
      expect(split.historical).toEqual([]);
      expect(scheduleTaskLinks(shown(deleted), deleted.items)(report)).toMatchObject({ item: { id: dRow.id }, basis: 'earlier_task_id' });
      expectLinkedTo(linked(shown(deleted), deleted.items, split.active, deleted.documents), dRow.id);
    }
  });

  it('only when exactly one task shown answers, in the report\'s app project', () => {
    // Two shown rows answer to A's phase 1: no guess (and the twin guard refuses the name).
    const other = { ...dRow, id: 'other-moved', startDate: '10/01/2026' } as ScheduleItem;
    expect(scheduleTaskLinks([dRow, other, phase2], [...onD.items, other])(report)).toBeNull();
    // A row of another app project that lists A's phase 1 is not the report's task.
    const beta = { ...dRow, projectName: 'Beta', scheduleProjectName: 'Beta' } as ScheduleItem;
    expect(scheduleTaskLinks([beta, phase2], [...onD.items.filter(item => item.id !== dRow.id), beta])(report)).toBeNull();
    // The deleted-row hop too: two rows the hidden C row answers to, both shown.
    const twin = { ...phase1, id: 'phase1-copy', revisedFromTaskIds: [phase1.id] } as ScheduleItem;
    expect(scheduleTaskLinks([phase1, twin, phase2], [...rarer.items, twin])(report)).toBeNull();
  });
});
