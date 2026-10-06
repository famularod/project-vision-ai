/**
 * @jest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { daveWebReportStorage, forgetDAVEWebOwnReportSends, forgetDAVEWebReportTabMemory } from '../../services/DAVEWebReportSend';
import { DAVE_WEB_OWNER_CHECK_ASKS, createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { supabaseSecureAuthStorage } from '../../services/SupabaseAuthStorage.web';
import {
  TAB_ACCOUNTS,
  TAB_TEST_PASSWORD,
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

// Review pass 4, L2 (5 Oct 2026; already in Build 229, the report-period
// consequence new this round).
//
// An owner check still on its way when he clicked Sign Out of This Computer
// answered afterwards and put "the owner is signed in" back into the gateway
// for five minutes: the gateway said who was signed in without asking, a
// report period could be written under his id in the browser his sign-out
// had just cleared, and a visitor signing in on the tab in that moment was
// taken for the owner. The sign-out cleared only what was kept at that
// moment, not an answer still to come.
//
// Now an answer to an owner check that was sent before a sign-out, a
// sign-in change or a server-ended sign-in is thrown away when it arrives:
// nothing is kept from it, and the caller that waited is not given it. The
// check is asked again for the sign-in the tab holds now, so his own token
// refresh, or another account's tab (owner answer Q26), costs him nothing.
// The gateway and supabase-js are real; the network is the tab fixture's,
// which here can also hold the owner check's answer and end a sign-in.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.setTimeout(30_000);

const root = globalThis as unknown as Record<string, unknown>;
const originalDocument = root.document;
const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWarn = console.warn;
const originalError = console.error;

type Held = { reached: Promise<void>; release: () => void };
type Server = {
  /** The owner checks that reached the cloud. */
  ownerChecks: number;
  /** Another device's "Sign Out of All Devices": the refresh is refused, and the session is gone. */
  signedOutOfAllDevices: boolean;
  /** The next owner check's answer waits (it was decided by the token the request carried). */
  holdOwnerCheck: () => Held;
};
let server: Server;
let cloud: TabCloud;
let tabStorage: TabStorage;
let profile: TabStorage;
let client: SupabaseClient;
let others: SupabaseClient[] = [];
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
  // auth-js logs each refused request before answering it as an error.
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const text = String(args[0]);
    if (text.includes('Invalid Refresh Token') || text.includes('AuthApiError')) return;
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
  let waiting: { arrived: () => void; gate: Promise<void> } | null = null;
  server = {
    ownerChecks: 0,
    signedOutOfAllDevices: false,
    holdOwnerCheck: () => {
      let arrived: () => void = () => undefined;
      let release: () => void = () => undefined;
      const reached = new Promise<void>(resolve => { arrived = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      waiting = { arrived, gate };
      return { reached, release };
    },
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
  });
  const fetch = async (input: unknown, init?: { method?: string; headers?: HeadersInit; body?: unknown }) => {
    const url = new URL(String(typeof input === 'string' ? input : (input as { url: string }).url));
    if (url.pathname === '/rest/v1/rpc/dave_is_app_owner') {
      server.ownerChecks += 1;
      // Answered for the token the request carried: it was valid when it was sent.
      const answer = await base.fetch(input, init);
      if (waiting) {
        const mine = waiting;
        waiting = null;
        mine.arrived();
        await mine.gate;
      }
      return answer;
    }
    if (server.signedOutOfAllDevices && url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      await base.fetch(input, init);
      return json(400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' });
    }
    if (server.signedOutOfAllDevices && url.pathname === '/auth/v1/user') {
      return json(403, { code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' });
    }
    return base.fetch(input, init);
  };
  return { ...base, fetch };
}

const settle = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));

/** This tab, signed in as `userId`, its page listening. */
async function openTab(userId: string | null) {
  tabStorage = createTabStorage();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: tabStorage });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
  if (userId) storeTabSignIn(tabStorage, userId);
  client = createTabClient(supabaseSecureAuthStorage, cloud);
  gateway = createDAVEWebSupabaseGateway(client);
  await client.auth.initialize();
  heard = [];
  stopListening = gateway.subscribeToAuthStateChange(event => { if (event !== 'INITIAL_SESSION') heard.push(event); });
  await settle();
}

