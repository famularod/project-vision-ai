/**
 * Whole-app audit A12 pass 8 (30 Sep 2026), with a real supabase-js client
 * as this tab (tests/fixtures/browser-tabs.ts).
 *
 * H1: this tab's sign-in had expired (an hour hidden, or the laptop slept).
 * David chose Sign Out of This Computer in another tab; this tab's own
 * ending refreshed the sign-in first, so its refresh token changed. Its
 * refresh or /logout hung past the 10 s a sign-in waits, so the sign-in he
 * typed here went out. /logout then failed (503, or the network dropped)
 * while his sign-in was still awaiting an answer, and the sign-in failed
 * too (a mistyped password, or the same drop). The sign-in page showed its
 * error, but the tab still held the refreshed sign-in, valid on the server:
 * a reload opened his projects with no password, and auth-js's automatic
 * refresh would have opened them by itself within the hour.
 *
 * Now the tab ends signed out: nothing stored, no session, the sign-in page
 * after a remount, and an automatic refresh has nothing to refresh.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text, View } from 'react-native';

import {
  DESKTOP_SIGN_IN_ENDING_WAIT_MS,
  DESKTOP_SIGN_OUT_CHANNEL_NAME,
  DesktopAuthProvider,
  useDesktopAuth,
} from '../../components/web-shell/desktop-auth-provider';
import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { supabaseSecureAuthStorage } from '../../services/SupabaseAuthStorage.web';
import {
  TAB_TEST_PASSWORD,
  closeTabClient,
  createTabClient,
  createTabCloud,
  createTabStorage,
  storeTabSignIn,
  tabHoldsSignIn,
  type TabCloud,
  type TabStorage,
} from '../fixtures/browser-tabs';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View: MockView } = require('react-native');
  return {
    LinearGradient: ({ children }: { children: React.ReactNode }) => (
      React.createElement(MockView, null, children)
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

/** This tab's gateway, over this tab's real client (set in openTab). */
let mockThisTabGateway: Record<string, unknown> = {};
jest.mock('../../services/DAVEWebSupabaseClient', () => {
  const actual = jest.requireActual('../../services/DAVEWebSupabaseClient');
  return {
    ...actual,
    daveWebSupabaseGateway: new Proxy({}, {
      get: (_target, key) => mockThisTabGateway[key as string],
    }),
  };
});

function Probe() {
  const auth = useDesktopAuth();
  return (
    <View>
      <Text testID="phase">{auth.phase}</Text>
      <Text testID="message">{auth.message ?? 'none'}</Text>
    </View>
  );
}

const root = globalThis as unknown as Record<string, unknown>;
const originalDocument = root.document;
const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalWarn = console.warn;
const originalError = console.error;

let thisTabStorage: TabStorage;
let cloud: TabCloud;
let thisTab: SupabaseClient;
let davidsTab: BroadcastChannel | null = null;

beforeAll(() => {
  root.document = {
    visibilityState: 'hidden',
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  root.addEventListener = jest.fn();
  root.removeEventListener = jest.fn();
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('Multiple GoTrueClient instances')) return;
    originalWarn(...args);
  });
  // auth-js logs each dropped request before answering it as an error.
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('Failed to fetch')) return;
    originalError(...args);
  });
});
afterAll(() => {
  root.document = originalDocument;
  if (originalSessionStorage) Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
  else delete root.sessionStorage;
  jest.restoreAllMocks();
});
afterEach(async () => {
  await thisTab.auth.stopAutoRefresh();
  jest.useRealTimers();
  davidsTab?.close();
  davidsTab = null;
  closeTabClient(thisTab);
});

function renderTab() {
  return render(
    <DesktopAuthProvider>
      <Probe />
      <DesktopReadOnlyShell page="settings" />
    </DesktopAuthProvider>,
  );
}

/** This tab, signed in as the owner, with the workspace open. */
async function openTab() {
  thisTabStorage = createTabStorage();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    writable: true,
    value: thisTabStorage,
  });
  storeTabSignIn(thisTabStorage, 'owner-1');
  cloud = createTabCloud();
  thisTab = createTabClient(supabaseSecureAuthStorage, cloud);
  await thisTab.auth.initialize();
  mockThisTabGateway = {
    ...createDAVEWebSupabaseGateway(thisTab),
    subscribeToAuthorizedOperationalChanges: async () => () => undefined,
    runAuthorizedMaintenance: async () => undefined,
  };
  const screen = renderTab();
  await waitFor(() => expect(screen.getByText('Account and Sync')).toBeTruthy());
  await settle();
  return screen;
}

/** An hour hidden: the sign-in this tab holds has expired. */
function anHourPasses() {
  storeTabSignIn(thisTabStorage, 'owner-1', { expired: true });
}

/** David chooses Sign Out in his other tab, which tells this one. */
async function davidSignsOutInHisOtherTab(reached: Promise<void>) {
  davidsTab = new BroadcastChannel(DESKTOP_SIGN_OUT_CHANNEL_NAME);
  await act(async () => {
    davidsTab!.postMessage({ type: 'signed-out-of-this-computer', userId: 'owner-1' });
    await reached;
  });
}

