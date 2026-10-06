/**
 * Review N2 G1 (pass 2 of the next round, part 2, 5 Oct 2026; Low; owner
 * answer Q25's shown and saved dates, ada8ef6, meeting owner answer Q30,
 * 9a1c22d). The phone's import review asked which same-named task is which
 * from the tasks as shown, while the approval pairs on the saved rows: a
 * task a replaced lookahead moved is shown on the master's dates and saved
 * on the lookahead's. Two Pour slabs, 10/01 (his 40%) and 10/15 (his 70%);
 * lookahead L1 moves the second to 10/11; L2 lists neither, so it shows
 * 10/15 again; L3 lists 10/15 and 10/06. The phone asked nothing and the
 * 10/06 row was saved as a third Pour slab.
 *
 * The phone's review now asks from the rows the approval pairs on
 * (scheduleImportReviewPairingQuestions), showing each task as David sees
 * it. The merge, the real CSV normalizer, the shown-schedule pick, the
 * review component and App.tsx's wiring. Synthetic data.
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import { ScheduleImportFlow } from '../../components/ScheduleImportFlow';
import type { PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';
import { scheduleImportPairingQuestions, scheduleImportReviewPairingQuestions } from '../../services/ScheduleImportMerge';

jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { reconcileScheduleProgressEdit } from '../../services/ScheduleProgressInvariant';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { withProjectControlsEditMerged } from '../../services/VitruviusProjectControls';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const named = (state: State, name: string) => shown(state).filter(item => item.taskName === name);
const one = (state: State, name: string) => {
  const found = named(state, name);
  expect(found).toHaveLength(1);
  return found[0];
};
const dates = (item: ScheduleItem) => `${item.startDate}-${item.finishDate}`;
const saved = (state: State, id: string) => state.items.find(item => item.id === id)!;

const schedule = (id: string, importedAt: string, role?: 'lookahead', project = 'Alpha'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: project, projectNames: [project], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;

/** A CSV's rows through the real normalizer, with the import's provenance. */
function rows(source: ReferenceDocument, lines: string[], project = 'Alpha'): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: [project], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}

/** Approving a schedule on the phone (App.tsx): the merge, then a master is made current, a lookahead added. */
function approve(state: State, source: ReferenceDocument, lines: string[], project = 'Alpha'): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines, project), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: lookahead,
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]),
    documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}

const APP_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
/** App.tsx's own updateScheduleItem, compiled from its source, at the time given: the task as the phone saves it. */
function phoneSave(state: State, id: string, edit: Partial<ScheduleItem>, at: string, restoresProgress = false): State {
  const from = APP_SOURCE.indexOf('\n  function updateScheduleItem(');
  const to = APP_SOURCE.indexOf('\n  async function saveScheduleItemChanges(', from);
  expect(from).toBeGreaterThan(0); expect(to).toBeGreaterThan(from);
  const js = ts.transpileModule(`module.exports = (() => { ${APP_SOURCE.slice(from, to)}\n return updateScheduleItem; })();`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const ref = { current: state.items };
  const deps: Record<string, unknown> = {
    scheduleItemsCurrentRef: ref, withProjectControlsEditMerged, reconcileScheduleProgressEdit,
    normalizeScheduleItem: (value: ScheduleItem) => ({ ...value }), displayName: 'David',
    resolveProjectItemWorkflowMutation: ({ candidate }: { candidate: ScheduleItem }) => ({ ok: true, item: candidate }),
    advanceScheduleItemSyncGeneration: () => 1, markScheduleItemsAuthorityReady: () => undefined,
    setScheduleItems: () => undefined, scheduleItemChangeUsesDebouncedSync: () => false, cancelScheduleItemTextSync: () => undefined,
    syncScheduleItemRevision: () => undefined, queueScheduleItemRecord: async () => undefined, Alert: { alert: () => undefined },
  };
  const mod = { exports: {} as unknown };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  jest.useFakeTimers({ now: new Date(at) });
  try { (mod.exports as (id: string, edit: Partial<ScheduleItem>, workflow?: unknown, restores?: boolean) => void)(id, edit, undefined, restoresProgress); } finally { jest.useRealTimers(); }
  return { ...state, items: ref.current };
}

/** The phone's handler for "Delete PDF Only", read from App.tsx: what it saves before it removes the file. */
const DELETE_PDF_ONLY = (() => {
  const from = APP_SOURCE.indexOf("text: 'Delete PDF Only'");
  return APP_SOURCE.slice(from, APP_SOURCE.indexOf("text: 'Delete PDF + Items'", from));
})();
/** "Delete PDF Only" as the phone does it: the helper's tasks, each saved as the helper gives it (review P6-5; it was its two dates only), then the file goes. */
function deletePdfOnly(state: State, document: ReferenceDocument, at: string): State {
  expect(DELETE_PDF_ONLY).toContain('fileOnly: true, withWhatHeSet: true }).forEach(item => updateScheduleItem(item.id, item as unknown as ScheduleItem, undefined, true))');
  let next = state;
  scheduleItemsAfterScheduleDeleted({ items: state.items, removed: [], document, documents: state.documents, fileOnly: true, withWhatHeSet: true, updatedAt: at })
    .forEach(task => { next = phoneSave(next, task.id, task, at, true); });
  return { items: next.items, documents: next.documents.filter(other => other.id !== document.id) };
}

/** "Delete PDF + Items" as the phone does it (App.tsx), through the shared delete helper. */
function deleteWithItems(state: State, document: ReferenceDocument, at: string): State {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const restored = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at }).map(item => [item.id, item]));
  return { items: kept.map(item => restored.get(item.id) || item), documents };
}

