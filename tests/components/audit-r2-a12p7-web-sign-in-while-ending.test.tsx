/**
 * Whole-app audit A12 pass 7 L1 (30 Sep 2026), with a real supabase-js
 * client as this tab (tests/fixtures/browser-tabs.ts). David chose Sign Out
 * in another tab. This tab showed its sign-in page at once, but its own
 * ending (auth-js's signOut: a refresh first when the sign-in had expired,
 * then /logout) was slow, and he signed in again here before it finished.
 * auth-js does not hold a sign-in back while a sign-out runs, so:
 *
 * (a) a slow /logout: the workspace showed, then the late /logout removed
 *     the NEW sign-in and he was back on the sign-in page;
 * (b) hidden for an hour, a slow refresh: auth-js threw the refresh away
 *     (the new sign-in had changed storage), signOut said it failed, and
 *     the ending deleted the new sign-in with no SIGNED_OUT; the workspace
 *     stayed with no sign-in behind it, and the next read said "Sign in is
 *     required…";
 * (c) a mistyped password during the ending turned the ending's guard off
 *     (it was cleared when a sign-in STARTED), so the ending's own
 *     TOKEN_REFRESHED loaded the workspace; /logout answering 503 then wiped
 *     the sign-in mid-load and he saw "This account is not authorized…".
 *
 * Now a sign-in waits for this tab's ending to settle (at most 10 s), with
 * the sign-in button busy; the ending's guard lasts until it settles; and
 * the ending only forgets the sign-in it was ending, never a newer one.
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

const phasesSeen: string[] = [];
let readAgain: () => Promise<boolean> = async () => false;
function Probe() {
  const auth = useDesktopAuth();
  phasesSeen.push(auth.phase);
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
});
afterAll(() => {
  root.document = originalDocument;
  if (originalSessionStorage) Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
  else delete root.sessionStorage;
  jest.restoreAllMocks();
});
beforeEach(() => {
  phasesSeen.length = 0;
});
afterEach(() => {
  jest.useRealTimers();
  davidsTab?.close();
  davidsTab = null;
  closeTabClient(thisTab);
});

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
  const screen = render(
    <DesktopAuthProvider>
      <Probe />
      <DesktopReadOnlyShell page="settings" />
    </DesktopAuthProvider>,
  );
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

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
}

/** Waiting on the ending: the normal busy sign-in button, nothing sent yet. */
function expectWaitingToSignIn(screen: ReturnType<typeof render>) {
  expect(text(screen, 'phase')).toBe('signing_in');
  expect(screen.queryByText('Sign in securely')).toBeNull();
  expect(passwordSignIns()).toHaveLength(0);
}

function expectWorkspaceWithHisNewSignIn(screen: ReturnType<typeof render>) {
  expect(screen.getByText('Account and Sync')).toBeTruthy();
  expect(text(screen, 'phase')).toBe('ready');
  expect(text(screen, 'message')).toBe('none');
  expect(passwordSignIns()).toHaveLength(1);
  // The sign-in this tab holds is the one he just made, not the ended one.
  expect(tabSignIn(thisTabStorage)?.userId).toBe('owner-1');
  expect(tabSignIn(thisTabStorage)?.refreshToken).not.toBe('refresh:owner-1:1');
}

