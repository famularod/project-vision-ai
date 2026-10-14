/**
 * Open item 4.62 (13 Oct 2026, seen once on the computer): after two hours
 * with the Vitruvius tabs in the background in Chrome, both showed
 * "Automatic cloud refresh is waiting. Your current workspace remains
 * available." and "Stale", the last cloud update 15 minutes old. A reload
 * cleared it at once.
 *
 * What kept it waiting, by reading (components/web-shell/desktop-auth-provider.tsx
 * on c275e666): once a workspace is open, an automatic refresh that does not
 * finish is never tried again on a timer. Coming back to the tab tries once,
 * and only when the live connection is down or the last good update is five
 * minutes old; if that one try fails too (the Wi-Fi still reconnecting as the
 * computer wakes, say), the line stays until the live connection comes back
 * or the 30-minute check. And a refresh that never answers holds every later
 * refresh of the tab, its owner check included, until the page is reloaded.
 *
 * Now: a refresh that did not finish is tried again after 5 s, 15 s, 30 s,
 * then every minute while the tab is in view; a hidden tab waits and tries as
 * soon as it is looked at again; a refresh, or an owner check, that has not
 * answered in a minute no longer holds the next one. Nothing signs out.
 */
import { act, render } from '@testing-library/react-native';
import { Text, View } from 'react-native';

import {
  DESKTOP_AUTOMATIC_REFRESH_LIMIT_MS,
  DesktopAuthProvider,
  useDesktopAuth,
} from '../../components/web-shell/desktop-auth-provider';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { presentDAVEWebFreshness } from '../../services/DAVEWebFreshness';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../../services/DAVEWebReadOnlyRepository', () => ({
  loadDAVEWebReadOnlySnapshot: jest.fn(),
}));
jest.mock('../../services/DAVEWebSupabaseClient', () => {
  const actual = jest.requireActual('../../services/DAVEWebSupabaseClient');
  return {
    ...actual,
    daveWebSupabaseGateway: {
      getSessionStatus: jest.fn(),
      subscribeToAuthStateChange: jest.fn(),
      subscribeToAuthorizedOperationalChanges: jest.fn(),
      runAuthorizedMaintenance: jest.fn(),
      signOut: jest.fn(),
      storedSignInUserId: jest.fn(() => 'owner-1'),
    },
  };
});

const WAITING = 'Automatic cloud refresh is waiting. Your current workspace remains available.';
const mockedLoadSnapshot = jest.mocked(loadDAVEWebReadOnlySnapshot);
const mockedGateway = jest.mocked(daveWebSupabaseGateway);

/** A snapshot read now, named so the test can tell which read is on screen. */
const snapshotNamed = (name: string) => ({
  projects: [],
  scheduleItems: [],
  projectUpdates: [],
  referenceDocuments: [],
  syncTombstones: [],
  refreshedAt: new Date().toISOString(),
  name,
}) as never;

/** A minimal browser document whose visibility the test controls. */
const page = {
  visibilityState: 'visible' as 'visible' | 'hidden',
  listeners: new Set<() => void>(),
  show(state: 'visible' | 'hidden') {
    this.visibilityState = state;
    this.listeners.forEach(listener => listener());
  },
};
const root = globalThis as unknown as { window?: Record<string, unknown>; document?: unknown };
const originalDocument = root.document;
const originalBroadcastChannel = globalThis.BroadcastChannel;
let realtime: {
  onChange: (entity: string, collections?: readonly string[]) => void;
  onStatus: (status: 'subscribed' | 'error' | 'closed') => void;
} | null = null;

beforeAll(() => {
  root.window = root.window ?? {};
  root.window.addEventListener = jest.fn();
  root.window.removeEventListener = jest.fn();
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
});
afterAll(() => {
  root.document = originalDocument;
  globalThis.BroadcastChannel = originalBroadcastChannel;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  realtime = null;
  page.visibilityState = 'visible';
  page.listeners.clear();
  root.document = {
    get visibilityState() { return page.visibilityState; },
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'visibilitychange') page.listeners.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === 'visibilitychange') page.listeners.delete(listener);
    },
  };
  mockedGateway.getSessionStatus.mockResolvedValue({
    configured: true,
    session: { user: { id: 'owner-1', email: 'owner@example.com' }, expires_at: 1_900_000_000 } as never,
  });
  mockedGateway.subscribeToAuthStateChange.mockReturnValue(() => undefined);
  mockedGateway.subscribeToAuthorizedOperationalChanges.mockImplementation(async callbacks => {
    realtime = callbacks as never;
    return () => undefined;
  });
  mockedGateway.runAuthorizedMaintenance.mockResolvedValue(undefined);
  mockedLoadSnapshot.mockImplementation(async () => snapshotNamed('first'));
});

