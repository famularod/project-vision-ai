/**
 * Open item 5.26 (Medium; found by David on his iPhone, Build 232 check 6, 14 Oct 2026; the Build 233 round). With no
 * signal, a PDF added in a project's Documents as type Schedule opened the import review ("The PDF was saved, but no
 * dated activities were extracted. The schedule extraction service could not be reached. The PDF remains saved.");
 * closing it left no card, and the next PDF added said "Document unavailable - The manifest-owned file is missing
 * from local storage." Back in signal neither PDF had a card: the one said to "remain saved" was gone.
 *
 * Why (both older, Build 231 and 232 alike):
 * 1. A schedule added from Documents was only a review: nothing was kept until its tasks were saved, and closing the
 *    review deleted the review's copy of the PDF. "Saved" was said while nothing was.
 * 2. Every other document added on the phone failed: the app did not wait for its copy into app storage (see
 *    n526-document-copy-waits-for-the-copy.test.ts).
 * Now a schedule PDF nothing could be read from is kept as a card first, as any document added there (it uploads as
 * any document added without signal), the review then says so, and closing it leaves the card. The Tasks tab's road
 * (no card there) no longer says "saved". A schedule whose tasks were read opens its review as before, with no card.
 *
 * The road: App.tsx's own confirmDocumentProjectSelection, createProjectDocumentFromAsset, confirmAndAttachProjectDocument,
 * saveProjectDocument, addProjectDocumentDurably, prepareScheduleImportFromAsset, importScheduleFile and
 * cancelScheduleImport, compiled from App.tsx with the real services (owned storage with its Expo adapter, the schedule
 * service's words and reader, the upload retry runner) into the real review (ScheduleImportFlow). Only the file library,
 * the schedule service's network call and the phone's storage are made up. Made-up project and files.
 */
let ownerSerial = 0;
let mockNativeCopyBarrier: Promise<void> | null = null;
let mockNativeStatBarrier: Promise<void> | null = null;
const mockDisk = new Map<string, Uint8Array>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    get exists() { return mockDisk.has(this.uri); }
    get size() { return mockDisk.get(this.uri)?.byteLength ?? 0; }
    /** As expo-file-system 56+: the copy lands off the JS thread; the promise settles once it is there. */
    copy(destination: { uri: string }) {
      const bytes = mockDisk.get(this.uri);
      return new Promise<void>((resolve, reject) => setTimeout(async () => {
        if (mockNativeCopyBarrier) await mockNativeCopyBarrier;
        if (!bytes) return reject(new Error('The native copy failed.'));
        mockDisk.set(destination.uri, bytes.slice());
        resolve();
      }, 0));
    }
    async bytes() { return (mockDisk.get(this.uri) as Uint8Array).slice(); }
    delete() { mockDisk.delete(this.uri); }
    open() {
      const bytes = mockDisk.get(this.uri) as Uint8Array;
      let at = 0;
      return {
        size: bytes.byteLength,
        readBytes(length: number) { const chunk = bytes.slice(at, at + length); at += chunk.byteLength; return chunk; },
        close() { /* nothing held */ },
      };
    }
  }
  class Directory {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    get exists() { return true; }
    create() { /* the folder is there */ }
  }
  return { File, Directory };
});
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///app/Documents/',
  getInfoAsync: async (uri: string) => {
    if (mockNativeStatBarrier) await mockNativeStatBarrier;
    return mockDisk.has(uri) ? { exists: true, size: (mockDisk.get(uri) as Uint8Array).byteLength } : { exists: false };
  },
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `5e26a0b1-4c2d-4e8f-9a1b-${String(++mockUuid).padStart(12, '0')}`,
}));
jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';