const M = schedule('MASTER M', '2026-09-01T12:00:00.000Z');
const L1 = schedule('LOOKAHEAD L1', '2026-09-08T12:00:00.000Z', 'lookahead');
const L2 = schedule('LOOKAHEAD L2', '2026-09-15T12:00:00.000Z', 'lookahead');
const L3 = schedule('LOOKAHEAD L3', '2026-09-22T12:00:00.000Z', 'lookahead');
const onM = approve(EMPTY, M, ['Pour slab,Alpha,Lot,10/01/2026,10/05/2026,', 'Pour slab,Alpha,Lot,10/15/2026,10/19/2026,', 'Framing,Alpha,Lot,11/20/2026,11/30/2026,']);
const [firstId, secondId] = named(onM, 'Pour slab').sort((left, right) => (left.startDate < right.startDate ? -1 : 1)).map(item => item.id);
/** His own percent and a note naming each: 40% on the first, 70% on the second. */
const withHis = [[firstId, 40, 'first pour'], [secondId, 70, 'second pour']].reduce((state, [id, percent, note]) =>
  phoneSave(phoneSave(state, id as string, { percentComplete: percent as number }, '2026-09-02T09:00:00.000Z'), id as string, { notes: note as string }, '2026-09-02T09:05:00.000Z'), onM);
/** L1 moves the second to 10/11; L2 lists neither, so the second shows 10/15 again, saved on 10/11. */
const onL2 = approve(approve(withHis, L1, ['Pour slab,Alpha,Lot,10/11/2026,10/15/2026,']), L2, ['Framing,Alpha,Lot,11/21/2026,12/01/2026,']);
/** L3 lists the second where he sees it, and the first moved to 10/06. */
const L3_LINES = ['Pour slab,Alpha,Lot,10/15/2026,10/19/2026,', 'Pour slab,Alpha,Lot,10/06/2026,10/10/2026,'];
const l3Rows = rows(L3, L3_LINES);
const pours = (state: State) => named(state, 'Pour slab').map(item => `${dates(item)} ${item.percentComplete}% ${item.notes}`.trim()).sort();
/** The approval with David's answers (App.tsx passes the batch's pairingChoices). */
function approveAnswered(state: State, source: ReferenceDocument, lines: string[], pairingChoices?: Record<string, string | null>): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: true, ...(pairingChoices ? { pairingChoices } : {}),
  });
  return { items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]), documents: [...state.documents, source] };
}
const asReviewed = () => scheduleImportReviewPairingQuestions({ saved: onL2.items, documents: onL2.documents, importBatchId: L3.importBatchId!, imported: l3Rows, overlay: true });

