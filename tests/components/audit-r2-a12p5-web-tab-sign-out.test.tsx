/**
 * Whole-app audit A12 pass 5 L2 and A1 pass 5 (30 Sep 2026). Each browser
 * tab keeps its own sign-in, but auth-js passes every tab's SIGNED_OUT to
 * the others without saying whose it was, and the web page took any
 * SIGNED_OUT as its own:
 * - "Sign Out of This Computer" in one tab dropped the other tabs to the
 *   sign-in page (unsaved typing lost) while their own sign-ins stayed: a
 *   reload showed his projects again, which is not "This Computer";
 * - a NON-OWNER's automatic sign-out in another tab (retried quietly until
 *   it goes through) dropped the owner's working tab to the sign-in page,
 *   although the owner's own sign-in was still there.
 *
 * Now a tab acts on another tab's SIGNED_OUT only through what that tab
 * says it was: Sign Out (This Computer or All Devices) tells the other tabs
 * which account signed out, and every tab of that account in this browser
 * ends its own sign-in too. A SIGNED_OUT while this tab still holds its own
 * sign-in is another tab's, and leaves this tab as it is; a different
 * account's sign-out, or the automatic not-owner sign-out, never ends this
 * tab. A SIGNED_OUT after this tab's own sign-in has gone still shows the
 * sign-in page.
 */
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import {
  DESKTOP_SIGN_OUT_CHANNEL_NAME,
  DesktopAuthProvider,
} from '../../components/web-shell/desktop-auth-provider';
import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import {
  DAVEWebAuthorizationError,
  daveWebSupabaseGateway,
} from '../../services/DAVEWebSupabaseClient';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children }: { children: React.ReactNode }) => (
      React.createElement(View, null, children)
    ),
  };
});
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/settings',
  useRouter: () => ({ setParams: jest.fn() }),
}));
jest.mock('../../services/VitruviusDesktopPreferences', () => ({
  VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY: 'vitruvius.display-name',
  formatVitruviusDesktopGreeting: () => 'Good morning, David',
  readVitruviusDesktopDisplayName: () => 'David',
  writeVitruviusDesktopDisplayName: (value: string) => value.trim(),
}));
jest.mock('../../services/FieldNoteDesktopDataSource', () => ({
  desktopFieldNoteDataSource: {
    list: jest.fn(async () => []),
    save: jest.fn(),
    update: jest.fn(),
  },
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
      signIn: jest.fn(),
      signOut: jest.fn(),
      storedSignInUserId: jest.fn(),
      signOutThisTabToo: jest.fn(),
    },
  };
});

const mockedLoadSnapshot = jest.mocked(loadDAVEWebReadOnlySnapshot);
const mockedGateway = jest.mocked(daveWebSupabaseGateway);
const ownerSession = {
  user: { id: 'owner-1', email: 'owner@example.com' },
  expires_at: 1_900_000_000,
} as unknown as Session;
const snapshot = {
  projects: [],
  scheduleItems: [],
  projectUpdates: [],
  referenceDocuments: [],
  refreshedAt: '2026-09-30T14:00:00.000Z',
};

/** What this tab's own storage holds: the account its sign-in belongs to. */
let storedHere: string | null = 'owner-1';

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void;
let authListener: AuthListener = () => undefined;
const emit = (event: AuthChangeEvent, session: Session | null) =>
  act(async () => { authListener(event, session); });

/** Same-name channels reach each other, never themselves, as in a browser. */
class FakeBroadcastChannel {
  static open: FakeBroadcastChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly sent: unknown[] = [];
  constructor(readonly name: string) {
    FakeBroadcastChannel.open.push(this);
  }
  postMessage(data: unknown) {
    this.sent.push(data);
    FakeBroadcastChannel.open
      .filter(other => other !== this && other.name === this.name)
      .forEach(other => other.onmessage?.({ data }));
  }
  close() {
    FakeBroadcastChannel.open = FakeBroadcastChannel.open.filter(other => other !== this);
  }
}

const root = globalThis as unknown as { window?: Record<string, unknown> };
const originalBroadcastChannel = globalThis.BroadcastChannel;

