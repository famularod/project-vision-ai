/**
 * Whole-app audit A12 pass 10 L1 (30 Sep 2026), with a real supabase-js
 * client as this tab (tests/fixtures/browser-tabs.ts), through the desktop
 * provider. auth-js 2.108.2 runs one sign-out at a time in a tab, has no
 * lock between a sign-in and a sign-out, and no request timeout.
 *
 * David chose Sign Out of This Computer in another tab, and this tab's
 * /logout hung past the 10 s a sign-in waits. He signed in here, and while
 * that request was out a SECOND Sign Out of This Computer came: this tab
 * still held the old sign-in, so a second ending started. His sign-in
 * worked and the workspace opened; the second /logout then failed (503).
 * The gateway kept his new sign-in (another session), but the second
 * ending had started with no sign-in made during it, so as it settled it
 * showed the sign-in page: signed out on screen, while the tab held his
 * working sign-in and a reload opened his projects with no password.
 * When the second /logout failed before his sign-in answered, the page
 * showed "Sign in securely" while his request was still out.
 *
 * Now the gateway says whether it kept a sign-in, and the page follows it:
 * an ending that kept another sign-in leaves the view to that sign-in.
 * While a sign-in here awaits its answer, an ending starting or settling
 * keeps the busy sign-in button, and that sign-in's own result decides.
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

let readAgain: () => Promise<boolean> = async () => false;
function Probe() {
  const auth = useDesktopAuth();
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

/** Another tab of his says Sign Out of This Computer. */
function davidSignsOutInAnotherTab() {
  davidsTab = davidsTab ?? new BroadcastChannel(DESKTOP_SIGN_OUT_CHANNEL_NAME);
  davidsTab.postMessage({ type: 'signed-out-of-this-computer', userId: 'owner-1' });
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
const logouts = () => cloud.callsFor('/auth/v1/logout');

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
}

