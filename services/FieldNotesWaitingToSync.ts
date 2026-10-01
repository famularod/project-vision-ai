import { localFieldNoteRepository } from './FieldNoteRepository';

/**
 * Field notes saved on this phone for this account and still waiting to sync
 * (whole-app audit A11 pass 4 L5, 30 Sep 2026). The Sign Out warning counted
 * updates, queued changes and documents, but not these. They stay on the
 * phone after a sign-out and sync when the same account signs in again.
 * Notes the cloud refused as a conflict ("Review needed") are counted too
 * (whole-app audit A11 pass 5 L3): they are still only on this phone.
 */
export async function fieldNotesWaitingToSync(ownerKey: string): Promise<number> {
  try {
    return (await localFieldNoteRepository.list(ownerKey))
      .filter(note => note.syncState === 'pending' || note.syncState === 'conflict').length;
  } catch {
    return 0;
  }
}
