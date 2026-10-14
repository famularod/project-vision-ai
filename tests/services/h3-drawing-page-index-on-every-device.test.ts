/**
 * High item 3 (open item 7.16; the owner's instruction of 13 Oct 2026, the three high items). Review pass 3
 * (reports), P3-3: which drawing a report cites is decided by the PAGE INDEX read out of the drawing's file, and the
 * devices did not hold the same one. The phone held it only in the app session that read the file (it saved and
 * downloaded its documents without it), the iPad never had it, and the cloud's row of a drawing stored in the app's
 * own cloud kept it, so the desktop cited the drawing and the phone, once the app had been closed, did not: the
 * piece of the drawing was gone from the phone's report, and neither device knew the report the other had sent.
 *
 * The coordinator's decision: every device holds the same page index for a drawing, and keeps it. The phone and the
 * iPad keep the part of the index a citation is read from with the document, read it back at launch, take it from
 * the cloud's row when they download the document, and send it with the row when they upload it. Nothing else of the
 * report or its fingerprint changes.
 *
 * Each device by its own code: the phone's save, launch, download (SupabaseService.listReferenceDocuments through the
 * document list function) and merge, its upload (SupabaseService.upsertReferenceDocument after the queue's merge),
 * the one report recipe and citation function; the desktop's own loader over the cloud's row and its own recipe and
 * words. Made-up project and drawing.
 */
import type * as RSTypes from '../../services/DAVEReportSnapshot';
import type { ReferenceDocument, ScheduleItem } from '../../types';

