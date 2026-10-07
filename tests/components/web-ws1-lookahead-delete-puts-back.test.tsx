import { act, fireEvent, render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import {
  DAVE_WEB_DELETE_WITH_CHANGES_LABEL,
  daveWebScheduleDocumentDeleteNote,
  planDAVEWebScheduleDocumentDelete,
} from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot, DAVEWebReferenceDocument } from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted, scheduleLookaheadDeleteNote } from '../../services/ScheduleLookahead';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// Open item, web batch WS1 item 4 (6 Oct 2026): master M lists Framing
// 10/01-10/11. Lookahead L1 lists only Framing, at 60% (no task of its own).
// Lookahead L2 (Roof only) replaces L1 (owner answer Q25): Framing shows the
// master's dates and still reads 60%. On the phone, deleting L1 offers
// "Delete PDF Only" (keeps the 60%) and "Delete PDF + Items" (puts back what
// L1 changed: 0%). The web offered only "Delete Document", which keeps it:
// no web button put it back.
//
// The states are made the phone's way (the real CSV normalizer, the
// approval's merge, the shown-schedule pick), as in
// review-n2-sched-web-document-only-delete.test.ts; the page is the shell
// harness of desktop-lookahead-document.test.tsx. Synthetic data.

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children }: { children: React.ReactNode }) => (
      React.createElement(View, null, children)
    ),
  };
});
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/documents',
  useRouter: () => ({ setParams: jest.fn() }),
}));
jest.mock('../../services/VitruviusDesktopPreferences', () => ({
  VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY: 'vitruvius.display-name',
  formatVitruviusDesktopGreeting: () => 'Good morning, David',
  readVitruviusDesktopDisplayName: () => 'David',
  writeVitruviusDesktopDisplayName: (value: string) => value.trim(),
}));
jest.mock('../../services/FieldNoteDesktopDataSource', () => ({
  desktopFieldNoteDataSource: {
    list: jest.fn(async () => []),
    save: jest.fn(),
    update: jest.fn(),
  },
}));

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

/** A CSV's rows through the real normalizer, with the import's provenance. */
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}

/** Approving a schedule on the phone: the merge, then a master is made current, a lookahead added. */
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: lookahead,
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]),
    documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}

/** "Delete PDF + Items" as the phone does it, through the shared delete helper. */
function phoneDeleteWithItems(state: State, document: ReferenceDocument, at: string): State {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const restored = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at }).map(item => [item.id, item]));
  return { items: kept.map(item => restored.get(item.id) || item), documents };
}

const AT = '2026-09-16T12:00:00.000Z';
const CLOUD_AT = '2026-09-15T13:00:00.000Z';
const asWeb = (items: readonly ScheduleItem[]) => items.map(item => ({ ...item, projectId: 'alpha', cloudUpdatedAt: CLOUD_AT })) as DAVEWebScheduleItem[];
const asPhone = (item: ScheduleItem) => { const { projectId: _project, cloudUpdatedAt: _cloud, ...rest } = item as ScheduleItem & { cloudUpdatedAt?: unknown }; return rest as ScheduleItem; };
const linkedOf = (state: State, document: ReferenceDocument) => scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
const webDocument = (state: State, document: ReferenceDocument, replaced: boolean): DAVEWebReferenceDocument => ({
  ...document,
  mimeType: 'text/csv',
  cloudUpdatedAt: CLOUD_AT,
  linkedScheduleItems: asWeb(linkedOf(state, document)).map(item => ({ id: item.id, cloudUpdatedAt: item.cloudUpdatedAt })),
  importedScheduleItemCount: 1,
  lookaheadReplaced: replaced ? 'Replaced by the lookahead of Sep 15, 2026' : null,
}) as DAVEWebReferenceDocument;
const webSnapshot = (state: State, replaced: readonly ReferenceDocument[]) => ({
  scheduleItems: asWeb(shown(state)),
  knownScheduleItems: asWeb(state.items),
  referenceDocuments: state.documents.map(document => webDocument(state, document, replaced.includes(document))),
});
/** The web's delete: its plan's task writes, then the deletion records. */
function webDelete(state: State, document: ReferenceDocument, keepTasks: boolean): State {
  const revisions = planDAVEWebScheduleDocumentDelete({ snapshot: webSnapshot(state, [document]), document: webDocument(state, document, true), updatedAt: AT, keepTasks });
  const written = new Map(revisions.map(revision => [revision.item.id, asPhone(revision.item as ScheduleItem)]));
  const removedIds = new Set(keepTasks ? [] : linkedOf(state, document).map(item => item.id));
  return { items: state.items.filter(item => !removedIds.has(item.id)).map(item => written.get(item.id) || item), documents: state.documents.filter(other => other.id !== document.id) };
}

