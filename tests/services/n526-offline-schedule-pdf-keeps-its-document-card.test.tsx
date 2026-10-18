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
import { importProjectDocumentIntoOwnedStorage } from '../../services/ProjectDocumentLifecycle';
import { createProjectDocumentUploadRetryRunner, projectDocumentsAwaitingUpload } from '../../services/ProjectDocumentUploadRetry';
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
function phone(options: Readonly<{ storageFails?: boolean }> = {}) {
  const storage = new Map<string, string>();
  const projectDocumentsCurrentRef = { current: [] as ProjectDocument[] };
  const projectScheduleImportCardRef = { current: null as null | { batchId: string; documentId: string } };
  const alerts: Array<{ title: string; message: string; buttons?: Array<{ text: string }> }> = [];
  const uploadAttempts: string[] = [];
  const deletedReferenceCopies: string[] = [];
  const opened: PIEScheduleImportBatch[] = [];
  const screens: string[] = [];
  let picks = 0;
  let ids = 0;

  const Alert = { alert: (title: string, message: string, buttons?: Array<{ text: string }>) => { alerts.push({ title, message, buttons }); } };
  const shared: Record<string, unknown> = {
    Alert, screen: 'ProjectDocuments',
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
      if (options.storageFails) throw new Error('The phone is out of storage.');
      storage.set(key, value);
    },
    PROJECT_DOCUMENTS_STORAGE_KEY: STORAGE_KEY,
    deleteOwnedProjectDocument: async () => ({ status: 'deleted' }),
    reportStoragePersistenceFailure: () => undefined,
    /** The upload tried at once, as for any add; with no signal it fails and the document waits (App.tsx retryProjectDocumentUpload). */
    retryProjectDocumentUpload: async (documentId: string) => { uploadAttempts.push(documentId); return false; },
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
      'persistProjectDocumentsImmediately', 'prepareScheduleImportFromAsset', 'cancelScheduleImport',
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

  return { addInDocuments, addInTasks, cancelScheduleImport, savedCards, projectDocumentsCurrentRef, projectScheduleImportCardRef, alerts, uploadAttempts, deletedReferenceCopies, opened, screens };
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
  schedule = NO_SIGNAL;
});

const SAVED_REVIEW_LINE = 'The PDF is saved in Documents. The PDF\'s tasks could not be read: no dated activities were extracted. The schedule extraction service could not be reached.';

describe('Open item 5.26: a schedule PDF added without signal keeps its card', () => {
  it('Documents > Schedule with no signal: the card is there at once, the review says so, closing it leaves the card, and it uploads once there is signal', async () => {
    const iPhone = phone();
    await iPhone.addInDocuments(F1, 'Schedule');

    // The card at once, saved on the phone, before the review opens.
    expect(iPhone.alerts).toEqual([]);
    expect(iPhone.savedCards().map(card => [card.name, card.category, card.status, card.projectId])).toEqual([['F1.pdf', 'Schedule', 'local', projectKey(PROJECT)]]);
    const [card] = iPhone.savedCards();
    expect(mockDisk.get(card.localUri as string)).toEqual(F1.bytes);
    expect(iPhone.uploadAttempts).toEqual([card.id]);

    // The review, and what it says.
    expect(iPhone.screens).toEqual(['Schedule']);
    expect(iPhone.opened).toHaveLength(1);
    const view = review(iPhone.opened[0], iPhone.cancelScheduleImport);
    expect(view.getByText(SAVED_REVIEW_LINE)).toBeTruthy();

    // He closes it (X): the review's own copy goes, the card stays.
    await act(async () => { fireEvent.press(view.getByLabelText('Close Review Imported Schedule')); });
    expect(iPhone.opened[0].documents[0].uri.startsWith(REFERENCE_DIR)).toBe(true);
    expect(iPhone.deletedReferenceCopies).toEqual([iPhone.opened[0].documents[0].uri]);
    expect(iPhone.savedCards().map(saved => saved.id)).toEqual([card.id]);
    expect(mockDisk.get(card.localUri as string)).toEqual(F1.bytes);

    // Signal back: the phone's own upload runner takes it, as any document added without signal.
    expect(projectDocumentsAwaitingUpload(iPhone.savedCards()).map(waiting => waiting.id)).toEqual([card.id]);
    const sent: string[] = [];
    const result = await createProjectDocumentUploadRetryRunner(() => iPhone.savedCards())
      .run(async documentId => { sent.push(documentId); return true; }, { ignoreBackoff: true });
    expect(sent).toEqual([card.id]);
    expect(result.attempted).toBe(1);
  });

  it('David\'s steps: after that, a second PDF added without signal (as Other) gets its card too, with no "Document unavailable"', async () => {
    const iPhone = phone();
    await iPhone.addInDocuments(F1, 'Schedule');
    const view = review(iPhone.opened[0], iPhone.cancelScheduleImport);
    await act(async () => { fireEvent.press(view.getByLabelText('Close Review Imported Schedule')); });

    await iPhone.addInDocuments(F2, 'Other');

    expect(iPhone.alerts).toEqual([]);
    expect(iPhone.savedCards().map(card => [card.name, card.category, card.status])).toEqual([
      ['F2.pdf', 'Other', 'local'],
      ['F1.pdf', 'Schedule', 'local'],
    ]);
    expect(projectDocumentsAwaitingUpload(iPhone.savedCards())).toHaveLength(2);
  });

  it('one project ticked: the review is tied to that card, so saving tasks from it makes the card current (as Import This Schedule); closing it unties it', async () => {
    const iPhone = phone();
    await iPhone.addInDocuments(F1, 'Schedule');
    const [card] = iPhone.savedCards();

    expect(iPhone.projectScheduleImportCardRef.current).toEqual({ batchId: iPhone.opened[0].id, documentId: card.id });
    const view = review(iPhone.opened[0], iPhone.cancelScheduleImport);
    await act(async () => { fireEvent.press(view.getByLabelText('Close Review Imported Schedule')); });
    expect(iPhone.projectScheduleImportCardRef.current).toBeNull();
  });

  it('the same file already has a card in the project: the duplicate question is asked, as for any add, and the review is not tied to a card that may not be kept', async () => {
    const iPhone = phone();
    await iPhone.addInDocuments(F1, 'Other');
    expect(iPhone.savedCards()).toHaveLength(1);

    await iPhone.addInDocuments(F1, 'Schedule');

    expect(iPhone.alerts.map(alert => [alert.title, alert.buttons?.map(button => button.text)])).toEqual([
      ['Possible duplicate document', ['Cancel', 'Upload Anyway']],
    ]);
    expect(iPhone.opened).toHaveLength(1);
    expect(iPhone.projectScheduleImportCardRef.current).toBeNull();
  });

  it('when the card cannot be saved, no review says "saved": its copy is removed and the alert says why', async () => {
    const iPhone = phone({ storageFails: true });
    await iPhone.addInDocuments(F1, 'Schedule');

    expect(iPhone.opened).toEqual([]);
    expect(iPhone.screens).toEqual([]);
    expect(iPhone.alerts.map(alert => [alert.title, alert.message])).toEqual([
      ['Schedule review unavailable', 'Vitruvius could not save this document record. The selected file was not uploaded.'],
    ]);
    expect(iPhone.deletedReferenceCopies).toEqual([expect.stringMatching(/^file:\/\/\/app\/Documents\/project-documents\/schedule-document-[a-f0-9]{64}-F1\.pdf$/)]);
    expect([...mockDisk.keys()].filter(uri => uri.startsWith(REFERENCE_DIR))).toEqual([]);
  });

  it('the Tasks tab road (no card there): the review no longer says the PDF is saved', async () => {
    const iPhone = phone();
    const batch = await iPhone.addInTasks(F1);

    expect(batch?.message).toBe('The PDF\'s tasks could not be read: no dated activities were extracted. The schedule extraction service could not be reached.');
    expect(batch?.message).not.toMatch(/saved/i);
    expect(iPhone.savedCards()).toEqual([]);
  });

  it('with signal, a schedule whose tasks are read opens its review as before, with no card', async () => {
    schedule = SERVICE_READS_ONE_TASK;
    const iPhone = phone();
    await iPhone.addInDocuments(F1, 'Schedule');

    expect(iPhone.alerts).toEqual([]);
    expect(iPhone.savedCards()).toEqual([]);
    expect(iPhone.uploadAttempts).toEqual([]);
    expect(iPhone.opened).toHaveLength(1);
    expect(iPhone.opened[0].items.map(item => item.taskName)).toEqual(['Pour pier caps']);
    expect(iPhone.opened[0].message).toMatch(/^1 possible schedule item extracted using schedule service\./);
    expect(iPhone.projectScheduleImportCardRef.current).toBeNull();
  });
});


