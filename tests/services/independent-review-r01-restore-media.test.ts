/**
 * Independent review R01 (Build 229, e818b54): a device backup restore that
 * was partly written, and whose automatic recovery also failed, keeps a
 * journal that finishes it at the next start. The app treated that like a
 * restore that never began and deleted the photo and document files it had
 * just placed, so the finished records pointed at nothing.
 *
 * What runs here is the app's own restore path: App.tsx's restore block and
 * its applyRestoredData (both compiled from its source), the real
 * materializeCompleteBackupState, the real restore runtime and its durable
 * journal, the real restored-file ledger and the real owned-document import,
 * over an in-memory device (files and storage) whose storage can be made to
 * fail at any write. A restart is a new runtime and ledger over the same
 * device. Synthetic data.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { createCompleteBackupArchive } from '../../services/CompleteBackupArchive';
import {
  decryptedBytesAssetProvider,
  materializeCompleteBackupState,
  openSelectedBackup,
  stagedAssetProvider,
  type BackupFileIO,
} from '../../services/DeviceBackupWorkflow';
import {
  BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY,
  BackupRestoreRecoveryRequiredError,
  buildDeletionSafeRestoreState,
  createBackupRestoreRuntime,
  type BackupRestoreBarrierKeys,
  type BackupRestoreTargetKeys,
} from '../../services/BackupRestoreRuntime';
import {
  RESTORED_MEDIA_LEDGER_KEY,
  createNameSearch,
  createRestoredMediaLedger,
  fileNameOf,
} from '../../services/RestoredMediaLedger';
import { importProjectDocumentIntoOwnedStorage } from '../../services/ProjectDocumentLifecycle';
import type { OwnedLocalFileStoreDependencies } from '../../services/OwnedLocalFileStore';

const APP = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
const PASSPHRASE = 'correct horse battery staple';
const NOW = '2026-10-05T12:00:00.000Z';

const DOCUMENTS = 'file:///device/Documents/';
const PHOTO_DIR = `${DOCUMENTS}project-photos/`;
const REFERENCE_DIR = `${DOCUMENTS}reference-documents/`;
const OWNED_DIR = `${DOCUMENTS}project-documents-v2/`;
const CACHE_DIR = 'file:///device/Caches/';
const RESTORED_DIRS = [PHOTO_DIR, REFERENCE_DIR, OWNED_DIR];

const targetKeys: BackupRestoreTargetKeys = {
  updates: 'updates', projects: 'projects', archivedProjects: 'archived-projects', contacts: 'contacts',
  projectAreas: 'areas', referenceDocuments: 'reference-documents', projectDocuments: 'project-documents',
  scheduleItems: 'schedule-items', captureMemories: 'capture-memories', activeDraft: 'draft',
};
const barrierKeys: BackupRestoreBarrierKeys = {
  deletedProjects: 'deleted-projects', deletedUpdates: 'deleted-updates', updateDeletionJournal: 'update-deletion-journal',
  projectDeletionCloudIntents: 'project-cloud-deletion-intents', projectDeletionFileCleanupIntents: 'project-file-cleanup-intents',
  daveSyncTombstones: 'dave-tombstones', fieldUpdateTransactionJournal: 'field-journal', projectDeletionTransactionJournal: 'project-journal',
};

/* The backup ---------------------------------------------------------------- */

const bytesOf = (fill: number, size = 64) => new Uint8Array(size).fill(fill);
/** Every file the backup carries: its asset id and its bytes. */
const ASSETS = {
  'photo:update:u1:p1': { kind: 'photo' as const, name: 'IMG 0001.jpg', bytes: bytesOf(1) },
  'photo:update:u1:p2': { kind: 'photo' as const, name: 'IMG 0002.jpg', bytes: bytesOf(2) },
  'photo:draft:d1:p9': { kind: 'photo' as const, name: 'draft photo.jpg', bytes: bytesOf(9) },
  'reference:r1': { kind: 'reference_document' as const, name: 'Structural S-201.pdf', bytes: bytesOf(21, 200) },
  'project-document:o1': { kind: 'project_document' as const, name: 'Permit.pdf', bytes: bytesOf(31, 120) },
  'project-document:o2': { kind: 'project_document' as const, name: 'Survey.pdf', bytes: bytesOf(32, 90) },
};
const backupState = () => ({
  version: 2,
  savedUpdates: [{
    id: 'u1', projectName: 'Alpha',
    photos: [
      { id: 'p1', uri: '', _backupAssetId: 'photo:update:u1:p1' },
      { id: 'p2', uri: '', _backupAssetId: 'photo:update:u1:p2' },
    ],
  }],
  projects: ['Alpha'],
  archivedProjects: [],
  contacts: { contacts: [] },
  projectAreas: [],
  referenceDocuments: [{ id: 'r1', name: 'Structural S-201', uri: '', _backupAssetId: 'reference:r1' }],
  projectDocuments: [
    { id: 'o1', name: 'Permit.pdf', mimeType: 'application/pdf', _backupAssetId: 'project-document:o1' },
    { id: 'o2', name: 'Survey.pdf', mimeType: 'application/pdf', _backupAssetId: 'project-document:o2' },
  ],
  scheduleItems: [{ id: 'task-1', taskName: 'SURVEY' }],
  captureMemories: [],
  activeDraft: {
    savedAt: NOW,
    draft: { id: 'd1', projectName: 'Alpha', photos: [{ id: 'p9', uri: '', _backupAssetId: 'photo:draft:d1:p9' }] },
  },
});
/** The bytes each restored record must open: record id -> bytes. */
const EXPECTED_BYTES: Record<string, Uint8Array> = {
  p1: ASSETS['photo:update:u1:p1'].bytes, p2: ASSETS['photo:update:u1:p2'].bytes, p9: ASSETS['photo:draft:d1:p9'].bytes,
  r1: ASSETS['reference:r1'].bytes, o1: ASSETS['project-document:o1'].bytes, o2: ASSETS['project-document:o2'].bytes,
};

