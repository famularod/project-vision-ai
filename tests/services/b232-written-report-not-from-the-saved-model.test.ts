/**
 * Build 232 item 4, part A (the owner's answer to question 49, 13 Oct 2026; reviews pass 2 finding O1): the line of
 * WORK AREAS / PHOTO NOTES that comes from the model the app SAVES is not part of the written report.
 *
 * The phone's older report writer (services/PIEReporter.ts) took one piece of evidence from the app's own model of
 * the project (the Core's "situation": its summary sentence and its first advised action) and printed it as up to
 * two lines of the section: "9 reality objects modeled. ... Grade the lot: Ready. ...", "Confirm the current state
 * of Rough in electrical with authoritative evidence.", "Collect current evidence for <a note>". The app saves that
 * model on the device and reads it back, so the lines followed the device's own history, not today's records:
 *   - a field update he DELETED was still quoted, a month later;
 *   - two devices holding the same records wrote two different reports under one fingerprint, so "Your other device
 *     already sent this report" stood above a report that was not the one sent.
 *
 * The draft is made here as the app's provider makes it (buildRuntime, then buildLivePIECoreIntelligence, with one
 * app storage per device), the only way that saves a model; the plain Core the other rigs use saves nothing.
 * The model's advice stays in the draft for the app's own screens (its action items); only the written lines go.
 * Synthetic data. No network.
 */
const mockDevices = new Map<string, Map<string, string>>();
let mockDevice = 'd0';
const mockLocal = () => {
  if (!mockDevices.has(mockDevice)) mockDevices.set(mockDevice, new Map());
  return mockDevices.get(mockDevice) as Map<string, string>;
};
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: jest.fn(async (key: string) => mockLocal().get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockLocal().set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockLocal().delete(key); }),
    getAllKeys: jest.fn(async () => Array.from(mockLocal().keys())),
    multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockLocal().get(key) ?? null])),
    multiSet: jest.fn(async (pairs: [string, string][]) => { pairs.forEach(([key, value]) => mockLocal().set(key, value)); }),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(key => mockLocal().delete(key)); }),
  };
  return { __esModule: true, default: api, ...api };
});
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

import * as fs from 'fs';
import { buildLivePIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { buildRuntime } from '../../services/PIERuntime';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, enhanceDAVEReportDraft } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import type { ProjectUpdate, ScheduleItem } from '../../types';

jest.setTimeout(600_000);
const OUT = process.env.B232_OUT_DIR || '';
const note = (name: string, text: string) => { if (OUT) fs.writeFileSync(`${OUT}/${name}`, text); };

const PROJECT = 'Building 2100';
const task = (id: string, taskName: string, area: string, percent: number, finish: string, owner: string, extra: Record<string, unknown> = {}) => ({
  id, projectName: PROJECT, scheduleProjectName: PROJECT, locationName: area, taskName,
  startDate: '09/01/2026', finishDate: finish, milestone: '', owner, contractor: 'Northline',
  percentComplete: percent, priority: 'Medium', status: percent >= 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z', ...extra,
}) as unknown as ScheduleItem;
const photo = (id: string, area: string, caption: string) => ({
  id, uri: `file:///photos/${id}.jpg`, caption, category: 'Progress', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
  fileName: `${id}.jpg`, mimeType: 'image/jpeg', selectedAreaName: area,
});
const update = (id: string, item: ScheduleItem, area: string, date: string, notes: string, photos: unknown[] = []) => ({
  id, projectName: PROJECT, scheduleProjectName: PROJECT, date, photos, recipients: { contactIds: [] }, notes, status: 'sent',
  scheduleItemId: item.id, scheduleTaskName: item.taskName, selectedAreaName: area,
}) as unknown as ProjectUpdate;

// The reviewer's project B (notes/p6-b232/rv2-projects.ts): four tasks, four field updates.
const electrical = task('b1', 'Rough in electrical', 'Level 3', 30, '10/20/2026', 'Dana', { status: 'Waiting' });
const doors = task('b2', 'Hang doors', 'Unit 2026', 0, '10/18/2026', 'Luis', { priority: 'High' });
const grade = task('b3', 'Grade the lot', 'Site', 0, '11/05/2026', 'Mara');
const drywall = task('b4', 'Level 3 drywall', 'Level 3', 100, '10/01/2026', 'Dana');
const TASKS = [electrical, doors, grade, drywall];
const UPDATES = [
  update('ub4', electrical, 'Level 3', '2026-10-13', 'Electrical rough in is 30 percent complete on Level 3. Pour moved to 10/20/2026.', [photo('pb4', 'Level 3', 'Conduit at Level 3 corridor')]),
  update('ub3', doors, 'Unit 2026', '2026-10-11', 'Doors for Unit 2026 arrived damaged. Luis to confirm the reorder.', [photo('pb3', 'Unit 2026', 'Damaged door slab')]),
  update('ub2', grade, 'Site', '2026-10-09', 'Lot grading starts October 2026 per the sitework sub.'),
  update('ub1', drywall, 'Level 3', '2026-10-07', 'Drywall is complete on Level 3.', [photo('pb1', 'Level 3', 'Level 3 drywall taped')]),
];
// What he deleted: an update, and the task it was logged from.
const GONE_TASK = task('gone-task', 'Temporary power', 'Trailer', 0, '10/14/2026', 'Luis', { status: 'Waiting' });
const GONE_UPDATE = update('gone-update', GONE_TASK, 'Trailer', '2026-10-12', 'Temporary power is out at the trailer. Generator is on order.');

