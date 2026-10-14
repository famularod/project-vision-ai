/**
 * Build 232 item 4b (the coordinator's decision, 13 Oct 2026; review pass 5 findings R1 and R2): the line made from
 * the model the app SAVES takes no place among a work area's lines.
 *
 * A work area of the written report prints at most three lines: its first progress line, its first problem, its
 * first next step, then the rest in order. Item 4 part A stopped PRINTING the line made from the app's saved model
 * of the project, but the line was still CHOSEN first and then left out, so its place stood empty:
 *   R1. Three field notes recorded with no area and no task. Build 231 printed two of them and the "Latest update"
 *       line under the project's own name. After parts A and B one of the two was gone: the model's sentence read
 *       as a problem, took the "first problem" place and was left out.
 *   R2. Two devices holding the same records and different saved models still wrote two texts (on one the model's
 *       sentence took the "first problem" place, on the other its advice took the "first next step" place), and
 *       the second device was told "Your other device already sent this report".
 * Now the three lines are chosen as if that evidence were not there. The evidence itself stays in the draft, where
 * the app's own advice reads it (its action items, risks and decisions).
 *
 * The draft is made as the app's provider makes it (scoped as App.tsx scopes it, buildRuntime, then
 * buildLivePIECoreIntelligence, one app storage per device): the only road that saves a model. The project is the
 * reviewer's (notes/p6-b232/rv5-reports.test.tsx). Synthetic data. No network.
 * The general check over generated projects is test 4b of b232-phone-whole-written-report-moves-the-fingerprint.
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
import { buildDailyReportAuthorityScope } from '../../services/ReportAuthorityScope';
import type { ProjectUpdate, ScheduleItem } from '../../types';

jest.setTimeout(600_000);
const OUT = process.env.B232_OUT_DIR || '';
const note = (name: string, text: string) => { if (OUT) fs.writeFileSync(`${OUT}/${name}`, text); };

const PROJECT = 'Quarry Street Annex';
const task = (id: string, taskName: string, area: string, percent: number, finish: string, owner: string, extra: Record<string, unknown> = {}) => ({
  id, projectName: PROJECT, scheduleProjectName: PROJECT, locationName: area, taskName,
  startDate: '09/01/2026', finishDate: finish, milestone: '', owner, contractor: 'Tallis Build',
  percentComplete: percent, priority: 'Medium', status: percent >= 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z', ...extra,
}) as unknown as ScheduleItem;
const photo = (id: string, area: string, caption: string) => ({
  id, uri: `file:///photos/${id}.jpg`, caption, category: 'Progress', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
  fileName: `${id}.jpg`, mimeType: 'image/jpeg', selectedAreaName: area,
});
const update = (id: string, item: ScheduleItem | null, area: string, date: string, notes: string, photos: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  id, projectName: PROJECT, scheduleProjectName: PROJECT, date, photos, recipients: { contactIds: [] }, notes, status: 'sent',
  scheduleItemId: item?.id ?? null, scheduleTaskName: item?.taskName ?? null, selectedAreaName: area, ...extra,
}) as unknown as ProjectUpdate;

const beams = task('q1', 'Pour grade beams', 'Foundation', 55, '10/16/2026', 'Ines');
const steel = task('q2', 'Erect steel frame', 'Structure', 20, '10/30/2026', 'Ines');
const drains = task('q3', 'Install roof drains', 'Roof', 0, '11/12/2026', 'Otto', { status: 'Waiting' });
const rough = task('q4', 'Rough-in electrical', 'Level 1', 100, '09/28/2026', 'Otto');
const drywall = task('q5', 'Hang drywall', 'Level 1', 10, '10/22/2026', 'Pia', { priority: 'High' });
const paving = task('q6', 'Site paving', 'Site', 0, '12/01/2026', 'Pia');
const TASKS = [beams, steel, drains, rough, drywall, paving];
const WALKED = 'Owner walked the job with the lender.';
const FENCING = 'Temporary fencing was installed along the street frontage.';
const WASHOUT = 'Concrete washout pit was installed near the gate.';
const UPDATES = [
  update('qu01', beams, 'Foundation', '2026-10-01', 'Grade beam rebar is installed on the north line.', [photo('qp01a', 'Foundation', 'North line rebar'), photo('qp01b', 'Foundation', 'Rebar chairs at grid 2')]),
  update('qu02', steel, 'Structure', '2026-10-03', 'Steel delivery is delayed two days. Erection cannot start at grid 4.', [photo('qp02', 'Structure', 'Empty laydown at grid 4')]),
  update('qu03', drains, 'Roof', '2026-10-05', 'Please confirm the roof drain submittal with the engineer.'),
  update('qu04', null, 'Level 1', '2026-10-06', 'Mockup panel was signed off by the architect.'),
  update('qu05', null, 'Site', '2026-10-07', 'Conference table and chairs were delivered to the trailer.'),
  // Three notes with NO area and no task: they are filed under the project's own name.
  update('qu06', null, '', '2026-10-07', WALKED),
  update('qu07', null, '', '2026-10-08', FENCING),
  update('qu08', null, '', '2026-10-09', WASHOUT),
  update('qu09', null, 'Site', '2026-10-09', 'A desk and a monitor are visible in the trailer.', [photo('qp09', 'Site', '')], { pieSuggestedNote: 'A desk and a monitor are visible in the trailer.', pieSuggestedNoteAccepted: true }),
  update('qu10', drains, 'Roof', '2026-10-10', '', [photo('qp10', 'Roof', 'Roof drain bodies on the pallet')]),
  update('qu11', drywall, 'Level 1', '2026-10-12', 'Drywall is hung on the east corridor.', [photo('qp11a', 'Level 1', 'East corridor board'), photo('qp11b', 'Level 1', '')]),
  update('qu12', paving, 'Site', '2026-10-12', 'Paving sub asked for the gate code.'),
];
// What the iPad held on earlier days and no longer holds: a field update he has since deleted, and its task.
const GONE_TASK = task('q-gone', 'Shore the utility trench', 'Site', 0, '10/14/2026', 'Otto', { status: 'Waiting' });
const GONE_UPDATE = update('qu-gone', GONE_TASK, 'Site', '2026-10-11', 'Trench shoring collapsed near the QUOKKA manhole. Crew is stood down.');

const NOW = '2026-10-13T17:00:00.000Z';
const HEADING = 'WORK AREAS / PHOTO NOTES';
const OWN_GROUP = `• ${PROJECT} — ${PROJECT}: `;
const LATEST = 'Latest update: Paving sub asked for the gate code. Latest photo: East corridor board Schedule focus: Pour grade beams (due 10/16/2026).';
const MODEL = 'runtime-current-situation';

type Draft = {
  sourceEvidence: Array<{ id: string; summary: string; actionRequired?: string | null }>;
  actionItems: Array<{ action: string; sourceEvidenceIds: string[] }>;
  risks: Array<{ summary: string; sourceEvidenceIds: string[] }>;
  locationGroups: Array<{ workAreas: Array<{ projectName: string; title: string; bullets: Array<{ text: string }> }> }>;
};

/** Reports opened on `device` at `now`: the fingerprint, the report as written in both formats, and the app's own draft. */
async function open(device: string, updates: ProjectUpdate[], items: ScheduleItem[], now: string = NOW) {
  jest.useFakeTimers({ now: Date.parse(now), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
  try {
    mockDevice = device;
    const truths = buildDAVEReportProjectTruths({
      projects: [{ name: PROJECT, projectId: 'report:quarry-street-annex' }], projectRecords: [{ name: PROJECT }] as never,
      updates, scheduleItems: items, knownScheduleItems: items, knownScheduleDocuments: [], projectAreas: [], referenceDocuments: [],
    } as never);
    const fingerprint = buildDAVEReportSourceFingerprint(truths);
    const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: [PROJECT], previousSnapshot: null, scheduleItems: items } as never);
    const scope = buildDailyReportAuthorityScope({
      selectedProjectName: PROJECT, selectedProjectNames: [PROJECT], projectRecords: [{ id: 'rec-quarry', name: PROJECT }],
      updates, scheduleItems: items, knownScheduleItems: items, currentUpdate: null,
      projectAreas: [], referenceDocuments: [], projectDocuments: [], captureMemories: [], contacts: { contacts: [] },
    } as never);
    const runtimeContext = {
      projectName: PROJECT, projectNames: [PROJECT], reportType: 'daily_project_update',
      updates: scope.updates, scheduleItems: scope.scheduleItems, knownScheduleItems: scope.scheduleItems, currentUpdate: null,
      projectAreas: [], contacts: { contacts: [] }, referenceDocuments: [], surface: 'reports',
    };
    const core = await buildLivePIECoreIntelligence({
      runtimeContext, authorityCore: null, reportType: 'daily_project_update', reportProjectNames: [PROJECT],
      organizationId: 'local-unverified-anonymous', projectId: 'project-quarry-street-annex',
      verifiedLearningEvents: [], identityTrusted: false, cloudAvailable: false, runtime: buildRuntime(runtimeContext as never),
    } as never);
    const draft = core.reportDraft as unknown as Draft;
    const body = String(enhanceDAVEReportDraft(draft as never, briefing, 'project_manager').body);
    const executive = String(enhanceDAVEReportDraft(draft as never, briefing, 'executive').body);
    const lines = body.split('\n');
    const section = lines.slice(lines.indexOf(HEADING) + 1).filter(line => line.startsWith('• '));
    return { fingerprint, body, executive, section, draft };
  } finally {
    jest.useRealTimers();
  }
}
type Report = Awaited<ReturnType<typeof open>>;
/** The lines printed under the project's own name: the notes recorded with no area, and the "Latest update" line. */
const ownGroup = (report: Report) => report.section.filter(line => line.startsWith(OWN_GROUP)).map(line => line.slice(OWN_GROUP.length));
/** The same lines as the Reports screen's "Work Areas & Photos" cards list them (one list feeds both). */
const ownCard = (report: Report) => report.draft.locationGroups.flatMap(group => group.workAreas
  .filter(area => area.projectName === PROJECT && area.title === PROJECT).flatMap(area => area.bullets.map(bullet => bullet.text)));
