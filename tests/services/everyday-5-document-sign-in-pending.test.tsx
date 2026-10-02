/**
 * Everyday item 5 (2 Oct 2026): a document added while the workspace is open
 * "offline, sign-in pending" (owner answer Q13) tried its upload, failed for
 * want of a session, raised "Document upload not completed", and read
 * "Document upload failed · Retry". It now reads as waiting, is not tried,
 * and uploads by itself once the sign-in finishes, as field updates do.
 *
 * retryProjectDocumentUpload runs compiled from App.tsx with the real
 * services (as in the A8 tests); the card, the hook and the runner are the
 * real ones.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import { act, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';

import { NativeWorkspaceSignInPendingContext } from '../../components/native-workspace-owner';
import { ProjectDocumentCard } from '../../components/project-document-card';
import { useAfterSignInPendingEnds } from '../../hooks/use-after-sign-in-pending-ends';
import {
  bindProjectDocumentUploadToAccount,
  createProjectDocumentUploadRetryRunner,
  PROJECT_DOCUMENT_WAITING_FOR_SIGN_IN,
  projectDocumentUploadAttemptsAfterFailure,
  projectDocumentWaitsForSignIn,
  uploadedProjectDocumentToShare,
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

type Status = 'local' | 'uploading' | 'uploaded' | 'failed';
function phoneDocument(id: string, status: Status, extra: Record<string, unknown> = {}) {
  const fileId = `${id.padEnd(8, '0')}-e29b-41d4-a716-446655440000`;
  return {
    id, status, projectId: 'alpha-key', name: `${id}.pdf`, category: 'Permit Card' as const, mimeType: 'application/pdf', sizeBytes: 10,
    localUri: `file:///app/Documents/project-documents-v2/${fileId}.pdf`,
    ownedFileId: fileId,
    ownedFileManifest: createOwnedLocalFileManifest([createOwnedLocalFileManifestRecord({
      fileId, kind: 'project_document', generatedBasename: `${fileId}.pdf`, relativePath: `${fileId}.pdf`,
      sha256: '1'.repeat(64), sizeBytes: 10, mimeType: 'application/pdf',
    })]),
    uploadAttemptCount: 0,
    lastUploadAttemptAt: null as string | null,
    updatedAt: '2026-10-02T09:00:00.000Z',
    importedAt: '2026-10-02T09:00:00.000Z',
    ...extra,
  };
}
type PhoneDocument = ReturnType<typeof phoneDocument>;

/** retryProjectDocumentUpload as the App runs it, with the workspace's "sign-in pending". */
function uploader(documents: PhoneDocument[], signInPendingRef: { current: boolean }) {
  const projectDocumentsCurrentRef = { current: documents };
  let state = documents;
  const alert = jest.fn();
  const upload = jest.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: false, error: 'Sign in is required.' }));
  const deps: Record<string, unknown> = {
    projectDocumentsCurrentRef, draft: { documents: [] },
    setProjectDocuments: (next: PhoneDocument[] | ((prev: PhoneDocument[]) => PhoneDocument[])) => {
      state = typeof next === 'function' ? next(state) : next;
      projectDocumentsCurrentRef.current = state;
    },
    setDraft: jest.fn(), setSavedUpdates: jest.fn(),
    buildProjectDocumentStoragePath: (id: string) => `owner/${id}.pdf`,
    verifyOwnedProjectDocument: async () => undefined,
    uploadPhoto: (...args: unknown[]) => upload(...(args as [])),
    PROJECT_DOCUMENT_UPLOAD_FOLDER: 'project-documents', MAX_PROJECT_DOCUMENT_FILE_BYTES: 1e9,
    persistProjectDocumentsImmediately: async () => undefined,
    publishUploadedProjectDocument: async () => undefined,
    PROJECT_DOCUMENT_REIMPORT_REQUIRED_MESSAGE: 'add again', reportStoragePersistenceFailure: jest.fn(),
    PROJECT_DOCUMENTS_STORAGE_KEY: 'projectDocuments', Alert: { alert },
    projectDocumentUploadAttemptsAfterFailure, bindProjectDocumentUploadToAccount, uploadedProjectDocumentToShare,
    resendUpdatesListingDocument: jest.fn(), withDeviceDocumentUploadState: (update: unknown) => update,
    signInPendingRef, projectDocumentWaitsForSignIn,
  };
  const { retryProjectDocumentUpload } = compile<{
    retryProjectDocumentUpload: (documentId: string, provided?: PhoneDocument) => Promise<boolean | undefined>;
  }>(['updateDocumentEverywhere', 'retryProjectDocumentUpload'], deps);
  return { retryProjectDocumentUpload, projectDocumentsCurrentRef, upload, alert };
}