function deterministicRandom() {
  let seed = 1;
  return async (length: number) => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) { bytes[index] = seed % 251; seed += 1; }
    return bytes;
  };
}

/* The device ---------------------------------------------------------------- */

type FaultMode =
  /** One write fails and is not written. */
  | 'once'
  /** One write is written, then reported as failed. */
  | 'lands_then_throws'
  /** That write and every later one fail, so the immediate recovery fails too. Reads work. */
  | 'writes_fail_until_restart'
  /** From that write on, storage neither reads nor writes: the recovery fails every time it is tried. */
  | 'dead_until_restart';
type Fault = { at: number; mode: FaultMode; tripped: boolean };

type Device = {
  files: Map<string, Uint8Array | string>;
  values: Map<string, string>;
  fault: Fault | null;
  /** Storage writes and removals since the count was last reset. */
  mutations: number;
  nextId: number;
};

const OLD_PHOTO = `${PHOTO_DIR}before00-old-photo.jpg`;
function newDevice(): Device {
  const device: Device = { files: new Map(), values: new Map(), fault: null, mutations: 0, nextId: 0 };
  // What the device held before the restore: one update whose photo file must outlive any failed restore.
  device.files.set(OLD_PHOTO, bytesOf(77));
  device.values.set(targetKeys.updates, JSON.stringify([{ id: 'old-update', projectName: 'Old', photos: [{ id: 'old-p', uri: OLD_PHOTO }] }]));
  device.values.set(targetKeys.projects, JSON.stringify([{ name: 'Old' }]));
  device.values.set(targetKeys.activeDraft, JSON.stringify({ savedAt: NOW, draft: { id: 'old-draft', projectName: 'Old', photos: [] } }));
  return device;
}

function storageOf(device: Device) {
  const dead = () => Boolean(device.fault?.tripped && device.fault.mode === 'dead_until_restart');
  const mutate = (apply: () => void) => {
    const index = device.mutations;
    device.mutations += 1;
    const fault = device.fault;
    if (fault && index === fault.at) {
      fault.tripped = true;
      if (fault.mode === 'lands_then_throws') apply();
      throw new Error('device storage write failed');
    }
    if (fault?.tripped && (fault.mode === 'writes_fail_until_restart' || fault.mode === 'dead_until_restart')) {
      throw new Error('device storage write failed');
    }
    apply();
  };
  return {
    getItem: async (key: string) => {
      if (dead()) throw new Error('device storage unavailable');
      return device.values.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => mutate(() => { device.values.set(key, value); }),
    removeItem: async (key: string) => mutate(() => { device.values.delete(key); }),
    getAllKeys: async () => {
      if (dead()) throw new Error('device storage unavailable');
      return [...device.values.keys()];
    },
  };
}

function fileIO(device: Device): BackupFileIO {
  const { files } = device;
  return {
    sizeOf: async uri => {
      const value = files.get(uri);
      return value === undefined ? null : typeof value === 'string' ? value.length : value.byteLength;
    },
    readBytes: async uri => {
      const value = files.get(uri);
      if (!(value instanceof Uint8Array)) throw new Error(`no bytes at ${uri}`);
      return value;
    },
    readText: async uri => {
      const value = files.get(uri);
      if (typeof value !== 'string') throw new Error(`no text at ${uri}`);
      return value;
    },
    writeText: async (uri, text) => { files.set(uri, text); },
    writeBytes: async (uri, bytes) => { files.set(uri, new Uint8Array(bytes)); },
    move: async (from, to) => {
      const value = files.get(from);
      if (value === undefined) throw new Error(`nothing to move at ${from}`);
      files.delete(from);
      files.set(to, value);
    },
    remove: async uri => {
      files.delete(uri);
      for (const key of [...files.keys()]) if (uri.endsWith('/') && key.startsWith(uri)) files.delete(key);
    },
    makeDirectory: async () => undefined,
  };
}

/** The real owned-document store, on the device's files. */
function ownedStoreDependencies(device: Device): OwnedLocalFileStoreDependencies {
  const { files } = device;
  const bytesAt = (uri: string) => {
    const value = files.get(uri);
    if (!(value instanceof Uint8Array)) throw new Error('missing file');
    return value;
  };
  return {
    generateOpaqueFileId: () => {
      device.nextId += 1;
      return `550e8400-e29b-41d4-a716-${String(device.nextId).padStart(12, '0')}`;
    },
    ensureDirectory: async () => undefined,
    copyFile: async (source, destination) => { files.set(destination, new Uint8Array(bytesAt(source))); },
    readBytes: async uri => new Uint8Array(bytesAt(uri)),
    statFile: async uri => ({ exists: files.has(uri), sizeBytes: files.has(uri) ? bytesAt(uri).byteLength : null }),
    deleteFile: async uri => { if (!files.delete(uri)) throw new Error('missing file'); },
    sha256: async value => Array.from(value).map(byte => byte.toString(16).padStart(2, '0')).join('').padEnd(64, '0').slice(0, 64),
  };
}

/* App.tsx's own code, compiled ---------------------------------------------- */

/** A function of the App component (two-space indent), brace-matched. */
function componentFunction(name: string): string {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(APP);
  if (!match) throw new Error(`App.tsx has no component function ${name}`);
  const open = APP.indexOf(' {\n', match.index) + 1;
  let depth = 0;
  for (let index = open; index < APP.length; index += 1) {
    if (APP[index] === '{') depth += 1;
    if (APP[index] === '}') {
      depth -= 1;
      if (depth === 0) return APP.slice(match.index + 3, index + 1);
    }
  }
  throw new Error('unbalanced function');
}
function appSlice(from: string, to: string): string {
  const start = APP.indexOf(from);
  if (start < 0) throw new Error(`App.tsx no longer has: ${from}`);
  const end = APP.indexOf(to, start + from.length);
  if (end < 0) throw new Error(`App.tsx no longer has: ${to}`);
  return APP.slice(start, end + to.length);
}
function compiled<T>(body: string, deps: Record<string, unknown>): T {
  const js = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} as unknown };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports as T;
}
const APPLY_SOURCE = componentFunction('applyRestoredData');
/**
 * The restore's own lines, from the owner's "Restore" to its last status:
 * place the files, check the records, commit, settle the files, and the
 * failure alert around them.
 */
