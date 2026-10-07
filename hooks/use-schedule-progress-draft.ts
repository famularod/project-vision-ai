import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { CanonicalScheduleProgress } from '../services/ScheduleProgressInvariant';
import type { DAVECompletionVerification } from '../types';

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
 *
 * Review pass 1 of the web area, L8 (6 Oct 2026). Kept by task id alone, a
 * note was dropped only if a row of that task was DRAWN while the task was
 * not awaiting verification. Typed for one report, with that report settled
 * on another device and the task reported complete again while its row was
 * off screen, it opened in the field for the NEW report. And Settings' Sign
 * Out did not drop it: it was back after signing in again.
 *
 * - It is now kept for the REPORT it was typed about. A completion report is
 *   told from the next one of the same task by when it was reported, by
 *   whom, and how many times the task's completion has been decided before
 *   (each Confirm Completed and Not Complete adds one decision to the task's
 *   record). Photos added to a report still awaiting an answer leave it the
 *   same report. A note for another report never opens, and is dropped as
 *   soon as a row of its task is drawn.
 * - Settings' Sign Out, which now names it in its warning, discards it. A
 *   sign-out not asked for here sets it aside for its account, as the
 *   unsaved field note is: it is off the screen, no other account is shown
 *   it or loses it, and it is back when that account signs in again.
 */
type CompletionReport = Pick<DAVECompletionVerification, 'reportedAt' | 'reportedBy' | 'evidence'>;
type VerificationNote = Readonly<{
  text: string;
  /** The report it was typed about. */
  report: string;
  /** Null: of the account signed in now. Otherwise the account it is set aside for ('': not known which). */
  setAsideFor: string | null;
}>;

const verificationNotes = new Map<string, VerificationNote>();

/** What tells one completion report of a task from the next one. */
function completionReportKey(report: CompletionReport): string {
  const decided = report.evidence.filter(entry => entry.kind === 'pm_confirmation' || entry.kind === 'pm_note').length;
  return JSON.stringify([report.reportedAt, report.reportedBy ?? '', decided]);
}

export function useScheduleVerificationNoteDraft(
  itemId: string,
  /** The completion report the task is awaiting verification of; null when it awaits none. */
  awaiting: CompletionReport | null | undefined,
): [string, (note: string) => void] {
  const report = awaiting ? completionReportKey(awaiting) : null;
  const kept = useSyncExternalStore(subscribe, () => verificationNotes.get(itemId));
  const note = kept && kept.setAsideFor === null && kept.report === report ? kept.text : '';

  useEffect(() => {
    const current = verificationNotes.get(itemId);
    // Typed about a report that is settled, or that another report has taken the place of.
    if (current && current.setAsideFor === null && current.report !== report && verificationNotes.delete(itemId)) notify();
  }, [itemId, report]);

  const setNote = useCallback((next: string) => {
    if (report === null || !next) verificationNotes.delete(itemId);
    else verificationNotes.set(itemId, { text: next, report, setAsideFor: null });
    notify();
  }, [itemId, report]);

  return [note, setNote];
}

/** Whether a verification note is typed and not yet used, for Settings' Sign Out warning. */
export function unusedScheduleVerificationNoteExists(): boolean {
  return [...verificationNotes.values()].some(note => note.setAsideFor === null && note.text.trim().length > 0);
}

/**
 * A sign-out not asked for here, or another account taking over: the notes
 * on screen are set aside for the account they were typed under (not known
 * when the app had heard none).
 */
export function setAsideScheduleVerificationNotes(account: string | null | undefined) {
  let changed = false;
  verificationNotes.forEach((note, itemId) => {
    if (note.setAsideFor !== null) return;
    verificationNotes.set(itemId, { ...note, setAsideFor: account || '' });
    changed = true;
  });
  if (changed) notify();
}

/** `account` signed in: what was set aside for it is its again, and what was set aside when no account was known. */
export function bringBackScheduleVerificationNotes(account: string) {
  let changed = false;
  verificationNotes.forEach((note, itemId) => {
    if (note.setAsideFor !== account && note.setAsideFor !== '') return;
    verificationNotes.set(itemId, { ...note, setAsideFor: null });
    changed = true;
  });
  if (changed) notify();
}

/**
 * Settings' Sign Out, after its warning: the notes on screen go, and what
 * was set aside for the account signing out. Another account's stay.
 */
export function forgetScheduleVerificationNotes(account?: string | null) {
  let changed = false;
  verificationNotes.forEach((note, itemId) => {
    if (note.setAsideFor !== null && !(account && note.setAsideFor === account)) return;
    verificationNotes.delete(itemId);
    changed = true;
  });
  if (changed) notify();
}

/** Test seam: forget every staged value. */
export function clearScheduleProgressDraftsForTests() {
  drafts.clear();
  verificationNotes.clear();
  notify();
}