describe('Review N2 G1: the phone\'s import review asks from the rows the approval pairs on', () => {
  it('what he sees: Pour slab on 10/01 at 40% and on 10/15 at 70% (the second is saved on L1\'s 10/11)', () => {
    expect(pours(onL2)).toEqual(['10/01/2026-10/05/2026 40% first pour', '10/15/2026-10/19/2026 70% second pour']);
    expect(dates(saved(onL2, secondId))).toBe('10/11/2026-10/15/2026');
  });

  it('asked from the tasks as shown, as the phone did, L3 raises no question; unasked, the approval saves a third Pour slab', () => {
    expect(scheduleImportPairingQuestions({ existing: shown(onL2), imported: l3Rows, overlay: true })).toEqual([]);
    expect(pours(approveAnswered(onL2, L3, L3_LINES))).toEqual([
      '10/01/2026-10/05/2026 40% first pour', '10/06/2026-10/10/2026 0%', '10/15/2026-10/19/2026 70% second pour',
    ]);
  });

  it('asked as the approval pairs, it is a question, with each task as he sees it and the approval\'s own guess', () => {
    const [question, ...others] = asReviewed();
    expect(others).toEqual([]);
    expect(question.title).toBe('2 tasks named Pour slab in Lot — confirm which is which');
    // The dates shown, not the second task's saved 10/11.
    expect(question.saved.map(item => `${item.id === firstId ? 'first' : 'second'} ${dates(item)} ${item.percentComplete}%`))
      .toEqual(['first 10/01/2026-10/05/2026 40%', 'second 10/15/2026-10/19/2026 70%']);
    expect(question.rows.map(dates)).toEqual(['10/06/2026-10/10/2026', '10/15/2026-10/19/2026']);
    // What the approval would do unasked: 10/15 is the second, 10/06 a new task.
    expect(question.guess).toEqual({ [l3Rows[0].id]: secondId, [l3Rows[1].id]: null });
  });

  it('answered (10/06 is the first), the approval moves the first: two Pour slabs, each with his percent and note', () => {
    const after = approveAnswered(onL2, L3, L3_LINES, { [l3Rows[0].id]: secondId, [l3Rows[1].id]: firstId });
    expect(pours(after)).toEqual(['10/06/2026-10/10/2026 40% first pour', '10/15/2026-10/19/2026 70% second pour']);
  });

  it('with no replaced lookahead in play, the questions are the ones asked from the tasks shown, as before', () => {
    const G = schedule('MASTER G', '2026-09-08T12:00:00.000Z');
    const slipped = rows(G, ['Pour slab,Alpha,Lot,10/15/2026,10/19/2026,', 'Pour slab,Alpha,Lot,10/29/2026,11/02/2026,', 'Framing,Alpha,Lot,11/20/2026,11/30/2026,']);
    const fromShown = scheduleImportPairingQuestions({ existing: shown(withHis), imported: slipped });
    expect(fromShown).toHaveLength(1);
    expect(scheduleImportReviewPairingQuestions({ saved: withHis.items, documents: withHis.documents, importBatchId: G.importBatchId!, imported: slipped })).toEqual(fromShown);
    const plain = rows(G, ['Pour slab,Alpha,Lot,10/01/2026,10/05/2026,', 'Pour slab,Alpha,Lot,10/15/2026,10/19/2026,', 'Framing,Alpha,Lot,11/22/2026,12/02/2026,']);
    expect(scheduleImportReviewPairingQuestions({ saved: withHis.items, documents: withHis.documents, importBatchId: G.importBatchId!, imported: plain })).toEqual([]);
  });
});

describe('Review N2 G1: what the tasks as shown leave unsettled is still asked', () => {
  // The other way round (the reviewer's plans 142, 1277 and 1326): a saved date he cannot see settles, for the approval,
  // a pairing that is a toss-up from what he sees. One row on 10/08: as near to 10/01 as to 10/15 in his list, but on
  // two days of the second task's saved 10/11-10/15.
  const ONE = ['Pour slab,Alpha,Lot,10/08/2026,10/12/2026,'];
  const [row1008] = rows(L3, ONE);
  const asApprovalAlone = () => scheduleImportPairingQuestions({
    existing: onL2.items, imported: [row1008], overlay: true,
    isCurrent: scheduleItemsVisibleBeforeImport(onL2.items, onL2.documents, L3.importBatchId || ''),
  });
  const reviewed = () => scheduleImportReviewPairingQuestions({ saved: onL2.items, documents: onL2.documents, importBatchId: L3.importBatchId!, imported: [row1008], overlay: true });

  it('the saved rows alone raise no question, and unasked the approval moves the second task (his 70%) to 10/08', () => {
    expect(asApprovalAlone()).toEqual([]);
    expect(pours(approveAnswered(onL2, L3, ONE))).toEqual(['10/01/2026-10/05/2026 40% first pour', '10/08/2026-10/12/2026 70% second pour']);
  });

  it('from what he sees it is a toss-up, so the review asks, with the approval\'s own guess selected', () => {
    expect(scheduleImportPairingQuestions({ existing: shown(onL2), imported: [row1008], overlay: true })).toHaveLength(1);
    const [question, ...others] = reviewed();
    expect(others).toEqual([]);
    expect(question.saved.map(dates)).toEqual(['10/01/2026-10/05/2026', '10/15/2026-10/19/2026']);
    expect(question.guess).toEqual({ [row1008.id]: secondId });
  });

  it('answered (10/08 is the first), the first moves with his 40% and the second stays where he sees it', () => {
    expect(pours(approveAnswered(onL2, L3, ONE, { [row1008.id]: firstId }))).toEqual(['10/08/2026-10/12/2026 40% first pour', '10/15/2026-10/19/2026 70% second pour']);
  });
});

