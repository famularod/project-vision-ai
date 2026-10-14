/**
 * Open item 2.38 (13 Oct 2026; review pass 10's N-1, C-1, item 8's "found, not done"). Since the owner's answers to
 * questions 47 and 51 a newer full schedule turns a task High (its file marks it Critical, or lists its finish within
 * the week), also a task it leaves on its dates, and also one whose priority he lowered before Build 231. Nothing
 * said which tasks it had turned High, so he could not set any back at once.
 *
 * Now one line names them where he approves the schedule: the phone's and iPad's import review, and on the desktop at
 * the upload (where a task left on its dates is raised, item 8's decision 1) and at Make Current (where a moved
 * task's new row starts to show). Here: the records (the merge as each place calls it), and App.tsx's approval,
 * compiled. The screens are in tests/components/s1-2-38-turned-high-line-shown.test.tsx. Synthetic data.
 */
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { planDAVEWebScheduleImport } from '../../services/DAVEWebOperations';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { bindPIEScheduleImportBatchProvenance } from '../../services/PIEScheduleImportBatch';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedToShownTasks } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterApproval } from '../../services/ScheduleDocumentLabels';
import { scheduleImportAddsToMaster } from '../../services/ScheduleLookahead';
import { scheduleTasksTurnedHigh, scheduleTurnedHighLine, scheduleTurnedHighLineBetween, scheduleUploadTurnedHighLine } from '../../services/ScheduleTurnedHigh';
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
const one = (state: State, name: string) => {
  const found = shown(state).filter(item => item.taskName === name);
  expect(found).toHaveLength(1);
  return found[0];
};
const schedule = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
const HEADER = 'Task,Project,Area,Start,Finish,Percent Complete,Critical';
const START = Date.parse('2026-06-01T12:00:00.000Z');
/** The file's rows as the import reads them on the day of the import (when the file reader works out a row's priority). */
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  jest.setSystemTime(Date.parse(source.importedAt as string));
  try {
    return (normalizeScheduleImport({
      contents: [HEADER, ...lines].join('\n'), sourceName: source.originalFileName,
      mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
    }).items as ScheduleItem[]).map((item, index) => ({
      ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
    }));
  } finally { jest.setSystemTime(START); }
}
/** Approving on the phone or the iPad: the merge as App.tsx calls it, then the schedule is current (a lookahead: in effect). */
function approve(state: State, source: ReferenceDocument, lines: string[], overlay = false): State {
  const result = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, overlay,
  });
  return {
    items: reconcileDAVEScheduleRecords([...result.additions, ...result.next]),
    documents: overlay ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
const cloud = (item: ScheduleItem) => ({ ...item, cloudUpdatedAt: item.updatedAt ?? null }) as DAVEWebScheduleItem;
/** The desktop's upload of a full schedule: its own plan (desktop-auth-provider uploadDocument); the file NOT current. */
function upload(state: State, source: ReferenceDocument, lines: string[]) {
  const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: shown(state).map(cloud), knownScheduleItems: state.items.map(cloud) }, importedScheduleItems: rows(source, lines) });
  const revised = new Map(plan.revisions.map(revision => [revision.item.id, revision.item]));
  const file = { ...source, isCurrent: false, webFileFingerprint: 'w'.repeat(64) } as ReferenceDocument;
  return { plan, state: { items: [...plan.additions, ...state.items.map(item => revised.get(item.id) || item)], documents: [...state.documents, file] } as State };
}
/** The desktop's Make Current (desktop-auth-provider setCurrentSchedule): the tasks shown before and after, with its carry. */
function makeCurrent(state: State, source: ReferenceDocument, at: string) {
  const documents = scheduleDocumentsAfterActivation(state.documents.find(document => document.id === source.id)!, state.documents, 'project', at);
  const before = shown(state);
  const carried = new Map(scheduleProgressCarriedToShownTasks({ before, after: shown({ items: state.items, documents }), documentsBefore: state.documents, documentsAfter: documents, now: at }).map(item => [item.id, item]));
  const next = { items: state.items.map(item => carried.get(item.id) || item), documents };
  return { before, after: shown(next), state: next };
}
/** His priority edit as the phone saves it. */
function sets(state: State, id: string, priority: ScheduleItem['priority'], at = '2026-06-03T09:05:00.000Z'): State {
  jest.setSystemTime(Date.parse(at));
  const change = withProjectControlsEditMerged(state.items.find(item => item.id === id)!, { priority });
  jest.setSystemTime(START);
  return { ...state, items: state.items.map(item => (item.id === id ? { ...item, ...change, updatedAt: at } as ScheduleItem : item)) };
}

jest.useFakeTimers({ now: START });
afterAll(() => { jest.useRealTimers(); });
afterEach(() => { jest.setSystemTime(START); });

