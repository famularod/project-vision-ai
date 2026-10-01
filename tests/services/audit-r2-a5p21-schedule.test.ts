/**
 * Audit round 2, A5 pass 21 (1 Oct 2026): three Low findings in the schedule
 * merge, each caused by the previous round's fixes: R1 (b98824e) in Set
 * Active / Make Current (ScheduleImportMerge, ScheduleLookahead), R2
 * (a3239e3) in Full Sync's merge (DAVEScheduleRecovery), R3 (9efa666) in
 * Make Current for a task entered by hand (ScheduleImportMerge).
 *
 * Owner answer Q22: a lookahead adds to the master, and file progress never
 * goes below what David entered. A newer master's dates replace older
 * lookahead dates; a lookahead newer than the master restates the task, its
 * percent floored at David's own.
 *
 * Real CSV normalizer, the phone's merge, Set Active, Delete PDF + Items and
 * shown-task pick, the web's upload plan and Make Current carry, and Full
 * Sync's merge. Synthetic data.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import type { ReferenceDocument, ScheduleItem } from '../../types';
import { daveScheduleItemsNeedingCloudUpload, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { planDAVEWebScheduleImport, prepareDAVEWebDocumentUpload } from '../../services/DAVEWebOperations';
import { buildDAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation, scheduleProgressCarriedToShownTasks,
} from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
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
/** Delete PDF + Items on the phone (App.tsx). */
function deleteWithItems(state: State, target: ReferenceDocument, at: string): State {
  const document = state.documents.find(saved => saved.id === target.id)!;
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at }).map(item => [item.id, item]));
  return { items: kept.map(item => saved.get(item.id) || item), documents };
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
 * R1 (Low, caused by b98824e): master F lists Framing 10/15-10/25; lookahead
 * L1 moves it to 10/18-10/28, then L2 to 10/20-10/30; master G lists Framing
 * on L2's dates, so the task is updated in place and L1's dates are marked
 * replaced by G. With F current again (Set Active), or G uploaded on the web
 * and not yet current, deleting L2 rightly gives L1's 10/18-10/28. Making G
 * current then left Framing on 10/18-10/28, though G is newer than L1 and
 * lists 10/20-10/30 (at c73ceab it ended on G's dates).
 */
describe('R1: making the master that replaced a lookahead\'s dates current again gives its dates', () => {
  const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
  const L1 = doc('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');
  const L2 = doc('LOOKAHEAD L2', '2026-09-11T12:00:00.000Z', 'lookahead');
  const G = doc('MASTER G', '2026-09-14T12:00:00.000Z');
  const H = doc('MASTER H', '2026-09-21T12:00:00.000Z');
  const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,';
  const G_LINES = ['Framing,Alpha,Lot,10/20/2026,10/30/2026,', SURVEY];
  const onL2 = () => {
    let state = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,', SURVEY]);
    state = approve(state, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
    return approve(state, L2, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,'], true);
  };
  const L1_DATES = ['10/18/2026', '10/28/2026', 0];
  const G_DATES = ['10/20/2026', '10/30/2026', 0];
  /** Route B: G approved on the phone, F current again, L2 deleted. */
  const routeB = () => {
    let state = approve(onL2(), G, G_LINES);
    state = setActive(state, F, '2026-09-15T10:00:00.000Z');
    return deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z');
  };
  /** Route A: G uploaded on the web, not current; L2 deleted on the phone. */
  const routeA = () => {
    const up = upload(onL2(), 'alpha-master-g.csv', G_LINES, G.importedAt as string);
    return { state: deleteWithItems(up.state, L2, '2026-09-16T10:00:00.000Z'), G: up.document };
  };
  const AT = '2026-09-17T10:00:00.000Z';

  it('route B: after the delete under F, L1\'s dates (unchanged, A5 pass 20 P1)', () => {
    expect(copies(routeB(), 'Framing')).toEqual([L1_DATES]);
  });

  it.each([
    ['phone Set Active', (state: State) => setActive(state, G, AT)],
    ['web Make Current', (state: State) => makeCurrent(state, G, AT)],
  ] as const)('route B, then %s of G: G\'s 10/20-10/30', (_how, current) => {
    const after = current(routeB());
    expect(copies(after, 'Framing')).toEqual([G_DATES]);
    expect(named(after, 'Framing')[0].updatedAt).toBe(AT);
  });

  it.each([
    ['web Make Current', (state: State, master: ReferenceDocument) => makeCurrent(state, master, AT)],
    ['phone Set Active', (state: State, master: ReferenceDocument) => setActive(state, master, AT)],
  ] as const)('route A: G uploaded on the web, L2 deleted, then %s of G: G\'s 10/20-10/30', (_how, current) => {
    const { state, G: uploaded } = routeA();
    expect(copies(state, 'Framing')).toEqual([L1_DATES]);
    expect(copies(current(state, uploaded), 'Framing')).toEqual([G_DATES]);
  });

  it('a later master repeating G\'s dates keeps them', () => {
    const state = approve(setActive(routeB(), G, AT), H, G_LINES);
    expect(copies(state, 'Framing')).toEqual([G_DATES]);
  });

  it('F current again after G: L1\'s dates again, as at the delete (L1 is newer than F)', () => {
    let state = setActive(routeB(), G, AT);
    state = setActive(state, F, '2026-09-18T10:00:00.000Z');
    expect(copies(state, 'Framing')).toEqual([L1_DATES]);
    expect(copies(makeCurrent(state, G, '2026-09-19T10:00:00.000Z'), 'Framing')).toEqual([G_DATES]);
    expect(copies(makeCurrent(setActive(routeB(), G, AT), F, '2026-09-18T10:00:00.000Z'), 'Framing')).toEqual([L1_DATES]);
  });

  it('unchanged: Set Active of F with no delete keeps L2\'s dates (G listed them too)', () => {
    let state = approve(onL2(), G, G_LINES);
    state = setActive(state, F, '2026-09-15T10:00:00.000Z');
    expect(copies(state, 'Framing')).toEqual([G_DATES]);
    expect(copies(setActive(state, G, AT), 'Framing')).toEqual([G_DATES]);
  });

  it('unchanged: a newer lookahead L3 on its own dates stays when G is made current', () => {
    const L3 = doc('LOOKAHEAD L3', '2026-09-16T18:00:00.000Z', 'lookahead');
    const state = approve(routeB(), L3, ['Framing,Alpha,Lot,10/22/2026,11/01/2026,'], true);
    expect(copies(setActive(state, G, AT), 'Framing')).toEqual([['10/22/2026', '11/01/2026', 0]]);
  });

  it('unchanged: dates David moved by hand after the delete stay', () => {
    const moved = routeB();
    const id = named(moved, 'Framing')[0].id;
    const state = { ...moved, items: moved.items.map(item => item.id === id ? { ...item, startDate: '10/19/2026', finishDate: '10/29/2026' } : item) };
    expect(copies(setActive(state, G, AT), 'Framing')).toEqual([['10/19/2026', '10/29/2026', 0]]);
  });
});

/**
 * R2 (Low, caused by a3239e3): David's 40% on Framing, then lookahead L1. On
 * the phone master G restates Framing in place and marks L1. On the iPad,
 * which never got G's copy, David enters 50% and approves lookahead L2 at
 * 70%. Full Sync took all of G's copy's note, its older 40% and who stated it
 * included, so deleting L2 gave back 40%, not David's newer 50% (at c73ceab,
 * 50%), and the merged row went to the cloud.
 */
describe('R2: Full Sync keeps David\'s newer percent on the lookahead note', () => {
  const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
  const L1 = doc('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');
  const G = doc('MASTER G', '2026-09-14T12:00:00.000Z');
  const L2 = doc('LOOKAHEAD L2', '2026-09-17T12:00:00.000Z', 'lookahead');
  const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,';
  let start = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,', SURVEY]);
  const framingId = named(start, 'Framing')[0].id;
  start = record(start, framingId, 40, '2026-09-08T10:00:00.000Z');
  start = approve(start, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
  /** The phone: G lists Framing on L1's dates and marks L1. */
  const phone = approve(start, G, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,', SURVEY]);
  /** The iPad, without G's copy: David's 50%, then L2 at 70%. */
  const iPad = approve(record(start, framingId, 50, '2026-09-15T10:00:00.000Z'), L2, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,70'], true);
  const documents = [...phone.documents, L2];
  const deleteL2 = (items: ScheduleItem[]) => deleteWithItems({ items, documents }, L2, '2026-09-18T10:00:00.000Z');

  it('the copies: G\'s marks on the phone, David\'s 50% and L2\'s 70% on the iPad', () => {
    expect(phone.items.find(item => item.id === framingId)!.lookaheadOverlay!.lookaheads.map(entry => entry.datesReplacedByMaster)).toEqual(['batch-MASTER G']);
    expect(iPad.items.find(item => item.id === framingId)).toMatchObject({ percentComplete: 70, lookaheadOverlay: { masterPercentComplete: 50 } });
  });

  it.each([
    ['the iPad\'s Full Sync', () => recoverDAVEScheduleRecords({ local: iPad.items, cloud: phone.items, allowCloudOnly: true })],
    ['the phone\'s Full Sync', () => recoverDAVEScheduleRecords({ local: phone.items, cloud: iPad.items, allowCloudOnly: true })],
  ] as const)('%s keeps G\'s marks and dates with David\'s 50%; deleting L2 gives 50%', (_how, merge) => {
    const merged = merge();
    const task = merged.find(item => item.id === framingId)!;
    expect(task.lookaheadOverlay).toMatchObject({
      masterStartDate: '10/18/2026', masterFinishDate: '10/28/2026',
      masterPercentComplete: 50, masterProgressConfirmedBy: 'David', masterProgressConfirmedAt: '2026-09-15T10:00:00.000Z',
    });
    expect(task.lookaheadOverlay!.lookaheads.map(entry => [entry.batchId, entry.datesReplacedByMaster])).toEqual([
      ['batch-LOOKAHEAD L1', 'batch-MASTER G'], ['batch-LOOKAHEAD L2', undefined],
    ]);
    expect(copies(deleteL2(merged), 'Framing')).toEqual([['10/18/2026', '10/28/2026', 50]]);
  });

  it('what the iPad writes to the cloud keeps the 50%', () => {
    const merged = recoverDAVEScheduleRecords({ local: iPad.items, cloud: phone.items, allowCloudOnly: true });
    const uploaded = daveScheduleItemsNeedingCloudUpload({ local: merged, cloud: phone.items });
    const cloudAfter = phone.items.map(item => uploaded.find(upload => upload.id === item.id) || item);
    expect(cloudAfter.find(item => item.id === framingId)!.lookaheadOverlay).toMatchObject({ masterPercentComplete: 50, masterStartDate: '10/18/2026' });
    expect(copies(deleteL2(cloudAfter), 'Framing')).toEqual([['10/18/2026', '10/28/2026', 50]]);
  });

  it('unchanged: when G stated a percent the iPad never saw and David entered none since, G\'s word is kept', () => {
    const phone60 = approve(start, G, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,60', SURVEY]);
    const iPadL2 = approve(start, L2, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,'], true);
    const merged = recoverDAVEScheduleRecords({ local: iPadL2.items, cloud: phone60.items, allowCloudOnly: true });
    const phoneNote = phone60.items.find(item => item.id === framingId)!.lookaheadOverlay!;
    const { lookaheads: _entries, ...phoneMaster } = phoneNote;
    expect(merged.find(item => item.id === framingId)!.lookaheadOverlay).toMatchObject(phoneMaster);
  });

  it('unchanged: David\'s newer percent on the phone, after its last file, keeps the phone\'s note (50%)', () => {
    // The phone's 50% (16 Sep) is David's word after the iPad's 10% (15 Sep): the note as before, 50%.
    const phoneLater = record(approve(record(start, framingId, 50, '2026-09-08T11:00:00.000Z'), G,
      ['Framing,Alpha,Lot,10/18/2026,10/28/2026,', SURVEY]), framingId, 50, '2026-09-16T10:00:00.000Z');
    const iPad10 = approve(record(record(start, framingId, 50, '2026-09-08T11:00:00.000Z'), framingId, 10, '2026-09-15T10:00:00.000Z'), L2,
      ['Framing,Alpha,Lot,10/20/2026,10/30/2026,80'], true);
    const merged = recoverDAVEScheduleRecords({ local: iPad10.items, cloud: phoneLater.items, allowCloudOnly: true });
    expect(copies(deleteL2(merged), 'Framing')).toEqual([['10/18/2026', '10/28/2026', 50]]);
  });

  it('a master only the phone saw, stating less than David\'s own on the iPad, never lowers it (70%)', () => {
    // No percent of David's on the phone: G's 60% is noted as the file's, with no time of its own.
    let common = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,', SURVEY]);
    common = approve(common, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
    const phone60 = approve(common, G, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,60', SURVEY]);
    const iPad70 = approve(record(common, framingId, 70, '2026-09-10T10:00:00.000Z'), L2, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,80'], true);
    const merged = recoverDAVEScheduleRecords({ local: iPad70.items, cloud: phone60.items, allowCloudOnly: true });
    expect(merged.find(item => item.id === framingId)!.lookaheadOverlay).toMatchObject({
      masterStartDate: '10/18/2026', masterPercentComplete: 70, masterProgressConfirmedBy: 'David', masterFilePercentComplete: 60,
    });
    expect(copies(deleteL2(merged), 'Framing')).toEqual([['10/18/2026', '10/28/2026', 70]]);
  });
});

/**
 * R3 (Low, caused by 9efa666 for hand tasks): David's hand-entered Pour slab
 * at 40%; master G uploaded on the web Friday at 60%, left not current;
 * lookahead L on Sunday states 30% (floored at David's 40%). Making G
 * current gave G's 60%, though the newer lookahead stated a percent (at
 * c73ceab, 40%). The note recorded only a percent the lookahead gave, so it
 * could not tell "no % column" from "stated a percent at or below David's".
 */
describe('R3: a newer lookahead that stated a percent at or below David\'s keeps an older master\'s higher percent off', () => {
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
  const MONDAY = '2026-09-28T12:00:00.000Z';
  const G_ROW = (percent: string) => `Pour slab,Alpha,Lot,10/08/2026,10/12/2026,${percent}`;
  const L_ROW = (percent: string) => `Pour slab,Alpha,Lot,10/14/2026,10/18/2026,${percent}`;
  const onL = (gPercent: string, lPercent: string) => {
    const up = upload({ items: [hand], documents: [] }, 'alpha-master-g.csv', [G_ROW(gPercent)], FRIDAY);
    return { state: approve(up.state, L, [L_ROW(lPercent)], true), G: up.document };
  };
  const web = (state: State, document: ReferenceDocument) => makeCurrent(state, document, MONDAY);
  const phone = (state: State, document: ReferenceDocument) => setActive(state, document, MONDAY);

  it('the lookahead notes that its row stated a percent, though it gave none', () => {
    const { state } = onL('60', '30');
    expect(state.items.find(item => item.id === 'hand-pour')!.lookaheadOverlay!.lookaheads).toEqual([
      expect.objectContaining({ batchId: 'batch-LOOKAHEAD L', percentComplete: null, percentStated: true }),
    ]);
    expect(onL('60', '').state.items.find(item => item.id === 'hand-pour')!.lookaheadOverlay!.lookaheads[0]).not.toHaveProperty('percentStated');
  });

  it.each([['web Make Current', web], ['phone Set Active', phone]] as const)('%s of G after L stated 30%: David\'s 40% stays', (_how, current) => {
    const { state, G } = onL('60', '30');
    const after = current(state, G);
    expect(copies(after, 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 40]]);
    expect(copies(deleteWithItems(after, L, '2026-09-30T12:00:00.000Z'), 'Pour slab')).toEqual([['10/08/2026', '10/12/2026', 40]]);
  });

  it.each([['web Make Current', web], ['phone Set Active', phone]] as const)('%s of G after L stated 40% (David\'s): 40% stays', (_how, current) => {
    const { state, G } = onL('60', '40');
    expect(copies(current(state, G), 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 40]]);
  });

  it.each([['web Make Current', web], ['phone Set Active', phone]] as const)('unchanged: %s of G after L with no % column gives G\'s 60% (A5 pass 20 P2)', (_how, current) => {
    const { state, G } = onL('60', '');
    expect(copies(current(state, G), 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 60]]);
  });

  it.each([['web Make Current', web], ['phone Set Active', phone]] as const)('unchanged: %s of G after L stated 50%: 50%', (_how, current) => {
    const { state, G } = onL('60', '50');
    expect(copies(current(state, G), 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 50]]);
  });

  it('unchanged: a note saved before, with no word on whether the row stated a percent, reads as before (60%)', () => {
    const { state, G } = onL('60', '30');
    const old: State = {
      ...state,
      items: state.items.map(item => item.lookaheadOverlay ? {
        ...item,
        lookaheadOverlay: { ...item.lookaheadOverlay, lookaheads: item.lookaheadOverlay.lookaheads.map(({ percentStated: _stated, ...entry }) => entry) },
      } : item),
    };
    expect(copies(web(old, G), 'Pour slab')).toEqual([['10/14/2026', '10/18/2026', 60]]);
  });
});