const M = schedule('MASTER M', '2026-09-01T12:00:00.000Z');
const L1 = schedule('LOOKAHEAD L1', '2026-09-08T12:00:00.000Z', 'lookahead');
const L2 = schedule('LOOKAHEAD L2', '2026-09-15T12:00:00.000Z', 'lookahead');
const onM = approve(EMPTY, M, ['Framing,Alpha,Lot,10/01/2026,10/11/2026,', 'Roof,Alpha,Lot,10/13/2026,10/21/2026,']);
const ROOF_L2 = 'Roof,Alpha,Lot,10/14/2026,10/22/2026,';
/** L1 lists only Framing, at 60%: no task of its own. L2 (Roof only) replaces it. */
const noDetail = approve(approve(onM, L1, ['Framing,Alpha,Lot,10/05/2026,10/15/2026,60']), L2, [ROOF_L2]);
/** L1 only re-dates Framing, with no percent: replaced, the task already shows the master's dates, so nothing he sees goes back. */
const datesOnly = approve(approve(onM, L1, ['Framing,Alpha,Lot,10/05/2026,10/15/2026,']), L2, [ROOF_L2]);
const framing = (state: State) => `${one(state, 'Framing').startDate}-${one(state, 'Framing').finishDate} ${one(state, 'Framing').percentComplete}%`;
const NOTE = ' Delete Document + Its Changes also puts back the earlier progress of 1 task this lookahead changed.';

describe('a replaced lookahead with no task of its own: what its delete can put back (WS1 item 4)', () => {
  it('guard (the state): L1 has no task of its own, and Framing shows the master\'s dates at L1\'s 60%', () => {
    expect(linkedOf(noDetail, L1)).toEqual([]);
    expect(framing(noDetail)).toBe('10/01/2026-10/11/2026 60%');
  });

  it('the dialog\'s sentence is the phone\'s, with the web\'s button', () => {
    const phoneSays = scheduleLookaheadDeleteNote(noDetail.items, L1, [], noDetail.documents);
    expect(phoneSays).toBe(' Delete PDF + Items also puts back the earlier progress of 1 task this lookahead changed.');
    expect(DAVE_WEB_DELETE_WITH_CHANGES_LABEL).toBe('Delete Document + Its Changes');
    expect(daveWebScheduleDocumentDeleteNote({ snapshot: webSnapshot(noDetail, [L1]), document: webDocument(noDetail, L1, true) })).toBe(NOTE);
  });

  it('guard (the plan under the new button was already right): it writes the rows the phone\'s Delete PDF + Items writes, Framing back at 0%', () => {
    const web = webDelete(noDetail, L1, false);
    expect(framing(web)).toBe('10/01/2026-10/11/2026 0%');
    expect(web.items).toEqual(phoneDeleteWithItems(noDetail, L1, AT).items);
  });

  it('guard: "Delete Document Only" still keeps the 60%', () => {
    expect(framing(webDelete(noDetail, L1, true))).toBe('10/01/2026-10/11/2026 60%');
  });

  it('guard: nothing is said when nothing he sees would go back', () => {
    expect(linkedOf(datesOnly, L1)).toEqual([]);
    expect(daveWebScheduleDocumentDeleteNote({ snapshot: webSnapshot(datesOnly, [L1]), document: webDocument(datesOnly, L1, true) })).toBe('');
  });
});

