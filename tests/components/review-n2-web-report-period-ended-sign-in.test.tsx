/**
 * Review N2 (5 Oct 2026; caused by 46e3332 and its sign-out fix b1281f0),
 * through the desktop's sign-in provider, with a real supabase-js client as
 * this tab (tests/fixtures/browser-tabs.ts).
 *
 * David chose Sign Out of All Devices on the phone. The web tab dropped to
 * the sign-in page once its hourly token ran out, but the last sent report's
 * project, task and owner names stayed in that browser's storage. They now
 * leave when the server has ended the sign-in. A server that cannot be
 * reached keeps him signed in and removes nothing, and another account's tab
 * signing out changes nothing here (owner answer Q26). The provider itself
 * is unchanged: the gateway it listens through does the removing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { act, render, waitFor } from '@testing-library/react-native';
import { Text, View } from 'react-native';

import { DesktopAuthProvider, useDesktopAuth } from '../../components/web-shell/desktop-auth-provider';
import { buildDAVEReportSnapshot, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { saveDAVEReportSnapshot } from '../../services/DAVEReportSnapshotStore';
import { daveWebReportStorage, forgetDAVEWebOwnReportSends, forgetDAVEWebReportPeriods } from '../../services/DAVEWebReportSend';
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { supabaseSecureAuthStorage } from '../../services/SupabaseAuthStorage.web';
import {
  closeTabClient,
  createTabClient,
  createTabCloud,
  createTabStorage,
  storeTabSignIn,
  tabAuthStorage,
  tabHoldsSignIn,
  type TabCloud,
  type TabStorage,
} from '../fixtures/browser-tabs';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
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
      <Text testID="email">{auth.userEmail ?? 'none'}</Text>
    </View>
  );
}

const root = globalThis as unknown as Record<string, unknown>;
const originalDocument = root.document;
const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWarn = console.warn;
const originalError = console.error;

type Server = { signedOutOfAllDevices: boolean; connection: 'ok' | 'dropped' };
let server: Server;
let cloud: TabCloud;
let thisTabStorage: TabStorage;
let profile: TabStorage;
let thisTab: SupabaseClient;
let otherTab: SupabaseClient | null = null;

beforeAll(() => {
  root.document = { visibilityState: 'visible', addEventListener: jest.fn(), removeEventListener: jest.fn() };
  root.addEventListener = jest.fn();
  root.removeEventListener = jest.fn();
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('Multiple GoTrueClient instances')) return;
    originalWarn(...args);
  });
  // auth-js logs each refused or dropped request before answering it as an error.
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const text = String(args[0]);
    if (text.includes('Failed to fetch') || text.includes('Invalid Refresh Token')) return;
    originalError(...args);
  });
});
afterAll(() => {
  root.document = originalDocument;
  if (originalSessionStorage) Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
  else delete root.sessionStorage;
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else delete root.localStorage;
  jest.restoreAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
  closeTabClient(thisTab);
  if (otherTab) closeTabClient(otherTab);
  otherTab = null;
  forgetDAVEWebReportPeriods('owner-1');
});

/**
 * The fixture's cloud, which can also end every sign-in of the account
 * (another device's "Sign Out of All Devices") or lose its connection.
 */
