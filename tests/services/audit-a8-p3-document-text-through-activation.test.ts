/**
 * Whole-app audit A8 pass 3 M2 (30 Sep 2026): text typed on a phone document
 * card just before Make Current stayed on the card and never reached the iPad
 * or the web. Make Current queued the waiting text first (pass 2 #7), but its
 * upload starts after network steps while the activation call starts at
 * once. The activation stamps the record's document_data.updatedAt with the
 * time it ran (ecos_activate_current_reference_document), the queued text
 * then ranked older than the cloud copy and was resolved as already
 * uploaded, and the phone's own list took the cloud copy too. The same
 * dropped a note edited offline when the document was made current on the
 * iPad or the web before the phone reconnected.
 *
 * Now an edit made after the cloud copy the phone last saw survives a cloud
 * copy that differs from it only by an activation's current flags and stamp:
 * at upload, and, after this phone's own Make Current, queued again stamped
 * after the activation. uploadPendingChanges and queueReferenceDocumentRecord
 * are the real SyncService; activateReferenceDocument runs compiled from
 * App.tsx.
 */
const mockStorageValues = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockStorageValues.get(key) ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    mockStorageValues.set(key, value);
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    mockStorageValues.delete(key);
    return Promise.resolve();
  }),
  getAllKeys: jest.fn(() => Promise.resolve([...mockStorageValues.keys()])),
}));

const ok = <T>(data: T) => Promise.resolve({ ok: true, configured: true, stubbed: false, data });
// Each row's document_data, with updated_at as cloudUpdatedAt, as the metadata RPC lists them.
const mockCloud = new Map<string, Record<string, unknown>>();
const mockUpsertReferenceDocument = jest.fn(async (document: Record<string, unknown>) => {
  const { cloudUpdatedAt: _cloudUpdatedAt, ...documentData } = document;
  mockCloud.set(String(document.id), { ...documentData, cloudUpdatedAt: '2026-09-30T12:05:00.000Z' });
  return { ok: true, configured: true, stubbed: false, data: document };
});

jest.mock('../../services/SupabaseService', () => ({
  listProjects: () => ok([]),
  listArchivedProjects: () => ok([]),
  listReferenceDocuments: () => ok([...mockCloud.values()].map(row => ({ ...row }))),
  upsertReferenceDocument: (document: Record<string, unknown>) => mockUpsertReferenceDocument(document),
  listDAVESyncTombstones: () => ok([]),
  upsertDAVESyncTombstone: () => ok(null),
  upsertDAVESyncTombstones: (tombstones: unknown[]) => ok(tombstones),
  listDAVEStorageCleanupIntents: () => ok([]),
  removeProtectedStorageObject: () => ok(null),
  recordDAVEStorageCleanupAttempt: () => ok(null),
  getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
}));

import {
  getOfflineQueue,
  queueReferenceDocumentRecord,
  requeueReferenceDocumentEditsOutlivingActivation,
  uploadPendingChanges,
} from '../../services/SyncService';
import {
  mergeDAVEReferenceDocumentRecoveryRecords,
  referenceDocumentEditOutlivingActivation,
} from '../../services/DAVECloudRecovery';
import { reconcileCurrentScheduleDocuments } from '../../services/PIEScheduleReconciliation';
import type { ReferenceDocument } from '../../types';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

const SEEN_AT = '2026-09-30T11:00:00.000Z';
const TYPED_AT = '2026-09-30T12:00:00.000Z';
// As the activation writes it: activation_at::text.
const ACTIVATED_AT = '2026-09-30 12:00:01.234567+00';
const ACTIVATED_ROW_AT = '2026-09-30T12:00:01.234567+00:00';

function record(notes: string, extra: Partial<ReferenceDocument> = {}): ReferenceDocument {
  return {
    id: 'drawing-a201', name: 'A-201', originalFileName: 'A-201.pdf', uri: '',
    storagePath: 'project-documents/alpha/drawing-a201/A-201.pdf', category: 'Drawing', notes,
    isCurrent: false, importedAt: '2026-09-01T00:00:00.000Z', updatedAt: SEEN_AT, cloudUpdatedAt: SEEN_AT,
    drawingNumber: 'A-201', drawingRevision: 'B',
    ...extra,
  };
}

/** The cloud before: the copy the phone last saw. */
function cloudBefore() {
  const { cloudUpdatedAt: _seen, ...data } = record('Issued for permit');
  mockCloud.set('drawing-a201', { ...data, cloudUpdatedAt: SEEN_AT });
}

