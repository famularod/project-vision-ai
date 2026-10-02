import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';

// Whole-app audit A12 pass 3 L2 and A8-L2 (30 Sep 2026), owner answer Q22: a
// lookahead adds to the master and is in effect by its role whatever its
// current flag, which the cloud's activation of a master clears.
// L2: after any master activation the web treated the lookahead as an
// ordinary document: "Edit Project Document Details" let its category be
// changed (ending its role and making it deletable without putting the
// master's dates back), its badge turned grey, and the save notice said
// "before making it current".
// A8-L2: a lookahead cannot be deleted on the web; its notice said it was
// protected as the current schedule. It now says it is deleted on the iPhone
// or iPad, where Delete PDF + Items puts the master's dates back.
// Owner answer Q25 (2 Oct 2026): a lookahead newer ones replaced is no longer
// in effect: a prior version, "Replaced by the lookahead of <date>", which
// the web may delete. Synthetic data; same shell harness as
// owner-answer-q15-web-make-current.test.tsx.

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

function scheduleDocument(
  id: string,
  extra: Partial<DAVEWebReferenceDocument> = {},
): DAVEWebReferenceDocument {
  return {
    id,
    name: id,
    originalFileName: `${id}.csv`,
    uri: '',
    mimeType: 'text/csv',
    category: 'Schedules',
    notes: '',
    isCurrent: false,
    importedAt: '2026-09-01T12:00:00.000Z',
    projectId: null,
    projectName: 'Alpha',
    projectNames: ['Alpha'],
    importBatchId: `batch-${id}`,
    cloudUpdatedAt: '2026-09-30T12:00:00.000Z',
    linkedScheduleItems: [],
    importedScheduleItemCount: 2,
    ...extra,
  };
}

const master = scheduleDocument('Alpha master', { isCurrent: true, importedAt: '2026-09-20T12:00:00.000Z' });
// The master's activation cleared its flag; its role keeps it in effect.
const lookahead = scheduleDocument('Alpha lookahead wk 40', {
  scheduleRole: 'lookahead',
  importedAt: '2026-09-25T12:00:00.000Z',
});
const prior = scheduleDocument('Alpha rev 1', { importedAt: '2026-09-01T12:00:00.000Z' });

const LOOKAHEAD_BADGE = 'Lookahead: adds to the master schedule for Alpha';
const LOOKAHEAD_NOTICE =
  "Lookahead · adds to the master schedule. Delete it on the iPhone or iPad: Delete PDF + Items there also puts the master schedule's dates back.";

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
  deleteDocument: jest.fn(),
  uploadDocument: jest.fn(),
  getArtifactUrl: jest.fn(),
  loadDocumentCoverageSummary: jest.fn(async () => { throw new Error('offline'); }),
  loadDocumentProof: jest.fn(),
  enqueueDocumentPreparation: jest.fn(async () => undefined),
};

jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));

function withDocuments(referenceDocuments: DAVEWebReferenceDocument[]) {
  mockAuth.snapshot = {
    projects: [{ id: 'alpha', name: 'Alpha' } as DAVEWebReadOnlySnapshot['projects'][number]],
    scheduleItems: [],
    projectUpdates: [],
    referenceDocuments,
    refreshedAt: '2026-09-30T12:00:00.000Z',
  };
}

const textColor = (node: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(node.props.style as never) as { color?: unknown } | undefined)?.color;

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
  withDocuments([master, lookahead, prior]);
});

describe('a lookahead whose current flag was cleared keeps its role on the web (A12 pass 3 L2)', () => {
  it('cannot be edited into an ordinary document', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);

    // An ordinary prior version can be edited, as before.
    fireEvent.press(screen.getByLabelText('View Alpha rev 1'));
    expect(await screen.findByText('Edit Project Document Details')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('View Alpha lookahead wk 40'));
    expect(screen.queryByText('Edit Project Document Details')).toBeNull();
    expect(screen.queryByLabelText('Edit project document details for Alpha lookahead wk 40')).toBeNull();

    // The master stays as it was.
    fireEvent.press(screen.getByLabelText('View Alpha master'));
    expect(screen.queryByText('Edit Project Document Details')).toBeNull();
  });

  it('reads like the phone and is marked in effect, like the master, in the list and the details', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    const masterBadge = screen.getAllByText('Current')[0];
    const priorBadge = screen.getAllByText('Prior version')[0];

    fireEvent.press(screen.getByLabelText('View Alpha lookahead wk 40'));
    const badges = await screen.findAllByText(LOOKAHEAD_BADGE);

    expect(badges.length).toBe(2);
    expect(textColor(masterBadge)).not.toEqual(textColor(priorBadge));
    badges.forEach(badge => expect(textColor(badge)).toEqual(textColor(masterBadge)));
  });
});

