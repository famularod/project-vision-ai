import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { CanonicalScheduleProgress } from '../services/ScheduleProgressInvariant';

/**
 * A task's staged status and percent, kept by task id until Save commits them
 * (whole-app audit A5, 30 Sep 2026). The draft lived in the task row, so
 * picking another task, collapsing a section, closing the task sheet or
 * switching tabs unmounted the row and dropped a value the manager had set
 * but not saved, with nothing on screen saying so. A staged value is dropped
 * only when it matches the saved one (after Save, or a teammate's identical
 * change); a different saved value arriving underneath does not overwrite
 * what was staged, and the row says "Unsaved" until Save or a reset by hand.
 * Memory only: staged values are not persisted across a relaunch.
 */
const drafts = new Map<string, CanonicalScheduleProgress>();
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
  const staged = useSyncExternalStore(subscribe, () => drafts.get(itemId));
  const committedRef = useRef(committed);
  committedRef.current = committed;

  useEffect(() => {
    const entry = drafts.get(itemId);
    if (entry && sameProgress(entry, committed)) {
      drafts.delete(itemId);
      notify();
    }
  }, [itemId, committed.status, committed.percentComplete]);

  const stage = useCallback((update: (current: CanonicalScheduleProgress) => CanonicalScheduleProgress) => {
    const next = update(drafts.get(itemId) ?? committedRef.current);
    if (sameProgress(next, committedRef.current)) drafts.delete(itemId);
    else drafts.set(itemId, next);
    notify();
  }, [itemId]);

  return [staged ?? committed, stage];
}

/** Test seam: forget every staged value. */
export function clearScheduleProgressDraftsForTests() {
  drafts.clear();
  notify();
}
