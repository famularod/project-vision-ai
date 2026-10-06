/*
 * Review pass 5, reports (6 Oct 2026), R-A (Low; older, the same on Build 229; seed "plain 104" with Set Active).
 *
 * After Set Active to an older master, an old lookahead can still hold the newer master's row of a task on show.
 * Deleting that lookahead's file hides that row and shows the older master's: the delete carried his percent and
 * nothing else, so the task lost its owner, approval and schedule impact, and the next report said they had changed.
 * The row shown changes at the delete, not at Set Active; the delete is one more door into the same rule.
 *
 * The steps are the reports reviewer's (notes/p4-reports/pass5/p5-setactive-then-delete.test.ts).
 */
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot, reportSnapshotToSave, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { planDAVEWebScheduleDocumentDelete } from '../../services/DAVEWebOperations';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { normalizeProjectControls, reviseProjectControls } from '../../services/VitruviusProjectControls';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const schedule = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id, projectControls: normalizeProjectControls(undefined),
  }));
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, overlay: lookahead,
  });
  return { items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]) as ScheduleItem[], documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') };
}
function patch(state: State, id: string, change: Partial<ScheduleItem>, at: string): State {
  return { ...state, items: state.items.map(item => (item.id === id ? {
    ...item, ...change,
    ...(typeof change.percentComplete === 'number' ? { status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David' } : {}),
    updatedAt: at,
  } as ScheduleItem : item)) };
}
function report(state: State, known: DAVEReportSnapshot | null, now: string) {
  const truth = buildDAVEProjectTruth({ projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state), projectAreas: [], referenceDocuments: state.documents, now,
    knownScheduleItems: state.items, knownScheduleDocuments: state.documents, reportLookaheadReplacement: true });
  const fingerprint = buildDAVEReportSourceFingerprint([truth]);
  const briefing = buildDAVEReportBriefing({ truths: [truth], selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(known, fingerprint), scheduleItems: shown(state) });
  const snapshot = buildDAVEReportSnapshot({ truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: now, reportFormat: 'project_manager' });
  return { lines: briefing.reportingPeriod.changes.map(change => change.summary), sent: markReportSnapshotDelivered((reportSnapshotToSave(snapshot, known) ?? known) as DAVEReportSnapshot, now, 'phone') };
}
function setActive(state: State, id: string, at: string): State {
  const documents = scheduleDocumentsAfterActivation(state.documents.find(document => document.id === id)!, state.documents, 'project', at);
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter: documents, now: at }).map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents };
}
/** The phone's "Delete PDF + Items" (App.tsx): the tasks only that file holds go, the helper's tasks are saved. */
function phoneDeleteWithItems(state: State, id: string, at: string): State {
  const document = state.documents.find(saved => saved.id === id)!;
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at }).map(item => [item.id, item]));
  return { items: kept.map(item => saved.get(item.id) || item), documents };
}
/** The phone's "Delete PDF Only" (App.tsx): of each task the helper returns, the two dates only. */
function phoneDeletePdfOnly(state: State, id: string, at: string): State {
  const document = state.documents.find(saved => saved.id === id)!;
  let next = state;
  scheduleItemsAfterScheduleDeleted({ items: state.items, removed: [], document, documents: state.documents, fileOnly: true, updatedAt: at })
    .forEach(task => { next = patch(next, task.id, { startDate: task.startDate, finishDate: task.finishDate }, at); });
  return { items: next.items, documents: next.documents.filter(other => other.id !== id) };
}
/** The web's "Delete Document + Tasks" / "Delete Document Only": its plan's tasks saved whole, then the file gone. */
function webDelete(state: State, id: string, at: string, keepTasks: boolean): State {
  const document = state.documents.find(saved => saved.id === id)!;
  const linked = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const web = (item: ScheduleItem) => ({ ...item, cloudUpdatedAt: item.updatedAt ?? null });
  const revisions = planDAVEWebScheduleDocumentDelete({
    snapshot: { scheduleItems: shown(state).map(web), knownScheduleItems: state.items.map(web), referenceDocuments: state.documents } as never,
    document: { ...document, linkedScheduleItems: linked } as never, updatedAt: at, keepTasks,
  });
  const saved = new Map(revisions.map(revision => [revision.item.id, revision.item as ScheduleItem]));
  const removedIds = new Set(keepTasks ? [] : linked.map(item => item.id));
  return { items: state.items.filter(item => !removedIds.has(item.id)).map(item => saved.get(item.id) || item), documents: state.documents.filter(other => other.id !== id) };
}
/** Sitework in the list: its row, percent, owner, approval, schedule impact. */
const sitework = (state: State) => shown(state).filter(item => item.taskName === 'Sitework').map(item => {
  const controls = normalizeProjectControls(item.projectControls);
  return [item.id, item.percentComplete, item.owner || '', controls.approvalStatus, controls.estimatedScheduleImpactDays ?? null];
});
const about = (lines: readonly string[]) => lines.filter(line => /owner|approval|schedule impact|complete/.test(line));

const OTHERS = Array.from({ length: 12 }, (_, index) => `Other task ${index + 1},Alpha,Lot,11/${String(index + 1).padStart(2, '0')}/2026,11/${String(index + 3).padStart(2, '0')}/2026,`);
/**
 * Master 1 lists Sitework; master 2 re-dates it, and on its row he sets Dana, Pending, 2 days and 40%. Lookahead 1
 * lists Sitework. The report is sent. Lookahead 2 replaces lookahead 1. Set Active on master 1: the list still shows
 * master 2's row, which the old lookahead holds on show.
 */
