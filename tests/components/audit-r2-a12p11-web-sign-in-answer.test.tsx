/**
 * Whole-app audit A12 pass 11 (30 Sep 2026), with a real supabase-js client
 * as this tab (tests/fixtures/browser-tabs.ts), through the desktop
 * provider and its sign-in page. auth-js 2.108.2.
 *
 * L1: David chose Sign Out of This Computer in another tab and this tab's
 * /logout hung past the 10 s a sign-in waits, so the sign-in he typed here
 * went out. While it was out a SECOND Sign Out of This Computer came, and a
 * second ending started. His sign-in then answered without opening the
 * workspace: a mistyped password, a dropped connection, or a visitor's
 * account ("This account is not authorized…", after its automatic
 * sign-out). When the second ending settled, it replaced that answer with
 * the plain sign-in page: nothing was stored, so the page was truthful, but
 * he lost the explanation. Now the ending's settling keeps his sign-in's own
 * answer; it still clears whatever was loaded first.
 *
 * L2: when the browser blocks site data, reading this tab's sessionStorage
 * throws. His password was accepted, but auth-js could not store the
 * sign-in and threw (the web storage adapter's "Browser session storage is
 * unavailable…"); the provider and the sign-in form had no catch, so the
 * page stayed "signing in" with no message, and every retry did the same.
 * Now the sign-in page says the browser is blocking site storage; any other
 * throw shows the usual sign-in message, never a busy button.
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

const SIGN_IN_FAILED =
  'Sign-in could not be completed. Check your email and password, then try again.';
const SITE_STORAGE_BLOCKED =
  "This browser is blocking site storage, so Vitruvius can't keep you signed in. Allow site data for this site, then try again.";

const root = globalThis as unknown as Record<string, unknown>;
const originalDocument = root.document;
const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalWarn = console.warn;
const originalError = console.error;

let thisTabStorage: TabStorage;
let cloud: TabCloud;
let thisTab: SupabaseClient;
let davidsTab: BroadcastChannel | null = null;
/** Held requests a test leaves out; released after it either way. */
let stillHeld: Array<() => void> = [];

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
  stillHeld.forEach(release => release());
  stillHeld = [];
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

function useThisTab(storage: TabStorage | (() => never)) {
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    ...(typeof storage === 'function' ? { get: storage } : { writable: true, value: storage }),
  });
}

/** This tab's real client and gateway over this tab's storage. */
async function startThisTab() {
  cloud = createTabCloud();
  thisTab = createTabClient(supabaseSecureAuthStorage, cloud);
  await thisTab.auth.initialize();
  mockThisTabGateway = {
    ...createDAVEWebSupabaseGateway(thisTab),
    subscribeToAuthorizedOperationalChanges: async () => () => undefined,
    runAuthorizedMaintenance: async () => undefined,
  };
}

/** This tab, signed in as the owner, with the workspace open. */
async function openTab() {
  thisTabStorage = createTabStorage();
  useThisTab(thisTabStorage);
  storeTabSignIn(thisTabStorage, 'owner-1');
  await startThisTab();
  const screen = renderTab();
  await waitFor(() => expect(screen.getByText('Account and Sync')).toBeTruthy());
  await settle();
  return screen;
}

/** Another tab of his says Sign Out of This Computer. */
function davidSignsOutInAnotherTab() {
  davidsTab = davidsTab ?? new BroadcastChannel(DESKTOP_SIGN_OUT_CHANNEL_NAME);
  davidsTab.postMessage({ type: 'signed-out-of-this-computer', userId: 'owner-1' });
}

/** Someone signs in here, on the sign-in page this tab shows. */
async function signInHere(screen: ReturnType<typeof render>, email: string, password: string) {
  await waitFor(() => expect(screen.getByLabelText('Password')).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText('Email'), email);
  fireEvent.changeText(screen.getByLabelText('Password'), password);
  await act(async () => { fireEvent.press(screen.getByText('Sign in securely')); });
}

const text = (screen: ReturnType<typeof render>, id: string) =>
  screen.getByTestId(id).props.children;
const logouts = () => cloud.callsFor('/auth/v1/logout');

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
}

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

type Answer = 'mistyped' | 'dropped' | 'visitor';

