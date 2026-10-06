/**
 * R4 item 4a (the owner's open item: "task save order can reorder Current
 * Work lines, so a sync that only reorders makes Reports offer a fresh
 * report"). The report's facts are read in a stable order and fingerprinted
 * under a new version (2.0) that follows neither the order the tasks were
 * saved in nor the id each device files the project under. A report
 * approved, sent or saved under 1.0 is still known for the same facts, on
 * the phone and on the web, and never for other facts. Synthetic data.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';
import {
  buildDAVELegacyReportSourceFingerprint, buildDAVEReportBriefing, buildDAVEReportSourceFingerprint,
} from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import {
  buildDAVEReportSnapshot, daveReportSnapshotScopeKey, isLegacyReportSource, markReportSnapshotDelivered, otherDeviceSendNotReceived,
  reportBaselineSnapshot, reportSnapshotToSave, sameReportSource, type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { daveProjectTruthAsBuilt, type DAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEWebReportSource, buildDAVEWebReportTruths, daveWebReportSourceIsCurrent } from '../../services/DAVEWebOperations';
import { daveWebOwnReportSends, daveWebReportSentHereAt } from '../../services/DAVEWebReportSend';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { approvalReplacesUnsentApproval } from '../../services/ReportManualSend';

const NOW = '2026-09-08T12:00:00.000Z';
const LINES = [
  'Cleanup,Alpha,Lot,10/01/2026,10/08/2026,', 'Survey,Alpha,Lot,09/14/2026,09/21/2026,', 'Plumbing rough,Alpha,Lot,10/20/2026,10/30/2026,',
  'Electrical rough,Alpha,Lot,09/28/2026,10/03/2026,', 'Paint,Alpha,Deck,09/10/2026,09/16/2026,35', 'Drywall,Alpha,Lot,09/28/2026,10/03/2026,',
  'Framing,Alpha,Lot,09/09/2026,09/12/2026,', 'Roofing,Alpha,Lot,11/02/2026,11/06/2026,',
];
const tasks = (lines: string[] = LINES) => (normalizeScheduleImport({
  contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: 'm.csv', mimeType: 'text/csv',
  projects: ['Alpha'], projectAreas: [], now: new Date('2026-09-07T12:00:00.000Z'),
}).items as ScheduleItem[]).map(item => ({ ...item, id: `M-${item.taskName.replace(/\W+/g, '-')}` }));
const update = (id: string, taskId: string, notes: string): ProjectUpdate => ({
  id, projectName: 'Alpha', scheduleProjectName: 'Alpha', date: '2026-09-07T15:00:00.000Z', photos: [], recipients: { contactIds: [] }, notes,
  scheduleItemId: taskId, selectedAreaName: 'Lot',
}) as unknown as ProjectUpdate;
const UPDATES = [update('u1', 'M-Survey', 'Survey stakes set.'), update('u2', 'M-Framing', 'Framing crew on site.')];
/** The phone's Reports screen recipe (screens/ReportsScreen.tsx), with the clock given. */
const phoneTruths = (items: ScheduleItem[], updates: ProjectUpdate[] = UPDATES) => buildDAVEReportProjectTruths({
  projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates, scheduleItems: items,
  knownScheduleItems: items, knownScheduleDocuments: [] as ReferenceDocument[], projectAreas: [], referenceDocuments: [], now: NOW,
});
const webSnapshot = (items: ScheduleItem[], updates: ProjectUpdate[] = UPDATES): DAVEWebReadOnlySnapshot => ({
  projects: [{ id: '5f0c2a9e-1b1d-4c55-9a53-0d6f2c7c1a10', name: 'Alpha' }], scheduleItems: items, knownScheduleItems: items,
  projectUpdates: updates.map(entry => ({ id: entry.id, updateData: entry })), referenceDocuments: [], refreshedAt: NOW,
}) as unknown as DAVEWebReadOnlySnapshot;
const briefingOf = (items: ScheduleItem[], updates?: ProjectUpdate[]) => buildDAVEReportBriefing({ truths: phoneTruths(items, updates), selectedProjectNames: ['Alpha'], scheduleItems: items });
const snapshotOf = (items: ScheduleItem[], fingerprint: string): DAVEReportSnapshot => buildDAVEReportSnapshot({
  truths: phoneTruths(items), scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: NOW, reportFormat: 'project_manager',
});
const SAVED = tasks();
const REORDERED = [...SAVED].reverse();
const MOVED = SAVED.map(item => (item.taskName === 'Paint' ? { ...item, percentComplete: 60 } : item));

