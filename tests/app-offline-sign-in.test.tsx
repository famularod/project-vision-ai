/**
 * Owner answer Q13 (30 Sep 2026): with no signal, after the hourly sign-in
 * token expired, the app opens the workspace of the account whose sign-in is
 * saved on this phone, marked "offline, sign-in pending", for up to 7 days
 * since the token last refreshed; a refresh the server rejects still signs
 * out; Sign Out works with no signal, and the next offline launch then shows
 * the sign-in screen. Real NativeRoot, owner sandbox, SupabaseService,
 * supabase-js/auth-js and SecureStore adapter; replaced: the native stores
 * (in-memory), fetch (the network boundary: no signal, a rejecting server, or
 * signal back), App (a marker with the real pending banner) and the retry
 * boundary. Adapted from the whole-app audit A1/A2 reviewers' proof tests.
 */
const mockSecure = new Map<string, string>();
const mockAsync = new Map<string, string>();
const mockWorkspaceMounts: string[] = [];
/** Keychain entries whose removal fails (a Sign Out that cannot finish). */
const mockFailingSecureDeletes = new Set<string>();
/** Runs inside a phone-storage read, after its value was read. */
let mockDuringAsyncRead: ((key: string) => Promise<void>) | null = null;

jest.mock('expo-secure-store', () => ({
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async (key: string) => mockSecure.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockSecure.set(key, value); }),
  deleteItemAsync: jest.fn(async (key: string) => {
    if (mockFailingSecureDeletes.has(key)) throw new Error('Keychain item could not be removed');
    mockSecure.delete(key);
  }),
}));
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: async (key: string) => {
      const value = mockAsync.get(key) ?? null;
      if (mockDuringAsyncRead) await mockDuringAsyncRead(key);
      return value;
    },
    setItem: async (key: string, value: string) => { mockAsync.set(key, value); },
    removeItem: async (key: string) => { mockAsync.delete(key); },
    getAllKeys: async () => [...mockAsync.keys()],
    multiGet: async (keys: string[]) => keys.map(key => [key, mockAsync.get(key) ?? null]),
    multiSet: async (entries: [string, string][]) => { entries.forEach(([k, v]) => mockAsync.set(k, v)); },
    multiRemove: async (keys: string[]) => { keys.forEach(k => mockAsync.delete(k)); },
    clear: async () => mockAsync.clear(),
  };
  return { __esModule: true, default: api, ...api };
});
jest.mock('react-native-safe-area-context', () => {
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  const passthrough = ({ children }: { children: unknown }) => children;
  return { SafeAreaProvider: passthrough, SafeAreaView: passthrough, useSafeAreaInsets: () => inset };
});
jest.mock('expo', () => ({ registerRootComponent: jest.fn() }));
// The Settings screen's id helpers; the real module needs the native runtime.
jest.mock('expo-crypto', () => ({
  randomUUID: () => require('crypto').randomUUID(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: jest.fn(async () => new ArrayBuffer(32)),
}));
jest.mock('../components/pending-changes-retry-boundary', () => ({
  PendingChangesRetryBoundary: ({ children }: { children: unknown }) => children,
}));
// auth-js retries a refresh that gets no answer for about 25 seconds, sleeping
// between attempts. Its sleeps are tracked so that each test ends them: left
// running, they logged after this file had finished ("Cannot log after tests
// are done"), which fails the gate's combined run (auth security review).
const mockSleepingRetries = new Set<() => void>();
jest.mock('@supabase/auth-js/dist/main/lib/helpers', () => {
  const actual = jest.requireActual('@supabase/auth-js/dist/main/lib/helpers');
  return {
    ...actual,
    sleep: (time: number) => new Promise(resolve => {
      const wake = () => {
        clearTimeout(timer);
        mockSleepingRetries.delete(wake);
        resolve(null);
      };
      const timer = setTimeout(wake, time);
      mockSleepingRetries.add(wake);
    }),
  };
});
/** auth-js's waiting refresh retry runs now. */
function wakeSleepingRetries() {
  [...mockSleepingRetries].forEach(wake => wake());
}
jest.mock('../App', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  const { useNativeWorkspaceOwner } = require('../components/native-workspace-owner');
  const { OfflineSignInPendingBanner } = require('../components/offline-sign-in-pending-banner');
  function WorkspaceMarker() {
    const owner = useNativeWorkspaceOwner();
    React.useEffect(() => { mockWorkspaceMounts.push(owner); }, [owner]);
    return React.createElement(
      View,
      null,
      React.createElement(OfflineSignInPendingBanner),
      React.createElement(Text, null, `WORKSPACE OPEN ${owner}`),
    );
  }
  return { __esModule: true, default: WorkspaceMarker };
});

