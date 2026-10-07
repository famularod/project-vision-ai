/**
 * R5 item 3 (open item, small; the same on the phone and on the web).
 *
 * Completed Work says when each completed task was last updated: its latest
 * note or the time its progress was confirmed, whichever is later. A master
 * schedule that states 100% for a task an import owns, with no percent of
 * his on it, completes the task and records no confirmation time (the file's
 * percent stands as the file's). With a note on the task from weeks before,
 * the line read "Last updated <the note's date>", for a task completed
 * since.
 *
 * The real CSV reader, the phone's approval, the one report recipe (phone
 * and web) and the report's Completed Work lines. Synthetic data.
 */
import { buildDAVEReportBriefing } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { buildDAVEWebReportDraft } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
/** The approval as the phone makes it (the web's upload uses the same merge). */
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv',
    projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id, projectControls: normalizeProjectControls(undefined),
  }));
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string,
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]) as ScheduleItem[],
    documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
const change = (state: State, name: string, patch: (item: ScheduleItem) => Partial<ScheduleItem>): State => ({
  ...state, items: state.items.map(item => (item.taskName === name ? { ...item, ...patch(item) } as ScheduleItem : item)),
});
/** A note he made on the task. */
const noted = (state: State, name: string, message: string, at: string) => change(state, name, item => ({
  activity: [...(item.activity ?? []), { id: `note-${at}`, createdAt: at, message, author: 'David', kind: 'note' } as never], updatedAt: at,
}));
/** A percent he entered himself. */
const hisPercent = (state: State, name: string, percent: number, at: string) => change(state, name, () => ({
  percentComplete: percent, status: percent >= 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at,
}));

const NOW = '2026-10-02T15:00:00.000Z';
/** Completed Work as the phone's Reports screen writes it. */
const completedOnPhone = (state: State) => buildDAVEReportBriefing({
  truths: buildDAVEReportProjectTruths({
    projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown(state),
    knownScheduleItems: state.items, knownScheduleDocuments: state.documents, projectAreas: [], referenceDocuments: state.documents, now: NOW,
  }),
  selectedProjectNames: ['Alpha'], scheduleItems: shown(state),
}).completedWork;
/** And as the web Reports page writes it, from what it has downloaded of the same data. */
const completedOnWeb = (state: State) => buildDAVEWebReportDraft({
  projects: [{ id: '5f0c2a9e-1b1d-4c55-9a53-0d6f2c7c1a10', name: 'Alpha' }], scheduleItems: shown(state), knownScheduleItems: state.items,
  projectUpdates: [], referenceDocuments: state.documents, refreshedAt: NOW,
} as unknown as DAVEWebReadOnlySnapshot, 'Alpha').completedWork;

const F = schedule('MASTER F', '2026-09-07T12:00:00.000Z');
const G = schedule('MASTER G', '2026-10-01T12:00:00.000Z');
const FRAMING = 'Framing,Alpha,Lot,10/15/2026,10/25/2026,';
const paint = (percent: string) => `Paint,Alpha,Lot,09/20/2026,09/26/2026,${percent}`;

describe('R5 item 3: a task a master schedule completes says when that was, not the date of an older note', () => {
  it('master G states 100% for Paint, which carries a note from three weeks before: last updated the day G was approved', () => {
    let state = approve({ items: [], documents: [] }, F, [FRAMING, paint('')]);
    state = noted(state, 'Paint', 'Primer on.', '2026-09-09T10:00:00.000Z');
    state = approve(state, G, [FRAMING, paint('100')]);
    const [task] = shown(state).filter(item => item.taskName === 'Paint');
    // The scenario: completed by the file, on its own row, with no confirmation time.
    expect([task.id, task.percentComplete, task.status, task.progressConfirmedAt ?? null]).toEqual(['MASTER F-2', 100, 'Complete', null]);
    // (It read: "Paint (Lot): Complete; 100% complete. Last updated Sep 9, 2026.")
    expect(completedOnPhone(state)).toEqual(['Paint (Lot): Complete; 100% complete. Last updated Oct 1, 2026.']);
    expect(completedOnWeb(state)).toEqual(completedOnPhone(state));
  });

  it('a note he makes after the master completed it is the later of the two, as before', () => {
    let state = approve({ items: [], documents: [] }, F, [FRAMING, paint('')]);
    state = approve(state, G, [FRAMING, paint('100')]);
    state = noted(state, 'Paint', 'Touch-ups done.', '2026-10-02T09:00:00.000Z');
    expect(completedOnPhone(state)).toEqual(['Paint (Lot): Complete; 100% complete. Last updated Oct 2, 2026.']);
    expect(completedOnWeb(state)).toEqual(completedOnPhone(state));
  });

  it('guard: a task he completed himself keeps the day he confirmed it when a later master states 100% too', () => {
    let state = approve({ items: [], documents: [] }, F, [FRAMING, paint('')]);
    state = noted(state, 'Paint', 'Primer on.', '2026-09-09T10:00:00.000Z');
    state = hisPercent(state, 'Paint', 100, '2026-09-25T16:00:00.000Z');
    state = approve(state, G, [FRAMING, paint('100')]);
    expect(completedOnPhone(state)).toEqual(['Paint (Lot): Complete; 100% complete. Last updated Sep 25, 2026.']);
    expect(completedOnWeb(state)).toEqual(completedOnPhone(state));
  });

  it('guard: a task a master completes on a new row (it moved the task), with no note, reads as before: the day that row came in', () => {
    let state = approve({ items: [], documents: [] }, F, [FRAMING, paint('')]);
    state = approve(state, G, [FRAMING, 'Paint,Alpha,Lot,09/22/2026,09/28/2026,100']);
    expect(shown(state).filter(item => item.taskName === 'Paint').map(item => item.id)).toEqual(['MASTER G-2']);
    expect(completedOnPhone(state)).toEqual(['Paint (Lot): Complete; 100% complete. Last updated Oct 1, 2026.']);
    expect(completedOnWeb(state)).toEqual(completedOnPhone(state));
  });
});
