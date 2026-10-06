/**
 * Whole-app audit A8 pass 4 L4 (30 Sep 2026): a document deleted just as its
 * upload finished was still shared.
 *
 * The finished upload saves the phone's list, and then shares the document:
 * it adds the shared copy, links the card to it, saves the list again and
 * queues the copy for the iPad and the web. It shared the copy of the
 * document it held from before those saves. "Delete from This Device" or
 * "Delete from All Devices" landing during a save removed the card, but the
 * copy was still added and queued: the delete found no shared copy to hide
 * or withdraw when it ran, so the deleted document came back on the iPad,
 * the web and this phone. An archive in that wait was shared the same way,
 * and a sign-in to another account in the second wait filed the copy under
 * that account (the queue stamps whoever is signed in when it is written).
 *
 * Now the document is read again from the live list after each save, and
 * the copy is added and queued only while it is still listed, not archived,
 * not deleted everywhere, and the account that began the upload is still
 * signed in.
 *
 * retryProjectDocumentUpload, publishUploadedProjectDocument,
 * updateDocumentEverywhere, deleteProjectDocument,
 * removeReferenceDocumentEverywhere and rememberOperationalTombstones run
 * compiled from App.tsx, with the real SyncService queue (it stamps the
 * account), the real shared-copy builder and lookup, and the real withdrawal
 * of an unsent copy. Nothing leaves the process.
 */
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
    multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockStorage.get(key) ?? null])),
    multiSet: jest.fn(async (pairs: Array<[string, string]>) => { pairs.forEach(([key, value]) => mockStorage.set(key, value)); }),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(key => mockStorage.delete(key)); }),
  };
  return { __esModule: true, default: api, ...api };
});
jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  documentDirectory: 'file:///app/Documents/',
  cacheDirectory: 'file:///app/Library/Caches/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digest: jest.fn() }));

import { noteSignedInOwner } from '../../services/CloudOwnerBinding';
import {
  bindProjectDocumentUploadToAccount,
  projectDocumentUploadAttemptsAfterFailure,
  uploadedProjectDocumentToShare,
  projectDocumentWaitsForSignIn,
} from '../../services/ProjectDocumentUploadRetry';
import {
  createOwnedLocalFileManifest,
  createOwnedLocalFileManifestRecord,
  parseOwnedLocalFileManifest,
} from '../../services/OwnedLocalFileRepository';
import {
  buildSharedReferenceDocument,
  findSharedReferenceDocumentForProjectDocument,
  synchronizeSharedReferenceDocumentMetadata,
} from '../../services/ProjectDocumentLifecycle';
import { withdrawUnsentProjectDocumentBridge } from '../../services/ProjectDocumentBridge';
import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import { legacyProjectNameKey } from '../../services/OperationalProjectIdentity';
import {
  getOfflineQueue,
  queueReferenceDocumentRecord,
  removeOperationalRecordFromSyncQueue,
} from '../../services/SyncService';
import { withDeviceDocumentUploadState, withoutFieldUpdateDocument } from '../../services/FieldUpdateDocumentUploadState';
import type { ReferenceDocument } from '../../types';
import type { ProjectDocumentCategory } from '../../services/ProjectDocumentClassification';

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

const PROJECT = 'Alpha';
const PROJECT_KEY = legacyProjectNameKey(PROJECT);

type PhoneDocument = {
  id: string; status: 'local' | 'uploading' | 'uploaded' | 'failed'; projectId: string; name: string; category: ProjectDocumentCategory;
  mimeType: string; sizeBytes: number; localUri: string; ownedFileId: string; ownedFileManifest: unknown;
  uploadAttemptCount?: number; lastUploadAttemptAt?: string | null; updatedAt: string; importedAt: string;
  uploadProgress?: number | null; isArchived?: boolean; storagePath?: string; referenceDocumentId?: string | null; note?: string;
  drawingNumber?: string | null;
};
function phoneDocument(id: string, extra: Partial<PhoneDocument> = {}): PhoneDocument {
  const fileId = `${id.padEnd(8, '0').slice(0, 8)}-e29b-41d4-a716-446655440000`;
  return {
    id, status: 'failed', projectId: PROJECT_KEY, name: `${id}.pdf`, category: 'Permit Card', mimeType: 'application/pdf', sizeBytes: 10,
    localUri: `file:///app/Documents/project-documents-v2/${fileId}.pdf`, ownedFileId: fileId,
    ownedFileManifest: createOwnedLocalFileManifest([createOwnedLocalFileManifestRecord({
      fileId, kind: 'project_document', generatedBasename: `${fileId}.pdf`, relativePath: `${fileId}.pdf`,
      sha256: '1'.repeat(64), sizeBytes: 10, mimeType: 'application/pdf',
    })]),
    uploadAttemptCount: 0, lastUploadAttemptAt: null, updatedAt: '2026-09-30T08:00:00.000Z', importedAt: '2026-09-30T08:00:00.000Z',
    ...extra,
  };
}

