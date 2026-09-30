/**
 * Text typed on a phone document card is saved on the phone at every
 * keystroke, but its shared record is queued for the cloud only once typing
 * pauses. Queuing every keystroke started an upload per keystroke, and the
 * cloud copy of an earlier keystroke could then outrank the last one, so the
 * iPad and the cloud kept the text cut short (whole-app audit A8 pass 1 F1
 * (30 Sep 2026)). Mirrors ScheduleItemTextSyncLifecycle, including the flush
 * when the app goes to the background. The latest shared record is read when
 * the timer fires, so no revision number is needed.
 */
export type ProjectDocumentSharedRecordSyncTimer = ReturnType<typeof setTimeout>;

export type ProjectDocumentSharedRecordSyncLifecycle = {
  pendingIds: Set<string>;
  timers: Map<string, ProjectDocumentSharedRecordSyncTimer>;
};

const DEBOUNCED_PROJECT_DOCUMENT_CHANGE_KEYS = new Set([
  'name',
  'note',
  'drawingNumber',
  'drawingRevision',
  'drawingDiscipline',
  'drawingIssuedAt',
]);

/** Typed text waits for a pause; a chip tap (category, status, area, update) is sent at once. */
export function projectDocumentChangeUsesDebouncedSync(next: object): boolean {
  const changedKeys = Object.keys(next);
  return (
    changedKeys.length > 0 &&
    changedKeys.every(key => DEBOUNCED_PROJECT_DOCUMENT_CHANGE_KEYS.has(key))
  );
}

export function createProjectDocumentSharedRecordSyncLifecycle(): ProjectDocumentSharedRecordSyncLifecycle {
  return {
    pendingIds: new Set<string>(),
    timers: new Map<string, ProjectDocumentSharedRecordSyncTimer>(),
  };
}

export function scheduleProjectDocumentSharedRecordSync({
  lifecycle,
  documentId,
  onReady,
  delayMs = 700,
}: {
  lifecycle: ProjectDocumentSharedRecordSyncLifecycle;
  documentId: string;
  onReady: (documentId: string) => void;
  delayMs?: number;
}): void {
  const existingTimer = lifecycle.timers.get(documentId);
  if (existingTimer) clearTimeout(existingTimer);

  lifecycle.pendingIds.add(documentId);
  const timer = setTimeout(() => {
    lifecycle.timers.delete(documentId);
    lifecycle.pendingIds.delete(documentId);
    onReady(documentId);
  }, delayMs);
  lifecycle.timers.set(documentId, timer);
}

export function flushPendingProjectDocumentSharedRecordSync({
  lifecycle,
  onReady,
}: {
  lifecycle: ProjectDocumentSharedRecordSyncLifecycle;
  onReady: (documentId: string) => void;
}): string[] {
  const pendingDocumentIds = [...lifecycle.pendingIds];
  pendingDocumentIds.forEach(documentId => {
    settleProjectDocumentSharedRecordSync(lifecycle, documentId);
    onReady(documentId);
  });
  return pendingDocumentIds;
}

/** A chip tap sends any text still waiting, then this document's record, at once. */
export function queueProjectDocumentSharedRecordNow({
  lifecycle,
  documentId,
  onReady,
}: {
  lifecycle: ProjectDocumentSharedRecordSyncLifecycle;
  documentId: string;
  onReady: (documentId: string) => void;
}): void {
  const flushed = flushPendingProjectDocumentSharedRecordSync({ lifecycle, onReady });
  if (!flushed.includes(documentId)) onReady(documentId);
}

export function settleProjectDocumentSharedRecordSync(
  lifecycle: ProjectDocumentSharedRecordSyncLifecycle,
  documentId: string,
): void {
  const timer = lifecycle.timers.get(documentId);
  if (timer) clearTimeout(timer);
  lifecycle.timers.delete(documentId);
  lifecycle.pendingIds.delete(documentId);
}

export function cancelProjectDocumentSharedRecordSync(
  lifecycle: ProjectDocumentSharedRecordSyncLifecycle,
  documentId: string,
): void {
  settleProjectDocumentSharedRecordSync(lifecycle, documentId);
}

export function disposeProjectDocumentSharedRecordSyncLifecycle(
  lifecycle: ProjectDocumentSharedRecordSyncLifecycle,
): void {
  lifecycle.timers.forEach(timer => clearTimeout(timer));
  lifecycle.timers.clear();
  lifecycle.pendingIds.clear();
}
