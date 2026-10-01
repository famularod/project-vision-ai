/**
 * Whole-app audit A12 pass 4 L3 (30 Sep 2026). Someone signed in who is not
 * the owner opened the web on a dropping connection: the owner check said
 * "not the owner", the browser's own sign-out then could not reach the
 * server and threw, and the start-up check took that as "could not finish":
 * "Your projects are not loaded yet. You are still signed in…" with Try
 * Again. Nothing of the owner's was shown, and the next retry reached "not
 * authorized", but the page had told a non-owner he was still signed in.
 *
 * Now, once the owner check has said "not the owner", the page shows the
 * not-authorized sign-in page and never the "not loaded yet" page; the
 * browser's sign-out is retried quietly until it goes through; a later
 * event for the same sign-in reads nothing; and a real sign-in still works.
 */
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopAuthProvider } from '../../components/web-shell/desktop-auth-provider';
import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import {
  DAVEWebAuthorizationError,
  daveWebSupabaseGateway,
} from '../../services/DAVEWebSupabaseClient';

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
      signIn: jest.fn(),
      signOut: jest.fn(),
    },
  };
});

const mockedLoadSnapshot = jest.mocked(loadDAVEWebReadOnlySnapshot);
const mockedGateway = jest.mocked(daveWebSupabaseGateway);
const NOT_AUTHORIZED = 'This account is not authorized for the Vitruvius desktop pilot.';
const visitorSession = {
  user: { id: 'visitor-1', email: 'visitor@example.com' },
  expires_at: 1_900_000_000,
} as unknown as Session;
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
/** What the gateway throws when the browser's sign-out cannot reach the server. */
const signOutFailed = () => new Error('The desktop session could not be closed.');
const ownerCheckIncomplete = () => new Error('The owner check could not be completed. Try again shortly.');

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
  mockedGateway.getSessionStatus.mockResolvedValue({ configured: true, session: visitorSession });
  mockedGateway.subscribeToAuthStateChange.mockImplementation(listener => {
    authListener = listener;
    return () => undefined;
  });
  mockedGateway.subscribeToAuthorizedOperationalChanges.mockResolvedValue(() => undefined);
  mockedGateway.runAuthorizedMaintenance.mockResolvedValue(undefined);
  mockedLoadSnapshot.mockRejectedValue(new DAVEWebAuthorizationError());
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

function expectNotAuthorizedPage(screen: ReturnType<typeof render>) {
  expect(screen.getByText(NOT_AUTHORIZED)).toBeTruthy();
  expect(screen.getByLabelText('Password')).toBeTruthy();
  expect(screen.queryByText('Your projects are not loaded yet')).toBeNull();
  expect(screen.queryByText(/You are still signed in/)).toBeNull();
  expect(screen.queryByText('Try Again')).toBeNull();
  expect(screen.queryByText('Account and Sync')).toBeNull();
}

const settle = () => act(async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
});
const wait = async (ms: number) => {
  await act(async () => { jest.advanceTimersByTime(ms); });
  await settle();
};

test('not the owner, and the browser sign-out fails: the not-authorized page, not "still signed in"', async () => {
  mockedGateway.signOut.mockRejectedValue(signOutFailed());
  const screen = renderShell();

  await waitFor(() => expect(mockedGateway.signOut).toHaveBeenCalledWith('local'));
  await waitFor(() => expect(screen.getByText(NOT_AUTHORIZED)).toBeTruthy());
  expectNotAuthorizedPage(screen);
});

