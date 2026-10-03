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
