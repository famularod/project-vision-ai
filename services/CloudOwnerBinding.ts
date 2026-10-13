/**
 * Whole-app audit A1 M3 (30 Sep 2026): the account whose work is being sent.
 * An upload pass that began for one account kept going after a sign-out and
 * another sign-in, and sent the rest of the first account's queue with the
 * new account's session, into the new account. Uploads now bind to the
 * signed-in account when they start: the queue records the account each
 * item was queued under, a pass sends only that account's items, and it
 * stops (leaving the rest queued) the moment the account changes.
 *
 * Fed by the sign-in events (SupabaseService) and by an offline start on a
 * saved sign-in (owner answer Q13). `undefined` means not known yet (before
 * the first sign-in event): nothing is held then, and learning the account
 * is not a change.
 */
export type CloudOwnerBinding = Readonly<{
  ownerId: string | null | undefined;
  epoch: number;
}>;

let current: CloudOwnerBinding = Object.freeze({ ownerId: undefined, epoch: 0 });

export function noteSignedInOwner(ownerId: string | null): void {
  if (current.ownerId === ownerId) return;
  current = Object.freeze({
    ownerId,
    epoch: current.ownerId === undefined ? current.epoch : current.epoch + 1,
  });
}

export function currentCloudOwner(): CloudOwnerBinding {
  return current;
}

/** False once another account (or none) has signed in since `binding`. */
export function cloudOwnerUnchanged(binding: CloudOwnerBinding): boolean {
  return current.epoch === binding.epoch;
}

/** Work recorded for another account is held, never sent as this one. */
export function heldForAnotherOwner(
  itemOwnerId: unknown,
  binding: CloudOwnerBinding,
): boolean {
  return typeof itemOwnerId === 'string' &&
    itemOwnerId.length > 0 &&
    binding.ownerId !== undefined &&
    itemOwnerId !== binding.ownerId;
}

/**
 * Sync batch Y4, the account boundary of an upload under way (owner answer
 * Q45, 6 Oct 2026: yes). One waiting item's upload is several requests:
 * checks, then the write. The pass looked at who is signed in before each
 * item only, so when that account signed out and another signed in while one
 * of the item's checks was still waiting, the write went out with the new
 * account's sign-in and named the new account as owner: one account's task
 * was written into another's. The write is now made "as" the account the
 * item was queued under, or not at all.
 */
export const CLOUD_ACCOUNT_CHANGED = 'cloud_owner_changed';
export const CLOUD_ACCOUNT_CHANGED_MESSAGE =
  'The account changed during sync. Work not yet sent waits for the account that saved it.';

let expectedForThisCall: string | null = null;

/**
 * Makes one cloud call that must be made as `ownerId`. The call is told so
 * in the same instant it starts (nothing else runs between), and refuses when
 * the account it finds signed in is another one. With no account given the
 * call is made as it always was.
 */
export function callAsCloudOwner<T>(ownerId: string | null | undefined, call: () => T): T {
  const before = expectedForThisCall;
  expectedForThisCall = typeof ownerId === 'string' && ownerId ? ownerId : null;
  try {
    return call();
  } finally {
    expectedForThisCall = before;
  }
}

/** For the cloud call just started: the account it must be made as, if it was started with callAsCloudOwner. */
export function cloudOwnerExpectedForThisCall(): string | null {
  return expectedForThisCall;
}

/**
 * Review pass 1, sync G1, G2 and G4 (owner answer Q45, 6 Oct 2026). A request to the database names its account in
 * its own filter or in the row it writes, and the last look before it leaves reads it there. A file sent to
 * storage, and a document's search index, name no account in themselves. Such a request carries the account it is
 * sent for under this name, for the app's own last look only: the name is read and taken off where every request
 * leaves (SupabaseService), and is never sent to the cloud.
 */
export const CLOUD_REQUEST_ACCOUNT_HEADER = 'x-vitruvius-sent-for-account';
