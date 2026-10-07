/**
 * Second review of the web area, F5 (a) (7 Oct 2026; caused by the fix for
 * review pass 1, L3). Sign Out of This Computer now always signs this browser
 * tab out, also when the sign-in server could not be told (no connection,
 * "unavailable", "too many requests", no answer in five seconds). The build
 * before told him the sign-out had not worked; the fix said nothing, though
 * the sign-in then stays good on the server: a tab that was closed or asleep
 * comes back signed in, until Sign Out of All Devices ends it.
 *
 * The sign-in page he lands on now says so, in the tab where he clicked, and
 * says nothing when the cloud confirmed the sign-out. (What "confirmed" is:
 * tests/services/review-p5-web-pass2-f5-sign-out-and-the-cloud.test.ts.)
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
      signedOutWithoutCloudConfirmation: jest.fn(),
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


/** The sentence on the sign-in page after a Sign Out of This Computer the cloud did not confirm. */
const NOT_CONFIRMED =
  'This tab is signed out, but the cloud did not confirm it: the same sign-in may still be open in a Vitruvius tab that was closed or asleep. To end it everywhere, use Sign Out of All Devices on a device where you are signed in.';

async function renderWorkingTab() {
  const screen = render(
    <DesktopAuthProvider>
      <DesktopReadOnlyShell page="settings" />
    </DesktopAuthProvider>,
  );
  await waitFor(() => expect(screen.getByText('Account and Sync')).toBeTruthy());
  return screen;
}
/** He chooses Sign out, then one of the two; the sign-in page follows. */
async function signsOut(screen: ReturnType<typeof render>, choice: 'Sign Out of This Computer' | 'Sign Out of All Devices') {
  fireEvent.press(screen.getByText('Sign out'));
  await act(async () => { fireEvent.press(screen.getByText(choice)); });
  await waitFor(() => expect(screen.getByLabelText('Password')).toBeTruthy());
}
/** The sign-out as the web client does it: the sign-in leaves this tab, and it knows whether the cloud confirmed. */
const gatewaySignsOut = (confirmedByCloud: boolean) => {
  mockedGateway.signedOutWithoutCloudConfirmation.mockReturnValue(false);
  mockedGateway.signOut.mockImplementation(async () => {
    storedHere = null;
    authListener('SIGNED_OUT', null);
    mockedGateway.signedOutWithoutCloudConfirmation.mockReturnValue(!confirmedByCloud);
  });
};