import { useState } from 'react';
import { ScheduleImportFlow } from '../../components/ScheduleImportFlow';
import { noteSignedInOwner } from '../../services/CloudOwnerBinding';
import { deletedDAVERecordIds } from '../../services/DAVESyncTombstones';
import { bindPIEScheduleImportBatchProvenance, dedupeScheduleImportItems, type PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import * as remoteExtraction from '../../services/PIEScheduleRemoteExtraction';
import { buildSharedReferenceDocument, cleanupProjectDocumentOwnedFileForRecordRemoval, importProjectDocumentIntoOwnedStorage } from '../../services/ProjectDocumentLifecycle';
import { bindProjectDocumentUploadToAccount, createProjectDocumentUploadRetryRunner, projectDocumentsAwaitingUpload, uploadedProjectDocumentToShare } from '../../services/ProjectDocumentUploadRetry';
import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import { ScheduleImportReviewError, scheduleImportApprovalBlocker, validateScheduleImportScope } from '../../services/ScheduleImportScopeGuard';
import { bindStableScheduleImportItemIds } from '../../services/ScheduleImportSourceIdentity';
import { scheduleImportOfFile } from '../../services/SharedDocumentActivation';

import { markCurrentProjectScheduleDocument } from '../../services/DAVEDocumentWorkspace';
import { parseOwnedLocalFileManifest } from '../../services/OwnedLocalFileRepository';
import { scheduleDocumentsAfterApproval } from '../../services/ScheduleDocumentLabels';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleImportAddsToMaster } from '../../services/ScheduleLookahead';
import { scheduleTurnedHighLineBetween } from '../../services/ScheduleTurnedHigh';
import { findExactScheduleTaskForCompletionClaim, mergeReportedCompletionClaim } from '../../services/DAVECompletionVerification';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';

/** A document card as App.tsx keeps it (its ProjectDocument type is App.tsx's own); the fields read here. */
type ProjectDocument = {
  id: string; name: string; category: string; status: 'local' | 'uploading' | 'uploaded' | 'failed'; projectId: string;
  localUri?: string | null; ownedFileId?: string | null; ownedFileManifest?: unknown; isArchived?: boolean | null;
};

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
let selectionVersion: 'B55' | 'B54' = 'B55';
const baselineSelection = fs.readFileSync(path.resolve(__dirname, 'reviewer-b54-selection-baseline.txt'), 'utf8');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** A function of App.tsx (inside the App component, or at the top level), brace-matched after its parameters. */
function appFunction(name: string): string {
  if (name === 'confirmDocumentProjectSelection' && selectionVersion === 'B54') return baselineSelection;
  const match = new RegExp(`\\n((?:  )?)(?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no function ${name}`);
  let parameters = 0;
  let close = match.index + match[0].length - 1;
  for (; close < app.length; close += 1) {
    if (app[close] === '(') parameters += 1;
    if (app[close] === ')' && --parameters === 0) break;
  }
  const open = app.indexOf(' {\n', close) + 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(match.index + 1 + match[1].length, index + 1);
    }
  }
  throw new Error('unbalanced function');
}

function compile<T>(names: string[], deps: Record<string, unknown>): T {
  const js = ts.transpileModule(
    [...names.map(appFunction), `module.exports = { ${names.join(', ')} };`].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } },
  ).outputText;
  const mod = { exports: {} as T };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports;
}