const RESTORE_BLOCK_SOURCE = appSlice(
  'void withBackupKeepAwake(async () => {',
  "'The device backup could not be safely restored.',\n                );\n              });",
);

/* One run of the app ------------------------------------------------------- */

type Session = {
  runtime: ReturnType<typeof createBackupRestoreRuntime>;
  ledger: ReturnType<typeof createRestoredMediaLedger>;
  alerts: string[];
  /** What each alert said, in order. */
  messages: string[];
  locked: string[];
  shown: { savedUpdates: unknown[] | null };
  restore: () => Promise<void>;
  progress: string[];
};

let opened: Awaited<ReturnType<typeof openSelectedBackup>>;
beforeAll(async () => {
  const archive = await createCompleteBackupArchive({
    state: backupState(),
    assets: Object.entries(ASSETS).map(([id, asset]) => ({ id, kind: asset.kind, relativePath: asset.name, bytes: asset.bytes })),
    passphrase: PASSPHRASE,
    createdAt: NOW,
  }, { randomBytes: deterministicRandom() });
  const scratch = newDevice();
  scratch.files.set('file:///picked/backup.vitruvius-backup', JSON.stringify(archive));
  opened = await openSelectedBackup(['file:///picked/backup.vitruvius-backup'], PASSPHRASE, fileIO(scratch));
});

