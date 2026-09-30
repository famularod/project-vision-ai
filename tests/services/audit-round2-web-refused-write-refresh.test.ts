import {
  createDAVEWebSupabaseGateway,
  DAVEWebTaskMutationError,
} from '../../services/DAVEWebSupabaseClient';
import { createFakeWebCloud } from '../fixtures/fake-web-cloud';
import type { ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

// Audit round 2 follow-up (30 Sep 2026): every web task save marks the
// gateway's copy of the schedule as up to date, so the next schedule refresh
// is answered from that copy. A save the cloud refused (another device got
// there first) left that mark in place: "Apply all date changes" saved task A,
// was refused on task B, said "The schedule was refreshed", and still showed
// B as the web had opened it. A refusal now clears the mark, so the next
// refresh reads the cloud again.

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

function cloudWithTwoTasks() {
  const cloud = createFakeWebCloud();
  cloud.insert('schedule_items', row(item('a'), '2026-09-30T12:00:01.000Z'));
  cloud.insert('schedule_items', row(item('b'), '2026-09-30T12:00:02.000Z'));
  return cloud;
}

describe('a refused task save does not leave a stale schedule behind', () => {
  test('A saves, B is refused: the next schedule refresh reads the cloud and shows the phone’s B', async () => {
    const cloud = cloudWithTwoTasks();
    const gateway = createDAVEWebSupabaseGateway(cloud.client as never);
    await gateway.loadAuthorizedRows();

    // The phone moves task B while the web has it open.
    const phoneB = item('b', { startDate: '2026-10-12', finishDate: '2026-10-13', notes: 'Moved by phone' });
    cloud.change('schedule_items', 'b', { item_data: phoneB, updated_at: '2026-09-30T12:05:00.000Z' });

    await gateway.updateAuthorizedScheduleItem(
      item('a', { startDate: '2026-10-07', finishDate: '2026-10-08' }),
      '2026-09-30T12:00:01.000Z',
    );
    await expect(gateway.updateAuthorizedScheduleItem(
      item('b', { startDate: '2026-10-09', finishDate: '2026-10-10' }),
      '2026-09-30T12:00:02.000Z',
    )).rejects.toMatchObject<Partial<DAVEWebTaskMutationError>>({ code: 'conflict' });

    cloud.reads.length = 0;
    const rows = await gateway.loadAuthorizedRows(['schedule_items']);

    expect(cloud.reads).toEqual(['schedule_items']);
    const b = rows.scheduleItems.find(value => (value as { id: string }).id === 'b') as Record<string, any>;
    expect(b.updated_at).toBe('2026-09-30T12:05:00.000Z');
    expect(b.item_data).toMatchObject({ startDate: '2026-10-12', notes: 'Moved by phone' });
    const a = rows.scheduleItems.find(value => (value as { id: string }).id === 'a') as Record<string, any>;
    expect(a.item_data).toMatchObject({ startDate: '2026-10-07' });
  });

  test('a save that went through still answers the next refresh from the saved copy', async () => {
    const cloud = cloudWithTwoTasks();
    const gateway = createDAVEWebSupabaseGateway(cloud.client as never);
    await gateway.loadAuthorizedRows();

    await gateway.updateAuthorizedScheduleItem(
      item('a', { startDate: '2026-10-07', finishDate: '2026-10-08' }),
      '2026-09-30T12:00:01.000Z',
    );
    cloud.reads.length = 0;
    await gateway.loadAuthorizedRows(['schedule_items']);

    expect(cloud.reads).toEqual([]);
  });
});