const PROJECT = 'Test Pier Works';
const OWNED_ROOT = 'file:///app/Documents/project-documents-v2/';
/** The app's folder for a schedule review's own copy (ReferenceDocumentRepository). */
const REFERENCE_DIR = 'file:///app/Documents/project-documents/';
const STORAGE_KEY = 'made-up-project-documents-key';
const pdf = (note: string) => new TextEncoder().encode(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${note}\n%%EOF\n`);
/** F1 and F2 as David made them: small made-up PDFs, no dated activities on them. */
const F1 = { name: 'F1.pdf', bytes: pdf('made-up sheet F1') };
const F2 = { name: 'F2.pdf', bytes: pdf('made-up sheet F2, a little longer') };
const projectKey = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-key`;

/**
 * The schedule service as App.tsx calls it (extractSchedulePdfWithServer). Its own fetch cannot run under jest (it
 * loads the sign-in with a dynamic import), so: without signal it fails as its catch does, in the service's words
 * (Build 232's, on the base, where the service had no such constant); with signal its answer is read by the
 * service's own reader.
 */
const UNREACHABLE = (remoteExtraction as unknown as Record<string, string | undefined>).SCHEDULE_EXTRACTION_UNREACHABLE_MESSAGE
  ?? 'The schedule extraction service could not be reached. The PDF remains saved.';
const NO_SIGNAL = async () => { throw new remoteExtraction.PIEScheduleRemoteExtractionError(UNREACHABLE); };
const SERVICE_READS_ONE_TASK = async ({ fileName, projects }: { fileName: string; projects: readonly string[] }) =>
  remoteExtraction.scheduleItemsFromRemoteExtractorPayload(
    { ok: true, items: [{ taskName: 'Pour pier caps', projectName: PROJECT, startDate: '2026-10-26', finishDate: '2026-10-30' }] },
    { fileName, projects, extractedAt: '2026-10-15T08:00:00.000Z' },
  );
let schedule: typeof NO_SIGNAL | typeof SERVICE_READS_ONE_TASK = NO_SIGNAL;

type Picked = Readonly<{ name: string; bytes: Uint8Array }>;
type Category = 'Schedule' | 'Other' | 'Drawing';

/** One phone: its storage, its document list, what it shows and says. */
function phone(options: Readonly<{ storageFails?: boolean; failWriteAt?: number; holdWrite?: Promise<void>; holdUpload?: Promise<void>; holdCleanup?: Promise<void> }> = {}) {
  const owner = 'review-owner-' + (++ownerSerial); noteSignedInOwner(owner);
  let writes = 0;
  const storage = new Map<string, string>();
  const projectDocumentsCurrentRef = { current: [] as ProjectDocument[] };
  const projectScheduleImportCardRef = { current: null as null | { batchId: string; documentId: string } };
  const alerts: Array<{ title: string; message: string; buttons?: Array<{ text: string; onPress?: () => void }> }> = [];
  const uploadAttempts: string[] = [];
  const deletedReferenceCopies: string[] = [];
  const opened: PIEScheduleImportBatch[] = [];
  const screens: string[] = [];
  let picks = 0;
  let ids = 0;

  const Alert = { alert: (title: string, message: string, buttons?: Array<{ text: string; onPress?: () => void }>) => { alerts.push({ title, message, buttons }); } };
  const shared: Record<string, unknown> = {
    Alert, documentUploadRequestEpochRef: { current: 0 }, screen: 'ProjectDocuments',
    // The projects
    activeProjects: [PROJECT], projects: [PROJECT],
    archivedProjectsCurrentRef: { current: [] }, deletedProjectNamesRef: { current: [] },
    projectsCurrentRef: { current: [PROJECT] }, projectRecordsCurrentRef: { current: [] },
    authorityProjectId: projectKey,
    projectAreasForProject: () => [], projectAreasCurrentRef: { current: [] }, savedUpdatesRef: { current: [] },
    referenceDocumentsCurrentRef: { current: [] }, scheduleItemsCurrentRef: { current: [] },
    // The schedule review's preparation (App.tsx prepareScheduleImportFromAsset)
    prepareExpoFileUploadPayload: async ({ uri }: { uri: string }) => {
      const bytes = mockDisk.get(uri) as Uint8Array;
      return { data: bytes, sizeBytes: bytes.byteLength };
    },
    scheduleImportOfFile, deletedDAVERecordIds, operationalSyncTombstonesRef: { current: [] },
    ensureReferenceDocumentsDirectory: async () => REFERENCE_DIR,
    sanitizeFilename: (name: string) => name,
    FileSystem: {
      deleteAsync: async (uri: string) => { mockDisk.delete(uri); },
      copyAsync: async ({ from, to }: { from: string; to: string }) => { mockDisk.set(to, (mockDisk.get(from) as Uint8Array).slice()); },
      readAsStringAsync: async () => '',
    },
    normalizeReferenceDocument, normalizeScheduleImport, dedupeScheduleImportItems, bindStableScheduleImportItemIds,
    validateScheduleImportScope,
    isDavePdfTextExtractionAvailable: () => false,
    extractSchedulePdfWithServer: (input: { fileName: string; projects: readonly string[] }) => schedule(input),
    normalizeScheduleItem: (item: Record<string, unknown>) => ({ id: 'pdf-review-row', scheduleProjectName: item.projectName, priority: 'Medium', percentComplete: 0, ...item }),
    deleteStoredReferenceDocument: async (uri: string) => { deletedReferenceCopies.push(uri); mockDisk.delete(uri); },
    projectScheduleImportCardRef,
    setIncomingScheduleImportBatch: (batch: PIEScheduleImportBatch) => { opened.push(batch); },
    setScheduleProjectFilter: () => undefined,
    setScreen: (screen: string) => { screens.push(screen); },
    // A document's card (createProjectDocumentFromAsset and the save)
    uid: () => `doc-${++ids}`,
    filenameFromUri: () => 'picked.pdf',
    draft: { id: 'draft-1', projectName: PROJECT, selectedAreaId: null },
    OWNED_PROJECT_DOCUMENTS_DIR: OWNED_ROOT,
    importProjectDocumentIntoOwnedStorage,
    normalizeProjectDocument: (document: ProjectDocument) => document,
    buildProjectDocumentStoragePath: (id: string, projectId: string, name: string) => `project-documents/${projectId}/${id}/${name}`,
    projectDocumentsCurrentRef,
    setProjectDocuments: (documents: ProjectDocument[]) => { projectDocumentsCurrentRef.current = documents; },
    persistStorageItem: async (key: string, value: string) => {
      const write = ++writes;
      if (options.holdWrite) await options.holdWrite;
      if (options.storageFails || options.failWriteAt === write) throw new Error('The phone is out of storage.');
      storage.set(key, value);
    },
    PROJECT_DOCUMENTS_STORAGE_KEY: STORAGE_KEY,
    cleanupProjectDocumentOwnedFileForRecordRemoval: async (input: Parameters<typeof cleanupProjectDocumentOwnedFileForRecordRemoval>[0]) => { if (options.holdCleanup) await options.holdCleanup; return cleanupProjectDocumentOwnedFileForRecordRemoval(input); },
    reportStoragePersistenceFailure: () => undefined,
    /** The upload tried at once, as for any add; with no signal it fails and the document waits (App.tsx retryProjectDocumentUpload). */
    bindProjectDocumentUploadToAccount,
    retryProjectDocumentUpload: async (documentId: string) => { uploadAttempts.push(documentId); if (options.holdUpload) await options.holdUpload; return false; },
    attachProjectDocumentToDraft: async () => undefined,
    setDocumentUploadRequest: () => undefined,
    validateECOSMobileDrawingControls: () => ({ valid: true }),
    mobileDrawingMetadataForUpload: () => ({}),
    canonicalReferenceCategory: () => 'other',
    referenceDocumentAppliesToProject: () => false,
    DocumentPicker: { getDocumentAsync: async () => ({ canceled: false, assets: [lastPicked] }) },
    preflightExpoFileRead: async () => undefined,
  };
  let lastPicked = { uri: '', name: '', mimeType: 'application/pdf', size: 0 };
  const pick = (picked: Picked) => {
    const uri = `file:///app/Library/Caches/DocumentPicker/pick-${++picks}.pdf`;
    mockDisk.set(uri, picked.bytes.slice());
    lastPicked = { uri, name: picked.name, mimeType: 'application/pdf', size: picked.bytes.byteLength };
    return lastPicked;
  };

  /** Documents > Add Project Documents > this file, this category, these projects ticked > confirm. */
  async function addInDocuments(picked: Picked, category: Category, ticked: readonly string[] = [PROJECT]) {
    const asset = pick(picked);
    const fns = compile<{ confirmDocumentProjectSelection: () => Promise<void> }>([
      'confirmDocumentProjectSelection', 'createProjectDocumentFromAsset', 'duplicateProjectDocumentForAsset',
      'confirmAndAttachProjectDocument', 'saveProjectDocument', 'addProjectDocumentDurably',
      'persistProjectDocumentsImmediately', 'prepareScheduleImportFromAsset', 'cancelScheduleImport', 'deleteOwnedProjectDocument',
    ], {
      ...shared,
      projectDocuments: projectDocumentsCurrentRef.current,
      documentUploadRequest: {
        asset, selected: new Set(ticked), category, attachToDraft: false, areaId: null, updateId: null, drawingControls: {},
      },
    });
    await fns.confirmDocumentProjectSelection();
  }

  /** Tasks > Manage Schedule > Add Schedule or Task > Schedule File > this file (App.tsx importScheduleFile). */
  async function addInTasks(picked: Picked) {
    pick(picked);
    const fns = compile<{ importScheduleFile: () => Promise<PIEScheduleImportBatch | null> }>(
      ['importScheduleFile', 'prepareScheduleImportFromAsset'], { ...shared, screen: 'Schedule' },
    );
    return fns.importScheduleFile();
  }

  const cancelScheduleImport = compile<{ cancelScheduleImport: (batch: PIEScheduleImportBatch) => void }>(['cancelScheduleImport'], shared).cancelScheduleImport;
  /** The cards Documents lists after a restart: what the phone saved. */
  const savedCards = () => JSON.parse(storage.get(STORAGE_KEY) || '[]') as ProjectDocument[];

  return { shared, owner, addInDocuments, addInTasks, cancelScheduleImport, savedCards, projectDocumentsCurrentRef, projectScheduleImportCardRef, alerts, uploadAttempts, deletedReferenceCopies, opened, screens };
}

// New independent cases below execute actual file import, save, cleanup and
// review-cancel producers, with real lifecycle services over synthetic native files.
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(done => { release = done; });
  return { promise, release };
}
const settle = () => new Promise<void>(done => setTimeout(done, 0));
const ownedFiles = () => [...mockDisk.keys()].filter(uri => uri.startsWith(OWNED_ROOT));
const reviewFiles = () => [...mockDisk.keys()].filter(uri => uri.startsWith(REFERENCE_DIR));
async function seed(options: Parameters<typeof phone>[0] = {}) {
  const p = phone(options); await p.addInDocuments(F1, 'Other');
  p.uploadAttempts.splice(0); return p;
}
async function question(p: ReturnType<typeof phone>) {
  await waitFor(() => expect(p.alerts.some(alert => alert.title === 'Possible duplicate document')).toBe(true));
}
function choose(p: ReturnType<typeof phone>, label: string) {
  const q = [...p.alerts].reverse().find(alert => alert.title === 'Possible duplicate document');
  const answer = q?.buttons?.find(button => button.text === label)?.onPress;
  if (!answer) throw Error('Missing native question choice ' + label);
  answer();
}
beforeEach(() => { mockDisk.clear(); mockNativeCopyBarrier = null; mockNativeStatBarrier = null; schedule = NO_SIGNAL; selectionVersion = 'B55'; });

