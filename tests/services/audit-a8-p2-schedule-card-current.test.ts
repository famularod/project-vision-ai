/**
 * Whole-app audit A8 pass 2 (30 Sep 2026), the phone's schedule cards:
 *
 * #2 After "Import This Schedule" (offered by the Make Current warning on a
 *    schedule PDF card) the card still read "Make Current Schedule"; tapping
 *    it warned that the imported tasks would be hidden on every device, and
 *    Make Current would hide them. The card is now current once its import
 *    is approved and safely queued, and its shared copy is left alone (the
 *    card is not relinked to the imported record: a later retry, rename or
 *    Delete from All Devices would then rewrite or delete the imported
 *    schedule). Make Current on a card whose file was already imported for
 *    its project makes that import current, unasked.
 * #3 Making one project's schedule card current un-marked the schedule
 *    cards of every other project.
 * #8 Set Active in the Schedule screen skipped the "no imported tasks"
 *    warning the card shows.
 *
 * The App functions run compiled from App.tsx, with the real services.
 */
import {
  importedScheduleOfPhoneSchedule,
  phoneScheduleActivationTarget,
  scheduleTasksHiddenByActivation,
  scheduleTasksHiddenWarning,
} from '../../services/SharedDocumentActivation';
import { markCurrentProjectScheduleDocument } from '../../services/DAVEDocumentWorkspace';
import { bindPIEScheduleImportBatchProvenance } from '../../services/PIEScheduleImportBatch';
import {
  createOwnedLocalFileManifest,
  createOwnedLocalFileManifestRecord,
} from '../../services/OwnedLocalFileRepository';
import type { ReferenceDocument, ScheduleItem } from '../../types';

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

const SHA = 'ab'.repeat(32);
const FILE_ID = 'card0000-e29b-41d4-a716-446655440000';
const manifest = createOwnedLocalFileManifest([createOwnedLocalFileManifestRecord({
  fileId: FILE_ID, kind: 'project_document', generatedBasename: `${FILE_ID}.pdf`, relativePath: `${FILE_ID}.pdf`,
  sha256: SHA, sizeBytes: 10, mimeType: 'application/pdf',
})]);

