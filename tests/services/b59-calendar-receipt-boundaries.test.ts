jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []),
} }));
jest.mock('../../services/DAVEWebSupabaseClient', () => ({ daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() } }));
import { buildRuntime } from '../../services/PIERuntime';
import { fieldUpdateChronologyDate } from '../../services/FieldUpdateChronology';
import { buildPhotoProgress } from '../../services/PIEPhotoProgress';
import { buildWrittenReportFacts } from '../../services/ReportWrittenFacts';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import { buildDAVEReportSourceFingerprint, buildDAVELegacyReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportSnapshot, markReportSnapshotDelivered } from '../../services/DAVEReportSnapshot';
import { daveWebReportAlreadySentElsewhereAt } from '../../services/DAVEWebReportPeriod';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import type { ProjectUpdate } from '../../types';
const NOW = '2026-10-17T23:00:00Z';
const GOOD = 'Roof membrane was installed.';
const OLD = 'Roof flashing was installed.';
function update(id: string, date: string, tap: string, notes: string): ProjectUpdate {
  return { id, date, status: 'sent', projectName: 'Tower', scheduleProjectName: 'Tower', selectedAreaName: 'Roof',
    notes, photos: [], recipients: { contactIds: [] }, workflowTimestamps: { sendTappedAt: tap } } as ProjectUpdate;
}
const runtime = (updates: ProjectUpdate[]) => buildRuntime({ projectName: 'Tower', projectNames: ['Tower'], surface: 'reports', reportType: 'daily_project_update',
  updates, scheduleItems: [], knownScheduleItems: [], currentUpdate: null, projectAreas: [], contacts: { contacts: [] }, referenceDocuments: [] } as never);
const nativeTruths = (updates: ProjectUpdate[]) => buildDAVEReportProjectTruths({ projects: [{ name: 'Tower', projectId: 'tower' }], projectRecords: [{ name: 'Tower' }],
  updates, scheduleItems: [], knownScheduleItems: [], knownScheduleDocuments: [], projectAreas: [], referenceDocuments: [], now: NOW } as never);
beforeEach(() => jest.useFakeTimers({ now: Date.parse(NOW) }));
afterEach(() => jest.useRealTimers());

