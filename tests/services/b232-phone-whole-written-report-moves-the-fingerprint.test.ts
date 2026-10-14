/**
 * Build 232 item 2, part C (the coordinator's decision on reports review pass 4, P4-1 and P4-2): the guard of
 * r8-report-fingerprint-moves-whenever-the-report-does, for the phone's WHOLE written report.
 *
 * That guard hands the report recipe a stub of the app's own draft. The Reports screen does not: the opening line,
 * the closing line and the whole section WORK AREAS / PHOTO NOTES come from the app's older report writer
 * (services/PIEReporter.ts, fed by PIEEvidenceFusion through PIECoreIntelligence). So here the draft is the app's
 * own, made by the app's own code from the very field updates and tasks the recipe is given, and the report is put
 * together as screens/ReportsScreen.tsx does it.
 *
 * "Your other device already sent this report" is said by the 2.0 fingerprint, and it has to be true to the reader:
 *   1. two devices holding the same updates in different list orders: the same text, the same fingerprint;
 *      and (item 3) the same tasks in different list orders: the same text, the same fingerprint;
 *   2. the same saved project read on another day, no task crossing a line: the same text;
 *      and on ANY day, a text that moved means a fingerprint that moved;
 *   3. one change at a time to everything the section reads: a text that moved means a fingerprint that moved.
 *   4. (item 4 part A) the model of the project the app saves on a device does not change the written report:
 *      the draft made as the app's provider makes it (buildRuntime, then the live Core), on a device that never
 *      saw the project, on one that was open before today's records, and on one that held a record deleted since.
 *      4b. (item 4b) and it takes no place among a work area's three lines: with NO saved model (the writer's own
 *      two steps on the draft's evidence without that one piece), with one that reads as a problem and with one
 *      that advises an action, the whole text is the same. On the generated projects, and on six more that also
 *      hold field notes recorded with no area and no task: those are filed where the model's line is filed.
 * The other direction (the fingerprint moves and no word does) costs one more approval and is counted, not failed.
 *
 * What the guard found that is NOT settled is pinned by name under "KNOWN" below, so nothing joins it unseen and
 * whoever settles one has to take it off the list.
 *
 * Random saved projects from a seeded generator of this file. B232_SEEDS sets how many (default 3; B232_FIRST the
 * first seed). B232_OUT names a file the findings are written to. Synthetic data. No network.
 */
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
// One app storage per device: the live Core saves its model of the project there (check 4).
const mockDevices = new Map<string, Map<string, string>>();
let mockDevice = 'none';
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