describe('R4 item 4a: a sync that only reorders the saved tasks changes nothing a report says', () => {
  it('the fingerprint is the same, and it is version 2.0', () => {
    const fingerprint = buildDAVEReportSourceFingerprint(phoneTruths(SAVED));
    expect(fingerprint).toMatch(/^dave-report-source\/2\.0:[0-9a-f]{8}$/);
    expect(buildDAVEReportSourceFingerprint(phoneTruths(REORDERED, [...UPDATES].reverse()))).toBe(fingerprint);
  });

  it('the scenario: under 1.0 the same reorder moved the fingerprint', () => {
    expect(buildDAVELegacyReportSourceFingerprint(phoneTruths(REORDERED))).not.toBe(buildDAVELegacyReportSourceFingerprint(phoneTruths(SAVED)));
  });

  it('Current Work, the action plan and every other list read the same, soonest finish first', () => {
    const saved = briefingOf(SAVED);
    const reordered = briefingOf(REORDERED, [...UPDATES].reverse());
    expect(reordered.currentWork).toEqual(saved.currentWork);
    expect(reordered.nextActions).toEqual(saved.nextActions);
    expect(reordered.criticalRisks).toEqual(saved.criticalRisks);
    expect(reordered.projectConditions).toEqual(saved.projectConditions);
    expect(reordered.whatChanged).toEqual(saved.whatChanged);
    expect(saved.currentWork.map(line => line.split(' (')[0])).toEqual(['Framing', 'Paint', 'Survey', 'Drywall', 'Electrical rough', 'Cleanup', 'Plumbing rough', 'Roofing']);
  });

  it('Project Truth\'s own summary lines no longer name whichever task was saved first', () => {
    expect(phoneTruths(REORDERED)[0].briefing).toEqual(phoneTruths(SAVED)[0].briefing);
  });

  it('guard: a fact that changes still moves the fingerprint', () => {
    expect(buildDAVEReportSourceFingerprint(phoneTruths(MOVED))).not.toBe(buildDAVEReportSourceFingerprint(phoneTruths(SAVED)));
    expect(buildDAVEReportSourceFingerprint(phoneTruths(SAVED, [...UPDATES, update('u3', 'M-Paint', 'Second coat started.')])))
      .not.toBe(buildDAVEReportSourceFingerprint(phoneTruths(SAVED)));
  });
});

describe('R4 item 4a: the phone and the web give the same facts one fingerprint', () => {
  it('whatever id each files the project under', () => {
    const phone = buildDAVEReportSourceFingerprint(phoneTruths(SAVED));
    const web = buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(webSnapshot(SAVED), 'Alpha'));
    expect(web).toBe(phone);
    // Under 1.0 they never agreed.
    expect(buildDAVELegacyReportSourceFingerprint(buildDAVEWebReportTruths(webSnapshot(SAVED), 'Alpha')))
      .not.toBe(buildDAVELegacyReportSourceFingerprint(phoneTruths(SAVED)));
  });

  it('so the web reads a report the phone sent, unchanged since, as it was sent', () => {
    const sentByPhone = markReportSnapshotDelivered(
      { ...snapshotOf(SAVED, buildDAVEReportSourceFingerprint(phoneTruths(SAVED))), deliveredAt: null }, '2026-09-08T13:00:00.000Z', 'phone-install');
    const web = buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(webSnapshot(SAVED), 'Alpha'));
    // The same content: compared with the report before it (none here), not with itself.
    expect(reportBaselineSnapshot(sentByPhone, web)).toBeNull();
    expect(otherDeviceSendNotReceived({ period: sentByPhone, currentFingerprint: web, ownSends: new Set(), pulledAt: null })).toBeNull();
  });
});

