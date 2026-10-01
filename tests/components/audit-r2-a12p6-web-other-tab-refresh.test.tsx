/**
 * Whole-app audit A12 pass 6 L1 (30 Sep 2026), with two real supabase-js
 * clients as two tabs of one browser (tests/fixtures/browser-tabs.ts).
 * auth-js passes each tab's TOKEN_REFRESHED to the other tabs with the
 * sending tab's session attached, and the web page took that session as its
 * own:
 * - a visitor's tab refreshing turned the owner's tab's "Signed in as" into
 *   the visitor's email, and a percent he then changed was saved as
 *   confirmed by the visitor (the email also keys Field Notes and Ask ECOS);
 * - in a signed-out tab, the owner's other tab refreshing showed "Checking
 *   the browser session…", then the red "Sign in is required…", and ran the
 *   automatic not-owner sign-out.
 * The requests themselves always carried this tab's own sign-in.
 *
 * Now a tab acts on a refresh only when it is for this tab's own stored
 * sign-in. A signed-out tab ignores another tab's refresh entirely; another
 * tab of the same account refreshing still reloads, as before.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text, View } from 'react-native';

import {
  DesktopAuthProvider,
  useDesktopAuth,
} from '../../components/web-shell/desktop-auth-provider';
import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { supabaseSecureAuthStorage } from '../../services/SupabaseAuthStorage.web';
import {
  closeTabClient,
  createTabClient,
  createTabCloud,
  createTabStorage,
  recordTabAuthEvents,
  storeTabSignIn,
  tabAuthStorage,
  tabHoldsSignIn,
  type TabCloud,
  type TabStorage,
} from '../fixtures/browser-tabs';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View: MockView } = require('react-native');
  return {
    LinearGradient: ({ children }: { children: React.ReactNode }) => (
      React.createElement(MockView, null, children)
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

/** This tab's gateway, over this tab's real client (set in beforeEach). */
let mockThisTabGateway: Record<string, unknown> = {};
jest.mock('../../services/DAVEWebSupabaseClient', () => {
  const actual = jest.requireActual('../../services/DAVEWebSupabaseClient');
  return {
    ...actual,
    daveWebSupabaseGateway: new Proxy({}, {
      get: (_target, key) => mockThisTabGateway[key as string],
    }),
  };
});

const PROJECT = '2321 Compliance Project';
const task: DAVEWebScheduleItem = {
  id: 'pour-slab',
  projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
  itemType: 'Task',
  scheduleProjectName: PROJECT,
  projectName: PROJECT,
  projectTimeZone: 'America/Los_Angeles',
  locationName: 'Level 1',
  taskName: 'Pour slab',
  startDate: '09/14/2026',
  finishDate: '09/18/2026',
  milestone: '',
  owner: 'Concrete crew',
  contractor: 'Ready Mix Co',
  durationDays: 5,
  percentComplete: 60,
  progressSource: null,
  progressConfirmedAt: null,
  progressConfirmedBy: null,
  priority: 'Medium',
  status: 'In Progress',
  notes: '',
  nextAction: '',
  activity: [],
  importedAt: '2026-09-01T09:00:00.000Z',
  importBatchId: 'batch-master-update',
  sourceDocumentId: 'doc-master-update',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-30T14:00:00.000Z',
  cloudUpdatedAt: '2026-09-30T14:00:01.000Z',
};

/** What the page shows, and every phase it went through. */
const phasesSeen: string[] = [];
function Probe() {
  const auth = useDesktopAuth();
  phasesSeen.push(auth.phase);
  return (
    <View>
      <Text testID="phase">{auth.phase}</Text>
      <Text testID="email">{auth.userEmail ?? 'none'}</Text>
      <Text testID="message">{auth.message ?? 'none'}</Text>
    </View>
  );
}

const root = globalThis as unknown as Record<string, unknown>;
const originalDocument = root.document;
const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalWarn = console.warn;

let thisTabStorage: TabStorage;
let otherTabStorage: TabStorage;
let cloud: TabCloud;
let thisTab: SupabaseClient;
let otherTab: SupabaseClient;
let heardHere: ReturnType<typeof recordTabAuthEvents> | null = null;
let saved: DAVEWebScheduleItem[] = [];

beforeAll(() => {
  // A browser page: auth-js opens its tab channel only when there is one.
  root.document = {
    visibilityState: 'visible',
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  root.addEventListener = jest.fn();
  root.removeEventListener = jest.fn();
  // Two clients on one storage key is what two tabs are; auth-js says so.
  jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes('Multiple GoTrueClient instances')) return;
    originalWarn(...args);
  });
});
afterAll(() => {
  root.document = originalDocument;
  if (originalSessionStorage) Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
  else delete root.sessionStorage;
  jest.restoreAllMocks();
});

/**
 * This tab's storage is the page's own sessionStorage (the web adapter and
 * its stored-sign-in check read it); the other tab has its own.
 */
async function openTabs({ here, there }: { here: string | null; there: string }) {
  thisTabStorage = createTabStorage();
  otherTabStorage = createTabStorage();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    writable: true,
    value: thisTabStorage,
  });
  if (here) storeTabSignIn(thisTabStorage, here);
  storeTabSignIn(otherTabStorage, there);
  cloud = createTabCloud();
  thisTab = createTabClient(supabaseSecureAuthStorage, cloud);
  otherTab = createTabClient(tabAuthStorage(otherTabStorage), cloud);
  await Promise.all([thisTab.auth.initialize(), otherTab.auth.initialize()]);
  saved = [];
  mockThisTabGateway = {
    ...createDAVEWebSupabaseGateway(thisTab),
    // Realtime needs a socket; maintenance is not what this is about.
    subscribeToAuthorizedOperationalChanges: async () => () => undefined,
    runAuthorizedMaintenance: async () => undefined,
    // The task as the page saves it, before the cloud write.
    updateAuthorizedScheduleItem: async (item: DAVEWebScheduleItem) => {
      saved.push(item);
      return '2026-09-30T15:00:00.000Z';
    },
  };
}

