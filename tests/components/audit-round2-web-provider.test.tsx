import { useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';

import {
  DesktopAuthProvider,
  useDesktopAuth,
} from '../../components/web-shell/desktop-auth-provider';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../../services/DAVEWebReadOnlyRepository', () => ({
  loadDAVEWebReadOnlySnapshot: jest.fn(),
}));
jest.mock('../../services/DAVEWebSupabaseClient', () => {
  class DAVEWebAuthorizationError extends Error {}
  class DAVEWebTaskMutationError extends Error {
    readonly code: string;
    constructor(mockCode: string, message: string) {
      super(message);
      this.code = mockCode;
    }
  }
  return {
    DAVEWebAuthorizationError,
    DAVEWebTaskMutationError,
    daveWebSupabaseGateway: {
      getSessionStatus: jest.fn(),
      subscribeToAuthStateChange: jest.fn(),
      subscribeToAuthorizedOperationalChanges: jest.fn(),
      runAuthorizedMaintenance: jest.fn(),
      createAuthorizedScheduleItem: jest.fn(),
      updateAuthorizedScheduleItem: jest.fn(),
      listAuthorizedUnrestorableScheduleItemIds: jest.fn(),
      signOut: jest.fn(),
    },
  };
});

const mockedLoadSnapshot = jest.mocked(loadDAVEWebReadOnlySnapshot);
const mockedGateway = jest.mocked(daveWebSupabaseGateway);

function task(id: string): DAVEWebScheduleItem {
  return {
    id,
    taskName: id,
    cloudUpdatedAt: '2026-09-30T12:00:00.000Z',
  } as DAVEWebScheduleItem;
}

const visible = task('visible-task');
const snapshot = {
  projects: [],
  scheduleItems: [visible],
  projectUpdates: [],
  referenceDocuments: [],
  refreshedAt: new Date().toISOString(),
};

function Harness({ run }: { run: (auth: ReturnType<typeof useDesktopAuth>) => Promise<unknown> }) {
  const auth = useDesktopAuth();
  const [outcome, setOutcome] = useState('none');
  return (
    <View>
      <Text testID="phase">{auth.phase}</Text>
      <Text testID="outcome">{outcome}</Text>
      <Pressable
        testID="run"
        onPress={() => {
          run(auth).then(
            value => setOutcome(`ok:${String(value)}`),
            (error: Error) => setOutcome(`error:${error.message}`),
          );
        }}
      >
        <Text>Run</Text>
      </Pressable>
    </View>
  );
}

async function renderReady(run: (auth: ReturnType<typeof useDesktopAuth>) => Promise<unknown>) {
  const screen = render(
    <DesktopAuthProvider>
      <Harness run={run} />
    </DesktopAuthProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('phase').props.children).toBe('ready'));
  mockedLoadSnapshot.mockClear();
  return screen;
}