describe('second review, web F5 (a): the sign-in page after Sign Out of This Computer', () => {
  test('the cloud did not confirm the sign-out: the page says so, with what it means for him', async () => {
    gatewaySignsOut(false);
    const screen = await renderWorkingTab();

    await signsOut(screen, 'Sign Out of This Computer');

    expect(screen.getByText(NOT_CONFIRMED)).toBeTruthy();
    expect(mockedGateway.signOut).toHaveBeenCalledWith('local');
  });

  test('the cloud confirmed it: nothing is said', async () => {
    gatewaySignsOut(true);
    const screen = await renderWorkingTab();

    await signsOut(screen, 'Sign Out of This Computer');

    expect(screen.queryByText(NOT_CONFIRMED)).toBeNull();
    expect(screen.queryByText(/did not confirm/)).toBeNull();
  });

  test('it stays while he is on the sign-in page: another tab finishing its own sign-out a moment later does not take it away', async () => {
    gatewaySignsOut(false);
    const screen = await renderWorkingTab();
    await signsOut(screen, 'Sign Out of This Computer');

    // auth-js passes the other tab's SIGNED_OUT to this one.
    await emit('SIGNED_OUT', null);
    await emit('SIGNED_OUT', null);

    expect(screen.getByText(NOT_CONFIRMED)).toBeTruthy();
  });

  test('it goes when he signs in again, and is not back after a later sign-out that the cloud confirmed', async () => {
    gatewaySignsOut(false);
    const screen = await renderWorkingTab();
    await signsOut(screen, 'Sign Out of This Computer');
    expect(screen.getByText(NOT_CONFIRMED)).toBeTruthy();

    mockedGateway.signIn.mockImplementation(async () => {
      storedHere = 'owner-1';
      return { ok: true, session: ownerSession };
    });
    fireEvent.changeText(screen.getByLabelText('Email'), 'owner@example.com');
    fireEvent.changeText(screen.getByLabelText('Password'), 'synthetic-test-password');
    await act(async () => { fireEvent.press(screen.getByText('Sign in securely')); });
    await waitFor(() => expect(screen.getByText('Account and Sync')).toBeTruthy());
    expect(screen.queryByText(NOT_CONFIRMED)).toBeNull();

    gatewaySignsOut(true);
    await signsOut(screen, 'Sign Out of This Computer');
    expect(screen.queryByText(NOT_CONFIRMED)).toBeNull();
  });

  test('a sign-in that fails replaces it with its own answer, and it does not come back', async () => {
    gatewaySignsOut(false);
    const screen = await renderWorkingTab();
    await signsOut(screen, 'Sign Out of This Computer');

    mockedGateway.signIn.mockResolvedValue({ ok: false, session: null });
    fireEvent.changeText(screen.getByLabelText('Email'), 'owner@example.com');
    fireEvent.changeText(screen.getByLabelText('Password'), 'synthetic-wrong-password');
    await act(async () => { fireEvent.press(screen.getByText('Sign in securely')); });

    await waitFor(() => expect(screen.getByText('Sign-in could not be completed. Check your email and password, then try again.')).toBeTruthy());
    expect(screen.queryByText(NOT_CONFIRMED)).toBeNull();
    await emit('SIGNED_OUT', null);
    expect(screen.queryByText(NOT_CONFIRMED)).toBeNull();
  });

  test('a sign-in made in this tab while it was signing out was kept (the tab still holds one): nothing is said about a tab that is not signed out', async () => {
    mockedGateway.signOut.mockImplementation(async () => {
      authListener('SIGNED_OUT', null);
      mockedGateway.signedOutWithoutCloudConfirmation.mockReturnValue(true);
    });
    const screen = await renderWorkingTab();

    fireEvent.press(screen.getByText('Sign out'));
    await act(async () => { fireEvent.press(screen.getByText('Sign Out of This Computer')); });

    await waitFor(() => expect(mockedGateway.signOut).toHaveBeenCalledWith('local'));
    expect(storedHere).toBe('owner-1');
    expect(screen.queryByText(NOT_CONFIRMED)).toBeNull();
  });

  test('guard: Sign Out of All Devices that went through says nothing (the cloud did it)', async () => {
    gatewaySignsOut(true);
    const screen = await renderWorkingTab();

    await signsOut(screen, 'Sign Out of All Devices');

    expect(screen.queryByText(NOT_CONFIRMED)).toBeNull();
  });

  test('Sign Out of All Devices never says it, whatever was noted of an earlier sign-out', async () => {
    mockedGateway.signOut.mockImplementation(async () => {
      storedHere = null;
      authListener('SIGNED_OUT', null);
    });
    mockedGateway.signedOutWithoutCloudConfirmation.mockReturnValue(true);
    const screen = await renderWorkingTab();

    await signsOut(screen, 'Sign Out of All Devices');

    expect(screen.queryByText(NOT_CONFIRMED)).toBeNull();
  });

  test('guard: a tab that only HEARS the sign-out from another tab shows the plain sign-in page', async () => {
    const screen = await renderWorkingTab();
    const other = new FakeBroadcastChannel(DESKTOP_SIGN_OUT_CHANNEL_NAME);

    await act(async () => {
      other.postMessage({ type: 'signed-out-of-this-computer', userId: 'owner-1' });
    });

    await waitFor(() => expect(screen.getByLabelText('Password')).toBeTruthy());
    expect(screen.queryByText(NOT_CONFIRMED)).toBeNull();
  });
});
