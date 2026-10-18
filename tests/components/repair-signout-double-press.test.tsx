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
import { DAVEWebSignOutNeedsConnectionError, DAVEWebSignOutWaitError } from '../../services/DAVEWebSupabaseClient';

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


test('same-render repeated All Devices press cannot start overlapping signouts',async()=>{
 mockAuth.signOutOfDesktop.mockImplementation(()=>new Promise(()=>{}));const v=openSignOutChoice();
 await act(async()=>{fireEvent.press(v.getByText('Sign Out of All Devices'));fireEvent.press(v.getByText('Sign Out of All Devices'));});
 expect(mockAuth.signOutOfDesktop).toHaveBeenCalledTimes(1);
});
