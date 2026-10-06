import { act, renderHook } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  clearScheduleProgressDraftsForTests,
  useScheduleVerificationNoteDraft,
} from '../../hooks/use-schedule-progress-draft';

// Batch W1, item 7 (6 Oct 2026). The optional note under a task's "Verify
// completion" was left out when the text typed on a task was made to survive
// the task closing: it lived in the task row, so anything that took the row
// away dropped it (a tab switch, or the Capture Verification Photo button
// right under it). It is now kept by task id until Confirm Completed or Not
// Complete uses it. The whole-app test of it is in
// tests/app-typed-text-survives-navigation.test.tsx.

const app = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8');

describe('the optional verification note is kept by task until it is used', () => {
  // Clearing tells rows still on screen: inside act (the release gate fails on "not wrapped in act").
  afterEach(() => act(() => clearScheduleProgressDraftsForTests()));

  it('survives the row going away and coming back, and each task has its own', () => {
    const row = renderHook(
      (props: { id: string }) => useScheduleVerificationNoteDraft(props.id, true),
      { initialProps: { id: 'task-1' } },
    );
    act(() => row.result.current[1]('Walked level 2 with the foreman'));
    expect(row.result.current[0]).toBe('Walked level 2 with the foreman');
    // Another task shown in the same place has none of it.
    row.rerender({ id: 'task-2' });
    expect(row.result.current[0]).toBe('');
    row.unmount();

    expect(renderHook(() => useScheduleVerificationNoteDraft('task-1', true)).result.current[0]).toBe('Walked level 2 with the foreman');
    expect(renderHook(() => useScheduleVerificationNoteDraft('task-2', true)).result.current[0]).toBe('');
  });

  it('Confirm Completed and Not Complete clear it (they set it to nothing once it is used)', () => {
    const row = renderHook(() => useScheduleVerificationNoteDraft('task-1', true));
    act(() => row.result.current[1]('Punch list item 4 still open'));
    act(() => row.result.current[1](''));
    row.unmount();

    expect(renderHook(() => useScheduleVerificationNoteDraft('task-1', true)).result.current[0]).toBe('');
  });

  it('a note typed for a completion report that was settled meanwhile (on another device) is dropped, and does not come back for a later report', () => {
    const row = renderHook(
      (props: { awaiting: boolean }) => useScheduleVerificationNoteDraft('task-1', props.awaiting),
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
      (props: { awaiting: boolean }) => useScheduleVerificationNoteDraft('task-1', props.awaiting),
      { initialProps: { awaiting: true } },
    );
    act(() => row.result.current[1]('Looks done from the lift'));
    row.rerender({ awaiting: true });
    expect(row.result.current[0]).toBe('Looks done from the lift');
  });

  it('the task row uses it, for its own task, while the task awaits verification', () => {
    const row = app.slice(app.indexOf('\nfunction ScheduleItemRow('), app.indexOf('\n  async function saveTaskChanges()', app.indexOf('\nfunction ScheduleItemRow(')));
    expect(row).toContain('const [verificationNote, setVerificationNote] = useScheduleVerificationNoteDraft(item.id, needsCompletionVerification);');
    expect(row).not.toContain("const [verificationNote, setVerificationNote] = useState('');");
  });
});
