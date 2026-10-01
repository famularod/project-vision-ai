/**
 * A recording that cannot be sent because the sign-in is waiting for signal
 * (whole-app audit A11 pass 4 L1, 30 Sep 2026). Opened with no signal on a
 * saved sign-in whose hourly token had expired (owner answer Q13), the token
 * lookup fails and voice said "Sign in before transcribing a recorded
 * memory.", which invited a sign-out he could not undo without signal. The
 * recording is kept and works once signal returns. Which case this is, is
 * decided as for field updates (fieldUpdateSyncCategoryWithoutSession, A4
 * pass 7 M1): only a sign-in the server refused still asks to sign in.
 */
const WAITING_FOR_SIGNAL = 'DAVEVoiceWaitingForSignal';

export function daveVoiceWaitingForSignalError(): Error {
  const error = new Error('No signal. Your recording is kept. Try again when you have signal.');
  error.name = WAITING_FOR_SIGNAL;
  return error;
}

/** What the voice sheet shows for a failure, naming its own retry button. */
export function daveVoiceFailureMessage(reason: unknown, retryLabel: string): string {
  if (reason instanceof Error && reason.name === WAITING_FOR_SIGNAL) {
    return `No signal. Your recording is kept — tap ${retryLabel} when you have signal.`;
  }
  return reason instanceof Error ? reason.message : 'The recording could not be transcribed.';
}
