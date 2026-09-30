/**
 * Whole-app audit A8 pass 3 (30 Sep 2026), phone document uploads:
 *
 * M3 A document upload already running carried on after a sign-out and
 *    another account's sign-in. The sign-out closes the first account's
 *    workspace, but its retry runner kept walking that account's list,
 *    uploaded its documents with the next account's session, shared them
 *    into that account, and saved the first account's list over the next
 *    account's documents on this phone. An upload run now stops, and an
 *    upload in flight writes and shares nothing, once the account changes.
 * L3 A delete or archive during an upload could be undone: each progress
 *    step set the whole list from a snapshot, so one landing between the
 *    delete and the next render put the document back, and the finished
 *    upload saved it back to the phone.
 * Retry on a document card (and on a field update's document) said nothing
 *    when the upload failed: it was passed no document, and only a passed
 *    document is told about.
 *
 * retryProjectDocumentUpload, updateDocumentEverywhere and
 * deleteProjectDocument run compiled from App.tsx with the real services.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import { noteSignedInOwner } from '../../services/CloudOwnerBinding';
import {
  bindProjectDocumentUploadToAccount,
  createProjectDocumentUploadRetryRunner,
  projectDocumentUploadAttemptsAfterFailure,
} from '../../services/ProjectDocumentUploadRetry';
import {
  createOwnedLocalFileManifest,
  createOwnedLocalFileManifestRecord,
} from '../../services/OwnedLocalFileRepository';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** A function of the App component (two-space indent), brace-matched. */
function componentFunction(name: string): string {
  const arrow = new RegExp(`\\n  const ${name} = [^\\n]+\\n(?:    [^\\n]+\\n)*`).exec(app);
  if (arrow) return arrow[0].trim();
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

type PhoneDocument = {
  id: string; status: 'local' | 'uploading' | 'uploaded' | 'failed'; projectId: string; name: string; category: string;
  mimeType: string; sizeBytes: number; localUri: string; ownedFileId: string; ownedFileManifest: unknown;
  uploadAttemptCount?: number; lastUploadAttemptAt?: string | null; updatedAt: string; importedAt: string;
  uploadProgress?: number | null; isArchived?: boolean;
};
function phoneDocument(id: string, extra: Partial<PhoneDocument> = {}): PhoneDocument {
  const fileId = `${id.padEnd(8, '0').slice(0, 8)}-e29b-41d4-a716-446655440000`;
  return {
    id, status: 'failed', projectId: 'alpha-key', name: `${id}.pdf`, category: 'Permit', mimeType: 'application/pdf', sizeBytes: 10,
    localUri: `file:///app/Documents/project-documents-v2/${fileId}.pdf`, ownedFileId: fileId,
    ownedFileManifest: createOwnedLocalFileManifest([createOwnedLocalFileManifestRecord({
      fileId, kind: 'project_document', generatedBasename: `${fileId}.pdf`, relativePath: `${fileId}.pdf`,
      sha256: '1'.repeat(64), sizeBytes: 10, mimeType: 'application/pdf',
    })]),
    uploadAttemptCount: 0, lastUploadAttemptAt: null, updatedAt: '2026-09-30T08:00:00.000Z', importedAt: '2026-09-30T08:00:00.000Z',
    ...extra,
  };
}

/**
 * The phone as these functions see it. The list's state is set as React
 * does; `render()` reads it back into the ref, as each render does.
 */
function phone(documents: PhoneDocument[], upload: (onProgress: (progress: number) => void) => Promise<{ ok: boolean; error?: string }>) {
  let state = documents;
  const projectDocumentsCurrentRef = { current: documents };
  const persisted: PhoneDocument[][] = [];
  const published: string[] = [];
  const alerts: Array<{ title: string; buttons: Array<{ text: string; onPress?: () => void }> }> = [];
  const deps: Record<string, unknown> = {
    projectDocumentsCurrentRef, draft: { documents: [] },
    get projectDocuments() { return state; },
    setProjectDocuments: (next: PhoneDocument[] | ((prev: PhoneDocument[]) => PhoneDocument[])) => {
      state = typeof next === 'function' ? next(state) : next;
    },
    setDraft: jest.fn(), setSavedUpdates: jest.fn(),
    buildProjectDocumentStoragePath: (id: string) => `project-documents/alpha-key/${id}/${id}.pdf`,
    verifyOwnedProjectDocument: async () => undefined,
    uploadPhoto: async ({ onProgress }: { onProgress: (progress: number) => void }) => upload(onProgress),
    PROJECT_DOCUMENT_UPLOAD_FOLDER: 'project-documents', MAX_PROJECT_DOCUMENT_FILE_BYTES: 1e9,
    persistProjectDocumentsImmediately: async (list: PhoneDocument[]) => { persisted.push(list); },
    publishUploadedProjectDocument: async (document: PhoneDocument) => { published.push(document.id); },
    PROJECT_DOCUMENT_REIMPORT_REQUIRED_MESSAGE: 'add again', reportStoragePersistenceFailure: jest.fn(),
    PROJECT_DOCUMENTS_STORAGE_KEY: 'projectDocuments',
    Alert: { alert: (title: string, _message?: string, buttons: Array<{ text: string; onPress?: () => void }> = []) => {
      alerts.push({ title, buttons });
    } },
    projectDocumentUploadAttemptsAfterFailure, bindProjectDocumentUploadToAccount,
    // deleteProjectDocument
    isComplianceSensitiveProjectDocument: () => false, findSharedReferenceDocumentForProjectDocument: () => null,
    referenceDocumentsCurrentRef: { current: [] }, projectDocumentSharedRecordSync: { cancel: jest.fn() },
    deleteOwnedProjectDocument: async () => ({ status: 'deleted' }), hiddenSharedDocuments: { hide: jest.fn() },
    withdrawUnsentProjectDocumentBridge: async () => null, getOfflineQueue: async () => [],
    removeOperationalRecordFromSyncQueue: async () => undefined, setReferenceDocuments: jest.fn(),
    removeReferenceDocumentEverywhere: async () => undefined,
  };
  const fns = compile<{
    retryProjectDocumentUpload: (documentId: string, provided?: PhoneDocument) => Promise<boolean | undefined>;
    retryProjectDocumentUploadAsked: (documentId: string) => void;
    updateDocumentEverywhere: (documentId: string, updater: (document: PhoneDocument) => PhoneDocument) => PhoneDocument | null;
    deleteProjectDocument: (documentId: string) => void;
  }>(['updateDocumentEverywhere', 'retryProjectDocumentUpload', 'retryProjectDocumentUploadAsked', 'deleteProjectDocument'], deps);
  const render = () => { projectDocumentsCurrentRef.current = state; };
  const press = async (text: string) => {
    alerts.at(-1)?.buttons.find(button => button.text === text)?.onPress?.();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  return { ...fns, deps, render, press, alerts, persisted, published, projectDocumentsCurrentRef, state: () => state,
    setProjectDocuments: deps.setProjectDocuments as (next: (prev: PhoneDocument[]) => PhoneDocument[]) => void };
}

function signInAnotherAccount() {
  noteSignedInOwner(null); // sign-out
  noteSignedInOwner('owner-b');
}

beforeEach(() => noteSignedInOwner('owner-a'));

describe('an upload does not carry on into another account (audit A8 pass 3 M3)', () => {
  it('the retry runner stops once another account signs in; the rest wait for their own account', async () => {
    const documents = [phoneDocument('permit'), phoneDocument('survey')];
    const upload = jest.fn(async (documentId: string) => {
      if (documentId === 'permit') signInAnotherAccount();
      return true;
    });
    const runner = createProjectDocumentUploadRetryRunner(() => documents);
    await runner.run(upload, { ignoreBackoff: true });
    expect(upload.mock.calls).toEqual([['permit']]);

    // Control: the same account uploads both.
    noteSignedInOwner('owner-a');
    const same = jest.fn(async () => true);
    await createProjectDocumentUploadRetryRunner(() => documents).run(same, { ignoreBackoff: true });
    expect(same.mock.calls).toEqual([['permit'], ['survey']]);
  });

  it('App.tsx retryProjectDocumentUpload: an upload that finishes after the switch saves nothing and shares nothing', async () => {
    const h = phone([phoneDocument('permit')], async () => {
      signInAnotherAccount();
      return { ok: true };
    });
    await expect(h.retryProjectDocumentUpload('permit')).resolves.toBe(false);
    expect(h.persisted).toEqual([]); // the live list now holds the next account's documents
    expect(h.published).toEqual([]);

    // One that fails after the switch neither saves nor tells the next account about it.
    const failed = phone([phoneDocument('permit')], async () => {
      signInAnotherAccount();
      throw new Error('Network request failed');
    });
    await expect(failed.retryProjectDocumentUpload('permit', phoneDocument('permit'))).resolves.toBe(false);
    expect(failed.persisted).toEqual([]);
    expect(failed.alerts).toEqual([]);

    // Control: the same account saves and shares it.
    noteSignedInOwner('owner-a');
    const control = phone([phoneDocument('permit')], async () => ({ ok: true }));
    await expect(control.retryProjectDocumentUpload('permit')).resolves.toBe(true);
    expect(control.persisted).toHaveLength(1);
    expect(control.published).toEqual(['permit']);
  });
});

describe('a delete during an upload stays deleted (audit A8 pass 3 L3)', () => {
  it('a progress step never undoes a change made to the list since the last render', () => {
    const h = phone([phoneDocument('permit'), phoneDocument('survey')], async () => ({ ok: true }));
    h.setProjectDocuments(prev => prev.filter(document => document.id !== 'survey')); // not rendered yet
    h.updateDocumentEverywhere('permit', document => ({ ...document, uploadProgress: 0.5 }));
    expect(h.state().map(document => [document.id, document.uploadProgress])).toEqual([['permit', 0.5]]);
    // A document no longer listed is not brought back.
    h.updateDocumentEverywhere('survey', document => ({ ...document, uploadProgress: 0.9 }));
    expect(h.state().map(document => document.id)).toEqual(['permit']);
  });

  it('App.tsx: Delete from This Device while the file uploads; progress and the finished upload do not bring it back', async () => {
    let progress: (value: number) => void = () => undefined;
    let finish: () => void = () => undefined;
    const h = phone([phoneDocument('permit'), phoneDocument('survey')], onProgress => {
      progress = onProgress;
      return new Promise(resolve => { finish = () => resolve({ ok: true }); });
    });
    const upload = h.retryProjectDocumentUpload('permit');
    await Promise.resolve();
    h.render();

    h.deleteProjectDocument('permit');
    await h.press('Delete from This Device');
    progress(0.6); // before the next render
    expect(h.state().map(document => document.id)).toEqual(['survey']);
    finish();
    await upload;
    expect(h.persisted.at(-1)?.map(document => document.id)).toEqual(['survey']);
    expect(h.published).toEqual([]);
  });
});

describe('Retry on a document says why it failed (audit A8 pass 3)', () => {
  it('the owner\'s Retry passes the document, so a failure is told', async () => {
    const h = phone([phoneDocument('permit')], async () => ({ ok: false, error: 'The upload was refused.' }));
    h.retryProjectDocumentUploadAsked('permit');
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(h.alerts.map(alert => alert.title)).toEqual(['Document upload not completed']);
  });

  it('every Retry button the owner taps uses it; the automatic runner still passes the id only', () => {
    expect(app).toContain('onRetry={retryProjectDocumentUploadAsked}');
    expect(app.match(/onRetryDocumentUpload=\{retryProjectDocumentUploadAsked\}/g)).toHaveLength(2);
    expect(app).not.toMatch(/void retryProjectDocumentUpload\(documentId\);/);
  });
});
