/**
 * Owner answer Q30 (David, 2 Oct 2026): "YES, repeated task names within an
 * area. The import review asks him to confirm instead of guessing."
 *
 * Two tasks named Pour slab in Lot paired with the file's rows by one rule
 * per schedule role (whole-app audit A5 passes 17-18): a master keeps their
 * order, a lookahead takes the nearest days. Some changes look identical by
 * dates alone: "every date slipped one week" and "the first was dropped and
 * a new one added". Now, when the readings disagree, the review asks
 * (scheduleImportPairingQuestions) with the app's guess pre-selected, and
 * David's answer decides the pairing: his percent, notes and field-report
 * links follow it, also when he switches masters back and forth. Rows that
 * carry Microsoft Project's Unique ID pair by it and are never asked about;
 * nor are unchanged twins, a small slip every reading agrees on, or one row
 * and one task. Real CSV and Microsoft Project normalizers, the phone's merge
 * and activation carry, the shown-schedule pick and the report links.
 * Synthetic data.
 */
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { normalizeMicrosoftProjectPdfRows, normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleImportPairingQuestions,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedOnActivation,
} from '../../services/ScheduleImportMerge';
import { scheduleTaskLinks } from '../../services/ScheduleTaskRevisions';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
/** Each Pour slab shown: start day, percent, note, by start day. */
const pours = (state: State) => shown(state).filter(item => item.taskName === 'Pour slab')
  .map(item => `${item.startDate} ${item.percentComplete}%${item.notes ? ` ${item.notes}` : ''}`).sort();

const schedule = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
function rows(source: ReferenceDocument, lines: string[], header = 'Task,Project,Area,Start,Finish,Percent Complete'): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [header, ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
/** The review's question, then the approval with David's answers (App.tsx passes them to the merge). */
function review(state: State, source: ReferenceDocument, imported: ScheduleItem[]) {
  return scheduleImportPairingQuestions({ existing: shown(state), imported, overlay: source.scheduleRole === 'lookahead' });
}
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[], pairingChoices?: Record<string, string | null>): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: source.scheduleRole === 'lookahead', pairingChoices,
  });
  return {
    items: [...merged.additions, ...merged.next],
    documents: source.scheduleRole === 'lookahead' ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
function record(state: State, id: string, percentComplete: number, notes: string, at: string): State {
  return {
    ...state,
    items: state.items.map(item => item.id === id ? {
      ...item, percentComplete, notes, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at,
      progressConfirmedBy: 'David', updatedAt: at,
    } as ScheduleItem : item),
  };
}
function setActive(state: State, source: ReferenceDocument, at: string): State {
  const documentsAfter = scheduleDocumentsAfterActivation(state.documents.find(document => document.id === source.id)!, state.documents, 'project', at);
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now: at })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}
const report = (scheduleItemId: string): ProjectUpdate => ({
  id: `u-${scheduleItemId}`, projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-10-08T16:00:00.000Z', photos: [],
  recipients: { contactIds: [] }, notes: 'First pour finished.', scheduleItemId, scheduleTaskName: 'Pour slab', selectedAreaName: 'Lot',
}) as ProjectUpdate;
const linkedStart = (state: State, update: ProjectUpdate) => scheduleTaskLinks(shown(state), state.items)(update)?.item.startDate ?? null;

const F = schedule('MASTER F', '2026-09-20T12:00:00.000Z');
const G = schedule('MASTER G', '2026-10-01T12:00:00.000Z');
const FIRST = 'Pour slab,Alpha,Lot,10/05/2026,10/09/2026,';
const SECOND = 'Pour slab,Alpha,Lot,10/12/2026,10/16/2026,';
const THIRD = 'Pour slab,Alpha,Lot,10/19/2026,10/23/2026,';
const FRAMING = 'Framing,Alpha,Lot,10/26/2026,10/30/2026,';
const onF = approve(EMPTY, F, rows(F, [FIRST, SECOND, FRAMING]));
const firstId = shown(onF).find(item => item.startDate === '10/05/2026')!.id;
const secondId = shown(onF).find(item => item.startDate === '10/12/2026')!.id;
// David's 80% and note on the first pour, and a field report on it.
const withDavid = record(onF, firstId, 80, 'Forms stripped', '2026-10-06T15:00:00.000Z');

