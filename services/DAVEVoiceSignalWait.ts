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
  const error = new Error('No signal. Your recording is kept while Vitruvius stays open. Try again when you have signal.');
  error.name = WAITING_FOR_SIGNAL;
  return error;
}

export const DAVE_VOICE_KEPT_ON_DEVICE = 'Your recording is kept on this device.';

/**
 * What the voice sheet shows for a failure, naming its own retry button.
 * `keptOnDevice`: the sheet has kept the recording on this device past a
 * closed app (everyday item 4), and the message says so; otherwise it is
 * kept in the sheet only.
 */
export function daveVoiceFailureMessage(reason: unknown, retryLabel: string, keptOnDevice = false): string {
  if (reason instanceof Error && reason.name === WAITING_FOR_SIGNAL) {
    if (keptOnDevice) {
      return `No signal. Your recording is kept on this device — tap ${retryLabel} when you have signal. ` +
        'If Vitruvius closes, it is tried again the next time you open this.';
    }
    // Kept in this sheet only: iOS closing the app loses it (A11 pass 6 L2).
    return `No signal. Your recording is kept while Vitruvius stays open — tap ${retryLabel} when you have signal.`;
  }
  const message = reason instanceof Error ? reason.message : 'The recording could not be transcribed.';
  if (!keptOnDevice) return message;
  // Review N1 L4: the upload's own offline, connection and time-out messages
  // kept the recording on the device too and did not say so. Said before the
  // message's code, which stays last.
  const code = /\s*(\(VOICE-[A-Z]+\))$/.exec(message);
  return code
    ? `${message.slice(0, code.index)} ${DAVE_VOICE_KEPT_ON_DEVICE} ${code[1]}`
    : `${message} ${DAVE_VOICE_KEPT_ON_DEVICE}`;
}

/**
 * Whether a failure is the recording waiting for signal (everyday item 4):
 * the sign-in waiting for signal, or the upload's own offline, connection or
 * time-out codes, or no answer at all. Such a recording is kept on the device.
 */
export function daveVoiceFailureIsWaitingForSignal(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  if (reason.name === WAITING_FOR_SIGNAL) return true;
  return /\((?:VOICE-OFFLINE|VOICE-CONNECTION|VOICE-TIMEOUT)\)$/.test(reason.message) ||
    reason.message === 'Could not reach voice transcription. Check the connection and try again.';
}

/**
 * Whether a failure is the upload's own (review N1 L2): waiting for signal,
 * or any failure the upload names with its code, such as "The voice upload
 * was interrupted. … (VOICE-CANCELLED)". A sheet that has the recording kept
 * on the device says so for these; the voice service's own answers ("could
 * not understand this recording") read as they did.
 */
export function daveVoiceFailureIsTheUpload(reason: unknown): boolean {
  return daveVoiceFailureIsWaitingForSignal(reason) ||
    (reason instanceof Error && /\(VOICE-[A-Z]+\)$/.test(reason.message));
}