// 'hang': requests get no answer until released (a captive portal).
type Mode = 'offline' | 'reject' | 'online' | 'hang';
const network = { mode: 'offline' as Mode, calls: [] as string[], hung: [] as (() => void)[] };
function releaseHungRequests() {
  network.hung.splice(0).forEach(release => release());
}
const HOUR = 3600;
const userFor = (id: string) => ({
  id, aud: 'authenticated', role: 'authenticated', email: `${id}@example.com`,
  app_metadata: {}, user_metadata: {}, created_at: '2026-09-01T00:00:00Z',
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
});
(global as { fetch?: unknown }).fetch = jest.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
  const url = new URL(String(typeof input === 'string' ? input : (input as { url: string }).url));
  network.calls.push(`${init?.method || 'GET'} ${url.pathname}${url.search}`);
  if (network.mode === 'hang') await new Promise<void>(resolve => { network.hung.push(resolve); });
  if (network.mode === 'offline') throw new TypeError('Network request failed');
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    if (network.mode === 'reject') {
      return json(400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' });
    }
    const token = JSON.parse(init?.body || '{}').refresh_token as string;
    const owner = token.replace(/^refresh-/, '');
    const now = Math.floor(Date.now() / 1000);
    return json(200, {
      access_token: `access-${owner}-2`, refresh_token: `refresh-${owner}`, token_type: 'bearer',
      expires_in: HOUR, expires_at: now + HOUR, user: userFor(owner),
    });
  }
  if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
  return json(404, { message: `not emulated: ${url.pathname}` });
});

jest.setTimeout(120_000);
const META = '@vitruvius/owner-storage-sandbox/metadata/v1';
const UPDATES = 'projectPhotoUpdates.v2';
const QUEUE = 'projectVisionAI.syncQueue.v1';
const namespaced = (owner: string, key: string) =>
  `@vitruvius/owner-storage-sandbox/owner/${owner}/value/${encodeURIComponent(key)}`;

let projectRef = '';
let client: { auth: { stopAutoRefresh: () => Promise<void> } } | null = null;
const tokenKey = () => `sb-${projectRef}-auth-token`;

/** A fresh app process: new module registry, same phone storage. */
function launch() {
  jest.resetModules();
  const React = require('react');
  // The pure entry: the default one registers hooks, not allowed in a test.
  const rtl = require('@testing-library/react-native/pure');
  const { NativeRoot } = require('../entry');
  const service = require('../services/SupabaseService');
  client = service.getSupabaseClient();
  const screen = rtl.render(React.createElement(NativeRoot));
  return { screen, rtl, service };
}

async function saveSignIn(owner: string, lastRefreshedHoursAgo: number) {
  const { supabaseSecureAuthStorage } = require('../services/SupabaseAuthStorage');
  const issuedAt = Math.floor(Date.now() / 1000) - Math.round(lastRefreshedHoursAgo * HOUR);
  await supabaseSecureAuthStorage.setItem(tokenKey(), JSON.stringify({
    access_token: `access-${owner}-1`, refresh_token: `refresh-${owner}`, token_type: 'bearer',
    expires_in: HOUR, expires_at: issuedAt + HOUR, user: userFor(owner),
  }));
}