describe('web provider refresh after refused task writes (audit round 2 F7, F8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGateway.getSessionStatus.mockResolvedValue({
      configured: true,
      session: {
        user: { id: 'owner-1', email: 'owner@example.com' },
        expires_at: 1_900_000_000,
      } as never,
    });
    mockedGateway.subscribeToAuthorizedOperationalChanges.mockResolvedValue(() => undefined);
    mockedGateway.subscribeToAuthStateChange.mockReturnValue(() => undefined);
    mockedGateway.runAuthorizedMaintenance.mockResolvedValue(undefined);
    mockedLoadSnapshot.mockResolvedValue(snapshot as never);
  });

  test('"Apply all date changes" refused on its first task still refreshes the schedule, as its message says', async () => {
    mockedGateway.updateAuthorizedScheduleItem.mockRejectedValueOnce(new Error('changed on another device'));
    const screen = await renderReady(auth => auth.updateTasks([task('a'), task('b')]));

    fireEvent.press(screen.getByTestId('run'));

    await waitFor(() => expect(screen.getByTestId('outcome').props.children)
      .toBe('error:changed on another device'));
    expect(mockedGateway.updateAuthorizedScheduleItem).toHaveBeenCalledTimes(1);
    // Was toHaveBeenCalledWith(['schedule_items']). A refusal now refreshes
    // everything: a targeted refresh could be answered from a copy an
    // earlier save had marked up to date (audit round 2 follow-up, 30 Sep).
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(1);
    expect(mockedLoadSnapshot).toHaveBeenCalledWith(undefined);
  });

  test('"Apply all date changes" that saves A and is refused on B refreshes everything, not only the saved copy', async () => {
    mockedGateway.updateAuthorizedScheduleItem
      .mockResolvedValueOnce('2026-09-30T13:00:00.000Z')
      .mockRejectedValueOnce(new Error('changed on another device'));
    const screen = await renderReady(auth => auth.updateTasks([task('a'), task('b')]));

    fireEvent.press(screen.getByTestId('run'));

    await waitFor(() => expect(screen.getByTestId('outcome').props.children)
      .toBe('error:changed on another device'));
    expect(mockedGateway.updateAuthorizedScheduleItem).toHaveBeenCalledTimes(2);
    expect(mockedLoadSnapshot).toHaveBeenCalledTimes(1);
    expect(mockedLoadSnapshot).toHaveBeenCalledWith(undefined);
  });

  test('"Apply all date changes" that saves every task keeps the quick schedule-only refresh', async () => {
    mockedGateway.updateAuthorizedScheduleItem.mockResolvedValue('2026-09-30T13:00:00.000Z');
    const screen = await renderReady(auth => auth.updateTasks([task('a'), task('b')]));

    fireEvent.press(screen.getByTestId('run'));

    await waitFor(() => expect(screen.getByTestId('outcome').props.children).toBe('ok:2'));
    expect(mockedLoadSnapshot).toHaveBeenCalledWith(['schedule_items']);
  });

  test('Restore Missing Tasks leaves deleted and hidden tasks alone and restores only what is gone', async () => {
    mockedGateway.listAuthorizedUnrestorableScheduleItemIds.mockResolvedValue(
      new Set(['deleted-task', 'hidden-task']),
    );
    mockedGateway.createAuthorizedScheduleItem.mockResolvedValue('2026-09-30T13:00:00.000Z');
    const screen = await renderReady(auth => auth.restoreMissingTasks([
      visible,
      task('deleted-task'),
      task('hidden-task'),
      task('gone-task'),
    ]));

    fireEvent.press(screen.getByTestId('run'));

    await waitFor(() => expect(screen.getByTestId('outcome').props.children).toBe('ok:1'));
    expect(mockedGateway.listAuthorizedUnrestorableScheduleItemIds)
      .toHaveBeenCalledWith(['deleted-task', 'hidden-task', 'gone-task']);
    expect(mockedGateway.createAuthorizedScheduleItem).toHaveBeenCalledTimes(1);
    expect(mockedGateway.createAuthorizedScheduleItem)
      .toHaveBeenCalledWith(expect.objectContaining({ id: 'gone-task' }));
  });

  test('a restore that stops part-way refreshes and says how many were restored', async () => {
    mockedGateway.listAuthorizedUnrestorableScheduleItemIds.mockResolvedValue(new Set());
    mockedGateway.createAuthorizedScheduleItem
      .mockResolvedValueOnce('2026-09-30T13:00:00.000Z')
      .mockRejectedValueOnce(new Error('The task could not be created.'));
    const screen = await renderReady(auth => auth.restoreMissingTasks([
      task('gone-1'),
      task('gone-2'),
      task('gone-3'),
    ]));

    fireEvent.press(screen.getByTestId('run'));

    await waitFor(() => expect(screen.getByTestId('outcome').props.children).toBe(
      'error:1 missing task was restored before one could not be saved. The workspace has been refreshed; validate the export again to restore the rest.',
    ));
    expect(mockedGateway.createAuthorizedScheduleItem).toHaveBeenCalledTimes(2);
    expect(mockedLoadSnapshot).toHaveBeenCalledWith(['schedule_items']);
  });
});
