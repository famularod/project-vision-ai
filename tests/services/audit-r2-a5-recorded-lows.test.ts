/**
 * Audit round 2, A5 recorded Lows (1 Oct 2026): three Low findings in the
 * schedule merge recorded during earlier passes and not fixed then.
 *
 * Owner answer Q22: a lookahead adds to the master, and file progress never
 * goes below what David entered. A newer master's dates replace older
 * lookahead dates; a lookahead newer than the master restates the task, its
 * percent floored at David's own.
 *
 * Real CSV normalizer, the phone's merge, Set Active, Delete PDF + Items, its
 * question and shown-task pick, and the web's upload plan, delete plan and
 * Make Current carry. Synthetic data.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import type { ReferenceDocument, ScheduleItem } from '../../types';
import { planDAVEWebScheduleDocumentDelete, planDAVEWebScheduleImport, prepareDAVEWebDocumentUpload } from '../../services/DAVEWebOperations';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation, scheduleProgressCarriedToShownTasks,
} from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted, scheduleLookaheadDeleteNote } from '../../services/ScheduleLookahead';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { buildDAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

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
/** The question Delete PDF + Items asks on the phone, with the schedules saved now. */
const deleteQuestion = (state: State, target: ReferenceDocument) =>
  scheduleLookaheadDeleteNote(state.items, state.documents.find(saved => saved.id === target.id)!, [], state.documents);

type Activate = (state: State, target: ReferenceDocument, at: string) => State;
const HOWS: ReadonlyArray<readonly [string, Activate]> = [['phone Set Active', setActive], ['web Make Current', makeCurrent]];

const SURVEY = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,';
const framing = (start: string, finish: string) => `Framing,Alpha,Lot,${start},${finish},`;
const F_ROW = framing('10/15/2026', '10/25/2026');
const L1_ROW = framing('10/18/2026', '10/28/2026');
const L2_ROW = framing('10/20/2026', '10/30/2026');
const L3_ROW = framing('10/22/2026', '11/01/2026');
const L1_DATES = ['10/18/2026', '10/28/2026', 0];
const L2_DATES = ['10/20/2026', '10/30/2026', 0];
const L3_DATES = ['10/22/2026', '11/01/2026', 0];

/**
 * R-a (Low, from the A5 pass 22 fixer): A5 pass 22 L1 made Set Active and
 * Make Current read a mark naming a master no longer saved as replacing
 * nothing; the lookahead delete still read it as "replaced". Master H listed
 * Framing on lookahead L2's 10/20 and marked the lookaheads; H was deleted
 * and F made current, so Framing rightly showed L2's dates. Deleting a
 * lookahead then fell back past the lookaheads H had marked, onto dates no
 * schedule in effect gives (at b184017).
 */
