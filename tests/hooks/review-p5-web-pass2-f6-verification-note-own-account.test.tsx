import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { NativeWorkspaceOwnerContext } from '../../components/native-workspace-owner';
import { forgetSetAsideAccount, settleUnsavedDraftsOnAccountChange } from '../../hooks/unsaved-drafts-on-account-change';
import {
  clearScheduleProgressDraftsForTests,
  unusedScheduleVerificationNoteExists,
  useScheduleVerificationNoteDraft,
} from '../../hooks/use-schedule-progress-draft';
import { clearSignOutAskedHere, noteSignOutAskedHere } from '../../services/SignOutIntent';
import type { DAVECompletionVerification } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => {
  const kept = new Map<string, string>();
  const api = {
    getItem: async (key: string) => kept.get(key) ?? null,
    setItem: async (key: string, value: string) => { kept.set(key, value); },
    removeItem: async (key: string) => { kept.delete(key); },
    getAllKeys: async () => [...kept.keys()],
    multiRemove: async (keys: string[]) => { keys.forEach(key => kept.delete(key)); },
  };
  return { __esModule: true, default: api, ...api };
});
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(async () => ({ exists: false, size: 0 })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  readDirectoryAsync: jest.fn(async () => []),
}));

// Second review of the web area, F6 (7 Oct 2026; caused by the fix for review pass 1, L8). A verification
// note typed before the app had heard which account is signed in, whose sign-in then ended unasked, was set
// aside for "whoever signs in next". The next account's Sign Out warning then named a note that account never
// typed, and its Sign Out discarded the first account's note.
//
// A kept verification note belongs to the account that typed it. On the phone a task row is only ever drawn
// inside one account's workspace (entry.ts opens the app for one account at a time), so the note takes that
// account as it is typed: whether the app has heard a sign-in event yet no longer matters. It is never named
// in, shown to or discarded by another account, and the first account finds it again in its own workspace.
// The whole-app test of it is tests/review-p5-web-pass2-f6-verification-note-whole-app.test.tsx.

const FIRST = 'owner-first';
const SECOND = 'owner-second';
const NOTE = 'Looks done from the lift';

function reportOf(reportedAt: string, decidedBefore = 0): DAVECompletionVerification {
  return {
    status: 'reported_complete',
    reportedAt,
    reportedBy: 'Crew lead',
    priorScheduleStatus: 'In Progress',
    priorPercentComplete: 80,
    verifiedAt: null,
    verifiedBy: null,
    verificationNote: null,
    evidence: [
      { id: 'completion-evidence:email:0', kind: 'email', sourceRecordId: 'record-0', sourceName: 'Crew lead', summary: 'Level 2 framing is complete.', recordedAt: reportedAt },
      ...Array.from({ length: decidedBefore }, (_unused, index) => ({
        id: `completion-evidence:pm_note:${index}`, kind: 'pm_note' as const, sourceRecordId: `decision-${index}`, sourceName: 'Manager', summary: 'Not complete.', recordedAt: reportedAt,
      })),
    ],
  };
}
const MONDAY = reportOf('2026-10-05T15:00:00.000Z');

/** A task row drawn inside `owner`'s workspace, as every task row on the phone is; null: a row with no workspace around it. */
const rowIn = (owner: string | null, taskId = 'task-1', report: DAVECompletionVerification | null = MONDAY) =>
  renderHook(() => useScheduleVerificationNoteDraft(taskId, report), owner === null ? undefined : {
    wrapper: ({ children }: { children: ReactNode }) => (
      <NativeWorkspaceOwnerContext.Provider value={owner}>{children}</NativeWorkspaceOwnerContext.Provider>
    ),
  });
