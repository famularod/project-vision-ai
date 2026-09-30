/**
 * Owner answer Q21 (30 Sep 2026): "you should have the option to just sign out
 * locally or sign out for all devices." Every Sign Out in Settings used
 * auth-js's default scope, 'global', which ends every sign-in of the account:
 * signing out on the phone also signed out the iPad and the computer. Settings
 * now asks: Sign Out of This Device (scope=local) or Sign Out of All Devices
 * (scope=global), after the same unsynced-work warning. All Devices with no
 * signal signs nothing out and offers This Device instead. Both choices clear
 * this phone exactly as before (Keychain, owner sandbox, queue).
 *
 * Real NativeRoot, owner sandbox, SupabaseService, supabase-js/auth-js,
 * SecureStore adapter and Settings screen; replaced: the native stores
 * (in-memory), fetch (captured: the request auth-js sends is what is checked),
 * App (a marker) and the retry boundary. Harness from app-offline-sign-in.
 */
const mockSecure = new Map<string, string>();
const mockAsync = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async (key: string) => mockSecure.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockSecure.set(key, value); }),
  deleteItemAsync: jest.fn(async (key: string) => { mockSecure.delete(key); }),
}));
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: async (key: string) => mockAsync.get(key) ?? null,
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
jest.mock('expo-crypto', () => ({
  randomUUID: () => require('crypto').randomUUID(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: jest.fn(async () => new ArrayBuffer(32)),
}));
jest.mock('../components/pending-changes-retry-boundary', () => ({
  PendingChangesRetryBoundary: ({ children }: { children: unknown }) => children,
}));
// auth-js sleeps between retries of an unanswered refresh; each test ends
// them so nothing logs after the file (as in app-offline-sign-in).
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
jest.mock('../App', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const { useNativeWorkspaceOwner } = require('../components/native-workspace-owner');
  function WorkspaceMarker() {
    const owner = useNativeWorkspaceOwner();
    return React.createElement(Text, null, `WORKSPACE OPEN ${owner}`);
  }
  return { __esModule: true, default: WorkspaceMarker };
});

type Mode = 'offline' | 'reject' | 'online';
const network = { mode: 'offline' as Mode, calls: [] as string[] };
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
  if (network.mode === 'offline') throw new TypeError('Network request failed');
  if (url.pathname === '/auth/v1/token') {
    return json(400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' });
  }
  if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
  return json(404, { message: `not emulated: ${url.pathname}` });
});

jest.setTimeout(60_000);
const META = '@vitruvius/owner-storage-sandbox/metadata/v1';
// The owner's saved field updates stand for his work on this phone. (The
// sync queue is not used: Settings, online, works through it by itself.)
const UPDATES = 'projectPhotoUpdates.v2';
const namespaced = (owner: string, key: string) =>
  `@vitruvius/owner-storage-sandbox/owner/${owner}/value/${encodeURIComponent(key)}`;
const logoutCalls = () => network.calls.filter(call => call.startsWith('POST /auth/v1/logout'));

const THIS_DEVICE = 'Sign Out of This Device';
const ALL_DEVICES = 'Sign Out of All Devices';
const CHOICES_EXPLAINED =
  'This Device: your other devices stay signed in.\n' +
  'All Devices: your other devices are signed out too, within an hour or when they next have signal. Use this if a device is lost.';
const NEEDS_SIGNAL =
  'Signing out your other devices needs signal, and Vitruvius could not reach the cloud just now. Nothing was signed out.';

let projectRef = '';
let client: { auth: { stopAutoRefresh: () => Promise<void> } } | null = null;
const tokenKey = () => `sb-${projectRef}-auth-token`;

type AlertButton = { text?: string; style?: string; onPress?: () => void };
type ShownAlert = { title: string; message: string; buttons: AlertButton[] };

