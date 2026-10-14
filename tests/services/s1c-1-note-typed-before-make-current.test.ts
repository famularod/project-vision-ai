/**
 * S1c item 1 (14 Oct 2026; review pass 5's H5S-1, Low, caused by 381f8b2f, 3.1). On the iPhone or iPad, a schedule PDF
 * card whose shared copy has reached the cloud, before this device has heard back (its copy has no cloud stamp): he
 * types a note on the card and presses Make Current at once. 3.1 made such a schedule current by the cloud's own
 * revision; the note then never reached the iPad or the computer (the activation's stamp outranked it, and the
 * protection for text typed just before Make Current needs the stamp this device last saw). No message.
 * Now: with no stamp here, a schedule whose details on this device differ from the cloud's copy is not made current:
 * a true line, nothing changed on any device, and the note goes up as it would have. With nothing typed it is made
 * current by the cloud's revision as 3.1 built; with the stamp, as before (the note kept and sent).
 * The older T4n (no stamp, the note's upload crossing the activation: nothing left current) is covered by the same
 * refusal. T4 (the stamp held here, the same crossing) is not: see NOTES-S1c.
 * The rig is the reviewer's (notes/p6-b232/hrv5s-typed.test.ts, from audit-a8-p3-document-text-through-activation):
 * the real SyncService queue and upload, the real activateSharedReferenceDocument (only its activation call and the
 * retirement scope given), App.tsx's activateReferenceDocument compiled. Synthetic data.
 */
const mockStorageValues = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockStorageValues.get(key) ?? null)),
  setItem: jest.fn((key: string, value: string) => { mockStorageValues.set(key, value); return Promise.resolve(); }),
  removeItem: jest.fn((key: string) => { mockStorageValues.delete(key); return Promise.resolve(); }),
  getAllKeys: jest.fn(() => Promise.resolve([...mockStorageValues.keys()])),
}));

const ok = <T>(data: T) => Promise.resolve({ ok: true, configured: true, stubbed: false, data });
const mockCloud = new Map<string, Record<string, unknown>>();
let mockListOverride: (() => Record<string, unknown>[]) | null = null;
const mockUpsertReferenceDocument = jest.fn(async (document: Record<string, unknown>) => {
  const { cloudUpdatedAt: _c, ...documentData } = document;
  mockCloud.set(String(document.id), { ...documentData, cloudUpdatedAt: '2026-10-14T12:00:09.000Z' });
  return { ok: true, configured: true, stubbed: false, data: document };
});
jest.mock('../../services/SupabaseService', () => ({
  listProjects: () => ok([{ id: '11111111-1111-4111-8111-111111111111', name: 'Alpha' }]),
  listArchivedProjects: () => ok([]),
  listReferenceDocuments: () => ok(mockListOverride ? mockListOverride() : [...mockCloud.values()].map(row => ({ ...row }))),
  upsertReferenceDocument: (document: Record<string, unknown>) => mockUpsertReferenceDocument(document),
  listDAVESyncTombstones: () => ok([]),
  upsertDAVESyncTombstone: () => ok(null),
  upsertDAVESyncTombstones: (tombstones: unknown[]) => ok(tombstones),
  listDAVEStorageCleanupIntents: () => ok([]),
  removeProtectedStorageObject: () => ok(null),
  recordDAVEStorageCleanupAttempt: () => ok(null),
  getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
}));

import { getOfflineQueue, queueReferenceDocumentRecord, requeueReferenceDocumentEditsOutlivingActivation, uploadPendingChanges } from '../../services/SyncService';
import { mergeDAVEReferenceDocumentRecoveryRecords } from '../../services/DAVECloudRecovery';
import { reconcileCurrentScheduleDocuments, scheduleDocumentIsCurrentEverywhere } from '../../services/PIEScheduleReconciliation';
import { activateSharedReferenceDocument } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument } from '../../types';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
const said: string[] = [];
const say = (line: string) => { said.push(line); };

const UPLOADED_AT = '2026-10-14T11:59:00.000Z'; // the shared copy reached the cloud (this device has not heard back)
const TYPED_AT = '2026-10-14T12:00:00.000Z';
const ACTIVATED_AT = '2026-10-14 12:00:01.234567+00';
const ACTIVATED_ROW_AT = '2026-10-14T12:00:01.234567+00:00';