async function phoneWorkspaceOf(owner: string) {
  mockAsync.set(META, JSON.stringify({
    version: 1, activeOwnerId: owner, legacyAssignedOwnerId: null, updatedAt: '2026-09-29T17:00:00.000Z',
  }));
  mockAsync.set(UPDATES, JSON.stringify([{ id: `update-${owner}`, status: 'queued' }]));
  mockAsync.set(QUEUE, JSON.stringify([{ id: `queue-${owner}`, pending: true }]));
}

let refSequence = 0;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  // Each launch gets its own project (and so its own saved-session key), so
  // an earlier test's background refresh retries cannot touch this one.
  refSequence += 1;
  projectRef = `offline-q13-${refSequence}`;
  process.env.EXPO_PUBLIC_SUPABASE_URL = `https://${projectRef}.supabase.co`;
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'q13-anon-key-not-a-secret';
  mockSecure.clear();
  mockAsync.clear();
  mockWorkspaceMounts.length = 0;
  mockFailingSecureDeletes.clear();
  mockDuringAsyncRead = null;
  network.mode = 'offline';
  network.calls = [];
});
afterEach(async () => {
  // Every refresh auth-js is still retrying ends here: its next attempt runs
  // now and gets the server's refusal, which is final. Nothing is left to log
  // after the file ends (auth security review, 30 Sep 2026).
  mockDuringAsyncRead = null;
  mockFailingSecureDeletes.clear();
  network.mode = 'reject';
  await client?.auth.stopAutoRefresh();
  for (let round = 0; round < 100; round += 1) {
    releaseHungRequests();
    wakeSleepingRetries();
    await new Promise(resolve => setTimeout(resolve, 10));
    if (mockSleepingRetries.size === 0 && network.hung.length === 0 && round >= 2) break;
  }
  client = null;
});

const OPEN = { timeout: 10_000 } as const;