type World = { updates: ProjectUpdate[]; items: ScheduleItem[] };
const TODAY: World = { updates: UPDATES, items: TASKS };
const NOW = '2026-10-13T17:00:00.000Z';
const YESTERDAY = '2026-10-12T17:00:00.000Z';
const HEADING = 'WORK AREAS / PHOTO NOTES';

/** Reports opened on `device` at `now`: the fingerprint, the Project Manager report as written, and the app's own draft. */
async function open(device: string, world: World, now: string = NOW) {
  jest.useFakeTimers({ now: Date.parse(now), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
  try {
    mockDevice = device;
    const truths = buildDAVEReportProjectTruths({
      projects: [{ name: PROJECT, projectId: 'report:building-2100' }], projectRecords: [{ name: PROJECT }] as never,
      updates: world.updates, scheduleItems: world.items, knownScheduleItems: world.items, knownScheduleDocuments: [],
      projectAreas: [], referenceDocuments: [],
    } as never);
    const fingerprint = buildDAVEReportSourceFingerprint(truths);
    const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: [PROJECT], previousSnapshot: null, scheduleItems: world.items } as never);
    const runtimeContext = {
      projectName: PROJECT, projectNames: [PROJECT], reportType: 'daily_project_update',
      updates: world.updates, scheduleItems: world.items, knownScheduleItems: world.items, currentUpdate: null,
      projectAreas: [], contacts: { contacts: [] }, referenceDocuments: [], surface: 'reports',
    };
    // As providers/PIELiveAuthorityProvider makes it on a workspace that keeps its model on the device.
    const core = await buildLivePIECoreIntelligence({
      runtimeContext, authorityCore: null, reportType: 'daily_project_update', reportProjectNames: [PROJECT],
      organizationId: 'local-unverified-anonymous', projectId: 'project-building-2100',
      verifiedLearningEvents: [], identityTrusted: false, cloudAvailable: false, runtime: buildRuntime(runtimeContext as never),
    } as never);
    const draft = core.reportDraft as unknown as {
      body: string; sourceEvidence: Array<{ id: string; summary: string; actionRequired?: string | null }>;
      actionItems: Array<{ action: string }>; locationGroups: Array<{ workAreas: Array<{ bullets: Array<{ text: string }> }> }>;
    };
    const body = String(enhanceDAVEReportDraft(draft as never, briefing, 'project_manager').body);
    const executive = String(enhanceDAVEReportDraft(draft as never, briefing, 'executive').body);
    const from = body.indexOf(HEADING);
    return { fingerprint, body, executive, section: from >= 0 ? body.slice(from) : '', draft };
  } finally {
    jest.useRealTimers();
  }
}
/** What the app's model says of the project on this device: its summary sentence and the action it advises first. */
const fromTheModel = (draft: Awaited<ReturnType<typeof open>>['draft']) => draft.sourceEvidence.find(item => item.id === 'runtime-current-situation');

beforeEach(() => mockDevices.clear());

