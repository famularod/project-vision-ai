import React, { type ReactNode } from 'react';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { act, renderHook } from '@testing-library/react-native';
import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { clearScheduleProgressDraftsForTests, unusedScheduleProgressDraftExists, unusedScheduleVerificationNoteExists, useScheduleProgressDraft } from '../../hooks/use-schedule-progress-draft';
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
  act(() => hook.result.current[1](() => ({ status: percent === 100 ? 'Complete' : 'In Progress', percentComplete: percent })));
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

it('a staged Complete status stays in its workspace and does not complete the other account task', () => {
  stage(first, 100);
  expect(shown(second)).toEqual(saved);
  expect(shown(first)).toEqual({ status: 'Complete', percentComplete: 100 });
});
it('changing the saved value drops only that account draft, without touching the other account', () => {
  stage(first, 60); stage(second, 80);
  const hook = row(first, 'shared-task', { status: 'Complete', percentComplete: 100 });
  expect(hook.result.current[0]).toEqual({ status: 'Complete', percentComplete: 100 });
  hook.unmount();
  expect(shown(first)).toEqual(saved);
  expect(shown(second).percentComplete).toBe(80);
});
it('a callback from the prior workspace cannot write using the next workspace saved value', () => {
  let owner = first;
  const hook = renderHook(() => useScheduleProgressDraft('shared-task', saved), {
    wrapper: ({ children }: { children: ReactNode }) => <NativeWorkspaceOwnerContext.Provider value={owner}>{children}</NativeWorkspaceOwnerContext.Provider>,
  });
  act(() => hook.result.current[1](() => ({ status: 'In Progress', percentComplete: 60 })));
  const previousCallback = hook.result.current[1];
  owner = second; hook.rerender(undefined);
  act(() => previousCallback(() => ({ status: 'Complete', percentComplete: 100 })));
  expect(hook.result.current[0]).toEqual(saved);
  expect(shown(first).percentComplete).toBe(60);
  hook.unmount();
});
it.each([false, true])('an old callback cannot revive a discarded draft after Settings Sign Out (unmounted=%s)', unmounted => {
  const hook = row(first);
  act(() => hook.result.current[1](() => ({ status: 'In Progress', percentComplete: 60 })));
  const oldStage = hook.result.current[1];
  if (unmounted) hook.unmount();
  noteSignOutAskedHere(first);
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', undefined, null));
  act(() => oldStage(() => ({ status: 'Complete', percentComplete: 100 })));
  expect(shown(first)).toEqual(saved);
  if (!unmounted) hook.unmount();
});
it('outside a workspace an immediate known sign-in owns the draft; an account switch preserves both accounts independently', () => {
  stage(undefined, 60);
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, first));
  expect(shown().percentComplete).toBe(60);
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', first, second));
  expect(shown()).toEqual(saved);
  stage(undefined, 80);
  expect(shown(first).percentComplete).toBe(60);
  expect(shown(second).percentComplete).toBe(80);
});
it.each([undefined, first])('a fallback callback retained before an unexpected sign-out cannot create a draft for the next account (previous=%s)', previous => {
  const hook = row();
  act(() => hook.result.current[1](() => ({ status: 'In Progress', percentComplete: 60 })));
  const late = hook.result.current[1];
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', previous, null));
  act(() => late(() => ({ status: 'Complete', percentComplete: 100 })));
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, second));
  expect(hook.result.current[0]).toEqual(saved);
  expect(shown(second)).toEqual(saved);
  expect(shown(first)).toEqual(previous ? { status: 'In Progress', percentComplete: 60 } : saved);
  hook.unmount();
});
it('an empty unknown fallback is fenced at sign-out and its new callback remains usable', () => {
  const hook = row();
  const old = hook.result.current[1];
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', undefined, null));
  act(() => old(() => ({ status: 'Complete', percentComplete: 100 })));
  expect(hook.result.current[0]).toEqual(saved);
  act(() => hook.result.current[1](() => ({ status: 'In Progress', percentComplete: 80 })));
  expect(hook.result.current[0].percentComplete).toBe(80);
  hook.unmount();
});
it.each([undefined, first])('a mounted empty draft receives a usable new callback after deliberate discard (owner=%s)', owner => {
  const hook = row(owner);
  const old = hook.result.current[1];
  noteSignOutAskedHere(owner || first);
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', undefined, null));
  act(() => old(() => ({ status: 'Complete', percentComplete: 100 })));
  expect(hook.result.current[0]).toEqual(saved);
  act(() => hook.result.current[1](() => ({ status: 'In Progress', percentComplete: 80 })));
  expect(hook.result.current[0].percentComplete).toBe(80);
  hook.unmount();
});
it('a named fallback callback from before an unasked sign-out stays fenced when its account returns', () => {
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, first));
  const hook = row();
  act(() => hook.result.current[1](() => ({ status: 'In Progress', percentComplete: 60 })));
  const old = hook.result.current[1];
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', first, null));
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, first));
  act(() => old(() => ({ status: 'Complete', percentComplete: 100 })));
  expect(hook.result.current[0].percentComplete).toBe(60);
  act(() => hook.result.current[1](() => ({ status: 'In Progress', percentComplete: 80 })));
  expect(hook.result.current[0].percentComplete).toBe(80);
  hook.unmount();
});
it('an old named fallback callback stays fenced across a direct switch and return without a sign-out event', () => {
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, first));
  const hook = row();
  act(() => hook.result.current[1](() => ({ status: 'In Progress', percentComplete: 60 })));
  const old = hook.result.current[1];
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', first, second));
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', second, first));
  act(() => old(() => ({ status: 'Complete', percentComplete: 100 })));
  expect(hook.result.current[0].percentComplete).toBe(60);
  expect(shown(second)).toEqual(saved);
  hook.unmount();
});
it('the actual Settings sign-out producer names only the selected account unsaved status and percent', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../screens/AdminScreen.tsx'), 'utf8');
  const tree = ts.createSourceFile('AdminScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let node: ts.FunctionDeclaration | undefined;
  const visit = (child: ts.Node) => { if (ts.isFunctionDeclaration(child) && child.name?.text === 'handleSignOut') node = child; ts.forEachChild(child, visit); };
  visit(tree); expect(node).toBeDefined();
  const code = ts.transpileModule(`const extracted = ${node!.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  async function warning(account: string) {
    const alert = jest.fn();
    const deps = { fieldNoteOwnerKey: account, fieldNotesWaitingToSync: async () => 0, unsavedFieldNoteExists: async () => false, unsavedWalkMemoryExists: async () => false, fieldNotesNeedingReview: async () => 0, keptVoiceRecordingExists: async () => false, pendingSyncCount: 0, updateSyncAttentionCount: 0, failedDocumentCount: 0, unusedScheduleVerificationNoteExists, unusedScheduleProgressDraftExists, signOutNotInCloudSentences: () => '', SIGN_OUT_CHOICES: 'Device or all devices', Alert: { alert }, performSignOut: jest.fn() };
    await new Function(...Object.keys(deps), code + ';return extracted;')(...Object.values(deps))();
    return String(alert.mock.calls[0][1]);
  }
  stage(first, 60);
  expect(unusedScheduleProgressDraftExists(first)).toBe(true);
  expect(unusedScheduleProgressDraftExists(second)).toBe(false);
  expect(await warning(first)).toContain('The task status and percent changes you have not saved will be discarded.');
  expect(await warning(second)).not.toContain('task status and percent');
  noteSignOutAskedHere(first);
  act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', undefined, null));
  expect(await warning(first)).not.toContain('task status and percent');
});