type Card = {
  id: string; projectId: string; name: string; category: string; mimeType: string; sizeBytes: number;
  referenceDocumentId: string | null; importedAt: string; updatedAt: string; isCurrent?: boolean;
  ownedFileId?: string; ownedFileManifest?: unknown;
};
const card = (extra: Partial<Card> = {}): Card => ({
  id: 'phone-pdf', projectId: 'alpha-key', name: 'Schedule.pdf', category: 'Schedule', mimeType: 'application/pdf',
  sizeBytes: 10, referenceDocumentId: 'upload-copy', importedAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z', isCurrent: false, ownedFileId: FILE_ID, ownedFileManifest: manifest, ...extra,
});
const doc = (id: string, extra: Partial<ReferenceDocument>): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.pdf`, uri: '', category: 'Schedules', notes: '', isCurrent: false,
  importedAt: '2026-09-01T00:00:00.000Z', projectName: 'Alpha', projectNames: ['Alpha'], ...extra,
} as ReferenceDocument);
const master = doc('Master', { isCurrent: true, importBatchId: 'batch-m', cloudUpdatedAt: 'c1' });
// The phone's upload of Schedule.pdf: shared, no batch, no tasks.
const uploadCopy = doc('upload-copy', { name: 'Schedule', originalFileName: 'Schedule.pdf', contentSha256: SHA, cloudUpdatedAt: 'c2' });
const task = (id: string, batch: string, source: string): ScheduleItem => ({
  id, projectName: 'Alpha', taskName: id, locationName: '', owner: '', startDate: '07/01/2026', finishDate: '07/10/2026',
  milestone: '', status: 'Not Started', percentComplete: 0, notes: '', createdAt: '2026-07-01T00:00:00.000Z',
  importBatchId: batch, sourceDocumentId: source,
} as ScheduleItem);

/** The phone, as far as these functions see it. */
function phone(initial: { cards: Card[]; documents: ReferenceDocument[]; items: ScheduleItem[] }) {
  const state = { cards: initial.cards, documents: initial.documents, items: initial.items, persisted: [] as Card[][] };
  const alerts: Array<{ title: string; message: string; buttons: Array<{ text: string; onPress?: () => void }> }> = [];
  const refs = {
    projectDocumentsCurrentRef: { current: state.cards },
    referenceDocumentsCurrentRef: { current: state.documents },
    scheduleItemsCurrentRef: { current: state.items },
    projectScheduleImportCardRef: { current: null as null | { batchId: string; documentId: string } },
  };
  const apply = <T>(value: T | ((prev: T) => T), prev: T) =>
    typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
  const importedBatch = {
    id: 'batch-1', kind: 'schedule_file', sourceCount: 1, sourceLabel: 'Schedule.pdf', message: '',
    items: ['t1', 't2', 't3'].map(id => ({ ...task(id, '', ''), importBatchId: undefined, sourceDocumentId: undefined, importedFrom: 'Schedule.pdf' })),
    documents: [doc('imported', { name: 'Schedule', originalFileName: 'Schedule.pdf', isCurrent: true, contentSha256: SHA, importBatchId: 'batch-1' })],
  };
  const syncResult = { durablyQueued: true, fullySynced: true, supersededScheduleItemIds: [] as string[], supersededReferenceDocumentIds: [] as string[], uploadedReferenceDocuments: [] };
  const deps: Record<string, unknown> = {
    ...refs,
    get projectDocuments() { return state.cards; },
    projects: ['Alpha'], authorityProjectId: (name: string) => `${name.toLowerCase()}-key`,
    get referenceDocuments() { return state.documents; },
    get scheduleItems() { return state.items; },
    scheduleTasksHiddenWarning, scheduleTasksHiddenByActivation, phoneScheduleActivationTarget, importedScheduleOfPhoneSchedule,
    markCurrentProjectScheduleDocument,
    loadECOSScheduleRetirementScope: async () => 'schedule', getSupabaseClient: () => null,
    activateReferenceDocument: jest.fn(async () => true),
    markReferenceDocumentCurrent: jest.fn(),
    ensureVerifiedProjectDocumentBytes: jest.fn(async (verified: object) => ({ ...verified, localUri: 'file:///verified/Schedule.pdf' })),
    prepareScheduleImportFromAsset: jest.fn(async () => importedBatch),
    setIncomingScheduleImportBatch: jest.fn(), setScheduleProjectFilter: jest.fn(), setScreen: jest.fn(),
    setProjectDocuments: (value: Card[] | ((prev: Card[]) => Card[])) => {
      state.cards = apply(value, state.cards);
      refs.projectDocumentsCurrentRef.current = state.cards;
    },
    setDraft: jest.fn(), setSavedUpdates: jest.fn(),
    persistProjectDocumentsImmediately: jest.fn(async (cards: Card[]) => { state.persisted.push(cards); }),
    reportStoragePersistenceFailure: jest.fn(), PROJECT_DOCUMENTS_STORAGE_KEY: 'projectDocuments',
    // approveScheduleImport, reduced to what these cases need: the batch is approved as reviewed.
    archivedProjectsCurrentRef: { current: [] }, deletedProjectNamesRef: { current: [] },
    projectsCurrentRef: { current: ['Alpha'] }, projectRecordsCurrentRef: { current: [] },
    validateScheduleImportScope: ({ items }: { items: unknown[] }) => ({ items, warnings: [] }),
    projectAreasForProject: () => [], projectAreasCurrentRef: { current: [] }, savedUpdatesRef: { current: [] },
    scheduleImportApprovalBlocker: () => null, ScheduleImportReviewError: Error,
    bindPIEScheduleImportBatchProvenance, canonicalizeScheduleIdentityItems: (items: unknown[]) => items,
    normalizeScheduleItem: (item: unknown) => item, identityCorrections: [], ensureScheduleParentProjects: jest.fn(),
    mergeApprovedScheduleImportItems: ({ existing, imported }: { existing: unknown[]; imported: unknown[] }) => ({ next: existing, additions: imported }),
    findExactScheduleTaskForCompletionClaim: () => null, scheduleItemsVisibleBeforeImport: () => () => true,
    mergeReportedCompletionClaim: (item: unknown) => item, reconcileDAVEScheduleRecords: (items: unknown[]) => items,
    scheduleDocumentsAfterApproval: ({ documents, approvedDocuments }: { documents: ReferenceDocument[]; approvedDocuments: ReferenceDocument[] }) =>
      [...approvedDocuments, ...documents],
    normalizeReferenceDocument: (value: unknown) => value,
    runScheduleImportCloudSync: jest.fn(async () => syncResult),
    markScheduleItemsAuthorityReady: jest.fn(), markReferenceDocumentsAuthorityReady: jest.fn(),
    setScheduleItems: (items: ScheduleItem[]) => { state.items = items; },
    setReferenceDocuments: (documents: ReferenceDocument[]) => { state.documents = documents; },
    deleteStoredReferenceDocument: async () => undefined,
    Alert: { alert: (title: string, message: string, buttons: Array<{ text: string; onPress?: () => void }> = []) => {
      alerts.push({ title, message, buttons });
    } },
  };
  const fns = compile<{
    makeProjectScheduleDocumentCurrent: (documentId: string, confirmed?: boolean) => Promise<void>;
    approveScheduleImport: (batch: typeof importedBatch) => Promise<void>;
    cancelScheduleImport: (batch: typeof importedBatch) => void;
    setActiveScheduleDocument: (documentId: string) => Promise<void>;
  }>([
    'makeProjectScheduleDocumentCurrent', 'reviewProjectScheduleDocumentImport', 'markProjectScheduleCardCurrent',
    'approveScheduleImport', 'cancelScheduleImport', 'setActiveScheduleDocument',
  ], deps);
  const press = async (text: string) => {
    alerts[alerts.length - 1].buttons.find(button => button.text === text)?.onPress?.();
    await new Promise(resolve => setTimeout(resolve, 0));
  };
  return { ...fns, state, alerts, deps, press, refs, importedBatch, syncResult };
}

const masterTasks = () => [task('m1', 'batch-m', 'Master'), task('m2', 'batch-m', 'Master'), task('m3', 'batch-m', 'Master')];
const WARNING = 'Schedule.pdf has no imported tasks. The 3 tasks from Master will be hidden on every device.';

describe('"Import This Schedule" from a phone card makes the card current (audit A8 pass 2 #2)', () => {
  it('the owner\'s path: warned, imports, and the card is current, still linked to its own shared copy', async () => {
    const h = phone({ cards: [card()], documents: [uploadCopy, master], items: masterTasks() });
    await h.makeProjectScheduleDocumentCurrent('phone-pdf');
    expect(h.alerts.map(alert => alert.message)).toEqual([WARNING]);
    await h.press('Import This Schedule');
    expect(h.refs.projectScheduleImportCardRef.current).toEqual({ batchId: 'batch-1', documentId: 'phone-pdf' });
    expect(h.state.cards[0].isCurrent).toBe(false);

    await h.approveScheduleImport(h.importedBatch);
    expect(h.state.cards[0]).toMatchObject({ id: 'phone-pdf', isCurrent: true, referenceDocumentId: 'upload-copy' });
    expect(h.state.persisted.at(-1)?.[0]).toMatchObject({ isCurrent: true, referenceDocumentId: 'upload-copy' });
    expect(h.refs.projectScheduleImportCardRef.current).toBeNull();
    // Nothing was made current in the cloud by the card, and no second warning was shown.
    expect(h.deps.activateReferenceDocument).not.toHaveBeenCalled();
    expect(h.alerts).toHaveLength(1);
  });

  it('leaves the card alone when the import is not safely queued, belongs to another review, or was cancelled', async () => {
    const failed = phone({ cards: [card()], documents: [uploadCopy, master], items: masterTasks() });
    failed.refs.projectScheduleImportCardRef.current = { batchId: 'batch-1', documentId: 'phone-pdf' };
    failed.syncResult.durablyQueued = false;
    await expect(failed.approveScheduleImport(failed.importedBatch)).rejects.toThrow();
    expect(failed.state.cards[0].isCurrent).toBe(false);

    const other = phone({ cards: [card()], documents: [uploadCopy, master], items: masterTasks() });
    other.refs.projectScheduleImportCardRef.current = { batchId: 'another-batch', documentId: 'phone-pdf' };
    await other.approveScheduleImport(other.importedBatch);
    expect(other.state.cards[0].isCurrent).toBe(false);
    expect(other.refs.projectScheduleImportCardRef.current).toEqual({ batchId: 'another-batch', documentId: 'phone-pdf' });

    const cancelled = phone({ cards: [card()], documents: [uploadCopy, master], items: masterTasks() });
    cancelled.refs.projectScheduleImportCardRef.current = { batchId: 'batch-1', documentId: 'phone-pdf' };
    cancelled.cancelScheduleImport(cancelled.importedBatch);
    expect(cancelled.refs.projectScheduleImportCardRef.current).toBeNull();

    const deletedBefore = phone({ cards: [card()], documents: [uploadCopy, master], items: masterTasks() });
    deletedBefore.refs.projectScheduleImportCardRef.current = { batchId: 'batch-1', documentId: 'phone-pdf' };
    deletedBefore.syncResult.supersededReferenceDocumentIds = ['imported'];
    await deletedBefore.approveScheduleImport(deletedBefore.importedBatch);
    expect(deletedBefore.state.cards[0].isCurrent).toBe(false);
  });

  it('Make Current on a card whose file is already imported for its project makes that import current, unasked', async () => {
    const imported = doc('imported', { name: 'Schedule', originalFileName: 'Schedule.pdf', contentSha256: SHA.toUpperCase(), importBatchId: 'batch-1', cloudUpdatedAt: 'c3' });
    const items = [...masterTasks(), task('t1', 'batch-1', 'imported')];
    const h = phone({ cards: [card()], documents: [uploadCopy, master, imported], items });
    await h.makeProjectScheduleDocumentCurrent('phone-pdf');
    expect(h.alerts).toEqual([]);
    expect(h.deps.activateReferenceDocument).toHaveBeenCalledWith('imported');
    expect(h.state.cards[0]).toMatchObject({ isCurrent: true, referenceDocumentId: 'upload-copy' });

    // Not for another project's import of the same file, nor a file never imported.
    expect(importedScheduleOfPhoneSchedule(card(), 'Beta', [imported])).toBeNull();
    expect(importedScheduleOfPhoneSchedule(card({ ownedFileManifest: null, referenceDocumentId: null }), 'Alpha', [imported])).toBeNull();
    // Without the file record, the shared copy's fingerprint is used.
    expect(importedScheduleOfPhoneSchedule(card({ ownedFileManifest: null }), 'Alpha', [uploadCopy, imported])?.id).toBe('imported');
    // The task-less copy itself is never the answer.
    expect(importedScheduleOfPhoneSchedule(card(), 'Alpha', [uploadCopy])).toBeNull();
  });
});

describe('Make Current on one project\'s schedule card leaves other projects\' cards (audit A8 pass 2 #3)', () => {
  it('un-marks only the cards of the projects that gain a current card', () => {
    const at = '2026-09-30T12:00:00.000Z';
    const cards = [
      { id: 'a-old', projectId: 'alpha', category: 'Schedule', isCurrent: true, updatedAt: at },
      { id: 'a-new', projectId: 'alpha', category: 'Schedule', isCurrent: false, updatedAt: at },
      { id: 'b-current', projectId: 'beta', category: 'Schedule', isCurrent: true, updatedAt: at },
      { id: 'b-drawing', projectId: 'beta', category: 'Drawing', isCurrent: true, updatedAt: at },
    ];
    const result = markCurrentProjectScheduleDocument({ documents: cards, documentId: 'a-new', updatedAt: 'T' });
    expect(result.map(item => [item.id, item.isCurrent])).toEqual([
      ['a-old', false], ['a-new', true], ['b-current', true], ['b-drawing', true],
    ]);
    expect(result[2]).toBe(cards[2]);
  });
});

describe('Set Active in the Schedule screen warns as the card does (audit A8 pass 2 #8)', () => {
  it('asks before a schedule with no imported tasks hides the project\'s; Cancel changes nothing', async () => {
    const h = phone({ cards: [], documents: [uploadCopy, master], items: masterTasks() });
    await h.setActiveScheduleDocument('upload-copy');
    expect(h.alerts.map(alert => [alert.title, alert.message, alert.buttons.map(button => button.text)])).toEqual([
      ['Make Schedule current?', 'Schedule has no imported tasks. The 3 tasks from Master will be hidden on every device.', ['Cancel', 'Set Active']],
    ]);
    await h.press('Cancel');
    expect(h.deps.markReferenceDocumentCurrent).not.toHaveBeenCalled();
    await h.press('Set Active');
    expect(h.deps.markReferenceDocumentCurrent).toHaveBeenCalledWith('upload-copy');
  });

  it('asks nothing when the schedule brings its own tasks', async () => {
    const revision = doc('Rev 2', { importBatchId: 'batch-2', cloudUpdatedAt: 'c4' });
    const h = phone({ cards: [], documents: [revision, master], items: [...masterTasks(), task('r1', 'batch-2', 'Rev 2')] });
    await h.setActiveScheduleDocument('Rev 2');
    expect(h.alerts).toEqual([]);
    expect(h.deps.markReferenceDocumentCurrent).toHaveBeenCalledWith('Rev 2');
  });
});
