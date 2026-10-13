/**
 * Why an unfinished update has no GPS, kept on the phone beside the update.
 *
 * P1 part B item 3 (6 Oct 2026). Add Photos says why an update has no GPS
 * (location not allowed, Precise Location off, no fix could be taken), but
 * the reason lived in memory only: after the app was closed and opened
 * again, the resumed update said nothing. A resumed update is never given a
 * new fix (that would stamp today's place on an older update's photos; GPS
 * review pass 5), so the reason it had is the only true one, and it is now
 * kept.
 *
 * Kept under its own key, by the update's id: it is not part of the update
 * (nothing here is sent to the cloud or written into a backup), and a reason
 * is shown only for the update it was kept for, and only while that update
 * still has no GPS of its own. Like the unfinished update itself, the key
 * sits in the signed-in account's own storage on the phone.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DraftLocationNotice } from './DraftAreaPresentation';
import { runExclusiveLocalStorageMutation } from './LocalStorageMutationCoordinator';

export const DRAFT_LOCATION_NOTICE_STORAGE_KEY = 'projectPhotoUpdate.activeDraftLocationNotice.v1';

/** A capture's settled outcome. "Capturing" is never kept: see draftLocationNoticeToKeep. */
export type KeptDraftLocationNoticeKind = 'denied' | 'failed' | 'precise-off';
export type KeptDraftLocationNotice = Readonly<{ draftId: string; kind: KeptDraftLocationNoticeKind }>;

const KEPT_KINDS: readonly string[] = ['denied', 'failed', 'precise-off'];

/**
 * What to keep for the notice now showing. A capture still under way is
 * kept as "GPS could not be captured": if the app is closed before the fix
 * arrives, that is what happened, and when the fix does arrive the notice
 * goes and so does what was kept.
 */
export function draftLocationNoticeToKeep(notice: DraftLocationNotice | null): KeptDraftLocationNotice | null {
  if (!notice || !notice.draftId) return null;
  return { draftId: notice.draftId, kind: notice.kind === 'capturing' ? 'failed' : notice.kind };
}

/** What was kept, or null for nothing, or for anything that is not a reason this app wrote. */
export function parseKeptDraftLocationNotice(raw: string | null | undefined): KeptDraftLocationNotice | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; draftId?: unknown; kind?: unknown } | null;
    if (!parsed || parsed.version !== 1) return null;
    if (typeof parsed.draftId !== 'string' || !parsed.draftId) return null;
    if (typeof parsed.kind !== 'string' || !KEPT_KINDS.includes(parsed.kind)) return null;
    return { draftId: parsed.draftId, kind: parsed.kind as KeptDraftLocationNoticeKind };
  } catch {
    return null;
  }
}

/**
 * The notice a resumed update shows: the reason kept for this very update,
 * and only while it has no GPS of its own. It is worded of when the update
 * was started (review pass 1, L8). `generation` is the capture
 * count now (DraftFixTracker), so a later capture replaces it as it
 * replaces any notice.
 */
export function resumedDraftLocationNotice(input: Readonly<{
  kept: KeptDraftLocationNotice | null;
  draft: Readonly<{ id: string; gpsLatitude?: number | null; gpsLongitude?: number | null }>;
  generation: number;
}>): DraftLocationNotice | null {
  const { kept, draft } = input;
  if (!kept || kept.draftId !== draft.id) return null;
  if (typeof draft.gpsLatitude === 'number' && typeof draft.gpsLongitude === 'number') return null;
  // Marked as kept from before: it is said of when the update was started,
  // since the setting may have been put right since (review pass 1, L8).
  return { draftId: draft.id, generation: input.generation, kind: kept.kind, resumed: true };
}

export async function readKeptDraftLocationNotice(): Promise<KeptDraftLocationNotice | null> {
  try {
    return parseKeptDraftLocationNotice(await AsyncStorage.getItem(DRAFT_LOCATION_NOTICE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Keeps the reason, or with null removes what is kept. Writes land in the
 * order asked for (a "capturing" kept a moment before its outcome is never
 * written after it). A failed write loses only the reason, never the
 * update: it then says nothing rather than something untrue.
 */
export function keepDraftLocationNotice(kept: KeptDraftLocationNotice | null): Promise<void> {
  return runExclusiveLocalStorageMutation([DRAFT_LOCATION_NOTICE_STORAGE_KEY], async () => {
    if (kept) {
      await AsyncStorage.setItem(DRAFT_LOCATION_NOTICE_STORAGE_KEY, JSON.stringify({ version: 1, ...kept }));
    } else {
      await AsyncStorage.removeItem(DRAFT_LOCATION_NOTICE_STORAGE_KEY);
    }
  }).catch(() => undefined);
}
