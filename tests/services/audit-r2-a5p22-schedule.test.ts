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