it.each([
  ['2026-02-29T23:00:00Z', '2026-03-01T12:00:00Z'],
  ['2026-02-30T23:00:00Z', '2026-03-01T12:00:00Z'],
  ['2026-04-31T23:00:00Z', '2026-04-30T12:00:00Z'],
  ['2100-02-29T23:00:00Z', '2100-03-01T12:00:00Z'],
  ['2026-02-30T23:00:00-07:00', '2026-03-02T12:00:00Z'],
])('nonexistent calendar tap %s cannot replace real Latest note/photo in the runtime and written report', (badTap, goodTap) => {
  const good = update('early-start', '2026-02-15', goodTap, GOOD), bad = update('late-start', '2026-02-01', badTap, OLD);
  for (const row of [good, bad]) row.photos = [{ id: `photo-${row.id}`, uri: `file:///synthetic-${row.id}.jpg`, caption: row.id === good.id ? 'Membrane photo' : 'Old flashing photo',
    category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open', selectedAreaName: 'Roof' }] as ProjectUpdate['photos'];
  const before = JSON.stringify([good, bad]);
  for (const rows of [[good, bad], [bad, good]]) {
    const result = runtime(rows);
    expect(result.fusedEvidence.intelligentSummary.whatChanged).toContain(`Latest update: ${GOOD}`);
    expect(result.fusedEvidence.intelligentSummary.whatChanged).toContain('Latest photo: Membrane photo');
    expect(result.response.reportDraft.body).toContain(`Latest update: ${GOOD}`);
  }
  expect(fieldUpdateChronologyDate(bad)).toBe(bad.date);
  expect(JSON.stringify([good, bad])).toBe(before);
});

it.each([
  '2024-02-29T23:00:00Z', '2000-02-29T12:30:00.123Z', '2026-04-30T23:59:59Z',
  '2026-01-31T00:00:00+14:00', '2026-03-01T00:00:00-07:00', '2026-02-28T24:00:00Z',
])('a real leap/month-end/offset or accepted end-of-day tap %s remains authoritative', tap => {
  const sent = update('valid-send', '1999-01-01', tap, GOOD);
  expect(fieldUpdateChronologyDate(sent)).toBe(tap);
  const earlier = { ...update('other', '1999-01-02', '1999-01-02T10:00:00Z', OLD) };
  expect(runtime([earlier, sent]).response.reportDraft.body).toContain(`Latest update: ${GOOD}`);
});

function confirmedUpdates(): ProjectUpdate[] {
  const photo = (id: string, summary: string) => ({ id, uri: `file:///synthetic-${id}.jpg`, caption: summary, category: 'Update', selectedAreaName: 'Roof',
    locationCapturedAt: '2026-10-17T10:00:00Z', photoIntelligence: {
      status: 'analysis_complete', title: 'Possible visible changes', summary, visibleChange: summary, location: 'Roof', comparisonConfidence: 'medium', comparability: 'strong',
      captureLimitations: [], projectProgress: 'unable_to_determine', assessmentDisposition: 'finding', repeatPhotoGuidance: null, authorityMessage: 'Visual observation only.',
      findings: [{ findingType: 'added', description: summary, objectName: 'material', baselineState: 'not visible', currentState: 'visible', location: 'roof', confidence: 0.9,
        limitations: [], evidenceRegions: [], source: 'structured_provider' }], priorUpdateUsed: null, priorEvidenceId: 'evidence-prior', provenance: 'visual_only',
      userReview: 'confirmed', userReviewedAt: NOW, diagnostics: { selectedPriorPhotoId: 'prior' }, updatedAt: NOW,
    } });
  const a = { ...update('early-start', '2026-10-15', '2026-10-17T22:00:00Z', GOOD), photos: [photo('newer-send', 'Roof membrane has been installed.')] };
  const b = { ...update('late-start', '2026-10-17', '2026-10-17T19:00:00Z', OLD), photos: [photo('older-send', 'Roof flashing has been installed.')] };
  const prior = { ...update('prior-update', '2026-10-14', '2026-10-14T10:00:00Z', 'Prior roof condition.'), photos: [{ id: 'prior', uri: 'file:///synthetic-prior.jpg', caption: 'Prior roof', category: 'Update', locationCapturedAt: '2026-10-14T10:00:00Z' }] };
  return [a, b, prior] as unknown as ProjectUpdate[];
}
async function downloaded(updates: ProjectUpdate[]) {
  const raw = { projects: [{ id: 'tower', name: 'Tower', archived: false }], scheduleItems: [], referenceDocuments: [], syncTombstones: [],
    projectUpdates: [...updates].reverse().map(u => ({ id: u.id, project_name: 'Tower', update_data: { ...u, status: 'queued' }, created_at: NOW, updated_at: NOW })) };
  const before = JSON.stringify(raw);
  jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue(raw as never);
  const snapshot = await loadDAVEWebReadOnlySnapshot();
  expect(JSON.stringify(raw)).toBe(before);
  expect(snapshot.projectUpdates.every(u => u.updateData.status === 'queued')).toBe(true);
  return snapshot;
}

it('the final actual written-facts consumer retains acknowledged cloud provenance for a confirmed comparison', async () => {
  const updates = confirmedUpdates(), before = JSON.stringify(updates);
  expect(buildPhotoProgress({ projectName: 'Tower', updates, now: new Date(NOW) }).acceptedEvidence).toHaveLength(2);
  const native = nativeTruths(updates), cloudSnapshot = await downloaded(updates), cloud = buildDAVEWebReportTruths(cloudSnapshot, null);
  expect(native[0].writtenReportFacts?.quotedComparison?.photoId).toBe('newer-send');
  expect(cloud[0].writtenReportFacts?.quotedComparison?.photoId).toBe('newer-send');
  expect(JSON.stringify(updates)).toBe(before);
});

it('equivalent confirmed comparisons recognize the native sent snapshot through the real web source predicate', async () => {
  const updates = confirmedUpdates(), native = nativeTruths(updates), snapshot = await downloaded(updates), before = JSON.stringify(snapshot);
  const source = buildDAVEReportSourceFingerprint(native), cloudSource = buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(snapshot, null));
  const sent = markReportSnapshotDelivered(buildDAVEReportSnapshot({ truths: native, scopeKey: 'tower', sourceFingerprint: source, capturedAt: NOW, reportFormat: 'project_manager' }), NOW, 'synthetic-phone');
  expect(daveWebReportAlreadySentElsewhereAt(sent, cloudSource, new Set())).toBe(NOW);
  expect(cloudSource).toBe(source);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('local queued comparisons retain legacy ordering and their raw legacy fingerprint is stable', () => {
  const updates = confirmedUpdates().map(u => ({ ...u, status: 'queued' as const })), before = JSON.stringify(updates);
  const facts = buildWrittenReportFacts({ projectName: 'Tower', updates, scheduleItems: [], now: NOW });
  expect(facts.quotedComparison?.photoId).toBe('older-send');
  const raw = buildDAVELegacyReportSourceFingerprint(nativeTruths(updates));
  expect(buildDAVELegacyReportSourceFingerprint(nativeTruths(updates))).toBe(raw);
  expect(JSON.stringify(updates)).toBe(before);
});
