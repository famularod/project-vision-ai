/**
 * Whether the sign-out the app just heard was the one asked for on this
 * device (everyday item 7, 2 Oct 2026). Settings' Sign Out says what it
 * discards and asks first; a sign-in that ended elsewhere (the other device's
 * "Sign Out of All Devices", or the server refusing a refresh, while the app
 * was closed) asks nothing, and must not discard unsaved work with it.
 */
let askedAt: number | null = null;
/** How long an asked sign-out waits to be heard (a sign-out with no signal answers at once). */
const ASKED_SIGN_OUT_WINDOW_MS = 2 * 60_000;

/** Settings' Sign Out was confirmed on this device. */
export function noteSignOutAskedHere(now: number = Date.now()): void {
  askedAt = now;
}

/** It did not happen (it failed, or he was asked to choose again). */
export function clearSignOutAskedHere(): void {
  askedAt = null;
}

/** Whether the sign-out heard now was asked for here; each asked sign-out is heard once. */
export function signOutWasAskedHere(now: number = Date.now()): boolean {
  const asked = askedAt !== null && now - askedAt >= 0 && now - askedAt <= ASKED_SIGN_OUT_WINDOW_MS;
  askedAt = null;
  return asked;
}
