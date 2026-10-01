import { localFieldNoteRepository } from './FieldNoteRepository';

/**
 * Field notes saved on this phone for this account and still waiting to sync
 * (whole-app audit A11 pass 4 L5, 30 Sep 2026). The Sign Out warning counted
 * updates, queued changes and documents, but not these. They stay on the
 * phone after a sign-out and sync when the same account signs in again.
 * Notes the cloud refused as a conflict ("Review needed") are counted too
 * (whole-app audit A11 pass 5 L3): they are still only on this phone.
 */
/**
 * Field notes marked "Review needed" (whole-app audit A11 pass 6 L1): they
 * are counted above, but they do not sync after sign-in on their own; they
 * wait for Keep my version or Use cloud version in Field Notes.
 */
export async function fieldNotesNeedingReview(ownerKey: string): Promise<number> {
  try {
    return (await localFieldNoteRepository.list(ownerKey)).filter(note => note.syncState === 'conflict').length;
  } catch {
    return 0;
  }
}

export async function fieldNotesWaitingToSync(ownerKey: string): Promise<number> {
  try {
    return (await localFieldNoteRepository.list(ownerKey))
      .filter(note => note.syncState === 'pending' || note.syncState === 'conflict').length;
  } catch {
    return 0;
  }
}
