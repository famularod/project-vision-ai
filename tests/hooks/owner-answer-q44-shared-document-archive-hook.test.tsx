/**
 * Owner answer Q44 (6 Oct 2026): the hook that keeps a device in step with
 * the cloud's archived mark and sends its own Archive and Restore. The real
 * hook and the real service, against a stand-in for the cloud's table: when
 * the cloud is asked, what waits with no signal and when it is tried again,
 * what happens to this device's own card when another device restores, and
 * that nothing is asked of the cloud for another account.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { useSharedDocumentArchive } from '../../hooks/use-shared-document-archive';
import { sharedDocumentArchiveSettled } from '../../services/SharedDocumentArchive';
import { createSharedDocumentCloud, type SharedDocumentCloud } from '../fixtures/shared-document-cloud';

const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
  },
}));

type Listener = ((client: unknown, ownerId: string) => Promise<unknown>) | null;
const mockCloudService: { client: unknown; sessionOwnerId: string | null; listener: Listener } = { client: null, sessionOwnerId: 'owner-a', listener: null };
jest.mock('../../services/SupabaseService', () => ({
  getSupabaseClient: jest.fn(() => mockCloudService.client),
  getCurrentSessionUser: jest.fn(async () => (mockCloudService.sessionOwnerId
    ? { ok: true, data: { id: mockCloudService.sessionOwnerId } } : { ok: false, data: null })),
  setReferenceDocumentsListedListener: jest.fn((listener: Listener) => { mockCloudService.listener = listener; }),
}));

const PERMIT = 'doc-permit';
const AT = '2026-10-06T18:00:00.000Z';
let cloud: SharedDocumentCloud;
let owner = 'owner-0';
let accounts = 0;
let becameActive: () => void;
const restoreCards = jest.fn();
const logged: string[] = [];
const originalError = console.error;

beforeAll(() => { console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); }; });
afterAll(() => {
  console.error = originalError;
  const phrases = ['not wrapped in act(', 'Cannot log after tests are done', 'torn down', 'unhandled promise rejection'];
  expect(logged.filter(line => phrases.some(phrase => line.toLowerCase().includes(phrase.toLowerCase())))).toEqual([]);
});
beforeEach(() => {
  mockStorage.clear();
  restoreCards.mockClear();
  accounts += 1;
  owner = `owner-${accounts}`;
  cloud = createSharedDocumentCloud({ installed: true });
  cloud.state.signedInOwnerId = owner;
  cloud.add(PERMIT, owner);
  cloud.paste();
  mockCloudService.client = cloud.client;
  mockCloudService.sessionOwnerId = owner;
  mockCloudService.listener = null;
  becameActive = () => undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (state: string) => void) => {
    becameActive = () => handler('active');
    return { remove: () => { becameActive = () => undefined; } };
  }) as never);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

/**
 * The app's workspace opened on a device for this test's account. The service
 * keeps one copy per account for as long as the app runs, so every test has
 * an account of its own (what is kept through a relaunch is tested with the
 * service).
 */
function start(ownerId = owner, cardsLoaded = true) {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(NativeWorkspaceOwnerContext.Provider, { value: ownerId }, children);
  const rendered = renderHook((props: { cardsLoaded: boolean }) => useSharedDocumentArchive({ cardsLoaded: props.cardsLoaded, restoreCards }), { wrapper, initialProps: { cardsLoaded } });
  /** Everything the device has begun (reading its storage, asking the cloud, saving) is done. */
  const quiet = async () => { for (let pass = 0; pass < 4; pass += 1) await act(async () => { await sharedDocumentArchiveSettled(); await Promise.resolve(); }); };
  return { ...rendered, quiet };
}
const hidden = (device: ReturnType<typeof start>) => [...device.result.current.archivedIds].sort();

