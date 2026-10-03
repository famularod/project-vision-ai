/**
 * @jest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { buildDAVEReportSnapshot, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { loadDAVEReportPeriod, reportSenderId, saveDAVEReportSnapshot } from '../../services/DAVEReportSnapshotStore';
import {
  DAVE_WEB_NO_KEYCHAIN,
  daveWebOwnReportSends,
  daveWebReportStorage,
  forgetDAVEWebOwnReportSends,
  forgetDAVEWebReportPeriods,
  loadDAVEWebReportPeriod,
} from '../../services/DAVEWebReportSend';
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { supabaseSecureAuthStorage } from '../../services/SupabaseAuthStorage.web';
import {
  TAB_ACCOUNTS,
  TAB_TEST_PASSWORD,
  closeTabClient,
  createTabClient,
  createTabCloud,
  createTabStorage,
  storeTabSignIn,
  type TabStorage,
} from '../fixtures/browser-tabs';

// Review N1 (2 Oct 2026, caused by 46e3332): "Sign Out of This Computer"
// left the account's report periods (the last sent report and any approval,
// with project, task and owner names) in this browser profile's storage.
// Signing out now removes that account's periods and own-send list from this
// browser. Another account's stay, and so does the profile's sender id.
// The gateway and supabase-js are real; the network is the tab fixture's.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

const root = globalThis as unknown as Record<string, unknown>;
const originalDocument = root.document;
const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWarn = console.warn;

let tabStorage: TabStorage;
let profile: TabStorage;
let client: SupabaseClient;
let gateway: ReturnType<typeof createDAVEWebSupabaseGateway>;

beforeAll(() => {
  root.document = { visibilityState: 'visible', addEventListener: jest.fn(), removeEventListener: jest.fn() };
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
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else delete root.localStorage;
  jest.restoreAllMocks();
});

/** This tab signed in as `userId`, over a browser profile whose storage is `profile`. */
async function openTab(userId: string) {
  tabStorage = createTabStorage();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: tabStorage });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: profile });
  storeTabSignIn(tabStorage, userId);
  client = createTabClient(supabaseSecureAuthStorage, createTabCloud());
  gateway = createDAVEWebSupabaseGateway(client);
  await client.auth.initialize();
}
beforeEach(() => {
  profile = createTabStorage();
  forgetDAVEWebOwnReportSends();
});
afterEach(() => { closeTabClient(client); });

const CLOUD_OFF = { read: async () => null, write: async () => undefined };
/** A sent report with the names a period keeps. */
const sentReport = (sentAt: string) => ({
  ...buildDAVEReportSnapshot({ truths: [], scopeKey: 'tower', sourceFingerprint: 'facts', capturedAt: '2026-10-01T12:00:00.000Z', reportFormat: 'project_manager' }),
  tasks: [{ taskId: 't1', projectName: 'Tower', taskName: 'Frame walls', areaName: 'Level 2', owner: 'Dana', status: 'In Progress', percentComplete: 40, finishDate: null, urgency: 'normal', approvalStatus: null, estimatedScheduleImpactDays: null }],
  deliveredAt: sentAt,
}) as unknown as DAVEReportSnapshot;
const profileText = () => [...profile.values.values()].join('\n');
const keysOf = (ownerId: string) => [...profile.values.keys()].filter(key => key.startsWith(`@vitruvius/web/${ownerId}/`));

