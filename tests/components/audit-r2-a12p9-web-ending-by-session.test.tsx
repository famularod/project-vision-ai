/**
 * Whole-app audit A12 pass 9 (30 Sep 2026), with a real supabase-js client
 * as this tab (tests/fixtures/browser-tabs.ts), through the desktop
 * provider. auth-js 2.108.2 has no lock between a sign-in and a sign-out,
 * and no request timeout.
 *
 * L1: David chose Sign Out of This Computer in another tab, and this tab's
 * /logout hung past the 10 s a sign-in waits. He signed in here with a
 * mistyped password, and that request hung too. /logout then failed (503),
 * and he reloaded: his projects opened with no password. The ending waited
 * for his sign-in to answer before deciding, though the tab still held
 * exactly the sign-in it was ending, so a sign-in that never answered kept
 * it for good (auth-js would also have kept refreshing it).
 *
 * L2: /logout hung, his sign-in after the wait worked, and auth-js refreshed
 * it (its refresh token rotated) before /logout failed: the ending deleted
 * his new sign-in, with no SIGNED_OUT, so the workspace showed with no
 * sign-in behind it and a reload showed the sign-in page.
 *
 * Now the ending decides by session (the access token's `session_id`, which
 * a refresh keeps): the sign-in it was ending leaves at once, whatever his
 * sign-in is doing; his new sign-in, refreshed or not, stays.
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
  tabSessionId,
  tabSignIn,
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

let signOutHere: () => Promise<void> = async () => undefined;
let readAgain: () => Promise<boolean> = async () => false;
function Probe() {
  const auth = useDesktopAuth();
  signOutHere = () => auth.signOutOfDesktop('local');
  readAgain = auth.refreshSnapshot;
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

/** Held requests a test leaves out; released after it either way. */
let stillHeld: Array<() => void> = [];
afterEach(() => {
  stillHeld.forEach(release => release());
  stillHeld = [];
});

/** A reload: a fresh client over this tab's storage, and its session. */
async function reloadedSession() {
  const reloaded = createTabClient(supabaseSecureAuthStorage, cloud);
  try {
    const { data } = await reloaded.auth.getSession();
    return data.session;
  } finally {
    closeTabClient(reloaded);
  }
}

/** The provider mounted again, as after a reload: what it shows once settled. */
async function remount(screen: ReturnType<typeof render>) {
  screen.unmount();
  const reloaded = renderTab();
  await waitFor(() => expect(text(reloaded, 'phase')).not.toBe('checking'));
  await settle();
  return reloaded;
}

describe.each([
  ['not expired', false],
  ['expired (an hour hidden)', true],
])('L1: /logout fails after the wait while his mistyped sign-in still hangs; the sign-in was %s (A12 pass 9)', (_label, expired) => {
  test('the tab ends signed out without waiting for his sign-in: nothing stored, no session, the sign-in page after a reload', async () => {
    const screen = await openTab();
    if (expired) anHourPasses();
    cloud.state.logout = 503;
    const logout = cloud.hold('logout');
    await davidSignsOutInHisOtherTab(logout.reached);
    expect(refreshes()).toHaveLength(expired ? 1 : 0);
    // Refreshed or not, the tab holds the session being ended.
    expect(tabSignIn(thisTabStorage)?.sessionId).toBe(tabSessionId('owner-1', 1));

    jest.useFakeTimers({ advanceTimers: true });
    const passwordSignIn = cloud.hold('password');
    stillHeld.push(passwordSignIn.release);
    await davidSignsInHere(screen, 'mistyped-test-password');
    await settle();
    expectWaitingToSignIn(screen);
    await act(async () => {
      jest.advanceTimersByTime(DESKTOP_SIGN_IN_ENDING_WAIT_MS);
      await passwordSignIn.reached;
    });

    await act(async () => { logout.release(); });
    await settle();
    expect(cloud.callsFor('/auth/v1/logout')).toHaveLength(1);

    // His sign-in has not answered (and may never).
    expect(text(screen, 'phase')).toBe('signing_in');
    expect(tabHoldsSignIn(thisTabStorage)).toBe(false);
    expect(await reloadedSession()).toBeNull();
    const reloaded = await remount(screen);
    expect(text(reloaded, 'phase')).toBe('signed_out');
    expect(reloaded.getByLabelText('Password')).toBeTruthy();
    expect(reloaded.queryByText('Account and Sync')).toBeNull();

    // When it does answer, it fails, and the tab stays signed out.
    await act(async () => { passwordSignIn.release(); });
    await settle();
    expect(tabHoldsSignIn(thisTabStorage)).toBe(false);
    expect(text(reloaded, 'phase')).toBe('signed_out');
    reloaded.unmount();
  });
});

describe.each([
  ['not expired', false],
  ['expired (an hour hidden)', true],
])('L2: his sign-in after the wait works and refreshes, then /logout fails; the old sign-in was %s (A12 pass 9)', (_label, expired) => {
  test('his new sign-in, its token rotated, stays: the workspace, the next read, and a reload', async () => {
    const screen = await openTab();
    if (expired) anHourPasses();
    cloud.state.logout = 503;
    const logout = cloud.hold('logout');
    await davidSignsOutInHisOtherTab(logout.reached);

    jest.useFakeTimers({ advanceTimers: true });
    await davidSignsInHere(screen);
    await settle();
    expectWaitingToSignIn(screen);
    await act(async () => { jest.advanceTimersByTime(DESKTOP_SIGN_IN_ENDING_WAIT_MS); });
    await waitFor(() => expect(screen.getByText('Account and Sync')).toBeTruthy());
    await settle();
    const newSignIn = tabSignIn(thisTabStorage);
    expect(newSignIn?.sessionId).not.toBe(tabSessionId('owner-1', 1));

    // auth-js refreshes his new sign-in: its refresh token rotates.
    await act(async () => { await thisTab.auth.refreshSession(); });
    await settle();
    const rotated = tabSignIn(thisTabStorage);
    expect(rotated?.refreshToken).not.toBe(newSignIn?.refreshToken);
    expect(rotated?.sessionId).toBe(newSignIn?.sessionId);

    await act(async () => { logout.release(); });
    await settle();
    expect(cloud.callsFor('/auth/v1/logout')).toHaveLength(1);
    expect(text(screen, 'phase')).toBe('ready');
    expect(tabSignIn(thisTabStorage)).toEqual(rotated);
    let readOk = false;
    await act(async () => { readOk = await readAgain(); });
    expect(readOk).toBe(true);

    expect((await reloadedSession())?.refresh_token).toBe(rotated?.refreshToken);
    const reloaded = await remount(screen);
    await waitFor(() => expect(reloaded.getByText('Account and Sync')).toBeTruthy());
    expect(text(reloaded, 'phase')).toBe('ready');
    reloaded.unmount();
  });
});
