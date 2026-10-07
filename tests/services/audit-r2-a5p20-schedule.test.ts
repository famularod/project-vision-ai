/**
 * Audit round 2, A5 pass 20 (1 Oct 2026): two Low findings in the schedule
 * merge (ScheduleLookahead, ScheduleImportMerge), one in the report text
 * (DAVEReportIntelligence), and A7 pass 24 L-3 in Full Sync's merge
 * (DAVEScheduleRecovery).
 *
 * Owner answer Q22: a lookahead adds to the master, and file progress never
 * goes below what David entered. A newer master's dates replace older
 * lookahead dates; a lookahead newer than the master restates the task.
 *
 * Real CSV normalizer, the phone's merge, Set Active, Delete PDF + Items and
 * shown-task pick, the web's upload plan and Make Current carry, Full Sync's
 * merge, and the Reports screen's briefing. Synthetic data.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import type { ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, enhanceDAVEReportDraft } from '../../services/DAVEReportIntelligence';
import { reportBaselineSnapshot } from '../../services/DAVEReportSnapshot';
import { daveScheduleItemsNeedingCloudUpload, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { planDAVEWebScheduleImport, prepareDAVEWebDocumentUpload } from '../../services/DAVEWebOperations';
import { buildDAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import type { PIEReportDraft } from '../../services/PIEReporter';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation, scheduleProgressCarriedToShownTasks,
} from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted, scheduleLookaheadDeleteNote } from '../../services/ScheduleLookahead';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const doc = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
/** A CSV's rows through the real normalizer, with the import's provenance. */
const rows = (source: ReferenceDocument, lines: string[]) => (normalizeScheduleImport({
  contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
  mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
}).items as ScheduleItem[]).map((row, index) => ({ ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const named = (state: State, name: string) => shown(state).filter(item => item.taskName === name);
/** Each shown copy of a task: start, finish and percent. */
const copies = (state: State, name: string) => named(state, name).map(item => [item.startDate, item.finishDate, item.percentComplete]);

/** Approving a schedule on the phone (App.tsx): a master is made current; a lookahead adds to it (Q22). */
function approve(state: State, source: ReferenceDocument, lines: string[], lookahead = false): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, ...(lookahead ? { overlay: true } : {}),
  });
  return {
    items: [...merged.additions, ...merged.next],
    documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
/** A master uploaded on the web: planned against the tasks the web shows, saved not current. */
function upload(state: State, fileName: string, lines: string[], now: string): { state: State; document: ReferenceDocument } {
  const prepared = prepareDAVEWebDocumentUpload({
    fileName, mimeType: 'text/csv', sizeBytes: 200, category: 'Schedules', projectName: 'Alpha', projects: ['Alpha'],
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), fingerprint: fileName.padEnd(64, 'x').slice(0, 64), now,
  });
  const webShown = shown(state).map(item => ({ ...item, cloudUpdatedAt: item.updatedAt ?? null }));
  const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: webShown as any }, importedScheduleItems: prepared.scheduleItems });
  const revised = new Map(plan.revisions.map(revision => [revision.item.id, revision.item as ScheduleItem]));
  return {
    document: prepared.document as ReferenceDocument,
    state: { items: [...plan.additions, ...state.items.map(item => revised.get(item.id) || item)], documents: [...state.documents, prepared.document as ReferenceDocument] },
  };
}
/** Make Current on the web: the schedule current, and the carry over the tasks shown before and after. */
function makeCurrent(state: State, document: ReferenceDocument, now: string): State {
  const target = state.documents.find(entry => entry.id === document.id)!;
  const current: State = { ...state, documents: scheduleDocumentsAfterActivation(target, state.documents, 'project') };
  const carried = new Map(scheduleProgressCarriedToShownTasks({
    before: shown(state), after: shown(current), documentsBefore: state.documents, documentsAfter: current.documents, now,
  }).map(item => [item.id, item]));
  return { ...current, items: current.items.map(item => carried.get(item.id) || item) };
}
/** Set Active on the phone, with its progress carry (App.tsx). */
function setActive(state: State, target: ReferenceDocument, now: string): State {
  const saved = state.documents.find(document => document.id === target.id)!;
  const documentsAfter = scheduleDocumentsAfterActivation(saved, state.documents, 'project');
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}
/** Delete PDF + Items on the phone (App.tsx), with the question it asks first. */
function deleteWithItems(state: State, target: ReferenceDocument, at: string): State & { question: string } {
  const document = state.documents.find(saved => saved.id === target.id)!;
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const question = scheduleLookaheadDeleteNote(state.items, document, removed, state.documents);
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at }).map(item => [item.id, item]));
  return { items: kept.map(item => saved.get(item.id) || item), documents, question };
}
/** David records progress by hand on the phone. */
const record = (state: State, id: string, pct: number, at: string): State => ({
  ...state,
  items: state.items.map(item => item.id === id ? {
    ...item, percentComplete: pct, status: pct >= 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager',
    progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at,
  } as ScheduleItem : item),
});