/** ecos_activate_current_reference_document: isCurrent and updatedAt only. */
function activateInCloud() {
  const row = mockCloud.get('drawing-a201')!;
  mockCloud.set('drawing-a201', { ...row, isCurrent: true, updatedAt: ACTIVATED_AT, cloudUpdatedAt: ACTIVATED_ROW_AT });
}

const typed = () => record('Issued for permit — stamped by the city', { updatedAt: TYPED_AT });

beforeEach(() => {
  mockStorageValues.clear();
  mockCloud.clear();
  mockUpsertReferenceDocument.mockClear();
});

describe('an edit queued before the document was made current reaches the cloud (audit A8 pass 3 M2)', () => {
  it('Make Current on this phone ran first: the typed text still uploads, and the drawing stays Current', async () => {
    cloudBefore();
    await queueReferenceDocumentRecord(typed(), false);
    activateInCloud();

    await expect(uploadPendingChanges()).resolves.toMatchObject({ queued: 0 });
    expect(mockCloud.get('drawing-a201')).toMatchObject({
      notes: 'Issued for permit — stamped by the city',
      isCurrent: true,
    });
    // Stamped after the activation, so the iPad and the web take it over their activated copy.
    const stamp = String(mockCloud.get('drawing-a201')?.updatedAt);
    expect(Date.parse(stamp)).toBeGreaterThan(Date.parse(ACTIVATED_ROW_AT));
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('a note edited offline, made current on the web before the phone reconnected, reaches the cloud', async () => {
    cloudBefore();
    await queueReferenceDocumentRecord(typed(), false); // offline: it waits
    activateInCloud(); // Make Current on the web
    await uploadPendingChanges(); // signal returns
    expect(mockCloud.get('drawing-a201')).toMatchObject({ notes: 'Issued for permit — stamped by the city', isCurrent: true });
  });

  it('control: a web edit (current flags unchanged) still outranks an older phone edit', async () => {
    cloudBefore();
    await queueReferenceDocumentRecord(typed(), false);
    const row = mockCloud.get('drawing-a201')!;
    mockCloud.set('drawing-a201', { ...row, notes: 'Edited on the web', updatedAt: '2026-09-30T12:00:02.000Z', cloudUpdatedAt: '2026-09-30T12:00:02.000Z' });
    await uploadPendingChanges();
    expect(mockUpsertReferenceDocument).not.toHaveBeenCalled();
    expect(mockCloud.get('drawing-a201')).toMatchObject({ notes: 'Edited on the web' });
  });

  it('control: a phone copy not edited since its last look does not undo the cloud copy', async () => {
    cloudBefore();
    // The phone saw a newer cloud copy than its own edit time: nothing of its own is waiting.
    await queueReferenceDocumentRecord(record('Old phone text', { updatedAt: '2026-09-30T10:00:00.000Z' }), false);
    activateInCloud();
    await uploadPendingChanges();
    expect(mockUpsertReferenceDocument).not.toHaveBeenCalled();
    expect(mockCloud.get('drawing-a201')).toMatchObject({ notes: 'Issued for permit', isCurrent: true });
  });

  it('the rule: only a differing edit made after the last look, against changed current flags', () => {
    const cloud = { ...record('Issued for permit', { isCurrent: true, updatedAt: ACTIVATED_AT, cloudUpdatedAt: ACTIVATED_ROW_AT }) };
    const now = Date.parse('2026-09-30T12:00:05.000Z');
    expect(referenceDocumentEditOutlivingActivation(typed(), cloud, now)).toMatchObject({
      notes: 'Issued for permit — stamped by the city', updatedAt: '2026-09-30T12:00:05.000Z',
    });
    // A phone clock behind the server still lands after the activation.
    expect(referenceDocumentEditOutlivingActivation(typed(), cloud, Date.parse(TYPED_AT))?.updatedAt).toBe('2026-09-30T12:00:01.235Z');
    expect(referenceDocumentEditOutlivingActivation(typed(), { ...cloud, isCurrent: false }, now)).toBeNull();
    expect(referenceDocumentEditOutlivingActivation({ ...typed(), notes: 'Issued for permit' }, cloud, now)).toBeNull();
    expect(referenceDocumentEditOutlivingActivation({ ...typed(), cloudUpdatedAt: null }, cloud, now)).toBeNull();
    // A combined schedule retired for one project (Q15) is an activation too.
    const schedule = { ...typed(), category: 'Schedules', isCurrent: true, projectNames: ['Alpha', 'Beta'] };
    expect(referenceDocumentEditOutlivingActivation(schedule, { ...cloud, ...schedule, notes: 'x', updatedAt: ACTIVATED_AT, retiredForProjectNames: ['Alpha'] }, now)).not.toBeNull();
    // Merged, the cloud's current flags still win.
    const [merged] = mergeDAVEReferenceDocumentRecoveryRecords({ local: [referenceDocumentEditOutlivingActivation(typed(), cloud, now)!], cloud: [cloud] });
    expect(merged).toMatchObject({ notes: 'Issued for permit — stamped by the city', isCurrent: true, cloudUpdatedAt: ACTIVATED_ROW_AT });
  });
});

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

describe('after this phone\'s Make Current, the typed text is queued again and stays on the phone (audit A8 pass 3 M2)', () => {
  it('App.tsx activateReferenceDocument, compiled: the phone\'s list keeps the text, Current, and the upload sends it', async () => {
    cloudBefore();
    const referenceDocumentsCurrentRef = { current: [typed()] };
    const cloudList = () => [...mockCloud.values()].map(row => ({ ...row })) as unknown as ReferenceDocument[];
    const deps: Record<string, unknown> = {
      referenceDocumentsCurrentRef, currentReferenceActivationIdsRef: { current: new Set<string>() },
      scheduleDocumentIsCurrentEverywhere: () => false,
      buildECOSDocumentReadiness: () => ({ canMakeCurrent: true, detail: '' }), canonicalReferenceCategory: () => 'drawing',
      // The text typed a moment ago is queued first, as the app does (pass 2 #7).
      projectDocumentSharedRecordSync: { flush: (id: string) => {
        void queueReferenceDocumentRecord(referenceDocumentsCurrentRef.current.find(document => document.id === id)!, false);
        return true;
      } },
      // The activation call returns before that upload started.
      activateSharedReferenceDocument: async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        activateInCloud();
        return { status: 'activated', documents: cloudList() };
      },
      getSupabaseClient: () => ({}), listReferenceDocuments: async () => ({ ok: true, data: cloudList() }),
      normalizeReferenceDocuments: (rows: unknown) => rows, scheduleRetirementMessage: () => '', Alert: { alert: jest.fn() },
      deletedDAVERecordIds: () => [], operationalSyncTombstonesRef: { current: [] },
      requeueReferenceDocumentEditsOutlivingActivation, mergeDAVEReferenceDocumentRecoveryRecords, reconcileCurrentScheduleDocuments,
      // Audit A5 pass 4 #3 (landed alongside): no schedule progress to carry for a drawing.
      scheduleProgressCarriedOnActivation: () => [], scheduleItemsCurrentRef: { current: [] },
      markReferenceDocumentsAuthorityReady: jest.fn(), setReferenceDocuments: jest.fn(),
    };
    const js = ts.transpileModule(`${componentFunction('activateReferenceDocument')}\nmodule.exports = activateReferenceDocument;`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const mod = { exports: {} as unknown as (id: string) => Promise<boolean> };
    new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));

    await expect(mod.exports('drawing-a201')).resolves.toBe(true);
    expect(referenceDocumentsCurrentRef.current).toEqual([
      expect.objectContaining({ notes: 'Issued for permit — stamped by the city', isCurrent: true, cloudUpdatedAt: ACTIVATED_ROW_AT }),
    ]);
    const queued = await getOfflineQueue();
    expect(queued).toHaveLength(1);
    const queuedDocument = (queued[0].payload as { documentData: ReferenceDocument }).documentData;
    expect(queuedDocument).toMatchObject({ notes: 'Issued for permit — stamped by the city', isCurrent: true });
    expect(Date.parse(queuedDocument.updatedAt || '')).toBeGreaterThan(Date.parse(ACTIVATED_ROW_AT));

    await uploadPendingChanges();
    expect(mockCloud.get('drawing-a201')).toMatchObject({ notes: 'Issued for permit — stamped by the city', isCurrent: true });
  });

  it('queues nothing again when the text had already reached the cloud before the activation', async () => {
    cloudBefore();
    await queueReferenceDocumentRecord(typed(), false);
    await uploadPendingChanges();
    activateInCloud();
    const cloud = [...mockCloud.values()] as unknown as ReferenceDocument[];
    await expect(requeueReferenceDocumentEditsOutlivingActivation(cloud)).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });
});