/** The note is typed on the task's row, and the row goes away (another tab). */
const types = (owner: string | null, text: string, taskId = 'task-1', report: DAVECompletionVerification | null = MONDAY) => {
  const row = rowIn(owner, taskId, report);
  act(() => row.result.current[1](text));
  row.unmount();
};
const fieldShows = (owner: string | null, taskId = 'task-1', report: DAVECompletionVerification | null = MONDAY) => {
  const row = rowIn(owner, taskId, report);
  const shown = row.result.current[0];
  row.unmount();
  return shown;
};
/** The app hears a sign-out; `heardBefore` is the account it had heard was signed in (undefined: none yet). */
const hearsSignOut = (heardBefore?: string) => act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', heardBefore, null));
/** Settings' Sign Out, confirmed after its warning, for the account Settings shows; then the app hears it. */
const signsOutThroughSettings = (account: string, heardBefore?: string) => {
  noteSignOutAskedHere(account);
  hearsSignOut(heardBefore);
};

beforeEach(() => {
  forgetSetAsideAccount();
  clearSignOutAskedHere();
});
afterEach(() => act(() => clearScheduleProgressDraftsForTests()));

describe('second review, web F6: on the phone, where every task row is drawn in one account’s workspace', () => {
  it('typed before the app had heard which account is signed in, and that sign-in ends unasked: the next account’s Sign Out warning names no note, it is shown none, and its Sign Out discards none; the first account finds it again', () => {
    types(FIRST, NOTE);
    hearsSignOut(undefined);

    // The second account signs in: the phone opens the app afresh for it.
    expect(unusedScheduleVerificationNoteExists(SECOND)).toBe(false);
    expect(fieldShows(SECOND)).toBe('');
    signsOutThroughSettings(SECOND);

    // The first account signs in again.
    expect(fieldShows(FIRST)).toBe(NOTE);
    expect(unusedScheduleVerificationNoteExists(FIRST)).toBe(true);
  });

  it('…the same when one open app hears the sign-out and then the second account’s sign-in (the order the reviewer’s rig calls)', () => {
    types(FIRST, NOTE);
    hearsSignOut(undefined);
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, SECOND));

    expect(unusedScheduleVerificationNoteExists(SECOND)).toBe(false);
    expect(unusedScheduleVerificationNoteExists()).toBe(false);
    expect(fieldShows(SECOND)).toBe('');
    signsOutThroughSettings(SECOND, SECOND);
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, FIRST));

    expect(fieldShows(FIRST)).toBe(NOTE);
  });

  it('with the account heard, a sign-in that ended unasked, and the app opened afresh when that account signs in again: the note is back in its field, and its own warning names it', () => {
    types(FIRST, NOTE);
    hearsSignOut(FIRST);
    // Nothing tells a freshly opened app "this account signed in": its first sign-in event is not a change of account.

    expect(fieldShows(FIRST)).toBe(NOTE);
    expect(unusedScheduleVerificationNoteExists(FIRST)).toBe(true);
  });

  it('the first account’s own Settings Sign Out, whose warning names the note, discards it: also a note typed before its sign-in had ended unasked once', () => {
    types(FIRST, NOTE);
    hearsSignOut(undefined);
    expect(unusedScheduleVerificationNoteExists(FIRST)).toBe(true);

    signsOutThroughSettings(FIRST);

    expect(unusedScheduleVerificationNoteExists(FIRST)).toBe(false);
    expect(fieldShows(FIRST)).toBe('');
  });

  it('two accounts with a task of the same id each have their own note: typing, clearing and Sign Out in one never touch the other’s', () => {
    types(FIRST, NOTE);
    hearsSignOut(FIRST);

    types(SECOND, 'The second account’s own note');
    expect(fieldShows(SECOND)).toBe('The second account’s own note');
    expect(fieldShows(FIRST)).toBe(NOTE);
    // Confirm Completed in the second account's row uses its note and clears its field.
    types(SECOND, '');
    expect(fieldShows(FIRST)).toBe(NOTE);
    types(SECOND, 'Typed again');
    signsOutThroughSettings(SECOND, SECOND);

    expect(fieldShows(SECOND)).toBe('');
    expect(fieldShows(FIRST)).toBe(NOTE);
  });

  it('a note is dropped for a settled report only by a row of its own account: another account’s row of a task with the same id leaves it', () => {
    types(FIRST, NOTE);
    hearsSignOut(FIRST);
    // The second account's task of that id awaits another report, then none.
    expect(fieldShows(SECOND, 'task-1', reportOf('2026-10-06T16:30:00.000Z', 1))).toBe('');
    expect(fieldShows(SECOND, 'task-1', null)).toBe('');

    expect(fieldShows(FIRST)).toBe(NOTE);
    // In its own workspace the rule is unchanged: drawn for another report, it is dropped.
    expect(fieldShows(FIRST, 'task-1', reportOf('2026-10-06T16:30:00.000Z', 1))).toBe('');
    expect(fieldShows(FIRST)).toBe('');
  });

  it('guard: Settings’ Sign Out before the app has heard the account still discards the note its warning named (open item W1-6)', () => {
    types(FIRST, NOTE);
    expect(unusedScheduleVerificationNoteExists(FIRST)).toBe(true);

    signsOutThroughSettings(FIRST);

    expect(fieldShows(FIRST)).toBe('');
  });
});

