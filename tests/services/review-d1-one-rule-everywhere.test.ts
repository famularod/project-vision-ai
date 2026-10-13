/**
 * Review of D1 (independent review P5, pass 1), L1, L10 and L13: every list
 * and count of shared documents uses the one rule (owner answer Q44: an
 * archived compliance document is hidden on every device and kept in the
 * cloud).
 *
 * - the rule itself, and that it hands back the very same list when nothing
 *   in it is archived;
 * - the phone's own cards follow the mark, so the places that list cards by
 *   their own "archived" follow it too (L13);
 * - reports (L10): an archived document is not counted, and a report's
 *   fingerprint is exactly what it was for an owner who has archived nothing,
 *   on the phone's recipe and on the web's.
 */
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildDAVEWebReportSource, buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { sharedDocumentCardChange, sharedDocumentsListed, withArchivedProjectDocumentsRestored } from '../../services/SharedDocumentArchive';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

const NOW = '2026-10-06T12:00:00.000Z';
const ALPHA_ID = '5f0c2a9e-1b1d-4c55-9a53-0d6f2c7c1a10';
const tasks = (normalizeScheduleImport({
  contents: ['Task,Project,Area,Start,Finish,Percent Complete', 'Survey,Alpha,Lot,09/14/2026,09/21/2026,', 'Paint,Alpha,Deck,10/01/2026,10/16/2026,35'].join('\n'),
  sourceName: 'm.csv', mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date('2026-10-05T12:00:00.000Z'),
}).items as ScheduleItem[]).map(item => ({ ...item, id: `M-${item.taskName.replace(/\W+/g, '-')}` }));
const UPDATES = [{
  id: 'u1', projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-10-05T15:00:00.000Z', photos: [], recipients: { contactIds: [] },
  notes: 'Survey stakes set.', scheduleItemId: 'M-Survey', selectedAreaName: 'Lot',
}] as unknown as ProjectUpdate[];
const shared = (id: string, more: Partial<ReferenceDocument>): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.pdf`, uri: '', mimeType: 'application/pdf', category: 'Drawings', notes: '', isCurrent: true,
  importedAt: '2026-10-01T10:00:00.000Z', projectId: ALPHA_ID, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: null,
  storagePath: `owner-a/${id}.pdf`, sizeBytes: 1024, contentSha256: null, updatedAt: '2026-10-01T10:00:00.000Z', ...more,
} as ReferenceDocument);
const DOCUMENTS = [
  shared('drawing-a101', { name: 'A-101 Site plan' }),
  shared('permit', { name: 'Grading permit', category: 'Permit Card', isCurrent: false }),
  shared('contract', { name: 'Site contract', category: 'Contract', isCurrent: true }),
];
const NOTHING = new Set<string>();
/** As the phone's Reports screen scopes them: by the project's name (it gives the recipe names, not cloud ids). */
const PHONE_DOCUMENTS = DOCUMENTS.map(document => ({ ...document, projectId: null }));

/** The phone's Reports screen recipe (screens/ReportsScreen.tsx), fed the list the screen hands it. */
const phoneTruths = (documents: readonly ReferenceDocument[]) => buildDAVEReportProjectTruths({
  projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: UPDATES, scheduleItems: tasks,
  knownScheduleItems: tasks, knownScheduleDocuments: PHONE_DOCUMENTS, projectAreas: [], referenceDocuments: documents, now: NOW,
});
const webSnapshot = (archivedDocumentIds?: readonly string[]): DAVEWebReadOnlySnapshot => ({
  projects: [{ id: ALPHA_ID, name: 'Alpha' }], scheduleItems: tasks, knownScheduleItems: tasks,
  projectUpdates: UPDATES.map(entry => ({ id: entry.id, updateData: entry })), referenceDocuments: DOCUMENTS, refreshedAt: NOW,
  ...(archivedDocumentIds ? { archivedDocumentIds } : {}),
}) as unknown as DAVEWebReadOnlySnapshot;
const documentIdsIn = (truths: ReturnType<typeof phoneTruths>) => JSON.stringify(truths).match(/"(drawing-a101|permit|contract)"/g) ?? [];

describe('the one rule for a list or a count of shared documents', () => {
  it('leaves out the ones the device knows are archived', () => {
    expect(sharedDocumentsListed(DOCUMENTS, new Set(['permit'])).map(document => document.id)).toEqual(['drawing-a101', 'contract']);
  });

  it('hands back the very same list when nothing in it is archived', () => {
    expect(sharedDocumentsListed(DOCUMENTS, NOTHING)).toBe(DOCUMENTS);
    expect(sharedDocumentsListed(DOCUMENTS, new Set(['another-project-document']))).toBe(DOCUMENTS);
  });
});

describe('L13: the phone\'s own cards follow the mark', () => {
  const card = (id: string, more: Record<string, unknown> = {}) => ({ id, referenceDocumentId: id, isArchived: false, name: `${id}.pdf`, ...more });

  it('a card a backup brought back, for a document archived since, is put away; the others are untouched', () => {
    const cards = [card('permit'), card('drawing-a101'), card('linked', { id: 'card-7', referenceDocumentId: 'contract' })];
    const after = withArchivedProjectDocumentsRestored(cards, sharedDocumentCardChange([], new Set(['permit', 'contract'])), NOW);
    expect(after.map(item => `${item.id}:${item.isArchived}`)).toEqual(['permit:true', 'drawing-a101:false', 'card-7:true']);
    expect(after[0]).toMatchObject({ archivedAt: NOW, updatedAt: NOW });
    expect(after[1]).toBe(cards[1]);
  });

  it('cards that already follow are left exactly as they are (the same list comes back)', () => {
    const cards = [card('permit', { isArchived: true, archivedAt: '2026-10-05T10:00:00.000Z' }), card('drawing-a101')];
    expect(withArchivedProjectDocumentsRestored(cards, sharedDocumentCardChange([], new Set(['permit'])), NOW)).toBe(cards);
    expect(withArchivedProjectDocumentsRestored(cards, sharedDocumentCardChange([], NOTHING), NOW)).toBe(cards);
  });

  it('a card archived on this phone alone (no mark in the cloud) is not brought back by it', () => {
    const cards = [card('old', { isArchived: true })];
    expect(withArchivedProjectDocumentsRestored(cards, sharedDocumentCardChange([], new Set(['permit'])), NOW)).toBe(cards);
  });

  it('a card being restored is never put away by the same call, whatever the device knew a moment before', () => {
    const cards = [card('permit', { isArchived: true })];
    const after = withArchivedProjectDocumentsRestored(cards, sharedDocumentCardChange(['permit'], new Set(['permit'])), NOW);
    expect(after[0].isArchived).toBe(false);
  });

  it('a plain list of ids still only restores, as before', () => {
    const cards = [card('permit', { isArchived: true }), card('contract')];
    expect(withArchivedProjectDocumentsRestored(cards, ['permit'], NOW).map(item => item.isArchived)).toEqual([false, false]);
  });
});

describe('L10: reports and an archived document', () => {
  it('the phone: with nothing archived the report is handed the very same list, and its fingerprint is what it was', () => {
    const before = buildDAVEReportSourceFingerprint(phoneTruths(PHONE_DOCUMENTS)); // the recipe fed every document, as before this change
    const handed = sharedDocumentsListed(PHONE_DOCUMENTS, NOTHING);
    expect(handed).toBe(PHONE_DOCUMENTS);
    expect(buildDAVEReportSourceFingerprint(phoneTruths(handed))).toBe(before);
    expect(before).toMatch(/^dave-report-source\/\d+\.\d+:[0-9a-f]{8}$/);
  });

  it('the phone: an archived document is not counted in the report\'s truth; the others still are', () => {
    expect(documentIdsIn(phoneTruths(PHONE_DOCUMENTS))).toContain('"contract"');
    const truths = phoneTruths(sharedDocumentsListed(PHONE_DOCUMENTS, new Set(['contract'])));
    expect(documentIdsIn(truths)).not.toContain('"contract"');
    expect(documentIdsIn(truths)).toContain('"drawing-a101"');
    expect(buildDAVEReportSourceFingerprint(truths)).not.toBe(buildDAVEReportSourceFingerprint(phoneTruths(PHONE_DOCUMENTS)));
  });

  it('the web: with nothing archived (no list of marks, or an empty one) the fingerprint is what it was', () => {
    // What the web's recipe gave before this change: every document of the snapshot.
    const before = buildDAVEReportSourceFingerprint(buildDAVEReportProjectTruths({
      projects: [{ name: 'Alpha', projectId: ALPHA_ID }], projectRecords: [{ id: ALPHA_ID, name: 'Alpha' }] as never, updates: UPDATES,
      scheduleItems: tasks, knownScheduleItems: tasks, knownScheduleDocuments: DOCUMENTS, referenceDocuments: DOCUMENTS, now: NOW,
    }));
    expect(buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(webSnapshot(), null))).toBe(before);
    expect(buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(webSnapshot([]), null))).toBe(before);
    expect(buildDAVEWebReportSource(webSnapshot([]), null)).toEqual(buildDAVEWebReportSource(webSnapshot(), null));
  });

  it('the web: a document the cloud marks archived is not counted in the report\'s truth', () => {
    expect(documentIdsIn(buildDAVEWebReportTruths(webSnapshot(), null))).toContain('"contract"');
    const truths = buildDAVEWebReportTruths(webSnapshot(['contract']), null);
    expect(documentIdsIn(truths)).not.toContain('"contract"');
    expect(documentIdsIn(truths)).toContain('"drawing-a101"');
  });
});