beforeAll(() => {
  root.window = root.window ?? {};
  root.window.addEventListener = jest.fn();
  root.window.removeEventListener = jest.fn();
  globalThis.BroadcastChannel = FakeBroadcastChannel as never;
});
afterAll(() => {
  globalThis.BroadcastChannel = originalBroadcastChannel;
});

beforeEach(() => {
  jest.clearAllMocks();
  FakeBroadcastChannel.open = [];
  storedHere = 'owner-1';
  mockedGateway.getSessionStatus.mockResolvedValue({ configured: true, session: ownerSession });
  mockedGateway.subscribeToAuthStateChange.mockImplementation(listener => {
    authListener = listener;
    return () => undefined;
  });
  mockedGateway.subscribeToAuthorizedOperationalChanges.mockResolvedValue(() => undefined);
  mockedGateway.runAuthorizedMaintenance.mockResolvedValue(undefined);
  mockedGateway.storedSignInUserId.mockImplementation(() => storedHere);
  // It says what it left in this tab, as the gateway does (A12 pass 10 L1).
  mockedGateway.signOutThisTabToo.mockImplementation(async (userId: string) => {
    if (storedHere !== userId) return storedHere ? 'kept' : 'ended';
    // auth-js removes the stored sign-in, then tells this tab.
    storedHere = null;
    authListener('SIGNED_OUT', null);
    return 'ended';
  });
  mockedGateway.signOut.mockImplementation(async () => {
    storedHere = null;
    authListener('SIGNED_OUT', null);
  });
  mockedLoadSnapshot.mockResolvedValue(snapshot as never);
});

/** Another tab of this browser: its own end of the sign-out channel. */
function anotherTab() {
  return new FakeBroadcastChannel(DESKTOP_SIGN_OUT_CHANNEL_NAME);
}

async function renderWorkingTab() {
  const screen = render(
    <DesktopAuthProvider>
      <DesktopReadOnlyShell page="settings" />
    </DesktopAuthProvider>,
  );
  await waitFor(() => expect(screen.getByText('Account and Sync')).toBeTruthy());
  return screen;
}

function expectStillWorking(screen: ReturnType<typeof render>) {
  expect(screen.getByText('Account and Sync')).toBeTruthy();
  expect(screen.queryByLabelText('Password')).toBeNull();
}

describe('the same account signing out of this computer in another tab (A12 pass 5 L2)', () => {
  test('this tab’s own sign-in ends too, and it shows the sign-in page', async () => {
    const screen = await renderWorkingTab();
    const other = anotherTab();

    // auth-js's SIGNED_OUT from the other tab, then that tab's word on whose.
    await emit('SIGNED_OUT', null);
    await act(async () => {
      other.postMessage({ type: 'signed-out-of-this-computer', userId: 'owner-1' });
    });

    await waitFor(() => expect(screen.getByLabelText('Password')).toBeTruthy());
    expect(mockedGateway.signOutThisTabToo).toHaveBeenCalledWith('owner-1');
    // Really signed out here: a reload finds no sign-in in this tab.
    expect(storedHere).toBeNull();
    expect(screen.queryByText('Account and Sync')).toBeNull();
    // Ending this tab's sign-in tells no other tab anything more.
    expect(FakeBroadcastChannel.open.flatMap(channel => channel.sent)).toEqual([
      { type: 'signed-out-of-this-computer', userId: 'owner-1' },
    ]);
  });

  test('this tab’s own Sign Out of This Computer tells the other tabs which account signed out', async () => {
    const screen = await renderWorkingTab();
    const other = anotherTab();
    const heard: unknown[] = [];
    other.onmessage = event => { heard.push(event.data); };

    fireEvent.press(screen.getByText('Sign out'));
    await act(async () => { fireEvent.press(screen.getByText('Sign Out of This Computer')); });

    await waitFor(() => expect(screen.getByLabelText('Password')).toBeTruthy());
    expect(mockedGateway.signOut).toHaveBeenCalledWith('local');
    expect(heard).toEqual([{ type: 'signed-out-of-this-computer', userId: 'owner-1' }]);
    expect(mockedGateway.signOutThisTabToo).not.toHaveBeenCalled();
  });

  test('Sign Out of All Devices tells them too', async () => {
    const screen = await renderWorkingTab();
    const other = anotherTab();
    const heard: unknown[] = [];
    other.onmessage = event => { heard.push(event.data); };

    fireEvent.press(screen.getByText('Sign out'));
    await act(async () => { fireEvent.press(screen.getByText('Sign Out of All Devices')); });

    await waitFor(() => expect(screen.getByLabelText('Password')).toBeTruthy());
    expect(mockedGateway.signOut).toHaveBeenCalledWith('global');
    expect(heard).toEqual([{ type: 'signed-out-of-this-computer', userId: 'owner-1' }]);
  });

  test('a sign-out that did not finish tells no other tab', async () => {
    mockedGateway.signOut.mockRejectedValueOnce(new Error('The desktop session could not be closed.'));
    const screen = await renderWorkingTab();
    const other = anotherTab();
    const heard: unknown[] = [];
    other.onmessage = event => { heard.push(event.data); };

    fireEvent.press(screen.getByText('Sign out'));
    await act(async () => { fireEvent.press(screen.getByText('Sign Out of This Computer')); });

    await waitFor(() => expect(screen.getByText(
      'Sign out did not finish. Check the internet connection and try again.',
    )).toBeTruthy());
    expect(heard).toEqual([]);
  });
});

