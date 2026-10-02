/**
 * Audit round 2, A5 pass 22 (1 Oct 2026): two Low findings in the schedule
 * merge. L1 (caused by 5aba116, A5 pass 21 R1) in Set Active / Make Current
 * (ScheduleLookahead); L2 (older, caused by a3239e3, left open by ba4c2cf)
 * in Full Sync's merge (DAVEScheduleRecovery).
 *
 * Owner answer Q22: a lookahead adds to the master, and file progress never
 * goes below what David entered. A newer master's dates replace older
 * lookahead dates; a lookahead newer than the master restates the task, its
 * percent floored at David's own.
 *
 * Real CSV normalizer, the phone's merge, Set Active, Delete PDF + Items and
 * shown-task pick, the web's upload plan, delete plan and Make Current carry,
 * and Full Sync's merge. Synthetic data.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import type { ReferenceDocument, ScheduleItem } from '../../types';
import { daveScheduleItemsNeedingCloudUpload, recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { planDAVEWebScheduleDocumentDelete, planDAVEWebScheduleImport, prepareDAVEWebDocumentUpload } from '../../services/DAVEWebOperations';
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
/** Deleting a schedule on the web (its delete plan over the tasks the web knows). */
function webDelete(state: State, target: ReferenceDocument, at: string): State {
  const document = state.documents.find(saved => saved.id === target.id)!;
  const linked = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const webDocument = { ...document, cloudUpdatedAt: null, linkedScheduleItems: linked.map(item => ({ id: item.id, cloudUpdatedAt: null })), importedScheduleItemCount: 0 };
  const revisions = planDAVEWebScheduleDocumentDelete({
    snapshot: { scheduleItems: shown(state) as any, knownScheduleItems: state.items as any, referenceDocuments: state.documents as any } as any,
    document: webDocument as any, updatedAt: at,
  });
  const removedIds = new Set(linked.map(item => item.id));
  const revised = new Map(revisions.map(revision => [revision.item.id, revision.item as ScheduleItem]));
  return {
    items: state.items.filter(item => !removedIds.has(item.id)).map(item => revised.get(item.id) || item),
    documents: state.documents.filter(other => other.id !== document.id),
  };
}

/** David records progress by hand on the phone. */
const record = (state: State, id: string, pct: number, at: string): State => ({
  ...state,
  items: state.items.map(item => item.id === id ? {
    ...item, percentComplete: pct, status: pct >= 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager',
    progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at,
  } as ScheduleItem : item),
});
/** Full Sync on one device against the other's copy (the cloud), and the device that syncs second. */
const SYNCS = [
  ['the iPad\'s Full Sync', (phone: ScheduleItem[], iPad: ScheduleItem[]) => recoverDAVEScheduleRecords({ local: iPad, cloud: phone, allowCloudOnly: true })],
  ['the phone\'s Full Sync', (phone: ScheduleItem[], iPad: ScheduleItem[]) => recoverDAVEScheduleRecords({ local: phone, cloud: iPad, allowCloudOnly: true })],
] as const;

type Activate = (state: State, target: ReferenceDocument, at: string) => State;
const HOWS: ReadonlyArray<readonly [string, Activate]> = [['phone Set Active', setActive], ['web Make Current', makeCurrent]];

/**
 * L1 (Low, caused by 5aba116): Set Active and Make Current recompute the
 * dates of an imported task whose lookahead note a master marked (A5 pass 21
 * R1). Three shapes moved Framing onto dates no file in effect gives (at
 * fb44926 and c73ceab it kept its dates):
 * (a) a mark naming a master that was deleted read as "replaced";
 * (b) a newer master that does not list the task gave an older master's dates;
 * (c) going back to G gave the dates of the newer master H that copied L2.
 */
