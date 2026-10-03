/**
 * Audit round 2 follow-up (30 Sep 2026): when the owner check could not
 * finish as the page opened (before any workspace had loaded), the web showed
 * the email and password form to someone who was still signed in, said "Try
 * refreshing the workspace" with no button to do it, and never tried again on
 * its own (automatic refresh only ran once a workspace had loaded). It now
 * says he is still signed in, offers Try Again, and retries after 5 s, 15 s,
 * 30 s, then every minute while the tab is visible.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopAuthProvider } from '../../components/web-shell/desktop-auth-provider';
import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';

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
  usePathname: () => '/settings',
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
jest.mock('../../services/DAVEWebReadOnlyRepository', () => ({
  loadDAVEWebReadOnlySnapshot: jest.fn(),
}));
jest.mock('../../services/DAVEWebSupabaseClient', () => {
  const actual = jest.requireActual('../../services/DAVEWebSupabaseClient');
  return {
    ...actual,
    daveWebSupabaseGateway: {
      getSessionStatus: jest.fn(),
      subscribeToAuthStateChange: jest.fn(),
      subscribeToAuthorizedOperationalChanges: jest.fn(),
      runAuthorizedMaintenance: jest.fn(),
      signOut: jest.fn(),
    },
  };
});

const mockedLoadSnapshot = jest.mocked(loadDAVEWebReadOnlySnapshot);
const mockedGateway = jest.mocked(daveWebSupabaseGateway);
const ownerCheckIncomplete = () => new Error('The owner check could not be completed. Try again shortly.');
const snapshot = {
  projects: [],
  scheduleItems: [],
  projectUpdates: [],
  referenceDocuments: [],
  refreshedAt: '2026-09-30T14:00:00.000Z',
};

/** A minimal browser document whose visibility the test controls. */
const page = {
  visibilityState: 'visible' as 'visible' | 'hidden',
  listeners: new Set<() => void>(),
  show(state: 'visible' | 'hidden') {
    this.visibilityState = state;
    this.listeners.forEach(listener => listener());
  },
};
const root = globalThis as unknown as { window?: Record<string, unknown>; document?: unknown };
const originalDocument = root.document;
const originalBroadcastChannel = globalThis.BroadcastChannel;

beforeAll(() => {
  root.window = root.window ?? {};
  root.window.addEventListener = jest.fn();
  root.window.removeEventListener = jest.fn();
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
});
afterAll(() => {
  root.document = originalDocument;
  globalThis.BroadcastChannel = originalBroadcastChannel;
});

beforeEach(() => {
  jest.clearAllMocks();
  page.visibilityState = 'visible';
  page.listeners.clear();
  root.document = {
    get visibilityState() { return page.visibilityState; },
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'visibilitychange') page.listeners.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === 'visibilitychange') page.listeners.delete(listener);
    },
  };
  mockedGateway.getSessionStatus.mockResolvedValue({
    configured: true,
    session: {
      user: { id: 'owner-1', email: 'owner@example.com' },
      expires_at: 1_900_000_000,
    } as never,
  });
  mockedGateway.subscribeToAuthStateChange.mockReturnValue(() => undefined);
  mockedGateway.subscribeToAuthorizedOperationalChanges.mockResolvedValue(() => undefined);
  mockedGateway.runAuthorizedMaintenance.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

function renderShell() {
  return render(
    <DesktopAuthProvider>
      <DesktopReadOnlyShell page="settings" />
    </DesktopAuthProvider>,
  );
}

test('a signed-in owner whose first check could not finish gets Try Again, not the password form', async () => {
  mockedLoadSnapshot
    .mockRejectedValueOnce(ownerCheckIncomplete())
    .mockResolvedValue(snapshot as never);
  const screen = renderShell();

  await waitFor(() => expect(screen.getByText('Try Again')).toBeTruthy());
  expect(screen.queryByLabelText('Password')).toBeNull();
  expect(screen.queryByText('Sign in securely')).toBeNull();
  expect(screen.getByText(/You are still signed in as owner@example\.com/)).toBeTruthy();

  fireEvent.press(screen.getByText('Try Again'));

  await waitFor(() => expect(screen.queryByText('Try Again')).toBeNull());
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(2);
  expect(screen.queryByLabelText('Password')).toBeNull();
});

test('it tries again on its own after 5 s, 15 s and 30 s, then every minute while the tab is visible', async () => {
  jest.useFakeTimers();
  mockedLoadSnapshot.mockRejectedValue(ownerCheckIncomplete());
  const screen = renderShell();
  const settle = () => act(async () => {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
  const wait = async (ms: number) => {
    await act(async () => { jest.advanceTimersByTime(ms); });
    await settle();
  };

  await settle();
  expect(screen.getByText('Try Again')).toBeTruthy();
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(1);

  await wait(4_999);
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(1);
  await wait(1);
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(2);
  await wait(15_000);
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(3);
  await wait(30_000);
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(4);
  await wait(60_000);
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(5);
  await wait(60_000);
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(6);

  // A hidden tab waits, and tries as soon as it is looked at again.
  page.visibilityState = 'hidden';
  await wait(120_000);
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(6);
  await act(async () => { page.show('visible'); });
  await settle();
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(7);

  // Once the cloud answers, the workspace opens and the retries stop.
  mockedLoadSnapshot.mockResolvedValue(snapshot as never);
  await wait(60_000);
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(8);
  expect(screen.queryByText('Try Again')).toBeNull();
  expect(screen.queryByLabelText('Password')).toBeNull();
});

test('a definite refusal still shows the sign-in form', async () => {
  const { DAVEWebAuthorizationError } = jest.requireActual('../../services/DAVEWebSupabaseClient');
  mockedLoadSnapshot.mockRejectedValue(new DAVEWebAuthorizationError());
  mockedGateway.signOut.mockResolvedValue(undefined);
  const screen = renderShell();

  await waitFor(() => expect(screen.getByLabelText('Password')).toBeTruthy());
  expect(screen.queryByText('Try Again')).toBeNull();
});