describe('another account or a not-owner signing out in another tab (A1 pass 5)', () => {
  test('a not-owner’s automatic sign-out in another tab leaves the owner’s tab working', async () => {
    const screen = await renderWorkingTab();

    // The other tab's quiet sign-out went through: auth-js tells every tab.
    await emit('SIGNED_OUT', null);

    expectStillWorking(screen);
    expect(mockedGateway.signOutThisTabToo).not.toHaveBeenCalled();
    expect(mockedGateway.signOut).not.toHaveBeenCalled();
    expect(storedHere).toBe('owner-1');
  });

  test('a different account’s Sign Out in another tab leaves this tab working', async () => {
    const screen = await renderWorkingTab();
    const other = anotherTab();

    await emit('SIGNED_OUT', null);
    await act(async () => {
      other.postMessage({ type: 'signed-out-of-this-computer', userId: 'visitor-1' });
    });

    expectStillWorking(screen);
    expect(mockedGateway.signOutThisTabToo).not.toHaveBeenCalled();
    expect(storedHere).toBe('owner-1');
  });

  test('a message that does not say whose sign-out it was is ignored', async () => {
    const screen = await renderWorkingTab();
    const other = anotherTab();
    await act(async () => {
      other.postMessage({ type: 'signed-out-of-this-computer' });
      other.postMessage('signed-out');
      other.postMessage({ type: 'cloud-mutated', userId: 'owner-1' });
    });
    expectStillWorking(screen);
    expect(mockedGateway.signOutThisTabToo).not.toHaveBeenCalled();
  });

  test('the automatic not-owner sign-out in this tab tells no other tab', async () => {
    storedHere = 'visitor-1';
    mockedLoadSnapshot.mockRejectedValue(new DAVEWebAuthorizationError());
    const other = anotherTab();
    const heard: unknown[] = [];
    other.onmessage = event => { heard.push(event.data); };

    const screen = render(
      <DesktopAuthProvider>
        <DesktopReadOnlyShell page="settings" />
      </DesktopAuthProvider>,
    );

    await waitFor(() => expect(mockedGateway.signOut).toHaveBeenCalledWith('local'));
    await waitFor(() => expect(screen.getByText(
      'This account is not authorized for the Vitruvius desktop pilot.',
    )).toBeTruthy());
    expect(heard).toEqual([]);
  });
});

test('a SIGNED_OUT after this tab’s own sign-in has gone (it expired) still shows the sign-in page', async () => {
  const screen = await renderWorkingTab();
  storedHere = null;

  await emit('SIGNED_OUT', null);

  await waitFor(() => expect(screen.getByLabelText('Password')).toBeTruthy());
  expect(screen.queryByText('Account and Sync')).toBeNull();
  expect(mockedGateway.signOutThisTabToo).not.toHaveBeenCalled();
});