/** He signs in again here, on the sign-in page this tab now shows. */
async function davidSignsInHere(screen: ReturnType<typeof render>, password = TAB_TEST_PASSWORD) {
  await waitFor(() => expect(screen.getByLabelText('Password')).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText('Email'), 'owner@example.com');
  fireEvent.changeText(screen.getByLabelText('Password'), password);
  await act(async () => { fireEvent.press(screen.getByText('Sign in securely')); });
}

const text = (screen: ReturnType<typeof render>, id: string) =>
  screen.getByTestId(id).props.children;
const passwordSignIns = () => cloud.callsFor('/auth/v1/token?grant_type=password');
const refreshes = () => cloud.callsFor('/auth/v1/token?grant_type=refresh_token');

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
}

/** Waiting on the ending: the normal busy sign-in button, nothing sent yet. */
function expectWaitingToSignIn(screen: ReturnType<typeof render>) {
  expect(text(screen, 'phase')).toBe('signing_in');
  expect(screen.queryByText('Sign in securely')).toBeNull();
  expect(passwordSignIns()).toHaveLength(0);
}

type Failure = 'mistyped' | 'dropped';

/**
 * /logout fails (503, or a drop), and his sign-in then fails too (a
 * mistyped password, or the same drop).
 */
function failuresAre(failure: Failure) {
  cloud.state.logout = failure === 'mistyped' ? 503 : 'dropped';
  cloud.state.password = failure === 'dropped' ? 'dropped' : 'ok';
}

/**
 * The ending did not finish within the 10 s a sign-in waits: his sign-in
 * goes out, and is held there (still awaiting an answer).
 */
async function hisSignInGoesOutAfterTheWait(screen: ReturnType<typeof render>, failure: Failure) {
  jest.useFakeTimers({ advanceTimers: true });
  const passwordSignIn = cloud.hold('password');
  await davidSignsInHere(screen, failure === 'mistyped' ? 'mistyped-test-password' : TAB_TEST_PASSWORD);
  await settle();
  expectWaitingToSignIn(screen);
  await act(async () => {
    jest.advanceTimersByTime(DESKTOP_SIGN_IN_ENDING_WAIT_MS);
    await passwordSignIn.reached;
  });
  return passwordSignIn;
}

/** Signed out for good: the page, the storage, the session, a refresh, a reload. */
async function expectSignedOutForGood(screen: ReturnType<typeof render>) {
  expect(text(screen, 'phase')).toBe('signed_out');
  expect(text(screen, 'message')).toBe(
    'Sign-in could not be completed. Check your email and password, then try again.',
  );
  expect(screen.getByLabelText('Password')).toBeTruthy();
  expect(screen.queryByText('Account and Sync')).toBeNull();
  expect(tabHoldsSignIn(thisTabStorage)).toBe(false);
  const { data } = await thisTab.auth.getSession();
  expect(data.session).toBeNull();

  // Close to an hour later, auth-js's automatic refresh finds nothing to
  // refresh, and the workspace does not open by itself.
  const refreshesBefore = refreshes().length;
  jest.setSystemTime(Date.now() + 59 * 60_000);
  await thisTab.auth.startAutoRefresh();
  await act(async () => { jest.advanceTimersByTime(30_000); });
  await settle();
  await thisTab.auth.stopAutoRefresh();
  expect(refreshes()).toHaveLength(refreshesBefore);
  expect(text(screen, 'phase')).toBe('signed_out');
  expect(screen.queryByText('Account and Sync')).toBeNull();

  // A reload shows the sign-in page, not his projects.
  screen.unmount();
  const reloaded = renderTab();
  await waitFor(() => expect(reloaded.getByLabelText('Password')).toBeTruthy());
  await settle();
  expect(text(reloaded, 'phase')).toBe('signed_out');
  expect(reloaded.queryByText('Account and Sync')).toBeNull();
  reloaded.unmount();
}

describe.each<Failure>(['mistyped', 'dropped'])(
  'H1: an ending that hangs past the wait, then fails while his sign-in is out, and the sign-in fails (%s) (A12 pass 8)',
  failure => {
    test('a slow /logout: the tab ends signed out', async () => {
      const screen = await openTab();
      anHourPasses();
      failuresAre(failure);
      const logout = cloud.hold('logout');
      await davidSignsOutInHisOtherTab(logout.reached);
      // The ending refreshed the expired sign-in before its /logout.
      expect(refreshes()).toHaveLength(1);

      const passwordSignIn = await hisSignInGoesOutAfterTheWait(screen, failure);
      await act(async () => { logout.release(); });
      await settle();
      await act(async () => { passwordSignIn.release(); });
      await settle();

      expect(cloud.callsFor('/auth/v1/logout')).toHaveLength(1);
      await expectSignedOutForGood(screen);
    });

    test('a slow refresh: the tab ends signed out', async () => {
      const screen = await openTab();
      anHourPasses();
      failuresAre(failure);
      const refresh = cloud.hold('refresh');
      await davidSignsOutInHisOtherTab(refresh.reached);

      const passwordSignIn = await hisSignInGoesOutAfterTheWait(screen, failure);
      await act(async () => { refresh.release(); });
      await settle();
      expect(cloud.callsFor('/auth/v1/logout')).toHaveLength(1);
      await act(async () => { passwordSignIn.release(); });
      await settle();

      await expectSignedOutForGood(screen);
    });
  },
);
