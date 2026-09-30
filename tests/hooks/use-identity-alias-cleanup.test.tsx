/**
 * Whole-app audit A11 pass 2 (30 Sep 2026): the one-time startup cleanup of
 * Confirm Memory aliases runs once the saved names are loaded, holds the
 * schedule's startup until it finishes, keeps renamed tasks out of Sync Now
 * and lets them back in once the cloud refresh has landed.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useIdentityAliasCleanup } from '../../hooks/use-identity-alias-cleanup';
import { localDAVEIdentityRepository } from '../../services/DAVEIdentityRepository';
import { DAVE_IDENTITY_ALIAS_CLEANUP_STORAGE_KEY } from '../../services/DAVEIdentityAliasCleanup';

jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  return {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
    clear: async () => values.clear(),
  };
});

const PROJECT = '2321 Compliance Project';
const areas = [{ name: 'Level 2 corridor' }, { name: 'Roof' }];
const tasks = [
  { id: 'a', projectName: PROJECT, scheduleProjectName: PROJECT, locationName: 'Roof' },
  { id: 'b', projectName: 'Other Project', scheduleProjectName: 'Other Project', locationName: 'Gate' },
];

function alias(rawName: string, canonicalName: string, confirmedAt: string) {
  return {
    id: `identity:memory-1:location:${confirmedAt}`,
    kind: 'area' as const,
    rawName,
    canonicalName,
    parentProjectName: PROJECT,
    sourceRecordId: 'memory-1',
    confirmedAt,
    confirmedBy: 'Project manager',
  };
}

beforeEach(async () => {
  await (AsyncStorage as unknown as { clear: () => Promise<void> }).clear();
  await localDAVEIdentityRepository.save(alias('Level 2 corridor', 'Roof', '2026-09-30T12:00:00.000Z'));
  await localDAVEIdentityRepository.save(alias('Pump Hse', 'Pump House', '2026-09-30T12:01:00.000Z'));
});

test('cleans once when ready, gates Sync Now until the schedule refresh lands', async () => {
  const onCorrections = jest.fn();
  const hook = await renderHook(
    ({ ready }: { ready: boolean }) => useIdentityAliasCleanup({
      retryAttempt: 0, ready, projectNames: [PROJECT], projectAreas: areas,
      scheduleItems: tasks, onCorrections,
    }),
    { initialProps: { ready: false } },
  );
  expect(hook.result.current.done).toBe(false);
  expect((await localDAVEIdentityRepository.list())).toHaveLength(2);

  hook.rerender({ ready: true });
  await waitFor(() => expect(hook.result.current.done).toBe(true));
  expect(onCorrections).toHaveBeenCalledWith([expect.objectContaining({ rawName: 'Pump Hse' })]);
  expect((await localDAVEIdentityRepository.list()).map(item => item.rawName)).toEqual(['Pump Hse']);
  expect(hook.result.current.scheduleItemsForFullSync.map(item => item.id)).toEqual(['b']);

  act(() => hook.result.current.markScheduleRefreshed());
  expect(hook.result.current.scheduleItemsForFullSync).toBe(tasks);
  await waitFor(async () => {
    const marker = JSON.parse(await AsyncStorage.getItem(DAVE_IDENTITY_ALIAS_CLEANUP_STORAGE_KEY) || '{}');
    expect(marker.awaitingScheduleRefresh).toEqual([]);
  });
});
