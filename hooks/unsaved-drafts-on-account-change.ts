import { forgetKeptVoiceRecordings } from '../services/KeptVoiceRecording';
import { signOutAskedHere } from '../services/SignOutIntent';
import { forgetFieldNoteDraft, setAsideFieldNoteDraft } from './use-field-note-draft';
import { forgetKeptWalkMemoryDrafts, setAsideKeptWalkMemoryDrafts } from './use-kept-walk-memory-draft';
import {
  bringBackScheduleVerificationNotes,
  forgetScheduleVerificationNotes,
  setAsideScheduleVerificationNotes,
} from './use-schedule-progress-draft';

/**
 * The unsaved field note, Project Walk memory and recording waiting for
 * signal when the signed-in account changes (A2 M3, A11 pass 4 L3, everyday
 * item 4): nobody's carries over to another account.
 *
 * Everyday item 7 (2 Oct 2026): a sign-out this device did not ask for (the
 * sign-in ended elsewhere while the app was closed) discarded them with no
 * warning. They are now set aside for that account: off the screen, kept on
 * the phone under that account (no other account reads them), and offered
 * again, each where it was made, once that account signs in. Settings' Sign
 * Out, which warns first, still removes them.
 *
 * Review N2 (5 Oct 2026): Settings' Sign Out removes the work of the account
 * that is signing out, and no other account's. It removed every account's,
 * so work set aside for David after his sign-in had ended unasked was
 * deleted when a second account signed out through Settings, which had
 * warned that account about its own work only. Another account signing in
 * removes nothing either: what was set aside stays kept for its account,
 * and is still never shown or offered to anyone else.
 *
 * Open item W1-6 (6 Oct 2026): Settings' Sign Out with no signal right after
 * the app opened left a kept recording on the phone though its warning had
 * said it would be discarded. The app had not yet heard which account was
 * signed in, so only what was on screen went. The warning is about the
 * account Settings shows, and that account now comes with the request: its
 * work goes, as the warning said.
 *
 * Review pass 1 of the web area, L8 (6 Oct 2026): the optional verification
 * note typed on a task (kept in memory since open item W1-7) follows the
 * same rule. Settings' Sign Out, which now names it in its warning,
 * discards it. A sign-out not asked for sets it aside for its account, and
 * it is back when that account signs in again; no other account is shown
 * it, and no other account's Sign Out removes it.
 */
let setAside: Readonly<{ userId: string | null }> | null = null;

export function settleUnsavedDraftsOnAccountChange(
  event: string,
  previousUserId: string | null | undefined,
  userId: string | null | undefined,
): void {
  const asked = event === 'SIGNED_OUT' ? signOutAskedHere() : null;
  if (event === 'SIGNED_OUT' && !asked) {
    // Whose they are is not needed to keep them: each is kept under its account.
    setAside = { userId: previousUserId ?? null };
    setAsideFieldNoteDraft();
    setAsideKeptWalkMemoryDrafts();
    setAsideScheduleVerificationNotes(previousUserId);
    return;
  }
  const back = setAside;
  setAside = null;
  // An account that signs in has its own set-aside verification notes again (review pass 1, L8).
  if (userId) {
    setAsideScheduleVerificationNotes(previousUserId);
    bringBackScheduleVerificationNotes(userId);
  }
  // The account they were set aside for (or, not known, whichever signs in: another account cannot read them).
  if (back && userId && (!back.userId || back.userId === userId)) return;
  if (event === 'SIGNED_OUT') {
    // Settings' Sign Out, after its warning: the work of the account signing out goes, on the phone too.
    // When the phone has not heard which account that is (it opened with no signal), it is the account
    // the warning was about (open item W1-6). With neither known, only what is on screen is known to be
    // its: that goes, and the rest stays kept.
    const account = previousUserId || asked?.forAccount || undefined;
    forgetFieldNoteDraft(account);
    forgetKeptWalkMemoryDrafts(account);
    if (account) forgetKeptVoiceRecordings(account);
    forgetScheduleVerificationNotes(account);
    return;
  }
  // Another account signed in: nobody's stays on screen, and each account's stays kept on the phone for it.
  setAsideFieldNoteDraft();
  setAsideKeptWalkMemoryDrafts();
}

/** Test seam: a new app session has set nothing aside. */
export function forgetSetAsideAccount(): void {
  setAside = null;
}
