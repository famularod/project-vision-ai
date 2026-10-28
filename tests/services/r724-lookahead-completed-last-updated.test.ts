/** 7.24 real CSV approval, authoritative selection, phone/web report regression. Synthetic records only. */
import { buildDAVEReportBriefing } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { buildDAVEWebReportDraft } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { scheduleItemsAfterLookaheadDeleted } from '../../services/ScheduleLookahead';
import { buildDAVEReportSourceFingerprint, reportTaskConfirmedAt } from '../../services/DAVEReportIntelligence';
import { sameReportSource } from '../../services/DAVEReportSnapshot';
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
function approve(state: State, source: ReferenceDocument, lines: string[], approvedAt = source.importedAt as string): State {
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv',
    projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id, projectControls: normalizeProjectControls(undefined),
  }));
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt, overlay: source.scheduleRole === 'lookahead',
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

const L = { ...schedule('LOOKAHEAD L', '2026-10-01T12:00:00.000Z'), scheduleRole: 'lookahead' as const };
const L2 = { ...schedule('LOOKAHEAD L2', '2026-10-02T12:00:00.000Z'), scheduleRole: 'lookahead' as const };
const completed = (state: State) => {
  const phone = completedOnPhone(state);
  expect(completedOnWeb(state)).toEqual(phone);
  return phone;
};
const seed = () => noted(approve({ items: [], documents: [] }, F, [FRAMING, paint('20')]), 'Paint', 'Primer on.', '2026-09-09T10:00:00.000Z');

describe('7.24: lookahead completion date beside an older note', () => {
  it('uses the approval day when a lookahead first completes a file-owned task, without changing its provenance', () => {
    const state = approve(seed(), L, [paint('100')]);
    const task = shown(state).find(item => item.taskName === 'Paint')!;
    expect([task.id, task.percentComplete, task.progressConfirmedAt ?? null]).toEqual(['MASTER F-2', 100, null]);
    expect(completed(state)).toEqual(['Paint (Lot): Complete; 100% complete. Last updated Oct 1, 2026.']);
  });

  it('uses approval rather than earlier file selection day', () => {
    const state = approve(seed(), L, [paint('100')], '2026-10-02T12:00:00.000Z');
    expect(completed(state)).toEqual(['Paint (Lot): Complete; 100% complete. Last updated Oct 2, 2026.']);
  });

  it('retains the completion date when a later lookahead leaves percent blank or repeats 100', () => {
    for (const percent of ['', '100']) {
      const state = approve(approve(seed(), L, [paint('100')]), L2, [paint(percent)]);
      expect(completed(state)).toEqual(['Paint (Lot): Complete; 100% complete. Last updated Oct 1, 2026.']);
    }
  });

  it('a later authored note remains later than the lookahead completion', () => {
    const state = noted(approve(seed(), L, [paint('100')]), 'Paint', 'Touch-ups complete.', '2026-10-02T12:00:00.000Z');
    expect(completed(state)).toEqual(['Paint (Lot): Complete; 100% complete. Last updated Oct 2, 2026.']);
  });

  it('a manager-completed task keeps the manager date when a lookahead repeats 100', () => {
    const before = hisPercent(seed(), 'Paint', 100, '2026-09-25T16:00:00.000Z');
    const state = approve(before, L, [paint('100')]);
    expect(completed(state)).toEqual(['Paint (Lot): Complete; 100% complete. Last updated Sep 25, 2026.']);
  });

  it('a later file that reopens then completes the task uses the new completion', () => {
    const L3 = { ...schedule('LOOKAHEAD L3', '2026-10-03T12:00:00.000Z'), scheduleRole: 'lookahead' as const };
    const state = approve(approve(approve(seed(), L, [paint('100')]), L2, [paint('75')]), L3, [paint('100')]);
    expect(completed(state)).toEqual(['Paint (Lot): Complete; 100% complete. Last updated Oct 3, 2026.']);
  });

  it('a changed printed completion day changes the modern source identity in both report formats', () => {
    const fingerprint = (state: State, format: 'project_manager' | 'executive') => buildDAVEReportSourceFingerprint(buildDAVEReportProjectTruths({
      projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never,
      updates: [], scheduleItems: shown(state), knownScheduleItems: state.items, knownScheduleDocuments: state.documents,
      projectAreas: [], referenceDocuments: state.documents, now: NOW,
    }), null, format);
    const before = approve(seed(), L, [paint('100')]);
    const after = approve(seed(), L, [paint('100')], '2026-10-02T12:00:00.000Z');
    for (const format of ['project_manager', 'executive'] as const) {
      expect(sameReportSource(fingerprint(before, format), fingerprint(after, format))).toBe(false);
      expect(fingerprint(before, format)).toBe(fingerprint(JSON.parse(JSON.stringify(before)), format));
    }
  });

  it('an old row with no recorded lookahead completion time keeps the historical fallback', () => {
    const state = approve(seed(), L, [paint('100')]);
    state.items = state.items.map(item => ({ ...item, lookaheadOverlay: item.lookaheadOverlay ? {
      ...item.lookaheadOverlay, lookaheads: item.lookaheadOverlay.lookaheads.map(({ importedAt: _imported, approvedAt: _approved, ...entry }) => entry),
    } : item.lookaheadOverlay }));
    expect(completed(state)).toEqual(['Paint (Lot): Complete; 100% complete. Last updated Sep 9, 2026.']);
  });

  it('an unknown older progress entry prevents inventing a later completion from a repeated 100', () => {
    let state = approve(seed(), L, [paint('100')]);
    state.items = state.items.map(item => ({ ...item, lookaheadOverlay: item.lookaheadOverlay ? {
      ...item.lookaheadOverlay, lookaheads: item.lookaheadOverlay.lookaheads.map(({ percentComplete: _percent, ...entry }) => entry),
    } : item.lookaheadOverlay }));
    state = approve(state, L2, [paint('100')]);
    expect(completed(state)).toEqual(['Paint (Lot): Complete; 100% complete. Last updated Sep 9, 2026.']);
  });

  it('a lookahead deletion does not leave a fake completed line', () => {
    const state = approve(seed(), L, [paint('100')]);
    const items = scheduleItemsAfterLookaheadDeleted(state.items, L, '2026-10-02T12:00:00.000Z', [F]);
    expect(completed({ items, documents: [F] })).toEqual([]);
  });

  it('pure report reads never mutate stored rows or invent confirmation time on missing history', () => {
    const state = approve(seed(), L, [paint('100')]);
    const before = JSON.stringify(state);
    completed(state); completed(state);
    expect(JSON.stringify(state)).toBe(before);
    expect(reportTaskConfirmedAt({ progressConfirmedAt: null, fileProgressPeak: null })).toBeNull();
  });
});
