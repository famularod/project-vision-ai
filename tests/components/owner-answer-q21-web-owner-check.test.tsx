/**
 * Audit A12 F2 with owner answer Q21 (30 Sep 2026), end to end on the web:
 * the real DesktopAuthProvider, read-only repository and gateway over a real
 * supabase-js client whose fetch is captured. When one owner check could not
 * finish (a statement timeout, 57014), the web used to sign itself out of
 * every device with "This account is not authorized…". It now keeps the
 * workspace and says automatic refresh is waiting. A definite refusal still
 * signs out, of this browser only (scope=local).
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';

import {
  DesktopAuthProvider,
  useDesktopAuth,
} from '../../components/web-shell/desktop-auth-provider';

type Reply = 'ok' | 'network' | { status: number; body?: unknown };
const mockCloud = {
  calls: [] as string[],
  owner: true as boolean | Reply,
};
/** The browser's saved sign-in (read only when the client asks for it). */
const mockSessionValues = new Map<string, string>();
const SESSION_KEY = 'sb-q21-provider-auth-token';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../../services/DAVEWebSupabaseClient', () => {
  const actual = jest.requireActual('../../services/DAVEWebSupabaseClient');
  const { createClient } = jest.requireActual('@supabase/supabase-js');
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
  });
  const capturedFetch = async (input: unknown, init?: { method?: string }) => {
    const url = new URL(String(typeof input === 'string' ? input : (input as { url: string }).url));
    mockCloud.calls.push(`${init?.method || 'GET'} ${url.pathname}${url.search}`);
    if (url.pathname === '/auth/v1/user') {
      return json(200, { id: 'owner-1', aud: 'authenticated', email: 'owner@example.com' });
    }
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    if (url.pathname === '/rest/v1/rpc/dave_is_app_owner') {
      const owner = mockCloud.owner;
      if (typeof owner === 'boolean' || owner === 'ok') return json(200, owner === 'ok' ? true : owner);
      if (owner === 'network') throw new TypeError('Failed to fetch');
      return json(owner.status, owner.body ?? {});
    }
    if (url.pathname.startsWith('/rest/v1/')) return json(200, []);
    return json(404, { message: `not emulated: ${url.pathname}` });
  };
  // auth-js reads it once as the module loads, before this file's constants exist.
  const values = {
    get: (key: string) => mockSessionValues?.get(key),
    set: (key: string, value: string) => mockSessionValues?.set(key, value),
    delete: (key: string) => mockSessionValues?.delete(key),
  };
  const client = createClient('https://q21-provider.supabase.co', 'q21-anon-key-not-a-secret', {
    auth: {
      storage: {
        getItem: async (key: string) => values.get(key) ?? null,
        setItem: async (key: string, value: string) => { values.set(key, value); },
        removeItem: async (key: string) => { values.delete(key); },
      },
      storageKey: 'sb-q21-provider-auth-token',
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: capturedFetch },
  });
  const gateway = actual.createDAVEWebSupabaseGateway(client);
  return {
    ...actual,
    daveWebSupabaseGateway: {
      ...gateway,
      // Realtime needs a socket; this test is about the owner check.
      subscribeToAuthorizedOperationalChanges: async () => () => undefined,
    },
  };
});

function Harness() {
  const auth = useDesktopAuth();
  return (
    <View>
      <Text testID="phase">{auth.phase}</Text>
      <Text testID="message">{auth.message || 'none'}</Text>
      <Text testID="snapshot">{auth.snapshot ? 'kept' : 'none'}</Text>
      <Pressable testID="refresh" onPress={() => { void auth.refreshSnapshot(); }}>
        <Text>Refresh</Text>
      </Pressable>
      <Pressable testID="sign-out" onPress={() => { void auth.signOutOfDesktop(); }}>
        <Text>Sign out</Text>
      </Pressable>
      <Pressable testID="sign-out-all" onPress={() => { void auth.signOutOfDesktop('global'); }}>
        <Text>Sign out of all devices</Text>
      </Pressable>
    </View>
  );
}

const text = (screen: ReturnType<typeof render>, id: string) => screen.getByTestId(id).props.children;
const logoutCalls = () => mockCloud.calls.filter(call => call.startsWith('POST /auth/v1/logout'));
const tableReads = () => mockCloud.calls.filter(call => /^GET \/rest\/v1\/(projects|schedule_items|project_updates|dave_sync_tombstones)/.test(call));
const originalBroadcastChannel = globalThis.BroadcastChannel;

beforeAll(() => {
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
});
afterAll(() => {
  globalThis.BroadcastChannel = originalBroadcastChannel;
});
beforeEach(() => {
  mockCloud.calls = [];
  mockCloud.owner = true;
  mockSessionValues.clear();
  const now = Math.floor(Date.now() / 1000);
  mockSessionValues.set(SESSION_KEY, JSON.stringify({
    access_token: 'access-owner-1', refresh_token: 'refresh-owner-1', token_type: 'bearer',
    expires_in: 3600, expires_at: now + 3600,
    user: { id: 'owner-1', aud: 'authenticated', email: 'owner@example.com' },
  }));
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('a timed-out owner check keeps the workspace with the waiting banner; a refusal signs out this browser only', async () => {
  const screen = render(<DesktopAuthProvider><Harness /></DesktopAuthProvider>);
  await waitFor(() => expect(text(screen, 'phase')).toBe('ready'));
  expect(text(screen, 'snapshot')).toBe('kept');

  // Six minutes on, past the five-minute owner-check cache, one check times out.
  const realNow = Date.now.bind(Date);
  jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 6 * 60_000);
  mockCloud.owner = { status: 500, body: { code: '57014', message: 'canceling statement due to statement timeout' } };
  mockCloud.calls = [];
  fireEvent.press(screen.getByTestId('refresh'));

  await waitFor(() => expect(text(screen, 'message')).toBe(
    'Automatic cloud refresh is waiting. Your current workspace remains available.',
  ));
  expect(text(screen, 'phase')).toBe('ready');
  expect(text(screen, 'snapshot')).toBe('kept');
  expect(mockCloud.calls).toContain('POST /rest/v1/rpc/dave_is_app_owner');
  expect(tableReads()).toEqual([]);
  expect(logoutCalls()).toEqual([]);

  // The owner check now says 403: signed out, of this browser only.
  mockCloud.owner = { status: 403, body: { code: '42501', message: 'permission denied' } };
  fireEvent.press(screen.getByTestId('refresh'));
  await waitFor(() => expect(text(screen, 'phase')).toBe('unauthorized'));
  expect(text(screen, 'message')).toBe('This account is not authorized for the Vitruvius desktop pilot.');
  expect(logoutCalls()).toEqual(['POST /auth/v1/logout?scope=local']);
  expect(tableReads()).toEqual([]);
  screen.unmount();
});

test.each([
  ['sign-out', 'POST /auth/v1/logout?scope=local'],
  ['sign-out-all', 'POST /auth/v1/logout?scope=global'],
])('signOutOfDesktop sends the chosen scope (%s)', async (button, request) => {
  const screen = render(<DesktopAuthProvider><Harness /></DesktopAuthProvider>);
  await waitFor(() => expect(text(screen, 'phase')).toBe('ready'));
  mockCloud.calls = [];
  fireEvent.press(screen.getByTestId(button));
  await waitFor(() => expect(text(screen, 'phase')).toBe('signed_out'));
  expect(logoutCalls()).toEqual([request]);
  expect(mockSessionValues.has(SESSION_KEY)).toBe(false);
  screen.unmount();
});
