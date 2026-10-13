/**
 * R7 item A (the coordinator's decision on review pass 1, F0; High, caused by
 * R4 item 4a part d).
 *
 * This build's report counts a field update that Build 230's left out: one on
 * a task's old row (a newer master moved the task and hid that row), filed
 * under a name that is not the project's ("Building 7"), with no parent
 * project kept on it. So that a Build 230 report was still known, the 1.0
 * fingerprint was worked out as Build 230 scoped the updates, without that
 * one, and stood as a name of today's facts. A name that leaves something
 * out goes on matching when that something changes: the update could be
 * reworded, a second one could arrive, a photo comparison could be confirmed
 * on it, the written report changed each time, and the report approved, sent
 * or saved on Build 230 was still taken for it.
 *
 * The decision: no clock. The 1.0 name stands for today's facts only where
 * this build's report counts the same field updates as Build 230's did.
 * Where it counts even one Build 230 left out, the 1.0 name matches nothing:
 * the report is another report (it has more in it), offered for approval
 * again on the phone and read as changed on the web. Once, on such projects.
 *
 * The real CSV reader, import merge, shown list, the phone's scope, the one
 * report recipe and the web's report source. Synthetic data.
 */
import {
  buildDAVELegacyReportSourceFingerprint, buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, enhanceDAVEReportDraft,
} from '../../services/DAVEReportIntelligence';
import { daveProjectTruthAsBuilt } from '../../services/DAVEProjectTruth';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import {
  buildDAVEReportSnapshot, daveReportSnapshotScopeKey, legacyReportSourcesOf, markReportSnapshotDelivered, rememberLegacyReportSource,
  reportBaselineSnapshot, reportSnapshotToSave, sameReportSource, type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { buildDAVEWebReportSource, buildDAVEWebReportTruths, daveWebReportSourceIsCurrent, formatDAVEWebReport } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { buildDailyReportAuthorityScope } from '../../services/ReportAuthorityScope';
import { approvalReplacesUnsentApproval } from '../../services/ReportManualSend';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleSavedTasksOfProjects } from '../../services/ScheduleTaskRevisions';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const master = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id, projectControls: normalizeProjectControls(undefined), activity: [],
  } as ScheduleItem));
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, overlay: false,
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]) as ScheduleItem[],
    documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
/** A field update started from a task. `under`: the name it was filed under. */
const fieldUpdate = (id: string, taskId: string, date: string, notes: string, under = 'Building 7'): ProjectUpdate => ({
  id, projectName: under, date, photos: [], recipients: { contactIds: [] }, notes, scheduleItemId: taskId, scheduleTaskName: 'Paint', selectedAreaName: 'Lot',
}) as unknown as ProjectUpdate;
const NOW = '2026-09-12T22:00:00.000Z';
const STUB = { id: 'draft', title: '', subject: '', body: '', openingLine: 'OPENING', closingLine: 'CLOSING', locationGroups: [] } as never;

