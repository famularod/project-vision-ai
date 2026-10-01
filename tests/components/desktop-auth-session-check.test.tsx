/**
 * Whole-app audit A12 pass 3 L1 (30 Sep 2026). A signed-in owner whose access
 * token had expired opened the web while the refresh could not reach the
 * server. auth-js kept the stored sign-in but answered the session check with
 * an error, so the page set itself to an error, and the start-up
 * INITIAL_SESSION event (sent without a session in that case) cleared the
 * view: the password form, "The desktop session could not be checked.", and
 * no Try Again. A failed session check now opens the "not loaded yet" page
 * with Try Again and the quiet automatic retry; a start-up event without a
 * session no longer clears the view (the check decides). A definite answer
 * (no stored session, SIGNED_OUT, not the owner) still shows the sign-in form.
 */
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
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
const ownerSession = {
  user: { id: 'owner-1', email: 'owner@example.com' },
  expires_at: 1_900_000_000,
} as unknown as Session;
const snapshot = {
  projects: [],
  scheduleItems: [],
  projectUpdates: [],
  referenceDocuments: [],
  refreshedAt: '2026-09-30T14:00:00.000Z',
};
const checkFailed = () => new Error('The desktop session could not be checked.');

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void;
let authListener: AuthListener = () => undefined;
const emit = (event: AuthChangeEvent, session: Session | null) =>
  act(async () => { authListener(event, session); });

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
  root.document = {
    visibilityState: 'visible',
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  mockedGateway.subscribeToAuthStateChange.mockImplementation(listener => {
    authListener = listener;
    return () => undefined;
  });
  mockedGateway.subscribeToAuthorizedOperationalChanges.mockResolvedValue(() => undefined);
  mockedGateway.runAuthorizedMaintenance.mockResolvedValue(undefined);
  mockedGateway.signOut.mockResolvedValue(undefined);
  mockedLoadSnapshot.mockResolvedValue(snapshot as never);
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

test('a session check that could not finish, then the start-up event without a session: Try Again, not the password form', async () => {
  mockedGateway.getSessionStatus
    .mockRejectedValueOnce(checkFailed())
    .mockResolvedValue({ configured: true, session: ownerSession });
  const screen = renderShell();

  await waitFor(() => expect(screen.getByText('Try Again')).toBeTruthy());
  await emit('INITIAL_SESSION', null);

  expect(screen.getByText('Try Again')).toBeTruthy();
  expect(screen.queryByLabelText('Password')).toBeNull();
  expect(screen.queryByText('The desktop session could not be checked.')).toBeNull();
  expect(screen.getByText(/You are still signed in\. The cloud check did not finish/)).toBeTruthy();
  // Nothing of the owner's is shown or read before the owner check passes.
  expect(mockedLoadSnapshot).not.toHaveBeenCalled();

  fireEvent.press(screen.getByText('Try Again'));

  await waitFor(() => expect(screen.queryByText('Try Again')).toBeNull());
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Password')).toBeNull();
});

test('the start-up event without a session arriving first does not show the password form either', async () => {
  let failCheck: (error: Error) => void = () => undefined;
  mockedGateway.getSessionStatus
    .mockImplementationOnce(() => new Promise((_, reject) => { failCheck = reject; }))
    .mockResolvedValue({ configured: true, session: ownerSession });
  const screen = renderShell();

  await emit('INITIAL_SESSION', null);
  expect(screen.queryByLabelText('Password')).toBeNull();
  expect(screen.getByText('Checking the browser session…')).toBeTruthy();

  await act(async () => { failCheck(checkFailed()); });

  await waitFor(() => expect(screen.getByText('Try Again')).toBeTruthy());
  expect(screen.queryByLabelText('Password')).toBeNull();
});

test('after a failed session check it tries again on its own, and opens once the check answers', async () => {
  jest.useFakeTimers();
  mockedGateway.getSessionStatus
    .mockRejectedValueOnce(checkFailed())
    .mockRejectedValueOnce(checkFailed())
    .mockResolvedValue({ configured: true, session: ownerSession });
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
  expect(mockedGateway.getSessionStatus).toHaveBeenCalledTimes(1);

  await wait(5_000);
  expect(mockedGateway.getSessionStatus).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Try Again')).toBeTruthy();

  await wait(15_000);
  expect(mockedGateway.getSessionStatus).toHaveBeenCalledTimes(3);
  expect(screen.queryByText('Try Again')).toBeNull();
  expect(screen.queryByLabelText('Password')).toBeNull();
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(1);
});

test('a check that finds no stored sign-in shows the sign-in form', async () => {
  mockedGateway.getSessionStatus.mockResolvedValue({ configured: true, session: null });
  const screen = renderShell();

  await waitFor(() => expect(screen.getByLabelText('Password')).toBeTruthy());
  expect(screen.queryByText('Try Again')).toBeNull();
});

test('SIGNED_OUT still clears the view, and the not-the-owner answer still signs this browser out', async () => {
  const { DAVEWebAuthorizationError } = jest.requireActual('../../services/DAVEWebSupabaseClient');
  mockedGateway.getSessionStatus
    .mockRejectedValueOnce(checkFailed())
    .mockResolvedValue({ configured: true, session: ownerSession });
  const screen = renderShell();

  await waitFor(() => expect(screen.getByText('Try Again')).toBeTruthy());
  await emit('SIGNED_OUT', null);
  await waitFor(() => expect(screen.getByLabelText('Password')).toBeTruthy());

  mockedLoadSnapshot.mockRejectedValue(new DAVEWebAuthorizationError());
  await emit('TOKEN_REFRESHED', ownerSession);
  await waitFor(() => expect(mockedGateway.signOut).toHaveBeenCalledWith('local'));
  expect(screen.getByLabelText('Password')).toBeTruthy();
  expect(screen.queryByText('Try Again')).toBeNull();
});