afterEach(() => {
  jest.useRealTimers();
});

function Harness() {
  const auth = useDesktopAuth();
  return (
    <View>
      <Text testID="phase">{auth.phase}</Text>
      <Text testID="message">{auth.message || 'none'}</Text>
      <Text testID="badge">{presentDAVEWebFreshness(auth.freshness).badge}</Text>
      <Text testID="read">{(auth.snapshot as unknown as { name?: string } | null)?.name ?? 'none'}</Text>
    </View>
  );
}

const text = (screen: ReturnType<typeof render>, id: string) => screen.getByTestId(id).props.children;
const settle = () => act(async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
});
const wait = async (ms: number) => {
  await act(async () => { jest.advanceTimersByTime(ms); });
  await settle();
};
const show = async (state: 'visible' | 'hidden') => {
  await act(async () => { page.show(state); });
  await settle();
};

async function openWorkspace() {
  const screen = render(<DesktopAuthProvider><Harness /></DesktopAuthProvider>);
  await settle();
  expect(text(screen, 'phase')).toBe('ready');
  expect(text(screen, 'badge')).toBe('Connected');
  expect(realtime).not.toBeNull();
  await act(async () => { realtime!.onStatus('subscribed'); });
  await settle();
  expect(mockedLoadSnapshot).toHaveBeenCalledTimes(1);
  return screen;
}

describe('4.62: an open workspace catches up by itself after a refresh that did not finish', () => {
  it('as reported: two hours in the background, the first try on coming back fails, the next one 5 s later clears "Stale"', async () => {
    const screen = await openWorkspace();

    // The tab goes to the background; the live connection drops during the two hours.
    await show('hidden');
    await wait(15 * 60_000);
    await act(async () => { realtime!.onStatus('error'); });
    await settle();
    expect(text(screen, 'message')).toBe(WAITING);
    expect(text(screen, 'badge')).toBe('Stale');
    await wait(2 * 60 * 60_000);
    // Nothing is read while nobody is looking.
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(1);

    // He comes back. The first read fails (the Wi-Fi is still reconnecting); the second one works.
    mockedLoadSnapshot
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(async () => snapshotNamed('after the break'));
    await show('visible');
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(2);
    expect(text(screen, 'message')).toBe(WAITING);
    expect(text(screen, 'badge')).toBe('Stale');

    await wait(4_999);
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(2);
    await wait(1);
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(3);
    expect(text(screen, 'message')).toBe('none');
    expect(text(screen, 'badge')).toBe('Connected');
    expect(text(screen, 'read')).toBe('after the break');
    expect(text(screen, 'phase')).toBe('ready');
    expect(mockedGateway.signOut).not.toHaveBeenCalled();

    // Caught up: no more extra reads.
    await wait(10 * 60_000);
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(3);
    screen.unmount();
  });

  it('tries again after 5 s, 15 s, 30 s, then every minute while in view; stops once one works', async () => {
    const screen = await openWorkspace();
    mockedLoadSnapshot.mockRejectedValue(new Error('The owner check could not be completed. Try again shortly.'));
    await act(async () => { realtime!.onChange('project_update', ['project_updates']); });
    await settle();
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(2);
    expect(text(screen, 'message')).toBe(WAITING);

    await wait(5_000);
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(3);
    await wait(14_999);
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(3);
    await wait(1);
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(4);
    await wait(30_000);
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(5);
    await wait(60_000);
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(6);
    await wait(60_000);
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(7);
    expect(text(screen, 'message')).toBe(WAITING);

    mockedLoadSnapshot.mockImplementation(async () => snapshotNamed('caught up'));
    await wait(60_000);
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(8);
    expect(text(screen, 'message')).toBe('none');
    expect(text(screen, 'badge')).toBe('Connected');
    await wait(5 * 60_000);
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(8);
    expect(mockedGateway.signOut).not.toHaveBeenCalled();
    screen.unmount();
  });

  it('a hidden tab waits, and tries as soon as it is looked at again, even with the live connection up and the last update recent', async () => {
    const screen = await openWorkspace();
    await show('hidden');
    mockedLoadSnapshot.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(async () => { realtime!.onChange('schedule_item', ['schedule_items']); });
    await settle();
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(2);
    expect(text(screen, 'message')).toBe(WAITING);

    // Its retry comes due while nobody is looking: nothing is read.
    await wait(2 * 60_000);
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(2);

    // Two minutes after the last good update, the live connection still up: the waiting line alone is reason to look.
    mockedLoadSnapshot.mockImplementation(async () => snapshotNamed('on return'));
    await show('visible');
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(3);
    expect(text(screen, 'message')).toBe('none');
    expect(text(screen, 'badge')).toBe('Connected');
    expect(text(screen, 'read')).toBe('on return');
    screen.unmount();
  });

  it('a refresh that never answers holds the tab for one minute at most; its late answer does not replace a newer one', async () => {
    const screen = await openWorkspace();
    let answerLate: (value: unknown) => void = () => undefined;
    mockedLoadSnapshot.mockImplementationOnce(() => new Promise(resolve => { answerLate = resolve; }) as never);
    await act(async () => { realtime!.onChange('project_update', ['project_updates']); });
    await settle();
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(2);

    await wait(60_000 - 1);
    expect(text(screen, 'message')).toBe('none');
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(2);

    // At the minute it counts as not done, and is tried afresh.
    mockedLoadSnapshot.mockImplementation(async () => snapshotNamed('fresh'));
    await wait(1);
    expect(text(screen, 'message')).toBe(WAITING);
    expect(text(screen, 'badge')).toBe('Stale');
    await wait(5_000);
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(3);
    expect(text(screen, 'message')).toBe('none');
    expect(text(screen, 'badge')).toBe('Connected');
    expect(text(screen, 'read')).toBe('fresh');

    // The read that hung answers at last, with what it read then: the newer read stays on screen.
    await act(async () => { answerLate(snapshotNamed('late')); });
    await settle();
    expect(text(screen, 'read')).toBe('fresh');
    expect(text(screen, 'message')).toBe('none');
    expect(mockedGateway.signOut).not.toHaveBeenCalled();
    expect(DESKTOP_AUTOMATIC_REFRESH_LIMIT_MS).toBe(60_000);
    screen.unmount();
  });
});

