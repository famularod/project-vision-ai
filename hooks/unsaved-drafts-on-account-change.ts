import { forgetKeptVoiceRecordings } from '../services/KeptVoiceRecording';
import { signOutWasAskedHere } from '../services/SignOutIntent';
import { forgetFieldNoteDraft, setAsideFieldNoteDraft } from './use-field-note-draft';
import { forgetKeptWalkMemoryDrafts, setAsideKeptWalkMemoryDrafts } from './use-kept-walk-memory-draft';

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
 * Out, which warns first, still removes them; so does another account
 * signing in while the app stays open.
 */
let setAside: Readonly<{ userId: string | null }> | null = null;

export function settleUnsavedDraftsOnAccountChange(
  event: string,
  previousUserId: string | null | undefined,
  userId: string | null | undefined,
): void {
  if (event === 'SIGNED_OUT' && !signOutWasAskedHere()) {
    // Whose they are is not needed to keep them: each is kept under its account.
    setAside = { userId: previousUserId ?? null };
    setAsideFieldNoteDraft();
    setAsideKeptWalkMemoryDrafts();
    return;
  }
  const back = setAside;
  setAside = null;
  // The account they were set aside for (or, not known, whichever signs in: another account cannot read them).
  if (back && userId && (!back.userId || back.userId === userId)) return;
  forgetFieldNoteDraft();
  forgetKeptWalkMemoryDrafts();
  forgetKeptVoiceRecordings();
}

/** Test seam: a new app session has set nothing aside. */
export function forgetSetAsideAccount(): void {
  setAside = null;
}
