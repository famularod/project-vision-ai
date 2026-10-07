/**
 * @jest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { forgetDAVEWebOwnReportSends, forgetDAVEWebReportTabMemory } from '../../services/DAVEWebReportSend';
import { DAVE_WEB_REFRESH_WAIT_MS, createDAVEWebSignInRefreshGuard } from '../../services/DAVEWebSignInRefreshGuard';
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { supabaseSecureAuthStorage } from '../../services/SupabaseAuthStorage.web';
import {
  TAB_ACCOUNTS,
  TAB_STORAGE_KEY,
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

// Batch W1, item 3 (6 Oct 2026; the reviewer's pass-4 L3, as on Build 229).
// When the sign-in server answered a routine refresh with "too many
// requests" (429), auth-js took that for a refusal: with the hourly token run
// out the tab dropped to the sign-in page, and (since review N2) the
// account's report periods were removed from the browser with it. A rate
// limit is not an ended sign-in.
//
// Now the tab keeps its sign-in and tries again later: the page is told what
// it is told when the server cannot be reached ("still signed in", and it
// tries again), and until the time the server asked for has passed the
// tab's refreshes are answered without asking the server again.
// The gateway and supabase-js are real; the cloud is the tab fixture's, which
// here can also answer a refresh with 429.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.setTimeout(30_000);

const root = globalThis as unknown as Record<string, unknown>;
const originalDocument = root.document;
const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWarn = console.warn;
const originalError = console.error;

type Server = {
  /** What a refresh is answered: as usual, or "too many requests" (with the wait the server names, in seconds). */
  refresh: 'ok' | Readonly<{ tooManyRequests: true; retryAfterSeconds?: number }>;
  /** Whether a password sign-in is answered "too many requests". */
  passwordTooManyRequests: boolean;
  /** The refreshes that reached the server. */
  refreshesAsked: number;
};
let server: Server;
let cloud: TabCloud;
let tabStorage: TabStorage;
let profile: TabStorage;
let client: SupabaseClient;
let gateway: ReturnType<typeof createDAVEWebSupabaseGateway>;
let heard: string[] = [];
let stopListening: () => void = () => undefined;

beforeAll(() => {
  root.document = { visibilityState: 'visible', addEventListener: jest.fn(), removeEventListener: jest.fn() };
  root.addEventListener = jest.fn();
  root.removeEventListener = jest.fn();
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('Multiple GoTrueClient instances')) return;
    originalWarn(...args);
  });
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const text = String(args[0]);
    if (text.includes('AuthRetryableFetchError') || text.includes('AuthApiError') || text.includes('rate limit')) return;
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

function createServer(): TabCloud {
  const base = createTabCloud();
  server = { refresh: 'ok', passwordTooManyRequests: false, refreshesAsked: 0 };
  const fetch: TabCloud['fetch'] = async (input, init) => {
    const url = new URL(String(typeof input === 'string' ? input : (input as { url: string }).url));
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password' && server.passwordTooManyRequests) {
      return new Response(JSON.stringify({ code: 'over_request_rate_limit', message: 'Request rate limit reached' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
      });
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      server.refreshesAsked += 1;
      if (server.refresh !== 'ok') {
        const wait = server.refresh.retryAfterSeconds;
        return new Response(JSON.stringify({ code: 'over_request_rate_limit', message: 'Request rate limit reached' }), {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'x-supabase-api-version': '2024-01-01',
            ...(wait === undefined ? {} : { 'retry-after': String(wait) }),
          },
        });
      }
    }
    return base.fetch(input, init);
  };
  return { ...base, fetch };
}

const settle = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
const PERIOD_KEY = '@vitruvius/web/owner-1/@vitruvius/report-snapshots/v1/probe';
const periodKeys = () => [...profile.values.keys()].filter(key => key.startsWith('@vitruvius/web/'));

beforeEach(() => {
  profile = createTabStorage();
  profile.setItem(PERIOD_KEY, '{"scopeKey":"x"}');
  cloud = createServer();
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
  // auth-js tries a refresh that could not be answered again for up to 30 s, and then leaves it for a
  // minute: the test's clock moves instead of the test waiting.
  jest.useFakeTimers({ advanceTimers: true });
});
afterEach(async () => {
  stopListening();
  // Nothing auth-js still has under way runs on after the test.
  await jest.advanceTimersByTimeAsync(3 * 60_000);
  closeTabClient(client);
  jest.useRealTimers();
  await settle();
});