const fromTheModel = (report: Report) => report.draft.sourceEvidence.find(item => item.id === MODEL);
/** What the saved model is on this device: it reads as a problem, or it advises an action (or both). */
const kindOfModel = (report: Report) => ({
  readsAsAProblem: report.draft.risks.some(risk => risk.sourceEvidenceIds.includes(MODEL)),
  advisesAnAction: Boolean(fromTheModel(report)?.actionRequired?.trim()),
});

beforeEach(() => mockDevices.clear());

describe('B232 item 4b: the saved model\'s line takes no place among a work area\'s lines', () => {
  it('R1. three notes with no area: the two about the work and the "Latest update" line are printed, in either list order', async () => {
    const orders: Array<[string, ProjectUpdate[], ScheduleItem[]]> = [
      ['the phone\'s order', [...UPDATES].reverse(), TASKS],
      ['the iPad\'s order', UPDATES, [...TASKS].reverse()],
    ];
    for (const [order, updates, items] of orders) {
      const report = await open(`never-open-${order}`, updates, items);
      note(`R1-${order.replace(/[^a-z]+/gi, '-')}.txt`, report.body);
      // On a device that never had the project open the model sums it up in one sentence that reads as a problem
      // ("... 0 are at risk, 0 are blocked ..."): the form that took the "first problem" place.
      expect({ order, ...kindOfModel(report) }).toEqual({ order, readsAsAProblem: true, advisesAnAction: false });
      // Build 231's own three lines. The third note ("Owner walked ...") is the oldest of the three and waits behind
      // them under the three-line allowance, as any fourth line does.
      expect({ order, lines: ownGroup(report) }).toEqual({ order, lines: [WASHOUT, LATEST, FENCING] });
      expect({ order, cards: ownCard(report) }).toEqual({ order, cards: [WASHOUT, LATEST, FENCING] });
      expect(report.section.filter(line => line.includes(WALKED))).toEqual([]);
      // No word of the model in any written line (part A), and the model is still in the draft (decision A2).
      const sentence = String(fromTheModel(report)?.summary);
      expect(sentence).toEqual(expect.stringContaining('reality objects modeled'));
      expect([report.body, report.executive].filter(text => text.includes(sentence.slice(0, 40)))).toEqual([]);
      expect(report.draft.risks.filter(risk => risk.sourceEvidenceIds.includes(MODEL))).toHaveLength(1);
    }
  });

  const lower = (items: ScheduleItem[]) => items.map(item => (item.percentComplete >= 20 && item.percentComplete < 100 ? { ...item, percentComplete: item.percentComplete - 20 } as ScheduleItem : item));
  // "Blocked" is the reviewer's own word for that day's status of the steel task; his history is kept to the letter.
  const blocked = (items: ScheduleItem[]) => items.map(item => (item.id === 'q2' ? { ...item, status: 'Blocked', priority: 'High' } as unknown as ScheduleItem : item));
  const IPAD_TASKS = [...TASKS].reverse();
  /** What the iPad had open on earlier days: the reviewer's three histories. */
  const histories: Array<[string, () => Promise<void>]> = [
    ['it held an update he has since deleted', async () => {
      await open('ipad', [...UPDATES.slice(0, -2), GONE_UPDATE], [...IPAD_TASKS, GONE_TASK], '2026-10-12T17:00:00.000Z');
    }],
    ['the tasks stood lower and one was blocked', async () => {
      await open('ipad', UPDATES.slice(0, -2), lower(blocked(IPAD_TASKS)), '2026-10-12T17:00:00.000Z');
    }],
    ['three days of both', async () => {
      await open('ipad', UPDATES.slice(0, 8), lower(IPAD_TASKS), '2026-10-10T17:00:00.000Z');
      await open('ipad', [...UPDATES.slice(0, 9), GONE_UPDATE], [...blocked(IPAD_TASKS), GONE_TASK], '2026-10-11T17:00:00.000Z');
      await open('ipad', [...UPDATES.slice(0, 10), GONE_UPDATE], [...IPAD_TASKS, GONE_TASK], '2026-10-12T17:00:00.000Z');
    }],
  ];
  it.each(histories)('R2. the phone opens the project for the first time, the iPad had it open before (%s): the same whole text', async (history, earlierDays) => {
    await earlierDays();
    // Today the phone, never open before, writes the report it sends...
    const phone = await open('phone', [...UPDATES].reverse(), TASKS);
    // ...and half an hour later the iPad opens Reports with the same records.
    const ipad = await open('ipad', UPDATES, IPAD_TASKS, new Date(Date.parse(NOW) + 30 * 60 * 1000).toISOString());
    const name = history.replace(/[^a-z]+/gi, '-');
    note(`R2-${name}.phone.txt`, phone.body);
    note(`R2-${name}.ipad.txt`, ipad.body);
    // Their saved models are of two kinds: the phone's reads as a problem, the iPad's advises an action.
    expect({ history, phone: kindOfModel(phone), ipad: kindOfModel(ipad).advisesAnAction }).toEqual({ history, phone: { readsAsAProblem: true, advisesAnAction: false }, ipad: true });
    expect(fromTheModel(ipad)?.summary).not.toBe(fromTheModel(phone)?.summary);
    // "Your other device already sent this report" is said by the fingerprint, so the texts have to be one text.
    const onlyOn = (one: Report, other: Report) => one.body.split('\n').filter(line => !other.body.split('\n').includes(line));
    expect({ history, sameFingerprint: ipad.fingerprint === phone.fingerprint, onlyOnThePhone: onlyOn(phone, ipad), onlyOnTheIpad: onlyOn(ipad, phone) })
      .toEqual({ history, sameFingerprint: true, onlyOnThePhone: [], onlyOnTheIpad: [] });
    expect({ history, sameText: ipad.body === phone.body, sameExecutive: ipad.executive === phone.executive }).toEqual({ history, sameText: true, sameExecutive: true });
    expect({ history, lines: ownGroup(ipad) }).toEqual({ history, lines: [WASHOUT, LATEST, FENCING] });
    expect({ history, cards: ownCard(ipad) }).toEqual({ history, cards: [WASHOUT, LATEST, FENCING] });
    // Decision A2 stands: the iPad's advice is still among the draft's action items, for the app's own screens.
    const advised = ipad.draft.actionItems.filter(item => item.sourceEvidenceIds.includes(MODEL));
    expect({ history, advised: advised.length }).toEqual({ history, advised: 1 });
    expect(String(fromTheModel(ipad)?.actionRequired)).toEqual(expect.stringContaining(advised[0].action.replace(/\.+$/, '')));
    // No written line carries it (part A).
    expect([ipad.body, ipad.executive].filter(text => text.includes(advised[0].action.replace(/\.+$/, '')))).toEqual([]);
  });
});