test('expired sign-in, no signal: opens this owner\'s own workspace, marked pending, uploading nothing', async () => {
  await saveSignIn('owner-a', 14);
  await phoneWorkspaceOf('owner-a');
  const started = Date.now();
  const { screen, rtl } = launch();

  await rtl.waitFor(() => expect(screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy(), OPEN);
  expect(screen.getByText('Offline, sign-in pending')).toBeTruthy();
  // It opens on the first failed refresh, not after auth-js's ~25 s of retries.
  expect(Date.now() - started).toBeLessThan(8_000);
  // Nothing but sign-in refresh attempts left the phone: no upload carries
  // an expired token.
  expect(network.calls.length).toBeGreaterThan(0);
  expect(network.calls.every(call => call === 'POST /auth/v1/token?grant_type=refresh_token')).toBe(true);
  // The saved sign-in and the owner's work are still on the phone.
  expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(true);
  expect(mockAsync.get(UPDATES)).toContain('update-owner-a');

  // Signal returns: auth-js's next retry refreshes the same account; the
  // marker goes and the open workspace is not reopened.
  network.mode = 'online';
  await rtl.waitFor(() => expect(screen.queryByText('Offline, sign-in pending')).toBeNull(), { timeout: 30_000 });
  expect(screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy();
  expect(mockWorkspaceMounts).toEqual(['owner-a']);
  screen.unmount();
});

test('a refresh the server rejects (revoked sign-in) still signs out, keeping the owner\'s work', async () => {
  await saveSignIn('owner-a', 14);
  await phoneWorkspaceOf('owner-a');
  network.mode = 'reject';
  const { screen, rtl } = launch();

  await rtl.waitFor(() => expect(screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
  expect(mockWorkspaceMounts).toEqual([]);
  expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(false);
  expect(JSON.parse(mockAsync.get(META) as string).activeOwnerId).toBeNull();
  // Signed out as today: the work moved into owner-a's sandbox, not deleted.
  expect(mockAsync.get(namespaced('owner-a', UPDATES))).toContain('update-owner-a');
  screen.unmount();
});

test('a rejection that arrives after the offline opening still signs out', async () => {
  await saveSignIn('owner-a', 14);
  await phoneWorkspaceOf('owner-a');
  const { screen, rtl } = launch();
  await rtl.waitFor(() => expect(screen.getByText('Offline, sign-in pending')).toBeTruthy(), OPEN);

  // Signal returns, and the server has revoked this sign-in.
  network.mode = 'reject';
  await rtl.waitFor(() => expect(screen.getByText(/^Sign in to /)).toBeTruthy(), { timeout: 30_000 });
  expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(false);
  expect(mockAsync.get(namespaced('owner-a', UPDATES))).toContain('update-owner-a');
  screen.unmount();
});

test('the refresh outcome is read as auth-js reports it: no answer is no signal; a 400 never is', async () => {
  await saveSignIn('owner-a', 14);
  jest.resetModules();
  const offline = require('../services/SupabaseService');
  client = offline.getSupabaseClient();
  await expect(offline.awaitSavedSignInRefresh()).resolves.toEqual({ status: 'network_unavailable' });
  await client?.auth.stopAutoRefresh();

  projectRef = `${projectRef}-rejected`;
  process.env.EXPO_PUBLIC_SUPABASE_URL = `https://${projectRef}.supabase.co`;
  await saveSignIn('owner-a', 14);
  network.mode = 'reject';
  jest.resetModules();
  const rejected = require('../services/SupabaseService');
  client = rejected.getSupabaseClient();
  // auth-js removes a rejected session itself (and says SIGNED_OUT), usually
  // before anyone asks, so the answer is a rejection or signed out.
  const outcome = await rejected.awaitSavedSignInRefresh();
  expect(['rejected', 'signed_out']).toContain(outcome.status);
  expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(false);
});

test('more than 7 days since the last refresh: today\'s lockout, nothing opens', async () => {
  await saveSignIn('owner-a', 7 * 24 + 1);
  await phoneWorkspaceOf('owner-a');
  const { screen, rtl } = launch();

  await rtl.waitFor(() => expect(screen.getByText('Workspace protection needs attention')).toBeTruthy(), OPEN);
  await rtl.act(async () => { await new Promise(resolve => setTimeout(resolve, 500)); });
  expect(mockWorkspaceMounts).toEqual([]);
  expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(true);
  screen.unmount();
});

test('6 days since the last refresh still opens offline', async () => {
  await saveSignIn('owner-a', 6 * 24);
  await phoneWorkspaceOf('owner-a');
  const { screen, rtl } = launch();
  await rtl.waitFor(() => expect(screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy(), OPEN);
  expect(screen.getByText('Offline, sign-in pending')).toBeTruthy();
  screen.unmount();
});

test('a saved sign-in of another account never opens, and this phone\'s workspace is left as it was', async () => {
  await saveSignIn('owner-b', 14);
  await phoneWorkspaceOf('owner-a');
  const before = new Map(mockAsync);
  const { screen, rtl } = launch();

  await rtl.waitFor(() => expect(screen.getByText('Workspace protection needs attention')).toBeTruthy(), OPEN);
  await rtl.act(async () => { await new Promise(resolve => setTimeout(resolve, 500)); });
  expect(mockWorkspaceMounts).toEqual([]);
  expect(new Map(mockAsync)).toEqual(before);
  screen.unmount();
});

test('offline Sign Out signs out on this phone, keeps unsynced work, and the next offline launch shows sign-in', async () => {
  await saveSignIn('owner-a', 14);
  await phoneWorkspaceOf('owner-a');
  const first = launch();
  await first.rtl.waitFor(() => expect(first.screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy(), OPEN);

  const started = Date.now();
  let result: { ok: boolean; message?: string } | undefined;
  await first.rtl.act(async () => { result = await first.service.signOut(); });
  // Worded as it is: nothing reached the server (auth security review).
  expect(result).toMatchObject({
    ok: true,
    code: 'signed_out_on_this_device_only',
    message: 'Signed out on this device only. There was no signal, so your other devices stay signed in.',
  });
  // It does not wait out the library's retries of an unreachable refresh.
  expect(Date.now() - started).toBeLessThan(5_000);
  await first.rtl.waitFor(() => expect(first.screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
  expect(first.screen.queryByText(/WORKSPACE OPEN/)).toBeNull();
  // The same local clearing as an online sign-out: no session in the
  // Keychain, the sandbox signed out, the owner's unsynced work kept aside.
  expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(false);
  expect(JSON.parse(mockAsync.get(META) as string).activeOwnerId).toBeNull();
  expect(mockAsync.has(QUEUE)).toBe(false);
  expect(mockAsync.get(namespaced('owner-a', QUEUE))).toContain('queue-owner-a');
  expect(network.calls.some(call => call.startsWith('POST /auth/v1/logout'))).toBe(false);
  first.screen.unmount();
  await client?.auth.stopAutoRefresh();

  // Next launch, still no signal: the sign-in screen, not the workspace.
  mockWorkspaceMounts.length = 0;
  const second = launch();
  await second.rtl.waitFor(() => expect(second.screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
  await second.rtl.act(async () => { await new Promise(resolve => setTimeout(resolve, 500)); });
  expect(mockWorkspaceMounts).toEqual([]);
  second.screen.unmount();
  await client?.auth.stopAutoRefresh();

  // Signed in again with signal, the owner's unsynced work is back.
  network.mode = 'online';
  await saveSignIn('owner-a', 0);
  const third = launch();
  await third.rtl.waitFor(() => expect(third.screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy(), OPEN);
  expect(third.screen.queryByText('Offline, sign-in pending')).toBeNull();
  expect(mockAsync.get(QUEUE)).toContain('queue-owner-a');
  third.screen.unmount();
});

test('Settings > Sign Out with no signal (token still valid) signs out instead of doing nothing', async () => {
  await saveSignIn('owner-a', 0.2);
  await phoneWorkspaceOf('owner-a');
  const { screen, rtl, service } = launch();
  await rtl.waitFor(() => expect(screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy(), OPEN);
  expect(screen.queryByText('Offline, sign-in pending')).toBeNull();

  const React = require('react');
  const { Alert } = require('react-native');
  const alerts: string[] = [];
  const alertMessages: string[] = [];
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    const [title, message, buttons] = args as [string, string, { style?: string; onPress?: () => void }[] | undefined];
    alerts.push(title);
    alertMessages.push(message);
    buttons?.find(button => button.style === 'destructive')?.onPress?.();
  });
  const { AdminScreen } = require('../screens/AdminScreen');
  const settings = rtl.render(React.createElement(AdminScreen, {
    localProjects: ['Canopy B'], savedUpdates: [], projectAreas: [], scheduleItems: [],
    referenceDocuments: [], syncCleanupNotice: null, displayName: 'Dana', onDisplayNameChange: jest.fn(),
    onBack: jest.fn(), onDiagnostics: jest.fn(), onBackup: jest.fn(), onRestore: jest.fn(),
    onAddArea: jest.fn(() => true), onUpdateArea: jest.fn(), onDeleteArea: jest.fn(),
    onUseCurrentLocationForArea: jest.fn(), onRemoveMissingPhotos: jest.fn(async () => undefined),
    onRetryUpdateSync: jest.fn(async () => ({ status: 'failed' })), onApplyCloudConflictUpdate: jest.fn(),
    onApplyCloudConflictScheduleItem: jest.fn(), onApplyCloudRecovery: jest.fn(),
    onSaveCaptureMemory: jest.fn(async () => undefined),
  }));
  await rtl.waitFor(() => expect(settings.getByText('Sign Out')).toBeTruthy(), OPEN);
  await rtl.act(async () => { rtl.fireEvent.press(settings.getByText('Sign Out')); });

  await rtl.waitFor(() => expect(screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
  // The owner is told, in plain words, that only this device signed out
  // (auth security review, 30 Sep 2026; previously nothing was said).
  await rtl.waitFor(() => expect(alerts).toEqual(['Sign Out', 'Signed out on this device']), OPEN);
  expect(alertMessages[1]).toBe('Signed out on this device only. There was no signal, so your other devices stay signed in.');
  expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(false);
  // The server was tried first and could not be reached.
  expect(network.calls.some(call => call.startsWith('POST /auth/v1/logout'))).toBe(true);
  expect((await service.getCurrentSessionUser()).data).toBeNull();
  alertSpy.mockRestore();
  settings.unmount();
  screen.unmount();
});

// Auth security review (30 Sep 2026): the fixes it asked for, end to end.
describe('auth security review', () => {
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  test('a sign-out while the offline lookup runs is final: the saved sign-in it had read does not reopen the workspace', async () => {
    await saveSignIn('owner-a', 14);
    await phoneWorkspaceOf('owner-a');
    let raced = false;
    // The offline lookup has read the saved sign-in and is reading which
    // workspace is on the phone (the first read of it at this launch) when
    // signal returns and the server refuses the sign-in: auth-js removes it
    // and says SIGNED_OUT before the lookup returns.
    mockDuringAsyncRead = async key => {
      if (key !== META || raced) return;
      raced = true;
      await pause(0);
      network.mode = 'reject';
      wakeSleepingRetries();
      for (let i = 0; i < 500 && mockSecure.has(`${tokenKey()}.meta`); i += 1) await pause(10);
      await pause(50);
    };
    const { screen, rtl } = launch();

    await rtl.waitFor(() => expect(screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
    await rtl.act(async () => { await pause(500); });
    expect(raced).toBe(true);
    expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(false);
    expect(screen.getByText(/^Sign in to /)).toBeTruthy();
    expect(screen.queryByText('Offline, sign-in pending')).toBeNull();
    expect(mockWorkspaceMounts).toEqual([]);
    // Not re-bound: the phone and its uploads stay signed out.
    expect(JSON.parse(mockAsync.get(META) as string).activeOwnerId).toBeNull();
    expect(require('../services/CloudOwnerBinding').currentCloudOwner().ownerId).toBeNull();
    expect(mockAsync.get(namespaced('owner-a', UPDATES))).toContain('update-owner-a');
    screen.unmount();
  });

  test('open offline near the 7-day limit: returning to the app after it passed locks the workspace again', async () => {
    await saveSignIn('owner-a', 7 * 24 - 1 / 60); // one minute short of 7 days
    await phoneWorkspaceOf('owner-a');
    const { screen, rtl } = launch();
    await rtl.waitFor(() => expect(screen.getByText('Offline, sign-in pending')).toBeTruthy(), OPEN);

    const realNow = Date.now.bind(Date);
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 5 * 60_000);
    try {
      const { AppState } = require('react-native');
      const listeners = (AppState.addEventListener as jest.Mock).mock.calls
        .filter(([type]) => type === 'change')
        .map(([, listener]) => listener as (state: string) => void);
      expect(listeners.length).toBeGreaterThan(0);
      await rtl.act(async () => {
        listeners.forEach(listener => listener('background'));
        listeners.forEach(listener => listener('active'));
        await pause(50);
      });
      await rtl.waitFor(() => expect(screen.getByText('Workspace protection needs attention')).toBeTruthy(), OPEN);
      expect(screen.getByText(/has not refreshed for 7 days/)).toBeTruthy();
      expect(screen.queryByText(/WORKSPACE OPEN/)).toBeNull();
      // Locked, not signed out: the sign-in and the workspace stay on the phone.
      expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(true);
      expect(JSON.parse(mockAsync.get(META) as string).activeOwnerId).toBe('owner-a');
    } finally {
      clock.mockRestore();
      screen.unmount();
    }
  });

  test('Sign Out during a refresh under way asks the server; an earlier failed attempt is not taken for no signal', async () => {
    await saveSignIn('owner-a', 14);
    await phoneWorkspaceOf('owner-a');
    const { screen, rtl, service } = launch();
    await rtl.waitFor(() => expect(screen.getByText('Offline, sign-in pending')).toBeTruthy(), OPEN);

    // Signal is coming back: auth-js's next attempt is under way, unanswered.
    network.mode = 'hang';
    wakeSleepingRetries();
    await rtl.waitFor(() => expect(network.hung.length).toBeGreaterThan(0), OPEN);
    let result: { ok: boolean; code?: string } | undefined;
    const signingOut = service.signOut().then((value: typeof result) => { result = value; });
    await rtl.act(async () => { await pause(100); });
    network.mode = 'online';
    releaseHungRequests();
    await rtl.act(async () => { await signingOut; });

    expect(result).toMatchObject({ ok: true });
    expect(result?.code).toBeUndefined();
    expect(network.calls.some(call => call.startsWith('POST /auth/v1/logout'))).toBe(true);
    await rtl.waitFor(() => expect(screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
    expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(false);
    screen.unmount();
  });

  test('Sign Out with no signal and a token a minute from expiry signs out on this device at once', async () => {
    await saveSignIn('owner-a', 1 - 1 / 60); // expires in one minute
    await phoneWorkspaceOf('owner-a');
    const { screen, rtl, service } = launch();
    await rtl.waitFor(() => expect(screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy(), OPEN);

    let result: unknown = 'still waiting';
    await rtl.act(async () => {
      result = await Promise.race([service.signOut(), pause(5_000).then(() => 'still waiting')]);
    });
    // auth-js would refresh a token this close to expiry first (its 90 s
    // margin), so asking the server would wait out its retries.
    expect(result).toMatchObject({ ok: true, code: 'signed_out_on_this_device_only' });
    expect(network.calls.some(call => call.startsWith('POST /auth/v1/logout'))).toBe(false);
    await rtl.waitFor(() => expect(screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
    screen.unmount();
  });

  test('an offline Sign Out that cannot finish leaves the sign-in whole, so "You are still signed in" is true', async () => {
    await saveSignIn('owner-a', 14);
    await phoneWorkspaceOf('owner-a');
    const { screen, rtl, service } = launch();
    await rtl.waitFor(() => expect(screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy(), OPEN);

    mockFailingSecureDeletes.add(`${tokenKey()}-user.meta`);
    let result: { ok: boolean; error?: string } | undefined;
    await rtl.act(async () => { result = await service.signOut(); });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/You are still signed in\.$/) });
    expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(true);
    expect((await service.readSavedSignIn())?.ownerId).toBe('owner-a');
    expect(screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy();
    expect(JSON.parse(mockAsync.get(META) as string).activeOwnerId).toBe('owner-a');
    screen.unmount();
  });

  test('a refresh that never answers (captive portal) opens the workspace offline after about 8 seconds', async () => {
    await saveSignIn('owner-a', 14);
    await phoneWorkspaceOf('owner-a');
    network.mode = 'hang';
    const started = Date.now();
    const { screen, rtl } = launch();

    await rtl.waitFor(() => expect(screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy(), { timeout: 15_000 });
    expect(screen.getByText('Offline, sign-in pending')).toBeTruthy();
    expect(Date.now() - started).toBeLessThan(13_000);
    expect(network.hung.length).toBeGreaterThan(0);
    screen.unmount();
  });
});
