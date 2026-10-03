/**
 * Audit round 2, A10 pass 9 L1 (30 Sep 2026): after Make Current back to the
 * old master, a field report on the newer master's row of a moved task
 * attached to no task.
 *
 * Lot has two "Pour slab" tasks on master A: phase 1 at 40% and phase 2 at
 * 0%. Master B moves phase 1: B's new row lists A's phase 1 row among its
 * earlier ids (revisedFromTaskIds). A field report on B's row says "Pour slab
 * is complete." David makes A current again, so A's phase 1 is shown and B's
 * row is hidden. The report linked to nothing in reconciliation, correlation,
 * Project Truth or the inbox, on the phone and the web, and Home said "Pour
 * slab: scheduled work lacks recent field evidence". Linking only went
 * forward (a shown row that lists the update's id); the twin guard (A10 pass
 * 6 L2) rightly refused to guess between the two Pour slabs, and nothing
 * followed the hidden row's own record of the row it replaced.
 *
 * Now, when no shown row answers to the update's id, the update's saved row
 * is looked up among every saved task: if a row it lists as earlier is shown,
 * in the same app project, the update links to the newest of those (basis
 * earlier_task_id). These tests run the real import, merge, Make Current,
 * scope and summary builders, and the web's snapshot. Synthetic data.
 */
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEActionInbox } from '../../services/DAVEActionInbox';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import { buildDAVEEvidenceCorrelations } from '../../services/DAVEEvidenceCorrelation';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { buildPIEScheduleReconciliation, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { buildDailyReportAuthorityScope } from '../../services/ReportAuthorityScope';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
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
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: `file:///docs/${id}.csv`, category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: PROJECT, projectNames: [PROJECT], importBatchId: `batch-${id}`, cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt,
}) as ReferenceDocument;
const A = schedule('MASTER A', '2026-08-31T12:00:00.000Z');
const B = schedule('MASTER B', '2026-09-26T08:00:00.000Z');
const HEADER = 'Task,Project,Area,Start,Finish,% Complete';
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [HEADER, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: [PROJECT],
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
const pours = (items: readonly ScheduleItem[]) => items.filter(item => item.taskName === 'Pour slab');

// Phase 1 is under way now (40%), phase 2 not started; master B moves phase 1 by a day.
const PHASE_2 = `Pour slab,${PROJECT},Lot,10/20/2026,10/22/2026,0%`;
const onA = approve({ items: [], documents: [] }, A, rows(A, [`Pour slab,${PROJECT},Lot,09/28/2026,10/02/2026,40%`, PHASE_2]));
const [phase1, phase2] = pours(onA.items).sort((left, right) => left.startDate.localeCompare(right.startDate));
const onB = approve(onA, B, rows(B, [`Pour slab,${PROJECT},Lot,09/29/2026,10/03/2026,40%`, PHASE_2]));
const movedRow = pours(onB.items).find(item => item.id !== phase1.id && item.id !== phase2.id)!;
/** Make Current back to master A. */
const backOnA: State = { ...onB, documents: scheduleDocumentsAfterActivation(onB.documents.find(document => document.id === A.id)!, onB.documents, 'project') };

// Filed on B's row while B was current, with an open action on its photo.
const report: ProjectUpdate = {
  id: 'u-pour-complete', projectName: PROJECT, scheduleProjectName: PROJECT, date: '2026-09-29T15:00:00.000Z',
  photos: [{
    id: 'p-1', uri: 'file:///p-1.jpg', caption: 'Edge', category: 'Open Issue', actionRequired: 'Patch the east edge', actionOwner: 'Acme Concrete',
    actionDueDate: '', actionStatus: 'Open', selectedAreaName: 'Lot',
  }],
  recipients: { contactIds: [] }, notes: 'Pour slab is complete.', scheduleItemId: movedRow.id, scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
} as unknown as ProjectUpdate;

const LACKS = /lacks recent field evidence|no task-specific field update confirms current status/i;

/**
 * What each summary links the report to, through the daily report's scope.
 * The phone passes every saved task to the scope; the web's scope does not
 * (DAVEWebOperations) and its summaries take the snapshot's saved tasks.
 */
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

describe('A10 p9 L1: a report on the newer master\'s row, after Make Current back to the old master', () => {
  it('the scenario: B\'s row lists A\'s phase 1; with A current, A\'s two Pour slabs are shown and B\'s row is hidden', () => {
    expect(movedRow.revisedFromTaskIds).toEqual([phase1.id]);
    expect(pours(shown(onB)).map(item => item.id).sort()).toEqual([movedRow.id, phase2.id].sort());
    expect(pours(shown(backOnA)).map(item => item.id).sort()).toEqual([phase1.id, phase2.id].sort());
  });

  it('with B current, the report links to B\'s row', () => {
    expect(scheduleTaskLinks(shown(onB), onB.items)(report)).toEqual({ item: movedRow, basis: 'task_id' });
    const said = linked(shown(onB), onB.items, [report], onB.documents);
    expect(said).toMatchObject({
      inScope: [report.id], reconciliation: [movedRow.id], correlation: [movedRow.id], truth: [movedRow.id], inboxAction: [movedRow.id],
    });
    expect(said.lacksEvidence).not.toContain(movedRow.id);
    expect(said.inboxLacks).not.toContain(movedRow.id);
  });

  it('with A current, the report links to A\'s phase 1 in reconciliation, correlation, Project Truth and the inbox', () => {
    expect(scheduleTaskLinks(shown(backOnA), backOnA.items)(report)).toEqual({ item: phase1, basis: 'earlier_task_id' });
    const said = linked(shown(backOnA), backOnA.items, [report], backOnA.documents);
    expect(said).toMatchObject({
      inScope: [report.id], reconciliation: [phase1.id], correlation: [phase1.id], truth: [phase1.id], inboxAction: [phase1.id],
    });
    // What Home showed: "Pour slab: scheduled work lacks recent field evidence".
    expect(said.lacksEvidence).not.toContain(phase1.id);
    expect(said.inboxLacks).not.toContain(phase1.id);
  });

  it('the web: the snapshot keeps the report (partition) and its summaries link it to A\'s phase 1', async () => {
    jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue({
      projects: [{ id: 'p-lot', name: PROJECT, archived: false }],
      scheduleItems: backOnA.items.map(item => ({ id: item.id, item_data: item })),
      referenceDocuments: backOnA.documents.map(document => ({ id: document.id, document_data: document })),
      projectUpdates: [{ id: report.id, project_name: PROJECT, update_data: report }],
      syncTombstones: [],
    } as never);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    expect(pours(snapshot.scheduleItems).map(item => item.id).sort()).toEqual([phase1.id, phase2.id].sort());
    expect(snapshot.projectUpdates.map(update => update.id)).toEqual([report.id]);
    const updates = snapshot.projectUpdates.map(update => update.updateData);
    const split = partitionProjectUpdatesByDeletedTask(updates, [], update => update, { scheduleItems: snapshot.knownScheduleItems! });
    expect(split.active.map(update => update.id)).toEqual([report.id]);
    const said = linked(snapshot.scheduleItems, snapshot.knownScheduleItems!, updates, snapshot.referenceDocuments, false);
    expect(said).toMatchObject({
      inScope: [report.id], reconciliation: [phase1.id], correlation: [phase1.id], truth: [phase1.id], inboxAction: [phase1.id],
    });
    expect(said.lacksEvidence).not.toContain(phase1.id);
    expect(said.inboxLacks).not.toContain(phase1.id);
  });

  it('the twin guard still refuses a guess where no saved row records the link', () => {
    // Rows saved before the earlier ids were kept: B's row names no earlier row, and B's schedule had two Pour slabs.
    const legacy = backOnA.items.map(({ revisedFromTaskIds: _earlier, ...item }) => item as ScheduleItem);
    const legacyShown = shown({ ...backOnA, items: legacy });
    expect(scheduleTaskLinks(legacyShown, legacy)(report)).toBeNull();
    const said = linked(legacyShown, legacy, [report], backOnA.documents);
    expect(said).toMatchObject({ reconciliation: [], correlation: [], truth: [] });
  });

  it('only a row of the same app project: a hidden row of another project that lists phase 1 links to no Lot task', () => {
    const beta = { ...movedRow, id: 'beta-moved', projectName: 'Beta', scheduleProjectName: 'Beta' } as ScheduleItem;
    const betaReport = { ...report, id: 'u-beta', projectName: 'Beta', scheduleProjectName: 'Beta', scheduleItemId: beta.id } as ProjectUpdate;
    expect(scheduleTaskLinks(shown(backOnA), [...backOnA.items, beta])(betaReport)).toBeNull();
  });

  it('two earlier rows shown: the newest one the saved row lists', () => {
    const older = { ...phase1, id: 'older-row' } as ScheduleItem;
    const saved = { ...movedRow, revisedFromTaskIds: [older.id, phase1.id] } as ScheduleItem;
    expect(scheduleTaskLinks([older, phase1, phase2], [older, phase1, phase2, saved])(report)).toEqual({ item: phase1, basis: 'earlier_task_id' });
  });
});