/** The phone's Reports screen for this saved data. */
function phone(state: State, updates: ProjectUpdate[]) {
  const scope = buildDailyReportAuthorityScope({
    selectedProjectName: 'Alpha', selectedProjectNames: ['Alpha'], projectRecords: [{ id: 'project-alpha-id', name: 'Alpha' }] as never, updates,
    scheduleItems: shown(state), currentUpdate: null, projectAreas: [], knownScheduleItems: state.items, referenceDocuments: state.documents,
    projectDocuments: [], captureMemories: [], contacts: { contacts: [] },
  } as never);
  const truths = buildDAVEReportProjectTruths({
    projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: scope.updates, scheduleItems: scope.scheduleItems,
    knownScheduleItems: scheduleSavedTasksOfProjects(state.items, scope.scheduleItems, scope.projectNames), knownScheduleDocuments: state.documents,
    projectAreas: scope.projectAreas, referenceDocuments: scope.referenceDocuments, now: NOW,
  });
  const fingerprint = buildDAVEReportSourceFingerprint(truths);
  const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: ['Alpha'], previousSnapshot: null, scheduleItems: scope.scheduleItems });
  return {
    truths, fingerprint,
    /** The fingerprint Build 230 wrote for this saved data: 1.0, of the facts as Build 230 scoped the updates. */
    onBuild230: buildDAVELegacyReportSourceFingerprint(truths),
    counted: truths[0].evidence.records.filter(record => record.kind === 'update').map(record => record.sourceRecordId).sort(),
    countedByBuild230: daveProjectTruthAsBuilt(truths[0]).evidence.records.filter(record => record.kind === 'update').map(record => record.sourceRecordId).sort(),
    /** The written report, in the phone's words and in the web's. */
    text: [
      String(enhanceDAVEReportDraft(STUB, briefing, 'project_manager').body),
      String(formatDAVEWebReport(briefing, 'project_manager', null)).split('\n').filter(line => !line.startsWith('Generated: ')).join('\n'),
    ].join('\n=====\n'),
  };
}
const webSnapshot = (state: State, updates: ProjectUpdate[]): DAVEWebReadOnlySnapshot => ({
  projects: [{ id: 'project-alpha-id', name: 'Alpha' }], scheduleItems: shown(state), knownScheduleItems: state.items,
  projectUpdates: updates.map(update => ({ id: update.id, updateData: update })), referenceDocuments: state.documents, refreshedAt: NOW,
}) as unknown as DAVEWebReadOnlySnapshot;
/** The web's report source for the same saved data, and the source fingerprint Build 230 saved with a report of it. */
function web(state: State, updates: ProjectUpdate[]) {
  const source = buildDAVEWebReportSource(webSnapshot(state, updates), 'Alpha');
  const onBuild230 = String(source.fingerprint).replace(/^dave-report-source\/2\.0:[0-9a-f]+/, buildDAVELegacyReportSourceFingerprint(buildDAVEWebReportTruths(webSnapshot(state, updates), 'Alpha')));
  return { source, onBuild230 };
}
const snapshotOf = (source: ReturnType<typeof phone>, fingerprint: string) => buildDAVEReportSnapshot({
  truths: source.truths, scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: NOW, reportFormat: 'project_manager',
});

// Master 1 lists Paint; a field update on Paint is filed under "Building 7"; master 2 moves Paint and hides its old row.
let STATE: State = { items: [], documents: [] };
STATE = approve(STATE, master('MASTER M1', '2026-09-07T16:00:00.000Z'), ['Paint,Alpha,Lot,10/05/2026,10/09/2026,', 'Drywall,Alpha,Lot,10/01/2026,10/04/2026,']);
const FIRST = fieldUpdate('u-1', 'MASTER M1-1', '2026-09-08T15:00:00.000Z', 'Paint about 50% done, crew on site.');
STATE = approve(STATE, master('MASTER M2', '2026-09-09T16:00:00.000Z'), ['Paint,Alpha,Lot,10/12/2026,10/16/2026,', 'Drywall,Alpha,Lot,10/01/2026,10/04/2026,']);
const REWORDED = { ...FIRST, notes: 'Blocked: waiting on inspector for Paint.' } as ProjectUpdate;
const SECOND = fieldUpdate('u-2', 'MASTER M1-1', '2026-09-11T15:00:00.000Z', 'Blocked: waiting on inspector for Paint.');
/** The first update with a photo whose comparison he confirmed: the report says what it shows. */
const WITH_PHOTO = {
  ...FIRST,
  photos: [{
    id: 'p-1-1', uri: 'file:///phone/photos/p-1-1.jpg', caption: 'Paint progress', category: 'Progress', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
    fileName: 'p-1-1.jpg', mimeType: 'image/jpeg', selectedAreaName: 'Lot',
    photoIntelligence: {
      status: 'analysis_complete', title: 'Photo comparison', summary: 'Paint, photo 1', visibleChange: 'Primer is on the north wall.', location: 'Lot', comparisonConfidence: 'high',
      captureLimitations: [], projectProgress: 'supported', repeatPhotoGuidance: null, authorityMessage: '', currentObservation: 'North wall primed; south wall bare.',
      changedFromPrior: 'Primer applied since the prior photo.', priorUpdateUsed: 'u-0', comparability: 'strong', provenance: 'visual_only', userReview: 'confirmed',
      assessmentDisposition: 'finding', findings: [{ findingType: 'added', description: 'Primer' }],
    },
  }],
} as unknown as ProjectUpdate;
/** The same update filed as updates are today: with its parent project kept. Both builds count it. */
const FILED_UNDER_THE_PROJECT = { ...FIRST, scheduleProjectName: 'Alpha' } as ProjectUpdate;