describe('Review N2 G1: only the tasks shown before the import are the ones a row may revise, as at the approval', () => {
  const G = schedule('MASTER G', '2026-09-08T12:00:00.000Z');
  /** Master G moved both Pour slabs a week: M's two rows are saved, hidden, and G's rows answer to them. */
  const onG = approve(withHis, G, ['Pour slab,Alpha,Lot,10/08/2026,10/12/2026,', 'Pour slab,Alpha,Lot,10/22/2026,10/26/2026,', 'Framing,Alpha,Lot,11/20/2026,11/30/2026,']);
  const LG = schedule('LOOKAHEAD LG', '2026-09-15T12:00:00.000Z', 'lookahead');
  /** One row midway between the two he sees: as near to one as to the other. */
  const midway = rows(LG, ['Pour slab,Alpha,Lot,10/15/2026,10/19/2026,']);

  it('four Pour slab rows are saved, two shown', () => {
    expect([onG.items.filter(item => item.taskName === 'Pour slab').length, pours(onG)]).toEqual([4, ['10/08/2026-10/12/2026 40% first pour', '10/22/2026-10/26/2026 70% second pour']]);
  });

  it('a row tied between the two shown is asked about, and the check lists the two he sees, not the hidden rows', () => {
    const [question, ...others] = scheduleImportReviewPairingQuestions({ saved: onG.items, documents: onG.documents, importBatchId: LG.importBatchId!, imported: midway, overlay: true });
    expect(others).toEqual([]);
    expect(question.saved.map(dates)).toEqual(['10/08/2026-10/12/2026', '10/22/2026-10/26/2026']);
    // The same question the tasks shown raise.
    expect(question).toEqual(scheduleImportPairingQuestions({ existing: shown(onG), imported: midway, overlay: true })[0]);
  });
});

describe('Review N2 G1: the review on the phone', () => {
  const batch: PIEScheduleImportBatch = {
    id: L3.importBatchId!, kind: 'schedule_file', sourceCount: 1, sourceLabel: 'LOOKAHEAD L3.csv', message: 'Two activities extracted.',
    documents: [{ ...L3, scheduleRole: 'lookahead' }], items: l3Rows,
  } as PIEScheduleImportBatch;
  function renderReview(savedItems?: readonly ScheduleItem[]) {
    const onApprove = jest.fn(async (_batch: PIEScheduleImportBatch) => undefined);
    const view = render(
      <ScheduleImportFlow
        screenshotImportAvailable={false}
        onImportFile={jest.fn(async () => null)}
        onImportScreenshots={jest.fn(async () => null)}
        onAddManually={jest.fn()}
        onApprove={onApprove}
        onCancel={jest.fn()}
        incomingBatch={batch}
        onIncomingBatchConsumed={jest.fn()}
        roleContext={{ documents: onL2.documents, items: shown(onL2) }}
        savedItems={savedItems}
      />,
    );
    return { ...view, onApprove };
  }
  const TITLE = '2 tasks named Pour slab in Lot — confirm which is which';

  it('given every saved task, it shows the check, with the dates he sees, and Accept waits for his answer', async () => {
    const view = renderReview(onL2.items);
    expect(await view.findByText(TITLE)).toBeTruthy();
    expect(view.getByText('Saved Pour slab 1: 10/1–10/5 · 40% · “first pour”')).toBeTruthy();
    expect(view.getByText('Saved Pour slab 2: 10/15–10/19 · 70% · “second pour”')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByText('Accept All (2)')); await Promise.resolve(); });
    expect(view.onApprove).not.toHaveBeenCalled();
    expect(view.getByText('Confirm which Pour slab is which in Lot before saving.')).toBeTruthy();
  });

  it('given only the tasks as shown (as before this fix), it shows no check', async () => {
    const view = renderReview(undefined);
    await view.findByText('Accept All (2)');
    expect(view.queryByText(TITLE)).toBeNull();
  });

  it('App.tsx gives the review every saved task, on the line that gives it the tasks shown', () => {
    const screen = APP_SOURCE.slice(APP_SOURCE.indexOf('\nfunction ScheduleScreen('));
    expect(screen).toContain("roleContext={{ documents: reviewDocuments, items: scheduleItems as unknown as import('./types').ScheduleItem[] }} savedItems={knownScheduleItems as unknown as import('./types').ScheduleItem[] | undefined}");
    // Every saved task reaches the Schedule screen, beside the tasks shown.
    expect(APP_SOURCE).toContain('scheduleItems={authoritativeScheduleItems} knownScheduleItems={scheduleItems}');
  });
});
