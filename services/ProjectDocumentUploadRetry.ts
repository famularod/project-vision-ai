/**
 * A document added with no signal failed its one upload attempt, and a
 * relaunch turns an upload in flight into a failure. Nothing tried again:
 * the pending-changes retry walks only the sync queue, and a document's
 * shared record is queued only after its file uploads, so the iPad and the
 * web never saw it (whole-app audit A8 pass 1 F5, 30 Sep 2026). These
 * documents now upload by themselves when the app becomes active, when the
 * connection returns, after startup, and on Sync Now.
 */

import { cloudOwnerUnchanged, currentCloudOwner } from './CloudOwnerBinding';
import { requireOwnedProjectDocumentAccess } from './ProjectDocumentLifecycle';
import { classifySyncFailureText } from './SyncFailureCategory';

type UploadRetryDocument = Readonly<{
  id: string;
  status: 'local' | 'uploading' | 'uploaded' | 'failed';
  localUri?: string | null;
  ownedFileId?: string | null;
  ownedFileManifest?: unknown;
  uploadAttemptCount?: number;
  lastUploadAttemptAt?: string | null;
  isArchived?: boolean | null;
}>;

/** Wait after the 1st, 2nd, 3rd and every later attempt. */
export const PROJECT_DOCUMENT_UPLOAD_RETRY_BACKOFF_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
] as const;

export type ProjectDocumentUploadRetryResult = Readonly<{
  attempted: number;
  uploaded: number;
  /** Documents with a verified file on this phone still not uploaded. */
  remaining: number;
}>;

export function projectDocumentUploadRetryDelayMs(attemptCount: number | null | undefined): number {
  const attempts = Math.floor(Number(attemptCount) || 0);
  if (attempts <= 0) return 0;
  const steps = PROJECT_DOCUMENT_UPLOAD_RETRY_BACKOFF_MS;
  return steps[Math.min(attempts, steps.length) - 1];
}

/**
 * Failed or never-sent documents whose file is still in verified app
 * storage. One that must be added again is left for the owner: retrying it
 * cannot succeed, and the upload asks for the file again with an alert. An
 * archived document is not uploaded: it was counted as pending and shared
 * with the other devices after the owner archived it (whole-app audit A8
 * pass 2 #4).
 */
export function projectDocumentsAwaitingUpload<T extends UploadRetryDocument>(
  documents: readonly T[],
): T[] {
  return documents.filter(document =>
    (document.status === 'failed' || document.status === 'local') &&
    !document.isArchived &&
    hasVerifiedLocalFile(document));
}

/**
 * The attempt count after a failed upload, from the count recorded when it
 * began. An attempt that failed for want of signal is taken back: each
 * automatic attempt during a long spell offline raised it, so once the
 * signal returned the document waited up to 30 minutes for its next try
 * (whole-app audit A8 pass 2 #5).
 */
export function projectDocumentUploadAttemptsAfterFailure(
  recordedAttempts: number | null | undefined,
  failure: unknown,
): number {
  const recorded = Math.max(0, Math.floor(Number(recordedAttempts) || 0));
  const message = failure instanceof Error ? failure.message : typeof failure === 'string' ? failure : '';
  return classifySyncFailureText([message]) === 'offline' ? Math.max(0, recorded - 1) : recorded;
}

/** The documents awaiting upload whose backoff since the last attempt has passed. */
export function projectDocumentsDueForUploadRetry<T extends UploadRetryDocument>(
  documents: readonly T[],
  nowMs: number,
): T[] {
  return projectDocumentsAwaitingUpload(documents).filter(document => {
    const lastAttemptMs = Date.parse(document.lastUploadAttemptAt || '');
    if (!Number.isFinite(lastAttemptMs)) return true;
    return nowMs - lastAttemptMs >= projectDocumentUploadRetryDelayMs(document.uploadAttemptCount);
  });
}