/** Another tab of this browser, signed in as `userId` (or not signed in). */
async function openAnotherTab(userId: string | null): Promise<SupabaseClient> {
  const storage = createTabStorage();
  if (userId) storeTabSignIn(storage, userId);
  const tab = createTabClient(tabAuthStorage(storage), cloud);
  others.push(tab);
  await tab.auth.initialize();
  return tab;
}

/** An owner check goes out for a call that needs the owner (the 30-second refresh, a live update), and its answer is held. */
async function ownerCheckOnItsWay(): Promise<{ held: Held; waiting: Promise<string> }> {
  const held = server.holdOwnerCheck();
  const waiting = gateway.authorizedOwnerId();
  // Not unhandled while the test goes on.
  waiting.catch(() => undefined);
  await held.reached;
  return { held, waiting };
}

const PERIOD_KEY = '@vitruvius/report-snapshots/v1/probe';
const periodKeys = () => [...profile.values.keys()].filter(key => key.startsWith('@vitruvius/web/'));
const answerOf = (asked: Promise<string>) => asked.then(id => `answered ${id}`, error => `refused: ${(error as Error).name}: ${(error as Error).message}`);
const SIGN_IN_REQUIRED = 'refused: DAVEWebAuthorizationError: Sign in is required for the Vitruvius desktop pilot.';
const NOT_THE_OWNER = 'refused: DAVEWebAuthorizationError: This account is not authorized for the Vitruvius desktop pilot.';
const COULD_NOT_COMPLETE = 'refused: Error: The owner check could not be completed. Try again shortly.';

beforeEach(() => {
  profile = createTabStorage();
  cloud = createServer();
  others = [];
  forgetDAVEWebReportTabMemory();
  forgetDAVEWebOwnReportSends();
});
afterEach(async () => {
  stopListening();
  closeTabClient(client);
  others.forEach(closeTabClient);
  await settle();
});