/** The app, started on a device: a new runtime and ledger over what the device holds. */
function startApp(device: Device): Session {
  const storage = storageOf(device);
  const io = fileIO(device);
  const uid = () => {
    device.nextId += 1;
    return `rid${String(device.nextId).padStart(6, '0')}`;
  };
  const ledger = createRestoredMediaLedger({
    storage, removeFile: io.remove, createId: uid,
    priorityKeys: [targetKeys.updates, targetKeys.activeDraft, targetKeys.referenceDocuments, targetKeys.projectDocuments],
  });
  const runtime = createBackupRestoreRuntime({
    storage, targetKeys, barrierKeys,
    createTransactionId: () => `restore-${uid()}`,
    now: () => NOW,
    recoverProjectDeletion: async () => undefined,
    recoverFieldUpdate: async () => undefined,
    loadQueuedProjectDeletionNames: async () => [],
    settleRestoredMedia: ledger.settlePending,
  });
  const session: Session = { runtime, ledger, alerts: [], messages: [], locked: [], shown: { savedUpdates: null }, restore: async () => undefined, progress: [] };
  const noop = () => undefined;
  const Alert = { alert: (title: string, message = '') => { session.alerts.push(title); session.messages.push(message); } };
  const applyRestoredData = compiled<(data: unknown) => Promise<string>>(`module.exports = ${APPLY_SOURCE}`, {
    backupRestoreInFlightRef: { current: false }, savedUpdatesSaveTimer: { current: null }, draftSaveTimer: { current: null },
    backupRestoreRuntime: runtime, buildDeletionSafeRestoreState, projectRecords: [],
    restoreProjectRecords: (_current: unknown, names: readonly string[]) => names.map(name => ({ name })),
    referenceDocumentMatchesDeletedProject: () => false, authorityProjectId: () => null,
    projectDocumentMatchesProject: () => false, scheduleItemMatchesDeletedProject: () => false,
    captureMemoryRepositoryStorageValue: (memories: unknown) => memories,
    createDraft: (projectName: string) => ({ id: 'empty-draft', projectName, photos: [] }),
    operationalRefreshCommitGuard: { invalidate: noop }, savedUpdatesRef: { current: [] }, draftRef: { current: null },
    setSavedUpdates: (updates: unknown[]) => { session.shown.savedUpdates = updates; },
    setProjectRecords: noop, setProjects: noop, setArchivedProjects: noop, setContactBook: noop, setProjectAreas: noop,
    setReferenceDocuments: noop, setProjectDocuments: noop, setScheduleItems: noop, setCaptureMemories: noop, setDraft: noop,
    markProjectAreasAuthorityReady: noop, markReferenceDocumentsAuthorityReady: noop, markScheduleItemsAuthorityReady: noop,
    setDraftSavedAt: noop, setSelectedWorkspaceProject: noop, Alert, DEVICE_BACKUP_RESTORE_NOTICE: '',
    BackupRestoreRecoveryRequiredError, startupHydration: { fail: (key: string) => { session.locked.push(key); } },
    PROJECTS_STORAGE_KEY: targetKeys.projects,
  });
  if (opened.kind !== 'single') throw new Error('expected a single-file backup');
  session.restore = compiled<() => Promise<void>>(`module.exports = async function restoreBlock() {\n${RESTORE_BLOCK_SOURCE.replace(/^void /, 'return ')}\n}`, {
    withBackupKeepAwake: (work: () => Promise<unknown>) => work(),
    materializeCompleteBackupState, opened, decryptedBytesAssetProvider, stagedAssetProvider,
    expoBackupFileIO: io, uid, sanitizeFilename: (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '-'),
    ensurePhotoStorageDirectory: async () => PHOTO_DIR, ensureReferenceDocumentsDirectory: async () => REFERENCE_DIR,
    OWNED_PROJECT_DOCUMENTS_DIR: OWNED_DIR, FileSystem: { cacheDirectory: CACHE_DIR },
    importProjectDocumentIntoOwnedStorage: (input: Parameters<typeof importProjectDocumentIntoOwnedStorage>[0]) =>
      importProjectDocumentIntoOwnedStorage({ ...input, dependencies: ownedStoreDependencies(device) }),
    restoredMediaLedger: ledger,
    // The app's normalizeBackupData, reduced to the shape applyRestoredData commits.
    normalizeBackupData: (state: Record<string, unknown>) => ({
      ok: true,
      data: {
        savedUpdates: state.savedUpdates, projects: state.projects, projectRecords: null, archivedProjects: state.archivedProjects,
        contactBook: state.contacts, projectAreas: state.projectAreas, referenceDocuments: state.referenceDocuments,
        projectDocuments: state.projectDocuments, scheduleItems: state.scheduleItems, captureMemories: state.captureMemories,
        storedDraft: state.activeDraft,
      },
    }),
    applyRestoredData, onProgress: (message: string) => { session.progress.push(message); }, Alert,
  });
  return session;
}

/** A restart: storage works again, and the app's startup recovery runs before anything is read. */
async function restart(device: Device): Promise<Session> {
  device.fault = null;
  const session = startApp(device);
  await session.runtime.recoverBeforeStartupReads();
  return session;
}

/* What must hold ------------------------------------------------------------ */

type StoredPhoto = { id: string; uri: string };
function storedAttachments(device: Device): Array<{ id: string; uri: string }> {
  const read = (key: string) => JSON.parse(device.values.get(key) ?? 'null');
  const photos = (update: { photos?: StoredPhoto[] } | null | undefined) => (update?.photos ?? []).map(photo => ({ id: photo.id, uri: photo.uri }));
  return [
    ...((read(targetKeys.updates) ?? []) as Array<{ photos?: StoredPhoto[] }>).flatMap(photos),
    ...photos(read(targetKeys.activeDraft)?.draft),
    ...((read(targetKeys.referenceDocuments) ?? []) as Array<{ id: string; uri: string }>).map(document => ({ id: document.id, uri: document.uri })),
    ...((read(targetKeys.projectDocuments) ?? []) as Array<{ id: string; localUri: string }>).map(document => ({ id: document.id, uri: document.localUri })),
  ];
}

const restoredFilesOn = (device: Device) => [...device.files.keys()].filter(uri => uri !== OLD_PHOTO && RESTORED_DIRS.some(dir => uri.startsWith(dir)));
const isRestored = (device: Device) => JSON.parse(device.values.get(targetKeys.updates) ?? '[]')[0]?.id === 'u1';