describe('A5 p22 L1: Set Active / Make Current keeps an imported task on the right dates', () => {
  const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
  const L1 = doc('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');
  const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,';
  const framing = (start: string, finish: string) => `Framing,Alpha,Lot,${start},${finish},`;
  const F_ROW = framing('10/15/2026', '10/25/2026');
  const L1_ROW = framing('10/18/2026', '10/28/2026');
  const L2_ROW = framing('10/20/2026', '10/30/2026');
  const L1_DATES = ['10/18/2026', '10/28/2026', 0];
  const L2_DATES = ['10/20/2026', '10/30/2026', 0];
  const AT = '2026-09-20T10:00:00.000Z';

  describe('(a) a deleted master\'s marks: L2 stays (it is the newest lookahead, newer than F)', () => {
    const G = doc('MASTER G', '2026-09-11T12:00:00.000Z');
    const L2 = doc('LOOKAHEAD L2', '2026-09-13T12:00:00.000Z', 'lookahead');
    const H = doc('MASTER H', '2026-09-15T12:00:00.000Z');
    /** F, L1 (10/18), G copying L1, L2 (10/20). */
    const onL2 = () => {
      let state = approve(EMPTY, F, [F_ROW, SURVEY]);
      state = approve(state, L1, [L1_ROW], true);
      state = approve(state, G, [L1_ROW, SURVEY]);
      return approve(state, L2, [L2_ROW], true);
    };
    /** H, approved on the phone, lists Framing on L2's dates; then Delete PDF + Items of H. */
    const phoneDeleted = () => deleteWithItems(approve(onL2(), H, [L2_ROW, SURVEY]), H, '2026-09-16T10:00:00.000Z');
    /** H uploaded on the web on L2's dates, then deleted there (or on the phone) before Make Current. */
    const webDeleted = (remove: (state: State, target: ReferenceDocument, at: string) => State) => {
      const up = upload(onL2(), 'alpha-master-h.csv', [L2_ROW, SURVEY], H.importedAt as string);
      expect(up.state.items.find(item => item.taskName === 'Framing' && item.lookaheadOverlay)!.lookaheadOverlay!.lookaheads
        .map(entry => entry.datesReplacedByMaster)).toEqual(['batch-MASTER G', up.document.importBatchId]);
      return remove(up.state, up.document, '2026-09-16T10:00:00.000Z');
    };

    it.each(HOWS)('H deleted on the phone, then %s of F: L2\'s 10/20-10/30', (_how, activate) => {
      const state = phoneDeleted();
      expect(copies(state, 'Framing')).toEqual([L2_DATES]);
      expect(copies(activate(state, F, AT), 'Framing')).toEqual([L2_DATES]);
    });

    it.each(HOWS.flatMap(([how, activate]) => [
      [`${how}, H deleted on the web`, activate, webDelete],
      [`${how}, H deleted on the phone`, activate, deleteWithItems],
    ] as const))('H uploaded on the web, %s: L2\'s 10/20-10/30', (_how, activate, remove) => {
      const state = webDeleted(remove);
      expect(copies(state, 'Framing')).toEqual([L2_DATES]);
      expect(copies(activate(state, F, AT), 'Framing')).toEqual([L2_DATES]);
    });
  });

  describe('(b) a newer master that does not list the task: L1 adds it to H', () => {
    const L2 = doc('LOOKAHEAD L2', '2026-09-11T12:00:00.000Z', 'lookahead');
    const G = doc('MASTER G', '2026-09-14T12:00:00.000Z');
    const H = doc('MASTER H', '2026-09-16T12:00:00.000Z');
    /** F, L1 (10/18), L2 (10/20), G on L2's dates, H without Framing; F current again, L2 deleted. */
    const underF = () => {
      let state = approve(EMPTY, F, [F_ROW, SURVEY]);
      state = approve(state, L1, [L1_ROW], true);
      state = approve(state, L2, [L2_ROW], true);
      state = approve(state, G, [L2_ROW, SURVEY]);
      state = approve(state, H, [SURVEY]);
      state = setActive(state, F, '2026-09-17T10:00:00.000Z');
      return deleteWithItems(state, L2, '2026-09-17T11:00:00.000Z');
    };

    it('after the delete under F, L1\'s dates (unchanged)', () => {
      expect(copies(underF(), 'Framing')).toEqual([L1_DATES]);
    });

    it.each(HOWS)('then %s of H: L1\'s 10/18-10/28, not G\'s', (_how, activate) => {
      expect(copies(activate(underF(), H, AT), 'Framing')).toEqual([L1_DATES]);
    });
  });

  describe('(c) back to G after H copied L2: G\'s (and L1\'s) 10/18-10/28', () => {
    const G = doc('MASTER G', '2026-09-11T12:00:00.000Z');
    const L2 = doc('LOOKAHEAD L2', '2026-09-13T12:00:00.000Z', 'lookahead');
    const H = doc('MASTER H', '2026-09-15T12:00:00.000Z');
    /** F, L1, G copying L1, L2, H copying L2; F current again, L2 deleted. */
    const underF = () => {
      let state = approve(EMPTY, F, [F_ROW, SURVEY]);
      state = approve(state, L1, [L1_ROW], true);
      state = approve(state, G, [L1_ROW, SURVEY]);
      state = approve(state, L2, [L2_ROW], true);
      state = approve(state, H, [L2_ROW, SURVEY]);
      state = setActive(state, F, '2026-09-16T10:00:00.000Z');
      return deleteWithItems(state, L2, '2026-09-16T11:00:00.000Z');
    };

    it('after the delete under F, L1\'s dates (unchanged)', () => {
      expect(copies(underF(), 'Framing')).toEqual([L1_DATES]);
    });

    it.each(HOWS)('then %s of G: G\'s 10/18-10/28, not H\'s', (_how, activate) => {
      expect(copies(activate(underF(), G, AT), 'Framing')).toEqual([L1_DATES]);
    });

    it.each(HOWS)('unchanged: then %s of H: H\'s 10/20-10/30 (A5 pass 21 R1)', (_how, activate) => {
      expect(copies(activate(underF(), H, AT), 'Framing')).toEqual([L2_DATES]);
    });
  });

  it.each(HOWS)('unchanged: %s of a master that does not list the task still gives a newer lookahead\'s dates (A5 pass 21 R1)', (_how, activate) => {
    // G uploaded on the web without Framing; L1, L2; G current; H on L2's dates; L2 deleted under H; G again: L1 adds Framing to G.
    let state = approve(EMPTY, F, [F_ROW, SURVEY]);
    const up = upload(state, 'alpha-master-g.csv', [SURVEY], '2026-09-08T12:00:00.000Z');
    state = approve(up.state, L1, [L1_ROW], true);
    const L2 = doc('LOOKAHEAD L2', '2026-09-11T12:00:00.000Z', 'lookahead');
    state = setActive(approve(state, L2, [L2_ROW], true), up.document, '2026-09-12T10:00:00.000Z');
    state = approve(state, doc('MASTER H', '2026-09-13T12:00:00.000Z'), [L2_ROW, SURVEY]);
    state = deleteWithItems(state, L2, '2026-09-14T10:00:00.000Z');
    expect(copies(state, 'Framing')).toEqual([L2_DATES]);
    expect(copies(activate(state, up.document, AT), 'Framing')).toEqual([L1_DATES]);
  });
});