function launch() {
  jest.resetModules();
  const React = require('react');
  const rtl = require('@testing-library/react-native/pure');
  const { NativeRoot } = require('../entry');
  const service = require('../services/SupabaseService');
  client = service.getSupabaseClient();
  const screen = rtl.render(React.createElement(NativeRoot));
  const alerts: ShownAlert[] = [];
  const { Alert } = require('react-native');
  jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    const [title, message, buttons] = args as [string, string, AlertButton[] | undefined];
    alerts.push({ title, message, buttons: buttons ?? [] });
  });
  return { screen, rtl, service, alerts, React };
}

async function saveSignIn(owner: string, lastRefreshedHoursAgo: number) {
  const { supabaseSecureAuthStorage } = require('../services/SupabaseAuthStorage');
  const issuedAt = Math.floor(Date.now() / 1000) - Math.round(lastRefreshedHoursAgo * HOUR);
  await supabaseSecureAuthStorage.setItem(tokenKey(), JSON.stringify({
    access_token: `access-${owner}-1`, refresh_token: `refresh-${owner}`, token_type: 'bearer',
    expires_in: HOUR, expires_at: issuedAt + HOUR, user: userFor(owner),
  }));
}

function phoneWorkspaceOf(owner: string) {
  mockAsync.set(META, JSON.stringify({
    version: 1, activeOwnerId: owner, legacyAssignedOwnerId: null, updatedAt: '2026-09-29T17:00:00.000Z',
  }));
  mockAsync.set(UPDATES, JSON.stringify([{ id: `update-${owner}`, status: 'queued' }]));
}

function renderSettings(app: ReturnType<typeof launch>) {
  const { AdminScreen } = require('../screens/AdminScreen');
  return app.rtl.render(app.React.createElement(AdminScreen, {
    localProjects: ['Canopy B'], savedUpdates: [], projectAreas: [], scheduleItems: [],
    referenceDocuments: [], syncCleanupNotice: null, displayName: 'Dana', onDisplayNameChange: jest.fn(),
    failedDocumentCount: 2,
    onBack: jest.fn(), onDiagnostics: jest.fn(), onBackup: jest.fn(), onRestore: jest.fn(),
    onAddArea: jest.fn(() => true), onUpdateArea: jest.fn(), onDeleteArea: jest.fn(),
    onUseCurrentLocationForArea: jest.fn(), onRemoveMissingPhotos: jest.fn(async () => undefined),
    onRetryUpdateSync: jest.fn(async () => ({ status: 'failed' })), onApplyCloudConflictUpdate: jest.fn(),
    onApplyCloudConflictScheduleItem: jest.fn(), onApplyCloudRecovery: jest.fn(),
    onSaveCaptureMemory: jest.fn(async () => undefined),
  }));
}

/** Settings > Sign Out, then one of the alert's buttons. */
async function chooseSignOut(app: ReturnType<typeof launch>, settings: any, choice: string) {
  await app.rtl.waitFor(() => expect(settings.getByText('Sign Out')).toBeTruthy(), OPEN);
  await app.rtl.act(async () => { app.rtl.fireEvent.press(settings.getByText('Sign Out')); });
  await pressAlertButton(app, 'Sign Out', choice);
}

async function pressAlertButton(app: ReturnType<typeof launch>, title: string, text: string) {
  await app.rtl.waitFor(() => expect(app.alerts.map(alert => alert.title)).toContain(title), OPEN);
  const shown = [...app.alerts].reverse().find(alert => alert.title === title)!;
  const button = shown.buttons.find(candidate => candidate.text === text);
  expect(button).toBeTruthy();
  await app.rtl.act(async () => { button?.onPress?.(); await pause(50); });
}

/** The same local clearing as every sign-out: Keychain, then the owner sandbox keeps his work aside. */
function expectSignedOutLocally(owner: string) {
  expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(false);
  expect(JSON.parse(mockAsync.get(META) as string).activeOwnerId).toBeNull();
  expect(mockAsync.has(UPDATES)).toBe(false);
  expect(mockAsync.get(namespaced(owner, UPDATES))).toContain(`update-${owner}`);
}

