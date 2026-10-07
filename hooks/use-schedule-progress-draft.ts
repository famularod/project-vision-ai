import { useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { NativeWorkspaceOwnerContext } from '../components/native-workspace-owner';
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
 *
 * Second review of the web area, F6 (7 Oct 2026). "Its account" was the
 * account the app had HEARD was signed in. Typed before the app had heard
 * any (opened with no signal), with that sign-in then ending unasked, the
 * note was set aside for "whoever signs in next": the next account's Sign
 * Out warning named a note that account never typed, and its Sign Out
 * discarded the first account's note. And on the phone a note set aside was
 * never back for its own account either: the app is opened afresh for each
 * sign-in, and a freshly opened app is not told of that sign-in as a change
 * of account.
 *
 * A note now belongs to the account that typed it, from the moment it is
 * typed: the account whose workspace its task row is drawn in. On the phone
 * a task row is only ever drawn inside one account's workspace (entry.ts),
 * so that account is always known, whatever the app has heard. Each account
 * has its own notes, also for a task with the same id. A row shows, drops
 * and replaces only its own account's note; a warning names only the note
 * of the account Settings shows; a Sign Out discards only that account's.
 * A sign-out not asked for removes nothing: the note stays kept for its
 * account, and is in its field again when that account's workspace shows
 * the task.
 *
 * Outside a workspace (a test of this rule alone) a row goes by the account
 * the app has heard. A note typed there before the app had heard any is the
 * account's the app hears next, when no sign-out came in between. When that
 * sign-in ends unasked with the app still not told whose it was, the note
 * is dropped: there is no account to keep it for, and keeping it for the
 * next one was the fault.
 */
type CompletionReport = Pick<DAVECompletionVerification, 'reportedAt' | 'reportedBy' | 'evidence'>;
type VerificationNote = Readonly<{
  itemId: string;
  text: string;
  /** The report it was typed about. */
  report: string;
  /** The account that typed it. Null: typed outside a workspace before the app had heard which account is signed in. */
  account: string | null;
}>;

/** By account and task. */
const verificationNotes = new Map<string, VerificationNote>();
/** The account the app has heard is signed in now (null: none): what a row outside a workspace goes by. */
let accountHeard: string | null = null;

const verificationNoteKey = (account: string | null, itemId: string) => JSON.stringify([account, itemId]);

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
  // The account whose workspace this row is drawn in (as Settings and the Project Walk memory name it).
  const workspace = useContext(NativeWorkspaceOwnerContext);
  const account = useSyncExternalStore(subscribe, () => (workspace === undefined ? accountHeard : workspace ?? 'local-device'));
  const key = verificationNoteKey(account, itemId);
  const kept = useSyncExternalStore(subscribe, () => verificationNotes.get(key));
  const note = kept && kept.report === report ? kept.text : '';

  useEffect(() => {
    const current = verificationNotes.get(key);
    // Typed about a report that is settled, or that another report has taken the place of.
    if (current && current.report !== report && verificationNotes.delete(key)) notify();
  }, [key, report]);

  const setNote = useCallback((next: string) => {
    if (report === null || !next) verificationNotes.delete(key);
    else verificationNotes.set(key, { itemId, text: next, report, account });
    notify();
  }, [itemId, key, report, account]);

  return [note, setNote];
}

/**
 * Whether `account` has a verification note typed and not yet used, for its Settings' Sign Out warning.
 * With no account named: the account the app has heard is signed in.
 */
export function unusedScheduleVerificationNoteExists(account?: string | null): boolean {
  const whose = account || accountHeard;
  return [...verificationNotes.values()].some(note =>
    (note.account === null || note.account === whose) && note.text.trim().length > 0);
}

/** A note typed before the app knew the account is `account`'s from here on; with none known it is dropped. */
function settleNotesOfNoKnownAccount(account: string | null | undefined): boolean {
  let changed = false;
  [...verificationNotes].forEach(([key, note]) => {
    if (note.account !== null) return;
    verificationNotes.delete(key);
    if (account) verificationNotes.set(verificationNoteKey(account, note.itemId), { ...note, account });
    changed = true;
  });
  return changed;
}

/**
 * A sign-out not asked for here: `account` is the one the app had heard was signed in (none when it had
 * heard none). Every account's notes stay kept for it. No account is signed in now.
 */
export function setAsideScheduleVerificationNotes(account: string | null | undefined) {
  const changed = settleNotesOfNoKnownAccount(account);
  if (accountHeard === null && !changed) return;
  accountHeard = null;
  notify();
}

/**
 * `account` signed in, after `previous` when the app had heard one and no sign-out in between (another
 * account taking over). A note typed before the app knew the account was typed under the account it had
 * heard, or, with none heard, under the one it hears now: this is the app learning whose it is.
 */
export function bringBackScheduleVerificationNotes(account: string, previous?: string | null) {
  const changed = settleNotesOfNoKnownAccount(previous || account);
  if (accountHeard === account && !changed) return;
  accountHeard = account;
  notify();
}

/**
 * Settings' Sign Out, after its warning: the notes of the account signing out go (with none named, of the
 * account the app has heard), and a note typed before the app knew the account, which only the account
 * signing out can have typed. Another account's stay.
 */
export function forgetScheduleVerificationNotes(account?: string | null) {
  const whose = account || accountHeard;
  let changed = accountHeard !== null;
  accountHeard = null;
  [...verificationNotes].forEach(([key, note]) => {
    if (note.account !== null && note.account !== whose) return;
    verificationNotes.delete(key);
    changed = true;
  });
  if (changed) notify();
}

/** Test seam: forget every staged value. */
export function clearScheduleProgressDraftsForTests() {
  drafts.clear();
  verificationNotes.clear();
  accountHeard = null;
  notify();
}
