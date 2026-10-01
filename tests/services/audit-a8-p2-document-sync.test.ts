/**
 * Whole-app audit A8 pass 2 (30 Sep 2026), phone documents reaching the
 * shared record:
 *
 * #4 An archived document whose file never uploaded was still counted as
 *    pending and uploaded by the automatic retry, and one archived while its
 *    upload was in flight was shared with the other devices.
 * #5 After a long spell offline a document could wait up to 30 minutes once
 *    the signal returned: every automatic attempt without signal raised the
 *    attempt count behind the backoff. A failure for want of signal is no
 *    longer counted.
 * #7 Text typed less than 0.7 s before Make Current could drop out of the
 *    shared copy: its queued record waited for the typing pause. Make
 *    Current now sends it first.
 * #9 An edit to a Current document shared with several projects narrowed
 *    its project list to one, which the cloud refuses, and Sync Now showed
 *    the refusal's raw database code.
 *
 * retryProjectDocumentUpload and activateReferenceDocument run compiled from
 * App.tsx, with the real services.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import {
  bindProjectDocumentUploadToAccount,
  createProjectDocumentUploadRetryRunner,
  projectDocumentsAwaitingUpload,
  projectDocumentsDueForUploadRetry,
  projectDocumentUploadAttemptsAfterFailure,
  uploadedProjectDocumentToShare,
} from '../../services/ProjectDocumentUploadRetry';
import {
  createProjectDocumentSharedRecordSyncLifecycle,
  flushProjectDocumentSharedRecordSync,
  scheduleProjectDocumentSharedRecordSync,
} from '../../services/ProjectDocumentSharedRecordSyncLifecycle';
import { synchronizeSharedReferenceDocumentMetadata } from '../../services/ProjectDocumentLifecycle';
import { cloudWriteFailureReason } from '../../services/SyncService';
import {
  createOwnedLocalFileManifest,
  createOwnedLocalFileManifestRecord,
} from '../../services/OwnedLocalFileRepository';
import type { ReferenceDocument } from '../../types';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** A function of the App component (two-space indent), brace-matched. */
function componentFunction(name: string): string {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no component function ${name}`);
  const open = app.indexOf(' {\n', match.index) + 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(match.index + 3, index + 1);
    }
  }
  throw new Error('unbalanced function');
}

function compile<T>(names: string[], deps: Record<string, unknown>): T {
  const js = ts.transpileModule(
    [...names.map(componentFunction), `module.exports = { ${names.join(', ')} };`].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const mod = { exports: {} as T };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports;
}

const NOW_MS = Date.parse('2026-09-30T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW_MS - ms).toISOString();

type Status = 'local' | 'uploading' | 'uploaded' | 'failed';
function phoneDocument(id: string, status: Status, extra: Record<string, unknown> = {}) {
  const fileId = `${id.padEnd(8, '0')}-e29b-41d4-a716-446655440000`;
  return {
    id, status, projectId: 'alpha-key', name: `${id}.pdf`, category: 'Permit', mimeType: 'application/pdf', sizeBytes: 10,
    localUri: `file:///app/Documents/project-documents-v2/${fileId}.pdf`,
    ownedFileId: fileId,
    ownedFileManifest: createOwnedLocalFileManifest([createOwnedLocalFileManifestRecord({
      fileId, kind: 'project_document', generatedBasename: `${fileId}.pdf`, relativePath: `${fileId}.pdf`,
      sha256: '1'.repeat(64), sizeBytes: 10, mimeType: 'application/pdf',
    })]),
    uploadAttemptCount: 1,
    lastUploadAttemptAt: ago(60 * 60_000),
    updatedAt: ago(60 * 60_000),
    importedAt: ago(60 * 60_000),
    ...extra,
  };
}
type PhoneDocument = ReturnType<typeof phoneDocument> & { isArchived?: boolean; uploadedAt?: string; uploadProgress?: number | null };

