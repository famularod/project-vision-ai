jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) }));
import { scheduleItemActivityOfBoth, scheduleItemEditAgainstCloud, scheduleItemEditBase, scheduleItemWholeCopyFieldByField } from '../../services/ScheduleItemEditBase';
import { recentProjectItemActivity } from '../../services/ProjectItemActivityPresentation';
import type { ProjectItemActivity, ScheduleItem } from '../../types';
const entry = (id: string, day: number) => Object.freeze({ id, message: `Authored ${id} $& Élodie`, author: 'PM', createdAt: `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z` }) as ProjectItemActivity;
const old = entry('old', 1), localNote = entry('local', 2), remoteNote = entry('remote', 3);
const row = (activity: readonly ProjectItemActivity[]) => Object.freeze({ id: 'same-task-row', taskName: 'Roof inspection', projectName: 'Juniper House', notes: '', owner: 'PM', percentComplete: 0, activity, updatedAt: '2026-10-01T12:00:00.000Z' }) as unknown as ScheduleItem;
const before = row(Object.freeze([old]));
const local = row(Object.freeze([old, localNote]));
const remote = row(Object.freeze([old, remoteNote]));
const ids = (items: readonly ProjectItemActivity[] | null | undefined) => items?.map(e => e.id);
it('actual field edit caller stores both copies history in date order, without a conflict', () => {
  const result = scheduleItemEditAgainstCloud(local, ['activity'], scheduleItemEditBase(before, ['activity']), remote);
  expect(ids(result.itemData.activity)).toEqual(['old', 'local', 'remote']);
  expect(result.asked).toEqual([]); expect(result.held).toEqual([]); expect(result.keptFromCloud).toEqual([]);
  expect(ids(local.activity)).toEqual(['old', 'local']); expect(ids(remote.activity)).toEqual(['old', 'remote']);
});
it('actual whole-copy field-by-field caller stores both copies history in date order', () => {
  const base = { ...scheduleItemEditBase(before, ['activity'])!, copy: before as unknown as Record<string, unknown> };
  const result = scheduleItemWholeCopyFieldByField(local, base, remote, remote);
  expect(result).not.toBeNull();
  expect(ids(result!.itemData.activity)).toEqual(['old', 'local', 'remote']);
  expect(result!.asked).toEqual([]);
  expect(ids(local.activity)).toEqual(['old', 'local']); expect(ids(remote.activity)).toEqual(['old', 'remote']);
});
it('remote duplicate-id authority and authored object identities survive the merge', () => {
  const obsolete = { ...remoteNote, message: 'Different local wording' };
  const result = scheduleItemActivityOfBoth([old, obsolete], [old, remoteNote]);
  expect(result).toEqual([old, remoteNote]); expect(result[1]).toBe(remoteNote);
});
it('current recent-three presentation already reads chronological dates rather than stored order', () => {
  const joined = scheduleItemActivityOfBoth(local.activity, remote.activity);
  expect(ids(recentProjectItemActivity(joined))).toEqual(['remote', 'local', 'old']);
});