describe('R-a: the lookahead delete reads a deleted master\'s marks as Set Active and Make Current do', () => {
  const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
  const L1 = doc('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');

  describe('G copied L1, H copied L2 and was deleted, F current; deleting a later L3 gives L2\'s 10/20, not L1\'s', () => {
    const G = doc('MASTER G', '2026-09-11T12:00:00.000Z');
    const L2 = doc('LOOKAHEAD L2', '2026-09-13T12:00:00.000Z', 'lookahead');
    const H = doc('MASTER H', '2026-09-15T12:00:00.000Z');
    const L3 = doc('LOOKAHEAD L3', '2026-09-17T12:00:00.000Z', 'lookahead');
    const onL3 = (activate: Activate) => {
      let state = approve(EMPTY, F, [F_ROW, SURVEY]);
      state = approve(state, L1, [L1_ROW], true);
      state = approve(state, G, [L1_ROW, SURVEY]);
      state = approve(state, L2, [L2_ROW], true);
      state = deleteWithItems(approve(state, H, [L2_ROW, SURVEY]), H, '2026-09-16T10:00:00.000Z');
      state = activate(state, F, '2026-09-16T11:00:00.000Z');
      expect(copies(state, 'Framing')).toEqual([L2_DATES]);
      return approve(state, L3, [L3_ROW], true);
    };

    it.each(HOWS)('H deleted on the phone, %s of F, L3 deleted: L2\'s 10/20-10/30', (_how, activate) => {
      const state = onL3(activate);
      expect(copies(state, 'Framing')).toEqual([L3_DATES]);
      expect(deleteQuestion(state, L3)).toBe(' Delete PDF + Items also puts back the earlier dates of 1 task this lookahead changed.');
      expect(copies(deleteWithItems(state, L3, '2026-09-18T10:00:00.000Z'), 'Framing')).toEqual([L2_DATES]);
    });
  });

  describe('H copied L2 and was deleted, F current; deleting L2 gives L1\'s 10/18, not H\'s 10/20', () => {
    const L2 = doc('LOOKAHEAD L2', '2026-09-11T12:00:00.000Z', 'lookahead');
    const H = doc('MASTER H', '2026-09-15T12:00:00.000Z');
    const onL2 = () => {
      const state = approve(EMPTY, F, [F_ROW, SURVEY]);
      return approve(approve(state, L1, [L1_ROW], true), L2, [L2_ROW], true);
    };

    it.each(HOWS)('H approved and deleted on the phone, %s of F, L2 deleted: L1\'s 10/18-10/28', (_how, activate) => {
      let state = deleteWithItems(approve(onL2(), H, [L2_ROW, SURVEY]), H, '2026-09-16T10:00:00.000Z');
      state = activate(state, F, '2026-09-16T11:00:00.000Z');
      expect(copies(state, 'Framing')).toEqual([L2_DATES]);
      expect(deleteQuestion(state, L2)).toBe(' Delete PDF + Items also puts back the earlier dates of 1 task this lookahead changed.');
      expect(copies(deleteWithItems(state, L2, '2026-09-18T10:00:00.000Z'), 'Framing')).toEqual([L1_DATES]);
    });

    it.each([['on the web', webDelete], ['on the phone', deleteWithItems]] as const)(
      'H uploaded on the web and deleted %s before Make Current, L2 deleted: L1\'s 10/18-10/28',
      (_how, remove) => {
        const up = upload(onL2(), 'alpha-master-h.csv', [L2_ROW, SURVEY], H.importedAt as string);
        // Unchanged before H's delete: H, not current, leaves L1's dates in effect (A5 pass 20 P1).
        expect(copies(deleteWithItems(up.state, L2, '2026-09-16T09:00:00.000Z'), 'Framing')).toEqual([L1_DATES]);
        const state = remove(up.state, up.document, '2026-09-16T10:00:00.000Z');
        expect(copies(state, 'Framing')).toEqual([L2_DATES]);
        expect(copies(deleteWithItems(state, L2, '2026-09-18T10:00:00.000Z'), 'Framing')).toEqual([L1_DATES]);
      },
    );
  });

  it('unchanged: under a current master newer than the lookahead, a deleted master\'s mark reads as before (that master\'s dates)', () => {
    // G copies L1 and is deleted while current; F again; L2; H copies L2 (L1 keeps G's mark); L2 deleted under H.
    const G = doc('MASTER G', '2026-09-11T12:00:00.000Z');
    const L2 = doc('LOOKAHEAD L2', '2026-09-13T12:00:00.000Z', 'lookahead');
    const H = doc('MASTER H', '2026-09-15T12:00:00.000Z');
    let state = approve(EMPTY, F, [F_ROW, SURVEY]);
    state = approve(approve(state, L1, [L1_ROW], true), G, [L1_ROW, SURVEY]);
    state = setActive(deleteWithItems(state, G, '2026-09-12T10:00:00.000Z'), F, '2026-09-12T10:01:00.000Z');
    state = approve(approve(state, L2, [L2_ROW], true), H, [L2_ROW, SURVEY]);
    expect(copies(deleteWithItems(state, L2, '2026-09-16T10:00:00.000Z'), 'Framing')).toEqual([L2_DATES]);
  });

  it('unchanged: a saved master\'s mark still replaces while that master is current (A6 pass 19 M1)', () => {
    const L2 = doc('LOOKAHEAD L2', '2026-09-11T12:00:00.000Z', 'lookahead');
    const G = doc('MASTER G', '2026-09-13T12:00:00.000Z');
    let state = approve(EMPTY, F, [F_ROW, SURVEY]);
    state = approve(approve(approve(state, L1, [L1_ROW], true), L2, [L2_ROW], true), G, [L2_ROW, SURVEY]);
    expect(copies(deleteWithItems(state, L2, '2026-09-14T10:00:00.000Z'), 'Framing')).toEqual([L2_DATES]);
  });
});

/**
 * R-b (Low, the b98824e remainder; right at c73ceab): master F, lookaheads L1
 * (10/18) and L2 (10/20), master G listing Framing on L2's dates (it marks the
 * lookaheads replaced). With F current again (Set Active), deleting L2 rightly
 * gives L1's 10/18 (L1 is newer than F, G not current). A newer master H
 * listing G's 10/20 then read as "no change": the row matched the note's
 * master dates, G's, while the task showed L1's, so Framing stayed on 10/18
 * though H is newer than L1 (Q22: a newer master's dates replace older
 * lookahead dates).
 */