/** retryProjectDocumentUpload and the list it updates, compiled from App.tsx. */
function uploader(documents: PhoneDocument[], upload: (document: PhoneDocument) => Promise<{ ok: boolean; stubbed?: boolean; error?: string }>) {
  const projectDocumentsCurrentRef = { current: documents };
  const published: string[] = [];
  // The list's state, set as React does and read back into the ref as a render does. Updates are
  // functional since audit A8 pass 3 L3.
  let state = documents;
  const deps: Record<string, unknown> = {
    projectDocumentsCurrentRef, draft: { documents: [] },
    setProjectDocuments: (next: PhoneDocument[] | ((prev: PhoneDocument[]) => PhoneDocument[])) => {
      state = typeof next === 'function' ? next(state) : next;
      projectDocumentsCurrentRef.current = state;
    },
    setDraft: jest.fn(), setSavedUpdates: jest.fn(),
    buildProjectDocumentStoragePath: (id: string) => `owner/${id}.pdf`,
    verifyOwnedProjectDocument: async () => undefined,
    uploadPhoto: async () => upload(projectDocumentsCurrentRef.current[0]),
    PROJECT_DOCUMENT_UPLOAD_FOLDER: 'project-documents', MAX_PROJECT_DOCUMENT_FILE_BYTES: 1e9,
    persistProjectDocumentsImmediately: async () => undefined,
    publishUploadedProjectDocument: async (document: PhoneDocument) => { published.push(document.id); },
    PROJECT_DOCUMENT_REIMPORT_REQUIRED_MESSAGE: 'add again', reportStoragePersistenceFailure: jest.fn(),
    PROJECT_DOCUMENTS_STORAGE_KEY: 'projectDocuments', Alert: { alert: jest.fn() },
    projectDocumentUploadAttemptsAfterFailure,
    // Audit A8 pass 3 M3 (landed after this test): the upload stops once another account signs in.
    bindProjectDocumentUploadToAccount,
    // Audit A8 pass 4 L4 (landed after this test): the document is read again from the list before it is shared.
    uploadedProjectDocumentToShare,
    // Audit A7 pass 5 M1 (landed after this test): a finished upload sends each sent update listing it again.
    resendUpdatesListingDocument: jest.fn(), withDeviceDocumentUploadState: (update: unknown) => update,
  };
  const { retryProjectDocumentUpload } = compile<{
    retryProjectDocumentUpload: (documentId: string) => Promise<boolean | undefined>;
  }>(['updateDocumentEverywhere', 'retryProjectDocumentUpload'], deps);
  return { retryProjectDocumentUpload, projectDocumentsCurrentRef, published,
    setProjectDocuments: deps.setProjectDocuments as (next: (prev: PhoneDocument[]) => PhoneDocument[]) => void };
}

describe('archived documents are not uploaded or shared (audit A8 pass 2 #4)', () => {
  it('are not waiting for upload: not in the runner, the Settings count, the sign-out count or the Sync Now notice', async () => {
    const documents = [
      phoneDocument('archived', 'failed', { isArchived: true }),
      phoneDocument('never-sent', 'local', { isArchived: true, uploadAttemptCount: 0, lastUploadAttemptAt: null }),
      phoneDocument('active', 'failed'),
    ];
    expect(projectDocumentsAwaitingUpload(documents).map(document => document.id)).toEqual(['active']);
    const upload = jest.fn(async () => true);
    const runner = createProjectDocumentUploadRetryRunner(() => documents, () => NOW_MS);
    await expect(runner.run(upload, { ignoreBackoff: true })).resolves.toEqual({ attempted: 1, uploaded: 1, remaining: 1 });
    expect(upload.mock.calls).toEqual([['active']]);
  });

  it('one archived while its upload was in flight is not shared; one still active is', async () => {
    const archivedMidway = uploader([phoneDocument('permit', 'failed')], async () => {
      // Archived as the app does it: a functional update of the list (audit A8 pass 3 L3).
      archivedMidway.setProjectDocuments(prev => prev.map(document => ({ ...document, isArchived: true })));
      return { ok: true };
    });
    await expect(archivedMidway.retryProjectDocumentUpload('permit')).resolves.toBe(true);
    expect(archivedMidway.projectDocumentsCurrentRef.current[0]).toMatchObject({ status: 'uploaded', isArchived: true });
    expect(archivedMidway.published).toEqual([]);

    const active = uploader([phoneDocument('permit', 'failed')], async () => ({ ok: true }));
    await active.retryProjectDocumentUpload('permit');
    expect(active.published).toEqual(['permit']);
  });
});

