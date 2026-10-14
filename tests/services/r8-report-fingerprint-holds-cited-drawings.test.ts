/**
 * R8 item 2 (the coordinator's decision on review pass 2, P2-2; High, caused
 * by R7 item C).
 *
 * For a work area a report shows an excerpt of the project's current drawing,
 * labelled like "A-201 Site plan · Rev C · Page 1". It is on the Reports
 * screen, it goes into the Word and Outlook reports, and Approve saves it
 * with the report. R7 item C left of every document only "what a report can
 * say" in the fingerprint and missed that the report cites drawings by its
 * own road: a drawing's revision could be corrected, the drawing superseded,
 * its pages arrive or the area be found on another page, and the app still
 * said "the report already sent" while the report cited something else.
 *
 * The decision: version 2.0 of the fingerprint holds exactly what a report
 * says and saves of a drawing (the citation as printed and saved), and still
 * nothing that belongs to a device. Where two devices cite differently for
 * the same saved project, their reports differ and so do their fingerprints.
 *
 * The phone's own document normalizer, the web's own loader over the cloud's
 * rows as the upload cuts them down, the one report recipe, the screen's own
 * citation function and the snapshot Approve saves. Synthetic data.
 */
import { compactECOSDocumentIndexForCloud, compactECOSReferenceDocumentsForOperationalRead, referenceDocumentsCitedAsListed } from '../../services/ECOSDocumentIndexPersistence';
import { buildDAVELegacyReportSourceFingerprint, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import {
  buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportSnapshotToSave, type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import { loadDAVEWebReadOnlySnapshot, type DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import { buildAutomaticReportDrawingReferences } from '../../services/ReportDrawingReferences';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
const mockCloud: { rows: unknown } = { rows: null };
jest.mock('../../services/DAVEWebSupabaseClient', () => ({ daveWebSupabaseGateway: { loadAuthorizedRows: async () => mockCloud.rows } }));

const NOW = '2026-10-01T18:00:00.000Z';
const IMPORTED = '2026-09-20T15:00:00.000Z';
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const ITEMS: ScheduleItem[] = (normalizeScheduleImport({
  contents: ['Task,Project,Area,Start,Finish,Percent Complete', 'Paint,Alpha,Lot,10/05/2026,10/09/2026,', 'Drywall,Alpha,Lot,10/01/2026,10/04/2026,'].join('\n'),
  sourceName: 'MASTER M1.csv', mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(IMPORTED),
}).items as ScheduleItem[]).map((item, index) => ({
  ...item, id: `m1-${index + 1}`, importBatchId: 'batch-m1', sourceDocumentId: 'doc-m1', projectControls: normalizeProjectControls(undefined), activity: [],
} as ScheduleItem));
const SCHEDULE = normalizeReferenceDocument({
  id: 'doc-m1', name: 'MASTER M1', originalFileName: 'MASTER M1.csv', category: 'Schedules', notes: '', isCurrent: true, importedAt: IMPORTED,
  projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: 'batch-m1', uri: '',
} as Partial<ReferenceDocument>);
const REGION = { id: 'region-lot', label: 'Lot', areaNames: ['Lot'], confidence: 0.95, x: 0.1, y: 0.1, width: 0.4, height: 0.3 };
const PAGE = { pageNumber: 1, sheetNumber: null, text: 'SITE PLAN - LOT', regions: [REGION] };
/** A current drawing of the project, read and indexed on this phone: where the Lot is on it is known. */
const DRAWING = normalizeReferenceDocument({
  id: 'doc-a201', name: 'A-201 Site plan', originalFileName: 'A-201 Site plan.pdf', category: 'Plans', notes: '', isCurrent: true, importedAt: '2026-09-21T15:00:00.000Z',
  projectName: 'Alpha', projectNames: ['Alpha'], uri: 'file:///var/mobile/Containers/Data/Application/AAAA-PHONE/Documents/project-documents/doc-a201.pdf', mimeType: 'application/pdf',
  storagePath: 'owner-1/doc-a201/A-201.pdf', sourceProvider: 'supabase_storage',
  drawingNumber: 'A-201', drawingRevision: 'C', drawingDiscipline: 'Architectural', drawingStatus: 'For Construction', drawingIssuedAt: '2026-09-18',
  extractionStatus: 'complete', extractionMethod: 'embedded_text', extractedText: 'SITE PLAN - LOT', extractedPages: [PAGE],
} as unknown as Partial<ReferenceDocument>);
const withDrawing = (change: Record<string, unknown>): ReferenceDocument[] => [SCHEDULE, { ...DRAWING, ...change } as ReferenceDocument];
const SHOWN = selectAuthoritativeScheduleItems({ scheduleItems: ITEMS, scheduleDocuments: [SCHEDULE] }) as ScheduleItem[];
const SCOPE = daveReportSnapshotScopeKey(['Alpha']);

/** The phone's Reports screen for these documents: the fingerprint, what the report cites (the screen's own function), and the report as Approve saves it. */
function reports(documents: ReferenceDocument[]) {
  const truths = buildDAVEReportProjectTruths({
    projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: SHOWN,
    knownScheduleItems: ITEMS, knownScheduleDocuments: [SCHEDULE], projectAreas: [], referenceDocuments: documents, now: NOW,
  });
  const fingerprint = buildDAVEReportSourceFingerprint(truths);
  const references = buildAutomaticReportDrawingReferences({ documents, scheduleItems: SHOWN, selectedProjectNames: ['Alpha'] });
  const snapshot = buildDAVEReportSnapshot({
    truths, scopeKey: SCOPE, sourceFingerprint: fingerprint, capturedAt: NOW, reportFormat: 'project_manager',
    sourceReferences: references.map(reference => ({ ...reference.citation, projectName: reference.projectName, areaName: reference.areaName })),
  });
  return {
    truths, fingerprint, snapshot, earlierVersion: buildDAVELegacyReportSourceFingerprint(truths),
    cites: references.map(reference => `${reference.areaName}: ${reference.citation.label}`),
    saved: snapshot.sourceReferences ?? [],
  };
}
/** A report is sent with `before`; the documents become `after`: whether the app takes the report on screen for the one sent. */
function alreadySent(before: ReferenceDocument[], after: ReferenceDocument[]): boolean {
  const sent = markReportSnapshotDelivered({ ...reports(before).snapshot, deliveredAt: null } as DAVEReportSnapshot, NOW, 'phone-install');
  return reportSnapshotToSave(reports(after).snapshot, sent) === null;
}
/** What the web has downloaded of the same saved project, through its own loader, the document's row as the upload cuts it down. */
async function webSnapshot(documents: ReferenceDocument[], asUploaded: (document: ReferenceDocument) => ReferenceDocument = compactECOSDocumentIndexForCloud): Promise<DAVEWebReadOnlySnapshot> {
  mockCloud.rows = {
    projects: [{ id: 'project-alpha-id', name: 'Alpha', archived: false, created_at: IMPORTED, updated_at: IMPORTED, owner_id: 'owner-1', project_data: null }],
    scheduleItems: [...ITEMS].reverse().map(item => ({ id: item.id, item_data: json(item), created_at: IMPORTED, updated_at: '2026-09-20T15:01:00.000Z' })),
    projectUpdates: [], syncTombstones: [],
    referenceDocuments: documents.map(document => {
      const { cloudUpdatedAt: _seen, cloudDetailsSeen: _details, ...sent } = asUploaded(document) as ReferenceDocument & Record<string, unknown>;
      return { id: document.id, name: document.name, category: document.category, document_data: json(sent), updated_at: '2026-09-21T15:02:00.000Z' };
    }),
  };
  return { ...(await loadDAVEWebReadOnlySnapshot()), refreshedAt: NOW };
}

describe('R8 item 2: the drawings a report cites are in its fingerprint, as they are printed and saved', () => {
  it('(the rig) the report cites the indexed current drawing for the area; Approve saves that citation, and the report\'s truth holds the very same', () => {
    const report = reports([SCHEDULE, DRAWING]);
    expect(report.cites).toEqual(['Lot: A-201 Site plan · Rev C · Page 1']);
    const citation = { documentId: 'doc-a201', documentName: 'A-201 Site plan', revision: 'C', pageNumber: 1, sheetNumber: null, regionId: 'region-lot', label: 'A-201 Site plan · Rev C · Page 1', projectName: 'Alpha', areaName: 'Lot' };
    expect(report.saved).toEqual([citation]);
    expect(report.truths[0].drawingCitations).toEqual([citation]);
    // A project with no drawing to cite has nothing of the kind.
    expect('drawingCitations' in reports([SCHEDULE]).truths[0]).toBe(false);
  });

  it.each([
    ['its revision is corrected from C to D in its details', { drawingRevision: 'D' }, ['Lot: A-201 Site plan · Rev D · Page 1']],
    ['it is marked Superseded', { drawingStatus: 'Superseded' }, []],
    ['it is no longer the current drawing', { isCurrent: false }, []],
    ['it is read again and the Lot is now found on another page', { extractedPages: [{ ...PAGE, pageNumber: 2 }] }, ['Lot: A-201 Site plan · Rev C · Page 2']],
    ['the sheet number of that page is read', { extractedPages: [{ ...PAGE, sheetNumber: 'A-201' }] }, ['Lot: A-201 Site plan · Rev C · Sheet A-201']],
    ['it is renamed', { name: 'A-201 Site plan (issued)' }, ['Lot: A-201 Site plan (issued) · Rev C · Page 1']],
    ['the reading no longer finds the Lot with enough confidence', { extractedPages: [{ ...PAGE, regions: [{ ...REGION, confidence: 0.5 }] }] }, []],
  ])('one thing about the cited drawing changes after the report is sent (%s): the report cites something else, and it is another report', (_what, change, cites) => {
    const sent = reports([SCHEDULE, DRAWING]);
    const now = reports(withDrawing(change));
    expect(now.cites).toEqual(cites);
    expect(now.fingerprint).not.toBe(sent.fingerprint);
    // (It read "already sent" while citing something else: review pass 2, P2-2.)
    expect(alreadySent([SCHEDULE, DRAWING], withDrawing(change))).toBe(false);
  });

  it('the other way: the drawing was still being read when the report was sent, and its pages arrive afterwards', () => {
    const stillReading = withDrawing({ extractionStatus: 'pending', extractedPages: [] });
    expect(reports(stillReading).cites).toEqual([]);
    expect(alreadySent(stillReading, [SCHEDULE, DRAWING])).toBe(false);
  });

  it('guard: a new revision filed as a new document, the old one no longer current: another report', () => {
    const revised = [SCHEDULE, { ...DRAWING, isCurrent: false } as ReferenceDocument, { ...DRAWING, id: 'doc-a201-d', drawingRevision: 'D' } as ReferenceDocument];
    expect(reports(revised).cites).toEqual(['Lot: A-201 Site plan · Rev D · Page 1']);
    expect(alreadySent([SCHEDULE, DRAWING], revised)).toBe(false);
  });
});

describe('R8 item 2: and still nothing that belongs to a device', () => {
  it.each([
    ['where the file sits on this device', { uri: 'file:///var/mobile/Containers/Data/Application/BBBB-AFTER-UPDATE/Documents/project-documents/doc-a201.pdf' }],
    ['the device\'s note of the cloud row', { cloudUpdatedAt: '2026-09-30T09:00:00.000Z', cloudDetailsSeen: '2026-09-30T09:00:00.000Z' }],
    ['where the cloud keeps the file, its size and checksum', { storagePath: 'owner-1/doc-a201/another.pdf', sizeBytes: 204800 }],
    ['the text read out of the file', { extractedText: null }],
    ['the text of the page, and of the region the Lot was found in', { extractedPages: [{ ...PAGE, text: null, regions: [{ ...REGION, text: 'LOT', evidenceText: 'SITE PLAN - LOT' }] }] }],
    ['which reader read the file', { extractionMethod: 'embedded_text_and_ocr', extractionStatus: 'partial' }],
    ['drawing details the citation does not print', { drawingDiscipline: 'Civil', drawingIssuedAt: '2026-09-19' }],
  ])('%s: the same citation, the same fingerprint, and the report is the one already sent', (_what, change) => {
    const sent = reports([SCHEDULE, DRAWING]);
    const now = reports(withDrawing(change));
    expect(now.cites).toEqual(sent.cites);
    expect(now.saved).toEqual(sent.saved);
    expect(now.fingerprint).toBe(sent.fingerprint);
    expect(alreadySent([SCHEDULE, DRAWING], withDrawing(change))).toBe(true);
    // The truth a report is written from still holds none of it.
    expect(Object.keys(now.truths[0].intelligence.referenceDocuments.find(document => document.id === 'doc-a201') ?? {}).sort())
      .toEqual(['category', 'id', 'importedAt', 'isCurrent', 'name', 'notes', 'originalFileName', 'projectId', 'projectName', 'projectNames', 'uri']);
  });

  // HIGH item 1f (the final review's F1; the coordinator's decision: a report holds everything it prints in any of its
  // outputs). Where on the page the Lot is decides the excerpt the Word file and the Reports screen show. Since high item 3
  // every device cites a drawing from the list's own copy of its page index, so it is the same on each device (the next
  // case): it no longer belongs to a device, and it is held. (R8 item 2 kept it out as a device's own.) The citation as
  // printed does not change; the picture does.
  it('where on the page the Lot is: the same citation, another part of the page shown: another report', () => {
    const change = { extractedPages: [{ ...PAGE, regions: [{ ...REGION, x: 0.12, y: 0.08, width: 0.41, height: 0.29 }] }] };
    const sent = reports([SCHEDULE, DRAWING]);
    const now = reports(withDrawing(change));
    expect(now.cites).toEqual(sent.cites);
    expect(now.fingerprint).not.toBe(sent.fingerprint);
    expect(alreadySent([SCHEDULE, DRAWING], withDrawing(change))).toBe(false);
  });

  it('the phone and the web, the drawing\'s row as the upload cuts its page index down: the same citation and the same fingerprint', async () => {
    const snapshot = await webSnapshot([SCHEDULE, DRAWING]);
    // (the rig) The cloud's copy is not the phone's: no file path, the document's text emptied.
    const cloudCopy = snapshot.referenceDocuments.find(document => document.id === 'doc-a201') as ReferenceDocument;
    expect([cloudCopy.uri, cloudCopy.extractedText ?? null]).toEqual(['', null]);
    const web = buildDAVEWebReportTruths(snapshot, 'Alpha');
    const phone = reports([SCHEDULE, DRAWING]);
    // What the web's Word report cites, by the web's own call.
    const webCites = buildAutomaticReportDrawingReferences({ documents: [...snapshot.referenceDocuments], scheduleItems: [...snapshot.scheduleItems], selectedProjectNames: ['Alpha'] });
    expect(webCites.map(reference => `${reference.areaName}: ${reference.citation.label}`)).toEqual(phone.cites);
    expect(web[0].drawingCitations).toEqual(phone.truths[0].drawingCitations);
    expect(buildDAVEReportSourceFingerprint(web)).toBe(phone.fingerprint);
  });
});

describe('R8 item 2: the web\'s fingerprint holds what the web\'s Word report cites', () => {
  it('the Word report cites from every document downloaded, one the cloud marks archived too: the fingerprint holds that very citation', async () => {
    const snapshot = { ...(await webSnapshot([SCHEDULE, DRAWING])), archivedDocumentIds: ['doc-a201'] } as DAVEWebReadOnlySnapshot;
    // What the Word report cites, by the Reports page's own call.
    const word = buildAutomaticReportDrawingReferences({ documents: [...snapshot.referenceDocuments], scheduleItems: [...snapshot.scheduleItems], selectedProjectNames: ['Alpha'] });
    expect(word.map(reference => reference.citation.label)).toEqual(['A-201 Site plan · Rev C · Page 1']);
    const [truth] = buildDAVEWebReportTruths(snapshot, 'Alpha');
    expect(truth.drawingCitations?.map(citation => citation.label)).toEqual(['A-201 Site plan · Rev C · Page 1']);
    // (The archived document is not among the report's own documents: it is cited all the same, so it is held.)
    expect(truth.intelligence.referenceDocuments.map(document => document.id)).toEqual(['doc-m1']);
  });
});

describe('R8 item 2: where two devices cite differently for the same saved project, their fingerprints differ, as their reports do', () => {
  it('one phone, as its Reports screen cites: neither the drawing it has just read nor, after the next launch, anything; one report (high item 3 (c))', () => {
    // Until high item 3 (the owner's instruction of 13 Oct 2026) the session that read the file cited it and the next
    // launch did not, so the report was offered once more (review pass 3, P3-3). Now a report cites a drawing only from
    // the index the cloud's document list gives (h3c-cite-only-the-lists-copy), never from the device's own reading.
    const [nextLaunch] = compactECOSReferenceDocumentsForOperationalRead([DRAWING]);
    expect(nextLaunch.extractedPages).toEqual([]);
    const asTheScreenCites = (documents: ReferenceDocument[]) => referenceDocumentsCitedAsListed(documents);
    const read = reports(asTheScreenCites([SCHEDULE, DRAWING]));
    const relaunched = reports(asTheScreenCites([SCHEDULE, nextLaunch]));
    expect([read.cites, relaunched.cites]).toEqual([[], []]);
    expect(relaunched.fingerprint).toBe(read.fingerprint);
    expect(alreadySent(asTheScreenCites([SCHEDULE, DRAWING]), asTheScreenCites([SCHEDULE, nextLaunch]))).toBe(true);
  });

  it('the web, for a drawing whose row carries no page index (a Google Drive file): it cites nothing where the phone that read it cites the page', async () => {
    const withoutIndex = (document: ReferenceDocument) => ({ ...document, extractedText: null, extractedPages: [] }) as ReferenceDocument;
    const snapshot = await webSnapshot([SCHEDULE, DRAWING], withoutIndex);
    const web = buildDAVEWebReportTruths(snapshot, 'Alpha');
    expect('drawingCitations' in web[0]).toBe(false);
    expect(buildDAVEReportSourceFingerprint(web)).not.toBe(reports([SCHEDULE, DRAWING]).fingerprint);
    // And the same as a phone that holds no page index either.
    expect(buildDAVEReportSourceFingerprint(web)).toBe(reports([SCHEDULE, withoutIndex(DRAWING)]).fingerprint);
  });
});

describe('R8 item 2: version 1.0 is as it was', () => {
  it('the citations are in today\'s version only: the earlier version is worked out from the documents whole, as before', () => {
    const report = reports([SCHEDULE, DRAWING]);
    expect(report.earlierVersion).toBe(BEFORE_THIS_CHANGE);
  });
});

/** The 1.0 fingerprint the code before this change works out for this file's project with its drawing: printed there by this same rig. */
const BEFORE_THIS_CHANGE = 'dave-report-source/1.0:989f86ed';