describe('R-b: a newer master listing the noted dates while the task shows a lookahead\'s they replaced is not a repeat', () => {
  const F = doc('MASTER F', '2026-09-07T12:00:00.000Z');
  const L1 = doc('LOOKAHEAD L1', '2026-09-09T12:00:00.000Z', 'lookahead');
  const L2 = doc('LOOKAHEAD L2', '2026-09-11T12:00:00.000Z', 'lookahead');
  const G = doc('MASTER G', '2026-09-13T12:00:00.000Z');
  const H = doc('MASTER H', '2026-09-16T12:00:00.000Z');
  const AT = '2026-09-17T10:00:00.000Z';

  describe('a task an import owns', () => {
    /** F, L1, L2, G on L2's dates; F current again, L2 deleted: L1's 10/18. */
    const underF = () => {
      let state = approve(EMPTY, F, [F_ROW, SURVEY]);
      state = approve(approve(state, L1, [L1_ROW], true), L2, [L2_ROW], true);
      state = setActive(approve(state, G, [L2_ROW, SURVEY]), F, '2026-09-14T10:00:00.000Z');
      state = deleteWithItems(state, L2, '2026-09-15T10:00:00.000Z');
      expect(copies(state, 'Framing')).toEqual([L1_DATES]);
      return state;
    };

    it('approved on the phone, H on G\'s 10/20 gives 10/20-10/30; deleting L1 after keeps it', () => {
      const state = approve(underF(), H, [L2_ROW, SURVEY]);
      expect(copies(state, 'Framing')).toEqual([L2_DATES]);
      expect(copies(deleteWithItems(state, L1, '2026-09-18T10:00:00.000Z'), 'Framing')).toEqual([L2_DATES]);
    });

    it.each(HOWS)('unchanged: uploaded on the web, H leaves 10/18 until it is current; then %s of H gives 10/20', (_how, activate) => {
      const up = upload(underF(), 'alpha-master-h.csv', [L2_ROW, SURVEY], H.importedAt as string);
      expect(copies(up.state, 'Framing')).toEqual([L1_DATES]);
      expect(copies(activate(up.state, up.document, AT), 'Framing')).toEqual([L2_DATES]);
    });

    it('unchanged: a newer master repeating the master\'s dates from before an unmarked lookahead leaves the lookahead\'s (Q22)', () => {
      const state = approve(approve(EMPTY, F, [F_ROW, SURVEY]), L1, [L1_ROW], true);
      expect(copies(approve(state, H, [F_ROW, SURVEY]), 'Framing')).toEqual([L1_DATES]);
    });

    it('unchanged: a newer master repeating G where G copied the lookahead the task shows changes nothing', () => {
      let state = approve(approve(EMPTY, F, [F_ROW, SURVEY]), L1, [L1_ROW], true);
      state = approve(approve(state, G, [L1_ROW, SURVEY]), H, [L1_ROW, SURVEY]);
      expect(copies(state, 'Framing')).toEqual([L1_DATES]);
    });
  });

  describe('a task David entered by hand', () => {
    const hand = buildDAVEWebScheduleItem({
      id: 'hand-pour', now: '2026-09-06T15:00:00.000Z', actor: 'David',
      draft: {
        itemType: 'Task', taskName: 'Pour slab', projectName: 'Alpha', projectId: 'alpha', locationName: 'Lot',
        startDate: '10/01/2026', finishDate: '10/05/2026', milestone: '', owner: 'Crew A', contractor: '', percentComplete: '40',
        priority: 'Medium', status: 'In Progress', notes: 'Pump booked', nextAction: '', activityMessage: '',
      },
    }) as unknown as ScheduleItem;
    const pour = (start: string, finish: string) => `Pour slab,Alpha,Lot,${start},${finish},`;
    /** F on David's dates, L1 (10/03), L2 (10/05), G on L2's dates; F current again, L2 deleted: L1's 10/03. */
    const underF = () => {
      let state = approve({ items: [hand], documents: [] }, F, [pour('10/01/2026', '10/05/2026'), SURVEY]);
      state = approve(approve(state, L1, [pour('10/03/2026', '10/07/2026')], true), L2, [pour('10/05/2026', '10/09/2026')], true);
      state = setActive(approve(state, G, [pour('10/05/2026', '10/09/2026'), SURVEY]), F, '2026-09-14T10:00:00.000Z');
      state = deleteWithItems(state, L2, '2026-09-15T10:00:00.000Z');
      expect(copies(state, 'Pour slab')).toEqual([['10/03/2026', '10/07/2026', 40]]);
      return state;
    };

    it('approved on the phone, H on G\'s 10/05 restates it there, in place, with David\'s 40%', () => {
      const state = approve(underF(), H, [pour('10/05/2026', '10/09/2026'), SURVEY]);
      expect(copies(state, 'Pour slab')).toEqual([['10/05/2026', '10/09/2026', 40]]);
      expect(named(state, 'Pour slab')[0]).toMatchObject({ id: 'hand-pour', owner: 'Crew A', notes: 'Pump booked' });
    });

    it.each(HOWS)('uploaded on the web, then %s of H: 10/05-10/09 with David\'s 40%', (_how, activate) => {
      const up = upload(underF(), 'alpha-master-h.csv', [pour('10/05/2026', '10/09/2026'), SURVEY], H.importedAt as string);
      expect(copies(up.state, 'Pour slab')).toEqual([['10/03/2026', '10/07/2026', 40]]);
      expect(copies(activate(up.state, up.document, AT), 'Pour slab')).toEqual([['10/05/2026', '10/09/2026', 40]]);
    });
  });
});