describe('R4 item 4a with R3 item 1: an update on a task\'s hidden row is counted under 2.0, and 1.0 stays Build 230\'s', () => {
  // Paint's first row, hidden since a master moved the task; a field update was made on it under the project's older name, with no parent kept.
  const hiddenRow = { ...SAVED.find(item => item.taskName === 'Paint')!, id: 'M-Paint-old', startDate: '09/03/2026', finishDate: '09/09/2026' } as ScheduleItem;
  const onHiddenRow = { ...update('u-hidden', 'M-Paint-old', 'Paint primer on site.'), projectName: 'Alpha Tower', scheduleProjectName: undefined } as unknown as ProjectUpdate;
  const truthsWith = (updates: ProjectUpdate[]) => buildDAVEReportProjectTruths({
    projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates, scheduleItems: SAVED,
    knownScheduleItems: [...SAVED, hiddenRow], knownScheduleDocuments: [] as ReferenceDocument[], projectAreas: [], referenceDocuments: [], now: NOW,
  });
  const updatesIn = (truth: DAVEProjectTruth) => truth.evidence.records.filter(record => record.kind === 'update').map(record => record.sourceRecordId).sort();

  it('the report\'s facts have it, and the 2.0 fingerprint moves with it', () => {
    expect(updatesIn(truthsWith([...UPDATES, onHiddenRow])[0])).toEqual(['u-hidden', 'u1', 'u2']);
    expect(buildDAVEReportSourceFingerprint(truthsWith([...UPDATES, onHiddenRow]))).not.toBe(buildDAVEReportSourceFingerprint(truthsWith(UPDATES)));
  });

  it('1.0 is worked out as Build 230 scoped the updates: without it, as if it were not there', () => {
    const [view] = truthsWith([...UPDATES, onHiddenRow]);
    expect(updatesIn(daveProjectTruthAsBuilt(view))).toEqual(['u1', 'u2']);
    expect(buildDAVELegacyReportSourceFingerprint([view])).toBe(buildDAVELegacyReportSourceFingerprint(truthsWith(UPDATES)));
  });

  it('so a report Build 230 approved for such a project is still that report\'s approval', () => {
    const fromBuild230 = buildDAVELegacyReportSourceFingerprint(truthsWith(UPDATES));
    const truths = truthsWith([...UPDATES, onHiddenRow]);
    const fingerprint = buildDAVEReportSourceFingerprint(truths);
    expect(sameReportSource(fromBuild230, fingerprint)).toBe(true);
    const snapshot = (source: string) => buildDAVEReportSnapshot({
      truths, scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: source, capturedAt: NOW, reportFormat: 'project_manager',
    });
    const approved = { ...snapshot(fromBuild230), deliveredAt: null } as DAVEReportSnapshot;
    expect(reportSnapshotToSave(snapshot(fingerprint), approved)).toBeNull();
    expect(approvalReplacesUnsentApproval(approved, fingerprint)).toBe(false);
  });

  it('guard: where the saved tasks change nothing, nothing is built twice (the truth as built is the report\'s own)', () => {
    const [view] = truthsWith(UPDATES);
    expect(updatesIn(daveProjectTruthAsBuilt(view))).toEqual(updatesIn(view));
    expect(daveProjectTruthAsBuilt(view).schedule).toHaveLength(view.schedule.length);
  });
});

