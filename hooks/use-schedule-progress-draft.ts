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

/** Test seam: forget every staged value. */
export function clearScheduleProgressDraftsForTests() {
  drafts.clear();
  notify();
}