describe('5.32: empty remote extraction is explained once in the production preparation/review path', () => {
  const serviceReadEmptyPayload = async ({ fileName, projects }: { fileName: string; projects: readonly string[] }) =>
    remoteExtraction.scheduleItemsFromRemoteExtractorPayload({ ok: true, items: [] }, { fileName, projects, extractedAt: '2026-10-15T08:00:00.000Z' });
  it.each(['Tasks', 'Documents'] as const)('%s uses the actual empty-payload error, preserves help and no fabricated activities', async road => {
    schedule = serviceReadEmptyPayload;
    const iPhone = phone();
    const batch = road === 'Tasks'
      ? await iPhone.addInTasks(F1)
      : (await iPhone.addInDocuments(F1, 'Schedule'), iPhone.opened[0]);
    expect(batch).toBeTruthy();
    console.log('EMPTY_EXTRACTION_COPY', JSON.stringify({ road, message: batch!.message, nothingRead: batch!.nothingRead, items: batch!.items.map(item => ({ taskName: item.taskName, startDate: item.startDate, finishDate: item.finishDate })) }));
    expect(batch!.message.match(/no dated(?: schedule)? activities (?:were|could be) extracted/gi)).toHaveLength(1);
    expect(batch!.message).toContain('Check that the PDF is readable and includes task names and dates.');
    expect(batch!.nothingRead).toBe(true);
    expect(batch!.items.every(item => !item.taskName && !item.startDate && !item.finishDate)).toBe(true);
    const view = review(batch!, iPhone.cancelScheduleImport);
    expect(view.getByText(batch!.message)).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByLabelText('Close Review Imported Schedule')); });
    expect(iPhone.deletedReferenceCopies).toEqual([batch!.documents[0].uri]);
    expect(iPhone.savedCards()).toHaveLength(road === 'Documents' ? 1 : 0);
    if (road === 'Documents') expect(mockDisk.get(iPhone.savedCards()[0].localUri as string)).toEqual(F1.bytes);
  });
  it.each([401, 403, 409, 429, 413, 415, 500])('keeps the genuine service/auth failure reason for HTTP %s', async status => {
    const reason = remoteExtraction.scheduleExtractionFailureMessage({ code: 'REQUEST_IN_PROGRESS' }, status);
    schedule = async () => { throw new remoteExtraction.PIEScheduleRemoteExtractionError(reason); };
    const batch = await phone().addInTasks(F1);
    expect(batch!.message).toBe(`The PDF's tasks could not be read: no dated activities were extracted. ${reason}`);
    expect(batch!.nothingRead).toBe(true);
    expect(batch!.items.every(item => !item.taskName && !item.startDate && !item.finishDate)).toBe(true);
  });
});