/**
 * True while the account signed in when an upload began is still the one
 * signed in. A sign-out closes the workspace, but a document upload already
 * running carried on: the runner kept walking the first account's list,
 * uploaded its documents with the next account's session, shared them into
 * that account, and saved the first account's list over the next one's
 * documents on this phone (whole-app audit A8 pass 3 M3). Uses the same
 * account binding as the sync queue (audit A1 M3).
 */
export function bindProjectDocumentUploadToAccount(): () => boolean {
  const owner = currentCloudOwner();
  return () => cloudOwnerUnchanged(owner);
}

/**
 * Uploads the documents that are due, one at a time. A run already in
 * flight is shared rather than started twice. The upload is called with the
 * document id only: without the document itself it shows no alert, so a
 * background attempt never interrupts the owner. A run stops once another
 * account signs in; that account's workspace starts its own.
 */
export function createProjectDocumentUploadRetryRunner<T extends UploadRetryDocument>(
  getDocuments: () => readonly T[],
  now: () => number = Date.now,
) {
  let inFlight: Promise<ProjectDocumentUploadRetryResult> | null = null;

  async function runDue(
    upload: (documentId: string) => Promise<unknown>,
    ignoreBackoff: boolean,
  ): Promise<ProjectDocumentUploadRetryResult> {
    const attempted = new Set<string>();
    const sameAccount = bindProjectDocumentUploadToAccount();
    let uploaded = 0;
    while (sameAccount()) {
      const due = ignoreBackoff
        ? projectDocumentsAwaitingUpload(getDocuments())
        : projectDocumentsDueForUploadRetry(getDocuments(), now());
      const next = due.find(document => !attempted.has(document.id));
      if (!next) break;
      attempted.add(next.id);
      try {
        if (await upload(next.id) === true) uploaded += 1;
      } catch {
        // The document stays failed on this phone; the next trigger retries it.
      }
    }
    return {
      attempted: attempted.size,
      uploaded,
      remaining: projectDocumentsAwaitingUpload(getDocuments()).length,
    };
  }

  return {
    run(
      upload: (documentId: string) => Promise<unknown>,
      options?: Readonly<{ ignoreBackoff?: boolean }>,
    ): Promise<ProjectDocumentUploadRetryResult> {
      if (inFlight) return inFlight;
      inFlight = runDue(upload, Boolean(options?.ignoreBackoff)).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

/**
 * Retry Sync and Sync Now start the document uploads without waiting for
 * them: a slow upload held back the field updates and the data sync, and
 * Retry Sync gave up after 30 seconds without retrying the updates at all
 * (whole-app audit A8 pass 2 #6). At the end a finished run gives its own
 * count; a run still going counts the documents waiting now and the one it
 * is uploading.
 */
export function startProjectDocumentUploadRun(
  run: () => Promise<ProjectDocumentUploadRetryResult>,
): Readonly<{ remaining: (waitingNow: number) => number }> {
  let finished: ProjectDocumentUploadRetryResult | null = null;
  let failed = false;
  let started: Promise<ProjectDocumentUploadRetryResult>;
  try {
    started = run();
  } catch (error) {
    started = Promise.reject(error);
  }
  started.then(result => { finished = result; }, () => { failed = true; });
  return {
    remaining(waitingNow: number) {
      if (finished) return finished.remaining;
      return failed ? waitingNow : waitingNow + 1;
    },
  };
}

/** Said after Sync Now or Retry Sync when a document could not upload. */
export function projectDocumentsStillUploadingNotice(remaining: number): string {
  if (remaining <= 0) return '';
  return remaining === 1
    ? '1 document saved on this phone has not uploaded yet; it retries automatically.'
    : `${remaining} documents saved on this phone have not uploaded yet; they retry automatically.`;
}

function hasVerifiedLocalFile(document: UploadRetryDocument): boolean {
  try {
    requireOwnedProjectDocumentAccess(document);
    return true;
  } catch {
    return false;
  }
}