afterEach(() => {
  heardHere?.stop();
  heardHere = null;
  closeTabClient(thisTab);
  closeTabClient(otherTab);
});

beforeEach(() => {
  phasesSeen.length = 0;
});

const text = (screen: ReturnType<typeof render>, id: string) =>
  screen.getByTestId(id).props.children;

/** The other tab refreshes its sign-in, and this tab's client hears it. */
async function otherTabRefreshes() {
  heardHere = heardHere ?? recordTabAuthEvents(thisTab);
  await act(async () => {
    const { error } = await otherTab.auth.refreshSession();
    expect(error).toBeNull();
  });
  await waitFor(() => expect(heardHere?.events).toContain('TOKEN_REFRESHED'));
  // Whatever the page does with it has finished.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}

/** Every request that carried a sign-in carried this one. */
const signInsSentFromHere = () => [...new Set(cloud.calls
  .filter(call => !call.path.startsWith('/auth/v1/token'))
  .map(call => call.userId))];

describe('a visitor’s tab refreshing (A12 pass 6 L1)', () => {
  test('the owner’s tab keeps his email, and a percent he changes is confirmed by him', async () => {
    await openTabs({ here: 'owner-1', there: 'visitor-1' });
    const screen = render(
      <DesktopAuthProvider>
        <Probe />
        <DesktopSchedulePage tasks={[task]} projects={[PROJECT]} selectedProject={PROJECT} />
      </DesktopAuthProvider>,
    );
    await waitFor(() => expect(text(screen, 'phase')).toBe('ready'));
    expect(text(screen, 'email')).toBe('owner@example.com');

    await otherTabRefreshes();

    expect(text(screen, 'email')).toBe('owner@example.com');
    expect(text(screen, 'phase')).toBe('ready');
    fireEvent.press(screen.getByLabelText('Edit Pour slab'));
    fireEvent.changeText(screen.getByDisplayValue('60'), '80');
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({
      percentComplete: 80,
      progressSource: 'project_manager',
      progressConfirmedBy: 'owner@example.com',
    });
    // Data never crossed: every request carried this tab's own sign-in.
    expect(signInsSentFromHere()).toEqual(['owner-1']);
    expect(tabHoldsSignIn(otherTabStorage)).toBe(true);
    screen.unmount();
  });

  test('Settings still says “Signed in as” the owner', async () => {
    await openTabs({ here: 'owner-1', there: 'visitor-1' });
    const screen = render(
      <DesktopAuthProvider>
        <DesktopReadOnlyShell page="settings" />
      </DesktopAuthProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Signed in as owner@example\.com/)).toBeTruthy());

    await otherTabRefreshes();

    expect(screen.getByText(/Signed in as owner@example\.com/)).toBeTruthy();
    expect(screen.queryByText(/visitor@example\.com/)).toBeNull();
    screen.unmount();
  });
});

describe('the owner’s other tab refreshing while this tab is signed out (A12 pass 6 L1)', () => {
  test('this tab stays on the sign-in page: no “Checking…”, no banner, no sign-out', async () => {
    await openTabs({ here: null, there: 'owner-1' });
    const signOutHere = jest.spyOn(thisTab.auth, 'signOut');
    const screen = render(
      <DesktopAuthProvider>
        <Probe />
        <DesktopReadOnlyShell page="settings" />
      </DesktopAuthProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText('Password')).toBeTruthy());
    phasesSeen.length = 0;

    await otherTabRefreshes();

    expect(phasesSeen.filter(phase => phase !== 'signed_out')).toEqual([]);
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.queryByText('Checking the browser session…')).toBeNull();
    expect(screen.queryByText('Sign in is required for the Vitruvius desktop pilot.')).toBeNull();
    expect(text(screen, 'message')).toBe('none');
    expect(signOutHere).not.toHaveBeenCalled();
    // Nothing was asked of the cloud from this tab, and the owner's other
    // tab is still signed in.
    expect(signInsSentFromHere()).toEqual([]);
    expect(tabHoldsSignIn(otherTabStorage)).toBe(true);
    screen.unmount();
  });
});

describe('another tab of the same account refreshing (unchanged)', () => {
  test('this tab checks again with its own sign-in and stays on the workspace', async () => {
    await openTabs({ here: 'owner-1', there: 'owner-1' });
    const screen = render(
      <DesktopAuthProvider>
        <Probe />
        <DesktopSchedulePage tasks={[task]} projects={[PROJECT]} selectedProject={PROJECT} />
      </DesktopAuthProvider>,
    );
    await waitFor(() => expect(text(screen, 'phase')).toBe('ready'));
    const ownerChecksBefore = cloud.callsFor('/rest/v1/rpc/dave_is_app_owner').length;

    await otherTabRefreshes();

    await waitFor(() => expect(cloud.callsFor('/rest/v1/rpc/dave_is_app_owner').length)
      .toBeGreaterThan(ownerChecksBefore));
    expect(text(screen, 'phase')).toBe('ready');
    expect(text(screen, 'email')).toBe('owner@example.com');
    expect(signInsSentFromHere()).toEqual(['owner-1']);
    screen.unmount();
  });
});