const sched = (id: string, notes: string, extra: Partial<ReferenceDocument> = {}): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.pdf`, uri: '', storagePath: `project-documents/alpha/${id}.pdf`, category: 'Schedules', notes,
  isCurrent: false, importedAt: '2026-10-14T11:58:00.000Z', projectId: null, projectName: 'Alpha', projectNames: ['Alpha'],
  updatedAt: UPLOADED_AT, cloudUpdatedAt: UPLOADED_AT, ...extra,
}) as ReferenceDocument;
const MASTER = () => sched('alpha-master', '', { isCurrent: true, importedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', cloudUpdatedAt: '2026-09-01T00:00:00.000Z', importBatchId: 'batch-master' } as Partial<ReferenceDocument>);

function cloudBefore() {
  for (const doc of [MASTER(), sched('rev6', 'Rev 6 from the GC')]) {
    const { cloudUpdatedAt, ...data } = doc;
    mockCloud.set(doc.id, { ...data, cloudUpdatedAt });
  }
}
function activateInCloud(id: string) {
  const row = mockCloud.get(id)!;
  mockCloud.set(id, { ...row, isCurrent: true, updatedAt: ACTIVATED_AT, cloudUpdatedAt: ACTIVATED_ROW_AT });
  const master = mockCloud.get('alpha-master')!;
  mockCloud.set('alpha-master', { ...master, isCurrent: false, updatedAt: ACTIVATED_AT, cloudUpdatedAt: ACTIVATED_ROW_AT });
}

function componentFunction(name: string): string {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no component function ${name}`);
  const open = app.indexOf(' {\n', match.index) + 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') { depth -= 1; if (depth === 0) return app.slice(match.index + 3, index + 1); }
  }
  throw new Error('unbalanced function');
}

beforeEach(() => { mockStorageValues.clear(); mockCloud.clear(); mockUpsertReferenceDocument.mockClear(); mockListOverride = null; });

