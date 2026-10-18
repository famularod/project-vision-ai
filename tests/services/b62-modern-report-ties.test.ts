/** 7.20: synthetic permutation controls through the actual modern recipe and PM writer. */
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []) } }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, buildDAVELegacyReportSourceFingerprint, enhanceDAVEReportDraft } from '../../services/DAVEReportIntelligence';
import { buildDailyProjectUpdate } from '../../services/PIEReporter';
import { buildDAVEReportSnapshot, reportSnapshotToSave, sameReportSource, markReportSnapshotDelivered, otherDeviceSendNotReceived } from '../../services/DAVEReportSnapshot';
import { buildDAVEProjectTruth, daveProjectTruthAsBuilt } from '../../services/DAVEProjectTruth';
import { buildDAVEWebReportSource } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import type { ScheduleItem, ProjectUpdate } from '../../types';
const NOW = '2026-10-17T12:00:00.000Z';
const task = (id: string, taskName = 'Paint wall', locationName = 'Roof') => ({ id, taskName, locationName, projectName: 'Tower', scheduleProjectName: 'Tower', startDate: '10/01/2026', finishDate: '10/20/2026', milestone: '', owner: '', contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '', createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' }) as ScheduleItem;
const comparison = { status: 'analysis_complete', title: 'Photo comparison', summary: 'Paint wall Roof', visibleChange: 'Paint wall Roof', location: 'Roof', comparisonConfidence: 'high', captureLimitations: [], projectProgress: 'supported', repeatPhotoGuidance: null, authorityMessage: '', currentObservation: 'Paint wall Roof', changedFromPrior: 'Primer applied.', priorUpdateUsed: 'prior', comparability: 'strong', provenance: 'visual_only', userReview: 'confirmed', assessmentDisposition: 'finding', findings: [{ findingType: 'added', description: 'Primer' }] };
const photo = (id: string) => ({ id, uri: `file:///synthetic/${id}.jpg`, caption: 'Paint wall Roof', category: 'Progress', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open', selectedAreaName: 'Roof', photoIntelligence: comparison });
const update = (id: string, photos: unknown[] = [], notes = 'Paint wall Roof') => ({ id, projectName: 'Tower', scheduleProjectName: 'Tower', date: '2026-10-16T12:00:00.000Z', photos, notes, status: 'sent', recipients: { contactIds: [] }, selectedAreaName: 'Roof' }) as ProjectUpdate;
function open(items: ScheduleItem[], updates: ProjectUpdate[]) {
 const truths = buildDAVEReportProjectTruths({ projects: [{ name: 'Tower', projectId: 'report:tower' }], projectRecords: [{ name: 'Tower' }] as never, scheduleItems: items, knownScheduleItems: items, knownScheduleDocuments: [], updates, projectAreas: [], referenceDocuments: [], now: NOW });
 const fingerprint = buildDAVEReportSourceFingerprint(truths);
 const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: ['Tower'], previousSnapshot: null, scheduleItems: items });
 const draft = buildDailyProjectUpdate({ selectedProjectNames: ['Tower'], savedUpdates: updates, scheduleItems: items, knownScheduleItems: items } as never);
 const body = enhanceDAVEReportDraft(draft, briefing, 'project_manager').body;
 const snapshot = buildDAVEReportSnapshot({ truths, scopeKey: 'tower', sourceFingerprint: fingerprint, capturedAt: NOW, reportFormat: 'project_manager' });
 return { truths, fingerprint, body, snapshot, legacy: buildDAVELegacyReportSourceFingerprint(truths) };
}
const permutations = <T,>(a: T[]): T[][] => a.length < 2 ? [a] : a.flatMap((v, i) => permutations(a.filter((_, j) => i !== j)).map(rest => [v, ...rest]));
function invariant(items: ScheduleItem[], updates: ProjectUpdate[]) {
 const before = open(items, updates);
 for (const order of permutations(items)) {
  const after = open(order, updates);
  expect(after.body).toEqual(before.body);
  expect(after.fingerprint).toEqual(before.fingerprint);
  expect(reportSnapshotToSave(after.snapshot, before.snapshot)).toBeNull();
 }
}
beforeAll(() => { jest.useFakeTimers({ now: Date.parse(NOW) }); });
afterAll(() => jest.useRealTimers());
it('duplicate task names on the same due day do not exchange evidence survivor identity', () => invariant([task('b'), task('a'), task('c', 'Inspect roof')], []));
it('an unlinked confirmed photo matching two tasks equally does not exchange task identity', () => invariant([task('b'), task('a'), task('c', 'Inspect roof')], [update('u', [photo('p')])]));
it('unlinked plain-note equal matches are harmless when only omitted links differ', () => invariant([task('b', 'Paint wall north'), task('a', 'Paint wall south')], [update('u', [], 'Paint wall')]));
it('identical photo descriptions retain the same survivor across task and update arrival permutations', () => {
 const items = [task('b', 'Paint wall north'), task('a', 'Paint wall south')];
 const updates = [update('u-b', [photo('p-b')]), update('u-a', [photo('p-a')])];
 const before = open(items, updates);
 for (const updateOrder of permutations(updates)) for (const itemOrder of permutations(items)) {
  const after = open(itemOrder, updateOrder);
  expect(after.body).toEqual(before.body); expect(after.fingerprint).toEqual(before.fingerprint);
  expect(reportSnapshotToSave(after.snapshot, before.snapshot)).toBeNull();
 }
});
it('real notes, photo content and explicit task link changes still invalidate approval', () => {
 const items = [task('b', 'Paint wall north'), task('a', 'Paint wall south')];
 const original = update('u', [photo('p')]); const before = open(items, [original]);
 for (const changed of [{ ...original, notes: 'Roof flashing was damaged.' }, { ...original, photos: [{ ...photo('p'), caption: 'Roof flashing damaged.' }] }, { ...original, scheduleItemId: 'a' }, { ...original, scheduleItemId: 'b' }]) {
  const after = open(items, [changed] as ProjectUpdate[]);
  expect(sameReportSource(before.fingerprint, after.fingerprint)).toBe(false);
  expect(reportSnapshotToSave(after.snapshot, before.snapshot)).not.toBeNull();
 }
});

it('keeps raw 1.0 truth and fingerprint in each original arrival order', () => {
 for (const items of permutations([task('b'), task('a'), task('c', 'Inspect roof')])) {
  const updates = [update('u', [photo('p')])];
  const modern = open(items, updates);
  const raw = buildDAVEProjectTruth({ projectId: 'report:tower', projectName: 'Tower', scheduleItems: items, knownScheduleItems: items, knownScheduleDocuments: [], reportLookaheadReplacement: true, updates, projectAreas: [], referenceDocuments: [], now: NOW });
  expect(daveProjectTruthAsBuilt(modern.truths[0])).toEqual(raw);
  expect(modern.legacy).toBe(buildDAVELegacyReportSourceFingerprint([raw]));
 }
});
it('isolated identical-description photo survivor already follows authored update order', () => {
 const items = [task('a', 'Paint wall')];
 const updates = [update('u-b', [photo('p-b')]), update('u-a', [photo('p-a')])];
 const before = open(items, updates);
 const after = open(items, [...updates].reverse());
 expect(after.body).toBe(before.body); expect(after.fingerprint).toBe(before.fingerprint);
 expect(after.truths[0].evidence.records.filter(r => r.kind === 'photo')).toEqual(before.truths[0].evidence.records.filter(r => r.kind === 'photo'));
});
it('retained delivered 3.0 receipt stays current on desktop after a task-only permutation', () => {
 const items = [task('b'), task('a')]; const updates = [update('u', [photo('p')])];
 const before = open(items, updates);
 const sent = markReportSnapshotDelivered(before.snapshot, NOW, 'synthetic-phone');
 for (const order of permutations(items)) {
  const snapshot = { projects: [{ id: 'report:tower', name: 'Tower' }], scheduleItems: order, knownScheduleItems: order, projectUpdates: updates.map(updateData => ({ id: updateData.id, updateData })), referenceDocuments: [], refreshedAt: NOW } as unknown as DAVEWebReadOnlySnapshot;
  const source = buildDAVEWebReportSource(snapshot, 'Tower');
  expect(sameReportSource(sent.sourceFingerprint, source.fingerprint)).toBe(true);
  expect(otherDeviceSendNotReceived({ period: sent, currentFingerprint: source.fingerprint, ownSends: new Set(), pulledAt: NOW })).toBeNull();
 }
});