describe.each<[string, Answer]>([
  ['a mistyped password', 'mistyped'],
  ['a dropped connection', 'dropped'],
  ['a visitor’s account, signed out automatically', 'visitor'],
])('L1: his sign-in answers with %s, then a second ending settles (A12 pass 11)', (_label, answer) => {
  test.each([
    ['fails (503)', 503],
    ['succeeds', 'ok'],
  ] as const)('the second ending’s /logout %s: his sign-in’s own answer stays, with nothing stored', async (_how, secondLogoutAnswer) => {
    const screen = await openTab();

    // The first ending's /logout hangs past the 10 s a sign-in waits.
    cloud.state.logout = 503;
    const firstLogout = cloud.hold('logout');
    await act(async () => {
      davidSignsOutInAnotherTab();
      await firstLogout.reached;
    });
    stillHeld.push(firstLogout.release);

    jest.useFakeTimers({ advanceTimers: true });
    const passwordSignIn = cloud.hold('password');
    stillHeld.push(passwordSignIn.release);
    await signInHere(
      screen,
      answer === 'visitor' ? 'visitor@example.com' : 'owner@example.com',
      answer === 'mistyped' ? 'mistyped-test-password' : TAB_TEST_PASSWORD,
    );
    await act(async () => {
      jest.advanceTimersByTime(DESKTOP_SIGN_IN_ENDING_WAIT_MS);
      await passwordSignIn.reached;
    });

    // A second Sign Out of This Computer while his sign-in is out: this tab
    // still holds the old sign-in, so a second ending starts; its /logout
    // hangs too.
    const secondLogout = cloud.hold('logout');
    stillHeld.push(secondLogout.release);
    await act(async () => {
      davidSignsOutInAnotherTab();
      await secondLogout.reached;
    });
    await settle();
    expect(logouts()).toHaveLength(2);
    expect(text(screen, 'phase')).toBe('signing_in');

    // His sign-in answers, opening nothing.
    if (answer === 'dropped') cloud.state.password = 'dropped';
    // The visitor's automatic sign-out goes through.
    if (answer === 'visitor') cloud.state.logout = 'ok';
    await act(async () => { passwordSignIn.release(); });
    await settle();
    const expectedPhase = answer === 'visitor' ? 'unauthorized' : 'signed_out';
    await waitFor(() => expect(text(screen, 'phase')).toBe(expectedPhase));
    const expectedMessage = text(screen, 'message');
    if (answer === 'visitor') {
      expect(expectedMessage).toMatch(/^This account is not authorized/);
      expect(logouts()).toHaveLength(3);
    } else {
      expect(expectedMessage).toBe(SIGN_IN_FAILED);
    }

    // The second ending settles: nothing is left stored either way.
    cloud.state.logout = secondLogoutAnswer;
    await act(async () => { secondLogout.release(); });
    await settle();

    const expectHisAnswer = async () => {
      expect(text(screen, 'phase')).toBe(expectedPhase);
      expect(text(screen, 'message')).toBe(expectedMessage);
      // On the sign-in page too, not only in the probe.
      expect(screen.getAllByText(expectedMessage)).toHaveLength(2);
      expect(screen.getByLabelText('Password')).toBeTruthy();
      expect(screen.queryByText('Account and Sync')).toBeNull();
      expect(tabHoldsSignIn(thisTabStorage)).toBe(false);
      expect(await reloadedSession()).toBeNull();
    };
    await expectHisAnswer();

    // The first /logout fails (503) at last: nothing changes.
    cloud.state.logout = 503;
    await act(async () => { firstLogout.release(); });
    await settle();
    await expectHisAnswer();
    screen.unmount();
  });
});

describe('L2: a sign-in that throws leaves the sign-in page with a message, never a busy button (A12 pass 11)', () => {
  const passwordSignIns = () => cloud.callsFor('/auth/v1/token?grant_type=password');

  /** He signs in, and the page answers: not busy, the sign-in page, a message. */
  async function signInAndExpect(screen: ReturnType<typeof render>, message: string, signIns: number) {
    await signInHere(screen, 'owner@example.com', TAB_TEST_PASSWORD);
    await settle();
    await waitFor(() => expect(text(screen, 'phase')).toBe('signed_out'));
    expect(text(screen, 'message')).toBe(message);
    // On the sign-in page too, with its button ready again.
    expect(screen.getAllByText(message)).toHaveLength(2);
    expect(screen.getByText('Sign in securely')).toBeTruthy();
    expect(screen.queryByText('Account and Sync')).toBeNull();
    // His password went out and was accepted; nothing could be kept.
    expect(passwordSignIns()).toHaveLength(signIns);
  }

  test('the browser blocks site data: the page says so, and a retry says so again', async () => {
    // Reading sessionStorage throws, as when the browser blocks site data.
    useThisTab(() => {
      throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' });
    });
    await startThisTab();
    const screen = renderTab();
    await waitFor(() => expect(text(screen, 'phase')).toBe('signed_out'));

    await signInAndExpect(screen, SITE_STORAGE_BLOCKED, 1);
    await signInAndExpect(screen, SITE_STORAGE_BLOCKED, 2);
    expect((await thisTab.auth.getSession()).data.session).toBeNull();
    screen.unmount();
  });

  test('storage that refuses only the sign-in itself (full): the usual sign-in message', async () => {
    thisTabStorage = createTabStorage();
    const fits = thisTabStorage.setItem;
    // A small entry fits; the sign-in does not.
    thisTabStorage.setItem = (key: string, value: string) => {
      if (value.length > 64) {
        throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
      }
      fits(key, value);
    };
    useThisTab(thisTabStorage);
    await startThisTab();
    const screen = renderTab();
    await waitFor(() => expect(text(screen, 'phase')).toBe('signed_out'));

    await signInAndExpect(screen, SIGN_IN_FAILED, 1);
    expect(tabHoldsSignIn(thisTabStorage)).toBe(false);
    screen.unmount();
  });
});