describe('Q30: a master the dates cannot settle: the review asks, and his answer decides', () => {
  const gRows = rows(G, [SECOND, THIRD, FRAMING]);
  const [question] = review(withDavid, G, gRows);
  const rowOn = (start: string) => gRows.find(row => row.startDate === start)!.id;

  it('asks once, about Pour slab in Lot, listing his saved tasks beside the rows, the slip pre-selected', () => {
    expect(review(withDavid, G, gRows)).toHaveLength(1);
    expect(question.title).toBe('2 tasks named Pour slab in Lot — confirm which is which');
    expect(question.saved.map(item => `${item.startDate} ${item.percentComplete}% ${item.notes}`))
      .toEqual(['10/05/2026 80% Forms stripped', '10/12/2026 0% ']);
    expect(question.rows.map(row => row.startDate)).toEqual(['10/12/2026', '10/19/2026']);
    // The app's best guess (the master rule: the slip) is what the review pre-selects.
    expect(question.guess).toEqual({ [rowOn('10/12/2026')]: firstId, [rowOn('10/19/2026')]: secondId });
  });

  it('"every date slipped one week": his 80%, note and report go to 10/12', () => {
    const state = approve(withDavid, G, gRows, question.guess as Record<string, string | null>);
    expect(pours(state)).toEqual(['10/12/2026 80% Forms stripped', '10/19/2026 0%']);
    expect(linkedStart(state, report(firstId))).toBe('10/12/2026');
  });

  it('"the first was dropped and a new one added": the 10/12 task is the second, 10/19 is new, and his 80% leaves with the first', () => {
    const choices = { [rowOn('10/12/2026')]: secondId, [rowOn('10/19/2026')]: null };
    const state = approve(withDavid, G, gRows, choices);
    expect(pours(state)).toEqual(['10/12/2026 0%', '10/19/2026 0%']);
    expect(shown(state).find(item => item.startDate === '10/12/2026')!.id).toBe(secondId);
    // The first pour's report no longer lands on another pour.
    expect(linkedStart(state, report(firstId))).not.toBe('10/12/2026');
    // His answer holds when he switches back to F and forward to G.
    const back = setActive(state, F, '2026-10-02T12:00:00.000Z');
    expect(pours(back)).toEqual(['10/05/2026 80% Forms stripped', '10/12/2026 0%']);
    const forward = setActive(back, G, '2026-10-03T12:00:00.000Z');
    expect(pours(forward)).toEqual(['10/12/2026 0%', '10/19/2026 0%']);
  });

  it('a row he says is new never takes a saved task by the import identity', () => {
    const repeat = rows(G, [FIRST, SECOND, FRAMING]);
    const choices = { [repeat[0].id]: null, [repeat[1].id]: secondId };
    const state = approve(withDavid, G, repeat, choices);
    const firstPours = shown(state).filter(item => item.taskName === 'Pour slab' && item.startDate === '10/05/2026');
    expect(firstPours.map(item => item.percentComplete)).toEqual([0]);
  });
});

describe('Q30: his answer holds when the masters switch, though their counts differ', () => {
  it('a slip with a pour added: back to F, his newer percent on the moved row returns to the first pour', () => {
    const gRows = rows(G, [SECOND, THIRD, 'Pour slab,Alpha,Lot,10/26/2026,10/30/2026,', FRAMING]);
    const [question] = review(withDavid, G, gRows);
    const rowOn = (start: string) => gRows.find(row => row.startDate === start)!.id;
    // The slip: 10/12 is the first pour, 10/19 the second, 10/26 new.
    const onG = approve(withDavid, G, gRows, { [rowOn('10/12/2026')]: firstId, [rowOn('10/19/2026')]: secondId, [rowOn('10/26/2026')]: null });
    expect(question.saved.map(item => item.id)).toEqual([firstId, secondId]);
    const moved = shown(onG).find(item => item.notes === 'Forms stripped')!;
    expect(moved.startDate).toBe('10/12/2026');
    const later = record(onG, moved.id, 90, 'Forms stripped', '2026-10-07T15:00:00.000Z');
    // Set Active F: F's first pour (10/05) takes his 90%, not the second pour now on 10/12's days.
    const back = setActive(later, F, '2026-10-08T12:00:00.000Z');
    expect(pours(back)).toEqual(['10/05/2026 90% Forms stripped', '10/12/2026 0%']);
  });
});