// F on 1 June, long before anything is due: every row Medium. G on 11 October.
const F = schedule('MASTER F', '2026-06-01T12:00:00.000Z');
const G = schedule('MASTER G', '2026-10-11T12:00:00.000Z');
const FRAMING = 'Framing,Alpha,Lot,10/01/2026,10/11/2026,,'; // finish within G's week: G gives High, on its dates
const ROOF = 'Roof,Alpha,Lot,11/13/2026,11/21/2026,,';
const ROOF_CRITICAL = 'Roof,Alpha,Lot,11/13/2026,11/21/2026,,Yes'; // G marks it Critical, on its dates
const PAINT = 'Paint,Alpha,Lot,12/01/2026,12/10/2026,,'; // never High
const SURVEY_F = 'Survey,Alpha,Lot,11/01/2026,11/05/2026,,';
const SURVEY_G = 'Survey,Alpha,Lot,10/12/2026,10/14/2026,,'; // G MOVES it into its week: the new row is High
const DECK = 'Deck,Alpha,Lot,11/20/2026,11/25/2026,,';
const DECK_CRITICAL = 'Deck,Alpha,Lot,11/20/2026,11/25/2026,,Yes'; // he set Deck Low: stays Low
const DEMO = 'Demo,Alpha,Lot,07/01/2026,07/15/2026,100,'; // finished; its finish has gone by at G: not raised (item 8b)
const FENCE = 'Fence,Alpha,Lot,10/10/2026,10/12/2026,,'; // new in G, High: a new task, nothing was turned

const onF = approve(EMPTY, F, [FRAMING, ROOF, PAINT, SURVEY_F, DECK, DEMO]);
const deckF = one(onF, 'Deck').id;
const start = sets(onF, deckF, 'Low');
const G_LINES = [FRAMING, ROOF_CRITICAL, PAINT, SURVEY_G, DECK_CRITICAL, DEMO, FENCE];
const LINE = 'This schedule turned 3 tasks High: Framing (Lot), Roof (Lot) and Survey (Lot). To set one back, open it and change its priority.';

describe('2.38: the tasks a newer schedule turned High (the phone\'s and iPad\'s approval)', () => {
  it('names the tasks it left on its dates and raised, and the task it moved whose new row is High; nothing else', () => {
    const onG = approve(start, G, G_LINES);
    expect(['Framing', 'Roof', 'Paint', 'Survey', 'Deck', 'Demo', 'Fence'].map(name => [name, one(onG, name).priority])).toEqual([
      ['Framing', 'High'], ['Roof', 'High'], ['Paint', 'Medium'], ['Survey', 'High'], ['Deck', 'Low'], ['Demo', 'Medium'], ['Fence', 'High'],
    ]);
    expect(scheduleTasksTurnedHigh(start.items, onG.items).map(item => item.taskName).sort()).toEqual(['Framing', 'Roof', 'Survey']);
    expect(scheduleTurnedHighLineBetween(start.items, onG.items)).toBe(LINE);
  });

  it('a task already High is not named; nor is anything when the same schedule is approved again', () => {
    const onG = approve(start, G, G_LINES);
    const H = schedule('MASTER H', '2026-10-12T12:00:00.000Z');
    const onH = approve(onG, H, G_LINES);
    expect(scheduleTurnedHighLineBetween(onG.items, onH.items)).toBeNull();
    expect(scheduleTurnedHighLineBetween(onG.items, approve(onG, G, G_LINES).items)).toBeNull();
  });

  it('a lookahead never changes a priority: it names none, also of the tasks it adds High', () => {
    const L = schedule('LOOKAHEAD L', '2026-10-11T12:00:00.000Z', 'lookahead');
    const onL = approve(start, L, [FRAMING, ROOF_CRITICAL, 'Punch list,Alpha,Lot,10/12/2026,10/14/2026,,'], true);
    expect(one(onL, 'Punch list').priority).toBe('High');
    expect(scheduleTurnedHighLineBetween(start.items, onL.items)).toBeNull();
  });

  it('the line: one task; three; more than three ("and N more"), each task once, in alphabetical order', () => {
    const task = (taskName: string, locationName = 'Lot') => ({ taskName, locationName }) as ScheduleItem;
    expect(scheduleTurnedHighLine([])).toBeNull();
    expect(scheduleTurnedHighLine([task('Roof')])).toBe('This schedule turned 1 task High: Roof (Lot). To set one back, open it and change its priority.');
    expect(scheduleTurnedHighLine([task('Survey', ''), task('Roof')])).toBe('This schedule turned 2 tasks High: Roof (Lot) and Survey. To set one back, open it and change its priority.');
    // CHANGED by S1c item 3 (14 Oct, review pass 5's H5S-3): two tasks named "Roof (Lot)" are two tasks, not one.
    expect(scheduleTurnedHighLine(['Paint', 'Deck', 'Roof', 'Framing', 'Survey', 'Roof'].map(name => task(name))))
      .toBe('This schedule turned 6 tasks High: Deck (Lot), Framing (Lot), Paint (Lot) and 3 more. To set one back, open it and change its priority.');
  });
});

