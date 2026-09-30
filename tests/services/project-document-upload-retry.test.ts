/**
 * Whole-app audit A8 pass 1 F5 (30 Sep 2026): a document added with no
 * signal (or caught in flight by a relaunch) was never uploaded again unless
 * the owner found its Retry button, so the other devices never saw it.
 */
import {
  createProjectDocumentUploadRetryRunner,
  projectDocumentsAwaitingUpload,
  projectDocumentsDueForUploadRetry,
  projectDocumentsStillUploadingNotice,
  projectDocumentUploadRetryDelayMs,
} from '../../services/ProjectDocumentUploadRetry';
import {
  createOwnedLocalFileManifest,
  createOwnedLocalFileManifestRecord,
} from '../../services/OwnedLocalFileRepository';

const NOW_MS = Date.parse('2026-09-30T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW_MS - ms).toISOString();

type Status = 'local' | 'uploading' | 'uploaded' | 'failed';
function doc(id: string, status: Status, extra: Record<string, unknown> = {}) {
  const fileId = `${id.padEnd(8, '0')}-e29b-41d4-a716-446655440000`;
  return {
    id,
    status,
    localUri: `file:///app/Documents/project-documents-v2/${fileId}.pdf`,
    ownedFileId: fileId,
    ownedFileManifest: createOwnedLocalFileManifest([createOwnedLocalFileManifestRecord({
      fileId,
      kind: 'project_document',
      generatedBasename: `${fileId}.pdf`,
      relativePath: `${fileId}.pdf`,
      sha256: '1'.repeat(64),
      sizeBytes: 10,
      mimeType: 'application/pdf',
    })]),
    uploadAttemptCount: 1,
    lastUploadAttemptAt: ago(60 * 60_000),
    ...extra,
  };
}

describe('which documents retry their upload by themselves', () => {
  it('takes failed and never-sent documents with a verified file on this phone', () => {
    const documents = [
      doc('failed', 'failed'),
      doc('local', 'local', { uploadAttemptCount: 0, lastUploadAttemptAt: null }),
      doc('uploading', 'uploading'),
      doc('uploaded', 'uploaded'),
    ];
    expect(projectDocumentsDueForUploadRetry(documents, NOW_MS).map(document => document.id))
      .toEqual(['failed', 'local']);
  });

  it('skips a document that must be added again: no verified file, no manifest entry', () => {
    const documents = [
      doc('no-uri', 'failed', { localUri: null }),
      doc('no-manifest', 'failed', { ownedFileManifest: null }),
      doc('legacy', 'failed', { ownedFileId: null, ownedFileManifest: null }),
      { ...doc('wrong-id', 'failed'), ownedFileId: 'another0-e29b-41d4-a716-446655440000' },
    ];
    expect(projectDocumentsAwaitingUpload(documents)).toEqual([]);
    expect(projectDocumentsDueForUploadRetry(documents, NOW_MS)).toEqual([]);
  });

  it('backs off 30 s, 2 min and 10 min after each attempt, then every 30 min', () => {
    expect(projectDocumentUploadRetryDelayMs(0)).toBe(0);
    expect(projectDocumentUploadRetryDelayMs(undefined)).toBe(0);
    expect(projectDocumentUploadRetryDelayMs(1)).toBe(30_000);
    expect(projectDocumentUploadRetryDelayMs(2)).toBe(120_000);
    expect(projectDocumentUploadRetryDelayMs(3)).toBe(600_000);
    expect(projectDocumentUploadRetryDelayMs(4)).toBe(1_800_000);
    expect(projectDocumentUploadRetryDelayMs(40)).toBe(1_800_000);

    const due = (attempts: number, sinceMs: number) => projectDocumentsDueForUploadRetry(
      [doc('d', 'failed', { uploadAttemptCount: attempts, lastUploadAttemptAt: ago(sinceMs) })],
      NOW_MS,
    ).length === 1;
    expect(due(1, 29_000)).toBe(false);
    expect(due(1, 30_000)).toBe(true);
    expect(due(2, 119_000)).toBe(false);
    expect(due(2, 120_000)).toBe(true);
    expect(due(3, 599_000)).toBe(false);
    expect(due(3, 600_000)).toBe(true);
    expect(due(9, 29 * 60_000)).toBe(false);
    expect(due(9, 30 * 60_000)).toBe(true);
    // A document never attempted, or with no readable attempt time, is due at once.
    expect(due(0, 0)).toBe(true);
    expect(projectDocumentsDueForUploadRetry(
      [doc('d', 'failed', { uploadAttemptCount: 3, lastUploadAttemptAt: 'not a date' })], NOW_MS,
    )).toHaveLength(1);
  });
});

describe('the retry runner', () => {
  it('uploads due documents one at a time, by id only, so no alert is shown', async () => {
    let documents = [
      doc('a', 'failed'),
      doc('b', 'failed', { lastUploadAttemptAt: ago(5_000) }),
      doc('c', 'local', { uploadAttemptCount: 0, lastUploadAttemptAt: null }),
    ];
    const runner = createProjectDocumentUploadRetryRunner(() => documents, () => NOW_MS);
    let active = 0;
    let maxActive = 0;
    const upload = jest.fn(async (...args: unknown[]) => {
      const documentId = args[0] as string;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      documents = documents.map(document => document.id === documentId
        ? { ...document, status: 'uploaded' as const }
        : document);
      return true;
    });

    await expect(runner.run(upload)).resolves.toEqual({ attempted: 2, uploaded: 2, remaining: 1 });
    expect(maxActive).toBe(1);
    expect(upload.mock.calls).toEqual([['a'], ['c']]);
    // 'b' failed five seconds ago: Sync Now does not wait for its backoff.
    await expect(runner.run(upload, { ignoreBackoff: true }))
      .resolves.toEqual({ attempted: 1, uploaded: 1, remaining: 0 });
    expect(upload.mock.calls[2]).toEqual(['b']);
  });

  it('tries each document once per run, and a failure or throw does not stop the rest', async () => {
    const documents = [doc('a', 'failed'), doc('b', 'failed'), doc('c', 'failed')];
    const runner = createProjectDocumentUploadRetryRunner(() => documents, () => NOW_MS);
    const upload = jest.fn(async (documentId: string) => {
      if (documentId === 'a') return false;
      if (documentId === 'b') throw new Error('offline');
      return undefined;
    });
    await expect(runner.run(upload)).resolves.toEqual({ attempted: 3, uploaded: 0, remaining: 3 });
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it('shares a run already in flight instead of starting a second', async () => {
    let documents = [doc('a', 'failed')];
    const runner = createProjectDocumentUploadRetryRunner(() => documents, () => NOW_MS);
    let finish: () => void = () => undefined;
    const upload = jest.fn(() => new Promise<boolean>(resolve => {
      finish = () => {
        documents = [{ ...documents[0], status: 'uploaded' as const }];
        resolve(true);
      };
    }));
    const first = runner.run(upload);
    const second = runner.run(upload, { ignoreBackoff: true });
    expect(second).toBe(first);
    await Promise.resolve();
    finish();
    await expect(first).resolves.toEqual({ attempted: 1, uploaded: 1, remaining: 0 });
    expect(upload).toHaveBeenCalledTimes(1);
    // Once settled, the next trigger starts a new run.
    await expect(runner.run(upload)).resolves.toEqual({ attempted: 0, uploaded: 0, remaining: 0 });
  });

  it('says how many documents are still waiting, or nothing', () => {
    expect(projectDocumentsStillUploadingNotice(0)).toBe('');
    expect(projectDocumentsStillUploadingNotice(1)).toBe('1 document saved on this phone has not uploaded yet; it retries automatically.');
    expect(projectDocumentsStillUploadingNotice(3)).toBe('3 documents saved on this phone have not uploaded yet; they retry automatically.');
  });
});

describe('App wiring (audit A8 pass 1 F5)', () => {
  const fs = jest.requireActual('fs') as typeof import('fs');
  const path = jest.requireActual('path') as typeof import('path');
  const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
  const app = read('App.tsx');
  const runner = read('services/ProjectDocumentUploadRetry.ts');
  const retryCall = 'void projectDocumentUploadRetry.run(retryProjectDocumentUpload);';

  it('keeps one runner over the live document list', () => {
    expect(app).toContain('const [projectDocumentUploadRetry] = useState(() => createProjectDocumentUploadRetryRunner(() => projectDocumentsCurrentRef.current));');
  });

  it('retries after startup hydration, when the app becomes active, and when the connection returns', () => {
    expect(app).toMatch(/useEffect\(\(\) => \{ if \(startupHydrationReady && projectDocumentsLoaded\) void projectDocumentUploadRetry\.run\(retryProjectDocumentUpload\); \}, \[projectDocumentsLoaded, startupHydrationReady\]\);/);
    expect(app).toMatch(new RegExp(
      "AppState\\.addEventListener\\('change', state => \\{\\n\\s+if \\(state !== 'active'\\) return;\\n\\s+startAutomaticSyncBackgroundTask\\('app_active', hydrateQueuedUpdates\\);\\n\\s+"
        + retryCall.replace(/[.()]/g, '\\$&'),
    ));
    expect(app).toMatch(new RegExp(
      "startAutomaticSyncBackgroundTask\\('realtime_reconnected', hydrateQueuedUpdates\\);\\n\\s+"
        + retryCall.replace(/[.()]/g, '\\$&'),
    ));
    expect(app.split(retryCall)).toHaveLength(4);
  });

  it('gives Settings a retry that does not wait for backoff, and the count of documents waiting', () => {
    expect(app).toContain('onRetryDocumentUploads={() => projectDocumentUploadRetry.run(retryProjectDocumentUpload, { ignoreBackoff: true })}');
    expect(app).toContain('failedDocumentCount={projectDocumentsAwaitingUpload(projectDocuments).length}');
  });

  it('never passes the document, so the upload shows no alert; its alerts need the document', () => {
    expect(runner).toContain('await upload(next.id)');
    const retry = app.match(/async function retryProjectDocumentUpload\([\s\S]+?\n  async function replaceProjectDocumentFile/)?.[0] || '';
    expect(retry.match(/Alert\.alert\(/g)).toHaveLength(4);
    expect(retry.match(/if \(providedDocument\) \{\n\s+Alert\.alert\(/g)).toHaveLength(3);
    // The fourth asks for the file again; the runner skips documents that need it.
    expect(retry).toContain("error.message === PROJECT_DOCUMENT_REIMPORT_REQUIRED_MESSAGE) {\n        Alert.alert(\n          'Add document again',");
  });
});