/**
 * P1 (Low, caused by fd69155): master F lists Framing 10/15-10/25; lookahead
 * L1 moves it to 10/18-10/28, then L2 to 10/20-10/30; master G lists Framing
 * on L2's dates, so L1's dates are marked replaced. David makes F current
 * again and deletes L2. Framing stayed on G's 10/20-10/30, though G is not
 * current and L1 is newer than F: it shows L1's 10/18-10/28 (at b41718d it
 * did). The same for G uploaded on the web and never made current.
 */
describe('P1: a lookahead delete falls back to dates only a master that is current replaced', () => {
  const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
  const L1 = doc('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');
  const L2 = doc('LOOKAHEAD L2', '2026-09-11T12:00:00.000Z', 'lookahead');
  const G = doc('MASTER G', '2026-09-14T12:00:00.000Z');
  const H = doc('MASTER H', '2026-09-21T12:00:00.000Z');
  const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,';
  const onL2 = () => {
    let state = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,', SURVEY]);
    state = approve(state, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
    return approve(state, L2, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,'], true);
  };
  const L1_DATES = ['10/18/2026', '10/28/2026', 0];
  const G_DATES = ['10/20/2026', '10/30/2026', 0];

  it('phone: G approved, Set Active back to F, Delete PDF + Items of L2: L1\'s dates', () => {
    let state = approve(onL2(), G, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY]);
    // G marks L1's dates replaced, and says which master did.
    expect(named(state, 'Framing')[0].lookaheadOverlay!.lookaheads.map(entry => entry.datesReplacedByMaster)).toEqual(['batch-MASTER G', 'batch-MASTER G']);
    state = setActive(state, F, '2026-09-15T10:00:00.000Z');
    expect(copies(state, 'Framing')).toEqual([G_DATES]);
    const deleted = deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z');
    expect(copies(deleted, 'Framing')).toEqual([L1_DATES]);
    // The question before the delete says so.
    expect(deleted.question).toBe(' Delete PDF + Items also puts back the earlier dates of 1 task this lookahead changed.');
  });

  it('web Make Current back to F, then the delete: L1\'s dates', () => {
    let state = approve(onL2(), G, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY]);
    state = makeCurrent(state, F, '2026-09-15T10:00:00.000Z');
    expect(copies(deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z'), 'Framing')).toEqual([L1_DATES]);
  });

  it('G uploaded on the web and never made current: L1\'s dates', () => {
    const up = upload(onL2(), 'alpha-master-g.csv', ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY], G.importedAt as string);
    expect(up.state.documents.find(saved => saved.id === up.document.id)!.isCurrent).not.toBe(true);
    expect(copies(deleteWithItems(up.state, L2, '2026-09-16T10:00:00.000Z'), 'Framing')).toEqual([L1_DATES]);
  });

  it('G uploaded on the web, made current, then F again: L1\'s dates', () => {
    const up = upload(onL2(), 'alpha-master-g.csv', ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY], G.importedAt as string);
    let state = makeCurrent(up.state, up.document, '2026-09-14T13:00:00.000Z');
    state = setActive(state, F, '2026-09-15T10:00:00.000Z');
    expect(copies(deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z'), 'Framing')).toEqual([L1_DATES]);
  });

  it('unchanged: G still current, the delete keeps G\'s dates (A6 pass 19 M1)', () => {
    const state = approve(onL2(), G, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY]);
    const deleted = deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z');
    expect(copies(deleted, 'Framing')).toEqual([G_DATES]);
    expect(deleted.question).toBe('');
  });

  it('unchanged: G made current again on the web after Set Active back to F, G\'s dates', () => {
    let state = approve(onL2(), G, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY]);
    state = setActive(state, F, '2026-09-15T10:00:00.000Z');
    state = makeCurrent(state, G, '2026-09-15T11:00:00.000Z');
    expect(copies(deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z'), 'Framing')).toEqual([G_DATES]);
  });

  it('unchanged: a newer master H repeating G\'s dates is current, the delete keeps them', () => {
    let state = approve(onL2(), G, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY]);
    state = approve(state, H, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY]);
    expect(copies(deleteWithItems(state, L2, '2026-09-22T10:00:00.000Z'), 'Framing')).toEqual([G_DATES]);
  });

  it('unchanged: G\'s own row, hidden while F is current, keeps G\'s dates for when G is current again', () => {
    // G moves Framing (a new row of G's, with the note: L1 replaced by G); L2 restates G's row on G's dates.
    // The sweep's seed 273 shape: the row the delete hides reads G's mark as before.
    let state = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,', SURVEY]);
    state = approve(state, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
    state = approve(state, G, ['Framing,Alpha,Lot,10/16/2026,10/26/2026,', SURVEY]);
    state = approve(state, L2, ['Framing,Alpha,Lot,10/16/2026,10/26/2026,'], true);
    state = setActive(state, F, '2026-09-15T10:00:00.000Z');
    expect(copies(state, 'Framing')).toEqual([['10/16/2026', '10/26/2026', 0]]); // L2's, newest
    state = deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z');
    expect(copies(state, 'Framing')).toEqual([L1_DATES]); // F's row, on L1's dates; G's row hidden
    expect(copies(setActive(state, G, '2026-09-17T10:00:00.000Z'), 'Framing')).toEqual([['10/16/2026', '10/26/2026', 0]]);
  });

  it('a mark saved before (true) still reads as replaced, whichever master is current', () => {
    let state = approve(onL2(), G, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY]);
    state = setActive(state, F, '2026-09-15T10:00:00.000Z');
    state = {
      ...state,
      items: state.items.map(item => item.lookaheadOverlay ? {
        ...item,
        // (Build 231, S3 item 3: a note saved then has no earlier master dates either; with them, F's dates, see audit-r2-a5p22.)
        lookaheadOverlay: { ...item.lookaheadOverlay, masterDatesBefore: undefined, lookaheads: item.lookaheadOverlay.lookaheads.map(entry => ({ ...entry, datesReplacedByMaster: true })) },
      } : item),
    };
    expect(copies(deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z'), 'Framing')).toEqual([G_DATES]);
  });
});

/**
 * P2 (Low, caused by b4f02c1 for hand tasks): David's hand-entered Pour slab
 * at 40%; master G uploaded on the web at 60%, not current; a lookahead with
 * no % column restates the task; David makes G current. The task stayed at
 * 40%, even after the lookahead was deleted. Approving G on the phone, then
 * the lookahead, gives 60%, as b41718d did.
 */
describe('P2: a master made current after a lookahead gives its higher percent', () => {
  const hand = buildDAVEWebScheduleItem({
    id: 'hand-pour', now: '2026-09-20T15:00:00.000Z', actor: 'David',
    draft: {
      itemType: 'Task', taskName: 'Pour slab', projectName: 'Alpha', projectId: 'alpha', locationName: 'Lot',
      startDate: '10/01/2026', finishDate: '10/05/2026', milestone: '', owner: 'Crew A', contractor: '', percentComplete: '40',
      priority: 'Medium', status: 'In Progress', notes: 'Pump booked', nextAction: '', activityMessage: '',
    },
  }) as unknown as ScheduleItem;
  const FRIDAY = '2026-09-25T12:00:00.000Z';
  const L = doc('LOOKAHEAD L', '2026-09-27T12:00:00.000Z', 'lookahead');
  const G = doc('MASTER G', FRIDAY);
  const MONDAY = '2026-09-28T12:00:00.000Z';
  const G_ROW = (percent: string) => `Pour slab,Alpha,Lot,10/08/2026,10/12/2026,${percent}`;
  const L_ROW = (percent: string) => `Pour slab,Alpha,Lot,10/14/2026,10/18/2026,${percent}`;
  const webFlow = (gPercent: string, lPercent: string, current: (state: State, document: ReferenceDocument) => State) => {
    const up = upload({ items: [hand], documents: [] }, 'alpha-master-g.csv', [G_ROW(gPercent)], FRIDAY);
    const after = current(approve(up.state, L, [L_ROW(lPercent)], true), up.document);
    return { after, deleted: deleteWithItems(after, L, '2026-09-30T12:00:00.000Z') };
  };
  const phoneFlow = (gPercent: string, lPercent: string) => {
    const after = approve(approve({ items: [hand], documents: [] }, G, [G_ROW(gPercent)]), L, [L_ROW(lPercent)], true);
    return { after, deleted: deleteWithItems(after, L, '2026-09-30T12:00:00.000Z') };
  };
  const web = (state: State, document: ReferenceDocument) => makeCurrent(state, document, MONDAY);
  const phone = (state: State, document: ReferenceDocument) => setActive(state, document, MONDAY);

  it('phone order (approve G, then the lookahead): 60%, kept after the delete', () => {
    const { after, deleted } = phoneFlow('60', '');
    expect(copies(after, 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 60]]);
    expect(copies(deleted, 'Pour slab')).toEqual([['10/08/2026', '10/12/2026', 60]]);
  });

  it.each([['web Make Current', web], ['phone Set Active', phone]] as const)('%s: 60% on the lookahead\'s dates, kept after the delete', (_how, current) => {
    const { after, deleted } = webFlow('60', '', current);
    expect(copies(after, 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 60]]);
    const task = after.items.find(item => item.id === 'hand-pour')!;
    expect(task).toMatchObject({ owner: 'Crew A', notes: 'Pump booked', progressSource: 'project_manager', progressConfirmedBy: 'Schedule update', progressConfirmedAt: MONDAY });
    expect(task).not.toHaveProperty('scheduleRowsAwaitingCurrent');
    expect(copies(deleted, 'Pour slab')).toEqual([['10/08/2026', '10/12/2026', 60]]);
  });

  it.each([['web Make Current', web], ['phone Set Active', phone]] as const)('%s: G\'s 30% never lowers David\'s 40% (unchanged)', (_how, current) => {
    const { after, deleted } = webFlow('30', '', current);
    expect(copies(after, 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 40]]);
    expect(copies(deleted, 'Pour slab')).toEqual([['10/08/2026', '10/12/2026', 40]]);
    expect(copies(phoneFlow('30', '').after, 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 40]]);
  });

  it.each([['web Make Current', web], ['phone Set Active', phone]] as const)('%s: a lookahead newer than G that states 50% keeps 50% (unchanged)', (_how, current) => {
    const { after } = webFlow('60', '50', current);
    expect(copies(after, 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 50]]);
    expect(copies(phoneFlow('60', '50').after, 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 50]]);
  });

  it.each([['web Make Current', web], ['phone Set Active', phone]] as const)('%s: G with no % column leaves David\'s 40% (unchanged)', (_how, current) => {
    const { after } = webFlow('', '', current);
    expect(copies(after, 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 40]]);
  });

  it('David\'s 50% entered after G was uploaded stays: his newer word (unchanged; the phone\'s order gives 50% too)', () => {
    const up = upload({ items: [hand], documents: [] }, 'alpha-master-g.csv', [G_ROW('60')], FRIDAY);
    const onL = record(approve(up.state, L, [L_ROW('')], true), 'hand-pour', 50, '2026-09-27T15:00:00.000Z');
    expect(copies(makeCurrent(onL, up.document, MONDAY), 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 50]]);
    expect(copies(setActive(onL, up.document, MONDAY), 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 50]]);
    const phoneOrder = record(approve(approve({ items: [hand], documents: [] }, G, [G_ROW('60')]), L, [L_ROW('')], true), 'hand-pour', 50, '2026-09-27T15:00:00.000Z');
    expect(copies(phoneOrder, 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 50]]);
  });

  it('David\'s 80% entered after the lookahead stays (unchanged)', () => {
    const up = upload({ items: [hand], documents: [] }, 'alpha-master-g.csv', [G_ROW('60')], FRIDAY);
    const onL = record(approve(up.state, L, [L_ROW('')], true), 'hand-pour', 80, '2026-09-27T15:00:00.000Z');
    expect(copies(makeCurrent(onL, up.document, MONDAY), 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 80]]);
  });
});