describe('2.38: the desktop names them where each is turned High', () => {
  it('at the upload: the tasks it leaves on its dates (raised there, on every device); at Make Current: the task it moved', () => {
    const { plan, state } = upload(start, G, G_LINES);
    expect(scheduleUploadTurnedHighLine(plan)).toBe('This schedule turned 2 tasks High: Framing (Lot) and Roof (Lot). To set one back, open it and change its priority.');
    const { before, after } = makeCurrent(state, G, '2026-10-11T15:00:00.000Z');
    expect(scheduleTurnedHighLineBetween(before, after)).toBe('This schedule turned 1 task High: Survey (Lot). To set one back, open it and change its priority.');
  });

  it('an upload that raises nothing, and a lookahead\'s upload, say nothing', () => {
    expect(scheduleUploadTurnedHighLine(upload(start, schedule('MASTER K', '2026-06-02T12:00:00.000Z'), [FRAMING, ROOF, PAINT]).plan)).toBeNull();
    expect(scheduleUploadTurnedHighLine(null)).toBeNull();
  });
});

describe('2.38: App.tsx approveScheduleImport, compiled, returns the line for the review to show', () => {
  const fs = jest.requireActual('fs') as typeof import('fs');
  const path = jest.requireActual('path') as typeof import('path');
  const ts = jest.requireActual('typescript') as typeof import('typescript');
  const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
  function componentFunction(name: string): string {
    const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(app);
    if (!match) throw new Error(`App.tsx has no component function ${name}`);
    const open = app.indexOf(' {\n', match.index) + 1;
    let depth = 0;
    for (let index = open; index < app.length; index += 1) {
      if (app[index] === '{') depth += 1;
      if (app[index] === '}') { depth -= 1; if (depth === 0) return app.slice(match.index + 3, index + 1); }
    }
    throw new Error('unbalanced function');
  }
  function load(items: ScheduleItem[], documents: ReferenceDocument[]) {
    const noop = () => undefined;
    const js = ts.transpileModule(`${componentFunction('approveScheduleImport')}\nmodule.exports = { approveScheduleImport };`,
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const deps: Record<string, unknown> = {
      archivedProjectsCurrentRef: { current: [] }, deletedProjectNamesRef: { current: [] },
      projectsCurrentRef: { current: ['Alpha'] }, projectRecordsCurrentRef: { current: [] },
      authorityProjectId: (name: string) => name.toLowerCase(),
      validateScheduleImportScope: ({ items: rowsIn }: { items: unknown[] }) => ({ items: rowsIn, warnings: [] }),
      projectAreasForProject: () => [], projectAreasCurrentRef: { current: [] }, savedUpdatesRef: { current: [] },
      scheduleImportApprovalBlocker: () => null, ScheduleImportReviewError: Error,
      bindPIEScheduleImportBatchProvenance, canonicalizeScheduleIdentityItems: (rowsIn: unknown[]) => rowsIn,
      normalizeScheduleItem: (item: unknown) => item, identityCorrections: [], daveRegisteredIdentityNames: () => [],
      ensureScheduleParentProjects: noop, mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleImportAddsToMaster,
      findExactScheduleTaskForCompletionClaim: () => null, mergeReportedCompletionClaim: (item: unknown) => item,
      reconcileDAVEScheduleRecords, scheduleDocumentsAfterApproval, normalizeReferenceDocument: (value: unknown) => value,
      runScheduleImportCloudSync: async () => ({ durablyQueued: true, fullySynced: true, supersededScheduleItemIds: [], supersededReferenceDocumentIds: [], uploadedReferenceDocuments: [] }),
      markScheduleItemsAuthorityReady: noop, markReferenceDocumentsAuthorityReady: noop, setScheduleItems: noop, setReferenceDocuments: noop,
      scheduleItemsCurrentRef: { current: items }, referenceDocumentsCurrentRef: { current: documents },
      projectScheduleImportCardRef: { current: null }, markProjectScheduleCardCurrent: noop, Alert: { alert: jest.fn() },
      scheduleTurnedHighLineBetween,
    };
    const mod = { exports: {} as { approveScheduleImport: (batch: unknown) => Promise<string | null | undefined> } };
    new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
    return { approve: mod.exports.approveScheduleImport, deps };
  }
  const batch = (source: ReferenceDocument, lines: string[]) => ({
    id: source.importBatchId, kind: 'schedule_file', sourceCount: 1, sourceLabel: source.originalFileName, message: '',
    documents: [{ ...source, isCurrent: false }], items: rows(source, lines).map(row => ({ ...row, importBatchId: undefined, sourceDocumentId: undefined })),
  });

  it('a newer master that turns tasks High: the approval resolves with the line naming them', async () => {
    const { approve: approveIt } = load(start.items, start.documents);
    jest.setSystemTime(Date.parse(G.importedAt as string));
    await expect(approveIt(batch(G, G_LINES))).resolves.toBe(LINE);
  });

  it('one that turns none: null (nothing is shown)', async () => {
    const { approve: approveIt } = load(start.items, start.documents);
    await expect(approveIt(batch(schedule('MASTER K', '2026-06-02T12:00:00.000Z'), [FRAMING, ROOF, PAINT]))).resolves.toBeNull();
  });
});