describe('an owner check still on its way when he clicks Sign Out of This Computer', () => {
  it('its answer is thrown away: the call that waited for it is refused, and so is every call after', async () => {
    await openTab('owner-1');
    const { held, waiting } = await ownerCheckOnItsWay();

    await gateway.signOut('local');
    expect(tabHoldsSignIn(tabStorage)).toBe(false);
    expect(heard).toContain('SIGNED_OUT');
    held.release();

    expect(await answerOf(waiting)).toBe(SIGN_IN_REQUIRED);
    expect(await answerOf(gateway.authorizedOwnerId())).toBe(SIGN_IN_REQUIRED);
    expect(await answerOf(gateway.loadAuthorizedRows().then(() => 'rows'))).toBe(SIGN_IN_REQUIRED);
    // No request with a sign-in went out after the sign-out.
    expect(cloud.calls.filter(call => call.path.startsWith('/rest/v1/') && !call.path.includes('rpc')).length).toBe(0);
  });

  it('a report period is not written under his id after the sign-out: neither by a write made after it, nor by one that was waiting for the check', async () => {
    await openTab('owner-1');
    const storage = daveWebReportStorage(() => gateway.authorizedOwnerId());
    const { held } = await ownerCheckOnItsWay();
    // A report approval still running: its period waits for the same owner check.
    const waitingWrite = storage.setItem(PERIOD_KEY, JSON.stringify({ projectName: 'Canopy Project', tasks: [] }))
      .then(() => 'written', error => `not written: ${(error as Error).name}`);

    await gateway.signOut('local');
    held.release();

    expect(await waitingWrite).toBe('not written: DAVEWebAuthorizationError');
    const later = await storage.setItem(PERIOD_KEY, JSON.stringify({ projectName: 'Canopy Project', tasks: [] }))
      .then(() => 'written', error => `not written: ${(error as Error).name}`);
    expect(later).toBe('not written: DAVEWebAuthorizationError');
    expect(periodKeys()).toEqual([]);
  });

  it('every caller that waited on that check is refused', async () => {
    await openTab('owner-1');
    const { held, waiting } = await ownerCheckOnItsWay();
    const second = gateway.authorizedOwnerId();
    second.catch(() => undefined);

    await gateway.signOut('local');
    held.release();

    expect(await answerOf(waiting)).toBe(SIGN_IN_REQUIRED);
    expect(await answerOf(second)).toBe(SIGN_IN_REQUIRED);
  });

  it('a visitor signs in on this tab before the answer lands: the gateway asks about the visitor, and refuses him', async () => {
    await openTab('owner-1');
    const { held, waiting } = await ownerCheckOnItsWay();
    await gateway.signOut('local');
    const signedIn = await gateway.signIn(TAB_ACCOUNTS['visitor-1'].email, TAB_TEST_PASSWORD);
    expect(signedIn.ok).toBe(true);

    held.release();

    expect(await answerOf(waiting)).toBe(NOT_THE_OWNER);
    const checksBefore = server.ownerChecks;
    expect(await answerOf(gateway.authorizedOwnerId())).toBe(NOT_THE_OWNER);
    // Asked, not answered from what the owner's check had left.
    expect(server.ownerChecks).toBe(checksBefore + 1);
    expect(cloud.calls.filter(call => call.path === '/rest/v1/rpc/dave_is_app_owner').pop()?.userId).toBe('visitor-1');
    expect(await answerOf(gateway.loadAuthorizedRows().then(() => 'rows'))).toBe(NOT_THE_OWNER);
  });
});

describe('an owner check still on its way when the server ends this tab’s sign-in (Sign Out of All Devices on the phone)', () => {
  it('its answer is thrown away, and the gateway refuses from then on', async () => {
    await openTab('owner-1');
    const { held, waiting } = await ownerCheckOnItsWay();

    // His hourly token runs out meanwhile, and the refresh that follows is refused
    // (auth-js keeps a sign-in whose token still works when a refresh is refused).
    storeTabSignIn(tabStorage, 'owner-1', { expired: true });
    server.signedOutOfAllDevices = true;
    await client.auth.refreshSession();
    expect(heard).toContain('SIGNED_OUT');
    expect(tabHoldsSignIn(tabStorage)).toBe(false);
    held.release();

    expect(await answerOf(waiting)).toBe(SIGN_IN_REQUIRED);
    expect(await answerOf(gateway.authorizedOwnerId())).toBe(SIGN_IN_REQUIRED);
    const storage = daveWebReportStorage(() => gateway.authorizedOwnerId());
    await storage.setItem(PERIOD_KEY, '{"a":1}').catch(() => undefined);
    expect(periodKeys()).toEqual([]);
  });
});

