/**
 * Independent review R10 (Build 229), desktop plumbing: the Stop switch and
 * the request id the Ask ECOS page hands to onAsk reach the cloud request
 * through the desktop shell and its cloud gateway.
 */
import { render } from '@testing-library/react-native';
import { createElement } from 'react';
import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { ECOSAskControl } from '../../services/ECOSAskWait';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '55555555-5555-4555-8555-555555555555' }));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { LinearGradient: ({ children }: { children: unknown }) => React.createElement(View, null, children) };
});
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: unknown }) => children,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/ask-ecos',
  useRouter: () => ({ setParams: jest.fn() }),
}));
jest.mock('../../services/VitruviusDesktopPreferences', () => ({
  VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY: 'vitruvius.display-name',
  formatVitruviusDesktopGreeting: () => 'Good morning, David',
  readVitruviusDesktopDisplayName: () => 'David',
  writeVitruviusDesktopDisplayName: (value: string) => value.trim(),
}));
jest.mock('../../services/FieldNoteDesktopDataSource', () => ({
  desktopFieldNoteDataSource: { list: jest.fn(async () => []), save: jest.fn(), update: jest.fn() },
}));

type AskInput = { projectId: string; projectName: string; question: string };
type OnAsk = (input: AskInput, control?: ECOSAskControl) => Promise<unknown>;
const mockWorkspace: { onAsk: OnAsk | null } = { onAsk: null };
jest.mock('../../components/web-shell/desktop-ask-ecos', () => ({
  DesktopAskECOSWorkspace: (props: { onAsk: OnAsk }) => {
    mockWorkspace.onAsk = props.onAsk;
    return null;
  },
}));

const snapshot = {
  projects: [{ id: 'project-2375', name: '2375 Compliance Project' }],
  scheduleItems: [],
  projectUpdates: [],
  referenceDocuments: [],
  closedProjectNames: [],
  refreshedAt: '2026-10-05T12:00:00.000Z',
} as unknown as DAVEWebReadOnlySnapshot;

const mockAuth = {
  phase: 'ready',
  userEmail: 'pm@example.com',
  sessionExpiresAt: null,
  snapshot,
  freshness: {
    status: 'connected',
    lastSuccessfulRefreshAt: snapshot.refreshedAt,
    lastAttemptAt: snapshot.refreshedAt,
    consecutiveFailures: 0,
  },
  message: null,
  refreshSnapshot: jest.fn(async () => true),
  askProjectQuestion: jest.fn(async (_input: unknown) => ({ answer: 'Six inches.' })),
};
jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));

const INPUT: AskInput = {
  projectId: 'project-2375',
  projectName: '2375 Compliance Project',
  question: 'How thick is the north side concrete?',
};
const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

it('the desktop shell passes the Stop switch and the request id on with the question', async () => {
  type TestWindow = { addEventListener?: jest.Mock; removeEventListener?: jest.Mock };
  const root = globalThis as unknown as { window?: TestWindow };
  root.window = root.window ?? {};
  root.window.addEventListener = jest.fn();
  root.window.removeEventListener = jest.fn();

  render(createElement(DesktopReadOnlyShell, { page: 'ask-ecos' }));
  const control: ECOSAskControl = { signal: new AbortController().signal, clientRequestId: REQUEST_ID };
  await mockWorkspace.onAsk!(INPUT, control);
  expect(mockAuth.askProjectQuestion).toHaveBeenCalledWith({
    ...INPUT,
    signal: control.signal,
    clientRequestId: REQUEST_ID,
    knownProjectNames: ['2375 Compliance Project'],
    closedProjectNames: [],
  });
});

it('the desktop cloud gateway sends that request id and stops the request when the switch is thrown', async () => {
  const invocations: Array<{ body: Record<string, string>; signal: AbortSignal }> = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }),
      getSession: async () => ({ data: { session: { access_token: 'token' } }, error: null }),
    },
    rpc: async () => ({ data: true, error: null, status: 200 }),
    functions: {
      invoke: (_name: string, options: { body: Record<string, string>; signal: AbortSignal }) => {
        invocations.push(options);
        return new Promise(() => undefined);
      },
    },
  };
  const gateway = createDAVEWebSupabaseGateway(client as never);
  const controller = new AbortController();
  const asked = gateway.askAuthorizedProjectQuestion({ ...INPUT, signal: controller.signal, clientRequestId: REQUEST_ID });
  const outcome = asked.then(() => 'answered', (error: { code?: string }) => error.code);
  // Let the owner check and the sign-in check finish, so the request is out.
  for (let turn = 0; turn < 20 && invocations.length === 0; turn += 1) await Promise.resolve();

  expect(invocations).toHaveLength(1);
  expect(invocations[0].body.clientRequestId).toBe(REQUEST_ID);
  expect(invocations[0].signal.aborted).toBe(false);
  controller.abort();
  await expect(outcome).resolves.toBe('question_cancelled');
  expect(invocations[0].signal.aborted).toBe(true);
});