describe('signing in again while this tab’s sign-in is still ending (A12 pass 7 L1)', () => {
  test('(a) a slow /logout: his new sign-in is kept, and the workspace stays', async () => {
    const screen = await openTab();
    const logout = cloud.hold('logout');
    await davidSignsOutInHisOtherTab(logout.reached);

    phasesSeen.length = 0;
    await davidSignsInHere(screen);
    await settle();
    expectWaitingToSignIn(screen);

    // The ending's SIGNED_OUT comes while he waits; his sign-in then goes
    // out (slow here too), and the button is still the busy one.
    const passwordSignIn = cloud.hold('password');
    await act(async () => {
      logout.release();
      await passwordSignIn.reached;
    });
    await settle();
    expect(text(screen, 'phase')).toBe('signing_in');
    expect(screen.queryByText('Sign in securely')).toBeNull();

    await act(async () => { passwordSignIn.release(); });
    await waitFor(() => expect(screen.getByText('Account and Sync')).toBeTruthy());
    await settle();

    expectWorkspaceWithHisNewSignIn(screen);
    expect(cloud.callsFor('/auth/v1/logout')).toHaveLength(1);
    expect(phasesSeen).not.toContain('signed_out');
    let readOk = false;
    await act(async () => { readOk = await readAgain(); });
    expect(readOk).toBe(true);
    expect(text(screen, 'phase')).toBe('ready');
    screen.unmount();
  });

  test('(b) hidden an hour, a slow refresh: his new sign-in is not deleted, and the next read works', async () => {
    const screen = await openTab();
    anHourPasses();
    const refresh = cloud.hold('refresh');
    await davidSignsOutInHisOtherTab(refresh.reached);

    phasesSeen.length = 0;
    await davidSignsInHere(screen);
    await settle();
    expectWaitingToSignIn(screen);

    await act(async () => { refresh.release(); });
    await waitFor(() => expect(screen.getByText('Account and Sync')).toBeTruthy());
    await settle();

    expectWorkspaceWithHisNewSignIn(screen);
    expect(phasesSeen).not.toContain('signed_out');
    let readOk = false;
    await act(async () => { readOk = await readAgain(); });
    expect(readOk).toBe(true);
    expect(text(screen, 'message')).toBe('none');
    expect(screen.queryByText('Sign in is required for the Vitruvius desktop pilot.')).toBeNull();
    screen.unmount();
  });

  test('(c) a mistyped password during the ending, /logout 503: the sign-in page, never his projects or "not authorized"', async () => {
    const screen = await openTab();
    anHourPasses();
    cloud.state.logout = 503;
    const refresh = cloud.hold('refresh');
    await davidSignsOutInHisOtherTab(refresh.reached);
    const readsBefore = cloud.callsFor('/rest/v1/').length;
    phasesSeen.length = 0;

    await davidSignsInHere(screen, 'mistyped-test-password');
    await settle();
    expectWaitingToSignIn(screen);

    await act(async () => { refresh.release(); });
    await waitFor(() => expect(passwordSignIns()).toHaveLength(1));
    await settle();

    expect(text(screen, 'phase')).toBe('signed_out');
    expect(text(screen, 'message')).toBe(
      'Sign-in could not be completed. Check your email and password, then try again.',
    );
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.queryByText('Account and Sync')).toBeNull();
    expect(screen.queryByText('This account is not authorized for the Vitruvius desktop pilot.')).toBeNull();
    // Nothing loaded on the way, and the ended sign-in is gone from this tab.
    expect(phasesSeen.filter(phase => phase !== 'signed_out' && phase !== 'signing_in')).toEqual([]);
    expect(cloud.callsFor('/rest/v1/')).toHaveLength(readsBefore);
    expect(cloud.callsFor('/auth/v1/logout')).toHaveLength(1);
    expect(tabHoldsSignIn(thisTabStorage)).toBe(false);

    // His next try, with the right password, opens the workspace.
    await davidSignsInHere(screen);
    await waitFor(() => expect(screen.getByText('Account and Sync')).toBeTruthy());
    await settle();
    expect(text(screen, 'phase')).toBe('ready');
    expect(tabSignIn(thisTabStorage)?.userId).toBe('owner-1');
    screen.unmount();
  });

  test('an ending that does not settle holds a sign-in back at most 10 s; a 503 after that keeps his new sign-in', async () => {
    expect(DESKTOP_SIGN_IN_ENDING_WAIT_MS).toBe(10_000);
    const screen = await openTab();
    cloud.state.logout = 503;
    const logout = cloud.hold('logout');
    await davidSignsOutInHisOtherTab(logout.reached);

    jest.useFakeTimers({ advanceTimers: true });
    await davidSignsInHere(screen);
    await settle();
    expectWaitingToSignIn(screen);

    await act(async () => { jest.advanceTimersByTime(DESKTOP_SIGN_IN_ENDING_WAIT_MS - 1_000); });
    await settle();
    expectWaitingToSignIn(screen);

    await act(async () => { jest.advanceTimersByTime(1_000); });
    await waitFor(() => expect(screen.getByText('Account and Sync')).toBeTruthy());
    await settle();
    expect(passwordSignIns()).toHaveLength(1);

    // The ending's /logout then answers 503: the sign-in it was ending is
    // gone already, and his new one is not taken out of storage.
    await act(async () => { logout.release(); });
    await settle();
    expectWorkspaceWithHisNewSignIn(screen);
    let readOk = false;
    await act(async () => { readOk = await readAgain(); });
    expect(readOk).toBe(true);
    screen.unmount();
  });
});