/** The cloud: one row per document, as the phone writes it and as the document list function gives it back. */
const mockCloud: {
  rows: Map<string, { id: string; name: string; category: string; document_data: Record<string, unknown>; updated_at: string }>;
  /** What the document list function returns of a row's document_data (its code is in no migration: both ways). */
  listGives: 'the row whole' | 'the row without its page index';
  clock: number;
} = { rows: new Map(), listGives: 'the row whole', clock: Date.parse('2026-09-21T15:01:00.000Z') };
function mockStore(payload: Record<string, any>, id: string) {
  mockCloud.clock += 60_000;
  mockCloud.rows.set(id, {
    id, name: payload.name, category: payload.category,
    document_data: JSON.parse(JSON.stringify(payload.document_data)), updated_at: new Date(mockCloud.clock).toISOString(),
  });
}
function mockListed() {
  return [...mockCloud.rows.values()].map(row => {
    const data = JSON.parse(JSON.stringify(row.document_data));
    if (mockCloud.listGives === 'the row without its page index') { delete data.extractedPages; delete data.extractedText; }
    return { ...row, document_data: data };
  });
}
function mockReferenceDocumentsQuery() {
  const query: Record<string, any> = {};
  let pending: { values: Record<string, any> } | null = null;
  const ids: string[] = [];
  query.upsert = jest.fn(async (payload: Record<string, any>) => { mockStore(payload, payload.id); return { error: null, status: 201 }; });
  query.update = jest.fn((values: Record<string, any>) => { pending = { values }; return query; });
  query.eq = jest.fn((column: string, value: string) => { if (column === 'id') ids.push(value); return query; });
  query.select = jest.fn(async () => {
    if (pending && ids[0]) mockStore(pending.values, ids[0]);
    return { data: ids.map(id => ({ id })), error: null, status: 200 };
  });
  return query;
}
const mockSupabaseClient = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: { access_token: 'session-token', user: { id: 'owner-1' } } }, error: null })),
    getUser: jest.fn(async () => ({ data: { user: { id: 'owner-1' } }, error: null })),
    onAuthStateChange: jest.fn(), startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn(),
  },
  from: jest.fn((table: string) => {
    if (table !== 'reference_documents') throw new Error(`Unexpected table ${table}`);
    return mockReferenceDocumentsQuery();
  }),
  rpc: jest.fn(async (name: string) => (name === 'dave_list_reference_document_metadata'
    ? { data: mockListed(), error: null, status: 200 }
    : { data: [], error: null, status: 200 })),
};
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockSupabaseClient) }));
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null, getInfoAsync: jest.fn(), readAsStringAsync: jest.fn(), EncodingType: { Base64: 'base64' } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
jest.mock('../../services/SupabaseAuthStorage', () => ({
  isAuthStorageSecure: jest.fn(async () => true),
  supabaseSecureAuthStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
/** The desktop reads the cloud's rows through the same document list function. */
jest.mock('../../services/DAVEWebSupabaseClient', () => ({ daveWebSupabaseGateway: { loadAuthorizedRows: async () => mockDesktopRows() } }));

// The phone's cloud client reads its settings when its module loads: before any of the app's modules.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
/* eslint-disable @typescript-eslint/no-var-requires */
const RI: typeof import('../../services/DAVEReportIntelligence') = require('../../services/DAVEReportIntelligence');
const RS: typeof import('../../services/DAVEReportSnapshot') = require('../../services/DAVEReportSnapshot');
const { compactECOSDocumentIndexForCloud, compactECOSReferenceDocumentsForOperationalRead }: typeof import('../../services/ECOSDocumentIndexPersistence') = require('../../services/ECOSDocumentIndexPersistence');
/** ReportsScreen's own call (absent on the base: the documents are then handed as they are). */
const withoutKeptPageIndexes: (documents: ReferenceDocument[]) => ReferenceDocument[] =
  require('../../services/ECOSDocumentIndexPersistence').withoutKeptPageIndexes ?? ((documents: ReferenceDocument[]) => documents);
const { normalizeScheduleImport }: typeof import('../../services/PIEScheduleIntelligence') = require('../../services/PIEScheduleIntelligence');
const { selectAuthoritativeScheduleItems }: typeof import('../../services/PIEScheduleReconciliation') = require('../../services/PIEScheduleReconciliation');
const { buildAutomaticReportDrawingReferences }: typeof import('../../services/ReportDrawingReferences') = require('../../services/ReportDrawingReferences');
const { normalizeProjectControls }: typeof import('../../services/VitruviusProjectControls') = require('../../services/VitruviusProjectControls');
const { buildDAVEReportProjectTruths }: typeof import('../../services/DAVEReportProjectTruths') = require('../../services/DAVEReportProjectTruths');
const { mergeDAVEReferenceDocumentRecoveryRecords }: typeof import('../../services/DAVECloudRecovery') = require('../../services/DAVECloudRecovery');
const WebOps = require('../../services/DAVEWebOperations');
const WebPeriod = require('../../services/DAVEWebReportPeriod');
const { loadDAVEWebReadOnlySnapshot }: typeof import('../../services/DAVEWebReadOnlyRepository') = require('../../services/DAVEWebReadOnlyRepository');
const { normalizeReferenceDocument, normalizeReferenceDocuments } = require('../../services/ReferenceDocumentRepository');
const SupabaseService: typeof import('../../services/SupabaseService') = require('../../services/SupabaseService');
/* eslint-enable @typescript-eslint/no-var-requires */

const NOW = '2026-10-01T18:00:00.000Z';
const IMPORTED = '2026-09-20T15:00:00.000Z';
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const ITEMS: ScheduleItem[] = (normalizeScheduleImport({
  contents: ['Task,Project,Area,Start,Finish,Percent Complete', 'Paint,Alpha,Lot,10/05/2026,10/09/2026,', 'Drywall,Alpha,Lot,10/01/2026,10/04/2026,'].join('\n'),
  sourceName: 'MASTER M1.csv', mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(IMPORTED),
} as any).items as ScheduleItem[]).map((item, index) => ({ ...item, id: `m1-${index + 1}`, importBatchId: 'batch-m1', sourceDocumentId: 'doc-m1', projectControls: normalizeProjectControls((item as any).projectControls), activity: [] } as unknown as ScheduleItem));
const SCHEDULE: ReferenceDocument = normalizeReferenceDocument({
  id: 'doc-m1', name: 'MASTER M1', originalFileName: 'MASTER M1.csv', category: 'Schedules', notes: '', isCurrent: true, importedAt: IMPORTED,
  projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: 'batch-m1', uri: '',
} as any);
const SCHEDULE_ROW = { id: SCHEDULE.id, name: SCHEDULE.name, category: SCHEDULE.category, document_data: json(SCHEDULE), updated_at: IMPORTED };
function mockDesktopRows() {
  return {
    projects: [{ id: 'project-alpha-id', name: 'Alpha', archived: false, created_at: IMPORTED, updated_at: IMPORTED, owner_id: 'owner-1', project_data: null }],
    scheduleItems: ITEMS.map(item => ({ id: item.id, item_data: json(item), created_at: IMPORTED, updated_at: '2026-09-20T15:01:00.000Z' })),
    projectUpdates: [], syncTombstones: [],
    referenceDocuments: [SCHEDULE_ROW, ...mockListed()],
  };
}
/** The page of the drawing that shows the Lot, with lines of the sheet that name no work area. */
const PAGE_C = {
  pageNumber: 1, sheetNumber: 'A-201', text: 'SITE PLAN - LOT',
  regions: [
    { id: 'region-lot', label: 'Lot', text: 'LOT 7 - NEW PAVING', areaNames: ['Lot'], confidence: 0.95, x: 0.1, y: 0.1, width: 0.4, height: 0.3 },
    { id: 'region-note-1', label: 'GENERAL NOTE 1', text: 'GENERAL NOTE 1', areaNames: [], confidence: 0.99, x: 0.6, y: 0.7, width: 0.3, height: 0.05 },
    { id: 'region-note-2', label: 'GENERAL NOTE 2', text: 'GENERAL NOTE 2', areaNames: [], confidence: 0.99, x: 0.6, y: 0.76, width: 0.3, height: 0.05 },
  ],
};
/** The drawing in the phone's memory in the session that read its file (Rev C). */
const DRAWING_AS_READ: ReferenceDocument = normalizeReferenceDocument({
  id: 'doc-a201', name: 'A-201 Site plan', originalFileName: 'A-201 Site plan.pdf', category: 'Plans', notes: '', isCurrent: true, importedAt: '2026-09-21T15:00:00.000Z',
  updatedAt: '2026-09-21T15:00:00.000Z',
  projectName: 'Alpha', projectNames: ['Alpha'], uri: 'file:///phone/Documents/project-documents/doc-a201.pdf', mimeType: 'application/pdf',
  storagePath: 'owner-1/doc-a201/A-201-Site-plan.pdf', sourceProvider: 'supabase_storage', sizeBytes: 1000, contentSha256: SHA_C, indexedContentSha256: SHA_C,
  drawingNumber: 'A-201', drawingRevision: 'C', drawingDiscipline: 'Architectural', drawingStatus: 'For Construction', drawingIssuedAt: '2026-09-18',
  extractionStatus: 'complete', extractionMethod: 'embedded_text', extractedText: 'SITE PLAN - LOT', extractedPages: [PAGE_C],
} as any);
const CITES_REV_C = ['Lot: A-201 Site plan · Rev C · Page 1'];

/** The phone (and the iPad): the app is closed and opened again: what it saved is read back at launch. */
function relaunch(documents: readonly ReferenceDocument[]): ReferenceDocument[] {
  return normalizeReferenceDocuments(json(compactECOSReferenceDocumentsForOperationalRead(documents)));
}
/** The phone (and the iPad) downloads the documents and merges them with its own (App.tsx's document refresh). */
async function download(local: readonly ReferenceDocument[]): Promise<ReferenceDocument[]> {
  const result = await SupabaseService.listReferenceDocuments();
  if (!result.ok || !Array.isArray(result.data)) throw new Error('list failed');
  return mergeDAVEReferenceDocumentRecoveryRecords({ local, cloud: normalizeReferenceDocuments(result.data) });
}
/**
 * The phone uploads a document: the queue's payload (SyncService.queueReferenceDocumentRecord cuts it down at queue
 * time), merged with the cloud's copy as the queue's upload does (SyncService, 'reference_document'), then
 * SupabaseService.upsertReferenceDocument, an update for a record the cloud has.
 */
async function upload(document: ReferenceDocument) {
  const payload = compactECOSDocumentIndexForCloud(document);
  const listed = await SupabaseService.listReferenceDocuments();
  const remote = (listed.data ?? []).find(candidate => candidate.id === document.id);
  const authoritative = remote
    ? mergeDAVEReferenceDocumentRecoveryRecords({ local: [payload], cloud: [remote] }).find(candidate => candidate.id === document.id)!
    : payload;
  const result = await SupabaseService.upsertReferenceDocument(authoritative, { existing: Boolean(remote) });
  if (!result.ok) throw new Error(`upload failed: ${result.error}`);
}
const drawingOf = (documents: readonly ReferenceDocument[]) => documents.find(document => document.id === 'doc-a201')!;

const SHOWN = () => selectAuthoritativeScheduleItems({ scheduleItems: ITEMS, scheduleDocuments: [SCHEDULE] }) as ScheduleItem[];
/** The phone's Reports screen: the one recipe, the screen's own citation function, the words, the report as sent. */
function phone(documents: readonly ReferenceDocument[]) {
  const all = [SCHEDULE, ...documents.filter(document => document.id !== SCHEDULE.id)];
  const shown = SHOWN();
  const truths = buildDAVEReportProjectTruths({
    projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown,
    knownScheduleItems: ITEMS, knownScheduleDocuments: [SCHEDULE], projectAreas: [], now: NOW,
    // As ReportsScreen hands them: the documents as held before, the drawings cited from what the device kept.
    referenceDocuments: withoutKeptPageIndexes(all), drawingDocuments: all,
  });
  const fingerprint = RI.buildDAVEReportSourceFingerprint(truths);
  const cites = buildAutomaticReportDrawingReferences({ documents: all, scheduleItems: shown, selectedProjectNames: ['Alpha'] }).map(reference => `${reference.areaName}: ${reference.citation.label}`);
  const briefing = RI.buildDAVEReportBriefing({ truths, selectedProjectNames: ['Alpha'], previousSnapshot: null, scheduleItems: shown } as any);
  const text = String((WebOps as any).formatDAVEWebReport(briefing, 'project_manager', null)).split('\n').filter((line: string) => !line.startsWith('Generated: ')).join('\n');
  const snapshot = RS.buildDAVEReportSnapshot({ truths, scopeKey: RS.daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: NOW, reportFormat: 'project_manager' });
  return {
    fingerprint, earlierVersion: RI.buildDAVELegacyReportSourceFingerprint(truths), cites, text,
    sent: RS.markReportSnapshotDelivered({ ...snapshot, deliveredAt: null } as RSTypes.DAVEReportSnapshot, '2026-10-01T18:05:00.000Z', 'phone-install'),
  };
}
/** The desktop's Reports page: its own loader over the cloud's rows, its own recipe and words. */
async function desktop() {
  const snapshot = { ...(await loadDAVEWebReadOnlySnapshot()), refreshedAt: NOW };
  const truths = (WebOps as any).buildDAVEWebReportTruths(snapshot, 'Alpha');
  const briefing = (WebOps as any).buildDAVEWebReportDraft(snapshot, 'Alpha', { previousSnapshot: null, waitingForOtherDevice: false });
  const fingerprint = RI.buildDAVEReportSourceFingerprint(truths);
  const report = RS.buildDAVEReportSnapshot({ truths, scopeKey: RS.daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: NOW, reportFormat: 'project_manager' });
  return {
    fingerprint,
    cites: buildAutomaticReportDrawingReferences({ documents: [...snapshot.referenceDocuments] as ReferenceDocument[], scheduleItems: [...snapshot.scheduleItems] as ScheduleItem[], selectedProjectNames: ['Alpha'] }).map(reference => `${reference.areaName}: ${reference.citation.label}`),
    text: String((WebOps as any).formatDAVEWebReport(briefing, 'project_manager', null)).split('\n').filter((line: string) => !line.startsWith('Generated: ')).join('\n'),
    sent: RS.markReportSnapshotDelivered({ ...report, deliveredAt: null } as RSTypes.DAVEReportSnapshot, '2026-10-01T18:07:00.000Z', 'desktop-browser'),
  };
}
/** "Your other device already sent this report": the desktop's own check, and the phone's (ReportsScreen alreadySentNotice). */
const desktopSaysAlreadySent = (sentByPhone: RSTypes.DAVEReportSnapshot, desktopFingerprint: string) =>
  (WebPeriod as any).daveWebReportAlreadySentElsewhereAt(sentByPhone, desktopFingerprint, new Set()) !== null;
const phoneSaysAlreadySent = (sentByDesktop: RSTypes.DAVEReportSnapshot, phoneFingerprint: string) =>
  typeof sentByDesktop.deliveredAt === 'string' && RS.sameReportSource(sentByDesktop.sourceFingerprint, phoneFingerprint);

/** The phone reads the drawing, sends it to the cloud as a new document, and downloads once (the ordinary day it was added). */
async function phoneAddsTheDrawing(): Promise<ReferenceDocument[]> {
  await upload(DRAWING_AS_READ);
  return download([SCHEDULE, DRAWING_AS_READ]);
}

beforeEach(() => {
  mockCloud.rows = new Map();
  mockCloud.listGives = 'the row whole';
});

describe('the reviewer\'s P3-3 sequence: a current drawing whose page index names the Lot, stored in the app\'s own cloud', () => {
  it('the phone after the app has been closed cites the same drawing page as the desktop; one fingerprint; the same words', async () => {
    const thatDay = await phoneAddsTheDrawing();
    const nextDay = await download(relaunch(thatDay));
    const onPhone = phone(nextDay); const onDesktop = await desktop();
    expect(onDesktop.cites).toEqual(CITES_REV_C);
    expect(onPhone.cites).toEqual(CITES_REV_C);
    expect(onPhone.fingerprint).toBe(onDesktop.fingerprint);
    expect(onPhone.text).toBe(onDesktop.text);
    // And before its first download of the day (no signal at launch): the same.
    expect(phone(relaunch(thatDay)).fingerprint).toBe(onDesktop.fingerprint);
  });

  it('the phone sends; the desktop says "Your other device already sent this report"; and the other way round', async () => {
    const nextDay = await download(relaunch(await phoneAddsTheDrawing()));
    const onPhone = phone(nextDay); const onDesktop = await desktop();
    expect(desktopSaysAlreadySent(onPhone.sent, onDesktop.fingerprint)).toBe(true);
    expect(phoneSaysAlreadySent(onDesktop.sent, onPhone.fingerprint)).toBe(true);
    expect((WebPeriod as any).daveWebReportAlreadySentElsewhereNote(onPhone.sent.deliveredAt)).toMatch(/^Your other device already sent this report /);
  });

  it('the iPad, which never read the file, downloads the drawing and cites the same page as the desktop; one fingerprint', async () => {
    await phoneAddsTheDrawing();
    const iPad = await download([SCHEDULE]);
    const iPadNextDay = await download(relaunch(iPad));
    const onDesktop = await desktop();
    for (const documents of [iPad, iPadNextDay]) {
      const onIPad = phone(documents);
      expect(onIPad.cites).toEqual(CITES_REV_C);
      expect(onIPad.fingerprint).toBe(onDesktop.fingerprint);
      expect(desktopSaysAlreadySent(onIPad.sent, onDesktop.fingerprint)).toBe(true);
      expect(phoneSaysAlreadySent(onDesktop.sent, onIPad.fingerprint)).toBe(true);
    }
  });

  it('the phone, on a later day, edits the drawing\'s details and uploads: the cloud\'s row still holds the index and the desktop still cites', async () => {
    const nextDay = await download(relaunch(await phoneAddsTheDrawing()));
    const edited = { ...drawingOf(nextDay), notes: 'Field verified', updatedAt: '2026-10-01T12:00:00.000Z' } as ReferenceDocument;
    await upload(edited);
    const row = mockCloud.rows.get('doc-a201')!;
    expect(row.document_data.notes).toBe('Field verified');
    expect((row.document_data.extractedPages as any[]).flatMap(page => page.regions.map((region: any) => region.areaNames)).flat()).toContain('Lot');
    expect(row.document_data).not.toHaveProperty('keptPageIndex');
    const onDesktop = await desktop();
    expect(onDesktop.cites).toEqual(CITES_REV_C);
    const after = await download(relaunch(nextDay.map(document => document.id === 'doc-a201' ? edited : document)));
    expect(phone(after).cites).toEqual(CITES_REV_C);
    expect(phone(after).fingerprint).toBe(onDesktop.fingerprint);
  });

  it('a device restored from the app\'s own backup still cites (the backup copies the documents as held)', async () => {
    const nextDay = await download(relaunch(await phoneAddsTheDrawing()));
    // App.tsx's backup: { ...document, uri: '' } for each document held; the restore normalizes them.
    const restored = relaunch(normalizeReferenceDocuments(json(nextDay.map(document => ({ ...document, uri: '' })))));
    expect(phone(restored).cites).toEqual(CITES_REV_C);
    expect(phone(restored).fingerprint).toBe((await desktop()).fingerprint);
  });
});

describe('a new revision replaces the drawing: every device cites the new revision\'s page or none, never the old one', () => {
  it('Rev D is uploaded in place of Rev C by a device that has not read its file: no device cites Rev C\'s page', async () => {
    const nextDay = await download(relaunch(await phoneAddsTheDrawing()));
    // The iPad replaces the file: the new file's checksum and revision, no page index yet.
    const iPad = await download([SCHEDULE]);
    const revD = { ...drawingOf(iPad), drawingRevision: 'D', contentSha256: SHA_D, sizeBytes: 2000, updatedAt: '2026-10-01T12:00:00.000Z' } as ReferenceDocument;
    await upload(revD);
    const onDesktop = await desktop();
    expect(onDesktop.cites.filter(cite => cite.includes('Rev C'))).toEqual([]);
    const phoneAfter = await download(nextDay);
    expect(phone(phoneAfter).cites.filter(cite => cite.includes('Rev C'))).toEqual([]);
    expect(phone(phoneAfter).fingerprint).toBe(onDesktop.fingerprint);
    // The phone that still holds Rev C's index for this document never offers it as Rev D's, nor sends it up.
    const stale = { ...drawingOf(relaunch(nextDay)), drawingRevision: 'D', contentSha256: SHA_D } as ReferenceDocument;
    expect(phone([SCHEDULE, stale]).cites).toEqual([]);
    // Sent up as a record the cloud does not have (its row gone): it goes without Rev C's index.
    mockCloud.rows.delete('doc-a201');
    await upload({ ...stale, updatedAt: '2026-10-01T13:00:00.000Z' } as ReferenceDocument);
    expect(mockCloud.rows.get('doc-a201')!.document_data.extractedPages).toEqual([]);
  });

  it('Rev D is read on the phone and sent in place of Rev C: every device cites the same, and none Rev C\'s page', async () => {
    const nextDay = await download(relaunch(await phoneAddsTheDrawing()));
    const revDAsRead = {
      ...DRAWING_AS_READ, drawingRevision: 'D', contentSha256: SHA_D, indexedContentSha256: SHA_D, sizeBytes: 2000, updatedAt: '2026-10-01T12:00:00.000Z',
      extractedPages: [{ ...PAGE_C, pageNumber: 2 }],
    } as ReferenceDocument;
    // A document the cloud already has: the queue merges it with the cloud's copy before it is sent.
    await upload(revDAsRead);
    const after = await download(relaunch(await download(nextDay)));
    const iPad = await download([SCHEDULE]);
    const onDesktop = await desktop();
    for (const cites of [onDesktop.cites, phone(after).cites, phone(iPad).cites]) {
      expect(cites.filter(cite => cite.includes('Rev C'))).toEqual([]);
    }
    expect(phone(after).fingerprint).toBe(onDesktop.fingerprint);
    expect(phone(iPad).fingerprint).toBe(onDesktop.fingerprint);
    // (As on the base, the queue sends a record the cloud already has with the cloud copy's index, so Rev D's own
    // reading does not reach the row: every device cites nothing until Rev D is prepared; never Rev C.)
    expect(onDesktop.cites).toEqual([]);
  });
});

describe('a drawing kept where the app cannot read it (Google Drive: its row carries no page index): as on the base', () => {
  it('the phone after the app has been closed, the iPad and the desktop cite nothing; one fingerprint', async () => {
    const drive = normalizeReferenceDocument({
      ...json(DRAWING_AS_READ), sourceProvider: 'google_drive', storagePath: null,
      externalSource: { provider: 'google_drive', fileId: 'drive-file-1', name: 'A-201 Site plan.pdf', mimeType: 'application/pdf', sizeBytes: 1000, modifiedTime: '2026-09-18T00:00:00.000Z' },
    } as any);
    // The desktop links it and writes its row with no page index (DAVEWebSupabaseClient.referenceDocumentRow).
    mockStore({ name: drive.name, category: drive.category, document_data: { ...json(drive), extractedPages: [], extractedText: null } }, drive.id);
    const phoneNextDay = await download(relaunch(await download([SCHEDULE, drive])));
    const iPad = await download([SCHEDULE]);
    const onDesktop = await desktop();
    expect(onDesktop.cites).toEqual([]);
    // The phone that read it cites it in that session only, as on the base; closed and opened again with no signal: nothing.
    expect(phone([SCHEDULE, drive]).cites).toEqual(CITES_REV_C);
    expect(phone(relaunch([SCHEDULE, drive])).cites).toEqual([]);
    expect(phone(phoneNextDay).cites).toEqual([]);
    expect(phone(iPad).cites).toEqual([]);
    expect(phone(phoneNextDay).fingerprint).toBe(onDesktop.fingerprint);
    expect(phone(iPad).fingerprint).toBe(onDesktop.fingerprint);
  });
});

describe('if the document list function leaves the page index out of what it returns (its code is not in the project)', () => {
  it('the phone after the app has been closed, the iPad and the desktop all cite nothing: one fingerprint, as on the base', async () => {
    const thatDay = await phoneAddsTheDrawing();
    mockCloud.listGives = 'the row without its page index';
    const phoneNextDay = await download(relaunch(await download(thatDay)));
    const iPad = await download([SCHEDULE]);
    const onDesktop = await desktop();
    expect(onDesktop.cites).toEqual([]);
    expect(phone(phoneNextDay).cites).toEqual([]);
    expect(phone(iPad).cites).toEqual([]);
    expect(phone(phoneNextDay).fingerprint).toBe(onDesktop.fingerprint);
  });
});

describe('nothing else of the report changes', () => {
  it('the earlier (1.0) fingerprint of the phone after the app has been closed is the base\'s', async () => {
    const nextDay = await download(relaunch(await phoneAddsTheDrawing()));
    const asOnTheBase = nextDay.map(document => {
      const { keptPageIndex: _kept, ...rest } = document as ReferenceDocument & { keptPageIndex?: unknown };
      return rest as ReferenceDocument;
    });
    expect(phone(nextDay).earlierVersion).toBe(phone(asOnTheBase).earlierVersion);
  });

  it('the Reports screen hands the report its documents as before and cites the drawings from what the device kept', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const screen: string = require('fs').readFileSync(require('path').resolve(__dirname, '../../screens/ReportsScreen.tsx'), 'utf8');
    expect(screen).toContain('referenceDocuments: referenceDocuments && withoutKeptPageIndexes(referenceDocuments),');
    expect(screen).toContain('drawingDocuments: referenceDocuments,');
  });

  it('what the phone keeps is only the part of the index a citation is read from', async () => {
    const [kept] = relaunch([DRAWING_AS_READ]) as Array<ReferenceDocument & { keptPageIndex?: any }>;
    expect(kept.extractedPages).toEqual([]);
    expect(kept.extractedText ?? null).toBeNull();
    expect(kept.keptPageIndex?.pages?.flatMap((page: any) => page.regions.map((region: any) => region.id))).toEqual(['region-lot']);
  });
});