const settle = async () => {
  for (let i = 0; i < 25; i += 1) await new Promise(resolve => setImmediate(resolve));
};

/** A gate a test opens: `reached` resolves once the code waits on it. */
function gate() {
  let open: () => void = () => undefined;
  let arrived: () => void = () => undefined;
  const reached = new Promise<void>(resolve => { arrived = resolve; });
  return {
    reached,
    wait: () => { arrived(); return new Promise<void>(resolve => { open = resolve; }); },
    open: () => open(),
  };
}

/**
 * The phone as these functions see it. Lists are set as React does;
 * `render()` reads them back into the refs, as each render does. `holdSave`
 * holds the n-th save of the document list open (`holdLaterSave` a later one
 * as well, with `laterSave`); `failSave` makes the n-th save fail once it is
 * let go; `holdFileDelete` holds the delete's removal of the file on this
 * phone. Saves are counted in the order they start, a card edit's included.
 */
function phone(options: Readonly<{
  documents?: PhoneDocument[];
  references?: ReferenceDocument[];
  holdSave?: number;
  holdLaterSave?: number;
  failSave?: number;
  holdFileDelete?: boolean;
  sensitive?: boolean;
}> = {}) {
  let documents = options.documents || [phoneDocument('permit')];
  let references = options.references || [];
  const projectDocumentsCurrentRef = { current: documents };
  const referenceDocumentsCurrentRef = { current: references };
  const operationalSyncTombstonesRef = { current: [] as Array<{ entityType: string; recordId: string; deletedAt: string }> };
  const saves: string[][] = [];
  const save = gate();
  const laterSave = gate();
  const fileDelete = gate();
  const storageFailures: string[] = [];
  const sharedEdits: string[] = [];
  const alerts: Array<{ title: string; buttons: Array<{ text: string; onPress?: () => void }> }> = [];
  const hidden: string[] = [];
  const deps: Record<string, unknown> = {
    projectDocumentsCurrentRef, referenceDocumentsCurrentRef, operationalSyncTombstonesRef, draft: { documents: [] },
    get projectDocuments() { return documents; },
    setProjectDocuments: (next: PhoneDocument[] | ((prev: PhoneDocument[]) => PhoneDocument[])) => {
      documents = typeof next === 'function' ? next(documents) : next;
    },
    setReferenceDocuments: (next: ReferenceDocument[] | ((prev: ReferenceDocument[]) => ReferenceDocument[])) => {
      references = typeof next === 'function' ? next(references) : next;
    },
    setOperationalSyncTombstones: jest.fn(),
    setDraft: jest.fn(), setSavedUpdates: jest.fn(),
    buildProjectDocumentStoragePath: (id: string) => `project-documents/${PROJECT_KEY}/${id}/${id}.pdf`,
    verifyOwnedProjectDocument: async () => undefined,
    uploadPhoto: async () => ({ ok: true }),
    PROJECT_DOCUMENT_UPLOAD_FOLDER: 'project-documents', MAX_PROJECT_DOCUMENT_FILE_BYTES: 1e9,
    persistProjectDocumentsImmediately: async (list: PhoneDocument[]) => {
      saves.push(list.map(document => document.id));
      const count = saves.length;
      if (count === options.holdSave) await save.wait();
      if (count === options.holdLaterSave) await laterSave.wait();
      if (count === options.failSave) throw new Error('This phone could not write the file.');
    },
    PROJECT_DOCUMENT_REIMPORT_REQUIRED_MESSAGE: 'add again',
    reportStoragePersistenceFailure: ({ label }: { label: string }) => { storageFailures.push(label); },
    PROJECT_DOCUMENTS_STORAGE_KEY: 'projectDocuments',
    Alert: { alert: (title: string, _message?: string, buttons: Array<{ text: string; onPress?: () => void }> = []) => {
      alerts.push({ title, buttons });
    } },
    projectDocumentUploadAttemptsAfterFailure, bindProjectDocumentUploadToAccount, uploadedProjectDocumentToShare,
    // Everyday item 5 (landed after this test): a document waits, untried, while the workspace is open
    // "offline, sign-in pending"; not pending here. Deps added deliberately.
    signInPendingRef: { current: false }, projectDocumentWaitsForSignIn,
    resendUpdatesListingDocument: jest.fn(), withoutFieldUpdateDocument, withDeviceDocumentUploadState,
    // publishUploadedProjectDocument
    parseOwnedLocalFileManifest, projectsCurrentRef: { current: [PROJECT] }, authorityProjectId: legacyProjectNameKey,
    normalizeReferenceDocument, buildSharedReferenceDocument, markReferenceDocumentsAuthorityReady: jest.fn(),
    // The real queue; its upload pass is not started here.
    queueReferenceDocumentRecord: (document: ReferenceDocument) => queueReferenceDocumentRecord(document, false),
    // deleteProjectDocument and removeReferenceDocumentEverywhere
    isComplianceSensitiveProjectDocument: () => Boolean(options.sensitive),
    findSharedReferenceDocumentForProjectDocument,
    // A shared copy's edit, queued after a pause (the real lifecycle is tested in audit-a8-p2-document-sync).
    projectDocumentSharedRecordSync: { cancel: jest.fn(), queueAfterChange: (id: string) => { sharedEdits.push(id); } },
    // updateProjectDocument (the card's edits). The stored-record normalizer is not under test here.
    normalizeProjectDocument: (document: PhoneDocument) => document, synchronizeSharedReferenceDocumentMetadata,
    deleteOwnedProjectDocument: async () => {
      if (options.holdFileDelete) await fileDelete.wait();
      return { status: 'deleted' };
    },
    hiddenSharedDocuments: { hide: (id: string) => { hidden.push(id); } },
    withdrawUnsentProjectDocumentBridge, getOfflineQueue, removeOperationalRecordFromSyncQueue,
    recordDAVESyncTombstone: async (entityType: string, recordId: string) => ({ entityType, recordId, deletedAt: '2026-09-30T09:00:00.000Z' }),
    // (Owner answer Q36: only the PDF of a lookahead in effect is refused; no document here is one.)
    fileOnlyDeleteRefused: () => false,
  };
  const fns = compile<{
    retryProjectDocumentUpload: (documentId: string, provided?: PhoneDocument) => Promise<boolean | undefined>;
    publishUploadedProjectDocument: (document: PhoneDocument, sameAccount: () => boolean) => Promise<void>;
    updateDocumentEverywhere: (documentId: string, updater: (document: PhoneDocument) => PhoneDocument) => PhoneDocument | null;
    updateProjectDocument: (documentId: string, next: Partial<PhoneDocument>) => void;
    deleteProjectDocument: (documentId: string) => void;
  }>([
    'updateDocumentEverywhere', 'publishUploadedProjectDocument', 'retryProjectDocumentUpload', 'updateProjectDocument',
    'deleteProjectDocument', 'removeReferenceDocumentEverywhere', 'rememberOperationalTombstones',
  ], deps);
  const render = () => {
    projectDocumentsCurrentRef.current = documents;
    referenceDocumentsCurrentRef.current = references;
  };
  const press = async (text: string) => {
    alerts.at(-1)?.buttons.find(button => button.text === text)?.onPress?.();
    await settle();
  };
  return {
    ...fns, render, press, saves, hidden, alerts, save, laterSave, fileDelete, operationalSyncTombstonesRef, storageFailures, sharedEdits,
    cards: () => documents.filter(document => !document.isArchived).map(document => document.id),
    sharedCopies: () => references.map(document => document.id),
    sharedNotes: () => references.map(document => document.notes),
    sharedRecord: (id: string) => references.find(document => document.id === id),
  };
}