describe('second review, web F6: the rule called with no workspace around the row (the reviewer’s rig)', () => {
  it('his case: the next account’s warning names no note (it typed none); the app was never told whose the note was, so it is dropped when that sign-in ends, and no account is shown it', () => {
    types(null, NOTE);
    hearsSignOut(undefined);
    expect(unusedScheduleVerificationNoteExists()).toBe(false);
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, SECOND));

    expect(unusedScheduleVerificationNoteExists()).toBe(false);
    expect(unusedScheduleVerificationNoteExists(SECOND)).toBe(false);
    expect(fieldShows(null)).toBe('');
    signsOutThroughSettings(SECOND, SECOND);
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, FIRST));

    // Not handed to whoever came next, and not kept where nobody could ever be given it.
    expect(fieldShows(null)).toBe('');
    expect(unusedScheduleVerificationNoteExists()).toBe(false);
  });

  it('typed before the app knew the account, and the app then hears which account it is (no sign-out in between): the note is that account’s from then on, not the next one’s', () => {
    types(null, NOTE);
    // The app learns the account.
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, FIRST));
    expect(fieldShows(null)).toBe(NOTE);
    hearsSignOut(FIRST);
    // Nobody is signed in: nothing shows it, and no warning names it.
    expect(fieldShows(null)).toBe('');
    expect(unusedScheduleVerificationNoteExists()).toBe(false);
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, SECOND));

    expect(unusedScheduleVerificationNoteExists()).toBe(false);
    expect(fieldShows(null)).toBe('');
    signsOutThroughSettings(SECOND, SECOND);
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, FIRST));

    expect(fieldShows(null)).toBe(NOTE);
    expect(unusedScheduleVerificationNoteExists()).toBe(true);
  });

  it('guard (his control): the app knew the first account; the second signs in and out; the first account’s note is back', () => {
    types(null, NOTE);
    hearsSignOut(FIRST);
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, SECOND));
    expect(unusedScheduleVerificationNoteExists()).toBe(false);
    signsOutThroughSettings(SECOND, SECOND);
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, FIRST));

    expect(fieldShows(null)).toBe(NOTE);
  });

  it('guard: a note the second account types while signed in is its own: its Sign Out discards that one and leaves the first account’s', () => {
    types(null, NOTE);
    hearsSignOut(FIRST);
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, SECOND));
    types(null, 'The second account’s own note', 'task-9');
    expect(unusedScheduleVerificationNoteExists()).toBe(true);

    signsOutThroughSettings(SECOND, SECOND);
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, FIRST));

    expect(fieldShows(null)).toBe(NOTE);
    expect(fieldShows(null, 'task-9')).toBe('');
  });
});
