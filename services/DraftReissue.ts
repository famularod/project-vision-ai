/**
 * Saving a draft whose update was deleted while it was open.
 *
 * Whole-app audit, area A4 (29 Sep 2026): a saved update opened as the
 * draft and then deleted (from the list on this phone, or on another device
 * through a sync tombstone) keeps its id, and a save of that id is dropped
 * by the deletion barrier while the app said "Field update saved". The save
 * now checks that the queued update survived the commit; when it did not,
 * the draft is kept and can be saved as a new update: same content, photos
 * and files, a new id, no send identity, no cloud photo paths, and none of
 * the old record's sync or delete diagnostics.
 */
export type ReissuablePhoto = Readonly<{
  cloudStoragePath?: string | null;
  cloudRecoveredAt?: string | null;
  cloudRecoveryStatus?: 'cached' | 'signed_url' | 'unavailable' | null;
  cloudSignedUrlExpiresAt?: string | null;
  cloudPreviewUri?: string | null;
  cloudPreviewSignedUrlExpiresAt?: string | null;
}>;

export type ReissuableDraft = Readonly<{
  id: string;
  photos: readonly ReissuablePhoto[];
  status?: string;
  stableSendId?: string | null;
  idempotencyKey?: string | null;
  sendAttempts?: number;
  lastSendAttemptAt?: string | null;
  syncDiagnostics?: unknown;
  deleteDiagnostics?: unknown;
  archivedAt?: string | null;
  isArchived?: boolean;
  workflowTimestamps?: Readonly<{
    sendTappedAt?: string;
    sendResolvedAt?: string;
    [key: string]: string | undefined;
  }>;
}>;

/** Whether the queued update is in the committed list: a deletion barrier for its id drops it. */
export function queuedUpdateSurvivedSave(
  nextUpdates: ReadonlyArray<Readonly<{ id: string }>>,
  queuedId: string,
): boolean {
  return nextUpdates.some(update => update.id === queuedId);
}

/** The draft as a new update. Photo ids stay: local files are named by them. */
export function reissueDraftAsNewUpdate<TDraft extends ReissuableDraft>(draft: TDraft, newId: string): TDraft {
  const { sendTappedAt: _sendTappedAt, sendResolvedAt: _sendResolvedAt, ...timestamps } = draft.workflowTimestamps ?? {};
  return {
    ...draft,
    id: newId,
    status: 'draft',
    stableSendId: null,
    idempotencyKey: null,
    sendAttempts: 0,
    lastSendAttemptAt: null,
    syncDiagnostics: null,
    deleteDiagnostics: null,
    archivedAt: null,
    isArchived: false,
    workflowTimestamps: timestamps,
    photos: draft.photos.map(photo => ({
      ...photo,
      cloudStoragePath: null,
      cloudRecoveredAt: null,
      cloudRecoveryStatus: null,
      cloudSignedUrlExpiresAt: null,
      cloudPreviewUri: null,
      cloudPreviewSignedUrlExpiresAt: null,
    })),
  };
}
