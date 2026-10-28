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

const at = (id: string, createdAt: string) => Object.freeze({ id, createdAt, message: `Keep ${id} $& Élodie`, author: 'PM' }) as ProjectItemActivity;
const goldens = [
  { name: 'unordered histories retain all dated entries', local: [entry('d', 4), entry('b', 2)], remote: [entry('e', 5), entry('a', 1), entry('c', 3)], expected: ['a', 'b', 'c', 'd', 'e'] },
  { name: 'equal instants retain cloud then local encounter order', local: [at('local-tie', '2026-10-18T03:00:00-07:00'), at('later', '2026-10-18T12:00:00Z')], remote: [at('cloud-tie', '2026-10-18T10:00:00Z'), at('earlier', '2026-10-18T08:00:00Z')], expected: ['earlier', 'cloud-tie', 'local-tie', 'later'] },
  { name: 'unknown dates use the existing other-row zero-time policy with stable ties', local: [at('invalid', 'not-a-date'), at('pre-epoch', '1960-01-01T00:00:00Z')], remote: [at('missing', ''), at('later', '2026-10-18T12:00:00Z')], expected: ['pre-epoch', 'missing', 'invalid', 'later'] },
];
it.each(goldens.flatMap(golden => (['field', 'whole-copy'] as const).map(mode => ({ ...golden, mode }))))('$mode caller: $name', golden => {
  const ours = row(Object.freeze(golden.local)), cloud = row(Object.freeze(golden.remote)), empty = row(Object.freeze([]));
  const base = { ...scheduleItemEditBase(empty, ['activity'])!, copy: empty as unknown as Record<string, unknown> };
  const result = golden.mode === 'field' ? scheduleItemEditAgainstCloud(ours, ['activity'], base, cloud) : scheduleItemWholeCopyFieldByField(ours, base, cloud, cloud);
  expect(result).not.toBeNull(); expect(ids(result!.itemData.activity)).toEqual(golden.expected); expect(result!.asked).toEqual([]);
  expect(result!.itemData.updatedAt).toBe(cloud.updatedAt);
  const originals = [...golden.remote, ...golden.local];
  result!.itemData.activity!.forEach(note => expect(note).toBe(originals.find(original => original.id === note.id)));
});
it('duplicate-id authority uses the entire cloud record including its timestamp', () => {
  const cloud = at('same', '2026-10-02T12:00:00Z'), ours = { ...cloud, message: 'Obsolete local version', createdAt: '2099-01-01T00:00:00Z' };
  const result = scheduleItemActivityOfBoth([ours, entry('third', 3)], [cloud, old]);
  expect(ids(result)).toEqual(['old', 'same', 'third']); expect(result[1]).toBe(cloud);
});
it('repeated delivery is value-idempotent and retains authored object identity', () => {
  const once = scheduleItemActivityOfBoth(local.activity, remote.activity);
  const again = scheduleItemActivityOfBoth(once, remote.activity);
  expect(again).toEqual(once); again.forEach((note, index) => expect(note).toBe(once[index]));
  expect(ids(again)).toEqual(['old', 'local', 'remote']);
});
it('unchanged edits do not rewrite activity or ask a question', () => {
  const base = { ...scheduleItemEditBase(remote, ['activity'])!, copy: remote as unknown as Record<string, unknown> };
  const field = scheduleItemEditAgainstCloud(remote, ['activity'], base, remote);
  expect(field.itemData).toBe(remote); expect(field.asked).toEqual([]);
  const whole = scheduleItemWholeCopyFieldByField(remote, base, remote, remote);
  expect(whole!.itemData.activity).toBe(remote.activity); expect(whole!.asked).toEqual([]);
});
it('legacy edits without a base retain their existing authority path', () => {
  expect(scheduleItemEditAgainstCloud(local, ['activity'], undefined, remote).itemData).toBe(local);
  expect(scheduleItemWholeCopyFieldByField(local, undefined, remote, remote)).toBeNull();
});
it('empty or absent lists stay empty without inventing entries', () => {
  expect(scheduleItemActivityOfBoth(undefined, null)).toEqual([]);
  expect(scheduleItemActivityOfBoth([], [])).toEqual([]);
});