describe('R7 item A: where this build\'s report counts a field update Build 230 left out, a Build 230 report is another report', () => {
  it('(the rig) the task was moved, the update sits on its old row under a building name: this build counts it, Build 230 did not', () => {
    expect(shown(STATE).map(item => item.id).sort()).toEqual(['MASTER M1-2', 'MASTER M2-1']);
    const today = phone(STATE, [FIRST]);
    expect(today.counted).toEqual(['u-1']);
    expect(today.countedByBuild230).toEqual([]);
    // What Build 230 wrote is still worked out, to the byte: its report of this saved data was the report with no field update.
    expect(today.onBuild230).toBe(phone(STATE, []).onBuild230);
    expect(today.onBuild230).toMatch(/^dave-report-source\/1\.0:/);
  });

  it('the report approved on Build 230 is not this report: it has more in it (the one-time loss the decision accepts)', () => {
    const today = phone(STATE, [FIRST]);
    expect(sameReportSource(today.onBuild230, today.fingerprint)).toBe(false);
    // No 1.0 name stands for these facts at all.
    expect(legacyReportSourcesOf(today.fingerprint)).toEqual([]);
    // On the phone: the approval waiting from Build 230 is another report's, and approving saves a new one.
    const approvedOn230 = { ...snapshotOf(today, today.onBuild230), deliveredAt: null } as DAVEReportSnapshot;
    expect(approvalReplacesUnsentApproval(approvedOn230, today.fingerprint)).toBe(true);
    expect(reportSnapshotToSave(snapshotOf(today, today.fingerprint), approvedOn230)).not.toBeNull();
    // A report sent on Build 230 is the report this one counts from, not this report already sent.
    const sentOn230 = markReportSnapshotDelivered(approvedOn230, '2026-09-10T18:00:00.000Z', 'phone-install');
    expect(reportBaselineSnapshot(sentOn230, today.fingerprint)).toBe(sentOn230);
  });

  it.each([
    ['reworded', () => [REWORDED]],
    ['with a second one of the kind arrived', () => [FIRST, SECOND]],
    ['with a photo comparison confirmed on it', () => [WITH_PHOTO]],
  ])('nor is it the report with that update %s (it was taken for each of them)', (_what, updates) => {
    const approved = phone(STATE, [FIRST]);
    const changed = phone(STATE, updates());
    expect(changed.fingerprint).not.toBe(approved.fingerprint);
    expect(sameReportSource(approved.onBuild230, changed.fingerprint)).toBe(false);
    // Asked in the other order, and after the unchanged report was asked about first.
    expect(sameReportSource(changed.fingerprint, approved.onBuild230)).toBe(false);
    expect(sameReportSource(approved.onBuild230, approved.fingerprint)).toBe(false);
    expect(sameReportSource(approved.onBuild230, changed.fingerprint)).toBe(false);
  });

  it('and the written report does change with such an update: a photo comparison he confirmed on it, on the first or on a second one', () => {
    const approved = phone(STATE, [FIRST]);
    expect(phone(STATE, [WITH_PHOTO]).text).not.toBe(approved.text);
    expect(phone(STATE, [WITH_PHOTO]).text).toContain('Primer applied since the prior photo.');
    const secondWithPhoto = { ...SECOND, photos: (WITH_PHOTO as ProjectUpdate).photos } as ProjectUpdate;
    expect(phone(STATE, [FIRST, secondWithPhoto]).text).not.toBe(approved.text);
    expect(sameReportSource(approved.onBuild230, phone(STATE, [FIRST, secondWithPhoto]).fingerprint)).toBe(false);
  });

  it('on the web: a report saved on Build 230 reads as changed, with the update as it was and with a second one arrived', () => {
    const saved = web(STATE, [FIRST]);
    expect(saved.onBuild230).toMatch(/^dave-report-source\/1\.0:/);
    expect(daveWebReportSourceIsCurrent(saved.onBuild230, saved.source)).toBe(false);
    expect(daveWebReportSourceIsCurrent(saved.onBuild230, web(STATE, [FIRST, SECOND]).source)).toBe(false);
    expect(daveWebReportSourceIsCurrent(saved.onBuild230, web(STATE, [REWORDED]).source)).toBe(false);
  });

  it('with that update deleted, today\'s report is, to the byte, the report Build 230 made (it never counted the update): it is that report', () => {
    const approved = phone(STATE, [FIRST]);
    const deleted = phone(STATE, []);
    expect(deleted.counted).toEqual(deleted.countedByBuild230);
    expect(deleted.onBuild230).toBe(approved.onBuild230);
    expect(sameReportSource(approved.onBuild230, deleted.fingerprint)).toBe(true);
    // And never for two different sets of today's facts: not for the facts with the update in them.
    expect(sameReportSource(approved.onBuild230, approved.fingerprint)).toBe(false);
  });
});

