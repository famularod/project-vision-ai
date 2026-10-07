import { act, renderHook } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';

import { forgetSetAsideAccount, settleUnsavedDraftsOnAccountChange } from '../../hooks/unsaved-drafts-on-account-change';
import {
  clearScheduleProgressDraftsForTests,
  unusedScheduleVerificationNoteExists,
  useScheduleVerificationNoteDraft,
} from '../../hooks/use-schedule-progress-draft';
import { clearSignOutAskedHere, noteSignOutAskedHere } from '../../services/SignOutIntent';
import type { DAVECompletionEvidence, DAVECompletionVerification } from '../../types';

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

// Batch W1, item 7 (6 Oct 2026). The optional note under a task's "Verify
// completion" was left out when the text typed on a task was made to survive
// the task closing: it lived in the task row, so anything that took the row
// away dropped it (a tab switch, or the Capture Verification Photo button
// right under it). It is now kept by task id until Confirm Completed or Not
// Complete uses it. The whole-app test of it is in
// tests/app-typed-text-survives-navigation.test.tsx.

const app = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8');

const evidence = (kind: DAVECompletionEvidence['kind'], index: number): DAVECompletionEvidence => ({
  id: `completion-evidence:${kind}:${index}`,
  kind,
  sourceRecordId: `record-${index}`,
  sourceName: kind === 'photo' ? 'Field update' : 'Crew lead',
  summary: 'Level 2 framing is complete.',
  recordedAt: '2026-10-05T15:00:00.000Z',
});
/**
 * A completion report awaiting verification (synthetic): when it was
 * reported, how many times this task's completion had been decided before
 * it (each Confirm Completed or Not Complete adds one), and how many photos
 * have been added to it since.
 */
function reportOf(reportedAt: string, { decidedBefore = 0, photos = 0 }: { decidedBefore?: number; photos?: number } = {}): DAVECompletionVerification {
  return {
    status: photos > 0 ? 'evidence_supported' : 'reported_complete',
    reportedAt,
    reportedBy: 'Crew lead',
    priorScheduleStatus: 'In Progress',
    priorPercentComplete: 80,
    verifiedAt: null,
    verifiedBy: null,
    verificationNote: null,
    evidence: [
      evidence('email', 0),
      ...Array.from({ length: decidedBefore }, (_unused, index) => evidence('pm_note', index + 1)),
      ...Array.from({ length: photos }, (_unused, index) => evidence('photo', index + 100)),
    ],
  };
}
/** The report the crew sent on Monday morning; the tests' first report. */
const MONDAY = reportOf('2026-10-05T15:00:00.000Z');

describe('the optional verification note is kept by task until it is used', () => {
  // Clearing tells rows still on screen: inside act (the release gate fails on "not wrapped in act").
  afterEach(() => act(() => clearScheduleProgressDraftsForTests()));

  it('survives the row going away and coming back, and each task has its own', () => {
    const row = renderHook(
      (props: { id: string }) => useScheduleVerificationNoteDraft(props.id, MONDAY),
      { initialProps: { id: 'task-1' } },
    );
    act(() => row.result.current[1]('Walked level 2 with the foreman'));
    expect(row.result.current[0]).toBe('Walked level 2 with the foreman');
    // Another task shown in the same place has none of it.
    row.rerender({ id: 'task-2' });
    expect(row.result.current[0]).toBe('');
    row.unmount();

    expect(renderHook(() => useScheduleVerificationNoteDraft('task-1', MONDAY)).result.current[0]).toBe('Walked level 2 with the foreman');
    expect(renderHook(() => useScheduleVerificationNoteDraft('task-2', MONDAY)).result.current[0]).toBe('');
  });

  it('Confirm Completed and Not Complete clear it (they set it to nothing once it is used)', () => {
    const row = renderHook(() => useScheduleVerificationNoteDraft('task-1', MONDAY));
    act(() => row.result.current[1]('Punch list item 4 still open'));
    act(() => row.result.current[1](''));
    row.unmount();

    expect(renderHook(() => useScheduleVerificationNoteDraft('task-1', MONDAY)).result.current[0]).toBe('');
  });

  it('a note typed for a completion report that was settled meanwhile (on another device) is dropped, and does not come back for a later report', () => {
    const row = renderHook(
      (props: { awaiting: boolean }) => useScheduleVerificationNoteDraft('task-1', props.awaiting ? MONDAY : null),
      { initialProps: { awaiting: true } },
    );
    act(() => row.result.current[1]('Looks done from the lift'));
    // The other device confirmed it: this row no longer asks for verification.
    row.rerender({ awaiting: false });
    expect(row.result.current[0]).toBe('');
    // Reported complete again later: an empty field, not the old note.
    row.rerender({ awaiting: true });
    expect(row.result.current[0]).toBe('');
  });

  it('guard: while the task still awaits verification, the row drawing again changes nothing', () => {
    const row = renderHook(
      (props: { awaiting: boolean }) => useScheduleVerificationNoteDraft('task-1', props.awaiting ? MONDAY : null),
      { initialProps: { awaiting: true } },
    );
    act(() => row.result.current[1]('Looks done from the lift'));
    row.rerender({ awaiting: true });
    expect(row.result.current[0]).toBe('Looks done from the lift');
  });

  it('the task row uses it, for its own task, while the task awaits verification', () => {
    const row = app.slice(app.indexOf('\nfunction ScheduleItemRow('), app.indexOf('\n  async function saveTaskChanges()', app.indexOf('\nfunction ScheduleItemRow(')));
    // Review pass 1, L8: it is given the completion report itself, so the note is kept for that report.
    expect(row).toContain('const [verificationNote, setVerificationNote] = useScheduleVerificationNoteDraft(item.id, needsCompletionVerification ? item.completionVerification : null);');
    expect(row).not.toContain("const [verificationNote, setVerificationNote] = useState('');");
  });
});