describe('a document added while "offline, sign-in pending" waits, then uploads by itself (everyday item 5)', () => {
  it('is not tried while the sign-in waits: no failure, no alert, no attempt counted', async () => {
    const signInPendingRef = { current: true };
    const permit = phoneDocument('permit', 'local');
    const h = uploader([permit], signInPendingRef);
    // As the add flow calls it (with the document, so a failure would raise an alert).
    await expect(h.retryProjectDocumentUpload('permit', permit)).resolves.toBe(false);
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.alert).not.toHaveBeenCalled();
    expect(h.projectDocumentsCurrentRef.current[0]).toMatchObject({ status: 'local', uploadAttemptCount: 0 });

    // The sign-in finishes: the runner (as the App starts it then, ignoring the backoff) uploads it.
    signInPendingRef.current = false;
    h.upload.mockImplementation(async () => ({ ok: true }));
    const runner = createProjectDocumentUploadRetryRunner(() => h.projectDocumentsCurrentRef.current);
    await expect(runner.run(id => h.retryProjectDocumentUpload(id), { ignoreBackoff: true }))
      .resolves.toEqual({ attempted: 1, uploaded: 1, remaining: 0 });
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.projectDocumentsCurrentRef.current[0]).toMatchObject({ status: 'uploaded' });
  });

  it('with a session the upload runs as before, and a real failure still reads as failed', async () => {
    const h = uploader([phoneDocument('permit', 'local')], { current: false });
    await h.retryProjectDocumentUpload('permit', h.projectDocumentsCurrentRef.current[0]);
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(h.projectDocumentsCurrentRef.current[0]).toMatchObject({ status: 'failed' });
    expect(h.alert).toHaveBeenCalledTimes(1);
  });

  it('the card reads as waiting and offers no Retry Upload while the sign-in waits; as before once it is done', () => {
    const card = (pending: boolean, status: Status) => (
      <NativeWorkspaceSignInPendingContext.Provider value={pending}>
        <ProjectDocumentCard
          document={phoneDocument('permit', status)}
          sharedReferenceDocument={null}
          projectAreas={[]}
          updates={[]}
          onOpen={jest.fn()} onUpdate={jest.fn()} onSetCurrentSchedule={jest.fn()} onMakeCurrentDocument={jest.fn()}
          onRetry={jest.fn()} onReplaceFile={jest.fn()} onDelete={jest.fn()}
        />
      </NativeWorkspaceSignInPendingContext.Provider>
    );
    const view = render(card(true, 'failed'));
    expect(screen.getByText(`Permit Card · ${PROJECT_DOCUMENT_WAITING_FOR_SIGN_IN}`)).toBeTruthy();
    expect(screen.queryByText('Document upload failed · Retry', { exact: false })).toBeNull();
    expect(screen.queryByText('Retry Upload')).toBeNull();
    view.rerender(card(true, 'local'));
    expect(screen.getByText(`Permit Card · ${PROJECT_DOCUMENT_WAITING_FOR_SIGN_IN}`)).toBeTruthy();
    view.rerender(card(false, 'failed'));
    expect(screen.getByText('Permit Card · Document upload failed · Retry')).toBeTruthy();
    expect(screen.getByText('Retry Upload')).toBeTruthy();
    // A document that must be added again cannot upload: it does not wait.
    expect(projectDocumentWaitsForSignIn({ ...phoneDocument('lost', 'failed'), ownedFileManifest: null }, true)).toBe(false);
    expect(projectDocumentWaitsForSignIn({ ...phoneDocument('old', 'failed'), isArchived: true }, true)).toBe(false);
    expect(projectDocumentWaitsForSignIn(phoneDocument('done', 'uploaded'), true)).toBe(false);
  });

  it('the App\'s hook runs the uploads once, when "offline, sign-in pending" ends', () => {
    const run = jest.fn();
    function Probe() {
      useAfterSignInPendingEnds(run);
      const [renders, setRenders] = useState(0);
      return <Text onPress={() => setRenders(renders + 1)}>{renders}</Text>;
    }
    const tree = (pending: boolean) => (
      <NativeWorkspaceSignInPendingContext.Provider value={pending}><Probe /></NativeWorkspaceSignInPendingContext.Provider>
    );
    const view = render(tree(true));
    view.rerender(tree(true));
    expect(run).not.toHaveBeenCalled();
    act(() => { view.rerender(tree(false)); });
    expect(run).toHaveBeenCalledTimes(1);
    view.rerender(tree(false));
    expect(run).toHaveBeenCalledTimes(1);
    // A workspace opened with its sign-in done never runs it.
    const fresh = jest.fn();
    function Fresh() { useAfterSignInPendingEnds(fresh); return null; }
    render(<NativeWorkspaceSignInPendingContext.Provider value={false}><Fresh /></NativeWorkspaceSignInPendingContext.Provider>);
    expect(fresh).not.toHaveBeenCalled();
    // And the App wires it to the document uploads, ignoring the backoff.
    expect(app).toContain('useAfterSignInPendingEnds(() => void projectDocumentUploadRetry.run(retryProjectDocumentUpload, { ignoreBackoff: true }));');
  });
});