describe('an attempt without signal is not counted toward the backoff (audit A8 pass 2 #5)', () => {
  it('a document added offline is due as soon as the signal returns, however many offline tries there were', async () => {
    const h = uploader(
      [phoneDocument('permit', 'local', { uploadAttemptCount: 0, lastUploadAttemptAt: null })],
      async () => ({ ok: false, error: 'Network request failed' }),
    );
    for (let attempt = 0; attempt < 6; attempt += 1) await h.retryProjectDocumentUpload('permit');
    const [permit] = h.projectDocumentsCurrentRef.current;
    expect(permit).toMatchObject({ status: 'failed', uploadAttemptCount: 0 });
    // Signal returns a second after the last offline try.
    expect(projectDocumentsDueForUploadRetry([permit], Date.parse(permit.lastUploadAttemptAt as string) + 1_000)).toHaveLength(1);
  });

  it('a thrown offline failure is not counted either; a real refusal still is', async () => {
    const thrown = uploader([phoneDocument('permit', 'failed', { uploadAttemptCount: 2 })], async () => {
      throw new TypeError('Network request failed');
    });
    await thrown.retryProjectDocumentUpload('permit');
    expect(thrown.projectDocumentsCurrentRef.current[0].uploadAttemptCount).toBe(2);

    const refused = uploader([phoneDocument('permit', 'failed', { uploadAttemptCount: 2 })], async () => ({ ok: false, error: 'new row violates row-level security policy' }));
    await refused.retryProjectDocumentUpload('permit');
    expect(refused.projectDocumentsCurrentRef.current[0].uploadAttemptCount).toBe(3);
  });

  it('the rule', () => {
    expect(projectDocumentUploadAttemptsAfterFailure(5, 'Network request failed')).toBe(4);
    expect(projectDocumentUploadAttemptsAfterFailure(5, new Error('The Internet connection appears to be offline.'))).toBe(4);
    expect(projectDocumentUploadAttemptsAfterFailure(0, 'Failed to fetch')).toBe(0);
    expect(projectDocumentUploadAttemptsAfterFailure(5, 'Bucket not found')).toBe(5);
    expect(projectDocumentUploadAttemptsAfterFailure(undefined, undefined)).toBe(0);
  });
});