// Review pass 1 of the web area, L8 (6 Oct 2026; caused by open item W1-7). The note was kept by task id
// only, and dropped only when a row of that task was drawn while the task awaited no verification. Typed for
// one completion report, with that report settled on another device and the task reported complete again
// while its row was off screen, it opened in the field for the NEW report. Settings' Sign Out did not drop
// it either. It is now kept for the report it was typed about, and a sign-out treats it as it treats the
// unsaved field note: Settings' Sign Out (which names it in its warning) discards it; a sign-out not asked
// for sets it aside for its account.
describe('review pass 1, L8: the verification note is for the completion report it was typed about', () => {
  const DAVID = 'owner-david';
  const OTHER = 'owner-other';
  /** A row of the task as it is drawn for a report (null: the task awaits no verification). */
  const rowFor = (report: DAVECompletionVerification | null, taskId = 'task-1') =>
    renderHook(() => useScheduleVerificationNoteDraft(taskId, report));
  /** He types the note on the task's row and leaves the Tasks tab: the row is gone. */
  const typesThenLeaves = (text: string, report: DAVECompletionVerification = MONDAY, taskId = 'task-1') => {
    const row = rowFor(report, taskId);
    act(() => row.result.current[1](text));
    row.unmount();
  };
  const whatTheFieldShows = (report: DAVECompletionVerification | null, taskId = 'task-1') => {
    const row = rowFor(report, taskId);
    const shown = row.result.current[0];
    row.unmount();
    return shown;
  };

  beforeEach(() => {
    forgetSetAsideAccount();
    clearSignOutAskedHere();
  });
  afterEach(() => act(() => clearScheduleProgressDraftsForTests()));

  it('the report is turned down on another device and the task is reported complete again while its row is off screen: the field for the NEW report is empty', () => {
    typesThenLeaves('Looks done from the lift');
    // Not Complete on the other device, then a new report from the crew on Tuesday. No row of the task was drawn in between.
    const tuesday = reportOf('2026-10-06T16:30:00.000Z', { decidedBefore: 1 });

    expect(whatTheFieldShows(tuesday)).toBe('');
    // And it does not come back: it was dropped when the row was drawn, not just hidden.
    expect(unusedScheduleVerificationNoteExists()).toBe(false);
    expect(whatTheFieldShows(MONDAY)).toBe('');
  });

  it('the same message is brought in again after Not Complete (the same time and sender): it is another report, because the task’s completion has been decided once since', () => {
    typesThenLeaves('Looks done from the lift');

    expect(whatTheFieldShows(reportOf(MONDAY.reportedAt, { decidedBefore: 1 }))).toBe('');
  });

  it('a newer report takes the place of one still unanswered: the note for the older one does not open in it', () => {
    typesThenLeaves('Looks done from the lift');

    expect(whatTheFieldShows(reportOf('2026-10-06T16:30:00.000Z'))).toBe('');
  });

  it('guard: photos added to the report while it still awaits an answer leave it the same report: the note is still there', () => {
    typesThenLeaves('Looks done from the lift');

    expect(whatTheFieldShows(reportOf(MONDAY.reportedAt, { photos: 2 }))).toBe('Looks done from the lift');
    expect(unusedScheduleVerificationNoteExists()).toBe(true);
  });

  it('guard: nothing is kept for a task that awaits no verification', () => {
    const row = rowFor(null);
    act(() => row.result.current[1]('typed where no report is'));
    row.unmount();

    expect(unusedScheduleVerificationNoteExists()).toBe(false);
    expect(whatTheFieldShows(MONDAY)).toBe('');
  });

  it('Settings’ Sign Out, after its warning, discards it: it is not back when he signs in again', () => {
    typesThenLeaves('Looks done from the lift');
    expect(unusedScheduleVerificationNoteExists()).toBe(true);

    noteSignOutAskedHere(DAVID);
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', DAVID, null));
    expect(unusedScheduleVerificationNoteExists()).toBe(false);
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, DAVID));

    expect(whatTheFieldShows(MONDAY)).toBe('');
  });

  it('a sign-out he did not ask for sets it aside for his account: nothing shows it meanwhile, and it is back when he signs in again', () => {
    typesThenLeaves('Looks done from the lift');

    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', DAVID, null));
    expect(whatTheFieldShows(MONDAY)).toBe('');
    expect(unusedScheduleVerificationNoteExists()).toBe(false);
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, DAVID));

    expect(whatTheFieldShows(MONDAY)).toBe('Looks done from the lift');
  });

  it('…and another account signing in meanwhile is not shown it, and that account’s own Settings Sign Out does not remove it', () => {
    typesThenLeaves('Looks done from the lift');
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', DAVID, null));

    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, OTHER));
    expect(whatTheFieldShows(MONDAY)).toBe('');
    typesThenLeaves('The other account’s own note', MONDAY, 'task-9');
    noteSignOutAskedHere(OTHER);
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_OUT', OTHER, null));
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', null, DAVID));

    expect(whatTheFieldShows(MONDAY)).toBe('Looks done from the lift');
    expect(whatTheFieldShows(MONDAY, 'task-9')).toBe('');
  });

  it('another account takes over with no sign-out heard in between: the first account’s note is set aside for it, not shown and not lost', () => {
    typesThenLeaves('Looks done from the lift');

    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', DAVID, OTHER));
    expect(whatTheFieldShows(MONDAY)).toBe('');
    act(() => settleUnsavedDraftsOnAccountChange('SIGNED_IN', OTHER, DAVID));

    expect(whatTheFieldShows(MONDAY)).toBe('Looks done from the lift');
  });
});