/** This tab signed in as the owner, its requests going through the guard; `asLeft`: left for over an hour. */
async function openTab({ asLeft = false, listening = true }: { asLeft?: boolean; listening?: boolean } = {}) {
  tabStorage = createTabStorage();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: tabStorage });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
  storeTabSignIn(tabStorage, 'owner-1', { expired: asLeft });
  const guard = createDAVEWebSignInRefreshGuard({ fetch: cloud.fetch as never, shared: () => profile, tab: () => tabStorage });
  client = createTabClient(supabaseSecureAuthStorage, { ...cloud, fetch: guard.fetch } as unknown as TabCloud);
  gateway = createDAVEWebSupabaseGateway(client, guard);
  heard = [];
  if (listening) thePageListens();
}
function thePageListens() {
  stopListening = gateway.subscribeToAuthStateChange(event => { if (event !== 'INITIAL_SESSION') heard.push(event); });
}
function hourlyTokenRunsOut() {
  const key = `dave.web.auth.${TAB_STORAGE_KEY}`;
  const session = JSON.parse(String(tabStorage.getItem(key))) as { expires_at: number };
  tabStorage.setItem(key, JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 60 }));
}

/** Lets auth-js's own retries (up to 30 s) and waits run without the test waiting for them. */
async function whileTimePasses<T>(work: Promise<T>, seconds = 90): Promise<T> {
  let done = false;
  const outcome = work
    .then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
    .finally(() => { done = true; });
  for (let second = 0; second < seconds && !done; second += 1) await jest.advanceTimersByTimeAsync(1_000);
  const result = await outcome;
  if (!result.ok) throw result.error;
  return result.value;
}
const STILL_SIGNED_IN = 'The desktop session could not be checked.';