describe('the archived mark on a device (owner answer Q44)', () => {
  it('asks the cloud when the app opens: a document archived on another device is hidden here', async () => {
    cloud.row(PERMIT)!.archived_at = AT;
    const device = start();
    await waitFor(() => expect(hidden(device)).toEqual([PERMIT]));
    expect(device.result.current.installed).toBe(true);
    await device.quiet();
    device.unmount();
  });

  it('before the database change: "not installed", nothing hidden, nothing tried again', async () => {
    cloud.state.installed = false;
    jest.useFakeTimers();
    const device = start();
    await device.quiet();
    expect(device.result.current.installed).toBe(false);
    act(() => { device.result.current.archive(PERMIT); });
    await device.quiet();
    expect(hidden(device)).toEqual([PERMIT]); // hidden on this device, as archiving always was
    // Nothing is tried again on a timer: the cloud is not asked while the app just sits open.
    const asked = cloud.requests.length;
    await act(async () => { jest.advanceTimersByTime(10 * 60_000); });
    await device.quiet();
    expect(cloud.requests.length).toBe(asked);
    expect(cloud.requests.filter(request => request.kind === 'write_mark')).toEqual([]);
    expect(device.result.current.question('Grading permit.pdf', 'Permit Card'))
      .toBe('Grading permit.pdf is categorized as Permit Card. It will be hidden from active project documents.');
    device.unmount();
  });

  it('Archive: hidden here at once, and the cloud is told', async () => {
    const device = start();
    await device.quiet();
    act(() => { device.result.current.archive(PERMIT); });
    await waitFor(() => expect(cloud.row(PERMIT)?.archived_at).toEqual(expect.any(String)));
    expect(hidden(device)).toEqual([PERMIT]);
    await device.quiet();
    expect(device.result.current.waitingIds.size).toBe(0);
    expect(device.result.current.question('Grading permit.pdf', 'Permit Card')).toContain('hidden on all your devices and kept in the cloud');
    device.unmount();
  });

  it('with no signal the mark waits, is tried again half a minute later, and stops being tried once it has arrived', async () => {
    jest.useFakeTimers();
    const device = start();
    await device.quiet();
    cloud.state.offline = true;
    act(() => { device.result.current.archive(PERMIT); });
    await device.quiet();
    expect([...device.result.current.waitingIds]).toEqual([PERMIT]);
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();

    cloud.state.offline = false;
    await act(async () => { jest.advanceTimersByTime(29_000); });
    await device.quiet();
    expect(cloud.row(PERMIT)?.archived_at).toBeNull(); // not yet
    await act(async () => { jest.advanceTimersByTime(1_000); });
    await device.quiet();
    expect(cloud.row(PERMIT)?.archived_at).toEqual(expect.any(String));
    expect(device.result.current.waitingIds.size).toBe(0);
    const asked = cloud.requests.length;
    await act(async () => { jest.advanceTimersByTime(10 * 60_000); });
    await device.quiet();
    expect(cloud.requests.length).toBe(asked);
    device.unmount();
  });

  it('every time the document list is read from the cloud, and when the app comes back to the front, the mark is read too', async () => {
    const device = start();
    await device.quiet();
    expect(hidden(device)).toEqual([]);
    cloud.row(PERMIT)!.archived_at = AT; // archived on another device meanwhile
    expect(mockCloudService.listener).toEqual(expect.any(Function));
    await act(async () => { await mockCloudService.listener!(cloud.client, owner); });
    expect(hidden(device)).toEqual([PERMIT]);

    cloud.row(PERMIT)!.archived_at = null; // and restored there
    await act(async () => { becameActive(); });
    await device.quiet();
    expect(hidden(device)).toEqual([]);
    device.unmount();
  });

  it('a live change from the cloud hides the document without asking again', async () => {
    const device = start();
    await device.quiet();
    const asked = cloud.requests.length;
    await act(async () => {
      device.result.current.noteLiveChange('reference_document', { eventType: 'UPDATE', newRow: { id: PERMIT, owner_id: owner, archived_at: AT }, oldRow: null, raw: null });
      device.result.current.noteLiveChange('schedule_item', { eventType: 'UPDATE', newRow: { id: 'task-1', archived_at: AT }, oldRow: null, raw: null });
    });
    await device.quiet();
    expect(hidden(device)).toEqual([PERMIT]);
    expect(cloud.requests.length).toBe(asked);
    device.unmount();
  });

  it('restored on another device: this device\'s own card is put back, once its cards are loaded, and only once', async () => {
    cloud.row(PERMIT)!.archived_at = AT;
    const device = start(owner, false);
    await waitFor(() => expect(hidden(device)).toEqual([PERMIT]));
    cloud.row(PERMIT)!.archived_at = null;
    await act(async () => { await mockCloudService.listener!(cloud.client, owner); });
    await device.quiet();
    expect(hidden(device)).toEqual([]);
    expect(restoreCards).not.toHaveBeenCalled(); // the cards are not loaded yet: nothing to put back into
    device.rerender({ cardsLoaded: true });
    await device.quiet();
    expect(restoreCards.mock.calls).toEqual([[[PERMIT]]]);
    await act(async () => { await mockCloudService.listener!(cloud.client, owner); });
    await device.quiet();
    expect(restoreCards).toHaveBeenCalledTimes(1);
    device.unmount();
  });

  it('Restore from "Archived": the card comes back here at once and the cloud\'s mark is emptied', async () => {
    cloud.row(PERMIT)!.archived_at = AT;
    const device = start();
    await waitFor(() => expect(hidden(device)).toEqual([PERMIT]));
    act(() => { device.result.current.restore({ key: 'attachment:card-1', name: 'Grading permit.pdf', category: 'Permit Card', cardId: 'card-1', sharedDocumentId: PERMIT, scope: 'everywhere' }); });
    expect(restoreCards.mock.calls).toEqual([[['card-1', PERMIT]]]);
    await waitFor(() => expect(cloud.row(PERMIT)?.archived_at).toBeNull());
    await device.quiet();
    expect(hidden(device)).toEqual([]);
    expect(restoreCards).toHaveBeenCalledTimes(1); // its own restore is not reported back as "restored elsewhere"
    device.unmount();
  });

  it('asks the cloud nothing when cloud sync is not set up, or when the sign-in is another account\'s', async () => {
    cloud.row(PERMIT)!.archived_at = AT;
    mockCloudService.client = null;
    const notSetUp = start();
    await notSetUp.quiet();
    notSetUp.unmount();
    mockCloudService.client = cloud.client;
    mockCloudService.sessionOwnerId = 'someone-else';
    cloud.state.signedInOwnerId = 'someone-else';
    const otherAccount = start(owner);
    await otherAccount.quiet();
    expect(hidden(otherAccount)).toEqual([]);
    // A list read for the other account says nothing about this one either.
    await act(async () => { await mockCloudService.listener!(cloud.client, 'someone-else'); });
    expect(cloud.requests).toEqual([]);
    otherAccount.unmount();
  });

  it('when the app closes its workspace nothing is left listening or waiting on a timer', async () => {
    jest.useFakeTimers();
    const device = start();
    await device.quiet();
    cloud.state.offline = true;
    act(() => { device.result.current.archive(PERMIT); });
    await device.quiet();
    device.unmount();
    expect(mockCloudService.listener).toBeNull();
    // Signal comes back after the workspace is closed: the closed workspace sends nothing.
    cloud.state.offline = false;
    const asked = cloud.requests.length;
    await act(async () => { jest.advanceTimersByTime(10 * 60_000); });
    await act(async () => { await sharedDocumentArchiveSettled(); });
    expect(cloud.requests.length).toBe(asked);
    expect(cloud.row(PERMIT)?.archived_at).toBeNull();
  });
});