import * as fs from 'fs';
import { buildLivePIECoreIntelligence, buildPIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { scheduleTasksInReportOrder } from '../../services/PIEEvidenceFusion';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, enhanceDAVEReportDraft } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildConstructionUnderstanding, buildProjectNarrative } from '../../services/PIEReporter';
import { buildRuntime } from '../../services/PIERuntime';
import type { ContactBook, ProjectArea, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';

jest.setTimeout(600_000);

// ---- a saved project ----
type World = { items: ScheduleItem[]; updates: ProjectUpdate[]; documents: ReferenceDocument[]; areas: ProjectArea[]; contacts: ContactBook };
type Rand = () => number;
function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T,>(rand: Rand, list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const shuffled = <T,>(rand: Rand, list: readonly T[]): T[] => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};
/** The day the report is first read: Monday 5 Oct 2026, 16:00 UTC (9:00 in the morning Pacific). */
const DAY_0 = Date.parse('2026-10-05T16:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(DAY_0 + days * DAY).toISOString();
/** A field update's date as the app saves it: a day, with no time of day ("2026-10-03"). */
const savedDay = (days: number) => at(days).slice(0, 10);
/** A task's date as the schedule saves it: 10/09/2026. */
const date = (days: number) => { const d = new Date(DAY_0 + days * DAY); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`; };

/** How many days after day 0 a task is due. */
const dueIn = (item: ScheduleItem) => { const [month, dayOfMonth, year] = item.finishDate.split('/').map(Number); return Math.round((Date.UTC(year, month - 1, dayOfMonth) - Date.UTC(2026, 9, 5)) / DAY); };

const AREAS = ['Level 1', 'Level 2', 'Roof', 'Site'] as const;
const TASK_NAMES = ['Pour slab', 'Frame walls', 'Set roof trusses', 'Paint lobby', 'Rough in electrical', 'Install storefront', 'Grade the lot', 'Hang drywall'] as const;
const NOTES = [
  'Slab forms are set on the east bay. Dana to order rebar by Friday.',
  'Framing is complete on Level 2. Inspection passed.',
  'Roof trusses were delivered. Crane is needed next week.',
  'Primer started in the lobby. Wet floor signs are missing.',
  'West bay rebar failed inspection. Pour is on hold.',
  'Electrical rough in is 60 percent installed on the north side.',
  'Storefront glass was delivered damaged. Luis to confirm the reorder.',
  'Drywall is hung on the corridor walls. Taping starts tomorrow.',
  'Grading is finished at the east lot. Please verify the drain elevations.',
] as const;
const CAPTIONS = ['East bay forms', 'Framing complete', 'Trusses on site', 'Lobby primer', 'West bay rebar', 'Conduit at north wall', 'Cracked storefront glass', 'Corridor drywall', 'East lot graded'] as const;

const task = (id: string, taskName: string, area: string, percent: number, finish: string, owner: string, extra: Record<string, unknown> = {}): ScheduleItem => ({
  id, projectName: 'Tower', scheduleProjectName: 'Tower', locationName: area, taskName,
  startDate: '09/01/2026', finishDate: finish, milestone: '', owner, contractor: 'Acme',
  percentComplete: percent, priority: 'Medium', status: percent >= 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z', ...extra,
}) as unknown as ScheduleItem;
const COMPARISON = {
  status: 'analysis_complete', title: 'Photo comparison', summary: 'Rebar has been installed in the west bay footing.', visibleChange: 'Rebar is in the west bay footing.',
  location: 'Level 1', comparisonConfidence: 'high', captureLimitations: [], projectProgress: 'supported', repeatPhotoGuidance: null, authorityMessage: '',
  currentObservation: 'Rebar mat in place; no concrete yet.', changedFromPrior: 'Rebar installed since the prior photo.', priorUpdateUsed: 'u-0',
  comparability: 'strong', provenance: 'visual_only', userReview: 'confirmed', assessmentDisposition: 'finding', findings: [{ findingType: 'added', description: 'Rebar' }],
};
const photo = (id: string, area: string, caption: string, extra: Record<string, unknown> = {}) => ({
  id, uri: `file:///phone/photos/${id}.jpg`, caption, category: 'Progress', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
  fileName: `${id}.jpg`, mimeType: 'image/jpeg', selectedAreaName: area, ...extra,
});
const update = (id: string, item: ScheduleItem, when: string, notes: string, photos: unknown[] = []): ProjectUpdate => ({
  id, projectName: 'Tower', scheduleProjectName: 'Tower', date: when, photos, recipients: { contactIds: [] }, notes, status: 'sent',
  scheduleItemId: item.id, scheduleTaskName: item.taskName, selectedAreaName: item.locationName || '',
}) as unknown as ProjectUpdate;

/**
 * A saved project as one device holds it: seven tasks (one complete, one overdue, one due within the week, one
 * within two weeks, the rest later), and seven field updates with photos, in no order of their dates. Their ids
 * run in the order they were recorded, as the app's own ids do; twice, two were recorded on one day (the tie the
 * update's id breaks); and one photo is a comparison he confirmed.
 */
function project(seed: number): World {
  const rand = seeded(seed);
  const names = shuffled(rand, TASK_NAMES).slice(0, 7);
  const finishes = shuffled(rand, [-20, -3 - Math.floor(rand() * 4), 2 + Math.floor(rand() * 4), 9 + Math.floor(rand() * 4), 17 + Math.floor(rand() * 6), 40, 75]);
  const items = names.map((name, index) => {
    const finish = finishes[index];
    const percent = finish === -20 ? 100 : pick(rand, [0, 10, 40, 60]);
    return task(`t${index + 1}`, name, pick(rand, AREAS), percent, date(finish), pick(rand, ['Dana', 'Luis', 'Mara']), {
      ...(index === 2 ? { priority: 'High' } : {}),
      ...(index === 4 && percent < 100 ? { status: 'Waiting' } : {}),
    });
  });
  const notes = shuffled(rand, NOTES);
  const recordedOn = [-9, -7, -5, -5, -2, -2, -1];   // days before the report, in the order they were recorded
  const updates = recordedOn.map((days, index) => {
    const item = pick(rand, items);
    const area = item.locationName || 'Site';
    const photos = Array.from({ length: Math.floor(rand() * 3) }, (_unused, photoIndex) => photo(
      `p${index + 1}${'abc'[photoIndex]}`, rand() < 0.8 ? area : pick(rand, AREAS), `${pick(rand, CAPTIONS)}, grid ${'ABCDEFG'[index]}${photoIndex + 1}`,
      rand() < 0.25 ? { actionRequired: 'Confirm the delivery date', actionOwner: pick(rand, ['Dana', 'Luis']) } : rand() < 0.15 ? { category: 'Open Issue' } : {},
    ));
    return update(`u${index + 1}`, item, savedDay(days), notes[index], photos);
  });
  // One comparison he confirmed, five days before the report: its photo and the earlier one it was set against.
  const earlier = photo('p-earlier', 'Level 1', 'West bay footing, forms only');
  const confirmed = photo('p-confirmed', 'Level 1', 'West bay footing with rebar', { photoIntelligence: { ...COMPARISON, diagnostics: { selectedPriorPhotoId: 'p-earlier' } } });
  updates[0] = { ...updates[0], photos: [...updates[0].photos, earlier] } as ProjectUpdate;
  updates[3] = { ...updates[3], photos: [...updates[3].photos, confirmed] } as ProjectUpdate;
  return {
    items,
    updates: shuffled(rand, updates),
    documents: [],
    areas: [],
    contacts: { contacts: [{ id: 'c1', name: 'Dana Reyes', email: 'dana@example.com', phone: '555-0100' }] },
  };
}

// ---- what the phone makes of it, as the Reports screen does ----
const HEADING = 'WORK AREAS / PHOTO NOTES';
type Read = { fingerprint: string; text: string; section: string; areas: string[] };
/** The fingerprint that decides "already sent", and the written report in both formats, read at `now`. */
function phone(world: World, now: string = at(0)): Read {
  jest.useFakeTimers({ now: Date.parse(now), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
  try {
    const truths = buildDAVEReportProjectTruths({
      projects: [{ name: 'Tower', projectId: 'report:tower' }], projectRecords: [{ name: 'Tower' }] as never,
      updates: world.updates, scheduleItems: world.items, knownScheduleItems: world.items, knownScheduleDocuments: world.documents,
      projectAreas: world.areas, referenceDocuments: world.documents,
    });
    const fingerprint = buildDAVEReportSourceFingerprint(truths);
    const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: ['Tower'], previousSnapshot: null, scheduleItems: world.items } as never);
    // The app's own draft, as providers/PIELiveAuthorityProvider makes it for the Reports screen.
    const core = buildPIECoreIntelligence({
      runtimeContext: {
        projectName: 'Tower', projectNames: ['Tower'], reportType: 'daily_project_update',
        updates: world.updates, scheduleItems: world.items, knownScheduleItems: world.items, currentUpdate: null,
        projectAreas: world.areas, contacts: world.contacts, referenceDocuments: world.documents, surface: 'reports',
      } as never,
      reportType: 'daily_project_update' as never, reportProjectNames: ['Tower'], organizationId: 'local-unverified-anonymous', projectId: 'project-tower',
    } as never);
    const live = core.reportDraft as never;
    // What the screen falls back on until the live draft is ready (ReportsScreen: runtime.response.reportDraft).
    const fallback = (core as unknown as { runtime?: { response?: { reportDraft?: unknown } } }).runtime?.response?.reportDraft as never;
    const projectManager = String(enhanceDAVEReportDraft(live, briefing, 'project_manager').body);
    const text = [
      projectManager,
      String(enhanceDAVEReportDraft(live, briefing, 'executive').body),
      ...(fallback ? [String(enhanceDAVEReportDraft(fallback, briefing, 'project_manager').body)] : []),
    ].join('\n=====\n');
    const from = projectManager.indexOf(HEADING);
    // The work areas as the Reports screen lists them: "<project> — <area>".
    const areas = (core.reportDraft as unknown as { locationGroups: Array<{ workAreas: Array<{ projectName: string; title: string }> }> })
      .locationGroups.flatMap(group => group.workAreas.map(area => `${area.projectName} — ${area.title}`));
    return { fingerprint, text, section: from >= 0 ? projectManager.slice(from) : '', areas };
  } finally {
    jest.useRealTimers();
  }
}

/**
 * The same, with the app's own draft made as providers/PIELiveAuthorityProvider makes it on a workspace that keeps
 * its model on the device: the only road that SAVES a model (the plain Core above saves nothing).
 */
type LiveDraft = {
  sourceEvidence: Array<{ id: string; summary: string; actionRequired?: string | null }>;
  risks: Array<{ sourceEvidenceIds: string[] }>;
  locationGroups: unknown[];
};
type Live = { fingerprint: string; text: string; draft: LiveDraft; briefing: ReturnType<typeof buildDAVEReportBriefing> };
async function phoneLive(device: string, world: World, now: string = at(0)): Promise<Live> {
  jest.useFakeTimers({ now: Date.parse(now), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
  try {
    mockDevice = device;
    const truths = buildDAVEReportProjectTruths({
      projects: [{ name: 'Tower', projectId: 'report:tower' }], projectRecords: [{ name: 'Tower' }] as never,
      updates: world.updates, scheduleItems: world.items, knownScheduleItems: world.items, knownScheduleDocuments: world.documents,
      projectAreas: world.areas, referenceDocuments: world.documents,
    });
    const fingerprint = buildDAVEReportSourceFingerprint(truths);
    const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: ['Tower'], previousSnapshot: null, scheduleItems: world.items } as never);
    const runtimeContext = {
      projectName: 'Tower', projectNames: ['Tower'], reportType: 'daily_project_update',
      updates: world.updates, scheduleItems: world.items, knownScheduleItems: world.items, currentUpdate: null,
      projectAreas: world.areas, contacts: world.contacts, referenceDocuments: world.documents, surface: 'reports',
    };
    const core = await buildLivePIECoreIntelligence({
      runtimeContext, authorityCore: null, reportType: 'daily_project_update', reportProjectNames: ['Tower'],
      organizationId: 'local-unverified-anonymous', projectId: 'project-tower',
      verifiedLearningEvents: [], identityTrusted: false, cloudAvailable: false, runtime: buildRuntime(runtimeContext as never),
    } as never);
    const text = (['project_manager', 'executive'] as const).map(format => String(enhanceDAVEReportDraft(core.reportDraft as never, briefing, format).body)).join('\n=====\n');
    return { fingerprint, text, draft: core.reportDraft as unknown as LiveDraft, briefing };
  } finally {
    mockDevice = 'none';
    jest.useRealTimers();
  }
}

/** The one piece of the writer's evidence that comes from the model the app saves (services/PIEReporter.ts). */
const SAVED_MODEL = 'runtime-current-situation';
/**
 * The whole written text with NO saved model: the writer's own two steps (the understanding, then the narrative)
 * on the draft's own evidence without that one piece. From the whole evidence the same two steps give the draft's
 * own work areas, which is checked first.
 */
function writtenWithNoSavedModel(report: Live, world: World): string {
  const input = { reportType: 'daily_project_update', selectedProjectNames: ['Tower'], currentUpdate: null, savedUpdates: world.updates, scheduleItems: world.items, projectAreas: world.areas, contacts: world.contacts };
  const workAreas = (evidence: LiveDraft['sourceEvidence']) => buildProjectNarrative(buildConstructionUnderstanding(input as never, evidence as never)).locationGroups;
  expect(JSON.stringify(workAreas(report.draft.sourceEvidence))).toBe(JSON.stringify(report.draft.locationGroups));
  const draft = { ...report.draft, locationGroups: workAreas(report.draft.sourceEvidence.filter(item => item.id !== SAVED_MODEL)) };
  return (['project_manager', 'executive'] as const).map(format => String(enhanceDAVEReportDraft(draft as never, report.briefing, format).body)).join('\n=====\n');
}

/** Field notes recorded with NO area and no task: the report files them under the project's own name. */
const NO_AREA_NOTES = {
  work: ['Temporary fencing was installed along the street frontage.', 'Concrete washout pit was installed near the gate.', 'Silt fence was installed along the north property line.', 'Temporary power panel was installed at the trailer.'],
  plain: ['Owner walked the job with the lender.', 'Neighbor asked about work hours.', 'Dumpster was swapped this morning.'],
  problem: ['Street closure permit expired. Deliveries are on hold.', 'Crane permit was denied. Truss setting is blocked.'],
  step: ['Please confirm the street closure dates with the city.', 'Please verify the survey stakes at the east corner.'],
} as const;
/** Six shapes of two to four such notes; the first is review pass 5's (R1): one plain note and two about the work. */
const NO_AREA_SHAPES: ReadonlyArray<ReadonlyArray<keyof typeof NO_AREA_NOTES>> = [
  ['plain', 'work', 'work'],
  ['work', 'work'],
  ['plain', 'plain', 'work', 'step'],
  ['problem', 'work', 'plain'],
  ['work', 'work', 'work', 'plain'],
  ['step', 'problem', 'plain', 'work'],
];
/**
 * Three of the six are quiet projects: no task is overdue. There the model of a device that never saw the project
 * sums it up in a sentence that reads as a problem ("... 0 are at risk, 0 are blocked ..."); with an overdue task
 * it advises an action first ("Verify risk for ...").
 */
const QUIET = new Set([2, 3, 5]);
/** Generated project `seed` (1 to 6) with its shape of no-area notes added, on days of the seed's choosing. */
function projectWithNotesOfNoArea(seed: number): World {
  const generated = project(seed);
  const world = QUIET.has(seed)
    ? { ...generated, items: generated.items.map(item => (dueIn(item) < 0 && Number(item.percentComplete) < 100 ? { ...item, finishDate: date(30) } : item)) }
    : generated;
  const rand = seeded(seed * 15485863);
  const used = new Set<string>();
  const notes = NO_AREA_SHAPES[(seed - 1) % NO_AREA_SHAPES.length].map((kind, index) => {
    const text = shuffled(rand, NO_AREA_NOTES[kind]).find(candidate => !used.has(candidate)) as string;
    used.add(text);
    // Every third one carries a photo that has no area either.
    const photos = (seed + index) % 3 === 0 ? [photo(`pn${index + 1}`, '', `Street frontage, view ${index + 1}`)] : [];
    return {
      id: `n${index + 1}`, projectName: 'Tower', scheduleProjectName: 'Tower', date: savedDay(-Math.floor(rand() * 9)), photos, recipients: { contactIds: [] },
      notes: text, status: 'sent', scheduleItemId: null, scheduleTaskName: null, selectedAreaName: '',
    } as unknown as ProjectUpdate;
  });
  return { ...world, updates: shuffled(rand, [...world.updates, ...notes]) };
}

const SEEDS = Array.from({ length: Number(process.env.B232_SEEDS || 3) }, (_unused, index) => Number(process.env.B232_FIRST || 1) + index);
const findings: string[] = [];
const say = (line: string) => { findings.push(line); };
afterAll(() => { if (process.env.B232_OUT) fs.writeFileSync(process.env.B232_OUT, `${findings.join('\n')}\n`); });
/** The lines of `after` that `before` does not have, for a failure a person can read. */
const newLines = (before: string, after: string) => { const had = new Set(before.split('\n')); return [...new Set(after.split('\n').filter(line => !had.has(line)))]; };

/** Newest first by the update's own date; the updates of one day, the later id (the later recorded) first. */
const newestFirst = (updates: readonly ProjectUpdate[]) => [...updates].sort((left, right) => Date.parse(right.date) - Date.parse(left.date) || (left.id > right.id ? -1 : left.id < right.id ? 1 : 0));
const withUpdate = (world: World, id: string, change: (item: ProjectUpdate) => ProjectUpdate): World => ({ ...world, updates: world.updates.map(item => (item.id === id ? change(item) : item)) });
const withItem = (world: World, id: string, change: (item: ScheduleItem) => ScheduleItem): World => ({ ...world, items: world.items.map(item => (item.id === id ? change(item) : item)) });
const withPhoto = (world: World, change: (item: Record<string, unknown>) => Record<string, unknown>): World => {
  const holder = newestFirst(world.updates).find(item => item.photos.length > 0);
  return holder ? withUpdate(world, holder.id, item => ({ ...item, photos: [change(item.photos[0] as never) as never, ...item.photos.slice(1)] })) : world;
};

describe('B232 item 2 part C: the phone\'s whole written report against the 2.0 fingerprint', () => {
  it('the generator makes the section in full: a latest update, a latest photo, a schedule focus, image numbers', () => {
    for (const seed of SEEDS) {
      const { section, fingerprint, areas } = phone(project(seed));
      say(`=== seed ${seed}: the section on day 0 ===\n${section}`);
      expect(fingerprint.split(':')[0]).toBe('dave-report-source/2.0');
      expect(section).toContain(HEADING);
      expect(section).toMatch(/Latest update: /);
      expect(section).toMatch(/Schedule focus: /);
      expect(section).toMatch(/See Images? \d/);
      // Item 3 part 2: no line is filed under the year of a date it prints ("Tower — 2026 Site"),
      expect(section).not.toMatch(/^• Tower — 20\d\d /m);
      // and the Reports screen lists each work area once.
      expect(areas.filter((area, index) => areas.indexOf(area) !== index)).toEqual([]);
      expect(areas.filter(area => /— 20\d\d /.test(area))).toEqual([]);
    }
  });

  it('1. two devices holding the same updates in different list orders: the same text, the same fingerprint', () => {
    for (const seed of SEEDS) {
      const world = project(seed);
      const rand = seeded(seed * 7919);
      const byDate = newestFirst(world.updates);
      const orders: Array<[string, ProjectUpdate[]]> = [
        ['as the device that recorded every one of them holds them (newest first)', byDate],
        ['as a device that received the newest by sync holds them (the newest last)', [...byDate.slice(1), byDate[0]]],
        ['oldest first', [...byDate].reverse()],
        ['shuffled', shuffled(rand, world.updates)],
        ['shuffled again', shuffled(rand, world.updates)],
      ];
      const base = phone(world);
      // "Latest update" is the newest by its own date, whichever list it is read from.
      expect(base.section).toContain(`Latest update: ${byDate[0].notes}`);
      for (const [name, updates] of orders) {
        const other = phone({ ...world, updates });
        const same = { text: other.text === base.text, fingerprint: other.fingerprint === base.fingerprint };
        if (!same.text) say(`seed ${seed}, order "${name}": THE TEXT DIFFERS\n${newLines(base.text, other.text).map(line => `    ${line}`).join('\n')}`);
        expect({ seed, order: name, ...same }).toEqual({ seed, order: name, text: true, fingerprint: true });
      }
    }
  });

  it('1b. the updates of one day: the update\'s id decides, the later recorded first, the same on every device', () => {
    const world = project(SEEDS[0]);
    // The whole project recorded in one day: only the ids can order it.
    const oneDay = { ...world, updates: world.updates.map(item => ({ ...item, date: savedDay(-1) })) };
    const base = phone(oneDay);
    expect(base.section).toContain(`Latest update: ${(oneDay.updates.find(item => item.id === 'u7') as ProjectUpdate).notes}`);
    for (const updates of [[...oneDay.updates].reverse(), shuffled(seeded(11), oneDay.updates)]) {
      const other = phone({ ...oneDay, updates });
      expect({ text: other.text === base.text, fingerprint: other.fingerprint === base.fingerprint }).toEqual({ text: true, fingerprint: true });
    }
  });

  it('1d. two comparisons he confirmed on one day, in two updates: the one quoted is the same on every device', () => {
    const roof = task('roof', 'Set roof trusses', 'Roof', 0, date(80), 'Luis');
    const grade = task('grade', 'Grade the lot', 'Site', 0, date(90), 'Mara');
    const confirmed = (summary: string, area: string, prior: string) => ({ photoIntelligence: { ...COMPARISON, summary, location: area, diagnostics: { selectedPriorPhotoId: prior } } });
    const world: World = {
      items: [roof, grade],
      updates: [
        update('u4', grade, savedDay(-3), '', [photo('p4', 'Site', 'East lot from the gate', confirmed('The east lot has been graded to the drain.', 'Site', 'p2'))]),
        update('u3', roof, savedDay(-3), '', [photo('p3', 'Roof', 'Trusses from the lift', confirmed('Roof trusses have been set on the north half.', 'Roof', 'p1'))]),
        update('u2', grade, savedDay(-8), '', [photo('p2', 'Site', 'East lot before grading')]),
        update('u1', roof, savedDay(-8), '', [photo('p1', 'Roof', 'Roof before the trusses')]),
      ],
      documents: [], areas: [], contacts: { contacts: [] },
    };
    const base = phone(world);
    // The later recorded of the two (u4) is the one quoted, as on the phone that recorded them.
    expect(base.section).toContain('The east lot has been graded to the drain.');
    let fingerprints = 1;
    for (const updates of [[...world.updates].reverse(), [world.updates[1], world.updates[0], world.updates[3], world.updates[2]]]) {
      const other = phone({ ...world, updates });
      expect(other.text).toBe(base.text);
      if (other.fingerprint !== base.fingerprint) fingerprints += 1;
    }
    // Counted, not failed (as 1c): the recipe's fingerprint of this case follows the list's order; the words do not.
    say(`1d. two comparisons he confirmed on one day, in two updates, in three orders of the list: one text; ${fingerprints === 1 ? 'one fingerprint' : `${fingerprints} fingerprints (one more approval, counted)`}`);
  });

  it('1e. (item 3 part 1) two devices holding the same tasks in different list orders: the same text, the same fingerprint', () => {
    for (const seed of SEEDS) {
      const world = project(seed);
      const rand = seeded(seed * 104729);
      const orders: Array<[string, ScheduleItem[]]> = [
        ['in the report\'s own order', scheduleTasksInReportOrder(world.items)],
        ['the other way round', [...world.items].reverse()],
        ['shuffled', shuffled(rand, world.items)],
        ['shuffled again', shuffled(rand, world.items)],
      ];
      const base = phone(world);
      for (const [name, items] of orders) {
        const other = phone({ ...world, items });
        const same = { text: other.text === base.text, fingerprint: other.fingerprint === base.fingerprint };
        if (!same.text) say(`seed ${seed}, tasks "${name}": THE TEXT DIFFERS${[...base.text.split('\n')].sort().join('\n') === [...other.text.split('\n')].sort().join('\n') ? ' (the same lines, in another order)' : ''}\n${newLines(base.text, other.text).map(line => `    ${line}`).join('\n')}`);
        expect({ seed, tasks: name, ...same }).toEqual({ seed, tasks: name, text: true, fingerprint: true });
      }
    }
  });

  it('1f. (item 3 part 1) the order the writer takes the tasks in is the recipe\'s own fixed order: finish date, start date, name, area, id', () => {
    // The recipe's order is private to DAVEProjectTruth (scheduleTruthInStableOrder). The writer's is written beside
    // its rule for updates; this holds the two together, ties included.
    const tied = [
      task('t-b', 'Pour slab', 'Level 1', 0, date(9), 'Dana'),
      task('t-a', 'Pour slab', 'Level 1', 0, date(9), 'Dana'),                                  // the same but the id
      task('t-c', 'Pour slab', 'Level 2', 0, date(9), 'Dana'),                                  // another area
      task('t-d', 'Frame walls', 'Level 2', 0, date(9), 'Dana'),                                // another name
      task('t-e', 'Frame walls', 'Level 2', 0, date(9), 'Dana', { startDate: '08/15/2026' }),   // an earlier start
      task('t-f', 'Set roof trusses', 'Roof', 0, '', 'Luis'),                                   // no finish date: last
      task('t-g', 'Grade the lot', 'Site', 0, 'Oct 9, 2026', 'Mara'),                           // a date written out, earlier than those
      task('t-h', 'Hang drywall', 'Level 2', 0, '2026-10-07', 'Mara'),                          // the web's form, the earliest of all
    ];
    const worlds: World[] = [...SEEDS.map(project), { ...project(SEEDS[0]), items: tied }];
    for (const world of worlds) {
      for (const items of [world.items, [...world.items].reverse()]) {
        const recipe = buildDAVEReportProjectTruths({
          projects: [{ name: 'Tower', projectId: 'report:tower' }], projectRecords: [{ name: 'Tower' }] as never,
          updates: world.updates, scheduleItems: items, knownScheduleItems: items, knownScheduleDocuments: [], projectAreas: [], referenceDocuments: [],
          now: at(0),
        })[0].schedule.map(entry => entry.taskId);
        expect(scheduleTasksInReportOrder(items).map(item => item.id)).toEqual(recipe);
      }
    }
  });

  it('1c. COUNTED, not failed: two photos of one day under one caption, in two updates. The text is the same in either order; whether the fingerprint is, is written down', () => {
    // The report recipe keeps the first of two evidence records of one kind, one day and one wording, and calls the
    // other a duplicate (DAVEProjectTruth markDuplicates): "first" by the list's order. So here two devices can hold
    // one report under two fingerprints: the report is offered once more, never wrongly called sent.
    const world = project(SEEDS[0]);
    const twice = [
      update('u8', world.items[0], savedDay(0), 'Anchor bolts are set at the north wall.', [photo('p8a', world.items[0].locationName, 'Progress at the north wall')]),
      update('u9', world.items[1], savedDay(0), 'Sleeves are placed at the south wall.', [photo('p9a', world.items[1].locationName, 'Progress at the north wall')]),
    ];
    const base = phone({ ...world, updates: [...world.updates, ...twice] });
    const other = phone({ ...world, updates: [...world.updates, ...[...twice].reverse()] });
    expect(other.text).toBe(base.text);
    say(`1c. two photos of one day under one caption, in two updates, the two updates in the other order: the same text; the fingerprint is ${other.fingerprint === base.fingerprint ? 'the same' : 'ANOTHER (one more approval, counted)'}`);
  });

  it('2. the same saved project read on other days: no word of the section moves unless a task crosses a line, and never another text under one fingerprint', () => {
    const silent: string[] = [];
    let neitherMoved = 0;
    let fingerprintOnly = 0;
    let sectionHeld = 0;
    for (const seed of SEEDS) {
      const world = project(seed);
      /**
       * A task not complete crosses a line between two days: it becomes overdue, due within the week, or within two.
       * And one line that is no task's (KNOWN, test 2b): the comparison he confirmed, on a photo of five days before
       * day 0, is quoted for seven days, so it leaves the section between day 1 and day 2.
       */
      const crossing = (day: number) => day === 2 || world.items.filter(item => Number(item.percentComplete) < 100).some(item => {
        const side = (daysLeft: number) => (daysLeft < 0 ? 'overdue' : daysLeft <= 7 ? 'week' : daysLeft <= 14 ? 'fortnight' : 'later');
        return side(dueIn(item) - day) !== side(dueIn(item) - (day - 1));
      });
      let before = phone(world, at(0));
      for (let day = 1; day <= 24; day += 1) {
        const after = phone(world, at(day));
        const moved = { text: after.text !== before.text, section: after.section !== before.section, fingerprint: after.fingerprint !== before.fingerprint };
        if (moved.text && !moved.fingerprint) {
          silent.push(`seed ${seed}, day ${day - 1} to day ${day}${crossing(day) ? ' (a task crosses a line)' : ''}`);
          say(`seed ${seed}, day ${day - 1} to day ${day}${crossing(day) ? ' (a task crosses a line)' : ''}: THE TEXT MOVED UNDER ONE FINGERPRINT\n${newLines(before.text, after.text).map(line => `    ${line}`).join('\n')}`);
        }
        // The section says nothing counted from today: with no task crossing a line it is the same words the next day.
        if (!crossing(day)) {
          if (moved.section) say(`seed ${seed}, day ${day - 1} to day ${day}: no task crosses a line and the section moved\n${newLines(before.section, after.section).map(line => `    ${line}`).join('\n')}`);
          expect({ seed, day, sectionMovedWithNoTaskCrossingALine: moved.section }).toEqual({ seed, day, sectionMovedWithNoTaskCrossingALine: false });
          sectionHeld += 1;
        }
        if (!moved.text && !moved.fingerprint) neitherMoved += 1;
        if (!moved.text && moved.fingerprint) fingerprintOnly += 1;
        before = after;
      }
    }
    say(`2. days with no task crossing a line, the section the same words: ${sectionHeld}; days on which neither the text nor the fingerprint moved: ${neitherMoved}; the fingerprint alone moved (one more approval, counted): ${fingerprintOnly}; the text moved under one fingerprint: ${silent.join(' | ') || 'none'}`);
    expect(neitherMoved).toBeGreaterThan(0);
    expect(silent).toEqual(KNOWN_BY_DAY);   // none: in these projects another task is already in focus when one comes within two weeks (2b shows that day alone)
  });

  it('2b. the two things the section still counts from today, day by day (a small project, so each shows alone)', () => {
    const frame = task('frame', 'Frame walls', 'Level 2', 100, date(-5), 'Dana');
    const paint = task('paint', 'Paint lobby', 'Level 1', 10, date(71), 'Mara');
    const roof = task('roof', 'Set roof trusses', 'Roof', 0, date(80), 'Luis');
    const small = (pourDueIn: number, withComparison: boolean): World => {
      const pour = task('pour', 'Pour slab', 'Level 1', 40, date(pourDueIn), 'Dana');
      return {
        items: [frame, pour, paint, roof],
        updates: [
          // Two photos at the roof and no note: the later one is a comparison he confirmed, set against the earlier.
          ...(withComparison ? [
            update('u4', roof, savedDay(-3), '', [photo('p4', 'Roof', '', { photoIntelligence: { ...COMPARISON, summary: 'Roof trusses have been set on the north half.', location: 'Roof', diagnostics: { selectedPriorPhotoId: 'p0' } } })]),
          ] : []),
          update('u3', pour, savedDay(-3), 'West bay forms started. Pump truck is booked for Tuesday.', [photo('p3', 'Level 1', 'West bay footing with rebar')]),
          update('u2', frame, savedDay(-4), 'Framing is complete on Level 2. Inspection passed.', [photo('p2', 'Level 2', 'Framing complete')]),
          update('u1', pour, savedDay(-6), 'Slab forms are set on the east bay.', [photo('p1', 'Level 1', 'West bay footing, forms only')]),
          ...(withComparison ? [update('u0', roof, savedDay(-8), '', [photo('p0', 'Roof', '')])] : []),
        ],
        documents: [], areas: [], contacts: { contacts: [] },
      };
    };
    const dayByDay = (world: World, days: number) => {
      const out: string[] = [];
      let before = phone(world, at(0));
      for (let day = 1; day <= days; day += 1) {
        const after = phone(world, at(day));
        if (after.section !== before.section) {
          const fingerprintMoved = after.fingerprint !== before.fingerprint;
          out.push(`day ${day - 1} to day ${day}: the section moved, the fingerprint ${fingerprintMoved ? 'moved' : 'DID NOT'}`);
          say(`2b. day ${day - 1} to day ${day}: the section moved, the fingerprint ${fingerprintMoved ? 'moved' : 'DID NOT'}\n${newLines(before.section, after.section).map(line => `    + ${line}`).join('\n')}\n${newLines(after.section, before.section).map(line => `    - ${line}`).join('\n')}`);
        }
        before = after;
      }
      return out;
    };
    say('2b. (i) one open task, due in 15 days on day 0:');
    const twoWeekLine = dayByDay(small(15, false), 18);
    say('2b. (ii) a comparison he confirmed three days before day 0, no task due within two months:');
    const comparisonAges = dayByDay(small(70, true), 8);
    say(`2b. (ii) the section on day 0:\n${phone(small(70, true), at(0)).section}`);
    expect({ twoWeekLine, comparisonAges }).toEqual(KNOWN_COUNTED_FROM_TODAY);
  });

  it('3. one change at a time to what the section reads: a text that moved means a fingerprint that moved', () => {
    const silent = new Set<string>();
    const movedText = new Set<string>();
    let fingerprintOnly = 0;
    for (const seed of SEEDS) {
      const world = project(seed);
      const byDate = newestFirst(world.updates);
      const newest = byDate[0];
      const oldest = byDate[byDate.length - 1];
      const focus = world.items.filter(item => Number(item.percentComplete) < 100).sort((left, right) => dueIn(left) - dueIn(right));
      const changes: Array<[string, World]> = [
        // the field updates
        ['the newest note reworded', withUpdate(world, newest.id, item => ({ ...item, notes: `${item.notes} Reviewed with the superintendent.` }))],
        ['the newest note emptied', withUpdate(world, newest.id, item => ({ ...item, notes: '' }))],
        ['an older note reworded', withUpdate(world, byDate[3].id, item => ({ ...item, notes: 'Scaffold was moved to the south elevation.' }))],
        ['the oldest update re-dated: it is now the newest', withUpdate(world, oldest.id, item => ({ ...item, date: savedDay(0) }))],
        ['the oldest update re-dated by a day, still the oldest', withUpdate(world, oldest.id, item => ({ ...item, date: savedDay(-8) }))],
        ['the newest update re-dated: it is now the oldest', withUpdate(world, newest.id, item => ({ ...item, date: savedDay(-30) }))],
        ['the newest update removed', { ...world, updates: world.updates.filter(item => item.id !== newest.id) }],
        ['a field update added', { ...world, updates: [...world.updates, update('u8', world.items[0], savedDay(0), 'Anchor bolts are set at the north wall.', [photo('p-new', world.items[0].locationName, 'Anchor bolts')])] }],
        ['the newest update filed under another area', withUpdate(world, newest.id, item => ({ ...item, selectedAreaName: item.selectedAreaName === 'Site' ? 'Roof' : 'Site' }))],
        ['the newest update linked to another task', withUpdate(world, newest.id, item => { const other = world.items.find(candidate => candidate.id !== item.scheduleItemId) as ScheduleItem; return { ...item, scheduleItemId: other.id, scheduleTaskName: other.taskName }; })],
        ['the newest update not uploaded yet on this device (sent -> queued)', withUpdate(world, newest.id, item => ({ ...item, status: 'queued' } as ProjectUpdate))],
        ['the newest update\'s recipients changed', withUpdate(world, newest.id, item => ({ ...item, recipients: { contactIds: ['c1'] } }))],
        ['the newest note marked as the photo analysis\'s own suggestion, accepted', withUpdate(world, newest.id, item => ({ ...item, pieSuggestedNote: item.notes, pieSuggestedNoteAccepted: true }))],
        ['of two updates of one day, the earlier one filed under a later id', withUpdate(world, 'u5', item => ({ ...item, id: 'u6b' }))],
        // their photos
        ['the newest photo\'s caption reworded', withPhoto(world, item => ({ ...item, caption: 'Honeycombing at the column base' }))],
        ['the newest photo\'s caption emptied', withPhoto(world, item => ({ ...item, caption: '' }))],
        ['the newest photo marked an open issue', withPhoto(world, item => ({ ...item, category: 'Open Issue' }))],
        ['the newest photo marked a safety concern', withPhoto(world, item => ({ ...item, category: 'Safety Concern' }))],
        ['an action asked on the newest photo', withPhoto(world, item => ({ ...item, actionRequired: 'Replace the damaged panel', actionOwner: 'Mara' }))],
        ['the newest photo\'s action given another owner', withPhoto(withPhoto(world, item => ({ ...item, actionRequired: 'Replace the damaged panel', actionOwner: 'Mara' })), item => ({ ...item, actionOwner: 'Luis' }))],
        ['the newest photo\'s action closed', withPhoto(world, item => ({ ...item, actionRequired: 'Replace the damaged panel', actionOwner: 'Mara', actionStatus: 'Closed' }))],
        ['the newest photo filed under another area', withPhoto(world, item => ({ ...item, selectedAreaName: item.selectedAreaName === 'Roof' ? 'Site' : 'Roof' }))],
        ['the newest photo\'s file moved on the device', withPhoto(world, item => ({ ...item, uri: 'file:///phone/other/moved.jpg', cloudStoragePath: 'owner/moved.jpg' }))],
        ['the newest photo removed', withPhoto(world, () => photo('p-other', 'Site', 'Stockpile at the gate'))],
        ['the photos of one update in another order', (() => { const holder = world.updates.find(item => item.photos.length > 1); return holder ? withUpdate(world, holder.id, item => ({ ...item, photos: [...item.photos].reverse() })) : world; })()],
        ['the confirmed comparison no longer confirmed', { ...world, updates: world.updates.map(item => ({ ...item, photos: item.photos.map(entry => (entry.id === 'p-confirmed' ? { ...entry, photoIntelligence: { ...(entry as unknown as { photoIntelligence: object }).photoIntelligence, userReview: 'unreviewed' } } : entry)) } as ProjectUpdate)) }],
        ['the confirmed comparison\'s finding reworded', { ...world, updates: world.updates.map(item => ({ ...item, photos: item.photos.map(entry => (entry.id === 'p-confirmed' ? { ...entry, photoIntelligence: { ...(entry as unknown as { photoIntelligence: object }).photoIntelligence, summary: 'Rebar has been installed and tied in the west bay footing.' } } : entry)) } as ProjectUpdate)) }],
        // the tasks
        ['the task due soonest renamed', withItem(world, focus[0].id, item => ({ ...item, taskName: `${item.taskName} (phase 2)` }))],
        ['the task due soonest moved a day', withItem(world, focus[0].id, item => ({ ...item, finishDate: date(dueIn(item) + 1) }))],
        ['the task due soonest moved out two months', withItem(world, focus[0].id, item => ({ ...item, finishDate: date(60) }))],
        ['the task due within the week moved a day, still within the week', withItem(world, focus[1].id, item => ({ ...item, finishDate: date(dueIn(item) + 1) }))],
        ['the task due soonest completed', withItem(world, focus[0].id, item => ({ ...item, percentComplete: 100, status: 'Complete' } as ScheduleItem))],
        ['the task due soonest set to waiting', withItem(world, focus[0].id, item => ({ ...item, status: 'Waiting' } as ScheduleItem))],
        ['a later task made high priority', withItem(world, focus[focus.length - 1].id, item => ({ ...item, priority: 'High' } as ScheduleItem))],
        ['the task due soonest given another owner', withItem(world, focus[0].id, item => ({ ...item, owner: item.owner === 'Mara' ? 'Dana' : 'Mara' }))],
        ['the task due soonest given another contractor and no owner', withItem(world, focus[0].id, item => ({ ...item, owner: '', contractor: 'Brightline' }))],
        ['a note typed on the task due soonest', withItem(world, focus[0].id, item => ({ ...item, notes: 'Pump truck confirmed for the morning.' }))],
        ['the task due soonest filed under another area', withItem(world, focus[0].id, item => ({ ...item, locationName: item.locationName === 'Site' ? 'Roof' : 'Site' }))],
        ['the task due soonest named a milestone', withItem(world, focus[0].id, item => ({ ...item, milestone: 'Substantial completion' }))],
        ['the task due soonest removed', { ...world, items: world.items.filter(item => item.id !== focus[0].id) }],
        ['the saved tasks in another order', { ...world, items: [...world.items].reverse() }],
        // the rest of what the app's draft is handed
        ['a contact added to the address book', { ...world, contacts: { contacts: [...world.contacts.contacts, { id: 'c2', name: 'Luis Ortega', email: 'luis@example.com', phone: '555-0101' }] } }],
        ['the address book emptied', { ...world, contacts: { contacts: [] } }],
      ];
      const base = phone(world);
      for (const [name, changed] of changes) {
        const after = phone(changed);
        const moved = { text: after.text !== base.text, fingerprint: after.fingerprint !== base.fingerprint };
        if (moved.text) movedText.add(name);
        if (!moved.text && moved.fingerprint) fingerprintOnly += 1;
        if (moved.text && !moved.fingerprint) {
          silent.add(name);
          const sameLines = [...base.text.split('\n')].sort().join('\n') === [...after.text.split('\n')].sort().join('\n');
          say(`seed ${seed}, "${name}": THE TEXT MOVED UNDER ONE FINGERPRINT${sameLines ? ' (the same lines, in another order)' : ''}\n${[...newLines(base.text, after.text).map(line => `    + ${line}`), ...newLines(after.text, base.text).map(line => `    - ${line}`)].join('\n')}`);
        }
      }
    }
    say(`3. changes that moved the text (in any project): ${movedText.size}; the fingerprint alone moved (counted): ${fingerprintOnly}; the text moved under one fingerprint: ${[...silent].join(' | ') || 'none'}`);
    // The guard is not asleep: most of these changes do move the written report.
    expect(movedText.size).toBeGreaterThanOrEqual(20);
    // Nothing joins the known ones unseen.
    expect([...silent].filter(name => !KNOWN_BY_CHANGE.includes(name))).toEqual([]);
    // And on the twelve projects the list was found with (B232_SEEDS=12), every one is still there: one that is
    // settled comes off the list.
    if (SEEDS[0] === 1 && SEEDS.length >= 12) expect(KNOWN_BY_CHANGE.filter(name => !silent.has(name))).toEqual([]);
  });

  it('4. (item 4 part A) the saved model does not change the written report: three devices with three histories, one text', async () => {
    for (const seed of SEEDS) {
      const world = project(seed);
      const byDate = newestFirst(world.updates);
      const fresh = await phoneLive(`fresh-${seed}`, world);
      // Open yesterday, before the two newest updates, when the first task stood 20 points lower.
      const lower = world.items.map((item, index) => (index === 0 ? { ...item, percentComplete: Math.max(0, Number(item.percentComplete) - 20) } as ScheduleItem : item));
      await phoneLive(`earlier-${seed}`, { ...world, updates: byDate.slice(2), items: lower }, at(-1));
      const earlier = await phoneLive(`earlier-${seed}`, world);
      // Held, yesterday, an update and a task that were deleted since.
      const goneTask = task('gone-task', 'Temporary power', 'Trailer', 0, date(1), 'Luis', { status: 'Waiting' });
      const goneUpdate = update('u9', goneTask, savedDay(-1), 'Temporary power is out at the trailer. Generator is on order.');
      await phoneLive(`deleted-${seed}`, { ...world, updates: [goneUpdate, ...world.updates], items: [...world.items, goneTask] }, at(-1));
      const afterADelete = await phoneLive(`deleted-${seed}`, world);
      const later = await phoneLive(`deleted-${seed}`, world, at(31));
      const freshLater = await phoneLive(`fresh-later-${seed}`, world, at(31));
      for (const [name, other, against] of [['open before today\'s records', earlier, fresh], ['held a record deleted since', afterADelete, fresh], ['the same, 31 days later', later, freshLater]] as const) {
        if (other.text !== against.text) say(`seed ${seed}, a device that ${name}: THE TEXT DIFFERS from a device that never saw the project\n${[...newLines(against.text, other.text).map(line => `    + ${line}`), ...newLines(other.text, against.text).map(line => `    - ${line}`)].join('\n')}`);
        expect({ seed, device: name, text: other.text === against.text, fingerprint: other.fingerprint === against.fingerprint, quotesTheDeletedNote: other.text.includes('Temporary power') })
          .toEqual({ seed, device: name, text: true, fingerprint: true, quotesTheDeletedNote: false });
      }
    }
  });

  it('4b. (item 4b) the saved model takes no place among a work area\'s lines: no saved model, one that reads as a problem, one that advises an action, one text', async () => {
    const worlds: Array<[string, World, boolean]> = [
      ...SEEDS.map(seed => [`generated ${seed}`, project(seed), false] as [string, World, boolean]),
      ...NO_AREA_SHAPES.map((shape, index) => [`generated ${index + 1}${QUIET.has(index + 1) ? ', no task overdue,' : ''} with notes of no area (${shape.join(', ')})`, projectWithNotesOfNoArea(index + 1), true] as [string, World, boolean]),
    ];
    const differing: string[] = [];
    const models = { reports: 0, readsAsAProblem: 0, advisesAnAction: 0 };
    for (const [name, world, withNotesOfNoArea] of worlds) {
      const byDate = newestFirst(world.updates);
      const devices: Array<[string, Live]> = [];
      // A device that never saw the project: its model sums the project up in one sentence.
      devices.push(['never saw the project', await phoneLive(`4b-fresh-${name}`, world)]);
      if (withNotesOfNoArea) {
        // Open yesterday, before the two newest updates, when the first task stood 20 points lower.
        const lower = world.items.map((item, index) => (index === 0 ? { ...item, percentComplete: Math.max(0, Number(item.percentComplete) - 20) } as ScheduleItem : item));
        await phoneLive(`4b-earlier-${name}`, { ...world, updates: byDate.slice(2), items: lower }, at(-1));
        devices.push(['was open before today\'s records', await phoneLive(`4b-earlier-${name}`, world)]);
      }
      // Held, yesterday, an update and a task that were deleted since.
      const goneTask = task('gone-task', 'Temporary power', 'Trailer', 0, date(1), 'Luis', { status: 'Waiting' });
      const goneUpdate = update('u9', goneTask, savedDay(-1), 'Temporary power is out at the trailer. Generator is on order.');
      await phoneLive(`4b-deleted-${name}`, { ...world, updates: [goneUpdate, ...world.updates], items: [...world.items, goneTask] }, at(-1));
      devices.push(['held a record deleted since', await phoneLive(`4b-deleted-${name}`, world)]);

      const noSavedModel = writtenWithNoSavedModel(devices[0][1], world);
      for (const [device, report] of devices) {
        const model = report.draft.sourceEvidence.find(item => item.id === SAVED_MODEL);
        const kind = { readsAsAProblem: report.draft.risks.some(risk => risk.sourceEvidenceIds.includes(SAVED_MODEL)), advisesAnAction: Boolean(model?.actionRequired?.trim()) };
        models.reports += 1;
        models.readsAsAProblem += Number(kind.readsAsAProblem);
        models.advisesAnAction += Number(kind.advisesAnAction);
        // The model is in the draft on every device (the app's own advice reads it there)...
        expect({ name, device, theModelIsInTheDraft: Boolean(model) }).toEqual({ name, device, theModelIsInTheDraft: true });
        expect({ name, device, sameFingerprint: report.fingerprint === devices[0][1].fingerprint }).toEqual({ name, device, sameFingerprint: true });
        // ...and the text is the one written with no saved model at all, to the letter.
        if (report.text !== noSavedModel) {
          const lines = [...newLines(report.text, noSavedModel).map(line => `    with no saved model, not here: ${line}`), ...newLines(noSavedModel, report.text).map(line => `    here, not with no saved model: ${line}`)];
          differing.push(`${name}, a device that ${device} (its model ${kind.readsAsAProblem ? 'reads as a problem' : ''}${kind.readsAsAProblem && kind.advisesAnAction ? ' and ' : ''}${kind.advisesAnAction ? 'advises an action' : ''}${kind.readsAsAProblem || kind.advisesAnAction ? '' : 'is neither'})`);
          say(`4b. ${differing[differing.length - 1]}: THE TEXT IS NOT THE ONE WRITTEN WITH NO SAVED MODEL\n${lines.join('\n')}`);
        }
      }
    }
    say(`4b. ${models.reports} reports of ${worlds.length} projects against the text with no saved model: ${differing.length} differ; the model read as a problem on ${models.readsAsAProblem}, advised an action on ${models.advisesAnAction}`);
    // Both kinds of model were met, so the check is not asleep.
    expect(models.readsAsAProblem).toBeGreaterThan(0);
    expect(models.advisesAnAction).toBeGreaterThan(0);
    expect(differing).toEqual([]);
  });
});

// ---- KNOWN: found by this guard, told to the coordinator, not settled in this batch ----
/** Single changes that move the text under one fingerprint (test 3): what the section reads and the 2.0 fingerprint does not hold. */
const KNOWN_BY_CHANGE: readonly string[] = [
  // ('the saved tasks in another order', F1, was here: settled by item 3 part 1, see test 1e.)
  'a later task made high priority',
  'the task due soonest named a milestone',
  'the photos of one update in another order',
  'the newest note marked as the photo analysis\'s own suggestion, accepted',
  'the confirmed comparison\'s finding reworded',
];
/** Days on which the text moves under one fingerprint. None. */
const KNOWN_BY_DAY: readonly string[] = [];
/** What the section still counts from today (test 2b), as found. */
const KNOWN_COUNTED_FROM_TODAY = {
  // "Schedule focus" names a task from the day it is due within two weeks: a line of the section's own.
  twoWeekLine: ['day 0 to day 1: the section moved, the fingerprint DID NOT', 'day 15 to day 16: the section moved, the fingerprint moved'],
  // A comparison he confirmed is quoted for seven days from its photo, and not on the eighth.
  comparisonAges: ['day 3 to day 4: the section moved, the fingerprint DID NOT'],
};