async function press(label: string, local: ReferenceDocument[], opts: { staleUploadPass?: boolean; passInsideActivation?: boolean } = {}) {
  cloudBefore();
  const alerts: string[] = [];
  const referenceDocumentsCurrentRef = { current: local };
  const cloudList = () => [...mockCloud.values()].map(row => ({ ...row })) as unknown as ReferenceDocument[];
  let expected = '';
  const deps: Record<string, unknown> = {
    referenceDocumentsCurrentRef, currentReferenceActivationIdsRef: { current: new Set<string>() },
    scheduleDocumentIsCurrentEverywhere,
    buildECOSDocumentReadiness: () => ({ canMakeCurrent: true, detail: '' }), canonicalReferenceCategory: () => 'schedule',
    projectDocumentSharedRecordSync: { flush: (id: string) => {
      void queueReferenceDocumentRecord(referenceDocumentsCurrentRef.current.find(document => document.id === id)!, false);
      return true;
    } },
    activateSharedReferenceDocument: (args: Parameters<typeof activateSharedReferenceDocument>[0]) => activateSharedReferenceDocument({
      ...args,
      loadRetirementScope: async () => 'project',
      activate: async ({ documentId, expectedUpdatedAt }) => {
        expected = expectedUpdatedAt;
        await new Promise(resolve => setTimeout(resolve, 5));
        const preList = cloudList() as unknown as Record<string, unknown>[];
        activateInCloud(documentId);
        if (opts.passInsideActivation) { mockListOverride = () => preList; const r = await uploadPendingChanges(); mockListOverride = null; say(`${label}: the pass that read the list before the activation wrote after it: ${JSON.stringify(r.itemOutcomes)}; cloud rev6 current ${mockCloud.get('rev6')?.isCurrent}, notes "${mockCloud.get('rev6')?.notes}"`); }
        return { status: 'activated', documentId, updatedAt: ACTIVATED_ROW_AT, changedCount: 2, message: null } as never;
      },
    }),
    getSupabaseClient: () => ({}), listReferenceDocuments: async () => ({ ok: true, data: cloudList() }),
    normalizeReferenceDocuments: (rows: unknown) => rows, scheduleRetirementMessage: () => '',
    Alert: { alert: (title: string, message?: string) => alerts.push(`${title} | ${message || ''}`) },
    deletedDAVERecordIds: () => [], operationalSyncTombstonesRef: { current: [] },
    requeueReferenceDocumentEditsOutlivingActivation, mergeDAVEReferenceDocumentRecoveryRecords, reconcileCurrentScheduleDocuments,
    scheduleProgressCarriedOnActivation: () => [], scheduleItemsCurrentRef: { current: [] },
    markReferenceDocumentsAuthorityReady: () => undefined, setReferenceDocuments: () => undefined,
  };
  const js = ts.transpileModule(`${componentFunction('activateReferenceDocument')}\nmodule.exports = activateReferenceDocument;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as unknown as (id: string) => Promise<boolean> };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));

  const preActivationList = cloudList();
  const result = await mod.exports('rev6');
  const phone = referenceDocumentsCurrentRef.current.find(document => document.id === 'rev6');
  say(`${label}: press resolved ${result}; activation asked with revision "${expected}"; alerts ${JSON.stringify(alerts)}`);
  say(`${label}: THIS PHONE'S LIST after the press: rev6 notes "${phone?.notes}", current ${phone?.isCurrent}`);
  const queued = await getOfflineQueue();
  say(`${label}: queue after the press: ${JSON.stringify(queued.map(item => ({ id: item.id, notes: (item.payload as { documentData?: ReferenceDocument }).documentData?.notes, isCurrent: (item.payload as { documentData?: ReferenceDocument }).documentData?.isCurrent, updatedAt: (item.payload as { documentData?: ReferenceDocument }).documentData?.updatedAt })))}`);
  if (opts.staleUploadPass) mockListOverride = () => preActivationList as unknown as Record<string, unknown>[];
  const uploadResult = await uploadPendingChanges();
  mockListOverride = null;
  say(`${label}: upload result ${JSON.stringify(uploadResult).slice(0, 600)}; queue left ${JSON.stringify((await getOfflineQueue()).map(item => [item.id, item.lastError]))}`);
  const cloud = mockCloud.get('rev6');
  const master = mockCloud.get('alpha-master');
  say(`${label}: THE CLOUD after the upload (what the iPad and the desktop get): rev6 notes "${cloud?.notes}", rev6 current ${cloud?.isCurrent}; master current ${master?.isCurrent}; upserts ${mockUpsertReferenceDocument.mock.calls.length}`);
  return { result, phone, cloud, master, alerts, upserts: mockUpsertReferenceDocument.mock.calls.length };
}

const typedNote = 'Rev 6 from the GC - use for October, Lot 4 pour moved';
const NOT_HEARD = 'Current revision was not changed | This device has not yet heard back from the cloud about this schedule, and its details here (such as a note just typed) differ from the cloud’s copy. Nothing was changed on any device, and nothing you typed was lost. Try again in a moment.';

describe('S1c item 1: a note typed just before Make Current on a schedule this device has no cloud stamp for', () => {
  it('T1: not made current; a true line; nothing changed in the cloud; the note goes up', async () => {
    const t = await press('T1', [MASTER(), sched('rev6', typedNote, { updatedAt: TYPED_AT, cloudUpdatedAt: null })]);
    expect([t.result, t.alerts]).toEqual([false, [NOT_HEARD]]);
    expect([t.cloud?.notes, t.cloud?.isCurrent, t.master?.isCurrent]).toEqual([typedNote, false, true]);
  });

  it('T4n: the note\'s upload pass crossing the press cannot leave nothing current: nothing is activated', async () => {
    const t = await press('T4n', [MASTER(), sched('rev6', typedNote, { updatedAt: TYPED_AT, cloudUpdatedAt: null })], { passInsideActivation: true });
    expect([t.result, t.alerts]).toEqual([false, [NOT_HEARD]]);
    expect([t.cloud?.notes, t.cloud?.isCurrent, t.master?.isCurrent]).toEqual([typedNote, false, true]);
  });

  it('control, 3.1 as built: no stamp and nothing typed: made current by the cloud\'s revision', async () => {
    const t = await press('T1b', [MASTER(), sched('rev6', 'Rev 6 from the GC', { cloudUpdatedAt: null })]);
    expect([t.result, t.alerts, t.cloud?.isCurrent, t.master?.isCurrent, t.cloud?.notes]).toEqual([true, [], true, false, 'Rev 6 from the GC']);
  });

  it('control, as before 3.1: the stamp held here: made current, and the note kept and sent', async () => {
    const t = await press('T2', [MASTER(), sched('rev6', typedNote, { updatedAt: TYPED_AT, cloudUpdatedAt: UPLOADED_AT })]);
    expect([t.result, t.alerts, t.cloud?.isCurrent, t.master?.isCurrent, t.cloud?.notes]).toEqual([true, [], true, false, typedNote]);
  });
});
