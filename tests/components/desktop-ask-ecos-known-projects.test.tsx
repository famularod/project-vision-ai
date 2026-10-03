import { render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';

// Owner answer Q20 (30 Sep 2026; audit A9 pass 1 #2): desktop Ask ECOS checks a
// question against the user's unarchived projects, so "4000 psi" is asked, not
// refused as project 4000. Synthetic data.

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
  usePathname: () => '/ask-ecos',
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

type AskInput = { projectId: string; projectName: string; question: string };
const mockWorkspace: { onAsk: ((input: AskInput) => Promise<unknown>) | null } = { onAsk: null };
jest.mock('../../components/web-shell/desktop-ask-ecos', () => ({
  DesktopAskECOSWorkspace: (props: { onAsk: (input: AskInput) => Promise<unknown> }) => {
    mockWorkspace.onAsk = props.onAsk;
    return null;
  },
}));

const snapshot: DAVEWebReadOnlySnapshot = {
  projects: [
    { id: 'project-2321', name: '2321 Compliance Project' },
    { id: 'project-2375', name: '2375 Compliance Project' },
  ] as DAVEWebReadOnlySnapshot['projects'],
  scheduleItems: [],
  projectUpdates: [],
  referenceDocuments: [],
  // Audit A9 pass 3 L1: closed projects ride along so their numbers are refused.
  closedProjectNames: ['2400 Closed Warehouse'],
  refreshedAt: '2026-09-30T12:00:00.000Z',
};

const mockAuth = {
  phase: 'ready',
  userEmail: 'pm@example.com',
  sessionExpiresAt: null,
  snapshot,
  freshness: {
    status: 'connected',
    lastSuccessfulRefreshAt: snapshot.refreshedAt,
    lastAttemptAt: snapshot.refreshedAt,
    consecutiveFailures: 0,
  },
  message: null,
  refreshSnapshot: jest.fn(async () => true),
  askProjectQuestion: jest.fn(async () => ({ answer: 'The footings use 4000 psi concrete.' })),
};

jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));

describe('desktop Ask ECOS project list (owner answer Q20)', () => {
  beforeAll(() => {
    type TestWindow = { addEventListener?: jest.Mock; removeEventListener?: jest.Mock };
    const root = globalThis as unknown as { window?: unknown };
    const browserWindow = (root.window ?? {}) as TestWindow;
    root.window = browserWindow;
    browserWindow.addEventListener = jest.fn();
    browserWindow.removeEventListener = jest.fn();
  });

  it('asks with the names of the unarchived projects in the desktop snapshot', async () => {
    render(<DesktopReadOnlyShell page="ask-ecos" />);
    expect(mockWorkspace.onAsk).not.toBeNull();
    const input = {
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
      question: 'What strength is the 4000 psi concrete at the footings?',
    };
    await mockWorkspace.onAsk!(input);
    expect(mockAuth.askProjectQuestion).toHaveBeenCalledWith({
      ...input,
      knownProjectNames: ['2321 Compliance Project', '2375 Compliance Project'],
      closedProjectNames: ['2400 Closed Warehouse'],
    });
  });
});