describe('R7 item A: where both builds count the same field updates, the hand-over holds as before', () => {
  it('an update filed with its parent project (as updates are today) is counted by both: the Build 230 report is still known, to the byte', () => {
    const today = phone(STATE, [FILED_UNDER_THE_PROJECT]);
    expect(today.counted).toEqual(['u-1']);
    expect(today.countedByBuild230).toEqual(['u-1']);
    expect(sameReportSource(today.onBuild230, today.fingerprint)).toBe(true);
    expect(legacyReportSourcesOf(today.fingerprint)).toEqual([today.onBuild230]);
    const approvedOn230 = { ...snapshotOf(today, today.onBuild230), deliveredAt: null } as DAVEReportSnapshot;
    expect(approvalReplacesUnsentApproval(approvedOn230, today.fingerprint)).toBe(false);
    expect(reportSnapshotToSave(snapshotOf(today, today.fingerprint), approvedOn230)).toBeNull();
    const saved = web(STATE, [FILED_UNDER_THE_PROJECT]);
    expect(daveWebReportSourceIsCurrent(saved.onBuild230, saved.source)).toBe(true);
  });

  it('guard: and there the 1.0 name sees every change to it: reworded, deleted, a second one arrived', () => {
    const approved = phone(STATE, [FILED_UNDER_THE_PROJECT]);
    for (const updates of [
      [{ ...FILED_UNDER_THE_PROJECT, notes: 'Blocked: waiting on inspector for Paint.' } as ProjectUpdate],
      [],
      [FILED_UNDER_THE_PROJECT, { ...SECOND, scheduleProjectName: 'Alpha' } as ProjectUpdate],
    ]) {
      const changed = phone(STATE, updates);
      expect(changed.fingerprint).not.toBe(approved.fingerprint);
      expect(sameReportSource(approved.onBuild230, changed.fingerprint)).toBe(false);
    }
  });

  it('guard: a project with no such update is untouched: the truth as Build 230 built it has the same records, and its Build 230 report is known', () => {
    const today = phone(STATE, []);
    const records = (truth: (typeof today.truths)[number]) => truth.evidence.records.map(record => record.id).sort();
    expect(records(daveProjectTruthAsBuilt(today.truths[0]))).toEqual(records(today.truths[0]));
    expect(sameReportSource(today.onBuild230, today.fingerprint)).toBe(true);
  });

  it('guard: a 1.0 name worked out earlier for the same fingerprint is not left standing once the report counts more', () => {
    // (Two saved states can have one fingerprint today: the same update filed either way. What was worked out for
    // the one where both builds counted it must not stand for the one where only this build does.)
    const today = 'dave-report-source/2.0:0a0a0a0a';
    const earlier = 'dave-report-source/1.0:0b0b0b0b';
    rememberLegacyReportSource(today, earlier);
    expect(sameReportSource(earlier, today)).toBe(true);
    rememberLegacyReportSource(today, null);
    expect(legacyReportSourcesOf(today)).toEqual([]);
    expect(sameReportSource(earlier, today)).toBe(false);
  });

  it('one project of two counts an update Build 230 left out: the report of both is another report', () => {
    // The report's fingerprint is of all its projects: no 1.0 name stands when any of them counts more.
    const truths = [
      ...phone(STATE, [FIRST]).truths,
      ...buildDAVEReportProjectTruths({
        projects: [{ name: 'Beta', projectId: 'report:beta' }], projectRecords: [{ name: 'Beta' }] as never, updates: [], scheduleItems: [], knownScheduleItems: [],
        knownScheduleDocuments: [], projectAreas: [], referenceDocuments: [], now: NOW,
      }),
    ];
    const fingerprint = buildDAVEReportSourceFingerprint(truths);
    expect(sameReportSource(buildDAVELegacyReportSourceFingerprint(truths), fingerprint)).toBe(false);
    expect(legacyReportSourcesOf(fingerprint)).toEqual([]);
  });
});
