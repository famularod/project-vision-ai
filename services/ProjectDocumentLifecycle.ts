/**
 * Audit P1-23: an upload cannot survive an app relaunch, so any document
 * still marked 'uploading' at startup hydration is a stale in-flight state
 * from a killed process. Left alone it reads as "pending" forever and offers
 * no retry. Recovery converts it to the retryable 'failed' state.
 */

type UploadLifecycleDocument = {
  status: 'local' | 'uploading' | 'uploaded' | 'failed';
  updatedAt: string;
};

export function recoverStaleUploadingDocuments<T extends UploadLifecycleDocument>(
  documents: readonly T[],
  now: string = new Date().toISOString(),
): T[] {
  return documents.map(document =>
    document.status === 'uploading'
      ? { ...document, status: 'failed' as const, updatedAt: now }
      : document,
  );
}