/** Every attachment the saved records name opens its own bytes; nothing else is left in the restore folders. */
function expectSettledDevice(device: Device, label: string) {
  const attachments = storedAttachments(device);
  if (isRestored(device)) {
    expect(attachments.map(attachment => attachment.id).sort()).toEqual(['o1', 'o2', 'p1', 'p2', 'p9', 'r1']);
    attachments.forEach(attachment => {
      const bytes = device.files.get(attachment.uri);
      expect({ label, id: attachment.id, found: bytes instanceof Uint8Array ? Array.from(bytes) : null })
        .toEqual({ label, id: attachment.id, found: Array.from(EXPECTED_BYTES[attachment.id]) });
    });
    expect({ label, files: restoredFilesOn(device).sort() }).toEqual({ label, files: attachments.map(attachment => attachment.uri).sort() });
  } else {
    // The restore did not happen: the device's own records and file are as they were, and the restore's files are gone.
    expect({ label, ids: attachments.map(attachment => attachment.id) }).toEqual({ label, ids: ['old-p'] });
    expect({ label, files: restoredFilesOn(device) }).toEqual({ label, files: [] });
  }
  expect({ label, old: device.files.has(OLD_PHOTO) || isRestored(device) }).toEqual({ label, old: true });
  expect({ label, journal: device.values.has(BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY) }).toEqual({ label, journal: false });
  expect({ label, ledger: device.values.get(RESTORED_MEDIA_LEDGER_KEY) ?? null }).toEqual({ label, ledger: null });
  // Nothing of the restore is left in the temporary folder either.
  expect({ label, cache: [...device.files.keys()].filter(uri => uri.startsWith(CACHE_DIR)) }).toEqual({ label, cache: [] });
}

/** Right after the attempt, before any restart: what the owner was told matches what is on the device. */
function expectAttemptConsistent(device: Device, session: Session, label: string) {
  const status = session.progress[session.progress.length - 1];
  if (status === 'Restore finished.') {
    expect({ label, alerts: session.alerts }).toEqual({ label, alerts: ['Device backup restored'] });
    storedAttachments(device).forEach(attachment => expect({ label, file: device.files.has(attachment.uri) }).toEqual({ label, file: true }));
    return 'committed';
  }
  if (session.locked.length > 0) {
    expect({ label, alerts: session.alerts }).toEqual({ label, alerts: ['Restore recovery required'] });
    // The restore may still finish: every file it placed is still there.
    expect({ label, files: restoredFilesOn(device).length }).toEqual({ label, files: 6 });
    return 'recovery_required';
  }
  expect({ label, alerts: session.alerts }).toEqual({ label, alerts: ['Restore failed'] });
  return 'aborted';
}

/** Storage writes and removals one clean restore makes, from recording its files to forgetting them. */
async function cleanRestoreMutationCount(): Promise<number> {
  const device = newDevice();
  const session = startApp(device);
  device.mutations = 0;
  await session.restore();
  expect(session.progress).toEqual(['Restore finished.']);
  return device.mutations;
}

/* The tests ------------------------------------------------------------------ */

