/**
 * Whole-app audit A1 pass 6 L1 (30 Sep 2026), with a real supabase-js client
 * as a hidden tab (tests/fixtures/browser-tabs.ts). David chose Sign Out in
 * one tab; another tab of his had been hidden for over an hour, so its
 * sign-in had expired. Ending that tab's sign-in too (a142cf4) goes through
 * auth-js's signOut, which refreshes first: the tab heard its own
 * TOKEN_REFRESHED and started loading the workspace. When its /logout then
 * failed (503), the sign-in was only taken out of storage and no SIGNED_OUT
 * followed, so the tab showed his projects, or a red banner, instead of the
 * sign-in page; a reload showed the sign-in page.
 *
 * Now, while this tab ends its sign-in because another tab signed out, it
 * acts on nothing but SIGNED_OUT, and once that ending has settled, either
 * way, it shows the sign-in page.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text, View } from 'react-native';

import {
  DESKTOP_SIGN_OUT_CHANNEL_NAME,
  DesktopAuthProvider,
  useDesktopAuth,
} from '../../components/web-shell/desktop-auth-provider';
import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { supabaseSecureAuthStorage } from '../../services/SupabaseAuthStorage.web';
import {
  closeTabClient,
  createTabClient,
  createTabCloud,
  createTabStorage,
  recordTabAuthEvents,
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

/** This tab's gateway, over this tab's real client (set in openHiddenTab). */
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
function Probe() {
  const auth = useDesktopAuth();
  phasesSeen.push(auth.phase);
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
  davidsTab?.close();
  davidsTab = null;
  closeTabClient(thisTab);
});

/** The hidden tab, signed in as the owner, with the workspace open. */
async function openHiddenTab() {
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
  // The start-up check and the start-up event each load once; both finish.
  await settle();
  return screen;
}

/** An hour hidden: the sign-in this tab holds has expired. */
function anHourPasses() {
  storeTabSignIn(thisTabStorage, 'owner-1', { expired: true });
}

/** David chooses Sign Out in his other tab, which tells this one. */
async function davidSignsOutInHisOtherTab() {
  davidsTab = new BroadcastChannel(DESKTOP_SIGN_OUT_CHANNEL_NAME);
  davidsTab.postMessage({ type: 'signed-out-of-this-computer', userId: 'owner-1' });
}

const text = (screen: ReturnType<typeof render>, id: string) =>
  screen.getByTestId(id).props.children;

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
}

function expectSignInPage(screen: ReturnType<typeof render>) {
  expect(text(screen, 'phase')).toBe('signed_out');
  expect(text(screen, 'message')).toBe('none');
  expect(screen.getByLabelText('Password')).toBeTruthy();
  expect(screen.queryByText('Account and Sync')).toBeNull();
  expect(screen.queryByText('This account is not authorized for the Vitruvius desktop pilot.')).toBeNull();
  expect(screen.queryByText('Sign in is required for the Vitruvius desktop pilot.')).toBeNull();
}

describe('a hidden tab whose sign-in expired, when David signs out in another tab (A1 pass 6 L1)', () => {
  test('/logout goes through: the sign-in page, and nothing loads on the way', async () => {
    const screen = await openHiddenTab();
    const heard = recordTabAuthEvents(thisTab);
    await settle();
    anHourPasses();
    const readsBefore = cloud.callsFor('/rest/v1/').length;
    phasesSeen.length = 0;

    await act(async () => { await davidSignsOutInHisOtherTab(); });
    await waitFor(() => expect(heard.events).toEqual(['TOKEN_REFRESHED', 'SIGNED_OUT']));
    await settle();
    heard.stop();

    expectSignInPage(screen);
    expect(phasesSeen.filter(phase => phase !== 'signed_out')).toEqual([]);
    expect(cloud.callsFor('/auth/v1/logout')).toHaveLength(1);
    expect(cloud.callsFor('/rest/v1/')).toHaveLength(readsBefore);
    expect(tabHoldsSignIn(thisTabStorage)).toBe(false);
    screen.unmount();
  });

  test('/logout answers 503: still the sign-in page, not his projects or a banner', async () => {
    const screen = await openHiddenTab();
    const heard = recordTabAuthEvents(thisTab);
    await settle();
    anHourPasses();
    cloud.state.logout = 503;
    const readsBefore = cloud.callsFor('/rest/v1/').length;
    phasesSeen.length = 0;

    await act(async () => { await davidSignsOutInHisOtherTab(); });
    await waitFor(() => expect(cloud.callsFor('/auth/v1/logout')).toHaveLength(1));
    await settle();
    heard.stop();

    // auth-js sends no SIGNED_OUT here; the sign-in is gone from this tab.
    expect(heard.events).toEqual(['TOKEN_REFRESHED']);
    expect(tabHoldsSignIn(thisTabStorage)).toBe(false);
    expectSignInPage(screen);
    expect(phasesSeen.filter(phase => phase !== 'signed_out')).toEqual([]);
    expect(cloud.callsFor('/rest/v1/')).toHaveLength(readsBefore);
    screen.unmount();
  });

  test('a sign-in made here before the ending settles is not cleared when it does', async () => {
    const screen = await openHiddenTab();
    let settleEnding: () => void = () => undefined;
    const { data } = await thisTab.auth.getSession();
    mockThisTabGateway = {
      ...mockThisTabGateway,
      // The other tab's sign-out takes a long time to reach the server here.
      signOutThisTabToo: () => new Promise<void>(resolve => { settleEnding = resolve; }),
      signIn: async () => ({ ok: true, session: data.session as Session }),
    };

    await act(async () => { await davidSignsOutInHisOtherTab(); });
    await waitFor(() => expect(screen.getByLabelText('Password')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('Email'), 'owner@example.com');
    fireEvent.changeText(screen.getByLabelText('Password'), 'synthetic-test-password');
    fireEvent.press(screen.getByText('Sign in securely'));
    await waitFor(() => expect(screen.getByText('Account and Sync')).toBeTruthy());

    await act(async () => { settleEnding(); });
    await settle();

    expect(screen.getByText('Account and Sync')).toBeTruthy();
    expect(text(screen, 'phase')).toBe('ready');
    screen.unmount();
  });
});