/** His sign-in is out: the busy sign-in button, not "Sign in securely". */
function expectSignInStillOut(screen: ReturnType<typeof render>) {
  expect(text(screen, 'phase')).toBe('signing_in');
  expect(screen.queryByText('Sign in securely')).toBeNull();
  expect(screen.queryByText('Account and Sync')).toBeNull();
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

/** The provider mounted again, as after a reload: what it shows once settled. */
async function remount(screen: ReturnType<typeof render>) {
  screen.unmount();
  const reloaded = renderTab();
  await waitFor(() => expect(text(reloaded, 'phase')).not.toBe('checking'));
  await settle();
  return reloaded;
}

/**
 * The first ending's /logout hangs (and will fail, 503); his sign-in goes
 * out after the 10 s wait and hangs; a second Sign Out of This Computer
 * comes while the tab still holds the old sign-in. auth-js runs the second
 * ending's sign-out alongside the first: its /logout hangs too when
 * `secondLogoutHangs`, and otherwise fails (503) at once.
 */
async function secondSignOutWhileHisSignInIsOut(
  screen: ReturnType<typeof render>,
  { password = TAB_TEST_PASSWORD, secondLogoutHangs }: { password?: string; secondLogoutHangs: boolean },
) {
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
  await davidSignsInHere(screen, password);
  await act(async () => {
    jest.advanceTimersByTime(DESKTOP_SIGN_IN_ENDING_WAIT_MS);
    await passwordSignIn.reached;
  });
  expectSignInStillOut(screen);

  const secondLogout = secondLogoutHangs ? cloud.hold('logout') : null;
  if (secondLogout) stillHeld.push(secondLogout.release);
  await act(async () => {
    davidSignsOutInAnotherTab();
    await secondLogout?.reached;
  });
  await settle();
  expect(logouts()).toHaveLength(2);
  // His request is still out, whatever the second ending has done.
  expectSignInStillOut(screen);
  return { firstLogout, secondLogout, passwordSignIn };
}

describe.each([
  ['fails (503): the gateway keeps his new sign-in, and the workspace stays', 503, true],
  ['succeeds: auth-js ends his new sign-in, and the tab shows the sign-in page', 'ok', false],
] as const)('L1: his sign-in works, then the second ending’s /logout %s (A12 pass 10)', (_label, secondLogoutAnswer, kept) => {
  test('what the page shows matches what the tab holds, now and after a reload', async () => {
    const screen = await openTab();
    const { firstLogout, secondLogout, passwordSignIn } =
      await secondSignOutWhileHisSignInIsOut(screen, { secondLogoutHangs: true });
    // Both endings hang: the tab still holds the old sign-in.
    expect(tabSignIn(thisTabStorage)?.sessionId).toBe(tabSessionId('owner-1', 1));

    await act(async () => { passwordSignIn.release(); });
    await waitFor(() => expect(screen.getByText('Account and Sync')).toBeTruthy());
    await settle();
    const newSignIn = tabSignIn(thisTabStorage);
    expect(newSignIn?.sessionId).not.toBe(tabSessionId('owner-1', 1));

    cloud.state.logout = secondLogoutAnswer;
    await act(async () => { secondLogout!.release(); });
    await settle();

    const expectWhatTheTabHolds = async () => {
      if (kept) {
        expect(text(screen, 'phase')).toBe('ready');
        expect(screen.getByText('Account and Sync')).toBeTruthy();
        expect(screen.queryByText('Sign in securely')).toBeNull();
        expect(tabSignIn(thisTabStorage)).toEqual(newSignIn);
        expect((await reloadedSession())?.refresh_token).toBe(newSignIn?.refreshToken);
      } else {
        expect(text(screen, 'phase')).toBe('signed_out');
        expect(screen.getByLabelText('Password')).toBeTruthy();
        expect(screen.queryByText('Account and Sync')).toBeNull();
        expect(tabHoldsSignIn(thisTabStorage)).toBe(false);
        expect(await reloadedSession()).toBeNull();
      }
    };
    await expectWhatTheTabHolds();

    // The first /logout answers the same way, at last.
    await act(async () => { firstLogout.release(); });
    await settle();
    await expectWhatTheTabHolds();

    if (kept) {
      let readOk = false;
      await act(async () => { readOk = await readAgain(); });
      expect(readOk).toBe(true);
    }
    const reloaded = await remount(screen);
    if (kept) {
      await waitFor(() => expect(reloaded.getByText('Account and Sync')).toBeTruthy());
      expect(text(reloaded, 'phase')).toBe('ready');
    } else {
      expect(text(reloaded, 'phase')).toBe('signed_out');
      expect(reloaded.queryByText('Account and Sync')).toBeNull();
    }
    reloaded.unmount();
  });
});

describe.each([
  ['works: the workspace opens', TAB_TEST_PASSWORD],
  ['fails (a mistyped password): the sign-in page says so', 'mistyped-test-password'],
] as const)('Cosmetic: the second ending’s /logout fails at once, before his sign-in answers, and his sign-in %s (A12 pass 10)', (_label, password) => {
  test('the sign-in button stays busy while his request is out; his sign-in’s own result decides', async () => {
    const screen = await openTab();
    const { firstLogout, passwordSignIn } =
      await secondSignOutWhileHisSignInIsOut(screen, { password, secondLogoutHangs: false });
    // The second ending has settled: the old sign-in has left the tab.
    expect(tabHoldsSignIn(thisTabStorage)).toBe(false);

    await act(async () => { passwordSignIn.release(); });
    await settle();
    if (password === TAB_TEST_PASSWORD) {
      await waitFor(() => expect(screen.getByText('Account and Sync')).toBeTruthy());
      expect(text(screen, 'phase')).toBe('ready');
      expect(tabSignIn(thisTabStorage)?.sessionId).not.toBe(tabSessionId('owner-1', 1));
    } else {
      expect(text(screen, 'phase')).toBe('signed_out');
      expect(text(screen, 'message')).toBe(
        'Sign-in could not be completed. Check your email and password, then try again.',
      );
      expect(tabHoldsSignIn(thisTabStorage)).toBe(false);
      expect(await reloadedSession()).toBeNull();
    }

    // The first /logout fails (503) at last: nothing changes.
    const before = tabSignIn(thisTabStorage);
    const phaseBefore = text(screen, 'phase');
    await act(async () => { firstLogout.release(); });
    await settle();
    expect(tabSignIn(thisTabStorage)).toEqual(before);
    expect(text(screen, 'phase')).toBe(phaseBefore);
    screen.unmount();
  });
});