/**
 * A6 pass 20 L1 (older, cosmetic): two same-named open tasks in one area, with
 * the same status, percent and due date, printed one Current Work line.
 * Completed Work and the "since" lines count them (f0c2fe8); Current Work now
 * does too. The same task reached twice still prints once.
 */
describe('A6 p20 L1: Current Work counts two different tasks on one line', () => {
  const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
  const draft = {
    id: 'draft-1', reportType: 'daily_project_update', audience: 'owner', title: 'Alpha update', subject: 'Alpha update', body: '',
    openingLine: '', closingLine: '', executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [], risks: [],
    decisionsNeeded: [], confidence: 'high', reportReadiness: 'high', needsReview: false, reviewFlags: [], sourceEvidence: [],
    constructionUnderstanding: {}, generatedAt: '2026-09-01T00:00:00.000Z',
  } as unknown as PIEReportDraft;
  const truthOf = (items: ScheduleItem[], now: string) => buildDAVEProjectTruth({
    projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: items, projectAreas: [], referenceDocuments: [], now,
  });
  const briefingOf = (truths: ReturnType<typeof truthOf>[], items: ScheduleItem[]) => buildDAVEReportBriefing({
    truths, selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(null, buildDAVEReportSourceFingerprint(truths)), scheduleItems: items,
  });
  const withSecondPour = () => {
    const state = approve(EMPTY, F, ['Pour slab,Alpha,Lot,10/05/2026,10/09/2026,', 'Framing,Alpha,Lot,10/12/2026,10/16/2026,']);
    const first = named(state, 'Pour slab')[0];
    // David enters a second pour by hand in the same area, due the same day.
    const { importBatchId: _batch, sourceDocumentId: _document, importedFrom: _from, importedAt: _at, ...hand } = first as any;
    return { ...state, items: [...state.items, { ...hand, id: 'hand-pour-2', startDate: '10/07/2026', createdAt: '2026-09-08T09:00:00.000Z', updatedAt: '2026-09-08T09:00:00.000Z' } as ScheduleItem] };
  };
  const section = (body: string, title: string) => body.slice(body.indexOf(title)).split('\n\n')[0];

  it('two pours: one line with "(2 tasks)", in the PM report too', () => {
    const state = withSecondPour();
    expect(named(state, 'Pour slab')).toHaveLength(2);
    const briefing = briefingOf([truthOf(shown(state), '2026-09-08T15:00:00.000Z')], shown(state));
    expect(briefing.currentWork.filter(line => line.startsWith('Pour slab'))).toEqual(['Pour slab (Lot): Not Started; 0% complete; due 10/09/2026 (2 tasks).']);
    expect(briefing.currentWork.filter(line => line.startsWith('Framing'))).toEqual(['Framing (Lot): Not Started; 0% complete; due 10/16/2026.']);
    expect(section(enhanceDAVEReportDraft(draft, briefing, 'project_manager').body, 'CURRENT WORK')).toContain('Pour slab (Lot): Not Started; 0% complete; due 10/09/2026 (2 tasks).');
  });

  it('different percents: two lines, no count (unchanged)', () => {
    const state = record(withSecondPour(), 'hand-pour-2', 30, '2026-09-08T10:00:00.000Z');
    const briefing = briefingOf([truthOf(shown(state), '2026-09-08T15:00:00.000Z')], shown(state));
    expect(briefing.currentWork.filter(line => line.startsWith('Pour slab')).sort()).toEqual([
      'Pour slab (Lot): In Progress; 30% complete; due 10/09/2026.',
      'Pour slab (Lot): Not Started; 0% complete; due 10/09/2026.',
    ]);
  });

  it('the same task reached twice prints once, with no count', () => {
    const state = approve(EMPTY, F, ['Pour slab,Alpha,Lot,10/05/2026,10/09/2026,']);
    const truth = truthOf(shown(state), '2026-09-08T15:00:00.000Z');
    const briefing = briefingOf([truth, truth], shown(state));
    expect(briefing.currentWork.filter(line => line.includes('Pour slab'))).toHaveLength(1);
    expect(briefing.currentWork.join('\n')).not.toContain('tasks)');
  });
});