/**
 * L2 (older, caused by a3239e3; ba4c2cf left it open): both devices have
 * David's 40% on Framing and lookahead L1. On the iPad David enters 50%
 * (10 Sep) and approves lookahead L2 at 70% (17 Sep). On the phone, which
 * never saw the 50%, master G (14 Sep) lists Framing on L1's dates at 45%,
 * over the phone's 40%, so the note holds G's 45% as "Schedule update". Full
 * Sync either way kept G's 45% on the note, by time (14 Sep is after 10 Sep),
 * so deleting L2 showed 45% on both devices, below David's 50% (at c73ceab,
 * 50%). Q22: a master's percent never goes below what David entered.
 */
describe('A5 p22 L2: Full Sync never takes a master\'s percent below David\'s onto the lookahead note', () => {
  const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
  const L1 = doc('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');
  const K = doc('MASTER K', '2026-09-11T12:00:00.000Z');
  const G = doc('MASTER G', '2026-09-14T12:00:00.000Z');
  const L2 = doc('LOOKAHEAD L2', '2026-09-17T12:00:00.000Z', 'lookahead');
  const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,';
  let start = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,', SURVEY]);
  const framingId = named(start, 'Framing')[0].id;
  start = record(start, framingId, 40, '2026-09-08T10:00:00.000Z');
  start = approve(start, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
  const noteOf = (items: ScheduleItem[]) => items.find(item => item.id === framingId)!.lookaheadOverlay!;
  const deleteL2 = (items: ScheduleItem[], documents: ReferenceDocument[]) => deleteWithItems({ items, documents }, L2, '2026-09-18T10:00:00.000Z');

  /** The phone: G at 45% on L1's dates. The iPad: David's 50%, then L2 at 70%. */
  const phone = approve(start, G, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,45', SURVEY]);
  const iPad = approve(record(start, framingId, 50, '2026-09-10T10:00:00.000Z'), L2, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,70'], true);
  const documents = [...phone.documents, L2];

  it('the copies: G\'s 45% over the phone\'s 40% as "Schedule update", David\'s 50% and L2 on the iPad', () => {
    expect(noteOf(phone.items)).toMatchObject({ masterPercentComplete: 45, masterProgressSource: 'project_manager', masterProgressConfirmedBy: 'Schedule update' });
    expect(noteOf(iPad.items)).toMatchObject({ masterPercentComplete: 50, masterProgressConfirmedBy: 'David', masterProgressConfirmedAt: '2026-09-10T10:00:00.000Z' });
  });

  it.each(SYNCS)('%s keeps G\'s marks and dates with David\'s 50%; deleting L2 gives 50%', (_how, sync) => {
    const merged = sync(phone.items, iPad.items);
    expect(noteOf(merged)).toMatchObject({
      masterStartDate: '10/18/2026', masterFinishDate: '10/28/2026', masterFilePercentComplete: 45,
      masterPercentComplete: 50, masterProgressConfirmedBy: 'David', masterProgressConfirmedAt: '2026-09-10T10:00:00.000Z',
    });
    expect(noteOf(merged).lookaheads.map(entry => [entry.batchId, entry.datesReplacedByMaster])).toEqual([
      ['batch-LOOKAHEAD L1', 'batch-MASTER G'], ['batch-LOOKAHEAD L2', undefined],
    ]);
    expect(copies(deleteL2(merged, documents), 'Framing')).toEqual([['10/18/2026', '10/28/2026', 50]]);
  });

  it('what the iPad writes to the cloud keeps the 50%, and the phone\'s Full Sync after it too', () => {
    const merged = recoverDAVEScheduleRecords({ local: iPad.items, cloud: phone.items, allowCloudOnly: true });
    const uploaded = daveScheduleItemsNeedingCloudUpload({ local: merged, cloud: phone.items });
    const cloudAfter = phone.items.map(item => uploaded.find(upload => upload.id === item.id) || item);
    expect(noteOf(cloudAfter)).toMatchObject({ masterPercentComplete: 50, masterStartDate: '10/18/2026' });
    const phoneAfter = recoverDAVEScheduleRecords({ local: phone.items, cloud: cloudAfter, allowCloudOnly: true });
    expect(copies(deleteL2(phoneAfter, documents), 'Framing')).toEqual([['10/18/2026', '10/28/2026', 50]]);
  });

  it.each(SYNCS)('unchanged: %s takes G\'s percent when it is above David\'s (G at 60%)', (_how, sync) => {
    const phone60 = approve(start, G, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,60', SURVEY]);
    const merged = sync(phone60.items, iPad.items);
    expect(noteOf(merged)).toMatchObject({ masterPercentComplete: 60, masterProgressConfirmedBy: 'Schedule update' });
    expect(copies(deleteL2(merged, documents), 'Framing')).toEqual([['10/18/2026', '10/28/2026', 60]]);
  });

  it.each(SYNCS)('unchanged: %s keeps David\'s later 30% on the iPad over G\'s earlier 45%', (_how, sync) => {
    const iPad30 = approve(record(start, framingId, 30, '2026-09-15T10:00:00.000Z'), L2, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,70'], true);
    const merged = sync(phone.items, iPad30.items);
    expect(noteOf(merged)).toMatchObject({ masterPercentComplete: 30, masterProgressConfirmedBy: 'David' });
    expect(copies(deleteL2(merged, documents), 'Framing')).toEqual([['10/18/2026', '10/28/2026', 30]]);
  });

  /**
   * The mirror: the copy whose note holds a master's percent is the base.
   * The iPad saw master K (11 Sep) at 45% over its 40%, then approved L2;
   * the phone has David's 50% (10 Sep) and master G's marks. Full Sync kept
   * K's 45% by time (at fb44926, David's 50%).
   */
  describe('the mirror: the base copy holds the master\'s percent', () => {
    const iPadK = approve(approve(start, K, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,45', SURVEY]), L2, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,70'], true);
    const phone50 = approve(record(start, framingId, 50, '2026-09-10T10:00:00.000Z'), G, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,', SURVEY]);
    const mirrorDocuments = [F, L1, { ...K, isCurrent: false } as ReferenceDocument, G, L2];

    it('the copies: K\'s 45% as "Schedule update" and L2 on the iPad, David\'s 50% and G\'s marks on the phone', () => {
      expect(noteOf(iPadK.items)).toMatchObject({ masterPercentComplete: 45, masterProgressConfirmedBy: 'Schedule update', masterProgressConfirmedAt: K.importedAt });
      expect(noteOf(phone50.items)).toMatchObject({ masterPercentComplete: 50, masterProgressConfirmedBy: 'David' });
    });

    it.each(SYNCS)('%s keeps David\'s 50% with G\'s marks; deleting L2 gives 50%', (_how, sync) => {
      const merged = sync(phone50.items, iPadK.items);
      expect(noteOf(merged)).toMatchObject({ masterStartDate: '10/18/2026', masterPercentComplete: 50, masterProgressConfirmedBy: 'David' });
      expect(copies(deleteL2(merged, mirrorDocuments), 'Framing')).toEqual([['10/18/2026', '10/28/2026', 50]]);
    });

    it.each(SYNCS)('unchanged: %s keeps K\'s percent when it is above David\'s (K at 60%)', (_how, sync) => {
      const iPadK60 = approve(approve(start, K, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,60', SURVEY]), L2, ['Framing,Alpha,Lot,10/20/2026,10/30/2026,70'], true);
      const merged = sync(phone50.items, iPadK60.items);
      expect(noteOf(merged)).toMatchObject({ masterPercentComplete: 60, masterProgressConfirmedBy: 'Schedule update' });
      expect(copies(deleteL2(merged, mirrorDocuments), 'Framing')).toEqual([['10/18/2026', '10/28/2026', 60]]);
    });
  });
});

/** A device's Full Sync with the cloud: the merge, then its rows that change the cloud's go up. */
function fullSync(local: ScheduleItem[], cloud: ScheduleItem[]): { device: ScheduleItem[]; cloud: ScheduleItem[] } {
  const device = recoverDAVEScheduleRecords({ local, cloud, allowCloudOnly: true });
  const uploaded = daveScheduleItemsNeedingCloudUpload({ local: device, cloud });
  const byId = new Map(cloud.map(item => [item.id, item]));
  uploaded.forEach(item => byId.set(item.id, item));
  return { device, cloud: [...byId.values()] };
}

/**
 * A6 pass 22 M1 (Medium, older): master F current on both devices. The phone
 * approves master G, which moves Framing to 10/22-11/01: a new row answers
 * to the old one (revisedFromTaskIds) and the old one is hidden. The iPad,
 * offline since before G, has David's 30% on the row it shows, the old one
 * (entered after G, or before it but not yet synced). After Full Sync both
 * devices showed Framing at 0%, Not Started; the 30% stayed on the hidden
 * old row, and Set Active G again did not bring it (the carry runs only when
 * the current schedule changes). Same at fb44926.
 */
describe('A6 p22 M1: Full Sync carries David\'s percent from the row a new master moved to the row shown', () => {
  const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
  const G = doc('MASTER G', '2026-09-14T12:00:00.000Z');
  const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,';
  const SYNC_AT = '2026-09-15T09:00:00.000Z';
  beforeEach(() => { jest.useFakeTimers({ now: Date.parse(SYNC_AT) }); });
  afterEach(() => { jest.useRealTimers(); });
  const start = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,', SURVEY]);
  const oldId = named(start, 'Framing')[0].id;
  const phoneWith = (lines: string[]) => approve(start, G, lines);
  const phone = phoneWith(['Framing,Alpha,Lot,10/22/2026,11/01/2026,', SURVEY]);
  const newId = named(phone, 'Framing')[0].id;
  const documents = phone.documents;
  const ENTRIES = [['after the phone approved G', '2026-09-14T14:00:00.000Z'], ['before G, not yet synced', '2026-09-14T10:00:00.000Z']] as const;
  const shownOf = (items: ScheduleItem[]) => copies({ items, documents }, 'Framing');

  it('the copies: G\'s new row answers to the old one; the iPad\'s 30% is on the old row', () => {
    expect(newId).not.toBe(oldId);
    expect(phone.items.find(item => item.id === newId)!.revisedFromTaskIds).toEqual([oldId]);
    expect(copies(record(start, oldId, 30, ENTRIES[0][1]), 'Framing')).toEqual([['10/15/2026', '10/25/2026', 30]]);
  });

  it.each(ENTRIES.flatMap(([when, at]) => SYNCS.map(([how, sync]) => [`${when}, ${how}`, at, sync] as const)))('%s: G\'s row shows David\'s 30%', (_how, at, sync) => {
    const merged = sync(phone.items, record(start, oldId, 30, at).items);
    expect(shownOf(merged)).toEqual([['10/22/2026', '11/01/2026', 30]]);
    expect(merged.find(item => item.id === newId)).toMatchObject({
      status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: at,
    });
  });

  it.each([['the iPad syncs first', 'ipad'], ['the phone syncs first', 'phone']] as const)('%s: both devices and the cloud show 30%, and syncing again changes nothing', (_how, first) => {
    const iPad = record(start, oldId, 30, ENTRIES[0][1]);
    // The phone is online: its G is in the cloud before either Full Sync.
    let cloud = phone.items;
    let phoneItems = phone.items;
    let iPadItems = iPad.items;
    const round = () => {
      (first === 'ipad' ? ['ipad', 'phone'] : ['phone', 'ipad']).forEach(device => {
        const synced = fullSync(device === 'ipad' ? iPadItems : phoneItems, cloud);
        cloud = synced.cloud;
        if (device === 'ipad') iPadItems = synced.device; else phoneItems = synced.device;
      });
    };
    round();
    round();
    expect(shownOf(phoneItems)).toEqual([['10/22/2026', '11/01/2026', 30]]);
    expect(shownOf(iPadItems)).toEqual([['10/22/2026', '11/01/2026', 30]]);
    expect(shownOf(cloud)).toEqual([['10/22/2026', '11/01/2026', 30]]);
    const settled = { phone: phoneItems, iPad: iPadItems, cloud };
    round();
    expect({ phone: phoneItems, iPad: iPadItems, cloud }).toEqual(settled);
    expect(fullSync(phoneItems, cloud).device).toEqual(phoneItems);
  });

  it('unchanged: David\'s later percent on G\'s row stays', () => {
    const phone50 = record(phone, newId, 50, '2026-09-14T16:00:00.000Z');
    SYNCS.forEach(([, sync]) => expect(shownOf(sync(phone50.items, record(start, oldId, 30, ENTRIES[0][1]).items))).toEqual([['10/22/2026', '11/01/2026', 50]]));
  });

  it('unchanged: a higher percent G states is never lowered', () => {
    const phone60 = phoneWith(['Framing,Alpha,Lot,10/22/2026,11/01/2026,60', SURVEY]);
    SYNCS.forEach(([, sync]) => expect(shownOf(sync(phone60.items, record(start, oldId, 30, ENTRIES[0][1]).items))).toEqual([['10/22/2026', '11/01/2026', 60]]));
  });

  it('as on one device: a percent G stated above David\'s, then lowered by a lookahead on the phone, is floored at David\'s', () => {
    // David's 70% on the iPad before G; G states 80% (above it), then lookahead L lowers G's row to 40%.
    // Changed deliberately (A5 recorded Low R-c, cab99c0, 1 Oct 2026): one device now keeps David's 70% under G's
    // 80% (managersPercentUnderFile) and floors L's 40% at it (owner answer Q22), so it shows 70%, and Full Sync
    // either way now agrees (DAVEScheduleRecovery, withManagersPercentUnderFile). It was 40% everywhere before.
    const L = doc('LOOKAHEAD L', '2026-09-14T18:00:00.000Z', 'lookahead');
    const phoneL = approve(phoneWith(['Framing,Alpha,Lot,10/22/2026,11/01/2026,80', SURVEY]), L, ['Framing,Alpha,Lot,10/24/2026,11/03/2026,40'], true);
    const iPad70 = record(start, oldId, 70, ENTRIES[1][1]);
    let oneDevice = record(start, oldId, 70, ENTRIES[1][1]);
    oneDevice = approve(approve(oneDevice, G, ['Framing,Alpha,Lot,10/22/2026,11/01/2026,80', SURVEY]), L, ['Framing,Alpha,Lot,10/24/2026,11/03/2026,40'], true);
    expect(copies(oneDevice, 'Framing')).toEqual([['10/24/2026', '11/03/2026', 70]]);
    SYNCS.forEach(([, sync]) => expect(copies({ items: sync(phoneL.items, iPad70.items), documents: phoneL.documents }, 'Framing'))
      .toEqual([['10/24/2026', '11/03/2026', 70]]));
  });

  it('unchanged: a newer lookahead\'s percent on G\'s row still restates it', () => {
    const L = doc('LOOKAHEAD L', '2026-09-14T18:00:00.000Z', 'lookahead');
    const phoneL = approve(phone, L, ['Framing,Alpha,Lot,10/24/2026,11/03/2026,60'], true);
    SYNCS.forEach(([, sync]) => expect(copies({ items: sync(phoneL.items, record(start, oldId, 30, ENTRIES[0][1]).items), documents: phoneL.documents }, 'Framing'))
      .toEqual([['10/24/2026', '11/03/2026', 60]]));
  });
});

/**
 * A6 pass 22 L1 (older; the gap R2, ba4c2cf, left): Full Sync merged two
 * copies' lookahead notes without weighing David's percent on the other
 * copy's task itself. (a) No master: David's 40%, then lookahead L1; the
 * phone records 60% (16 Sep); the offline iPad approves L2 at 70% (17 Sep),
 * its note taking its own 40%. After Full Sync, deleting L2 gave 40% ("moved
 * from 70% to 40% complete"), not David's 60%. (b) The same with master G on
 * the phone marking L1, David's 50% on the iPad (15 Sep) and 60% on the
 * phone after G (16 Sep): 40%, below both. Same at fb44926.
 */
describe('A6 p22 L1: after Full Sync, deleting a lookahead gives David\'s latest percent from either copy', () => {
  const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
  const L1 = doc('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');
  const G = doc('MASTER G', '2026-09-14T12:00:00.000Z');
  const L2 = doc('LOOKAHEAD L2', '2026-09-17T12:00:00.000Z', 'lookahead');
  const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,';
  let start = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,', SURVEY]);
  const framingId = named(start, 'Framing')[0].id;
  start = record(start, framingId, 40, '2026-09-08T10:00:00.000Z');
  start = approve(start, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
  const noteOf = (items: ScheduleItem[]) => items.find(item => item.id === framingId)!.lookaheadOverlay!;
  const deleteL2 = (items: ScheduleItem[], documents: ReferenceDocument[]) => deleteWithItems({ items, documents }, L2, '2026-09-18T10:00:00.000Z');
  const L2_ROW = 'Framing,Alpha,Lot,10/20/2026,10/30/2026,70';

  describe('(a) no master', () => {
    const phone = record(start, framingId, 60, '2026-09-16T10:00:00.000Z');
    const iPad = approve(start, L2, [L2_ROW], true);
    const documents = [...start.documents, L2];

    it.each(SYNCS)('%s: the note takes the phone\'s 60%; deleting L2 gives 60%', (_how, sync) => {
      const merged = sync(phone.items, iPad.items);
      expect(copies({ items: merged, documents }, 'Framing')).toEqual([['10/20/2026', '10/30/2026', 70]]);
      expect(noteOf(merged)).toMatchObject({ masterPercentComplete: 60, masterProgressConfirmedBy: 'David', masterProgressConfirmedAt: '2026-09-16T10:00:00.000Z' });
      expect(copies(deleteL2(merged, documents), 'Framing')).toEqual([['10/18/2026', '10/28/2026', 60]]);
    });

    it('both devices and the cloud agree after a sync round, and another round changes nothing', () => {
      let cloud = phone.items;
      const iPadSync = fullSync(iPad.items, cloud);
      cloud = iPadSync.cloud;
      const phoneSync = fullSync(phone.items, cloud);
      cloud = phoneSync.cloud;
      expect(noteOf(phoneSync.device)).toMatchObject({ masterPercentComplete: 60 });
      expect(noteOf(cloud)).toMatchObject({ masterPercentComplete: 60 });
      expect(fullSync(iPadSync.device, cloud).device).toEqual(fullSync(phoneSync.device, cloud).device);
      expect(fullSync(phoneSync.device, cloud)).toEqual({ device: phoneSync.device, cloud });
    });

    it('the iPad\'s copy reached the cloud first: after the phone\'s Full Sync and then the iPad\'s, both end with 60%', () => {
      const phoneSync = fullSync(phone.items, iPad.items);
      expect(noteOf(phoneSync.device)).toMatchObject({ masterPercentComplete: 60 });
      // The iPad's own copy is as new as the cloud's: the cloud's note, which took David's 60%, still counts.
      const iPadSync = fullSync(iPad.items, phoneSync.cloud);
      expect(noteOf(iPadSync.device)).toMatchObject({ masterPercentComplete: 60, masterProgressConfirmedAt: '2026-09-16T10:00:00.000Z' });
      expect(noteOf(iPadSync.cloud)).toMatchObject({ masterPercentComplete: 60 });
      expect(fullSync(phoneSync.device, iPadSync.cloud).device.find(item => item.id === framingId))
        .toEqual(iPadSync.device.find(item => item.id === framingId));
    });

    it.each(SYNCS)('unchanged: %s with the phone\'s percent entered after L2 keeps it on the task', (_how, sync) => {
      const later = record(start, framingId, 60, '2026-09-17T18:00:00.000Z');
      const merged = sync(later.items, iPad.items);
      expect(copies(deleteL2(merged, documents), 'Framing')).toEqual([['10/18/2026', '10/28/2026', 60]]);
    });

    it.each(SYNCS)('unchanged: %s with no percent of David\'s since gives back 40%', (_how, sync) => {
      const merged = sync(start.items, iPad.items);
      expect(copies(deleteL2(merged, documents), 'Framing')).toEqual([['10/18/2026', '10/28/2026', 40]]);
    });
  });

  it.each(SYNCS)('unchanged: %s keeps a master\'s percent with no time of its own over a lower one of David\'s on the other copy\'s note', (_how, sync) => {
    // No percent of David's before L1. The iPad: David's 30% (15 Sep), then L2. The phone, later: master M at 80% on
    // L1's dates (the file's percent, with no time), then David's 85% there (the phone's copy is the newer row).
    let common = approve(EMPTY, F, ['Framing,Alpha,Lot,10/15/2026,10/25/2026,', SURVEY]);
    common = approve(common, L1, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,'], true);
    const iPad = approve(record(common, framingId, 30, '2026-09-15T10:00:00.000Z'), L2, [L2_ROW], true);
    const phone = record(approve(common, doc('MASTER M', '2026-09-18T12:00:00.000Z'), ['Framing,Alpha,Lot,10/18/2026,10/28/2026,80', SURVEY]),
      framingId, 85, '2026-09-19T10:00:00.000Z');
    expect(noteOf(phone.items)).toMatchObject({ masterPercentComplete: 80, masterProgressSource: null });
    expect(noteOf(phone.items).masterProgressConfirmedAt ?? null).toBeNull();
    expect(noteOf(iPad.items)).toMatchObject({ masterPercentComplete: 30, masterProgressConfirmedBy: 'David' });
    expect(noteOf(sync(phone.items, iPad.items))).toMatchObject({ masterPercentComplete: 80 });
  });

  describe('(b) with master G on the phone', () => {
    const phone = record(approve(start, G, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,', SURVEY]), framingId, 60, '2026-09-16T10:00:00.000Z');
    const iPad = approve(record(start, framingId, 50, '2026-09-15T10:00:00.000Z'), L2, [L2_ROW], true);
    const documents = [...phone.documents, L2];

    it.each(SYNCS)('%s keeps G\'s dates and marks with David\'s 60%; deleting L2 gives 60%', (_how, sync) => {
      const merged = sync(phone.items, iPad.items);
      expect(noteOf(merged)).toMatchObject({ masterStartDate: '10/18/2026', masterPercentComplete: 60, masterProgressConfirmedAt: '2026-09-16T10:00:00.000Z' });
      expect(noteOf(merged).lookaheads.map(entry => entry.datesReplacedByMaster)).toEqual(['batch-MASTER G', undefined]);
      expect(copies(deleteL2(merged, documents), 'Framing')).toEqual([['10/18/2026', '10/28/2026', 60]]);
    });

    it.each(SYNCS)('%s with G at 45% (A5 p22 L2): 60%', (_how, sync) => {
      const phone45 = record(approve(start, G, ['Framing,Alpha,Lot,10/18/2026,10/28/2026,45', SURVEY]), framingId, 60, '2026-09-16T10:00:00.000Z');
      expect(copies(deleteL2(sync(phone45.items, iPad.items), documents), 'Framing')).toEqual([['10/18/2026', '10/28/2026', 60]]);
    });
  });
});