describe('review N1 (Low): Sign Out of This Computer removes the account\'s report periods from this browser', () => {
  it('the real sign-out: the account\'s period and own-send list are gone from the profile; the sender id and another account\'s period stay', async () => {
    await openTab('owner-1');
    const storage = daveWebReportStorage(() => gateway.authorizedOwnerId());
    await saveDAVEReportSnapshot(sentReport('2026-10-01T13:00:00.000Z'), storage, CLOUD_OFF);
    const store = { storage, cloud: CLOUD_OFF };
    await loadDAVEWebReportPeriod(store, 'tower', 'project_manager');
    const senderId = await reportSenderId(storage, DAVE_WEB_NO_KEYCHAIN);
    // Another account's period in the same browser profile (kept under its own id).
    const theirs = daveWebReportStorage(async () => 'owner-2');
    await saveDAVEReportSnapshot(sentReport('2026-10-01T09:00:00.000Z'), theirs, CLOUD_OFF);
    expect(keysOf('owner-1').length).toBeGreaterThanOrEqual(2);
    expect(profileText()).toContain('Frame walls');
    expect(daveWebOwnReportSends().has('2026-10-01T13:00:00.000Z')).toBe(true);

    await gateway.signOut('local');

    expect(keysOf('owner-1')).toEqual([]);
    expect(keysOf('owner-2')).toHaveLength(1);
    expect(profile.getItem('@vitruvius/report-sender-id/v1')).toBe(senderId);
    expect(daveWebOwnReportSends().size).toBe(0);
    // What is left holds only the other account's own period.
    expect([...profile.values.keys()].sort()).toEqual(['@vitruvius/report-sender-id/v1', ...keysOf('owner-2')].sort());
    // Signed out, the app reads nothing; the other account's period is as it was.
    await expect(loadDAVEReportPeriod('tower', 'project_manager', storage, CLOUD_OFF)).rejects.toThrow();
    await expect(loadDAVEReportPeriod('tower', 'project_manager', theirs, CLOUD_OFF)).resolves.toMatchObject({ snapshot: { deliveredAt: '2026-10-01T09:00:00.000Z' } });
  });

  it('signing in again: the account starts with no period of its own here, and this browser\'s sender id is the one it had', async () => {
    await openTab('owner-1');
    const storage = daveWebReportStorage(() => gateway.authorizedOwnerId());
    await saveDAVEReportSnapshot(sentReport('2026-10-01T13:00:00.000Z'), storage, CLOUD_OFF);
    const senderId = await reportSenderId(storage, DAVE_WEB_NO_KEYCHAIN);
    await gateway.signOut('local');
    const again = await gateway.signIn(TAB_ACCOUNTS['owner-1'].email, TAB_TEST_PASSWORD);
    expect(again.ok).toBe(true);
    await expect(loadDAVEReportPeriod('tower', 'project_manager', storage, CLOUD_OFF)).resolves.toEqual({ snapshot: null, shared: 'unavailable' });
    await expect(reportSenderId(storage, DAVE_WEB_NO_KEYCHAIN)).resolves.toBe(senderId);
  });

  it('another tab of this browser signing the same account out of this computer: this tab\'s copies go too; another account\'s tab keeps its own', async () => {
    await openTab('owner-1');
    const storage = daveWebReportStorage(() => gateway.authorizedOwnerId());
    await saveDAVEReportSnapshot(sentReport('2026-10-01T13:00:00.000Z'), storage, CLOUD_OFF);
    // Another account's sign-out heard here leaves this tab, and its period, as they are.
    await expect(gateway.signOutThisTabToo('visitor-1')).resolves.toBe('kept');
    expect(keysOf('owner-1')).toHaveLength(1);
    await expect(gateway.signOutThisTabToo('owner-1')).resolves.toBe('ended');
    expect(keysOf('owner-1')).toEqual([]);
  });

  it('a profile storage that cannot list its keys: the ones this tab wrote for the account are removed', () => {
    const values = new Map<string, string>();
    const bare = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const mine = daveWebReportStorage(async () => 'owner-1', bare);
    const theirs = daveWebReportStorage(async () => 'owner-2', bare);
    return Promise.all([mine.setItem('period', 'Frame walls'), theirs.setItem('period', 'Pour slab')]).then(() => {
      forgetDAVEWebReportPeriods('owner-1');
      expect([...values.keys()]).toEqual(['@vitruvius/web/owner-2/period']);
    });
  });

  it('a tab that cannot keep site data: its tab-only copies of the account\'s period go too', async () => {
    const mine = daveWebReportStorage(async () => 'owner-1', null);
    const theirs = daveWebReportStorage(async () => 'owner-2', null);
    await mine.setItem('period', 'Frame walls');
    await theirs.setItem('period', 'Pour slab');
    forgetDAVEWebReportPeriods('owner-1');
    await expect(mine.getItem('period')).resolves.toBeNull();
    await expect(theirs.getItem('period')).resolves.toBe('Pour slab');
    forgetDAVEWebReportPeriods('owner-2');
  });
});