describe('an owner check still on its way when nothing about his sign-in ends', () => {
  it('his own token refresh: the check is asked again for the sign-in he holds now, the waiting call is answered, and the answer is kept as before', async () => {
    await openTab('owner-1');
    const { held, waiting } = await ownerCheckOnItsWay();

    await client.auth.refreshSession();
    expect(heard).toContain('TOKEN_REFRESHED');
    held.release();

    expect(await answerOf(waiting)).toBe('answered owner-1');
    expect(server.ownerChecks).toBe(2);
    // Kept: the next calls do not ask again.
    expect(await answerOf(gateway.authorizedOwnerId())).toBe('answered owner-1');
    expect(await answerOf(gateway.loadAuthorizedRows().then(() => 'rows'))).toBe('answered rows');
    expect(server.ownerChecks).toBe(2);
    expect(tabHoldsSignIn(tabStorage)).toBe(true);
  });

  it('another account’s tab signs in, refreshes and signs out meanwhile: this tab’s call is still answered for his own sign-in (owner answer Q26)', async () => {
    await openTab('owner-1');
    const visitor = await openAnotherTab(null);
    const { held, waiting } = await ownerCheckOnItsWay();

    await visitor.auth.signInWithPassword({ email: TAB_ACCOUNTS['visitor-1'].email, password: TAB_TEST_PASSWORD });
    await visitor.auth.refreshSession();
    await visitor.auth.signOut({ scope: 'local' });
    await settle();
    // This tab was told of them (auth-js tells every tab of the browser), and its sign-in is its own still.
    expect(heard.length).toBeGreaterThan(0);
    held.release();

    expect(await answerOf(waiting)).toBe('answered owner-1');
    // Asked again, since the answer had been overtaken.
    expect(server.ownerChecks).toBe(2);
    expect(tabHoldsSignIn(tabStorage)).toBe(true);
    // Every owner check this tab sent carried his own token.
    expect([...new Set(cloud.calls.filter(call => call.path === '/rest/v1/rpc/dave_is_app_owner').map(call => call.userId))]).toEqual(['owner-1']);
    const checks = server.ownerChecks;
    expect(await answerOf(gateway.authorizedOwnerId())).toBe('answered owner-1');
    expect(server.ownerChecks).toBe(checks);
  });

  it('with no check on its way nothing changes: one check, kept for the calls after it, and refused after a sign-out', async () => {
    await openTab('owner-1');

    expect(await answerOf(gateway.authorizedOwnerId())).toBe('answered owner-1');
    expect(await answerOf(gateway.authorizedOwnerId())).toBe('answered owner-1');
    expect(server.ownerChecks).toBe(1);

    await gateway.signOut('local');
    expect(await answerOf(gateway.authorizedOwnerId())).toBe(SIGN_IN_REQUIRED);
    expect(server.ownerChecks).toBe(1);
  });
});

describe('answers that keep being overtaken', () => {
  /** His token is refreshed while each of the next `times` owner checks is on its way. */
  async function overtake(times: number, first: Held) {
    let held = first;
    for (let overtaken = 1; overtaken <= times; overtaken += 1) {
      await held.reached;
      await client.auth.refreshSession();
      const next = overtaken < times ? server.holdOwnerCheck() : null;
      held.release();
      if (next) held = next;
    }
  }

  it(`one check is asked ${DAVE_WEB_OWNER_CHECK_ASKS} times at most, then says it could not be completed; the next call asks afresh`, async () => {
    await openTab('owner-1');
    const first = server.holdOwnerCheck();
    const waiting = gateway.authorizedOwnerId();
    waiting.catch(() => undefined);

    await overtake(DAVE_WEB_OWNER_CHECK_ASKS, first);

    expect(await answerOf(waiting)).toBe(COULD_NOT_COMPLETE);
    expect(server.ownerChecks).toBe(DAVE_WEB_OWNER_CHECK_ASKS);
    // Nothing was kept from any of them, and nothing stops the next call.
    expect(await answerOf(gateway.authorizedOwnerId())).toBe('answered owner-1');
    expect(server.ownerChecks).toBe(DAVE_WEB_OWNER_CHECK_ASKS + 1);
  });

  it('overtaken one time fewer, the last ask answers him', async () => {
    await openTab('owner-1');
    const first = server.holdOwnerCheck();
    const waiting = gateway.authorizedOwnerId();
    waiting.catch(() => undefined);

    await overtake(DAVE_WEB_OWNER_CHECK_ASKS - 1, first);

    expect(await answerOf(waiting)).toBe('answered owner-1');
    expect(server.ownerChecks).toBe(DAVE_WEB_OWNER_CHECK_ASKS);
  });
});
