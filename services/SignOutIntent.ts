/**
 * Whether the sign-out the app just heard was the one asked for on this
 * device (everyday item 7, 2 Oct 2026). Settings' Sign Out says what it
 * discards and asks first; a sign-in that ended elsewhere (the other device's
 * "Sign Out of All Devices", or the server refusing a refresh, while the app
 * was closed) asks nothing, and must not discard unsaved work with it.
 *
 * Open item W1-6 (6 Oct 2026), two places where what the warning said and
 * what happened differed:
 *
 * - An asked sign-out counted as asked for two minutes FROM THE TAP. A
 *   sign-out that took longer to go through (a slow connection: the expired
 *   sign-in is refreshed first, then the server is asked) was heard as "not
 *   asked", and his unsaved dictation was kept for his account though he
 *   had been told it would be discarded. It now counts as asked for as long
 *   as it is under way, however long that is, and for two minutes after it
 *   was answered (a sign-out that was answered is normally heard at once).
 *
 * - It did not say WHOSE sign-out was asked. Settings warns about the
 *   account it shows; when the app had not yet heard which account is signed
 *   in (opened with no signal), only what was on screen went, and a kept
 *   recording the warning had named stayed on the phone. The account the
 *   warning was about is now remembered with the request.
 */
let asked: { forAccount: string | null; answeredAt: number | null } | null = null;
/** How long an asked sign-out that was answered waits to be heard. */
const ASKED_SIGN_OUT_WINDOW_MS = 2 * 60_000;

/** Settings' Sign Out was confirmed on this device, after its warning about `forAccount`'s work. */
export function noteSignOutAskedHere(forAccount: string | null = null): void {
  asked = { forAccount, answeredAt: null };
}

/** The sign-out asked for was answered (it went through). */
export function noteAskedSignOutAnswered(now: number = Date.now()): void {
  if (asked) asked.answeredAt = now;
}

/** It did not happen (it failed, or he was asked to choose again). */
export function clearSignOutAskedHere(): void {
  asked = null;
}

/**
 * The sign-out heard now, when it was asked for here: the account its
 * warning was about (null when Settings did not know one). Null when it was
 * not asked for here. Each asked sign-out is heard once.
 */
export function signOutAskedHere(now: number = Date.now()): Readonly<{ forAccount: string | null }> | null {
  const heard = asked;
  asked = null;
  if (!heard) return null;
  if (heard.answeredAt !== null && (now < heard.answeredAt || now - heard.answeredAt > ASKED_SIGN_OUT_WINDOW_MS)) return null;
  return { forAccount: heard.forAccount };
}