describe('4.62: an owner check that never answers no longer holds every later read', () => {
  const { createDAVEWebSupabaseGateway, DAVE_WEB_OWNER_CHECK_LET_GO_MS } =
    jest.requireActual('../../services/DAVEWebSupabaseClient');

  function cloud() {
    const ownerChecks: Array<() => void> = [];
    const client = {
      auth: {
        getUser: () => new Promise(resolve => {
          ownerChecks.push(() => resolve({ data: { user: { id: 'owner-1' } }, error: null }));
        }),
        getSession: async () => ({ data: { session: { access_token: 'token' } }, error: null }),
      },
      rpc: async () => ({ data: true, error: null, status: 200 }),
    };
    return { ownerChecks, gateway: createDAVEWebSupabaseGateway(client as never) };
  }

  it('after a minute without an answer the next read sends a new check, and is answered by it', async () => {
    const { ownerChecks, gateway } = cloud();
    const first = gateway.authorizedOwnerId();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(ownerChecks).toHaveLength(1);

    const second = gateway.authorizedOwnerId();
    await jest.advanceTimersByTimeAsync(0);
    expect(ownerChecks).toHaveLength(2);
    ownerChecks[1]();
    await expect(second).resolves.toBe('owner-1');

    // The first check answering at last changes nothing.
    ownerChecks[0]();
    await expect(first).resolves.toBe('owner-1');
    expect(DAVE_WEB_OWNER_CHECK_LET_GO_MS).toBe(60_000);
  });

  it('reads inside the minute still share the one check on its way', async () => {
    const { ownerChecks, gateway } = cloud();
    const first = gateway.authorizedOwnerId();
    await jest.advanceTimersByTimeAsync(60_000 - 1);
    const second = gateway.authorizedOwnerId();
    await jest.advanceTimersByTimeAsync(0);
    expect(ownerChecks).toHaveLength(1);
    ownerChecks[0]();
    await expect(Promise.all([first, second])).resolves.toEqual(['owner-1', 'owner-1']);
  });
});