function createServer(): TabCloud {
  const base = createTabCloud();
  server = { signedOutOfAllDevices: false, connection: 'ok' };
  const refused = () => new Response(
    JSON.stringify({ code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' }),
    { status: 400, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' } },
  );
  const fetch = async (input: unknown, init?: { method?: string; headers?: HeadersInit; body?: unknown }) => {
    const url = new URL(String(typeof input === 'string' ? input : (input as { url: string }).url));
    if (url.pathname.startsWith('/auth/v1/') && server.connection === 'dropped') throw new TypeError('Failed to fetch');
    const refresh = url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token';
    return refresh && server.signedOutOfAllDevices ? refused() : base.fetch(input, init);
  };
  return { ...base, fetch };
}

const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
const text = (screen: ReturnType<typeof render>, id: string) => screen.getByTestId(id).props.children;
const CLOUD_OFF = { read: async () => null, write: async () => undefined };
const sentReport = () => ({
  ...buildDAVEReportSnapshot({ truths: [], scopeKey: 'tower', sourceFingerprint: 'facts', capturedAt: '2026-10-01T12:00:00.000Z', reportFormat: 'project_manager' }),
  tasks: [{ taskId: 't1', projectName: 'Tower', taskName: 'Frame walls', areaName: 'Level 2', owner: 'Dana', status: 'In Progress', percentComplete: 40, finishDate: null, urgency: 'normal', approvalStatus: null, estimatedScheduleImpactDays: null }],
  deliveredAt: '2026-10-01T13:00:00.000Z',
}) as unknown as DAVEReportSnapshot;
const profileText = () => [...profile.values.values()].join('\n');
const ownersKeys = () => [...profile.values.keys()].filter(key => key.startsWith('@vitruvius/web/owner-1/'));

/** This tab, signed in as the owner with the workspace open, and a report sent from this browser. */
async function openTabWithAReportSent() {
  thisTabStorage = createTabStorage();
  profile = createTabStorage();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: thisTabStorage });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
  forgetDAVEWebOwnReportSends();
  storeTabSignIn(thisTabStorage, 'owner-1');
  cloud = createServer();
  thisTab = createTabClient(supabaseSecureAuthStorage, cloud);
  await thisTab.auth.initialize();
  const gateway = createDAVEWebSupabaseGateway(thisTab);
  mockThisTabGateway = {
    ...gateway,
    // Realtime needs a socket; maintenance is not what this is about.
    subscribeToAuthorizedOperationalChanges: async () => () => undefined,
    runAuthorizedMaintenance: async () => undefined,
  };
  const screen = render(<DesktopAuthProvider><Probe /></DesktopAuthProvider>);
  await waitFor(() => expect(text(screen, 'phase')).toBe('ready'));
  await saveDAVEReportSnapshot(sentReport(), daveWebReportStorage(() => gateway.authorizedOwnerId()), CLOUD_OFF);
  expect(ownersKeys()).toHaveLength(1);
  expect(profileText()).toContain('Frame walls');
  await settle();
  return screen;
}

/** An hour on: the access token this tab holds has run out. */
function theHourlyTokenRunsOut() {
  storeTabSignIn(thisTabStorage, 'owner-1', { expired: true });
}

describe('review N2 (Low): the web page, when the server has ended its sign-in', () => {
  test('Sign Out of All Devices on the phone, then the hourly token runs out: the sign-in page, and the report periods are gone from this browser', async () => {
    const screen = await openTabWithAReportSent();
    server.signedOutOfAllDevices = true;
    theHourlyTokenRunsOut();
    // The page's next read of his projects (its own timer, or his click).
    await act(async () => { await readAgain().catch(() => false); });
    await waitFor(() => expect(text(screen, 'phase')).toBe('signed_out'));
    expect(text(screen, 'email')).toBe('none');
    expect(tabHoldsSignIn(thisTabStorage)).toBe(false);
    expect(ownersKeys()).toEqual([]);
    expect(profileText()).not.toContain('Frame walls');
    expect(profileText()).not.toContain('Dana');
  });

  test('no connection when the hourly token runs out: he stays signed in, and the report periods stay', async () => {
    const screen = await openTabWithAReportSent();
    server.signedOutOfAllDevices = true;
    server.connection = 'dropped';
    theHourlyTokenRunsOut();
    jest.useFakeTimers({ advanceTimers: true });
    await act(async () => {
      let done = false;
      const reading = readAgain().catch(() => false).finally(() => { done = true; });
      // auth-js tries again for up to 30 s before it answers.
      for (let seconds = 0; seconds < 90 && !done; seconds += 1) await jest.advanceTimersByTimeAsync(1_000);
      await reading;
    });
    jest.useRealTimers();
    await settle();
    expect(text(screen, 'phase')).toBe('ready');
    expect(text(screen, 'email')).toBe('owner@example.com');
    expect(tabHoldsSignIn(thisTabStorage)).toBe(true);
    expect(ownersKeys()).toHaveLength(1);
    expect(profileText()).toContain('Frame walls');
  });

  test('another account\'s tab signs out: this tab stays open on his sign-in, and the report periods stay (owner answer Q26)', async () => {
    const screen = await openTabWithAReportSent();
    const otherStorage = createTabStorage();
    storeTabSignIn(otherStorage, 'visitor-1');
    otherTab = createTabClient(tabAuthStorage(otherStorage), cloud);
    await otherTab.auth.initialize();
    await act(async () => { await otherTab?.auth.signOut({ scope: 'local' }); });
    await settle();
    expect(tabHoldsSignIn(otherStorage)).toBe(false);
    expect(text(screen, 'phase')).toBe('ready');
    expect(text(screen, 'email')).toBe('owner@example.com');
    expect(tabHoldsSignIn(thisTabStorage)).toBe(true);
    expect(ownersKeys()).toHaveLength(1);
  });
});