const mockAuth = {
  phase: 'ready',
  userEmail: 'pm@example.com',
  sessionExpiresAt: null,
  snapshot: null as DAVEWebReadOnlySnapshot | null,
  freshness: {
    status: 'connected',
    lastSuccessfulRefreshAt: '2026-09-30T12:00:00.000Z',
    lastAttemptAt: '2026-09-30T12:00:00.000Z',
    consecutiveFailures: 0,
  },
  message: null,
  refreshSnapshot: jest.fn(async () => true),
  setCurrentSchedule: jest.fn(async () => 'project'),
  setCurrentDocument: jest.fn(async () => undefined),
  updateDocument: jest.fn(async () => undefined),
  deleteDocument: jest.fn(async (_document: DAVEWebReferenceDocument, _deleteLinkedTasks: boolean) => undefined),
  uploadDocument: jest.fn(),
  getArtifactUrl: jest.fn(),
  loadDocumentCoverageSummary: jest.fn(async () => { throw new Error('offline'); }),
  loadDocumentProof: jest.fn(),
  enqueueDocumentPreparation: jest.fn(async () => undefined),
};

jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));

function workspace(state: State, replaced: readonly ReferenceDocument[]) {
  mockAuth.snapshot = {
    projects: [{ id: 'alpha', name: 'Alpha' } as DAVEWebReadOnlySnapshot['projects'][number]],
    ...webSnapshot(state, replaced),
    projectUpdates: [],
    refreshedAt: '2026-09-30T12:00:00.000Z',
  };
}

jest.setTimeout(30_000);

beforeAll(() => {
  type TestWindow = { addEventListener?: jest.Mock; removeEventListener?: jest.Mock };
  const root = globalThis as unknown as { window?: unknown };
  const browserWindow = (root.window ?? {}) as TestWindow;
  root.window = browserWindow;
  browserWindow.addEventListener = jest.fn();
  browserWindow.removeEventListener = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the web\'s delete dialog for that lookahead (WS1 item 4)', () => {
  it('offers both choices, says what each does, and "Delete Document + Its Changes" deletes with the put-back', async () => {
    workspace(noDetail, [L1]);
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    fireEvent.press(screen.getByLabelText('Delete LOOKAHEAD L1'));

    expect(screen.getByText('Delete “LOOKAHEAD L1”?')).toBeTruthy();
    expect(screen.getByText(/No linked imported tasks were found\. Delete Document \+ Its Changes also puts back the earlier progress of 1 task this lookahead changed\. Delete Document Only leaves those tasks as they show now\./)).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    expect(screen.getByText('Delete Document Only')).toBeTruthy();
    expect(screen.queryByText('Delete Document')).toBeNull();

    await act(async () => { fireEvent.press(screen.getByText('Delete Document + Its Changes')); });
    expect(mockAuth.deleteDocument).toHaveBeenCalledTimes(1);
    expect(mockAuth.deleteDocument.mock.calls[0][0].id).toBe(L1.id);
    expect(mockAuth.deleteDocument.mock.calls[0][1]).toBe(true);
    expect(screen.getByText('Lookahead deleted, and what it had changed on the master schedule\'s tasks was put back. It is protected from returning on another device.')).toBeTruthy();
  });

  it('"Delete Document Only" deletes the file alone, as before', async () => {
    workspace(noDetail, [L1]);
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    fireEvent.press(screen.getByLabelText('Delete LOOKAHEAD L1'));
    await act(async () => { fireEvent.press(screen.getByText('Delete Document Only')); });
    expect(mockAuth.deleteDocument).toHaveBeenCalledTimes(1);
    expect(mockAuth.deleteDocument.mock.calls[0][1]).toBe(false);
  });

  it('guard: with nothing to put back there is one button, "Delete Document", as before', () => {
    workspace(datesOnly, [L1]);
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    fireEvent.press(screen.getByLabelText('Delete LOOKAHEAD L1'));
    expect(screen.getByText('Delete Document')).toBeTruthy();
    expect(screen.queryByText('Delete Document Only')).toBeNull();
    expect(screen.queryByText('Delete Document + Its Changes')).toBeNull();
  });

  it('guard: the lookahead in effect is still not deleted on the web', () => {
    workspace(noDetail, [L1]);
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    expect(screen.queryByLabelText('Delete LOOKAHEAD L2')).toBeNull();
    expect(screen.queryByLabelText('Delete MASTER M')).toBeNull();
  });
});