/** The shared copies waiting to go up, as queued: id, account, note and drawing number. */
async function queuedSharedCopyDetails() {
  return (await getOfflineQueue())
    .filter(item => item.entity === 'reference_document')
    .map(item => {
      const payload = item.payload as { id: string; documentData: { notes?: string; drawingNumber?: string | null } };
      return [payload.id, item.ownerId, payload.documentData.notes, payload.documentData.drawingNumber ?? null];
    });
}

/** The shared copies waiting to go up, with the account each was queued under. */
async function queuedSharedCopies() {
  return (await getOfflineQueue())
    .filter(item => item.entity === 'reference_document')
    .map(item => [(item.payload as { id: string }).id, item.ownerId]);
}

function signInAnotherAccount() {
  noteSignedInOwner(null); // sign-out
  noteSignedInOwner('owner-b');
}

beforeEach(() => {
  mockStorage.clear();
  noteSignedInOwner('owner-a');
});

describe('a document deleted as its upload finishes is not shared (audit A8 pass 4 L4)', () => {
  // The first save follows the upload; the second follows linking the card to its shared copy.
  describe.each([
    ['the save after the upload', 1],
    ['the save after linking the shared copy', 2],
  ])('during %s', (_label, holdSave) => {
    it.each(['Delete from This Device', 'Delete from All Devices'])('%s: the card is gone and nothing is shared or queued', async choice => {
      const h = phone({ holdSave });
      const upload = h.retryProjectDocumentUpload('permit');
      await h.save.reached;
      h.render();

      h.deleteProjectDocument('permit');
      await h.press(choice);
      expect(h.cards()).toEqual([]);

      h.save.open();
      await expect(upload).resolves.toBe(true);
      await settle();
      h.render();
      expect(h.cards()).toEqual([]);
      expect(h.sharedCopies()).toEqual([]); // no shared copy on this phone either
      expect(await queuedSharedCopies()).toEqual([]); // nothing for the iPad or the web
    });

    it('an archive (compliance-sensitive document) is not shared either', async () => {
      const h = phone({ holdSave, sensitive: true });
      const upload = h.retryProjectDocumentUpload('permit');
      await h.save.reached;
      h.render();

      h.deleteProjectDocument('permit');
      await h.press('Archive Permit Card');
      h.save.open();
      await upload;
      await settle();
      h.render();
      expect(h.cards()).toEqual([]);
      expect(h.saves).toHaveLength(holdSave); // not linked to a shared copy and saved again
      expect(h.sharedCopies()).toEqual([]);
      expect(await queuedSharedCopies()).toEqual([]);
    });

    it('a sign-in to another account in that wait queues nothing, under either account', async () => {
      const h = phone({ holdSave });
      const upload = h.retryProjectDocumentUpload('permit');
      await h.save.reached;

      signInAnotherAccount();
      h.save.open();
      await upload;
      await settle();
      h.render();
      expect(await queuedSharedCopies()).toEqual([]);
      expect(h.sharedCopies()).toEqual([]); // the live list now belongs to the next account
    });
  });

  it('Delete from All Devices of a document already shared: no copy is queued while the delete finishes', async () => {
    const existing = normalizeReferenceDocument(buildSharedReferenceDocument({
      document: phoneDocument('permit'), projectName: PROJECT, contentSha256: '1'.repeat(64), updatedAt: '2026-09-29T08:00:00.000Z',
    }));
    const h = phone({
      documents: [phoneDocument('permit', { referenceDocumentId: 'permit' })],
      references: [existing], holdSave: 2, holdFileDelete: true,
    });
    const upload = h.retryProjectDocumentUpload('permit'); // Choose File Again, say
    await h.save.reached;
    h.render();

    h.deleteProjectDocument('permit');
    await h.press('Delete from All Devices'); // deleted everywhere; the file on this phone is still being removed
    expect(h.operationalSyncTombstonesRef.current.map(tombstone => tombstone.recordId)).toEqual(['permit']);
    expect(h.cards()).toEqual(['permit']);

    h.save.open();
    await upload;
    await settle();
    expect(await queuedSharedCopies()).toEqual([]);
    expect(h.sharedCopies()).toEqual([]);

    h.fileDelete.open();
    await settle();
    h.render();
    expect(h.cards()).toEqual([]);
    expect(h.sharedCopies()).toEqual([]);
    expect(await queuedSharedCopies()).toEqual([]);
  });

  it('text typed on the card during the save goes up with the shared copy, not the copy from before', async () => {
    const h = phone({ holdSave: 1 });
    const upload = h.retryProjectDocumentUpload('permit');
    await h.save.reached;
    // The card's note edit: updateProjectDocument changes the list through updateDocumentEverywhere
    // (there is no shared copy yet for it to update).
    h.updateDocumentEverywhere('permit', document => ({ ...document, note: 'Pour Tuesday' }));
    h.save.open();
    await upload;
    await settle();
    h.render();
    expect(h.sharedNotes()).toEqual(['Pour Tuesday']);
    const queued = (await getOfflineQueue()).filter(item => item.entity === 'reference_document');
    expect(queued.map(item => (item.payload as { documentData: { notes?: string } }).documentData.notes)).toEqual(['Pour Tuesday']);
  });

  it('control: an upload left alone is shared once, under the account that began it', async () => {
    const h = phone();
    await expect(h.retryProjectDocumentUpload('permit')).resolves.toBe(true);
    await settle();
    h.render();
    expect(h.cards()).toEqual(['permit']);
    expect(h.sharedCopies()).toEqual(['permit']);
    expect(h.saves).toEqual([['permit'], ['permit']]);
    expect(await queuedSharedCopies()).toEqual([['permit', 'owner-a']]);
  });

  it('a document no longer listed when the shared copy is built is not shared or saved', async () => {
    const h = phone({ documents: [] });
    await h.publishUploadedProjectDocument(phoneDocument('permit'), () => true);
    await settle();
    expect(h.sharedCopies()).toEqual([]);
    expect(h.saves).toEqual([]);
    expect(await queuedSharedCopies()).toEqual([]);
  });
});

