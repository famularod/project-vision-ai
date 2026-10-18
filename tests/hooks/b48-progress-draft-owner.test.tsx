import React, { type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { clearScheduleProgressDraftsForTests, useScheduleProgressDraft } from '../../hooks/use-schedule-progress-draft';
import { forgetSetAsideAccount, settleUnsavedDraftsOnAccountChange } from '../../hooks/unsaved-drafts-on-account-change';
import { clearSignOutAskedHere, noteSignOutAskedHere } from '../../services/SignOutIntent';
import type { CanonicalScheduleProgress } from '../../services/ScheduleProgressInvariant';

jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  const api = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); }, removeItem: async (key: string) => { values.delete(key); }, getAllKeys: async () => [...values.keys()], multiRemove: async (keys: string[]) => { keys.forEach(key => values.delete(key)); } };
  return { __esModule: true, default: api, ...api };
});
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///documents/', cacheDirectory: 'file:///cache/', getInfoAsync: jest.fn(async () => ({ exists: false })), makeDirectoryAsync: jest.fn(async () => undefined), copyAsync: jest.fn(async () => undefined), deleteAsync: jest.fn(async () => undefined), readDirectoryAsync: jest.fn(async () => []) }));

const saved: CanonicalScheduleProgress = { status: 'In Progress', percentComplete: 40 };
const first = 'owner-first', second = 'owner-second';
function row(owner?: string | null, task = 'shared-task', committed = saved) {
  return renderHook(() => useScheduleProgressDraft(task, committed), owner === undefined ? undefined : {
    wrapper: ({ children }: { children: ReactNode }) => <NativeWorkspaceOwnerContext.Provider value={owner}>{children}</NativeWorkspaceOwnerContext.Provider>,
  });
}
function stage(owner: string | null | undefined, percent: number) {
  const hook = row(owner);
  act(() => hook.result.current[1](() => ({ status: 'In Progress', percentComplete: percent })));
  hook.unmount();
}
function shown(owner?: string | null) { const hook = row(owner); const result = hook.result.current[0]; hook.unmount(); return result; }
beforeEach(() => { clearSignOutAskedHere(); forgetSetAsideAccount(); });
afterEach(() => act(() => clearScheduleProgressDraftsForTests()));

it('4.29 another account with the same task ID never reads the first account staged percent or status', () => {
  stage(first, 60);
  expect(shown(second)).toEqual(saved);
  expect(shown(first)).toEqual({ status: 'In Progress', percentComplete: 60 });
});
it('4.29 each account retains its own edit independently, including an offline workspace before a sign-in event', () => {
  stage(first, 60); stage(second, 80);
  expect(shown(first).percentComplete).toBe(60);
  expect(shown(second).percentComplete).toBe(80);
});
it('4.29 requested Settings Sign Out discards only the named account draft', () => {
  stage(first, 60); stage(second, 80);
  noteSignOutAskedHere(first);
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', undefined, null));
  expect(shown(first)).toEqual(saved);
  expect(shown(second).percentComplete).toBe(80);
});
it('an unasked sign-out keeps the first account draft for that account while the next account sees its saved task', () => {
  stage(first, 60);
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', undefined, null));
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, second));
  expect(shown(second)).toEqual(saved);
  expect(shown(first).percentComplete).toBe(60);
});
it('a draft with no workspace and no known account cannot be handed to whoever signs in after an unasked sign-out', () => {
  stage(undefined, 60);
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', undefined, null));
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, second));
  expect(shown()).toEqual(saved);
});
it('the explicit local-device workspace never shares draft values with a signed-in account', () => {
  stage(null, 60);
  expect(shown(second)).toEqual(saved);
  expect(shown(null).percentComplete).toBe(60);
});
