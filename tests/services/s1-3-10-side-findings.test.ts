/**
 * Open item 3.10 (two side findings of 30 Sep 2026, never followed up), checked on the head by tests:
 * (a) "tasks approved from message screenshots are always hidden";
 * (b) "a task's identity includes its line number in the source file" (what David would see: a task that becomes a
 *     new task when a line is added above it in a newer file).
 * The phone's and iPad's approval runs compiled from App.tsx (approveScheduleImport) with the real services; the
 * desktop's upload is its own plan. Synthetic data.
 */
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { planDAVEWebScheduleImport } from '../../services/DAVEWebOperations';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { extractScheduleItemsFromCommunicationText } from '../../services/PIEScheduleCommunicationImport';
import { bindPIEScheduleImportBatchProvenance, type PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';
import { normalizeMicrosoftProjectPdfRows, normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { scheduleDocumentsAfterApproval } from '../../services/ScheduleDocumentLabels';
import { mergeApprovedScheduleImportItems, scheduleImportReviewPairingQuestions, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleImportPairingChosen, scheduleImportPairingGuess, scheduleImportPairingRefusal, withScheduleImportPairingChoices } from '../../components/schedule-import-pairing-check';
import { scheduleImportAddsToMaster } from '../../services/ScheduleLookahead';
import { scheduleTurnedHighLineBetween } from '../../services/ScheduleTurnedHigh';
import type { ProjectArea, ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []),
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

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

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const names = (state: State) => shown(state).map(item => item.taskName).sort();

/** The phone's and iPad's approval, compiled from App.tsx, on `state`: the state after it. */
async function approveOnPhone(state: State, batch: Record<string, unknown>): Promise<State> {
  const noop = () => undefined;
  const scheduleItemsCurrentRef = { current: state.items };
  const referenceDocumentsCurrentRef = { current: state.documents };
  const deps: Record<string, unknown> = {
    archivedProjectsCurrentRef: { current: [] }, deletedProjectNamesRef: { current: [] },
    projectsCurrentRef: { current: ['Alpha'] }, projectRecordsCurrentRef: { current: [] }, authorityProjectId: (name: string) => name.toLowerCase(),
    validateScheduleImportScope: ({ items }: { items: unknown[] }) => ({ items, warnings: [] }),
    projectAreasForProject: () => [], projectAreasCurrentRef: { current: [] }, savedUpdatesRef: { current: [] },
    scheduleImportApprovalBlocker: () => null, ScheduleImportReviewError: Error,
    bindPIEScheduleImportBatchProvenance, canonicalizeScheduleIdentityItems: (items: unknown[]) => items,
    normalizeScheduleItem: (item: unknown) => item, identityCorrections: [], daveRegisteredIdentityNames: () => [],
    ensureScheduleParentProjects: noop, mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleImportAddsToMaster,
    findExactScheduleTaskForCompletionClaim: () => null, mergeReportedCompletionClaim: (item: unknown) => item,
    reconcileDAVEScheduleRecords, scheduleDocumentsAfterApproval, normalizeReferenceDocument: (value: unknown) => value,
    runScheduleImportCloudSync: async () => ({ durablyQueued: true, fullySynced: true, supersededScheduleItemIds: [], supersededReferenceDocumentIds: [], uploadedReferenceDocuments: [] }),
    markScheduleItemsAuthorityReady: noop, markReferenceDocumentsAuthorityReady: noop,
    setScheduleItems: noop, setReferenceDocuments: noop, scheduleItemsCurrentRef, referenceDocumentsCurrentRef,
    projectScheduleImportCardRef: { current: null }, markProjectScheduleCardCurrent: noop, Alert: { alert: jest.fn() },
    scheduleTurnedHighLineBetween,
  };
  const js = ts.transpileModule(`${componentFunction('approveScheduleImport')}\nmodule.exports = { approveScheduleImport };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} as { approveScheduleImport: (batch: unknown) => Promise<unknown> } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  await mod.exports.approveScheduleImport(batch);
  return { items: scheduleItemsCurrentRef.current, documents: referenceDocumentsCurrentRef.current };
}

const HEADER = 'Task,Project,Area,Start,Finish,Percent Complete';
const fileBatch = (id: string, importedAt: string, lines: string[]) => {
  const document = {
    id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
    projectId: null, projectName: 'Alpha', projectNames: ['Alpha'],
  } as ReferenceDocument;
  const items = (normalizeScheduleImport({
    contents: [HEADER, ...lines].join('\n'), sourceName: document.originalFileName, mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({ ...item, id: `${id}-${index + 1}` }));
  return { id: `batch-${id}`, kind: 'schedule_file', sourceCount: 1, sourceLabel: document.originalFileName, message: '', documents: [document], items };
};
/** A message screenshot as App.tsx stages it (importScheduleCommunicationScreenshot): an "Other" document and the text's tasks. */
const screenshotBatch = (id: string, importedAt: string, text: string) => {
  const document = {
    id, name: `Schedule message - ${id}`, originalFileName: `${id}.png`, uri: '', mimeType: 'image/png', category: 'Other',
    notes: '[Schedule communication screenshot] Imported for local text recognition and schedule review.', isCurrent: false, importedAt,
  } as ReferenceDocument;
  const areas = [{ id: 'lot', name: 'Lot', projectName: 'Alpha' }] as unknown as ProjectArea[];
  const items = extractScheduleItemsFromCommunicationText({ text, sourceName: `${id}.png`, projects: ['Alpha'], projectAreas: areas, now: new Date(importedAt) }).items;
  return { id: `batch-${id}`, kind: 'message_screenshots', sourceCount: 1, sourceLabel: '1 message screenshot', message: '', documents: [document], items };
};
const EMPTY: State = { items: [], documents: [] };
const MESSAGE = 'Alpha Lot: electrical rough-in inspection due 10/20/2026 - Mike';

describe('3.10 (a): tasks approved from message screenshots are shown (not true on the head; pinned)', () => {
  it('with no schedule file at all: the screenshot\'s task is shown', async () => {
    const batch = screenshotBatch('IMG_0101', '2026-10-13T09:00:00.000Z', MESSAGE);
    expect(batch.items.map(item => [item.taskName, item.projectName, item.locationName, item.finishDate])).toEqual([[expect.any(String), 'Alpha', 'Lot', '10/20/2026']]);
    const after = await approveOnPhone(EMPTY, batch);
    expect(shown(after).map(item => item.id)).toEqual([batch.items[0].id]);
  });

  it('beside the current master: the master\'s tasks and the screenshot\'s task are all shown', async () => {
    const onF = await approveOnPhone(EMPTY, fileBatch('MASTER F', '2026-10-01T12:00:00.000Z', ['Framing,Alpha,Lot,10/05/2026,10/09/2026,', 'Roof,Alpha,Lot,11/01/2026,11/10/2026,']));
    expect(names(onF)).toEqual(['Framing', 'Roof']);
    const batch = screenshotBatch('IMG_0102', '2026-10-13T09:00:00.000Z', MESSAGE);
    const after = await approveOnPhone(onF, batch);
    expect(shown(after).map(item => item.id).sort()).toEqual([...shown(onF).map(item => item.id), batch.items[0].id].sort());
  });

  it('and still after a newer master that does not list it', async () => {
    const onF = await approveOnPhone(EMPTY, fileBatch('MASTER F', '2026-10-01T12:00:00.000Z', ['Framing,Alpha,Lot,10/05/2026,10/09/2026,']));
    const batch = screenshotBatch('IMG_0103', '2026-10-13T09:00:00.000Z', MESSAGE);
    const withMessage = await approveOnPhone(onF, batch);
    const onG = await approveOnPhone(withMessage, fileBatch('MASTER G', '2026-10-14T12:00:00.000Z', ['Framing,Alpha,Lot,10/05/2026,10/09/2026,', 'Paint,Alpha,Lot,12/01/2026,12/10/2026,']));
    expect(shown(onG).map(item => item.id)).toContain(batch.items[0].id);
    expect(names(onG)).toHaveLength(3);
  });
});

describe('3.10 (b): a line added above a task in a newer file does not make it a new task (not true on the head; pinned)', () => {
  // Only a Microsoft Project file's rows carry a line (and its ID and WBS follow the line, as Project numbers them): a
  // CSV's rows carry none. A line added above a task moves all three.
  const mspBatch = (id: string, importedAt: string, rows: readonly (readonly [name: string, start: string, finish: string])[], role?: 'lookahead') => {
    const document = {
      id, name: id, originalFileName: `${id}.pdf`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
      projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], ...(role ? { scheduleRole: role } : {}),
    } as ReferenceDocument;
    const items = (normalizeMicrosoftProjectPdfRows({
      contents: ['ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete\tWBS', '1\tALPHA\t0\t90 days\tThu 10/1/26\tThu 12/31/26\t0%\t1',
        ...rows.map(([name, start, finish], index) => [index + 2, name, 1, '2 days', start, finish, '0%', `1.${index + 1}`].join('\t'))].join('\n'),
      sourceName: document.originalFileName, projects: ['Alpha'], now: new Date(importedAt),
    }) as ScheduleItem[]).map((item, index) => ({ ...item, id: `${id}-${index + 1}` }));
    return { id: `batch-${id}`, kind: 'schedule_file', sourceCount: 1, sourceLabel: document.originalFileName, message: '', documents: [document], items };
  };
  const FRAMING = ['Framing', 'Mon 10/5/26', 'Fri 10/9/26'] as const;
  const ROOF = ['Roof', 'Mon 11/2/26', 'Tue 11/10/26'] as const;
  const SURVEY = ['Survey', 'Thu 10/1/26', 'Fri 10/2/26'] as const;
  const withHisWork = (state: State): State => ({ ...state, items: state.items.map(item => (item.taskName === 'Framing'
    ? { ...item, percentComplete: 40, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-10-06T09:00:00.000Z', progressConfirmedBy: 'David', notes: 'Crew of four', updatedAt: '2026-10-06T09:00:00.000Z' } as ScheduleItem
    : item)) });
  const framing = (state: State) => { const found = shown(state).filter(item => item.taskName === 'Framing'); expect(found).toHaveLength(1); return found[0]; };
  const onF = async () => withHisWork(await approveOnPhone(EMPTY, mspBatch('MASTER F', '2026-10-01T12:00:00.000Z', [FRAMING, ROOF])));

  it('the finding is true of the identity function: a line above moves the row, its ID and its WBS', () => {
    const lineOf = (batch: ReturnType<typeof mspBatch>) => { const row = batch.items.find(item => item.taskName === 'Framing')!; return [row.sourceRowNumber, row.sourceActivityId, row.sourceWbsCode]; };
    expect(lineOf(mspBatch('F', '2026-10-01T12:00:00.000Z', [FRAMING, ROOF]))).toEqual([3, '2', '1.1']);
    expect(lineOf(mspBatch('G', '2026-10-12T12:00:00.000Z', [SURVEY, FRAMING, ROOF]))).toEqual([4, '3', '1.2']);
  });

  it('a full schedule on the phone, the task on its dates: the same task, his percent and note on it, shown once', async () => {
    const f = await onF();
    const onG = await approveOnPhone(f, mspBatch('MASTER G', '2026-10-12T12:00:00.000Z', [SURVEY, FRAMING, ROOF]));
    expect(names(onG)).toEqual(['Framing', 'Roof', 'Survey']);
    expect([framing(onG).id, framing(onG).percentComplete, framing(onG).notes]).toEqual([framing(f).id, 40, 'Crew of four']);
  });

  it('a full schedule on the phone that also moves it: its new row answers to the task, with his percent and note', async () => {
    const f = await onF();
    const onG = await approveOnPhone(f, mspBatch('MASTER G', '2026-10-12T12:00:00.000Z', [SURVEY, ['Framing', 'Wed 10/7/26', 'Tue 10/13/26'], ROOF]));
    expect(names(onG)).toEqual(['Framing', 'Roof', 'Survey']);
    expect([framing(onG).revisedFromTaskIds, framing(onG).percentComplete, framing(onG).notes]).toEqual([[framing(f).id], 40, 'Crew of four']);
  });

  it('a lookahead on the phone with a line above it: restated in place', async () => {
    const f = await onF();
    const onL = await approveOnPhone(f, mspBatch('LOOKAHEAD L', '2026-10-12T12:00:00.000Z', [['Punch list', 'Thu 10/15/26', 'Fri 10/16/26'], ['Framing', 'Tue 10/6/26', 'Mon 10/12/26']], 'lookahead'));
    expect(names(onL)).toEqual(['Framing', 'Punch list', 'Roof']);
    expect([framing(onL).id, framing(onL).finishDate, framing(onL).percentComplete]).toEqual([framing(f).id, '10/12/2026', 40]);
  });

  it('the desktop\'s upload with a line above it: the same task revised in place, no new row for it', async () => {
    const f = await onF();
    const cloud = (item: ScheduleItem) => ({ ...item, cloudUpdatedAt: item.updatedAt ?? null }) as DAVEWebScheduleItem;
    const G = mspBatch('MASTER G', '2026-10-12T12:00:00.000Z', [SURVEY, FRAMING, ROOF]);
    const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: shown(f).map(cloud), knownScheduleItems: f.items.map(cloud) },
      importedScheduleItems: G.items.map(item => ({ ...item, importBatchId: G.id, sourceDocumentId: G.documents[0].id })) });
    expect(plan.additions.map(item => item.taskName)).toEqual(['Survey']);
    expect(plan.revisions.find(revision => revision.item.taskName === 'Framing')!.item.id).toBe(framing(f).id);
  });

  // The one place a row's line could decide: a task a master left out (its row hidden) that a later master lists
  // again. The review always asks "the same task, or new work?" for it (owner answer S2 item 1: never by name and
  // dates alone) and the approval is refused until he answers; his answer pairs it, with or without a line above.
  // (Approved with no answer at all, which the review never does, the row is restated only where the line is the
  // same: recorded, not changed.)
  it('a task a master left out and a later one lists again (the returning task): asked at the review; his answer decides, the line above changes nothing', async () => {
    const f = await onF();
    const onG = await approveOnPhone(f, mspBatch('MASTER G', '2026-10-05T12:00:00.000Z', [ROOF]));
    expect(names(onG)).toEqual(['Roof']);
    const outcome = async (rows: readonly (readonly [string, string, string])[], same: boolean) => {
      const H = mspBatch('MASTER H', '2026-10-12T12:00:00.000Z', rows);
      const imported = bindPIEScheduleImportBatchProvenance(H as never).items as ScheduleItem[];
      const questions = scheduleImportReviewPairingQuestions({ saved: onG.items, documents: onG.documents, importBatchId: H.id, imported });
      expect(questions.map(question => [question.title, question.returning, question.saved.map(item => item.id)]))
        .toEqual([['Framing in Alpha was on an earlier schedule: the same task, or new work?', true, [framing(f).id]]]);
      const row = questions[0].rows[0].id;
      expect(questions[0].guess).toEqual({ [row]: framing(f).id });
      expect(scheduleImportPairingRefusal(questions, scheduleImportPairingGuess)).toBe('Confirm whether Framing in Alpha is the same task or new work before saving.');
      const answer = scheduleImportPairingChosen(scheduleImportPairingGuess(questions[0]), framing(f).id, same ? row : null);
      const onH = await approveOnPhone(onG, withScheduleImportPairingChoices(H as typeof H & Pick<PIEScheduleImportBatch, 'pairingChoices'>, questions, () => answer));
      return [names(onH), framing(onH).id === framing(f).id, framing(onH).percentComplete, framing(onH).notes];
    };
    for (const same of [true, false]) {
      expect(await outcome([SURVEY, FRAMING, ROOF], same)).toEqual(await outcome([FRAMING, ROOF, SURVEY], same));
    }
    expect(await outcome([SURVEY, FRAMING, ROOF], true)).toEqual([['Framing', 'Roof', 'Survey'], true, 40, 'Crew of four']);
    expect(await outcome([SURVEY, FRAMING, ROOF], false)).toEqual([['Framing', 'Roof', 'Survey'], false, 0, '']);
  });
});