describe('Make Current sends text still waiting for the document first (audit A8 pass 2 #7)', () => {
  const shared = {
    id: 'shared-1', name: 'Permit rev B', originalFileName: 'Permit rev B.pdf', uri: '', category: 'Drawing', notes: 'Stamped',
    isCurrent: false, importedAt: ago(0), cloudUpdatedAt: 'c1',
  } as ReferenceDocument;

  it('App.tsx activateReferenceDocument, compiled: the typed text is queued before the cloud activation', async () => {
    jest.useFakeTimers();
    try {
      const events: string[] = [];
      const referenceDocumentsCurrentRef = { current: [shared] };
      const lifecycle = createProjectDocumentSharedRecordSyncLifecycle();
      const onReady = (documentId: string) => {
        const latest = referenceDocumentsCurrentRef.current.find(document => document.id === documentId);
        events.push(`queued ${latest?.notes}`);
      };
      // Typed 0.3 s before Make Current: the pause has not passed.
      scheduleProjectDocumentSharedRecordSync({ lifecycle, documentId: 'shared-1', onReady });
      const deps: Record<string, unknown> = {
        referenceDocumentsCurrentRef, currentReferenceActivationIdsRef: { current: new Set<string>() },
        scheduleDocumentIsCurrentEverywhere: () => false,
        buildECOSDocumentReadiness: () => ({ canMakeCurrent: true, detail: '' }), canonicalReferenceCategory: () => 'drawing',
        projectDocumentSharedRecordSync: { flush: (documentId: string) => flushProjectDocumentSharedRecordSync({ lifecycle, documentId, onReady }) },
        activateSharedReferenceDocument: async () => { events.push('activate'); return { status: 'activated', documents: null }; },
        getSupabaseClient: () => null, listReferenceDocuments: async () => ({ ok: false }), normalizeReferenceDocuments: (rows: unknown) => rows,
        scheduleRetirementMessage: () => '', Alert: { alert: jest.fn() },
      };
      const { activateReferenceDocument } = compile<{ activateReferenceDocument: (id: string) => Promise<boolean> }>(
        ['activateReferenceDocument'], deps);
      await expect(activateReferenceDocument('shared-1')).resolves.toBe(true);
      expect(events).toEqual(['queued Stamped', 'activate']);
      jest.advanceTimersByTime(1_000);
      expect(events).toEqual(['queued Stamped', 'activate']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('queues nothing when no text is waiting, and only the document made current', () => {
    const lifecycle = createProjectDocumentSharedRecordSyncLifecycle();
    const onReady = jest.fn();
    expect(flushProjectDocumentSharedRecordSync({ lifecycle, documentId: 'shared-1', onReady })).toBe(false);
    jest.useFakeTimers();
    try {
      scheduleProjectDocumentSharedRecordSync({ lifecycle, documentId: 'other', onReady });
      expect(flushProjectDocumentSharedRecordSync({ lifecycle, documentId: 'shared-1', onReady })).toBe(false);
      expect(onReady).not.toHaveBeenCalled();
      jest.advanceTimersByTime(700);
      expect(onReady.mock.calls).toEqual([['other']]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('edits to a Current document shared with several projects (audit A8 pass 2 #9)', () => {
  const card = {
    id: 'phone-a201', projectId: 'alpha-key', name: 'A-201.pdf', category: 'Drawing' as const, importedAt: ago(0),
    note: 'Field verified', drawingNumber: 'A-201',
  };
  const sharedWith = (projectNames: string[], extra: Partial<ReferenceDocument> = {}) => ({
    id: 'shared-a201', name: 'A-201', originalFileName: 'A-201.pdf', uri: '', category: 'Drawing', notes: '',
    isCurrent: true, importedAt: ago(0), projectId: null, projectName: null, projectNames, drawingNumber: 'A-201', ...extra,
  } as ReferenceDocument);

  it('keeps the shared copy\'s projects when they include this one', () => {
    const next = synchronizeSharedReferenceDocumentMetadata({
      document: card, sharedDocument: sharedWith(['Alpha', 'Beta']), projectName: 'alpha', updatedAt: 'T',
    });
    expect(next).toMatchObject({ notes: 'Field verified', projectNames: ['Alpha', 'Beta'], projectName: null, projectId: null });
  });

  it('as before, labels a single-project copy or one without this project with this project', () => {
    expect(synchronizeSharedReferenceDocumentMetadata({
      document: card, sharedDocument: sharedWith(['Alpha'], { projectName: 'Alpha' }), projectName: 'Alpha', updatedAt: 'T',
    })).toMatchObject({ projectNames: ['Alpha'], projectName: 'Alpha' });
    expect(synchronizeSharedReferenceDocumentMetadata({
      document: card, sharedDocument: sharedWith(['Beta', 'Gamma']), projectName: 'Alpha', updatedAt: 'T',
    })).toMatchObject({ projectNames: ['Alpha'], projectName: 'Alpha' });
  });

  it('Sync Now names the cloud\'s refusal in words, as the queue does', () => {
    expect(cloudWriteFailureReason({ error: 'ecos_atomic_current_activation_required' })).toBe(
      ' This drawing is Current for ECOS, so the cloud kept its shared record. Make another revision current first, then edit this one again.',
    );
    expect(cloudWriteFailureReason({ error: 'Bucket not found' })).toBe(' Bucket not found');
    const sync = fs.readFileSync(path.resolve(__dirname, '../../services/SyncService.ts'), 'utf8');
    expect(sync).toContain('`Document “${document.name}” could not sync.${cloudWriteFailureReason(result)}`');
  });
});
