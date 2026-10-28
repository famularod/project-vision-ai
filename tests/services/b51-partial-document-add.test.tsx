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
const mockDisk = new Map<string, Uint8Array>();
let mockCopyFailureAt: number | undefined;
let mockCopies = 0;

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
      return new Promise<void>((resolve, reject) => setTimeout(() => {
        if (!bytes || ++mockCopies === mockCopyFailureAt) return reject(new Error('The native copy failed.'));
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
  getInfoAsync: async (uri: string) => mockDisk.has(uri)
    ? { exists: true, size: (mockDisk.get(uri) as Uint8Array).byteLength }
    : { exists: false },
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `5e26a0b1-4c2d-4e8f-9a1b-${String(++mockUuid).padStart(12, '0')}`,
}));
jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { act, fireEvent, render } from '@testing-library/react-native';

import { ScheduleImportFlow } from '../../components/ScheduleImportFlow';
import { deletedDAVERecordIds } from '../../services/DAVESyncTombstones';
import { dedupeScheduleImportItems, type PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import * as remoteExtraction from '../../services/PIEScheduleRemoteExtraction';
import { cleanupProjectDocumentOwnedFileForRecordRemoval, importProjectDocumentIntoOwnedStorage } from '../../services/ProjectDocumentLifecycle';
import { bindProjectDocumentUploadToAccount, createProjectDocumentUploadRetryRunner, projectDocumentsAwaitingUpload } from '../../services/ProjectDocumentUploadRetry';
import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import { validateScheduleImportScope } from '../../services/ScheduleImportScopeGuard';
import { bindStableScheduleImportItemIds } from '../../services/ScheduleImportSourceIdentity';
import { scheduleImportOfFile } from '../../services/SharedDocumentActivation';
/** A document card as App.tsx keeps it (its ProjectDocument type is App.tsx's own); the fields read here. */
type ProjectDocument = {
  id: string; name: string; category: string; status: 'local' | 'uploading' | 'uploaded' | 'failed'; projectId: string;
  localUri?: string | null; ownedFileId?: string | null; ownedFileManifest?: unknown; isArchived?: boolean | null;
};

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** A function of App.tsx (inside the App component, or at the top level), brace-matched after its parameters. */
function appFunction(name: string): string {
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
function phone(options: Readonly<{ storageFails?: boolean; storageFailsAt?: number; copyFailsAt?: number; uploadThrowsAt?: number; uploadStatus?: ProjectDocument['status']; uploadFailure?: unknown }> = {}) {
  mockCopyFailureAt = options.copyFailsAt;
  const storage = new Map<string, string>();
  const projectDocumentsCurrentRef = { current: [] as ProjectDocument[] };
  const projectScheduleImportCardRef = { current: null as null | { batchId: string; documentId: string } };
  const alerts: Array<{ title: string; message: string; buttons?: Array<{ text: string; onPress?: () => void }> }> = [];
  const uploadAttempts: string[] = [];
  const deletedReferenceCopies: string[] = [];
  const opened: PIEScheduleImportBatch[] = [];
  const screens: string[] = [];
  let writes = 0;
  let picks = 0;
  let ids = 0;

  const Alert = { alert: (title: string, message: string, buttons?: Array<{ text: string; onPress?: () => void }>) => { alerts.push({ title, message, buttons }); } };
  const shared: Record<string, unknown> = {
    Alert, documentUploadRequestEpochRef: { current: 0 }, screen: 'ProjectDocuments',
    // The projects
    activeProjects: [PROJECT,'Second Project','Third Project'], projects: [PROJECT,'Second Project','Third Project'],
    archivedProjectsCurrentRef: { current: [] }, deletedProjectNamesRef: { current: [] },
    projectsCurrentRef: { current: [PROJECT,'Second Project','Third Project'] }, projectRecordsCurrentRef: { current: [] },
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
      if (options.storageFails || ++writes === options.storageFailsAt) throw new Error('The phone is out of storage.');
      storage.set(key, value);
    },
    PROJECT_DOCUMENTS_STORAGE_KEY: STORAGE_KEY,
    cleanupProjectDocumentOwnedFileForRecordRemoval,
    reportStoragePersistenceFailure: () => undefined,
    /** The upload tried at once, as for any add; with no signal it fails and the document waits (App.tsx retryProjectDocumentUpload). */
    bindProjectDocumentUploadToAccount,
    retryProjectDocumentUpload: async (documentId: string) => {
      uploadAttempts.push(documentId);
      if (uploadAttempts.length === options.uploadThrowsAt) throw ('uploadFailure' in options ? options.uploadFailure : new Error('Synthetic unexpected upload failure.'));
      // Only the uploader I/O boundary is synthetic. Persist its new status to
      // the same storage and ref the actual selection closure must read.
      if (options.uploadStatus) {
        const next = projectDocumentsCurrentRef.current.map(card => card.id === documentId ? { ...card, status: options.uploadStatus! } : card);
        await (shared.persistStorageItem as (key:string,value:string)=>Promise<void>)(STORAGE_KEY,JSON.stringify(next));
        projectDocumentsCurrentRef.current = next;
      }
      return options.uploadStatus === 'uploaded';
    },
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

  const cancelSelection = compile<{cancelDocumentProjectSelection:()=>void}>(['cancelDocumentProjectSelection'],shared).cancelDocumentProjectSelection;
  const cancelScheduleImport = compile<{ cancelScheduleImport: (batch: PIEScheduleImportBatch) => void }>(['cancelScheduleImport'], shared).cancelScheduleImport;
  /** The cards Documents lists after a restart: what the phone saved. */
  const savedCards = () => JSON.parse(storage.get(STORAGE_KEY) || '[]') as ProjectDocument[];

  return { cancelSelection, addInDocuments, addInTasks, cancelScheduleImport, savedCards, projectDocumentsCurrentRef, projectScheduleImportCardRef, alerts, uploadAttempts, deletedReferenceCopies, opened, screens };
}

/** The review as the Schedule screen shows it, opened on the batch Documents handed over. */
function review(batch: PIEScheduleImportBatch, onCancel: (batch: PIEScheduleImportBatch) => void) {
  return render(
    <ScheduleImportFlow
      screenshotImportAvailable={false}
      onImportFile={jest.fn(async () => null)}
      onImportScreenshots={jest.fn(async () => null)}
      onAddManually={jest.fn()}
      onApprove={jest.fn(async () => null)}
      onCancel={onCancel}
      incomingBatch={batch}
      roleContext={{ documents: [], items: [] }}
    />,
  );
}

beforeEach(() => {
  mockDisk.clear();
  mockCopies = 0;mockCopyFailureAt = undefined;
  schedule = NO_SIGNAL;
});

const SAVED_REVIEW_LINE = 'The PDF is saved in Documents. The PDF\'s tasks could not be read: no dated activities were extracted. The schedule extraction service could not be reached.';

it.each(['Schedule','Other'] as const)('5.29 %s: second project storage failure truthfully names the first durable card and leaves later projects unattempted',async category=>{
 const device=phone({storageFailsAt:2});await device.addInDocuments(F1,category,[PROJECT,'Second Project','Third Project']);
 expect(device.savedCards()).toHaveLength(1);const card=device.savedCards()[0];expect(card.projectId).toBe(projectKey(PROJECT));expect(card.status).toBe('local');expect(mockDisk.get(card.localUri!)).toEqual(F1.bytes);expect(device.uploadAttempts).toEqual([card.id]);
 expect(projectDocumentsAwaitingUpload(device.savedCards()).map(x=>x.id)).toEqual([card.id]);
 const alert=device.alerts.at(-1)!;expect(alert.title).toBe('Some document copies were saved');expect(alert.message).toContain(PROJECT);expect(alert.message).toContain('Second Project');expect(alert.message).toContain('Third Project');expect(alert.message).toContain('waiting to upload');expect(alert.message).not.toContain('The selected file was not uploaded.');expect(device.opened).toEqual([]);
 expect([...mockDisk.keys()].filter(uri=>uri.startsWith(OWNED_ROOT)&&uri.endsWith('.pdf'))).toEqual([card.localUri]);
});

it.each(['Schedule','Other'] as const)('5.29 %s zero-success storage failure retains the existing single-copy guidance',async category=>{
 const device=phone({storageFailsAt:1});await device.addInDocuments(F1,category,[PROJECT,'Second Project']);expect(device.savedCards()).toEqual([]);expect(device.uploadAttempts).toEqual([]);expect(device.alerts.at(-1)?.message).toBe('Vitruvius could not save this document record. The selected file was not uploaded.');expect(device.alerts.at(-1)?.title).not.toBe('Some document copies were saved');expect([...mockDisk.keys()].filter(uri=>uri.startsWith(OWNED_ROOT)&&uri.endsWith('.pdf'))).toEqual([]);
});
it('5.29 two confirmed copies are named, the failing presave card is excluded, and no remainder is invented',async()=>{
 const device=phone({storageFailsAt:3});await device.addInDocuments(F1,'Other',[PROJECT,'Second Project','Third Project']);expect(device.savedCards()).toHaveLength(2);const alert=device.alerts.at(-1)!;expect(alert.title).toBe('Some document copies were saved');expect(alert.message).toContain(`“F1.pdf” — ${PROJECT} (waiting to upload).`);expect(alert.message).toContain('“F1.pdf” — Second Project (waiting to upload).');expect(alert.message).toContain('The copy for Third Project was not saved.');expect(alert.message).not.toContain('“F1.pdf” — Third Project');expect(alert.message).not.toContain('Not attempted:');
});
it('5.29 copy failure after one durable card leaves that card retryable and reports the remaining projects',async()=>{
 const device=phone({copyFailsAt:2});await device.addInDocuments(F1,'Other',[PROJECT,'Second Project','Third Project']);expect(device.savedCards()).toHaveLength(1);expect(device.alerts.at(-1)?.title).toBe('Some document copies were saved');expect(device.alerts.at(-1)?.message).toContain('Not attempted: Third Project.');expect(projectDocumentsAwaitingUpload(device.savedCards())).toHaveLength(1);
});
it('5.29 a first copy failure and selection cancel never claim a saved copy or upload',async()=>{
 const device=phone({copyFailsAt:1});device.cancelSelection();expect(device.alerts).toEqual([]);expect(device.savedCards()).toEqual([]);await device.addInDocuments(F1,'Other',[PROJECT]);expect(device.savedCards()).toEqual([]);expect(device.uploadAttempts).toEqual([]);expect(device.alerts.at(-1)?.title).toBe('Document unavailable');
});
it('5.29 a pre-existing duplicate and canceled Upload Anyway are not this attempt’s durable success',async()=>{
 const device=phone({storageFailsAt:2});await device.addInDocuments(F1,'Other');const before=device.savedCards()[0];await device.addInDocuments(F1,'Other',[PROJECT,'Second Project','Third Project']);const duplicate=device.alerts.find(a=>a.title==='Possible duplicate document')!;expect(duplicate).toBeTruthy();expect(device.alerts.at(-1)?.title).toBe('Document unavailable');expect(device.alerts.at(-1)?.message).not.toContain('Some document copies were saved');duplicate.buttons!.find(b=>b.text==='Cancel')!.onPress!();await new Promise(r=>setTimeout(r,20));expect(device.savedCards()).toEqual([before]);expect(mockDisk.get(before.localUri!)).toEqual(F1.bytes);expect(device.uploadAttempts).toEqual([before.id]);
});
it('5.29 a failure after persistence still acknowledges the card and never calls it unsaved',async()=>{
 const device=phone({uploadThrowsAt:1});await device.addInDocuments(F1,'Other',[PROJECT,'Second Project']);expect(device.savedCards()).toHaveLength(1);expect(device.alerts.at(-1)?.message).toContain(`The add for ${PROJECT} did not finish.`);expect(device.alerts.at(-1)?.message).not.toContain(`The copy for ${PROJECT} was not saved.`);expect(device.alerts.at(-1)?.message).toContain('Not attempted: Second Project.');
});
it.each(['uploaded','failed'] as const)('5.29 the notice uses the actual durable %s status rather than the pre-save card',async status=>{
 const device=phone({storageFailsAt:3,uploadStatus:status});await device.addInDocuments(F1,'Other',[PROJECT,'Second Project']);expect(device.savedCards()[0].status).toBe(status);expect(device.alerts.at(-1)?.message).toContain(status==='uploaded'?'file uploaded':'upload needs retry');expect(device.alerts.at(-1)?.message).not.toContain('waiting to upload');
});
it.each(['Schedule','Other'] as const)('5.29 successful %s multi-project adds retain their independent cards and behavior',async category=>{
 const device=phone();await device.addInDocuments(F1,category,[PROJECT,'Second Project']);expect(device.savedCards()).toHaveLength(2);expect(device.uploadAttempts).toHaveLength(2);expect(device.alerts).toEqual([]);expect(device.opened).toHaveLength(category==='Schedule'?1:0);for(const card of device.savedCards())expect(mockDisk.get(card.localUri!)).toEqual(F1.bytes);
});

it('5.29 non-Error failure after a durable save gives neutral guidance without saying that saved card was not saved',async()=>{
 const device=phone({uploadThrowsAt:1,uploadFailure:undefined});await device.addInDocuments(F1,'Other',[PROJECT,'Second Project']);expect(device.savedCards()).toHaveLength(1);expect(device.alerts.at(-1)?.message).toContain('The document add could not be completed.');expect(device.alerts.at(-1)?.message).not.toContain(`The copy for ${PROJECT} was not saved.`);
});
