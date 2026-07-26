import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text, Pressable, View } from 'react-native';

import {
  DesktopAuthProvider,
  useDesktopAuth,
} from '../../components/web-shell/desktop-auth-provider';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';

jest.mock('../../services/DAVEWebReadOnlyRepository', () => ({
  loadDAVEWebReadOnlySnapshot: jest.fn(),
}));

jest.mock('../../services/DAVEWebSupabaseClient', () => {
  class DAVEWebAuthorizationError extends Error {}
  return {
    DAVEWebAuthorizationError,
    daveWebSupabaseGateway: {
      getSessionStatus: jest.fn(),
      subscribeToAuthStateChange: jest.fn(),
      subscribeToAuthorizedOperationalChanges: jest.fn(),
      signOut: jest.fn(),
    },
  };
});

const mockedLoadSnapshot = jest.mocked(loadDAVEWebReadOnlySnapshot);
const mockedGateway = jest.mocked(daveWebSupabaseGateway);
const recentRefreshAt = new Date().toISOString();

function Harness() {
  const auth = useDesktopAuth();
  return (
    <View>
      <Text testID="phase">{auth.phase}</Text>
      <Text testID="snapshot">{auth.snapshot?.refreshedAt || 'none'}</Text>
      <Text testID="freshness">{auth.freshness.status}</Text>
      <Text testID="message">{auth.message || 'none'}</Text>
      <Pressable testID="refresh" onPress={() => { void auth.refreshSnapshot(); }}>
        <Text>Refresh</Text>
      </Pressable>
    </View>
  );
}

describe('DesktopAuthProvider refresh continuity', () => {
  const originalBroadcastChannel = globalThis.BroadcastChannel;

  afterAll(() => {
    globalThis.BroadcastChannel = originalBroadcastChannel;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGateway.getSessionStatus.mockResolvedValue({
      configured: true,
      session: {
        user: { id: 'owner-1', email: 'owner@example.com' },
        expires_at: 1_900_000_000,
      } as never,
    });
    mockedGateway.subscribeToAuthorizedOperationalChanges.mockResolvedValue(
      () => undefined,
    );
    mockedGateway.subscribeToAuthStateChange.mockReturnValue(() => undefined);
    mockedLoadSnapshot.mockResolvedValueOnce({
      projects: [],
      scheduleItems: [],
      projectUpdates: [],
      referenceDocuments: [],
      refreshedAt: recentRefreshAt,
    });
  });

  it('keeps the last verified workspace visible when a later manual refresh fails', async () => {
    const screen = render(
      <DesktopAuthProvider>
        <Harness />
      </DesktopAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('phase').props.children).toBe('ready');
      expect(screen.getByTestId('snapshot').props.children).toBe(recentRefreshAt);
    });

    mockedLoadSnapshot.mockRejectedValueOnce(new Error('temporary timeout'));
    fireEvent.press(screen.getByTestId('refresh'));

    await waitFor(() => {
      expect(screen.getByTestId('phase').props.children).toBe('ready');
      expect(screen.getByTestId('snapshot').props.children).toBe(recentRefreshAt);
      expect(screen.getByTestId('freshness').props.children).toBe('reconnecting');
      expect(screen.getByTestId('message').props.children).toMatch(
        /current workspace remains available/i,
      );
    });
  });

  it('refreshes a visible workspace when another Vitruvius window announces a cloud change', async () => {
    const channels: Array<{
      onmessage: ((event: MessageEvent) => void) | null;
      postMessage: jest.Mock;
      close: jest.Mock;
    }> = [];
    class BroadcastChannelMock {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage = jest.fn();
      close = jest.fn();

      constructor(public readonly name: string) {
        channels.push(this);
      }
    }
    globalThis.BroadcastChannel = BroadcastChannelMock as never;

    const nextRefreshAt = new Date(Date.now() + 5_000).toISOString();
    mockedLoadSnapshot.mockResolvedValueOnce({
      projects: [],
      scheduleItems: [],
      projectUpdates: [],
      referenceDocuments: [],
      refreshedAt: nextRefreshAt,
    });

    const screen = render(
      <DesktopAuthProvider>
        <Harness />
      </DesktopAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('phase').props.children).toBe('ready');
      expect(channels.length).toBeGreaterThanOrEqual(1);
    });

    channels[channels.length - 1]?.onmessage?.({
      data: { type: 'cloud-mutated', at: Date.now() },
    } as MessageEvent);

    await waitFor(() => {
      expect(screen.getByTestId('snapshot').props.children).toBe(nextRefreshAt);
      expect(mockedLoadSnapshot).toHaveBeenCalledTimes(2);
    });
  });
});
