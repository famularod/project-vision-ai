/**
 * Audit round 2 follow-up (30 Sep 2026), end to end: the real
 * DesktopAuthProvider, read-only repository and gateway over an in-memory
 * cloud. "Apply all date changes" saved task A, was refused on task B (the
 * phone had moved it), and said "The schedule was refreshed; review the
 * remaining changes" while still showing B as the web had opened it. The
 * refresh after a refusal now reads the cloud, so B shows the phone's dates.
 */
import { useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';

import {
  DesktopAuthProvider,
  useDesktopAuth,
} from '../../components/web-shell/desktop-auth-provider';
import * as gatewayModule from '../../services/DAVEWebSupabaseClient';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import type { FakeWebCloud } from '../fixtures/fake-web-cloud';
import type { ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../../services/DAVEWebSupabaseClient', () => {
  const actual = jest.requireActual('../../services/DAVEWebSupabaseClient');
  const { createFakeWebCloud } = jest.requireActual('../fixtures/fake-web-cloud');
  const cloud = createFakeWebCloud();
  const gateway = actual.createDAVEWebSupabaseGateway(cloud.client);
  return {
    ...actual,
    __fakeCloud: cloud,
    daveWebSupabaseGateway: {
      ...gateway,
      // Realtime needs a socket; this test is about the refresh after a refusal.
      subscribeToAuthorizedOperationalChanges: async () => () => undefined,
    },
  };
});

const cloud = (gatewayModule as unknown as { __fakeCloud: FakeWebCloud }).__fakeCloud;
const PROJECT = '2321 Compliance Project';

function item(id: string, overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id,
    projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
    scheduleProjectName: PROJECT,
    projectName: PROJECT,
    locationName: `Area ${id}`,
    taskName: `Task ${id}`,
    startDate: '2026-10-05',
    finishDate: '2026-10-06',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    percentComplete: 0,
    progressSource: 'project_manager',
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    createdAt: '2026-09-30T12:00:00.000Z',
    updatedAt: '2026-09-30T12:00:00.000Z',
    ...overrides,
  } as ScheduleItem;
}

function row(value: ScheduleItem, updatedAt: string) {
  return {
    id: value.id,
    owner_id: 'owner-1',
    project_name: value.projectName,
    task_name: value.taskName,
    item_data: value,
    updated_at: updatedAt,
  };
}

function Harness() {
  const auth = useDesktopAuth();
  const [outcome, setOutcome] = useState('none');
  const b = auth.snapshot?.scheduleItems.find(task => task.id === 'b') as DAVEWebScheduleItem | undefined;
  return (
    <View>
      <Text testID="phase">{auth.phase}</Text>
      <Text testID="outcome">{outcome}</Text>
      <Text testID="b">{b ? `${b.startDate}|${b.notes}|${b.cloudUpdatedAt}` : 'none'}</Text>
      <Pressable
        testID="apply-all"
        onPress={() => {
          const tasks = auth.snapshot?.scheduleItems ?? [];
          const moved = tasks
            .filter(task => task.id === 'a' || task.id === 'b')
            .sort((left, right) => left.id.localeCompare(right.id))
            .map(task => ({ ...task, startDate: '2026-10-07', finishDate: '2026-10-08' }));
          auth.updateTasks(moved).then(
            count => setOutcome(`ok:${count}`),
            (error: Error) => setOutcome(`error:${error.message}`),
          );
        }}
      >
        <Text>Apply all date changes</Text>
      </Pressable>
    </View>
  );
}

const text = (screen: ReturnType<typeof render>, id: string) => screen.getByTestId(id).props.children;
const originalBroadcastChannel = globalThis.BroadcastChannel;

beforeAll(() => {
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
});
afterAll(() => {
  globalThis.BroadcastChannel = originalBroadcastChannel;
});

test('A saves, B is refused: the refresh re-reads the cloud and B shows the phone’s revision', async () => {
  cloud.insert('schedule_items', row(item('a'), '2026-09-30T12:00:01.000Z'));
  cloud.insert('schedule_items', row(item('b'), '2026-09-30T12:00:02.000Z'));
  const screen = render(<DesktopAuthProvider><Harness /></DesktopAuthProvider>);
  await waitFor(() => expect(text(screen, 'phase')).toBe('ready'));
  expect(text(screen, 'b')).toBe('2026-10-05||2026-09-30T12:00:02.000Z');

  // The phone moves task B while the web has it open.
  cloud.change('schedule_items', 'b', {
    item_data: item('b', { startDate: '2026-10-12', finishDate: '2026-10-13', notes: 'Moved by phone' }),
    updated_at: '2026-09-30T12:05:00.000Z',
  });
  fireEvent.press(screen.getByTestId('apply-all'));

  await waitFor(() => expect(String(text(screen, 'outcome'))).toMatch(/^error:This task changed on another device/));
  // Task A went through; task B now shows what the phone saved.
  expect(cloud.rows('schedule_items').find(value => value.id === 'a')?.item_data)
    .toMatchObject({ startDate: '2026-10-07' });
  await waitFor(() => expect(text(screen, 'b')).toBe('2026-10-12|Moved by phone|2026-09-30T12:05:00.000Z'));
});