/**
 * A7 pass 24 L-3 (older, Low): master G lists Framing on lookahead L2's dates,
 * so it restates the task in place: its note takes G's dates and marks L1 and
 * L2 replaced, and updatedAt stays. Full Sync on a device still holding the
 * copy from before G tied on updatedAt, kept that copy's note and wrote it to
 * the cloud: no marks, F's dates. Deleting L2 and L1 then showed F's
 * 10/16-10/26 again instead of G's 10/18-10/28.
 */
describe('A7 p24 L-3: Full Sync keeps the marks a master left on the lookahead note', () => {
  const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
  const L1 = doc('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');
  const L2 = doc('LOOKAHEAD L2', '2026-09-11T12:00:00.000Z', 'lookahead');
  const G = doc('MASTER G', '2026-09-14T12:00:00.000Z');
  const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,';
  let beforeG = approve(EMPTY, F, ['Framing,Alpha,Lot,10/16/2026,10/26/2026,', SURVEY]);
  beforeG = approve(beforeG, L1, ['Framing,Alpha,Lot,10/17/2026,10/27/2026,'], true);
  beforeG = approve(beforeG, L2, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
  const afterG = approve(beforeG, G, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,', SURVEY]);
  const framingId = named(afterG, 'Framing')[0].id;
  const stale = beforeG.items.find(item => item.id === framingId)!;
  const cloud = afterG.items.find(item => item.id === framingId)!;
  /** The device that did not approve G runs Full Sync: the merge, then what it writes back. */
  const fullSync = () => {
    const merged = recoverDAVEScheduleRecords({ local: beforeG.items, cloud: afterG.items, allowCloudOnly: true });
    const uploaded = daveScheduleItemsNeedingCloudUpload({ local: merged, cloud: afterG.items });
    const cloudAfter = afterG.items.map(item => uploaded.find(upload => upload.id === item.id) || item);
    return { merged, cloudAfter };
  };
  const deleteBoth = (items: ScheduleItem[]) => {
    const state: State = { items, documents: afterG.documents };
    const one = deleteWithItems(state, L2, '2026-09-15T10:00:00.000Z');
    return { afterL2: copies(one, 'Framing'), afterBoth: copies(deleteWithItems(one, L1, '2026-09-16T10:00:00.000Z'), 'Framing') };
  };

  it('G restated the task in place and left updatedAt alone (the tie)', () => {
    expect(cloud.updatedAt).toBe(stale.updatedAt);
    expect(cloud.lookaheadOverlay).toMatchObject({ masterStartDate: '10/18/2026', masterFinishDate: '10/28/2026' });
    expect(stale.lookaheadOverlay).toMatchObject({ masterStartDate: '10/16/2026', masterFinishDate: '10/26/2026' });
  });

  it('the merge keeps G\'s note, and the delete of L2 then L1 stays on G\'s dates', () => {
    const { merged, cloudAfter } = fullSync();
    const task = merged.find(item => item.id === framingId)!;
    expect(task.lookaheadOverlay).toMatchObject({ masterStartDate: '10/18/2026', masterFinishDate: '10/28/2026' });
    expect(task.lookaheadOverlay!.lookaheads.map(entry => entry.datesReplacedByMaster)).toEqual(['batch-MASTER G', 'batch-MASTER G']);
    expect(cloudAfter.find(item => item.id === framingId)!.lookaheadOverlay).toEqual(cloud.lookaheadOverlay);
    expect(deleteBoth(merged)).toEqual({ afterL2: [['10/18/2026', '10/28/2026', 0]], afterBoth: [['10/18/2026', '10/28/2026', 0]] });
    expect(deleteBoth(cloudAfter)).toEqual({ afterL2: [['10/18/2026', '10/28/2026', 0]], afterBoth: [['10/18/2026', '10/28/2026', 0]] });
  });

  it('either way round: the device that approved G keeps its note', () => {
    const merged = recoverDAVEScheduleRecords({ local: afterG.items, cloud: beforeG.items, allowCloudOnly: true });
    expect(merged.find(item => item.id === framingId)!.lookaheadOverlay).toEqual(cloud.lookaheadOverlay);
  });

  it('unchanged: a copy whose note no master marked merges as before', () => {
    const noted = { ...stale, notes: 'Crew booked', updatedAt: '2026-09-12T09:00:00.000Z' } as ScheduleItem;
    const [merged] = recoverDAVEScheduleRecords({ local: [noted], cloud: [stale], allowCloudOnly: true });
    expect(merged).toMatchObject({ notes: 'Crew booked', lookaheadOverlay: stale.lookaheadOverlay });
  });

  it('a lookahead approved again since on new dates takes no old mark; the earlier one keeps G\'s', () => {
    const again = {
      ...stale,
      lookaheadOverlay: { ...stale.lookaheadOverlay!, lookaheads: stale.lookaheadOverlay!.lookaheads.map(entry => entry.batchId === 'batch-LOOKAHEAD L2' ? { ...entry, startDate: '10/19/2026', finishDate: '10/29/2026' } : entry) },
      startDate: '10/19/2026', finishDate: '10/29/2026', updatedAt: '2026-09-15T09:00:00.000Z',
    } as ScheduleItem;
    const [merged] = recoverDAVEScheduleRecords({ local: [again], cloud: [cloud], allowCloudOnly: true });
    expect(merged.lookaheadOverlay!.lookaheads.map(entry => entry.datesReplacedByMaster)).toEqual(['batch-MASTER G', undefined]);
  });
});
