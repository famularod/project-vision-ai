import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { CanonicalScheduleProgress } from '../services/ScheduleProgressInvariant';

/**
 * A task's staged status and percent, kept by task id until Save commits them
 * (whole-app audit A5, 30 Sep 2026). The draft lived in the task row, so
 * picking another task, collapsing a section, closing the task sheet or
 * switching tabs unmounted the row and dropped a value the manager had set
 * but not saved, with nothing on screen saying so; the row now says
 * "Unsaved" while one is staged.
 *
 * Each draft remembers the saved value it was staged on. When the saved
 * value moves underneath (this device's Confirm Completed, Close or Reopen,
 * or a teammate's change), the saved value wins and the draft is dropped, as
 * before: keeping it let Save undo a completion just confirmed (audit A5
 * pass 2). Memory only: staged values are not persisted across a relaunch.
 */
type StagedProgress = Readonly<{
  base: CanonicalScheduleProgress;
  value: CanonicalScheduleProgress;
}>;

const drafts = new Map<string, StagedProgress>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  listeners.forEach(listener => listener());
}

function sameProgress(left: CanonicalScheduleProgress, right: CanonicalScheduleProgress) {
  return left.status === right.status && left.percentComplete === right.percentComplete;
}

export function useScheduleProgressDraft(
  itemId: string,
  committed: CanonicalScheduleProgress,
): [
  CanonicalScheduleProgress,
  (update: (current: CanonicalScheduleProgress) => CanonicalScheduleProgress) => void,
] {
  const entry = useSyncExternalStore(subscribe, () => drafts.get(itemId));
  const committedRef = useRef(committed);
  committedRef.current = committed;
  const staged = entry && sameProgress(entry.base, committed) ? entry.value : undefined;

  useEffect(() => {
    const current = drafts.get(itemId);
    if (!current) return;
    if (!sameProgress(current.base, committed) || sameProgress(current.value, committed)) {
      drafts.delete(itemId);
      notify();
    }
  }, [itemId, committed.status, committed.percentComplete]);

  const stage = useCallback((update: (current: CanonicalScheduleProgress) => CanonicalScheduleProgress) => {
    const saved = committedRef.current;
    const current = drafts.get(itemId);
    const next = update(current && sameProgress(current.base, saved) ? current.value : saved);
    if (sameProgress(next, saved)) drafts.delete(itemId);
    else drafts.set(itemId, { base: saved, value: next });
    notify();
  }, [itemId]);

  return [staged ?? committed, stage];
}

/**
 * The optional note typed under a task's "Verify completion", kept by task
 * id until Confirm Completed or Not Complete uses it (open item W1-7,
 * 6 Oct 2026). It was left out when the text typed on a task was made to
 * survive the task closing (audit A2 M3, A5): it lived in the task row, so
 * anything that took the row away dropped it with nothing said. The button
 * right under it does exactly that: Capture Verification Photo opens a new
 * update, and the note was gone on the way back. So did a tab switch.
 *
 * Memory only, as the staged progress above. A note typed for a completion
 * report that has since been confirmed or turned down (here or on another
 * device) is dropped: it was for that report.
 */
const verificationNotes = new Map<string, string>();

export function useScheduleVerificationNoteDraft(
  itemId: string,
  awaitingVerification: boolean,
): [string, (note: string) => void] {
  const note = useSyncExternalStore(subscribe, () => verificationNotes.get(itemId) ?? '');

  useEffect(() => {
    if (!awaitingVerification && verificationNotes.delete(itemId)) notify();
  }, [itemId, awaitingVerification]);

  const setNote = useCallback((next: string) => {
    verificationNotes.set(itemId, next);
    notify();
  }, [itemId]);

  return [note, setNote];
}

/** Test seam: forget every staged value. */
export function clearScheduleProgressDraftsForTests() {
  drafts.clear();
  verificationNotes.clear();
  notify();
}