test('the browser sign-out is retried quietly until it goes through, and the page stays the same', async () => {
  jest.useFakeTimers();
  mockedGateway.signOut
    .mockRejectedValueOnce(signOutFailed())
    .mockRejectedValueOnce(signOutFailed())
    .mockImplementation(async () => {
      // A sign-out that goes through tells the page, as auth-js does.
      authListener('SIGNED_OUT', null);
    });
  const screen = renderShell();

  await settle();
  expect(mockedGateway.signOut).toHaveBeenCalledTimes(1);
  expectNotAuthorizedPage(screen);

  await wait(5_000);
  expect(mockedGateway.signOut).toHaveBeenCalledTimes(2);
  expectNotAuthorizedPage(screen);

  await wait(15_000);
  expect(mockedGateway.signOut).toHaveBeenCalledTimes(3);
  expectNotAuthorizedPage(screen);

  // Through: no more attempts.
  await wait(120_000);
  expect(mockedGateway.signOut).toHaveBeenCalledTimes(3);
  expect(mockedGateway.signOut.mock.calls.every(([scope]) => scope === 'local')).toBe(true);
  expectNotAuthorizedPage(screen);
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(1);
});

test('a later event for the same sign-in reads nothing and never shows "not loaded yet"', async () => {
  mockedGateway.signOut.mockRejectedValue(signOutFailed());
  const screen = renderShell();
  await waitFor(() => expect(screen.getByText(NOT_AUTHORIZED)).toBeTruthy());
  // The connection is still dropping: a second owner check would not finish.
  mockedLoadSnapshot.mockRejectedValue(ownerCheckIncomplete());

  await emit('TOKEN_REFRESHED', visitorSession);
  await emit('INITIAL_SESSION', visitorSession);

  expectNotAuthorizedPage(screen);
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Checking the browser session…')).toBeNull();
});

test('the owner signing in afterwards opens the workspace, and the quiet sign-out stops', async () => {
  jest.useFakeTimers();
  mockedGateway.signOut.mockRejectedValue(signOutFailed());
  const screen = renderShell();
  await settle();
  expectNotAuthorizedPage(screen);

  mockedGateway.signIn.mockResolvedValue({ ok: true, session: ownerSession });
  mockedLoadSnapshot.mockResolvedValue(snapshot as never);
  fireEvent.changeText(screen.getByLabelText('Email'), 'owner@example.com');
  fireEvent.changeText(screen.getByLabelText('Password'), 'synthetic-test-password');
  fireEvent.press(screen.getByText('Sign in securely'));
  await settle();

  expect(screen.queryByLabelText('Password')).toBeNull();
  expect(screen.queryByText(NOT_AUTHORIZED)).toBeNull();
  const attempts = mockedGateway.signOut.mock.calls.length;
  await wait(120_000);
  expect(mockedGateway.signOut).toHaveBeenCalledTimes(attempts);
  expect(screen.queryByLabelText('Password')).toBeNull();
});

test('signing in again with the same account checks it again rather than reusing the old answer', async () => {
  mockedGateway.signOut.mockRejectedValue(signOutFailed());
  const screen = renderShell();
  await waitFor(() => expect(screen.getByText(NOT_AUTHORIZED)).toBeTruthy());

  // Access was granted meanwhile: this time the owner check passes.
  mockedGateway.signIn.mockResolvedValue({ ok: true, session: visitorSession });
  mockedLoadSnapshot.mockResolvedValue(snapshot as never);
  fireEvent.changeText(screen.getByLabelText('Email'), 'visitor@example.com');
  fireEvent.changeText(screen.getByLabelText('Password'), 'synthetic-test-password');
  fireEvent.press(screen.getByText('Sign in securely'));

  await waitFor(() => expect(screen.queryByLabelText('Password')).toBeNull());
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(2);
});

test('the owner signing in from another tab opens the workspace here too', async () => {
  mockedGateway.signOut.mockRejectedValue(signOutFailed());
  const screen = renderShell();
  await waitFor(() => expect(screen.getByText(NOT_AUTHORIZED)).toBeTruthy());

  mockedLoadSnapshot.mockResolvedValue(snapshot as never);
  await emit('SIGNED_IN', ownerSession);
  await emit('TOKEN_REFRESHED', ownerSession);

  await waitFor(() => expect(screen.queryByLabelText('Password')).toBeNull());
  expect(screen.queryByText(NOT_AUTHORIZED)).toBeNull();
});