describe('Q30: unambiguous pairings never ask', () => {
  it('unchanged twins, in any order', () => {
    expect(review(withDavid, G, rows(G, [SECOND, FIRST, FRAMING]))).toEqual([]);
  });

  it('a slip every reading agrees on (two days)', () => {
    expect(review(withDavid, G, rows(G, [
      'Pour slab,Alpha,Lot,10/07/2026,10/11/2026,', 'Pour slab,Alpha,Lot,10/14/2026,10/18/2026,', FRAMING,
    ]))).toEqual([]);
  });

  it('one row and one task, and same names in different areas', () => {
    const single = approve(EMPTY, F, rows(F, [FIRST, FRAMING]));
    expect(review(single, G, rows(G, [SECOND, FRAMING]))).toEqual([]);
    const areas = approve(EMPTY, F, rows(F, [FIRST, 'Pour slab,Alpha,Pad,10/12/2026,10/16/2026,']));
    expect(review(areas, G, rows(G, [SECOND, 'Pour slab,Alpha,Pad,10/19/2026,10/23/2026,']))).toEqual([]);
  });

  it('Microsoft Project rows with a Unique ID pair by it, without a question, even where dates read the other way', () => {
    const msp = (source: ReferenceDocument, lines: Array<[uid: string, start: string, finish: string]>) =>
      (normalizeMicrosoftProjectPdfRows({
        contents: ['ID\tUnique ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete',
          '1\t100\tALPHA\t0\t30 days\tThu 10/1/26\tFri 10/30/26\t0%',
          ...lines.map(([uid, start, finish], index) => [index + 2, uid, 'Pour slab', 1, '5 days', start, finish, '0%'].join('\t'))].join('\n'),
        sourceName: `${source.id}.pdf`, projects: ['Alpha'], now: new Date(source.importedAt),
      }) as ScheduleItem[]).map((item, index) => ({ ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
    const fRows = msp(F, [['7', 'Mon 10/5/26', 'Fri 10/9/26'], ['9', 'Mon 10/12/26', 'Fri 10/16/26']]);
    expect(fRows.map(row => row.sourceUniqueId)).toEqual(['7', '9']);
    const mspF = approve(EMPTY, F, fRows);
    const seven = mspF.items.find(item => item.sourceUniqueId === '7')!;
    const nine = mspF.items.find(item => item.sourceUniqueId === '9')!;
    const david = record(record(mspF, seven.id, 80, '', '2026-10-06T15:00:00.000Z'), nine.id, 50, '', '2026-10-06T15:05:00.000Z');
    // UID 7 dropped, 9 kept on its days, 11 added: dates alone read it as a slip; the Unique IDs say otherwise.
    const gRows = msp(G, [['9', 'Mon 10/12/26', 'Fri 10/16/26'], ['11', 'Mon 10/19/26', 'Fri 10/23/26']]);
    expect(review(david, G, gRows)).toEqual([]);
    const state = approve(david, G, gRows);
    expect(shown(state).filter(item => item.taskName === 'Pour slab').map(item => `${item.sourceUniqueId} ${item.startDate} ${item.percentComplete}%`).sort())
      .toEqual(['11 10/19/2026 0%', '9 10/12/2026 50%']);
  });
});

describe('Q30: a lookahead the dates cannot settle asks too', () => {
  const L = schedule('Alpha lookahead wk 41', '2026-10-03T12:00:00.000Z', 'lookahead');
  const lRows = rows(L, [SECOND, THIRD]);
  it('the rolling-window reading is the guess; the slip is his to choose', () => {
    const [question] = review(withDavid, L, lRows);
    expect(question.title).toBe('2 tasks named Pour slab in Lot — confirm which is which');
    const second = lRows.find(row => row.startDate === '10/12/2026')!.id;
    const third = lRows.find(row => row.startDate === '10/19/2026')!.id;
    expect(question.guess).toEqual({ [second]: secondId, [third]: null });
    const slipped = approve(withDavid, L, lRows, { [second]: firstId, [third]: secondId });
    expect(pours(slipped)).toEqual(['10/12/2026 80% Forms stripped', '10/19/2026 0%']);
    const rolled = approve(withDavid, L, lRows, question.guess as Record<string, string | null>);
    expect(pours(rolled)).toEqual(['10/05/2026 80% Forms stripped', '10/12/2026 0%', '10/19/2026 0%']);
  });
});