describe('the web says where a lookahead is deleted (A12 pass 3 A8-L2)', () => {
  it('its notice names the iPhone or iPad and Delete PDF + Items, not the current schedule', async () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);

    fireEvent.press(screen.getByLabelText('View Alpha lookahead wk 40'));

    expect(await screen.findByText(LOOKAHEAD_NOTICE)).toBeTruthy();
    expect(screen.queryByText('Current schedule · protected from deletion')).toBeNull();

    // The master's notice is unchanged.
    fireEvent.press(screen.getByLabelText('View Alpha master'));
    expect(screen.getByText('Current schedule · protected from deletion')).toBeTruthy();
    expect(screen.queryByText(LOOKAHEAD_NOTICE)).toBeNull();
  });

  it('the Current schedule group says a lookahead in it is deleted on the iPhone or iPad', () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);

    expect(screen.getByText(
      'The schedule currently used for project planning. It is protected from deletion. A lookahead that adds to it is deleted on the iPhone or iPad.',
    )).toBeTruthy();

    withDocuments([master, prior]);
    screen.rerender(<DesktopReadOnlyShell page="documents" />);
    expect(screen.getByText(
      'The schedule currently used for project planning. It is protected from deletion.',
    )).toBeTruthy();
  });

  it('a delete question left open while the document became a lookahead says the same', () => {
    const screen = render(<DesktopReadOnlyShell page="documents" />);

    // Only Alpha rev 1 can be deleted here: its row's Delete.
    fireEvent.press(screen.getAllByText('Delete')[0]);
    expect(screen.getByText('Delete “Alpha rev 1”?')).toBeTruthy();

    // Another device marked it a lookahead while the question was open.
    withDocuments([master, lookahead, { ...prior, scheduleRole: 'lookahead' }]);
    screen.rerender(<DesktopReadOnlyShell page="documents" />);

    expect(screen.getByText('Delete “Alpha rev 1”?')).toBeTruthy();
    expect(screen.getByText(
      "This lookahead adds to the master schedule. Delete it on the iPhone or iPad: Delete PDF + Items there also puts the master schedule's dates back.",
    )).toBeTruthy();
    expect(screen.getByText('Keep Lookahead')).toBeTruthy();
    expect(screen.queryByText(/current project schedule and is protected/)).toBeNull();
    expect(screen.queryByText('Delete Document')).toBeNull();
  });
});

describe('owner answer Q25: a lookahead a newer one replaced is a prior version on the web', () => {
  // As the snapshot reads it (loadDAVEWebReadOnlySnapshot): replaced by the week 41 lookahead.
  const replaced = scheduleDocument('Alpha lookahead wk 39', {
    scheduleRole: 'lookahead',
    isCurrent: true,
    importedAt: '2026-09-18T12:00:00.000Z',
    lookaheadReplaced: 'Replaced by the lookahead of Sep 25, 2026',
  });

  it('reads "Replaced by the lookahead of <date>", in the prior group, and can be deleted', async () => {
    withDocuments([master, lookahead, replaced]);
    const screen = render(<DesktopReadOnlyShell page="documents" />);
    const priorBadge = screen.getAllByText('Replaced by the lookahead of Sep 25, 2026')[0];
    expect(textColor(priorBadge)).not.toEqual(textColor(screen.getAllByText('Current')[0]));

    fireEvent.press(screen.getByLabelText('View Alpha lookahead wk 39'));
    expect(await screen.findAllByText('Replaced by the lookahead of Sep 25, 2026')).toHaveLength(2);
    expect(screen.queryByText(LOOKAHEAD_NOTICE)).toBeNull();

    // Its row's Delete (the only one offered) asks as for any prior version.
    fireEvent.press(screen.getAllByText('Delete')[0]);
    expect(screen.getByText('Delete “Alpha lookahead wk 39”?')).toBeTruthy();
    expect(screen.getByText('Delete Document')).toBeTruthy();
    expect(screen.queryByText('Keep Lookahead')).toBeNull();
  });
});