describe('independent review R01: restored files are kept while a restore can still finish', () => {
  it('restores photos, a draft photo, a reference document and owned documents, each to its own bytes', async () => {
    const device = newDevice();
    const session = startApp(device);
    await session.restore();
    expect(expectAttemptConsistent(device, session, 'clean')).toBe('committed');
    expect(isRestored(device)).toBe(true);
    expectSettledDevice(device, 'clean');
    // The same after a restart.
    await restart(device);
    expectSettledDevice(device, 'clean, restarted');
  });

  it('the reviewed case: a record write fails, the immediate recovery fails, and the restart finishes the restore with its files', async () => {
    const device = newDevice();
    const session = startApp(device);
    // The first journal write and the first two record writes land; the next record write and every later write fail.
    device.mutations = 0;
    device.fault = { at: 7, mode: 'writes_fail_until_restart', tripped: false };
    await session.restore();
    expect(session.alerts).toEqual(['Restore recovery required']);
    expect(session.progress).toEqual(['Restore did not finish.']);
    expect(device.values.has(BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY)).toBe(true);
    expect(restoredFilesOn(device)).toHaveLength(6);

    await restart(device);
    expect(isRestored(device)).toBe(true);
    expectSettledDevice(device, 'reviewed case');
  });

  const MODES: FaultMode[] = ['once', 'lands_then_throws', 'writes_fail_until_restart', 'dead_until_restart'];
  it.each(MODES)('a storage failure at every write of the restore (%s): after a restart every saved attachment opens its bytes', async mode => {
    const writes = await cleanRestoreMutationCount();
    // Recording the files, the journal's steps, ten records with a journal step each, the journal's removal, forgetting the files.
    expect(writes).toBeGreaterThanOrEqual(25);
    const outcomes = new Set<string>();
    for (let at = 0; at < writes; at += 1) {
      const label = `${mode} at write ${at}`;
      const device = newDevice();
      const session = startApp(device);
      device.mutations = 0;
      device.fault = { at, mode, tripped: false };
      await session.restore();
      outcomes.add(expectAttemptConsistent(device, session, label));
      await restart(device);
      expectSettledDevice(device, label);
    }
    // The matrix reaches a restore that still finished or was held for recovery, not only refused ones.
    expect([...outcomes].some(outcome => outcome !== 'aborted')).toBe(true);
    if (mode !== 'once' && mode !== 'lands_then_throws') expect(outcomes.has('recovery_required')).toBe(true);
  });

  it.each(['writes_fail_until_restart', 'dead_until_restart'] as FaultMode[])(
    'recovery that fails again at the first restart (%s) still keeps the files for the restart that works', async mode => {
      const writes = await cleanRestoreMutationCount();
      for (let at = 0; at < writes; at += 1) {
        const label = `${mode} at write ${at}, two restarts`;
        const device = newDevice();
        const session = startApp(device);
        device.mutations = 0;
        device.fault = { at, mode, tripped: false };
        await session.restore();
        const outcome = expectAttemptConsistent(device, session, label);
        const placed = restoredFilesOn(device).length;

        // First restart: storage is still failing, from its first write.
        const stillBroken = startApp(device);
        device.mutations = 0;
        device.fault = { at: 0, mode, tripped: mode === 'dead_until_restart' };
        await stillBroken.runtime.recoverBeforeStartupReads().catch(() => undefined);
        if (outcome === 'recovery_required') expect({ label, files: restoredFilesOn(device).length }).toEqual({ label, files: placed });

        await restart(device);
        expectSettledDevice(device, label);
      }
    },
  );

  it('Retry Recovery in the same run of the app finishes the restore with its files', async () => {
    const writes = await cleanRestoreMutationCount();
    for (let at = 0; at < writes; at += 1) {
      const label = `retry in session at write ${at}`;
      const device = newDevice();
      const session = startApp(device);
      device.mutations = 0;
      device.fault = { at, mode: 'writes_fail_until_restart', tripped: false };
      await session.restore();
      expectAttemptConsistent(device, session, label);
      // Storage works again; Retry Recovery re-runs the startup recovery on the same runtime and ledger.
      device.fault = null;
      await session.runtime.recoverBeforeStartupReads();
      expectSettledDevice(device, label);
    }
  });

  it('a restore that is rolled back after it was held for recovery does not leave its files behind for good', async () => {
    const device = newDevice();
    const before = new Map(device.values);
    const session = startApp(device);
    device.mutations = 0;
    device.fault = { at: 7, mode: 'writes_fail_until_restart', tripped: false };
    await session.restore();
    expect(session.alerts).toEqual(['Restore recovery required']);
    expect(restoredFilesOn(device)).toHaveLength(6);
    // The journal is rolled back: the records are as they were and no journal is left. The file list is still there.
    const ledger = device.values.get(RESTORED_MEDIA_LEDGER_KEY) as string;
    device.values.clear();
    before.forEach((value, key) => device.values.set(key, value));
    device.values.set(RESTORED_MEDIA_LEDGER_KEY, ledger);

    await restart(device);
    expect(isRestored(device)).toBe(false);
    expectSettledDevice(device, 'rolled back');
  });

  it('a restore the app was closed in the middle of is settled at the next start, either way', async () => {
    // Closed after the files were recorded and before any record was written: the files go.
    const neverBegan = newDevice();
    const first = startApp(neverBegan);
    if (opened.kind !== 'single') throw new Error('expected a single-file backup');
    await materializeCompleteBackupState(opened.state, decryptedBytesAssetProvider(opened.decrypted, fileIO(neverBegan)), {
      io: fileIO(neverBegan), newId: () => `closed${(neverBegan.nextId += 1)}xx`, sanitizeFilename: name => name.replace(/[^a-zA-Z0-9._-]/g, '-'),
      photoDirectory: async () => PHOTO_DIR, referenceDocumentsDirectory: async () => REFERENCE_DIR,
      ownedProjectDocumentsRoot: OWNED_DIR, cacheDirectory: CACHE_DIR,
      importProjectDocument: input => importProjectDocumentIntoOwnedStorage({ ...input, dependencies: ownedStoreDependencies(neverBegan) }),
      mediaLedger: first.ledger,
    });
    expect(restoredFilesOn(neverBegan)).toHaveLength(6);
    await restart(neverBegan);
    expectSettledDevice(neverBegan, 'closed before the commit');

    // Closed with the journal half applied: the restart finishes it, and the files stay.
    const halfWritten = newDevice();
    const second = startApp(halfWritten);
    halfWritten.mutations = 0;
    halfWritten.fault = { at: 9, mode: 'dead_until_restart', tripped: false };
    await second.restore();
    await restart(halfWritten);
    expect(isRestored(halfWritten)).toBe(true);
    expectSettledDevice(halfWritten, 'closed half written');
  });

  it('the files of a restore in progress are never settled by its own startup recovery', async () => {
    // commit() begins with the startup recovery, which settles what is written down; the restore under way is not it.
    const device = newDevice();
    // An earlier restore's leftover list, naming a file nothing references: that one is settled, this restore's are not.
    const stray = `${PHOTO_DIR}stray000-left-behind.jpg`;
    device.files.set(stray, bytesOf(5));
    device.values.set(RESTORED_MEDIA_LEDGER_KEY, JSON.stringify([{ id: 'earlier-restore', uris: [stray] }]));
    const session = startApp(device);
    await session.restore();
    expect(session.progress).toEqual(['Restore finished.']);
    expect(device.files.has(stray)).toBe(false);
    expectSettledDevice(device, 'in progress');
  });

  it('a second restore while one is held for recovery removes only its own files', async () => {
    const device = newDevice();
    const session = startApp(device);
    device.mutations = 0;
    device.fault = { at: 7, mode: 'writes_fail_until_restart', tripped: false };
    await session.restore();
    const held = restoredFilesOn(device).sort();
    expect(held).toHaveLength(6);
    // Storage still fails: the second attempt cannot even record its files, and is refused with nothing changed.
    await session.restore();
    expect(session.alerts).toEqual(['Restore recovery required', 'Restore failed']);
    expect(session.messages[1]).toMatch(/could not record the files it placed on this device, so nothing was changed/);
    expect(restoredFilesOn(device).sort()).toEqual(held);
    await restart(device);
    expect(isRestored(device)).toBe(true);
    expectSettledDevice(device, 'second restore refused');
  });

  it('a restore whose records were written but could not be confirmed is held for recovery, not called failed', async () => {
    // Every record and the journal's removal land; the read that confirms the restore then fails.
    const device = newDevice();
    const session = startApp(device);
    const storage = storageOf(device);
    let journalRemoved = false;
    const runtime = createBackupRestoreRuntime({
      storage: {
        ...storage,
        removeItem: async (key: string) => {
          await storage.removeItem(key);
          if (key === BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY) journalRemoved = true;
        },
        getItem: async (key: string) => {
          if (journalRemoved && key === targetKeys.updates) throw new Error('device storage read failed');
          return storage.getItem(key);
        },
      },
      targetKeys, barrierKeys, createTransactionId: () => 'restore-unconfirmed', now: () => NOW,
      recoverProjectDeletion: async () => undefined, recoverFieldUpdate: async () => undefined,
      loadQueuedProjectDeletionNames: async () => [], settleRestoredMedia: session.ledger.settlePending,
    });
    await expect(runtime.commit(() => ({
      values: {
        updates: [{ id: 'u1' }], projects: [], archivedProjects: [], contacts: { contacts: [] }, projectAreas: [],
        referenceDocuments: [], projectDocuments: [], scheduleItems: [], captureMemories: [], activeDraft: null,
      },
      result: undefined,
    }))).rejects.toBeInstanceOf(BackupRestoreRecoveryRequiredError);
    expect(JSON.parse(device.values.get(targetKeys.updates) as string)).toEqual([{ id: 'u1' }]);
  });

  it('App.tsx settles the restored files by how the restore ended, and no longer removes them on any failure', () => {
    expect(RESTORE_BLOCK_SOURCE.startsWith('void withBackupKeepAwake(')).toBe(true);
    expect(RESTORE_BLOCK_SOURCE).toContain('mediaLedger: restoredMediaLedger');
    expect(RESTORE_BLOCK_SOURCE).toContain('const outcome = await applyRestoredData(normalized.data);\n                  await materialized.settle(outcome);');
    expect(APP).not.toContain('if (!committed) await materialized.cleanup();');
    expect(APPLY_SOURCE).toContain("return recoveryBlocked ? 'recovery_required' : 'aborted';");
    expect(APP).toContain('settleRestoredMedia: restoredMediaLedger.settlePending');
  });
});