describe('B232 item 4 part A: the written report has no line from the model the app saves', () => {
  it('a field update he deleted is quoted nowhere in the written report, that day or 31 days later', async () => {
    // Yesterday the device held the update (and its task) and Reports was open; then he deleted both.
    await open('phone', { updates: [GONE_UPDATE, ...UPDATES], items: [...TASKS, GONE_TASK] }, YESTERDAY);
    for (const [when, now] of [['that day', NOW], ['31 days later', '2026-11-13T17:00:00.000Z']] as const) {
      const report = await open('phone', TODAY, now);
      note(`deleted-${when.replace(/ /g, '-')}.txt`, report.body);
      // The model still holds the deleted note's words, and advises on them inside the app...
      expect({ when, theModelStillHoldsIt: JSON.stringify(report.draft.sourceEvidence).includes('Temporary power') }).toEqual({ when, theModelStillHoldsIt: true });
      // ...and no report that is sent quotes them, in either format, nor does the preview's list of work areas.
      const lines = report.draft.locationGroups.flatMap(group => group.workAreas.flatMap(area => area.bullets.map(bullet => bullet.text)));
      expect({ when, quoted: [report.body, report.executive, ...lines].some(text => text.includes('Temporary power')) }).toEqual({ when, quoted: false });
      // It is word for word the report of a device that never held the update.
      const fresh = await open(`fresh-${when}`, TODAY, now);
      expect({ when, sameText: report.body === fresh.body, sameFingerprint: report.fingerprint === fresh.fingerprint }).toEqual({ when, sameText: true, sameFingerprint: true });
    }
  });

  it('two devices holding the same records and different saved models write the same whole text', async () => {
    const fresh = await open('ipad', TODAY);
    // The phone was open yesterday, before the two newest updates, when one task stood 20 points lower.
    await open('phone', { updates: UPDATES.slice(2), items: TASKS.map(item => (item.id === 'b1' ? { ...item, percentComplete: 10 } as ScheduleItem : item)) }, YESTERDAY);
    const afterAPercentChange = await open('phone', TODAY);
    // A third device held an update and a task that were deleted since.
    await open('old-phone', { updates: [GONE_UPDATE, ...UPDATES], items: [...TASKS, GONE_TASK] }, YESTERDAY);
    const afterADelete = await open('old-phone', TODAY);
    note('fresh.txt', fresh.body);
    note('after-a-percent-change.txt', afterAPercentChange.body);
    note('after-a-delete.txt', afterADelete.body);
    // Their models differ: each advises something else inside the app.
    const advice = [fresh, afterAPercentChange, afterADelete].map(report => `${fromTheModel(report.draft)?.summary} / ${fromTheModel(report.draft)?.actionRequired}`);
    expect(new Set(advice).size).toBeGreaterThan(1);
    for (const [name, other] of [['after a percent change', afterAPercentChange], ['after a delete', afterADelete]] as const) {
      expect({ name, sameFingerprint: other.fingerprint === fresh.fingerprint, sameText: other.body === fresh.body, sameExecutive: other.executive === fresh.executive })
        .toEqual({ name, sameFingerprint: true, sameText: true, sameExecutive: true });
    }
  });

  it('the model\'s lines are not written, his own lines are exactly as before, and the advice stays in the app', async () => {
    const everyWrittenText = (report: Awaited<ReturnType<typeof open>>) => [
      report.body, report.executive,
      ...report.draft.locationGroups.flatMap(group => group.workAreas.flatMap(area => area.bullets.map(bullet => bullet.text))),
    ];
    // A device that never saw the project before: the model sums it up in one sentence.
    const fresh = await open('ipad', TODAY);
    const sentence = String(fromTheModel(fresh.draft)?.summary);
    expect(sentence).toEqual(expect.stringContaining('reality objects modeled'));
    expect(everyWrittenText(fresh).filter(text => text.includes(sentence.slice(0, 40)))).toEqual([]);
    // The section, line for line: his notes, photos and schedule lines as before; the last line is item 2's sentence.
    expect(fresh.section).toBe(THE_SECTION);

    // A device whose model read an earlier percent: the model advises an action.
    await open('phone', { updates: UPDATES, items: TASKS.map(item => (item.id === 'b1' ? { ...item, percentComplete: 10 } as ScheduleItem : item)) }, YESTERDAY);
    const phone = await open('phone', TODAY);
    const advised = String(fromTheModel(phone.draft)?.actionRequired).replace(/\.$/, '');
    expect(advised).toBe('Confirm the current state of Rough in electrical with authoritative evidence');
    expect(everyWrittenText(phone).filter(text => text.includes(advised))).toEqual([]);
    expect(phone.section).toBe(THE_SECTION);
    // The app's own screens still have the advice: it is among the draft's action items, as before.
    expect(phone.draft.actionItems.filter(item => item.action.replace(/\.$/, '') === advised)).toHaveLength(1);
  });
});

/**
 * The section as it was written before this change on a device that never saw the project, without the one line
 * that came from the model ("• Building 2100 — 2100: 9 reality objects modeled. 0 need verification, 0 are at risk,
 * 0 are blocked. Grade the lot: Ready. Continue monitoring Grade the lot. Reality Model has ready objects and no
 * blocking risks."), which stood before the last line.
 */
const THE_SECTION = [
  'WORK AREAS / PHOTO NOTES',
  '• Building 2100 — 2100 Level 3: Conduit at Level 3 corridor. See Images 1 and 3.',
  '• Building 2100 — 2100 Level 3: Rough in electrical, due 10/20/2026, status Waiting, owner Dana.',
  '• Building 2100 — 2100 Level 3: Electrical rough in is 30 percent complete on Level 3. Pour moved to 10/20/2026.',
  '• Building 2100 — 2100 Unit 2026: Damaged door slab. See Image 2.',
  '• Building 2100 — 2100 Unit 2026: Doors for Unit 2026 arrived damaged. Luis to confirm the reorder.',
  '• Building 2100 — 2100 Unit 2026: Luis – Please confirm the current status of Hang doors.',
  // Item 4 part B: this note was in no line before (no word of the writer's construction vocabulary: "grading" is not "grade").
  '• Building 2100 — 2100 Site: Lot grading starts October 2026 per the sitework sub.',
  '• Building 2100 — 2100: Latest update: Electrical rough in is 30 percent complete on Level 3. Pour moved to 10/20/2026. Latest photo: Conduit at Level 3 corridor Schedule focus: Hang doors (due 10/18/2026).',
  '',
  'Please let me know if you have any questions.',
].join('\n');