it('a pending duplicate decision makes no saved-review claim; normal Cancel cleans both independent rejected files', async () => {
  const p = await seed(); const original = p.savedCards()[0];
  const operation = p.addInDocuments(F1, 'Schedule'); await question(p);
  expect(p.savedCards()).toEqual([original]); expect(p.opened).toEqual([]); expect(p.projectScheduleImportCardRef.current).toBeNull();
  expect(ownedFiles()).toHaveLength(2); expect(reviewFiles()).toHaveLength(1);
  choose(p, 'Cancel'); await operation; await settle();
  expect(p.savedCards()).toEqual([original]); expect(p.uploadAttempts).toEqual([]);
  expect(ownedFiles()).toEqual([original.localUri]); expect(reviewFiles()).toEqual([]); expect(p.opened).toEqual([]);
});
it('Upload Anyway waits for durable acknowledgement, then binds the new owned duplicate while its first upload is pending', async () => {
  const control: { holdWrite?: Promise<void>; holdUpload?: Promise<void> } = {};
  const p = await seed(control); const original = p.savedCards()[0]; const disk = barrier(), upload = barrier();
  control.holdWrite = disk.promise; control.holdUpload = upload.promise;
  const operation = p.addInDocuments(F1, 'Schedule'); await question(p); choose(p, 'Upload Anyway'); await settle();
  try {
    expect(p.savedCards()).toEqual([original]); expect(p.opened).toEqual([]); expect(p.uploadAttempts).toEqual([]);
    disk.release(); await operation; await settle();
    const accepted = p.savedCards().find(card => card.id !== original.id)!;
    expect(accepted).toBeTruthy(); expect((accepted as unknown as { duplicateOf: string }).duplicateOf).toBe(original.id);
    expect(accepted.ownedFileId).not.toBe(original.ownedFileId); expect(accepted.localUri).not.toBe(original.localUri);
    expect(mockDisk.get(accepted.localUri!)).toEqual(F1.bytes);
    expect(p.projectScheduleImportCardRef.current).toEqual({ batchId: p.opened[0].id, documentId: accepted.id });
    expect(p.uploadAttempts).toEqual([accepted.id]); expect(p.opened).toHaveLength(1);
  } finally { disk.release(); upload.release(); await operation; await settle(); }
});
it('a later save failure truthfully counts the acknowledged new duplicate, cleans only failed/review copies, and retries only the retained identity', async () => {
  const control: { failWriteAt?: number } = {}; const p = await seed(control); const original = p.savedCards()[0];
  control.failWriteAt = 3; // seed + accepted first duplicate + failing second project
  const operation = p.addInDocuments(F1, 'Schedule', [PROJECT, 'Second Pier', 'Third Pier']); await question(p); choose(p, 'Upload Anyway'); await operation; await settle();
  const accepted = p.savedCards().find(card => card.id !== original.id)!;
  expect(p.savedCards()).toHaveLength(2); expect(p.opened).toEqual([]); expect(reviewFiles()).toEqual([]);
  expect(ownedFiles().sort()).toEqual([original.localUri!, accepted.localUri!].sort()); expect(p.uploadAttempts).toEqual([accepted.id]);
  const notice = p.alerts.at(-1)!; expect(notice.title).toBe('Some document copies were saved');
  expect(notice.message).toContain(`“F1.pdf” — ${PROJECT} (waiting to upload).`);
  expect(notice.message).toContain('The copy for Second Pier was not saved.'); expect(notice.message).toContain('Not attempted: Third Pier.');
});
it('cancelling a second-project duplicate retains the first new file, removes the rejected and review files, and stops remaining copies', async () => {
  const p = phone(); await p.addInDocuments(F1, 'Other', ['Second Pier']); p.uploadAttempts.splice(0);
  const original = p.savedCards()[0]; const operation = p.addInDocuments(F1, 'Schedule', [PROJECT, 'Second Pier', 'Third Pier']); await question(p);
  choose(p, 'Cancel'); await operation; await settle();
  const first = p.savedCards().find(card => card.id !== original.id)!;
  expect(p.savedCards()).toHaveLength(2); expect(p.savedCards().some(card => card.projectId === projectKey('Third Pier'))).toBe(false);
  expect(ownedFiles().sort()).toEqual([original.localUri!, first.localUri!].sort()); expect(reviewFiles()).toEqual([]);
  expect(p.opened).toEqual([]); expect(p.uploadAttempts).toEqual([first.id]);
  expect(p.alerts.at(-1)?.title).toBe('Schedule review cancelled'); expect(p.alerts.at(-1)?.message).toContain('Remaining project copies were not added.');
});
it.each(['Cancel', 'Upload Anyway'])('switch-return while the duplicate question is open rejects stale %s and releases both unkept native files', async answer => {
  const p = await seed(); const original = p.savedCards()[0];
  const operation = p.addInDocuments(F1, 'Schedule'); await question(p);
  noteSignedInOwner('different-account'); noteSignedInOwner(p.owner); choose(p, answer); await operation; await settle();
  expect(p.savedCards()).toEqual([original]); expect(p.opened).toEqual([]); expect(p.uploadAttempts).toEqual([]);
  expect(ownedFiles()).toEqual([original.localUri]); expect(reviewFiles()).toEqual([]);
});
it('owner change during native duplicate copy must stop before asking and release the unkept card and review copies', async () => {
  const p = await seed(); const original = p.savedCards()[0]; const native = barrier(); mockNativeCopyBarrier = native.promise;
  const operation = p.addInDocuments(F1, 'Schedule');
  await waitFor(() => expect(reviewFiles()).toHaveLength(1));
  noteSignedInOwner('different-account'); native.release(); await operation; await settle();
  expect(p.alerts).toEqual([]); expect(p.savedCards()).toEqual([original]); expect(p.opened).toEqual([]); expect(p.uploadAttempts).toEqual([]);
  expect(ownedFiles()).toEqual([original.localUri]); expect(reviewFiles()).toEqual([]);
});
it('an account transition after accepted durable save retains that card but releases the unopened review copy', async () => {
  const control: { holdWrite?: Promise<void> } = {}; const p = await seed(control); const disk = barrier(); control.holdWrite = disk.promise;
  const operation = p.addInDocuments(F1, 'Schedule'); await question(p); choose(p, 'Upload Anyway'); await settle();
  noteSignedInOwner(null); noteSignedInOwner(p.owner); disk.release(); await operation; await settle();
  expect(p.savedCards()).toHaveLength(2); expect(ownedFiles()).toHaveLength(2); expect(p.opened).toEqual([]); expect(p.uploadAttempts).toEqual([]);
  expect(reviewFiles()).toEqual([]);
});
it('ordinary document duplicate still returns its existing question path and Cancel cleans the unused new file', async () => {
  const p = await seed(); const original = p.savedCards()[0]; await p.addInDocuments(F1, 'Other');
  expect(p.alerts.at(-1)?.title).toBe('Possible duplicate document'); expect(p.opened).toEqual([]);
  choose(p, 'Cancel'); await settle(); expect(p.savedCards()).toEqual([original]); expect(ownedFiles()).toEqual([original.localUri]); expect(reviewFiles()).toEqual([]);
});
it('a readable Schedule duplicate retains the import-only path and creates no new card-owned file', async () => {
  const p = await seed(); const original = p.savedCards()[0]; schedule = SERVICE_READS_ONE_TASK;
  await p.addInDocuments(F1, 'Schedule');
  expect(p.alerts).toEqual([]); expect(p.opened).toHaveLength(1); expect(p.savedCards()).toEqual([original]); expect(ownedFiles()).toEqual([original.localUri]); expect(p.uploadAttempts).toEqual([]);
});