/**
 * Whole-app audit A8 pass 5 L1 (30 Sep 2026): a note typed on the card during
 * the second save of a finished upload was missing from the shared copy.
 * The shared copy was built before that save (the save that links the card
 * to it) and queued after it; the card's edit, made meanwhile, found no
 * shared copy to update, so nothing else carried it. Now the copy is built
 * from the document as listed after the last save, immediately before it is
 * queued. If that save fails, the copy is still shared: the failure is said
 * as this phone's storage failure (as for any card edit), not as a cloud
 * record waiting for Sync Now that nothing would ever send.
 *
 * The card's edits run through updateProjectDocument, compiled from App.tsx.
 */
describe('text typed on the card while the upload saves goes with the shared copy (audit A8 pass 5 L1)', () => {
  // Saves are counted in the order they start: the card edit's own save takes the next number.
  it.each([
    ['the save after the upload', 1],
    ['the save after linking the shared copy', 2],
  ])('a note typed during %s is on the shared copy here and on the copy queued for the iPad and the web', async (_label, holdSave) => {
    const h = phone({ holdSave });
    const upload = h.retryProjectDocumentUpload('permit');
    await h.save.reached;
    h.updateProjectDocument('permit', { note: 'Pour Tuesday' });
    h.save.open();
    await expect(upload).resolves.toBe(true);
    await settle();
    h.render();
    expect(h.sharedNotes()).toEqual(['Pour Tuesday']);
    expect(await queuedSharedCopyDetails()).toEqual([['permit', 'owner-a', 'Pour Tuesday', null]]);
  });

  it('text typed during both saves all goes with the one queued copy', async () => {
    // Save 1 follows the upload, 2 is the card edit's own, 3 links the shared copy.
    const h = phone({ holdSave: 1, holdLaterSave: 3 });
    const upload = h.retryProjectDocumentUpload('permit');
    await h.save.reached;
    h.updateProjectDocument('permit', { drawingNumber: 'A-101' });
    h.save.open();
    await h.laterSave.reached;
    h.updateProjectDocument('permit', { note: 'Pour Tuesday' });
    h.laterSave.open();
    await upload;
    await settle();
    h.render();
    expect(h.sharedNotes()).toEqual(['Pour Tuesday']);
    expect(await queuedSharedCopyDetails()).toEqual([['permit', 'owner-a', 'Pour Tuesday', 'A-101']]);
  });

  it('a card linked to another shared record during the save (Make Current) does not have that record rebuilt over', async () => {
    const current = normalizeReferenceDocument({
      ...buildSharedReferenceDocument({ document: phoneDocument('schedule'), projectName: PROJECT, contentSha256: null }),
      id: 'schedule-current', isCurrent: true,
    });
    const h = phone({ holdSave: 2, references: [current] });
    const upload = h.retryProjectDocumentUpload('permit');
    await h.save.reached;
    h.updateDocumentEverywhere('permit', document => ({ ...document, referenceDocumentId: 'schedule-current' }));
    h.save.open();
    await upload;
    await settle();
    h.render();
    expect((await queuedSharedCopies()).map(([id]) => id)).not.toContain('schedule-current');
    expect(h.sharedRecord('schedule-current')?.isCurrent).toBe(true); // still the current schedule on this phone
  });

  it('control: a note typed after the copy is listed goes up as an edit of that copy', async () => {
    const h = phone();
    await h.retryProjectDocumentUpload('permit');
    await settle();
    h.render();
    h.updateProjectDocument('permit', { note: 'Pour Tuesday' });
    expect(h.sharedNotes()).toEqual(['Pour Tuesday']);
    expect(h.sharedEdits).toEqual(['permit']);
  });

  describe('the save linking the shared copy fails', () => {
    it('the copy is still shared, with the text typed meanwhile, and the failure is said as a storage failure', async () => {
      const h = phone({ holdSave: 2, failSave: 2 });
      const upload = h.retryProjectDocumentUpload('permit', phoneDocument('permit')); // the owner's Retry: failures are said
      await h.save.reached;
      h.updateProjectDocument('permit', { note: 'Pour Tuesday' });
      h.save.open();
      await expect(upload).resolves.toBe(true);
      await settle();
      h.render();
      expect(h.sharedCopies()).toEqual(['permit']);
      expect(await queuedSharedCopyDetails()).toEqual([['permit', 'owner-a', 'Pour Tuesday', null]]);
      expect(h.storageFailures).toEqual(['project document']);
      // Not told to wait for a Sync Now that would never send it.
      expect(h.alerts.map(alert => alert.title)).toEqual([]);
    });

    it.each(['Delete from This Device', 'Delete from All Devices'])('%s during that save: nothing is shared or queued', async choice => {
      const h = phone({ holdSave: 2, failSave: 2 });
      const upload = h.retryProjectDocumentUpload('permit');
      await h.save.reached;
      h.render();
      h.deleteProjectDocument('permit');
      await h.press(choice);
      h.save.open();
      await upload;
      await settle();
      h.render();
      expect(h.cards()).toEqual([]);
      expect(h.sharedCopies()).toEqual([]);
      expect(await queuedSharedCopies()).toEqual([]);
    });

    it('an archive during that save: nothing is shared or queued', async () => {
      const h = phone({ holdSave: 2, failSave: 2, sensitive: true });
      const upload = h.retryProjectDocumentUpload('permit');
      await h.save.reached;
      h.render();
      h.deleteProjectDocument('permit');
      await h.press('Archive Permit Card');
      h.save.open();
      await upload;
      await settle();
      h.render();
      expect(h.sharedCopies()).toEqual([]);
      expect(await queuedSharedCopies()).toEqual([]);
    });

    it('a sign-in to another account during that save: nothing is queued under either account', async () => {
      const h = phone({ holdSave: 2, failSave: 2 });
      const upload = h.retryProjectDocumentUpload('permit');
      await h.save.reached;
      signInAnotherAccount();
      h.save.open();
      await upload;
      await settle();
      h.render();
      expect(h.sharedCopies()).toEqual([]);
      expect(await queuedSharedCopies()).toEqual([]);
    });
  });
});