function expectStillSignedIn(owner: string) {
  expect(mockSecure.has(`${tokenKey()}.meta`)).toBe(true);
  expect(JSON.parse(mockAsync.get(META) as string).activeOwnerId).toBe(owner);
  expect(mockAsync.get(UPDATES)).toContain(`update-${owner}`);
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const OPEN = { timeout: 10_000 } as const;
let refSequence = 0;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  refSequence += 1;
  projectRef = `sign-out-q21-${refSequence}`;
  process.env.EXPO_PUBLIC_SUPABASE_URL = `https://${projectRef}.supabase.co`;
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'q21-anon-key-not-a-secret';
  mockSecure.clear();
  mockAsync.clear();
  network.mode = 'online';
  network.calls = [];
});
afterEach(async () => {
  network.mode = 'reject';
  await client?.auth.stopAutoRefresh();
  for (let round = 0; round < 100; round += 1) {
    [...mockSleepingRetries].forEach(wake => wake());
    await pause(10);
    if (mockSleepingRetries.size === 0 && round >= 2) break;
  }
  client = null;
  jest.restoreAllMocks();
});

test('Sign Out asks which devices, after the unsynced-work warning; Cancel signs nothing out', async () => {
  await saveSignIn('owner-a', 0.2);
  phoneWorkspaceOf('owner-a');
  const app = launch();
  await app.rtl.waitFor(() => expect(app.screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy(), OPEN);
  const settings = renderSettings(app);

  await app.rtl.waitFor(() => expect(settings.getByText('Sign Out')).toBeTruthy(), OPEN);
  await app.rtl.act(async () => { app.rtl.fireEvent.press(settings.getByText('Sign Out')); });
  await app.rtl.waitFor(() => expect(app.alerts).toHaveLength(1), OPEN);
  const [shown] = app.alerts;
  expect(shown.title).toBe('Sign Out');
  // The warning comes first, then what each choice does.
  expect(shown.message).toMatch(/^\d+ items are not in the cloud yet\. They stay on this phone and sync after you sign in here again with this account\. Sign out anyway\?\n\n/);
  expect(shown.message.endsWith(`\n\n${CHOICES_EXPLAINED}`)).toBe(true);
  expect(shown.buttons.map(button => [button.text, button.style])).toEqual([
    [THIS_DEVICE, 'destructive'],
    [ALL_DEVICES, 'destructive'],
    ['Cancel', 'cancel'],
  ]);

  await app.rtl.act(async () => { shown.buttons[2].onPress?.(); await pause(50); });
  expect(logoutCalls()).toEqual([]);
  expectStillSignedIn('owner-a');
  settings.unmount();
  app.screen.unmount();
});

test('Sign Out of This Device ends only this device\'s sign-in (scope=local) and clears the phone as before', async () => {
  await saveSignIn('owner-a', 0.2);
  phoneWorkspaceOf('owner-a');
  const app = launch();
  await app.rtl.waitFor(() => expect(app.screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy(), OPEN);
  const settings = renderSettings(app);

  await chooseSignOut(app, settings, THIS_DEVICE);

  await app.rtl.waitFor(() => expect(app.screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
  expect(logoutCalls()).toEqual(['POST /auth/v1/logout?scope=local']);
  expectSignedOutLocally('owner-a');
  expect(app.alerts.map(alert => alert.title)).toEqual(['Sign Out']);
  settings.unmount();
  app.screen.unmount();
});

test('Sign Out of All Devices ends every sign-in (scope=global), clears the phone the same way, and says so', async () => {
  await saveSignIn('owner-a', 0.2);
  phoneWorkspaceOf('owner-a');
  const app = launch();
  await app.rtl.waitFor(() => expect(app.screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy(), OPEN);
  const settings = renderSettings(app);

  await chooseSignOut(app, settings, ALL_DEVICES);

  await app.rtl.waitFor(() => expect(app.screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
  expect(logoutCalls()).toEqual(['POST /auth/v1/logout?scope=global']);
  expectSignedOutLocally('owner-a');
  await app.rtl.waitFor(() => expect(app.alerts.map(alert => alert.title)).toEqual(['Sign Out', 'Signed out of all devices']), OPEN);
  expect(app.alerts[1].message).toBe('Your other devices will be signed out within an hour or when they next have signal.');
  settings.unmount();
  app.screen.unmount();
});

test('Sign Out of All Devices with no signal signs nothing out, says why, and offers This Device', async () => {
  await saveSignIn('owner-a', 0.2);
  phoneWorkspaceOf('owner-a');
  const app = launch();
  await app.rtl.waitFor(() => expect(app.screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy(), OPEN);
  const settings = renderSettings(app);
  network.mode = 'offline';

  await chooseSignOut(app, settings, ALL_DEVICES);

  await app.rtl.waitFor(() => expect(app.alerts.map(alert => alert.title)).toEqual(['Sign Out', 'Other devices not signed out']), OPEN);
  const noSignal = app.alerts[1];
  expect(noSignal.message).toBe(`${NEEDS_SIGNAL}\n\nYou can sign out of this device now. Your other devices stay signed in.`);
  expect(noSignal.buttons.map(button => [button.text, button.style])).toEqual([
    [THIS_DEVICE, 'destructive'],
    ['Cancel', 'cancel'],
  ]);
  // Tried, not reached, and not quietly turned into a sign-out of this device.
  expect(logoutCalls()).toEqual(['POST /auth/v1/logout?scope=global']);
  await app.rtl.act(async () => { await pause(300); });
  expectStillSignedIn('owner-a');
  expect(app.screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy();

  // He chooses this device: the owner answer Q13 sign-out with no signal.
  await pressAlertButton(app, 'Other devices not signed out', THIS_DEVICE);
  await app.rtl.waitFor(() => expect(app.screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
  expect(logoutCalls()).toEqual(['POST /auth/v1/logout?scope=global', 'POST /auth/v1/logout?scope=local']);
  expectSignedOutLocally('owner-a');
  await app.rtl.waitFor(() => expect(app.alerts.map(alert => alert.title)).toEqual([
    'Sign Out', 'Other devices not signed out', 'Signed out on this device',
  ]), OPEN);
  expect(app.alerts[2].message).toBe('Signed out on this device only. There was no signal, so your other devices stay signed in.');
  settings.unmount();
  app.screen.unmount();
});

test('All Devices with an expired sign-in and no signal: no request, nothing signed out; This Device still signs out here', async () => {
  await saveSignIn('owner-a', 14);
  phoneWorkspaceOf('owner-a');
  network.mode = 'offline';
  const app = launch();
  await app.rtl.waitFor(() => expect(app.screen.getByText('WORKSPACE OPEN owner-a')).toBeTruthy(), OPEN);

  let result: { ok: boolean; code?: string; error?: string } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await app.rtl.act(async () => {
    // It answers at once: it does not wait out auth-js's retries of the refresh.
    result = await Promise.race([
      app.service.signOut('global'),
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 5_000); }),
    ]);
  });
  clearTimeout(timer);
  expect(result).toMatchObject({ ok: false, code: 'sign_out_of_all_devices_needs_signal', error: NEEDS_SIGNAL });
  expect(logoutCalls()).toEqual([]);
  expectStillSignedIn('owner-a');

  await app.rtl.act(async () => { result = await app.service.signOut('local'); });
  expect(result).toMatchObject({ ok: true, code: 'signed_out_on_this_device_only' });
  await app.rtl.waitFor(() => expect(app.screen.getByText(/^Sign in to /)).toBeTruthy(), OPEN);
  expectSignedOutLocally('owner-a');
  app.screen.unmount();
});
