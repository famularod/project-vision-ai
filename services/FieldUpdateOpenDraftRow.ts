/**
 * Everyday item 8 (2 Oct 2026): Field Activity's Drafts tab listed only
 * saved updates, so the update open on this phone (photos taken, notes
 * written, not yet saved or sent) had no row there. It is listed now, first,
 * as a draft: opening it resumes it where it was, and deleting it is the
 * draft's own Discard. A draft already saved has its saved row and gets no
 * second one; an empty draft is not listed.
 */
export function updatesWithOpenDraft<TUpdate extends Readonly<{ id: string; status?: string }>>(
  savedUpdates: readonly TUpdate[],
  openDraft: TUpdate,
  openDraftHasWork: boolean,
): TUpdate[] {
  if (!openDraftHasWork || savedUpdates.some(update => update.id === openDraft.id)) return savedUpdates as TUpdate[];
  return [{ ...openDraft, status: 'draft' }, ...savedUpdates];
}

/** Whether `updateId` is the open draft's row (not a saved update): Delete discards the draft. */
export function isOpenDraftRow(
  savedUpdates: readonly Readonly<{ id: string }>[],
  openDraft: Readonly<{ id: string }>,
  updateId: string,
): boolean {
  return updateId === openDraft.id && !savedUpdates.some(update => update.id === updateId);
}