describe('a routine refresh answered "too many requests"', () => {
  it('a tab left for over an hour: it keeps its sign-in, hears no sign-out, and the report periods stay', async () => {
    server.refresh = { tooManyRequests: true };
    await openTab({ asLeft: true });
    await whileTimePasses(client.auth.initialize());

    // What the page is told when the server cannot be reached: still signed in, try again.
    await expect(whileTimePasses(gateway.getSessionStatus())).rejects.toThrow(STILL_SIGNED_IN);
    await settle();

    expect(heard).toEqual([]);
    expect(tabHoldsSignIn(tabStorage)).toBe(true);
    expect(tabSignIn(tabStorage)?.refreshToken).toBe('refresh:owner-1:1');
    expect(periodKeys()).toEqual([PERIOD_KEY]);
  });

  it('…as the tab starts, before its page listens: the page starting to listen removes nothing', async () => {
    server.refresh = { tooManyRequests: true };
    await openTab({ asLeft: true, listening: false });
    await whileTimePasses(client.auth.getSession());

    thePageListens();
    // The page's first look at the sign-in has been answered (auth-js tells a new listener of it).
    await expect(whileTimePasses(gateway.getSessionStatus())).rejects.toThrow(STILL_SIGNED_IN);
    await settle();

    expect(heard).toEqual([]);
    expect(tabHoldsSignIn(tabStorage)).toBe(true);
    expect(periodKeys()).toEqual([PERIOD_KEY]);
  });

  it('it tries again later: once the server answers, he is signed in as before, with new tokens', async () => {
    await openTab();
    await client.auth.initialize();
    server.refresh = { tooManyRequests: true };
    hourlyTokenRunsOut();
    await expect(whileTimePasses(gateway.getSessionStatus())).rejects.toThrow(STILL_SIGNED_IN);

    // The server is no longer counting; the wait it asked for (a minute, as it named none) has passed.
    server.refresh = 'ok';
    await jest.advanceTimersByTimeAsync(2 * DAVE_WEB_REFRESH_WAIT_MS + 5_000);
    const status = await whileTimePasses(gateway.getSessionStatus());
    await settle();

    expect(status.session?.user.id).toBe('owner-1');
    expect(tabSignIn(tabStorage)?.refreshToken).not.toBe('refresh:owner-1:1');
    expect(heard).toEqual(['TOKEN_REFRESHED']);
    expect(await gateway.authorizedOwnerId()).toBe('owner-1');
    expect(periodKeys()).toEqual([PERIOD_KEY]);
  });

  it('the server is asked once, not again and again: the tab’s own retries inside the wait are answered here', async () => {
    await openTab();
    await client.auth.initialize();
    server.refresh = { tooManyRequests: true };
    hourlyTokenRunsOut();

    await expect(whileTimePasses(gateway.getSessionStatus())).rejects.toThrow(STILL_SIGNED_IN);
    await expect(whileTimePasses(gateway.getSessionStatus())).rejects.toThrow(STILL_SIGNED_IN);

    expect(server.refreshesAsked).toBe(1);
  });

  it('the wait is the one the server names, up to ten minutes', async () => {
    await openTab();
    await client.auth.initialize();
    server.refresh = { tooManyRequests: true, retryAfterSeconds: 300 };
    hourlyTokenRunsOut();
    await expect(whileTimePasses(gateway.getSessionStatus())).rejects.toThrow(STILL_SIGNED_IN);
    server.refresh = 'ok';

    // Four minutes on: still inside the five the server asked for.
    await jest.advanceTimersByTimeAsync(4 * 60_000);
    await expect(whileTimePasses(gateway.getSessionStatus())).rejects.toThrow(STILL_SIGNED_IN);
    expect(server.refreshesAsked).toBe(1);

    // Past it (and past auth-js's own minute of not asking again).
    await jest.advanceTimersByTimeAsync(2 * 60_000 + 5_000);
    expect((await whileTimePasses(gateway.getSessionStatus())).session?.user.id).toBe('owner-1');
    expect(server.refreshesAsked).toBe(2);

    // A server that names a day is not waited on for a day.
    server.refresh = { tooManyRequests: true, retryAfterSeconds: 86_400 };
    hourlyTokenRunsOut();
    await jest.advanceTimersByTimeAsync(2 * 60_000);
    await expect(whileTimePasses(gateway.getSessionStatus())).rejects.toThrow(STILL_SIGNED_IN);
    server.refresh = 'ok';
    await jest.advanceTimersByTimeAsync(12 * 60_000);
    expect((await whileTimePasses(gateway.getSessionStatus())).session?.user.id).toBe('owner-1');
  });

  it('guard: only a refresh is held back. A password sign-in answered "too many requests" is his to see, and the next routine refresh still goes out', async () => {
    await openTab();
    await client.auth.initialize();
    server.passwordTooManyRequests = true;

    expect((await gateway.signIn(TAB_ACCOUNTS['owner-1'].email, TAB_TEST_PASSWORD)).ok).toBe(false);

    expect((await client.auth.refreshSession()).error).toBeNull();
    expect(server.refreshesAsked).toBe(1);
    expect(tabHoldsSignIn(tabStorage)).toBe(true);
  });

  it('guard: a refresh the server REFUSES is still an ended sign-in (review N2): sign-in page, periods removed', async () => {
    await openTab();
    await client.auth.initialize();
    const base = cloud.fetch;
    cloud.fetch = (async (input: unknown, init?: { method?: string; headers?: HeadersInit; body?: unknown }) => {
      const url = new URL(String(typeof input === 'string' ? input : (input as { url: string }).url));
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        return new Response(JSON.stringify({ code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' }), {
          status: 400,
          headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
        });
      }
      return base(input, init);
    }) as TabCloud['fetch'];
    // The tab's client was made over the earlier fetch: a new tab over the refusing one.
    stopListening();
    closeTabClient(client);
    const stored = String(tabStorage.getItem(`dave.web.auth.${TAB_STORAGE_KEY}`));
    await openTab();
    tabStorage.setItem(`dave.web.auth.${TAB_STORAGE_KEY}`, stored);
    await client.auth.initialize();
    hourlyTokenRunsOut();

    expect((await gateway.getSessionStatus()).session).toBeNull();
    await settle();

    expect(heard).toEqual(['SIGNED_OUT']);
    expect(tabHoldsSignIn(tabStorage)).toBe(false);
    expect(periodKeys()).toEqual([]);
  });
});