describe('uploadedProjectDocumentToShare (audit A8 pass 4 L4)', () => {
  const sameAccount = () => true;
  it('returns the document as listed now', () => {
    const listed = phoneDocument('permit', { referenceDocumentId: 'permit', updatedAt: 'later' });
    expect(uploadedProjectDocumentToShare([listed], 'permit', sameAccount)).toBe(listed);
  });
  it('nothing once it is gone, archived, deleted everywhere, or another account has signed in', () => {
    expect(uploadedProjectDocumentToShare([], 'permit', sameAccount)).toBeNull();
    expect(uploadedProjectDocumentToShare([phoneDocument('permit', { isArchived: true })], 'permit', sameAccount)).toBeNull();
    expect(uploadedProjectDocumentToShare([phoneDocument('permit')], 'permit', () => false)).toBeNull();
    const tombstone = { entityType: 'reference_document', recordId: 'shared-1', deletedAt: 'T' };
    expect(uploadedProjectDocumentToShare([phoneDocument('permit', { referenceDocumentId: 'shared-1' })], 'permit', sameAccount, [tombstone])).toBeNull();
    // Another kind of record deleted under the same id does not count.
    expect(uploadedProjectDocumentToShare([phoneDocument('permit', { referenceDocumentId: 'shared-1' })], 'permit', sameAccount,
      [{ ...tombstone, entityType: 'schedule_item' }])?.id).toBe('permit');
  });
});
