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
/** The open workspace's "sign-in pending" as the App's uploads read it (A4 pass 7 M1). */
let mockSignInPendingRef: { readonly current: boolean } | null = null;
/** Runs inside a Keychain removal, before the entry goes (A1 pass 2 #2). */
let mockDuringSecureDelete: ((key: string) => Promise<void>) | null = null;
/** Settings, rendered inside the open workspace when set (A1 pass 2 #1). */
let mockSettingsProps: Record<string, unknown> | null = null;
/** Keychain reads fail (the phone is locked), as in audit A2 pass 2 L1. */
let mockFailingSecureReads = false;
/** A voice recording on this phone (A11 pass 4 L1); null leaves the real module. */
let mockVoiceRecordingInfo: { exists: boolean; size: number } | null = null;
jest.mock('expo-file-system/legacy', () => {
  const actual = jest.requireActual('expo-file-system/legacy');
  return {
    ...actual,
    getInfoAsync: (...args: unknown[]) => (mockVoiceRecordingInfo
      ? Promise.resolve(mockVoiceRecordingInfo)
      : actual.getInfoAsync(...args)),
  };
});

jest.mock('expo-secure-store', () => ({
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async (key: string) => {
    if (mockFailingSecureReads) throw new Error('User interaction is not allowed.');
    return mockSecure.get(key) ?? null;
  }),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockSecure.set(key, value); }),
  deleteItemAsync: jest.fn(async (key: string) => {
    if (mockDuringSecureDelete) await mockDuringSecureDelete(key);
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
  const { useNativeWorkspaceOwner, useNativeWorkspaceSignInPendingRef } = require('../components/native-workspace-owner');
  const { OfflineSignInPendingBanner } = require('../components/offline-sign-in-pending-banner');
  function WorkspaceMarker() {
    const owner = useNativeWorkspaceOwner();
    mockSignInPendingRef = useNativeWorkspaceSignInPendingRef();
    React.useEffect(() => { mockWorkspaceMounts.push(owner); }, [owner]);
    return React.createElement(
      View,
      null,
      React.createElement(OfflineSignInPendingBanner),
      React.createElement(Text, null, `WORKSPACE OPEN ${owner}`),
      mockSettingsProps
        ? React.createElement(require('../screens/AdminScreen').AdminScreen, mockSettingsProps)
        : null,
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
  // The auth server's health check: the signal check of A1 pass 3 L1.
  if (url.pathname === '/auth/v1/health') return json(200, { name: 'GoTrue' });
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
  mockDuringSecureDelete = null;
  mockSettingsProps = null;
  mockFailingSecureReads = false;
  mockVoiceRecordingInfo = null;
  network.mode = 'offline';
  network.calls = [];
});
afterEach(async () => {
  // Every refresh auth-js is still retrying ends here: its next attempt runs
  // now and gets the server's refusal, which is final. Nothing is left to log
  // after the file ends (auth security review, 30 Sep 2026).
  mockDuringAsyncRead = null;
  mockDuringSecureDelete = null;
  mockFailingSecureDeletes.clear();
  mockFailingSecureReads = false;
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
  // Said as it is (A1 pass 2 #3): it said "Authentication is still loading.
  // Try opening this workspace again in a moment."
  expect(screen.getByText('No signal, and your sign-in has not refreshed for 7 days. Your work is saved on this phone. Connect to the internet, then tap Retry.')).toBeTruthy();
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
  // A1 pass 2 #3: the reason, not "Authentication is still loading".
  expect(screen.getByText('No signal, and this phone was last used with a different account. Connect to the internet, then tap Retry.')).toBeTruthy();
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

/**
 * Whole-app audit A4 pass 7 M1 (30 Sep 2026): with the workspace open
 * "offline, sign-in pending", every field update saved was stamped "Sync
 * Failed · Session expired · Sign in again". Runs the App's own save-time
 * sync and queued-update pass, compiled from App.tsx, against the real
 * session lookup of this launch; only the upload itself and the saved-updates
 * store are stand-ins, and no upload may start.
 */
describe('field updates saved while offline, sign-in pending (A4 pass 7 M1)', () => {
  const fs = jest.requireActual('fs') as typeof import('fs');
  const path = jest.requireActual('path') as typeof import('path');
  const ts = jest.requireActual('typescript') as typeof import('typescript');
  const app = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');
  const transpile = (source: string) => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  /** A top-level function of App.tsx, up to the next top-level declaration. */
  function appFunction(name: string): string {
    const match = new RegExp(`\\n(?:async )?function ${name}\\(`).exec(app);
    if (!match) throw new Error(`App.tsx has no function ${name}`);
    const rest = app.slice(match.index + 1);
    const end = rest.slice(1).search(/\n(?:export )?(?:async )?function |\n(?:export )?const |\n(?:export )?type |\ninterface |\n\/\*\*/);
    return rest.slice(0, end < 0 ? undefined : end + 1);
  }
  /** A function of the App component (two-space indent), brace-matched. */
  function componentFunction(name: string): string {
    const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(app);
    if (!match) throw new Error(`App.tsx has no component function ${name}`);
    const open = app.indexOf(' {\n', match.index) + 1;
    let depth = 0;
    for (let index = open; index < app.length; index += 1) {
      if (app[index] === '{') depth += 1;
      if (app[index] === '}' && (depth -= 1) === 0) return app.slice(match.index + 3, index + 1);
    }
    throw new Error('unbalanced function');
  }
  function compile<T>(source: string, deps: Record<string, unknown>): T {
    const mod = { exports: {} as unknown };
    new Function('module', 'exports', ...Object.keys(deps), transpile(source))(mod, mod.exports, ...Object.values(deps));
    return mod.exports as T;
  }
  const helperNames = [
    'lifecycleStatusForUpdate', 'updateNeedsAutomaticSyncRetry', 'syncCategoryIsRlsOrAuth',
    'emptyPermissionAttempt', 'buildSkippedSyncDiagnostics', 'statusForSyncDiagnostics',
    'queuedStatusCopyForUpdate',
  ];
  type Update = { id: string; status: string; photos: unknown[]; syncDiagnostics?: Record<string, unknown> | null; [key: string]: unknown };
  const lifecycle = () => require('../services/FieldUpdateLifecycle');
  type AppHelper = (...args: any[]) => any;
  const helpers = () => compile<Record<string, AppHelper>>(
    [...helperNames.map(appFunction), `module.exports = { ${helperNames.join(', ')} };`].join('\n'),
    { persistedStatusForSyncResult: lifecycle().persistedStatusForSyncResult },
  );
  const copyOf = (A: Record<string, AppHelper>, update: Update) => ({
    status: update.status,
    category: update.syncDiagnostics?.lastSyncFailureCategory,
    label: lifecycle().fieldUpdateLifecycleLabel(update.status),
    copy: (A.queuedStatusCopyForUpdate as (u: Update) => string)(update),
  });
  const WAITING = {
    status: 'queued', category: 'offline', label: 'Waiting to Sync',
    copy: "Queued — will sync when you're back online",
  };
  /** Runs `work` while auth-js's refresh retries are woken at once (no ~25 s waits). */
  async function withRetriesWoken<T>(work: Promise<T>): Promise<T> {
    let done = false;
    const settled = work.finally(() => { done = true; });
    while (!done) {
      wakeSleepingRetries();
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return settled;
  }
  const update = (id: string, extra: Partial<Update> = {}): Update => ({
    id, projectName: 'Canopy B', date: '2026-09-30', notes: 'Rebar placed', recipients: { contactIds: [] },
    photos: [], status: 'queued', ...extra,
  });

  test('an update saved now waits to sync, worded as offline; older "Session expired" stamps are lifted once, then left alone', async () => {
    await saveSignIn('owner-a', 14);
    await phoneWorkspaceOf('owner-a');
    const { screen, rtl, service } = launch();
    await rtl.waitFor(() => expect(screen.getByText('Offline, sign-in pending')).toBeTruthy(), OPEN);
    expect(mockSignInPendingRef?.current).toBe(true);
    const A = helpers();
    const { fieldUpdateSyncCategoryWithoutSession } = require('../services/FieldUpdateSessionWait');
    const runFieldUpdateCloudSync = jest.fn();
    const shared = {
      getCurrentSessionAccessToken: service.getCurrentSessionAccessToken,
      fieldUpdateSyncCategoryWithoutSession, signInPendingRef: mockSignInPendingRef,
      buildSkippedSyncDiagnostics: A.buildSkippedSyncDiagnostics, statusForSyncDiagnostics: A.statusForSyncDiagnostics,
      runFieldUpdateCloudSync, syncFieldUpdateWithMissingPhotoRepair: runFieldUpdateCloudSync,
    };

    // Saved from Review: the save's own background sync, as App.tsx runs it.
    const persisted: Update[] = [];
    const syncQueued = compile<(u: Update) => Promise<void>>(
      `module.exports = ${componentFunction('syncQueuedFieldUpdateInBackground')}`,
      { ...shared, buildSyncDiagnosticsFromUpload: jest.fn(), classifySyncFailureCategory: () => 'unknown',
        persistSavedUpdateImmediately: jest.fn(async (next: Update) => { persisted.push(next); return true; }) },
    );
    // The session is still loading (auth-js is retrying the refresh with no signal).
    const loading = await service.getCurrentSessionAccessToken();
    expect(loading.data?.missingReason).toBe('auth_loading');
    await syncQueued(update('saved-now'));
    expect(copyOf(A, persisted[0])).toEqual(WAITING);

    // Once auth-js has given up on this refresh the lookup reads "unknown".
    const settled: { data?: { missingReason?: string } } = await withRetriesWoken(service.getCurrentSessionAccessToken());
    expect(settled.data?.missingReason).toBe('unknown');
    await withRetriesWoken(syncQueued(update('saved-later')));
    expect(copyOf(A, persisted[1])).toEqual(WAITING);

    // The queued-update pass: an update stamped before this fix is lifted to
    // waiting once; one already waiting is not written again, pass after pass
    // (the 18 Jul 2026 idempotency fix still holds).
    const stale = update('stamped-before', {
      status: 'failed',
      syncDiagnostics: A.buildSkippedSyncDiagnostics('auth', '2026-09-30T08:00:00.000Z', 1, false),
    });
    const savedUpdatesRef = { current: [stale, persisted[0]] };
    const stamped: string[] = [];
    const hydratePass = compile<() => Promise<void>>(
      `module.exports = ${componentFunction('hydrateQueuedUpdatesPass')}`,
      { ...shared, savedUpdatesRef, updateNeedsAutomaticSyncRetry: A.updateNeedsAutomaticSyncRetry,
        directSyncIsRecent: () => false, queuedHydrationDeferredRerun: { current: null },
        persistedStatusForSyncResult: lifecycle().persistedStatusForSyncResult,
        lifecycleStatusForUpdate: A.lifecycleStatusForUpdate,
        applyFieldUpdateSyncResultIfCurrent: (attempted: Update, next: Update) => {
          stamped.push(next.id);
          savedUpdatesRef.current = savedUpdatesRef.current.map(item => item.id === attempted.id ? next : item);
        },
        runAutomaticSyncQueue: runFieldUpdateCloudSync },
    );
    await withRetriesWoken(hydratePass());
    expect(stamped).toEqual(['stamped-before']);
    expect(savedUpdatesRef.current.map(item => copyOf(A, item))).toEqual([WAITING, WAITING]);
    await withRetriesWoken(hydratePass());
    expect(stamped).toEqual(['stamped-before']);
    expect(runFieldUpdateCloudSync).not.toHaveBeenCalled();

    // Signal returns and the server refuses the sign-in: only that reads
    // "Session expired", and the workspace closes to the sign-in screen as
    // before; after it, "Sign in required".
    network.mode = 'reject';
    // auth-js answers from its last failure for a minute before trying again.
    const realNow = Date.now.bind(Date);
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 61_000);
    try {
      // The refusal signs out and the root re-renders: inside act (the release
      // gate's strict run fails on "not wrapped in act").
      await rtl.act(async () => { await syncQueued(update('at-refusal')); });
      expect(copyOf(A, persisted[2])).toEqual({
        status: 'failed', category: 'auth', label: 'Sync Failed', copy: 'Session expired · Sign in again',
      });
      await rtl.waitFor(() => expect(screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
      await rtl.act(async () => { await syncQueued(update('after-refusal')); });
      expect(copyOf(A, persisted[3])).toEqual({
        status: 'failed', category: 'signed_out', label: 'Sync Failed', copy: 'Sign in required to sync',
      });
      expect(runFieldUpdateCloudSync).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
    screen.unmount();
  });

  test('the category itself: a sign-in saved on this phone and not yet refreshed waits; only its absence asks to sign in', async () => {
    const { fieldUpdateSyncCategoryWithoutSession: category } = require('../services/FieldUpdateSessionWait');
    const saved = async () => ({ ownerId: 'owner-a', lastRefreshedAtMs: 0, expiresAtMs: 0 });
    const none = async () => null;
    const broken = async () => { throw new Error('Keychain unavailable'); };
    await expect(category({ missingReason: 'signed_out' }, true, saved)).resolves.toBe('signed_out');
    await expect(category({ missingReason: 'expired_session' }, true, saved)).resolves.toBe('offline');
    // A refused refresh removed the saved sign-in, pending or not.
    await expect(category({ missingReason: 'unknown' }, true, none)).resolves.toBe('auth');
    await expect(category({ missingReason: 'auth_loading' }, false, saved)).resolves.toBe('offline');
    await expect(category({ missingReason: 'unknown' }, false, saved)).resolves.toBe('offline');
    await expect(category(null, false, saved)).resolves.toBe('offline');
    await expect(category({ missingReason: 'unknown' }, false, none)).resolves.toBe('auth');
    await expect(category({ missingReason: 'unknown' }, false, broken)).resolves.toBe('auth');
    await expect(category({ missingReason: 'expired_session' }, false, saved)).resolves.toBe('auth');
    await expect(category({ missingReason: 'storage_unavailable' }, false, saved)).resolves.toBe('auth');
  });
});

// Whole-app audit A11 pass 4 L1 (30 Sep 2026): voice said "Sign in before
// transcribing a recorded memory." while the workspace was open "offline,
// sign-in pending"; the recording is kept and works once signal returns.
describe('voice while offline, sign-in pending (A11 pass 4 L1)', () => {
  async function withRetriesWoken<T>(work: Promise<T>): Promise<T> {
    let done = false;
    const settled = work.finally(() => { done = true; });
    while (!done) {
      wakeSleepingRetries();
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return settled;
  }

  test('with the real lookup: no signal, the recording kept, nothing sent; a refused sign-in still asks to sign in', async () => {
    await saveSignIn('owner-a', 14);
    await phoneWorkspaceOf('owner-a');
    const { screen, rtl, service } = launch();
    await rtl.waitFor(() => expect(screen.getByText('Offline, sign-in pending')).toBeTruthy(), OPEN);
    mockVoiceRecordingInfo = { exists: true, size: 4_096 };
    const { transcribeDAVECaptureMemoryAudio } = require('../services/DAVEVoiceTranscriptionService');
    const { daveVoiceFailureMessage } = require('../services/DAVEVoiceSignalWait');
    const shown = async (): Promise<string> => {
      try {
        await transcribeDAVECaptureMemoryAudio({
          uri: 'file:///cache/Audio/recording-l1.m4a', projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
          projectName: 'Canopy B', candidateLocations: [], signInPending: () => mockSignInPendingRef?.current ?? false,
        });
      } catch (error) {
        return daveVoiceFailureMessage(error, 'Use Note');
      }
      throw new Error('Expected the recording not to be sent');
    };
    const NO_SIGNAL = 'No signal. Your recording is kept — tap Use Note when you have signal.';

    // The lookup still loading, then settled to "unknown" once auth-js gives up.
    expect((await service.getCurrentSessionAccessToken()).data?.missingReason).toBe('auth_loading');
    expect(await shown()).toBe(NO_SIGNAL);
    const settled: { data?: { missingReason?: string } } = await withRetriesWoken(service.getCurrentSessionAccessToken());
    expect(settled.data?.missingReason).toBe('unknown');
    expect(await withRetriesWoken(shown())).toBe(NO_SIGNAL);

    // Signal returns and the server refuses the sign-in: that alone asks to sign in.
    network.mode = 'reject';
    const realNow = Date.now.bind(Date);
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 61_000);
    let refused = '';
    try {
      await rtl.act(async () => { refused = await shown(); });
    } finally {
      clock.mockRestore();
    }
    expect(refused).toBe('Sign in before transcribing a recorded memory.');
    await rtl.waitFor(() => expect(screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
    // Nothing but sign-in refreshes left the phone: no recording was sent.
    expect(network.calls.filter(call => !call.startsWith('POST /auth/v1/token'))).toEqual([]);
    screen.unmount();
  });
});

// Shared by the A1 pass 2 and pass 3 reviews below.
const PENDING_ACCOUNT = 'Signed in as owner-a@example.com (offline, sign-in pending).';
const settingsProps = () => ({
  localProjects: ['Canopy B'], savedUpdates: [], projectAreas: [], scheduleItems: [],
  referenceDocuments: [], syncCleanupNotice: null, displayName: 'Dana', onDisplayNameChange: jest.fn(),
  failedDocumentCount: 0, onRetryDocumentUploads: jest.fn(async () => ({ status: 'nothing_to_upload' })),
  onBack: jest.fn(), onDiagnostics: jest.fn(), onBackup: jest.fn(), onRestore: jest.fn(),
  onAddArea: jest.fn(() => true), onUpdateArea: jest.fn(), onDeleteArea: jest.fn(),
  onUseCurrentLocationForArea: jest.fn(), onRemoveMissingPhotos: jest.fn(async () => undefined),
  onRetryUpdateSync: jest.fn(async () => ({ status: 'failed' })), onApplyCloudConflictUpdate: jest.fn(),
  onApplyCloudConflictScheduleItem: jest.fn(), onApplyCloudRecovery: jest.fn(),
  onSaveCaptureMemory: jest.fn(async () => undefined),
});
type AlertButton = { text?: string; style?: string; onPress?: () => void };
function captureAlerts() {
  const shown: { title: string; message: string; buttons: AlertButton[] }[] = [];
  const { Alert } = require('react-native');
  const spy = jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    const [title, message, buttons] = args as [string, string, AlertButton[] | undefined];
    shown.push({ title, message, buttons: buttons ?? [] });
  });
  return { shown, spy };
}
const TIME_SEEN = (owner: string) => `@vitruvius/offline-sign-in/latest-time-seen/v1/${owner}`;
/** The lockout's wording for a clock earlier than a time already seen (A1 pass 3 L2). */
const clockMessage = (seenAtMs: number): string =>
  require('../services/OfflineSignInGrace').offlineSignInRefusalMessage('clock', seenAtMs);

// Whole-app audit A1 pass 2 review (30 Sep 2026): what David saw, end to end.
describe('A1 pass 2 review', () => {
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  test('#1 Settings, open offline with the sign-in pending, shows the account signed in and both Sign Out choices', async () => {
    await saveSignIn('owner-a', 14);
    await phoneWorkspaceOf('owner-a');
    mockSettingsProps = settingsProps();
    const { screen, rtl } = launch();
    const alerts = captureAlerts();
    try {
      await rtl.waitFor(() => expect(screen.getByTestId('offline-sign-in-pending-banner')).toBeTruthy(), OPEN);
      await rtl.waitFor(() => expect(screen.getByText(PENDING_ACCOUNT)).toBeTruthy(), OPEN);
      // Not "Sign in to enable cloud sync" with a Sign In button (what David saw).
      expect(screen.getByText('Sign Out')).toBeTruthy();
      expect(screen.queryByText(/^Sign in to enable cloud sync/)).toBeNull();
      // The banner, and Settings' connection status (it said "Needs Attention").
      expect(screen.getAllByText('Offline, sign-in pending')).toHaveLength(2);
      await rtl.act(async () => { rtl.fireEvent.press(screen.getByLabelText('Advanced and diagnostics')); });
      expect(screen.getByText('Sign-in Pending')).toBeTruthy();
      expect(screen.queryByText('No Session')).toBeNull();

      // Sign Out: the Q21 choices. All Devices needs signal and signs nothing out.
      await rtl.act(async () => { rtl.fireEvent.press(screen.getByText('Sign Out')); });
      await rtl.waitFor(() => expect(alerts.shown.map(alert => alert.title)).toEqual(['Sign Out']), OPEN);
      expect(alerts.shown[0].buttons.map(button => button.text)).toEqual([
        'Sign Out of This Device', 'Sign Out of All Devices', 'Cancel',
      ]);
      await rtl.act(async () => { alerts.shown[0].buttons[1].onPress?.(); await pause(50); });
      await rtl.waitFor(() => expect(alerts.shown.map(alert => alert.title)).toEqual(['Sign Out', 'Other devices not signed out']), OPEN);
      expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(true);
      expect(screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy();

      // This Device, with no signal (owner answer Q13).
      await rtl.act(async () => { alerts.shown[1].buttons[0].onPress?.(); await pause(50); });
      await rtl.waitFor(() => expect(screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
      await rtl.waitFor(() => expect(alerts.shown.map(alert => alert.title)).toContain('Signed out on this device'), OPEN);
      expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(false);
      expect(mockAsync.get(namespaced('owner-a', UPDATES))).toContain('update-owner-a');
    } finally {
      alerts.spy.mockRestore();
      screen.unmount();
    }
  });

  test('#2 an offline Sign Out stays signed out when signal returns during it and a sign-in refresh is answered', async () => {
    await saveSignIn('owner-a', 14);
    await phoneWorkspaceOf('owner-a');
    const { screen, rtl, service } = launch();
    await rtl.waitFor(() => expect(screen.getByText('Offline, sign-in pending')).toBeTruthy(), OPEN);

    // The Sign Out has begun removing the saved sign-in when signal returns
    // and auth-js's waiting retry runs. Before the fix the server answered it
    // with fresh tokens, which auth-js saved back into the Keychain.
    const refreshesBefore = network.calls.length;
    let raced = false;
    let retryWaiting = false;
    let retryRan = false;
    mockDuringSecureDelete = async key => {
      if (raced || key !== `${tokenKey()}-code-verifier.meta`) return;
      raced = true;
      network.mode = 'online';
      retryWaiting = mockSleepingRetries.size > 0;
      wakeSleepingRetries();
      // Answered by the server, or refused before it and waiting again.
      for (let i = 0; i < 300 && !retryRan; i += 1) {
        await pause(10);
        retryRan = network.calls.length > refreshesBefore || mockSleepingRetries.size > 0;
      }
      await pause(50);
    };
    let result: { ok: boolean; code?: string } | undefined;
    await rtl.act(async () => { result = await service.signOut(); });
    expect(raced).toBe(true);
    expect(retryWaiting).toBe(true);
    expect(retryRan).toBe(true);
    expect(result).toMatchObject({ ok: true, code: 'signed_out_on_this_device_only' });

    await rtl.waitFor(() => expect(screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
    // Every retry auth-js still has runs now, with signal.
    for (let round = 0; round < 20; round += 1) {
      await rtl.act(async () => { wakeSleepingRetries(); await pause(20); });
    }
    expect(screen.getByText(/^Sign in to /)).toBeTruthy();
    expect(screen.queryByText(/WORKSPACE OPEN/)).toBeNull();
    expect(mockWorkspaceMounts).toEqual(['owner-a']);
    expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(false);
    expect(JSON.parse(mockAsync.get(META) as string).activeOwnerId).toBeNull();
    // The signed-out sign-in's token never reached the server again.
    expect(network.calls.length).toBe(refreshesBefore);
    screen.unmount();
  });

  test('#5 a clock set back after the workspace was open offline is refused, and says so', async () => {
    await saveSignIn('owner-a', 6 * 24);
    await phoneWorkspaceOf('owner-a');
    const first = launch();
    await first.rtl.waitFor(() => expect(first.screen.getByText('Offline, sign-in pending')).toBeTruthy(), OPEN);
    const seenAtMs = Number(mockAsync.get(TIME_SEEN('owner-a')));
    first.screen.unmount();
    await client?.auth.stopAutoRefresh();

    // Five days back: the saved token (issued six days ago) alone looks one day old.
    const realNow = Date.now.bind(Date);
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() - 5 * 24 * HOUR * 1000);
    try {
      mockWorkspaceMounts.length = 0;
      const second = launch();
      await second.rtl.waitFor(() => expect(second.screen.getByText('Workspace protection needs attention')).toBeTruthy(), OPEN);
      // Pin changed deliberately (A1 pass 3 L2): it said "The phone's clock
      // looks wrong. Check Date & Time, then tap Retry.", also when the clock
      // was right and the time kept earlier was the wrong one.
      expect(second.screen.getByText(clockMessage(seenAtMs))).toBeTruthy();
      await second.rtl.act(async () => { await pause(300); });
      expect(mockWorkspaceMounts).toEqual([]);
      expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(true);
      second.screen.unmount();
    } finally {
      clock.mockRestore();
    }
  });

  test('#5 a clock set back while open offline locks on return to the app', async () => {
    await saveSignIn('owner-a', 14);
    await phoneWorkspaceOf('owner-a');
    const { screen, rtl } = launch();
    await rtl.waitFor(() => expect(screen.getByText('Offline, sign-in pending')).toBeTruthy(), OPEN);
    await rtl.waitFor(() => expect(mockAsync.has(TIME_SEEN('owner-a'))).toBe(true), OPEN);
    const seenAtMs = Number(mockAsync.get(TIME_SEEN('owner-a')));

    const realNow = Date.now.bind(Date);
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() - 2 * HOUR * 1000);
    try {
      const { AppState } = require('react-native');
      const listeners = (AppState.addEventListener as jest.Mock).mock.calls
        .filter(([type]) => type === 'change')
        .map(([, listener]) => listener as (state: string) => void);
      await rtl.act(async () => {
        listeners.forEach(listener => listener('active'));
        await pause(50);
      });
      // Pin changed deliberately (A1 pass 3 L2): the time seen, and what to do.
      await rtl.waitFor(() => expect(screen.getByText(clockMessage(seenAtMs))).toBeTruthy(), OPEN);
      expect(screen.queryByText(/WORKSPACE OPEN/)).toBeNull();
      expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(true);
    } finally {
      clock.mockRestore();
      screen.unmount();
    }
  });

  test('#5 a sign-in refresh the server answers clears the mark, so a clock since corrected does not lock', async () => {
    await saveSignIn('owner-a', 14);
    await phoneWorkspaceOf('owner-a');
    // Seen three days ahead once (the clock was wrong then).
    const seenAtMs = Date.now() + 3 * 24 * HOUR * 1000;
    mockAsync.set(TIME_SEEN('owner-a'), String(seenAtMs));
    const first = launch();
    // Pin changed deliberately (A1 pass 3 L2): the clock is right here, and
    // the lockout no longer says it "looks wrong".
    await first.rtl.waitFor(() => expect(first.screen.getByText(clockMessage(seenAtMs))).toBeTruthy(), OPEN);

    // Signal: Retry opens the workspace on a refreshed sign-in.
    network.mode = 'online';
    await first.rtl.act(async () => { first.rtl.fireEvent.press(first.screen.getByText('Retry')); });
    await first.rtl.waitFor(() => expect(first.screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy(), { timeout: 30_000 });
    await first.rtl.waitFor(() => expect(mockAsync.has(TIME_SEEN('owner-a'))).toBe(false), OPEN);
    first.screen.unmount();
    await client?.auth.stopAutoRefresh();
  });
});

/**
 * Whole-app audit A1 pass 3 (30 Sep 2026): what David saw, end to end.
 * L1: after about 25 seconds of failed retries auth-js answers "failed" for 60
 * more seconds without trying (its cooldown), and that answer was taken for no
 * signal: Retry on the lockout said "No signal" again, and Sign Out of All
 * Devices said it needs signal, with signal back and no request sent.
 * L2: a clock set ahead once, then corrected, was refused as "looks wrong".
 * L3/L4: the re-check while open offline counted the 7 days from opening when
 * the saved sign-in could not be read, and called every refusal "7 days".
 */
describe('A1 pass 3 review', () => {
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const EXPIRED = 'No signal, and your sign-in has not refreshed for 7 days. Your work is saved on this phone. Connect to the internet, then tap Retry.';
  const SIGNAL_BACK = 'Signal is back — finishing sign-in…';
  const REFRESH = 'POST /auth/v1/token?grant_type=refresh_token';
  const HEALTH = 'GET /auth/v1/health';
  const authCalls = (from: number) => network.calls.slice(from).filter(call => call === HEALTH || call.startsWith('POST /auth/v1/'));
  /**
   * auth-js gives up on the refresh (its ~25 s of retries, woken at once
   * here). From then on, for 60 seconds, it answers "failed" without trying.
   */
  async function refreshGivenUp(rtl: { act: (work: () => Promise<void>) => Promise<void> }) {
    for (let round = 0, idle = 0; round < 300 && idle < 5; round += 1) {
      await rtl.act(async () => { wakeSleepingRetries(); await pause(10); });
      idle = mockSleepingRetries.size === 0 ? idle + 1 : 0;
    }
    expect(mockSleepingRetries.size).toBe(0);
  }
  /** auth-js's minute of answering from the failure passes. */
  function afterCooldown() {
    const realNow = Date.now.bind(Date);
    return jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 61_000);
  }
  function appStateListeners(): ((state: string) => void)[] {
    const { AppState } = require('react-native');
    return (AppState.addEventListener as jest.Mock).mock.calls
      .filter(([type]) => type === 'change')
      .map(([, listener]) => listener as (state: string) => void);
  }

  test('L1 auth-js\'s cooldown is the one this fix waits out', () => {
    expect(jest.requireActual('@supabase/auth-js/dist/main/lib/constants').REFRESH_FAILURE_COOLDOWN_MS).toBe(60_000);
  });

  test('L1 Retry on the 7-day lockout: no signal still says so; with signal back it finishes the sign-in', async () => {
    await saveSignIn('owner-a', 7 * 24 + 1);
    await phoneWorkspaceOf('owner-a');
    const { screen, rtl } = launch();
    await rtl.waitFor(() => expect(screen.getByText(EXPIRED)).toBeTruthy(), OPEN);
    await refreshGivenUp(rtl);

    // Still no signal: the signal check fails too, and it says so as before.
    let from = network.calls.length;
    await rtl.act(async () => { rtl.fireEvent.press(screen.getByText('Retry')); });
    await rtl.waitFor(() => expect(screen.getByText(EXPIRED)).toBeTruthy(), OPEN);
    expect(authCalls(from)).toEqual([HEALTH]);

    // Signal is back. Before: "No signal…" again, and nothing was sent.
    network.mode = 'online';
    from = network.calls.length;
    await rtl.act(async () => { rtl.fireEvent.press(screen.getByText('Retry')); });
    await rtl.waitFor(() => expect(screen.getByText(SIGNAL_BACK)).toBeTruthy(), OPEN);
    expect(screen.queryByText(EXPIRED)).toBeNull();
    // It waits out auth-js's minute rather than refreshing past it.
    await rtl.act(async () => { await pause(1_500); });
    expect(authCalls(from)).toEqual([HEALTH]);
    expect(screen.getByText(SIGNAL_BACK)).toBeTruthy();

    const clock = afterCooldown();
    try {
      await rtl.waitFor(() => expect(screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy(), { timeout: 15_000 });
    } finally {
      clock.mockRestore();
    }
    expect(screen.queryByText('Offline, sign-in pending')).toBeNull();
    expect(authCalls(from)).toEqual([HEALTH, REFRESH]);
    expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(true);
    screen.unmount();
  });

  test('L1 Retry with signal back, and the server refuses the sign-in: the sign-in screen, not "No signal"', async () => {
    await saveSignIn('owner-a', 7 * 24 + 1);
    await phoneWorkspaceOf('owner-a');
    const { screen, rtl } = launch();
    await rtl.waitFor(() => expect(screen.getByText(EXPIRED)).toBeTruthy(), OPEN);
    await refreshGivenUp(rtl);

    network.mode = 'reject';
    await rtl.act(async () => { rtl.fireEvent.press(screen.getByText('Retry')); });
    await rtl.waitFor(() => expect(screen.getByText(SIGNAL_BACK)).toBeTruthy(), OPEN);
    const clock = afterCooldown();
    try {
      await rtl.waitFor(() => expect(screen.getByText(/^Sign in to /)).toBeTruthy(), { timeout: 15_000 });
    } finally {
      clock.mockRestore();
    }
    expect(screen.queryByText(EXPIRED)).toBeNull();
    expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(false);
    expect(mockAsync.get(namespaced('owner-a', UPDATES))).toContain('update-owner-a');
    screen.unmount();
  });

  test('L1 Sign Out of All Devices while offline, sign-in pending, with signal back: every device is signed out through the server', async () => {
    await saveSignIn('owner-a', 14);
    await phoneWorkspaceOf('owner-a');
    mockSettingsProps = settingsProps();
    const { screen, rtl } = launch();
    const alerts = captureAlerts();
    try {
      await rtl.waitFor(() => expect(screen.getByText(PENDING_ACCOUNT)).toBeTruthy(), OPEN);
      await refreshGivenUp(rtl);
      network.mode = 'online';
      const from = network.calls.length;

      await rtl.act(async () => { rtl.fireEvent.press(screen.getByText('Sign Out')); });
      await rtl.waitFor(() => expect(alerts.shown.map(alert => alert.title)).toEqual(['Sign Out']), OPEN);
      await rtl.act(async () => { alerts.shown[0].buttons[1].onPress?.(); await pause(50); });
      // Before: "Signing out your other devices needs signal… Nothing was
      // signed out", at once, with no request.
      await rtl.waitFor(() => expect(authCalls(from)).toEqual([HEALTH]), OPEN);
      await rtl.act(async () => { await pause(1_500); });
      expect(alerts.shown.map(alert => alert.title)).toEqual(['Sign Out']);

      const clock = afterCooldown();
      try {
        await rtl.waitFor(() => expect(alerts.shown.map(alert => alert.title)).toEqual(['Sign Out', 'Signed out of all devices']), { timeout: 15_000 });
      } finally {
        clock.mockRestore();
      }
      // The expired token is refreshed first: the sign-out needs a valid one.
      expect(authCalls(from)).toEqual([HEALTH, REFRESH, 'POST /auth/v1/logout?scope=global']);
      await rtl.waitFor(() => expect(screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
      expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(false);
      expect(mockAsync.get(namespaced('owner-a', UPDATES))).toContain('update-owner-a');
    } finally {
      alerts.spy.mockRestore();
      screen.unmount();
    }
  });

  test('L1 Sign Out of All Devices with signal back, and the server refuses the sign-in: says truthfully what happened', async () => {
    await saveSignIn('owner-a', 14);
    await phoneWorkspaceOf('owner-a');
    mockSettingsProps = settingsProps();
    const { screen, rtl } = launch();
    const alerts = captureAlerts();
    try {
      await rtl.waitFor(() => expect(screen.getByText(PENDING_ACCOUNT)).toBeTruthy(), OPEN);
      await refreshGivenUp(rtl);
      network.mode = 'reject';
      const from = network.calls.length;

      await rtl.act(async () => { rtl.fireEvent.press(screen.getByText('Sign Out')); });
      await rtl.waitFor(() => expect(alerts.shown.map(alert => alert.title)).toEqual(['Sign Out']), OPEN);
      await rtl.act(async () => { alerts.shown[0].buttons[1].onPress?.(); await pause(50); });
      await rtl.waitFor(() => expect(authCalls(from)).toEqual([HEALTH]), OPEN);
      const clock = afterCooldown();
      try {
        await rtl.waitFor(() => expect(alerts.shown.map(alert => alert.title)).toEqual(['Sign Out', 'Signed out on this device']), { timeout: 15_000 });
      } finally {
        clock.mockRestore();
      }
      expect(alerts.shown[1].message).toBe(
        'This device\'s sign-in had already ended on the server, so this device is now signed out. ' +
        'Your other devices were not signed out from here. To sign them out, sign in again, then choose Sign Out of All Devices.',
      );
      // No sign-out request could be made: the refused sign-in has no valid token.
      expect(authCalls(from)).toEqual([HEALTH, REFRESH]);
      await rtl.waitFor(() => expect(screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
      expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(false);
      expect(mockAsync.get(namespaced('owner-a', UPDATES))).toContain('update-owner-a');
    } finally {
      alerts.spy.mockRestore();
      screen.unmount();
    }
  });

  test('L2 a clock that was ahead when the workspace opened offline, since corrected: the lockout says what it saw and what to do', async () => {
    await saveSignIn('owner-a', 14);
    await phoneWorkspaceOf('owner-a');
    // Opened offline once with the clock three days ahead.
    const realNow = Date.now.bind(Date);
    const ahead = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 3 * 24 * HOUR * 1000);
    let seenAtMs = 0;
    try {
      const first = launch();
      await first.rtl.waitFor(() => expect(first.screen.getByText('Offline, sign-in pending')).toBeTruthy(), OPEN);
      seenAtMs = Number(mockAsync.get(TIME_SEEN('owner-a')));
      first.screen.unmount();
      await client?.auth.stopAutoRefresh();
    } finally {
      ahead.mockRestore();
    }
    expect(seenAtMs).toBeGreaterThan(Date.now() + 2 * 24 * HOUR * 1000);

    // The clock is right again, and there is still no signal.
    const second = launch();
    await second.rtl.waitFor(() => expect(second.screen.getByText('Workspace protection needs attention')).toBeTruthy(), OPEN);
    const shown = clockMessage(seenAtMs);
    expect(second.screen.getByText(shown)).toBeTruthy();
    const seenAt = new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(new Date(seenAtMs));
    expect(shown).toBe(
      `The phone's clock is earlier than a time this phone already saw on ${seenAt}. ` +
      'If the clock is right, connect to the internet, then tap Retry. If not, correct it in Date & Time, then tap Retry.',
    );
    second.screen.unmount();
  });

  test('L3 a saved sign-in that cannot be read while open offline: the 7 days still count from its last refresh', async () => {
    await saveSignIn('owner-a', 7 * 24 - 1 / 60); // one minute short of 7 days
    await phoneWorkspaceOf('owner-a');
    const { screen, rtl } = launch();
    await rtl.waitFor(() => expect(screen.getByText('Offline, sign-in pending')).toBeTruthy(), OPEN);
    // auth-js's launch refresh ends first: its first sign-in event then reads
    // the Keychain, which is not what is tested here.
    await refreshGivenUp(rtl);

    // Five minutes later the phone is locked (the Keychain refuses reads) as
    // the app returns to the foreground. Before: open for 7 days from opening.
    const realNow = Date.now.bind(Date);
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 5 * 60_000);
    try {
      mockFailingSecureReads = true;
      await rtl.act(async () => {
        appStateListeners().forEach(listener => listener('active'));
        await pause(50);
      });
      await rtl.waitFor(() => expect(screen.getByText(EXPIRED)).toBeTruthy(), OPEN);
      expect(screen.queryByText(/WORKSPACE OPEN/)).toBeNull();
    } finally {
      mockFailingSecureReads = false;
      clock.mockRestore();
      screen.unmount();
    }
    // Locked, not signed out.
    expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(true);
  });

  test('L4 the re-check while open offline says why: a sign-in gone from the Keychain is not "7 days"', async () => {
    await saveSignIn('owner-a', 14);
    await phoneWorkspaceOf('owner-a');
    const { screen, rtl } = launch();
    await rtl.waitFor(() => expect(screen.getByText('Offline, sign-in pending')).toBeTruthy(), OPEN);
    await refreshGivenUp(rtl);

    // The saved sign-in is gone from the Keychain, with no sign-in event.
    [...mockSecure.keys()].filter(key => key.startsWith(tokenKey())).forEach(key => mockSecure.delete(key));
    await rtl.act(async () => {
      appStateListeners().forEach(listener => listener('active'));
      await pause(50);
    });
    await rtl.waitFor(() => expect(screen.getByText(
      'No signal, and Vitruvius could not confirm your sign-in on this phone. Connect to the internet, then tap Retry.',
    )).toBeTruthy(), OPEN);
    expect(screen.queryByText(/has not refreshed for 7 days/)).toBeNull();
    screen.unmount();
  });
});