describe('R4 item 4a: what each version is made of', () => {
  it('2.0: Project Truth\'s own summary lines are not in it (they are written from the facts hashed beside them)', () => {
    const [truth] = phoneTruths(SAVED);
    const reworded = { ...truth, briefing: { ...truth.briefing, currentReality: 'Another line.', nextActions: [] } } as DAVEProjectTruth;
    expect(buildDAVEReportSourceFingerprint([reworded])).toBe(buildDAVEReportSourceFingerprint([truth]));
  });

  it('2.0: the work areas saved on the phone do not make its fingerprint differ from the web\'s, which has none', () => {
    const areas = [
      { id: 'area-lot', projectName: 'Alpha', name: 'Lot', latitude: 37.1, longitude: -122.1, radiusFeet: 150 },
      { id: 'area-deck', projectName: 'Alpha', name: 'Deck', latitude: 37.2, longitude: -122.2, radiusFeet: 100 },
    ];
    const withAreas = buildDAVEReportProjectTruths({
      projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: UPDATES, scheduleItems: SAVED,
      knownScheduleItems: SAVED, knownScheduleDocuments: [] as ReferenceDocument[], projectAreas: areas as never, referenceDocuments: [], now: NOW,
    });
    // The scenario: the areas are in the phone's truth (its links), and under 1.0 they moved the fingerprint.
    expect(JSON.stringify(withAreas[0].entityLinks)).not.toBe(JSON.stringify(phoneTruths(SAVED)[0].entityLinks));
    expect(buildDAVELegacyReportSourceFingerprint(withAreas)).not.toBe(buildDAVELegacyReportSourceFingerprint(phoneTruths(SAVED)));
    expect(buildDAVEReportSourceFingerprint(withAreas)).toBe(buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(webSnapshot(SAVED), 'Alpha')));
  });

  it('2.0: the phone and the web agree also where an id carries the project id encoded twice (a project with no field updates)', () => {
    expect(JSON.stringify(phoneTruths(SAVED, [])[0].intelligence)).toContain('report%253Aalpha');
    expect(buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(webSnapshot(SAVED, []), 'Alpha')))
      .toBe(buildDAVEReportSourceFingerprint(phoneTruths(SAVED, [])));
  });

  it('1.0: it is of the truth as it was built, in saved order, not of the stable-order view', () => {
    const [view] = phoneTruths(REORDERED);
    const asBuilt = daveProjectTruthAsBuilt(view);
    expect(asBuilt).not.toBe(view);
    expect(asBuilt.schedule.map(entry => entry.taskName)).toEqual(REORDERED.map(item => item.taskName));
    expect(view.schedule.map(entry => entry.taskName)).toEqual(phoneTruths(SAVED)[0].schedule.map(entry => entry.taskName));
    expect(buildDAVELegacyReportSourceFingerprint([view])).toBe(buildDAVELegacyReportSourceFingerprint([asBuilt]));
    // A copy of the view (no longer known as one) hashes its reordered summary lines: another 1.0 value.
    const copyOfView = JSON.parse(JSON.stringify(view)) as DAVEProjectTruth;
    expect(buildDAVELegacyReportSourceFingerprint([copyOfView])).not.toBe(buildDAVELegacyReportSourceFingerprint([view]));
  });
});