it.each([true, false])('actual task approval consumes only the new duplicate binding after durable queue=%s, preserving the independent upload-record mapping', async protectedInQueue => {
  const p = phone(); await p.addInDocuments(F1, 'Schedule');
  const original = p.savedCards()[0]; p.cancelScheduleImport(p.opened[0]); await settle(); p.opened.splice(0); p.uploadAttempts.splice(0);
  p.projectDocumentsCurrentRef.current = p.projectDocumentsCurrentRef.current.map(card => ({ ...card, isCurrent: true, referenceDocumentId: 'shared-original' }));
  const adding = p.addInDocuments(F1, 'Schedule'); await question(p); choose(p, 'Upload Anyway'); await adding; await settle();
  const accepted = p.savedCards().find(card => card.id !== original.id)!;
  expect(p.projectScheduleImportCardRef.current?.documentId).toBe(accepted.id);
  const batch = { ...p.opened[0], items: [{ id: 'reviewed-task', taskName: 'Pour pier caps', projectName: PROJECT, locationName: '', startDate: '2026-10-26', finishDate: '2026-10-30', owner: '', priority: 'Medium', percentComplete: 0, status: 'Not Started', notes: '', createdAt: '2026-10-17T12:00:00.000Z', importedFrom: 'F1.pdf' }] } as unknown as PIEScheduleImportBatch;
  const scheduleRef = p.shared.scheduleItemsCurrentRef as { current: unknown[] };
  const referenceRef = p.shared.referenceDocumentsCurrentRef as { current: Array<{ id: string; importBatchId?: string | null }> };
  const queuedImports: unknown[] = [], queuedUploadRecords: Array<{ id: string; importBatchId?: string | null }> = [];
  const deps = {
    ...p.shared,
    scheduleImportApprovalBlocker, ScheduleImportReviewError, bindPIEScheduleImportBatchProvenance,
    canonicalizeScheduleIdentityItems: (items: unknown[]) => items, normalizeScheduleItem: (item: unknown) => item,
    identityCorrections: [], daveRegisteredIdentityNames: () => [], ensureScheduleParentProjects: () => undefined,
    mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleImportAddsToMaster,
    findExactScheduleTaskForCompletionClaim, mergeReportedCompletionClaim, reconcileDAVEScheduleRecords, scheduleDocumentsAfterApproval, scheduleTurnedHighLineBetween,
    runScheduleImportCloudSync: async (input: unknown) => { queuedImports.push(input); return { durablyQueued: protectedInQueue, fullySynced: true, errors: ['Synthetic recovery save refused'], supersededScheduleItemIds: [], supersededReferenceDocumentIds: [], uploadedReferenceDocuments: [] }; },
    markScheduleItemsAuthorityReady: () => undefined, markReferenceDocumentsAuthorityReady: () => undefined,
    setScheduleItems: (items: unknown[]) => { scheduleRef.current = items; },
    setReferenceDocuments: (documents: typeof referenceRef.current) => { referenceRef.current = documents; },
    markCurrentProjectScheduleDocument, uploadedProjectDocumentToShare, buildSharedReferenceDocument, parseOwnedLocalFileManifest,
    setDraft: () => undefined, setSavedUpdates: () => undefined,
    setProjectDocuments: (input: ProjectDocument[] | ((cards: ProjectDocument[]) => ProjectDocument[])) => { p.projectDocumentsCurrentRef.current = typeof input === 'function' ? input(p.projectDocumentsCurrentRef.current) : input; },
    queueReferenceDocumentRecord: async (record: typeof queuedUploadRecords[number]) => { queuedUploadRecords.push(record); },
  };
  const actual = compile<{ approveScheduleImport: (review: PIEScheduleImportBatch) => Promise<unknown>; publishUploadedProjectDocument: (card: ProjectDocument, bound: () => boolean) => Promise<void> }>([
    'approveScheduleImport', 'markProjectScheduleCardCurrent', 'persistProjectDocumentsImmediately', 'publishUploadedProjectDocument', 'updateDocumentEverywhere',
  ], deps);
  if (!protectedInQueue) {
    await expect(actual.approveScheduleImport(batch)).rejects.toThrow('Synthetic recovery save refused');
    expect(p.savedCards().find(card => card.id === accepted.id)).not.toMatchObject({ isCurrent: true });
    expect(p.projectScheduleImportCardRef.current?.documentId).toBe(accepted.id); expect(queuedUploadRecords).toEqual([]);
    return;
  }
  await actual.approveScheduleImport(batch); await settle();
  expect(queuedImports).toHaveLength(1); expect(p.projectScheduleImportCardRef.current).toBeNull();
  const kept = p.savedCards().find(card => card.id === accepted.id)!;
  expect(kept).toMatchObject({ id: accepted.id, isCurrent: true });
  expect(p.savedCards().find(card => card.id === original.id)).toMatchObject({ isCurrent: false, referenceDocumentId: 'shared-original' });
  expect(scheduleRef.current).toHaveLength(1);
  expect(scheduleRef.current[0]).toMatchObject({ importBatchId: batch.id, sourceDocumentId: batch.documents[0].id });
  expect(referenceRef.current.some(document => document.id === batch.documents[0].id)).toBe(true);
  // Model only transport completion, then run the real publisher. It must keep
  // the card's own upload identity, not overwrite the imported task authority.
  p.projectDocumentsCurrentRef.current = p.projectDocumentsCurrentRef.current.map(card => card.id === accepted.id ? { ...card, status: 'uploaded' as const } : card);
  await actual.publishUploadedProjectDocument(p.projectDocumentsCurrentRef.current.find(card => card.id === accepted.id)!, bindProjectDocumentUploadToAccount()); await settle();
  expect(queuedUploadRecords).toHaveLength(1); expect(queuedUploadRecords[0]).toMatchObject({ id: accepted.id, importBatchId: null });
  expect(queuedUploadRecords[0].id).not.toBe(batch.documents[0].id);
  expect(p.savedCards().find(card => card.id === accepted.id)).toMatchObject({ isCurrent: true, referenceDocumentId: accepted.id });
  expect(referenceRef.current.find(document => document.id === batch.documents[0].id)?.importBatchId).toBe(batch.id);
});