function afterSetActiveOnTheOlderMaster() {
  let state: State = { items: [], documents: [] };
  state = approve(state, schedule('MASTER 1', '2026-09-07T12:00:00.000Z'), [...OTHERS, 'Sitework,Alpha,Lot,09/25/2026,10/05/2026,']);
  state = approve(state, schedule('MASTER 2', '2026-09-08T12:00:00.000Z'), [...OTHERS, 'Sitework,Alpha,Lot,09/25/2026,10/06/2026,']);
  const row = shown(state).find(item => item.taskName === 'Sitework')!;
  expect(row.id).toBe('MASTER 2-13');
  state = patch(state, row.id, { owner: 'Dana', percentComplete: 40 }, '2026-09-08T14:00:00.000Z');
  state = patch(state, row.id, { projectControls: reviseProjectControls({ current: row.projectControls, patch: { approvalStatus: 'Pending', estimatedScheduleImpactDays: 2 }, actor: 'David', now: '2026-09-08T14:05:00.000Z' }) }, '2026-09-08T14:05:00.000Z');
  state = approve(state, schedule('LOOKAHEAD 1', '2026-09-09T12:00:00.000Z', 'lookahead'), ['Sitework,Alpha,Lot,09/21/2026,10/04/2026,']);
  const first = report(state, null, '2026-09-09T15:00:00.000Z');
  state = approve(state, schedule('LOOKAHEAD 2', '2026-09-10T12:00:00.000Z', 'lookahead'), ['Other task 1,Alpha,Lot,11/02/2026,11/04/2026,']);
  state = setActive(state, 'MASTER 1', '2026-09-11T08:00:00.000Z');
  expect(sitework(state)).toEqual([['MASTER 2-13', 40, 'Dana', 'Pending', 2]]);
  return { state, sent: first.sent };
}
const AS_HE_SET_IT = [['MASTER 1-13', 40, 'Dana', 'Pending', 2]];
const AT = '2026-09-11T10:00:00.000Z';

describe('Review P5 R-A: a schedule\'s delete that changes the row shown for a task shows what he last set on it', () => {
  it.each([
    ['the phone\'s Delete PDF + Items', (state: State) => phoneDeleteWithItems(state, 'LOOKAHEAD 1', AT)],
    ['the web\'s Delete Document + Tasks', (state: State) => webDelete(state, 'LOOKAHEAD 1', AT, false)],
    ['the web\'s Delete Document Only', (state: State) => webDelete(state, 'LOOKAHEAD 1', AT, true)],
  ] as const)('%s on the old lookahead: master 1\'s row is shown with his owner, approval and schedule impact, and the report says nothing about them', (_door, deleteIt) => {
    const { state, sent } = afterSetActiveOnTheOlderMaster();
    const after = deleteIt(state);
    // (It was: [['MASTER 1-13', 40, '', 'Not Required', null]], and the report said "Sitework owner changed from Dana
    // to unassigned.", "Sitework approval changed from Pending to Not Required." and "Sitework schedule impact changed
    // from 2 days to not set.")
    expect(sitework(after)).toEqual(AS_HE_SET_IT);
    expect(about(report(after, sent, '2026-09-12T15:00:00.000Z').lines)).toEqual([]);
  });

  it('what he changed on the older row itself since stands over the hidden row\'s where it is the later (as at Set Active)', () => {
    const { state } = afterSetActiveOnTheOlderMaster();
    // An owner typed on master 1's row by a device that still showed it, after he set Dana on master 2's.
    const typedOnTheOlderRow = patch(state, 'MASTER 1-13', { owner: 'Lee' }, '2026-09-11T09:00:00.000Z');
    expect(sitework(phoneDeleteWithItems(typedOnTheOlderRow, 'LOOKAHEAD 1', AT))).toEqual([['MASTER 1-13', 40, 'Lee', 'Pending', 2]]);
  });

  it('a delete that changes no row shown saves nothing more than before', () => {
    const { state } = afterSetActiveOnTheOlderMaster();
    const document = state.documents.find(saved => saved.id === 'LOOKAHEAD 2')!;
    const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
    const saved = scheduleItemsAfterScheduleDeleted({ items: state.items.filter(item => !removed.includes(item)), removed, document, documents: state.documents.filter(other => other.id !== document.id), updatedAt: AT });
    expect(saved.map(item => item.taskName)).not.toContain('Sitework');
  });

  it('NOT the phone\'s Delete PDF Only: the app takes only the two dates of each task the helper returns, so the helper returns the same tasks as before for it', () => {
    const { state } = afterSetActiveOnTheOlderMaster();
    const document = state.documents.find(saved => saved.id === 'LOOKAHEAD 1')!;
    const asThePhoneAsks = scheduleItemsAfterScheduleDeleted({ items: state.items, removed: [], document, documents: state.documents, fileOnly: true, updatedAt: AT });
    expect(asThePhoneAsks.map(item => item.id)).not.toContain('MASTER 1-13');
    // Still wrong there (recorded): the list goes to master 1's row without what he set, his percent included.
    expect(sitework(phoneDeletePdfOnly(state, 'LOOKAHEAD 1', AT))).toEqual([['MASTER 1-13', 0, '', 'Not Required', null]]);
    // The same helper, asked for them (as the web asks), returns that row with what he set.
    const asTheWebAsks = scheduleItemsAfterScheduleDeleted({ items: state.items, removed: [], document, documents: state.documents, fileOnly: true, withWhatHeSet: true, updatedAt: AT });
    expect(asTheWebAsks.find(item => item.id === 'MASTER 1-13')).toMatchObject({ owner: 'Dana', percentComplete: 40 });
  });
});
