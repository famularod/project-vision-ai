/**
 * Owner answer Q21 (30 Sep 2026) on the web's Settings page: Sign out asks
 * which devices, in the same inline confirm style as Delete. This Computer
 * signs out this browser only; All Devices also signs out the iPhone and
 * iPad; with no connection All Devices signs nothing out and says so.
 * (The request each choice sends is checked in
 * tests/services/owner-answer-q21-web-sign-out.test.ts.)
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { DAVEWebSignOutNeedsConnectionError } from '../../services/DAVEWebSupabaseClient';

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

const mockAuth: Record<string, any> = {
  phase: 'ready',
  userEmail: 'owner@example.com',
  sessionExpiresAt: null,
  snapshot: {
    projects: [],
    scheduleItems: [],
    projectUpdates: [],
    referenceDocuments: [],
    refreshedAt: '2026-09-30T14:00:02.000Z',
  },
  freshness: {
    status: 'connected',
    lastSuccessfulRefreshAt: '2026-09-30T14:00:02.000Z',
    lastAttemptAt: '2026-09-30T14:00:02.000Z',
    consecutiveFailures: 0,
  },
  message: null,
  signInWithPassword: jest.fn(),
  signOutOfDesktop: jest.fn(async () => undefined),
  refreshSnapshot: jest.fn(async () => true),
  getArtifactUrl: jest.fn(),
  restoreMissingTasks: jest.fn(),
};

jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));

beforeAll(() => {
  const root = globalThis as unknown as { window?: Record<string, unknown> };
  root.window = root.window ?? {};
  root.window.addEventListener = jest.fn();
  root.window.removeEventListener = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.signOutOfDesktop.mockImplementation(async () => undefined);
});

function openSignOutChoice() {
  const screen = render(<DesktopReadOnlyShell page="settings" />);
  expect(screen.queryByText('Sign out of which devices?')).toBeNull();
  fireEvent.press(screen.getByText('Sign out'));
  // Pressing Sign out alone signs nothing out: it asks first.
  expect(mockAuth.signOutOfDesktop).not.toHaveBeenCalled();
  return screen;
}

test('Sign out asks which devices and says what each choice does', () => {
  const screen = openSignOutChoice();
  expect(screen.getByText('Sign out of which devices?')).toBeTruthy();
  // Changed 30 Sep 2026 (whole-app audit A12 pass 5 L2): This Computer now
  // also says it signs out every tab in this browser, as it now does.
  expect(screen.getByText(
    'This Computer: every Vitruvius tab in this browser is signed out. Your iPhone and iPad stay signed in.',
  )).toBeTruthy();
  expect(screen.getByText(
    'All Devices: your iPhone and iPad are signed out too, within an hour or when they next have signal. Use this if a device is lost.',
  )).toBeTruthy();
  expect(screen.getByText('Sign Out of This Computer')).toBeTruthy();
  expect(screen.getByText('Sign Out of All Devices')).toBeTruthy();

  fireEvent.press(screen.getByText('Cancel'));
  expect(screen.queryByText('Sign out of which devices?')).toBeNull();
  expect(mockAuth.signOutOfDesktop).not.toHaveBeenCalled();
});

test('Sign Out of This Computer signs out this browser only', async () => {
  const screen = openSignOutChoice();
  await act(async () => { fireEvent.press(screen.getByText('Sign Out of This Computer')); });
  expect(mockAuth.signOutOfDesktop).toHaveBeenCalledTimes(1);
  expect(mockAuth.signOutOfDesktop).toHaveBeenCalledWith('local');
});

test('Sign Out of All Devices signs out every device', async () => {
  const screen = openSignOutChoice();
  await act(async () => { fireEvent.press(screen.getByText('Sign Out of All Devices')); });
  expect(mockAuth.signOutOfDesktop).toHaveBeenCalledTimes(1);
  expect(mockAuth.signOutOfDesktop).toHaveBeenCalledWith('global');
});

test('All Devices with no connection says so, signs nothing out, and both choices stay', async () => {
  mockAuth.signOutOfDesktop.mockImplementationOnce(async () => {
    throw new DAVEWebSignOutNeedsConnectionError();
  });
  const screen = openSignOutChoice();
  await act(async () => { fireEvent.press(screen.getByText('Sign Out of All Devices')); });
  await waitFor(() => expect(screen.getByText(
    'Signing out your other devices needs an internet connection, and Vitruvius could not reach the cloud just now. Nothing was signed out. Try again when this computer is back online.',
  )).toBeTruthy());
  expect(mockAuth.signOutOfDesktop).toHaveBeenCalledTimes(1);

  await act(async () => { fireEvent.press(screen.getByText('Sign Out of This Computer')); });
  expect(mockAuth.signOutOfDesktop).toHaveBeenLastCalledWith('local');
});

test('a sign-out that did not finish says so instead of nothing', async () => {
  mockAuth.signOutOfDesktop.mockImplementationOnce(async () => {
    throw new Error('The desktop session could not be closed.');
  });
  const screen = openSignOutChoice();
  await act(async () => { fireEvent.press(screen.getByText('Sign Out of This Computer')); });
  await waitFor(() => expect(screen.getByText(
    'Sign out did not finish. Check the internet connection and try again.',
  )).toBeTruthy());
});