it.each(['B54', 'B55'] as const)('%s same mounted request state: late duplicate Cancel completion must preserve a newly opened document selection', async version => {
  const control: { holdCleanup?: Promise<void> } = {}; const p = await seed(control);
  selectionVersion = version;
  const state = renderHook(() => useState<unknown>(null));
  p.shared.setDocumentUploadRequest = (next: unknown) => { act(() => state.result.current[1](next)); };
  const cleanup = barrier();
  const operation = p.addInDocuments(F1, 'Schedule'); await question(p);
  // The production cleanup hashes and preflights the file. Delay the actual
  // native getInfoAsync boundary rather than replacing that cleanup producer.
  mockNativeStatBarrier = cleanup.promise; choose(p, 'Cancel'); await settle();
  const actions = compile<{ cancelDocumentProjectSelection: () => void; promptDocumentProjectSelection: (asset: { uri: string; name: string }, project: string) => void }>([
    'cancelDocumentProjectSelection', 'promptDocumentProjectSelection',
  ], { ...p.shared, suggestProjectDocumentCategory: () => 'Other', createECOSMobileDrawingControls: () => ({}) });
  // The real details sheet still permits Close while onConfirm waits. After
  // native Cancel dismisses the question, close it and pick another document.
  actions.cancelDocumentProjectSelection();
  actions.promptDocumentProjectSelection({ uri: 'file:///picker/new.pdf', name: 'new.pdf' }, PROJECT);
  expect(state.result.current[0]).toMatchObject({ asset: { name: 'new.pdf' } });
  cleanup.release(); await operation; await settle();
  expect(state.result.current[0]).toMatchObject({ asset: { name: 'new.pdf' } });
  state.unmount();
});