describe('R4 item 4a: a report made under 1.0 is still known for the same facts', () => {
  const current = () => buildDAVEReportSourceFingerprint(phoneTruths(SAVED));
  const underOne = () => buildDAVELegacyReportSourceFingerprint(phoneTruths(SAVED));
  const approvedUnderOne = () => ({ ...snapshotOf(SAVED, underOne()), deliveredAt: null }) as DAVEReportSnapshot;

  it('the two fingerprints of the same facts are known as the same, each way round', () => {
    expect(isLegacyReportSource(underOne())).toBe(true);
    expect(isLegacyReportSource(current())).toBe(false);
    expect(sameReportSource(underOne(), current())).toBe(true);
    expect(sameReportSource(current(), underOne())).toBe(true);
  });

  it('phone: approving again saves nothing over it, and it is not called another report\'s approval', () => {
    const fingerprint = current();
    expect(reportSnapshotToSave(snapshotOf(SAVED, fingerprint), approvedUnderOne())).toBeNull();
    expect(approvalReplacesUnsentApproval(approvedUnderOne(), fingerprint)).toBe(false);
  });

  it('phone: once sent it reads as it was sent, and no device waits for it', () => {
    const fingerprint = current();
    const sent = markReportSnapshotDelivered(approvedUnderOne(), '2026-09-08T13:00:00.000Z', 'ipad-install');
    expect(reportBaselineSnapshot(sent, fingerprint)).toBeNull();
    expect(otherDeviceSendNotReceived({ period: sent, currentFingerprint: fingerprint, ownSends: new Set(), pulledAt: null })).toBeNull();
  });

  it('web: a report saved under 1.0 is still current', () => {
    const source = buildDAVEWebReportSource(webSnapshot(SAVED), 'Alpha');
    const savedUnderOne = source.fingerprint.replace(/^dave-report-source\/2\.0:[0-9a-f]+/, buildDAVELegacyReportSourceFingerprint(buildDAVEWebReportTruths(webSnapshot(SAVED), 'Alpha')));
    expect(savedUnderOne).not.toBe(source.fingerprint);
    expect(daveWebReportSourceIsCurrent(savedUnderOne, source)).toBe(true);
  });

  it('web: a report this browser sent under 1.0 is still known as sent from here', () => {
    const webTruths = buildDAVEWebReportTruths(webSnapshot(SAVED), 'Alpha');
    const fingerprint = buildDAVEReportSourceFingerprint(webTruths);
    const sentAt = '2026-09-08T13:00:00.000Z';
    const sentUnderOne = markReportSnapshotDelivered({ ...snapshotOf(SAVED, buildDAVELegacyReportSourceFingerprint(webTruths)), deliveredAt: null }, sentAt, 'this-browser');
    (daveWebOwnReportSends() as Set<string>).add(sentAt);
    expect(daveWebReportSentHereAt(sentUnderOne, fingerprint)).toBe(sentAt);
    // Not a report of other facts.
    expect(daveWebReportSentHereAt(sentUnderOne, buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(webSnapshot(MOVED), 'Alpha')))).toBeNull();
    (daveWebOwnReportSends() as Set<string>).delete(sentAt);
  });

  it('never for other facts: a 1.0 report of the project as it was before a change is not this report', () => {
    const fingerprint = buildDAVEReportSourceFingerprint(phoneTruths(MOVED));
    const before = approvedUnderOne();
    expect(sameReportSource(before.sourceFingerprint, fingerprint)).toBe(false);
    expect(reportSnapshotToSave(snapshotOf(MOVED, fingerprint), before)).not.toBeNull();
    expect(approvalReplacesUnsentApproval(before, fingerprint)).toBe(true);
    const source = buildDAVEWebReportSource(webSnapshot(MOVED), 'Alpha');
    const savedBefore = source.fingerprint.replace(/^dave-report-source\/2\.0:[0-9a-f]+/, buildDAVELegacyReportSourceFingerprint(buildDAVEWebReportTruths(webSnapshot(SAVED), 'Alpha')));
    expect(daveWebReportSourceIsCurrent(savedBefore, source)).toBe(false);
  });

  it('a 1.0 report made when the tasks were saved in another order is still known once that order has been seen', () => {
    const inOtherOrder = buildDAVELegacyReportSourceFingerprint(phoneTruths(REORDERED));
    buildDAVEReportSourceFingerprint(phoneTruths(REORDERED));
    expect(sameReportSource(inOtherOrder, current())).toBe(true);
  });

  it('guard: two 1.0 fingerprints, or two 2.0 ones, are the same only when they are equal; nothing is not a report', () => {
    expect(sameReportSource(underOne(), buildDAVELegacyReportSourceFingerprint(phoneTruths(MOVED)))).toBe(false);
    expect(sameReportSource(current(), buildDAVEReportSourceFingerprint(phoneTruths(MOVED)))).toBe(false);
    expect(sameReportSource(null, current())).toBe(false);
    expect(sameReportSource(`${underOne()}:media-aa`, `${current()}:media-bb`)).toBe(false);
    expect(sameReportSource(`${underOne()}:media-aa`, `${current()}:media-aa`)).toBe(true);
  });
});