describe('independent review R01: the restored-file ledger', () => {
  const memory = () => {
    const values = new Map<string, string>();
    const files = new Set<string>();
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); },
      removeItem: async (key: string) => { values.delete(key); },
      getAllKeys: async () => [...values.keys()],
    };
    let next = 0;
    const ledger = (overrides: Partial<typeof storage> = {}, removeFile = async (uri: string) => { files.delete(uri); }) =>
      createRestoredMediaLedger({ storage: { ...storage, ...overrides }, removeFile, createId: () => `attempt-${(next += 1)}` });
    return { values, files, storage, ledger };
  };
  const A = 'file:///photos/aaaa1111-IMG_1.jpg';
  const B = 'file:///photos/bbbb2222-IMG_2.jpg';

  it('aborted removes the files; committed and recovery-required keep them', async () => {
    for (const [outcome, kept, listed] of [['aborted', false, false], ['committed', true, false], ['recovery_required', true, true]] as const) {
      const device = memory();
      device.files.add(A).add(B);
      const claim = await device.ledger().track([A, B]);
      expect(JSON.parse(device.values.get(RESTORED_MEDIA_LEDGER_KEY) as string)[0].uris).toEqual([A, B]);
      await claim.settle(outcome);
      expect({ outcome, files: [...device.files] }).toEqual({ outcome, files: kept ? [A, B] : [] });
      expect({ outcome, listed: device.values.has(RESTORED_MEDIA_LEDGER_KEY) }).toEqual({ outcome, listed });
    }
  });

  it('a restore that placed no file writes nothing down', async () => {
    const device = memory();
    const claim = await device.ledger().track([]);
    await claim.settle('recovery_required');
    expect(device.values.size).toBe(0);
  });

  it('refuses the restore when the files cannot be written down', async () => {
    const device = memory();
    await expect(device.ledger({ setItem: async () => { throw new Error('disk full'); } }).track([A]))
      .rejects.toThrow(/could not record the files/);
  });

  it('settles a held list by what the saved values name, wherever they name it', async () => {
    const device = memory();
    device.files.add(A).add(B);
    const first = device.ledger();
    await (await first.track([A, B])).settle('recovery_required');
    // A is named by a value the restore never wrote (a kept draft, say), under the app's folder after it moved.
    device.values.set('kept-drafts', JSON.stringify([{ photos: [{ uri: 'file:///moved/container/photos/aaaa1111-IMG_1.jpg' }] }]));
    await device.ledger().settlePending();
    expect([...device.files]).toEqual([A]);
    expect(device.values.has(RESTORED_MEDIA_LEDGER_KEY)).toBe(false);
  });

  it('keeps files named only inside a restore journal that is still waiting', async () => {
    const device = memory();
    device.files.add(A);
    await (await device.ledger().track([A])).settle('recovery_required');
    device.values.set(BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY, JSON.stringify({ operations: [{ kind: 'set', key: 'updates', value: JSON.stringify([{ photos: [{ uri: A }] }]) }] }));
    await device.ledger().settlePending();
    expect([...device.files]).toEqual([A]);
  });

  it('keeps everything, and the list, when the saved values cannot be read', async () => {
    const device = memory();
    device.files.add(A);
    await (await device.ledger().track([A])).settle('recovery_required');
    await device.ledger({ getAllKeys: async () => { throw new Error('storage unavailable'); } }).settlePending();
    expect([...device.files]).toEqual([A]);
    expect(device.values.has(RESTORED_MEDIA_LEDGER_KEY)).toBe(true);
  });

  it('keeps a file that could not be removed on the list, and removes it at the next settle', async () => {
    const device = memory();
    device.files.add(A);
    let failing = true;
    const removeFile = async (uri: string) => { if (failing) throw new Error('file busy'); device.files.delete(uri); };
    await (await device.ledger({}, removeFile).track([A])).settle('aborted');
    expect(JSON.parse(device.values.get(RESTORED_MEDIA_LEDGER_KEY) as string)[0].uris).toEqual([A]);
    failing = false;
    await device.ledger({}, removeFile).settlePending();
    expect(device.files.size).toBe(0);
    expect(device.values.has(RESTORED_MEDIA_LEDGER_KEY)).toBe(false);
  });

  it('a committed restore whose list could not be cleared keeps its files at the next settle', async () => {
    const device = memory();
    device.files.add(A);
    const claim = await device.ledger({ removeItem: async () => { throw new Error('storage write failed'); } }).track([A]);
    device.values.set('updates', JSON.stringify([{ photos: [{ uri: A }] }]));
    await claim.settle('committed');
    expect(device.values.has(RESTORED_MEDIA_LEDGER_KEY)).toBe(true);
    await device.ledger().settlePending();
    expect([...device.files]).toEqual([A]);
    expect(device.values.has(RESTORED_MEDIA_LEDGER_KEY)).toBe(false);
  });

  it('never removes a file whose name could not be told apart in the saved values', async () => {
    const device = memory();
    const short = 'file:///photos/a.jpg';
    const quoted = 'file:///photos/odd"name-12345.jpg';
    device.files.add(short).add(quoted);
    await (await device.ledger().track([short, quoted])).settle('recovery_required');
    await device.ledger().settlePending();
    expect([...device.files].sort()).toEqual([short, quoted].sort());
  });

  it('finds names exactly as a plain search would, in one pass', () => {
    let seed = 7;
    const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed; };
    const alphabet = 'abcdef0123456789-_.';
    const word = (length: number) => Array.from({ length }, () => alphabet[random() % alphabet.length]).join('');
    for (let round = 0; round < 40; round += 1) {
      const names = Array.from({ length: 1 + (random() % 30) }, () => word(8 + (random() % 20)));
      const present = names.filter(() => random() % 2 === 0);
      const text = [word(random() % 50), ...present.flatMap(name => [name, word(random() % 40)])].join(random() % 2 ? '/' : '');
      const found = new Set<string>();
      createNameSearch(names)(text, found);
      expect([...found].sort()).toEqual([...new Set(names.filter(name => text.includes(name)))].sort());
    }
    expect(fileNameOf('file:///a/b/rid000001-IMG-0001.jpg')).toBe('rid000001-IMG-0001.jpg');
    expect(fileNameOf('file:///a/b/dir/')).toBe('dir');
  });
});
