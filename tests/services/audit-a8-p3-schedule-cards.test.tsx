/**
 * Whole-app audit A8 pass 3 (30 Sep 2026), the phone's schedule cards:
 *
 * M1 "Import This Schedule" was refused for every schedule card that had
 *    uploaded: the duplicate check counted the card's own shared copy (same
 *    file, same project, category Schedules, but no import batch and no
 *    tasks) as the import, and said "Schedule already added". The same file
 *    was refused from the Schedule screen too. Only an import counts now.
 * L1 The card's "Current Schedule" badge was a phone-only flag set by its
 *    Make Current, so it stayed (and the button stayed disabled) after Set
 *    Active, an import, the iPad or the web made another schedule current.
 *    The card now reads the schedule this phone shows for its project.
 *
 * prepareScheduleImportFromAsset and reviewProjectScheduleDocumentImport run
 * compiled from App.tsx, with the real services; the card's shared copy is
 * built by the real upload path (buildSharedReferenceDocument).
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import { render } from '@testing-library/react-native';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

import { ProjectDocumentCard, type ProjectDocumentCardDocument } from '../../components/project-document-card';
import {
  phoneScheduleCardIsCurrent,
  scheduleImportAlreadyAdded,
  scheduleImportOfFile,
} from '../../services/SharedDocumentActivation';
import { buildSharedReferenceDocument } from '../../services/ProjectDocumentLifecycle';
import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import {
  bindStableScheduleImportItemIds,
  resolveScheduleImportSourceIdentity,
} from '../../services/ScheduleImportSourceIdentity';
import { deletedDAVERecordIds } from '../../services/DAVESyncTombstones';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { dedupeScheduleImportItems } from '../../services/PIEScheduleImportBatch';
import {
  createOwnedLocalFileManifest,
  createOwnedLocalFileManifestRecord,
} from '../../services/OwnedLocalFileRepository';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** A function of the App component (two-space indent), brace-matched after its parameters. */
function componentFunction(name: string): string {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no component function ${name}`);
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
      if (depth === 0) return app.slice(match.index + 3, index + 1);
    }
  }
  throw new Error('unbalanced function');
}

function compile<T>(names: string[], deps: Record<string, unknown>): T {
  const js = ts.transpileModule(
    [...names.map(componentFunction), `module.exports = { ${names.join(', ')} };`].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } },
  ).outputText;
  const mod = { exports: {} as T };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports;
}

const CSV = 'Task,Start,Finish\nPour level 2 slab,07/01/2026,07/10/2026\n';
const BYTES = utf8ToBytes(CSV);
const SHA = Array.from(sha256(BYTES)).map(byte => byte.toString(16).padStart(2, '0')).join('');
const FILE_ID = 'card0000-e29b-41d4-a716-446655440000';
const manifest = createOwnedLocalFileManifest([createOwnedLocalFileManifestRecord({
  fileId: FILE_ID, kind: 'project_document', generatedBasename: `${FILE_ID}.csv`, relativePath: `${FILE_ID}.csv`,
  sha256: SHA, sizeBytes: BYTES.length, mimeType: 'text/csv',
})]);

const card = (extra: Record<string, unknown> = {}) => ({
  id: 'phone-schedule', projectId: 'alpha-key', name: 'Schedule.csv', category: 'Schedule' as const, mimeType: 'text/csv',
  sizeBytes: BYTES.length, note: '', status: 'uploaded' as const, storagePath: 'project-documents/alpha-key/phone-schedule/Schedule.csv',
  referenceDocumentId: null as string | null, importedAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z',
  isCurrent: false, ownedFileId: FILE_ID, ownedFileManifest: manifest, ...extra,
});
/** The card's shared copy, as the phone's upload publishes it. */
const uploadCopy = normalizeReferenceDocument(buildSharedReferenceDocument({
  document: card() as unknown as Parameters<typeof buildSharedReferenceDocument>[0]['document'],
  projectName: 'Alpha', contentSha256: SHA, updatedAt: '2026-09-20T00:00:05.000Z',
}));

function phone(documents: ReferenceDocument[], items: ScheduleItem[] = []) {
  const alerts: Array<{ title: string; message: string }> = [];
  const refs = {
    projectScheduleImportCardRef: { current: null as null | { batchId: string; documentId: string } },
    referenceDocumentsCurrentRef: { current: documents },
    scheduleItemsCurrentRef: { current: items },
  };
  const deps: Record<string, unknown> = {
    ...refs,
    activeProjects: ['Alpha'], projects: ['Alpha'],
    archivedProjectsCurrentRef: { current: [] }, deletedProjectNamesRef: { current: [] },
    projectsCurrentRef: { current: ['Alpha', 'Beta'] }, projectRecordsCurrentRef: { current: [] },
    authorityProjectId: (name: string) => `${name.toLowerCase()}-key`,
    projectAreasForProject: () => [], projectAreasCurrentRef: { current: [] }, savedUpdatesRef: { current: [] },
    prepareExpoFileUploadPayload: async () => ({ data: BYTES, sizeBytes: BYTES.length }),
    resolveScheduleImportSourceIdentity, deletedDAVERecordIds, operationalSyncTombstonesRef: { current: [] },
    scheduleImportAlreadyAdded,
    // Whole-app audit A8 pass 5 L3 (landed after this test): the identity and the saved import of the file, in one.
    scheduleImportOfFile,
    ensureReferenceDocumentsDirectory: async () => 'file:///reference-documents/',
    sanitizeFilename: (name: string) => name,
    FileSystem: { deleteAsync: async () => undefined, copyAsync: async () => undefined, readAsStringAsync: async () => CSV },
    normalizeReferenceDocument, normalizeScheduleImport, dedupeScheduleImportItems, bindStableScheduleImportItemIds,
    validateScheduleImportScope: ({ items }: { items: unknown[] }) => ({ items, warnings: [] }),
    deleteStoredReferenceDocument: async () => undefined,
    ensureVerifiedProjectDocumentBytes: async (verified: object) => ({ ...verified, localUri: 'file:///verified/Schedule.csv' }),
    setIncomingScheduleImportBatch: jest.fn(), setScheduleProjectFilter: jest.fn(), setScreen: jest.fn(),
    Alert: { alert: (title: string, message: string) => { alerts.push({ title, message }); } },
  };
  const fns = compile<{
    prepareScheduleImportFromAsset: (file: { uri: string; name?: string; mimeType?: string; size?: number }, projects?: string[]) =>
      Promise<{ id: string; documents: ReferenceDocument[]; items: ScheduleItem[] } | null>;
    reviewProjectScheduleDocumentImport: (document: ReturnType<typeof card>, projectName: string | null) => Promise<void>;
  }>(['prepareScheduleImportFromAsset', 'reviewProjectScheduleDocumentImport'], deps);
  return { ...fns, alerts, refs, deps };
}

const file = { uri: 'file:///picked/Schedule.csv', name: 'Schedule.csv', mimeType: 'text/csv', size: BYTES.length };

describe('"Import This Schedule" on a card that has uploaded (audit A8 pass 3 M1)', () => {
  it('the owner\'s path: the card\'s own shared copy does not refuse it; the review opens', async () => {
    expect(uploadCopy).toMatchObject({ id: 'phone-schedule', category: 'Schedules', contentSha256: SHA, projectNames: ['Alpha'], importBatchId: null });
    const h = phone([uploadCopy]);
    await h.reviewProjectScheduleDocumentImport(card({ referenceDocumentId: 'phone-schedule' }), 'Alpha');
    expect(h.alerts).toEqual([]);
    const batch = (h.deps.setIncomingScheduleImportBatch as jest.Mock).mock.calls[0]?.[0];
    expect(batch?.documents[0]).toMatchObject({ category: 'Schedules', contentSha256: SHA, isCurrent: true, projectNames: ['Alpha'] });
    expect(batch?.documents[0].importBatchId).toBe(batch?.id);
    expect(batch?.items.length).toBeGreaterThan(0);
    expect(h.refs.projectScheduleImportCardRef.current).toEqual({ batchId: batch?.id, documentId: 'phone-schedule' });
    expect(h.deps.setScreen).toHaveBeenCalledWith('Schedule');
  });

  it('the same file picked on the Schedule screen is imported too', async () => {
    const h = phone([uploadCopy]);
    await expect(h.prepareScheduleImportFromAsset(file, ['Alpha'])).resolves.toMatchObject({ kind: 'schedule_file' });
    expect(h.alerts).toEqual([]);
  });

  it('the record Make Current makes of a card, with its project list, does not refuse it either', async () => {
    const madeCurrent = normalizeReferenceDocument({ ...uploadCopy, id: 'made-current', isCurrent: true });
    const h = phone([madeCurrent]);
    await expect(h.prepareScheduleImportFromAsset(file, ['Alpha'])).resolves.not.toBeNull();
  });

  it('an actual import of the file for the same projects is still recognised: refused as a lookahead, offered as one when it is a full schedule no longer shown', async () => {
    const first = phone([uploadCopy]);
    const batch = await first.prepareScheduleImportFromAsset(file, ['Alpha']);
    const imported = batch!.documents[0];

    // Pin updated (whole-app audit A8 pass 5 L3, 30 Sep 2026): the same file saved as a full schedule is
    // imported again only as a lookahead (owner answer Q22), under an import of its own, not refused.
    // Pin updated again (A8 pass 5 M1, 30 Sep 2026): only once another master is the schedule shown. The
    // just-imported file is the master in use: picked again it is refused, saying to make the master current first.
    const inUse = phone([uploadCopy, imported]);
    await expect(inUse.prepareScheduleImportFromAsset(file, ['Alpha'])).resolves.toBeNull();
    expect(inUse.alerts).toEqual([{
      title: 'Schedule already added',
      message: 'This exact schedule is already saved for the selected projects. Open the existing schedule source instead of importing a duplicate. If this file is a lookahead, make your master schedule current first, then import it again.',
    }]);
    const master = scheduleDoc('Master', { importBatchId: 'batch-m', isCurrent: true, importedAt: '2026-09-25T00:00:00.000Z' });
    const again = phone([uploadCopy, { ...imported, isCurrent: false }, master]);
    const reimport = await again.prepareScheduleImportFromAsset(file, ['Alpha']);
    expect(again.alerts).toEqual([]);
    expect(reimport?.documents[0]).toMatchObject({ scheduleRole: 'lookahead', contentSha256: SHA, projectNames: ['Alpha'] });
    expect(reimport?.documents[0].id).not.toBe(imported.id);
    expect(reimport?.id).not.toBe(batch?.id);
    expect(reimport?.items.every(item => item.importBatchId === reimport.id && item.sourceDocumentId === reimport.documents[0].id)).toBe(true);
    expect(reimport?.items.some(item => batch?.items.some(firstItem => firstItem.id === item.id))).toBe(false);
    // Once it is saved as a lookahead too, a third import of it is refused, as before.
    const third = phone([uploadCopy, imported, reimport!.documents[0]]);
    await expect(third.prepareScheduleImportFromAsset(file, ['Alpha'])).resolves.toBeNull();
    expect(third.alerts).toEqual([{
      title: 'Schedule already added',
      message: 'This exact schedule is already saved for the selected projects. Open the existing schedule source instead of importing a duplicate.',
    }]);

    // An older import without a batch, recognised by its tasks: a full schedule, so offered as a lookahead too.
    const legacy = normalizeReferenceDocument({ ...uploadCopy, id: 'legacy-import' });
    const task = { id: 't1', projectName: 'Alpha', taskName: 'Pour', sourceDocumentId: 'legacy-import' } as ScheduleItem;
    const legacyPhone = phone([legacy], [task]);
    await expect(legacyPhone.prepareScheduleImportFromAsset(file, ['Alpha'])).resolves.toMatchObject({ documents: [{ scheduleRole: 'lookahead' }] });
    expect(legacyPhone.alerts).toEqual([]);

    // Another project's import of the same file is not this one: a plain import, no role preset.
    const beta = phone([{ ...imported, id: 'beta-import', projectNames: ['Beta'], projectName: 'Beta' }]);
    const betaBatch = await beta.prepareScheduleImportFromAsset(file, ['Alpha']);
    expect(betaBatch?.documents[0]).not.toHaveProperty('scheduleRole');
    expect(betaBatch?.documents[0].id).toBe(imported.id);
  });

  it('the rule', () => {
    const base = { documentId: 'schedule-document-x', contentSha256: SHA, projectNames: [' alpha '] };
    expect(scheduleImportAlreadyAdded({ ...base, documents: [uploadCopy], scheduleItems: [] })).toBe(false);
    expect(scheduleImportAlreadyAdded({ ...base, documents: [{ ...uploadCopy, importBatchId: 'b' }], scheduleItems: [] })).toBe(true);
    expect(scheduleImportAlreadyAdded({ ...base, documents: [{ ...uploadCopy, id: 'schedule-document-x' }], scheduleItems: [] })).toBe(true);
    expect(scheduleImportAlreadyAdded({ ...base, documents: [{ ...uploadCopy, importBatchId: 'b', category: 'Drawing' }], scheduleItems: [] })).toBe(false);
  });
});

const scheduleDoc = (id: string, extra: Partial<ReferenceDocument>): ReferenceDocument => normalizeReferenceDocument({
  id, name: id, originalFileName: `${id}.pdf`, uri: '', category: 'Schedules', notes: '', isCurrent: false,
  importedAt: '2026-09-01T00:00:00.000Z', projectName: 'Alpha', projectNames: ['Alpha'], ...extra,
});

describe('the schedule card\'s Current badge follows the schedule shown for its project (audit A8 pass 3 L1)', () => {
  const shared = { ...uploadCopy, isCurrent: true };
  const master = scheduleDoc('Master', { importBatchId: 'batch-m', importedAt: '2026-09-25T00:00:00.000Z' });
  const flagged = card({ referenceDocumentId: 'phone-schedule', isCurrent: true });

  it('reads Current while its shared copy is the project\'s current schedule, and not once another is', () => {
    expect(phoneScheduleCardIsCurrent(flagged, 'Alpha', [shared, master])).toBe(true);
    // Set Active (or the iPad, or the web) made Master current: the cloud retired the card's copy.
    const after = [{ ...shared, isCurrent: false }, { ...master, isCurrent: true }];
    expect(phoneScheduleCardIsCurrent(flagged, 'Alpha', after)).toBe(false);
    // A card never marked is Current once the cloud makes its copy current.
    expect(phoneScheduleCardIsCurrent(card({ referenceDocumentId: 'phone-schedule' }), 'Alpha', [shared])).toBe(true);
  });

  it('reads Current when its file\'s import is the current schedule (Import This Schedule), not its task-less copy', () => {
    const imported = scheduleDoc('imported', { contentSha256: SHA, importBatchId: 'batch-1', isCurrent: true, importedAt: '2026-09-26T00:00:00.000Z' });
    expect(phoneScheduleCardIsCurrent(flagged, 'Alpha', [uploadCopy, master, imported])).toBe(true);
    expect(phoneScheduleCardIsCurrent(flagged, 'Alpha', [uploadCopy, { ...master, isCurrent: true }, { ...imported, isCurrent: false }])).toBe(false);
  });

  it('a combined schedule retired for this project (Q15) is not Current here, and still is for its other project', () => {
    const combined = { ...shared, projectNames: ['Alpha', 'Beta'], isCurrent: true, retiredForProjectNames: ['Alpha'] };
    const alphaOnly = scheduleDoc('alpha-only', { importBatchId: 'batch-a', isCurrent: true, importedAt: '2026-09-27T00:00:00.000Z' });
    expect(phoneScheduleCardIsCurrent(flagged, 'Alpha', [combined, alphaOnly])).toBe(false);
    expect(phoneScheduleCardIsCurrent(flagged, 'Beta', [combined, alphaOnly])).toBe(true);
  });

  it('keeps the card\'s own flag when this phone has neither a shared copy nor an import of it', () => {
    expect(phoneScheduleCardIsCurrent(card({ isCurrent: true, ownedFileManifest: null }), 'Alpha', [master])).toBe(true);
    expect(phoneScheduleCardIsCurrent(card({ isCurrent: false, ownedFileManifest: null }), 'Alpha', [])).toBe(false);
    expect(phoneScheduleCardIsCurrent(flagged, null, [{ ...shared, isCurrent: false }])).toBe(true);
  });

  it('the card shows it: the badge goes and Make Current Schedule can be pressed again', () => {
    const onSetCurrentSchedule = jest.fn();
    const document: ProjectDocumentCardDocument = {
      id: 'phone-schedule', name: 'Schedule.csv', category: 'Schedule', mimeType: 'text/csv', status: 'uploaded',
      updatedAt: '2026-09-20T00:00:00.000Z', isCurrent: true,
    };
    const props = {
      sharedReferenceDocument: null, projectAreas: [], updates: [], onOpen: jest.fn(), onUpdate: jest.fn(),
      onSetCurrentSchedule, onMakeCurrentDocument: jest.fn(), onRetry: jest.fn(), onReplaceFile: jest.fn(), onDelete: jest.fn(),
    };
    const stale = render(<ProjectDocumentCard document={document} scheduleCurrent={false} {...props} />);
    expect(stale.queryByText('Current Schedule')).toBeNull();
    const button = stale.getByText('Make Current Schedule');
    expect(button).toBeTruthy();
    stale.unmount();

    const current = render(<ProjectDocumentCard document={{ ...document, isCurrent: false }} scheduleCurrent {...props} />);
    expect(current.getAllByText('Current Schedule')).toHaveLength(2);
    current.unmount();

    // Without the cloud's answer the flag stands, as before.
    const fallback = render(<ProjectDocumentCard document={document} {...props} />);
    expect(fallback.getAllByText('Current Schedule')).toHaveLength(2);
  });

  it('App.tsx hands every card the cloud\'s answer for the card\'s project', () => {
    expect(app).toContain('scheduleCurrent={phoneScheduleCardIsCurrent(item, projectNames.find(name => projectDocumentMatchesProject(item, name)) || projectName, referenceDocuments)}');
  });
});
