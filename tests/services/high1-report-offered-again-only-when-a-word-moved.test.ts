/**
 * HIGH item 1 (the owner's instruction of 13 Oct 2026, the three high items; open item 7.11; reports review pass 3,
 * P3-4): a report sent yesterday was offered again the next morning although nothing had changed.
 *
 * "Already sent" must be TRUE TO THE READER: two devices holding the same records work out the same value; a report
 * that reads differently is not called already sent; a report that reads the same is not offered again for no
 * reason. Version 2.0 of the report's fingerprint held the whole of Project Truth, and much of Project Truth is
 * counted from "now" and printed by no output ("3 in the last 14 days", "Updated recently", its evidence score and
 * confidence, a recommendation's timing for a decision the report does not list, a task "upcoming" in 8 to 21 days),
 * so it moved on mornings when no word moved. And it did not hold some things the phone's written report prints
 * (Build 232 round, F2 to F6b): a task's priority and milestone name, the "Schedule focus" of a task coming within two
 * weeks, a confirmed photo comparison quoted for 7 days and its summary, the order of an update's photos, the mark of
 * a note that is the photo analysis's accepted suggestion.
 *
 *   1. Fourteen mornings with nothing changed, on review pass 3's project and three more, by the phone's recipe and
 *      the desktop's: the fingerprint moves on a morning IF AND ONLY IF a word of some output moved (the phone's
 *      written report in both formats, with the app's own draft; what the Reports preview and the desktop's page
 *      print; the desktop's report in both formats). The phone and the desktop work out one value each morning.
 *   2. Each of F2 to F6b: the phone's written report moves, and so does the fingerprint.
 *   3. A report sent on the build before (Build 231, a5cab6c: a 2.0 fingerprint) is known for exactly the mornings
 *      a5cab6c itself knew it: the 2.0 values below are a5cab6c's own, worked out there for these very projects.
 * Synthetic data, made-up names. No network.
 */
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []), multiSet: jest.fn(async () => undefined), multiRemove: jest.fn(async () => undefined),
  };
  return { __esModule: true, default: api, ...api };
});

import * as RI from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import * as Snapshots from '../../services/DAVEReportSnapshot';
import * as WebOps from '../../services/DAVEWebOperations';
import { buildPIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';

jest.setTimeout(300_000);

type World = { project: string; day0: string; items: ScheduleItem[]; shown?: ScheduleItem[]; updates: ProjectUpdate[]; documents: ReferenceDocument[] };
const DAY = 86_400_000;
const mdy = (ms: number) => { const d = new Date(ms); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`; };
const json = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

// ---- review pass 3's project (rv3-what-the-guard-does-not-change, world()): Alpha ----
/**
 * The import gives a task with no priority of its own "High" when it finishes within 7 days OF THE DEVICE'S CLOCK at
 * the import (PIEScheduleIntelligence normalizePriority), and the task is saved so. So the project is imported once,
 * at its import's own moment, and every reading is of those saved tasks.
 */
let alphaAsSaved: World | null = null;
function alpha(): World {
  if (!alphaAsSaved) {
    jest.useFakeTimers({ now: Date.parse('2026-09-20T15:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
    try { alphaAsSaved = alphaImported(); } finally { jest.useRealTimers(); }
  }
  return json(alphaAsSaved);
}
function alphaImported(): World {
  const IMPORTED = '2026-09-20T15:00:00.000Z';
  const document = {
    id: 'MASTER Alpha', name: 'MASTER Alpha', originalFileName: 'MASTER Alpha.csv', uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt: IMPORTED,
    projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: 'batch-MASTER Alpha',
  } as unknown as ReferenceDocument;
  const items = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', 'Paint,Alpha,Lot,10/05/2026,10/09/2026,', 'Drywall,Alpha,Lot,09/25/2026,09/29/2026,', 'Framing,Alpha,Deck,09/21/2026,09/25/2026,100', 'Roofing,Alpha,Deck,10/12/2026,10/16/2026,'].join('\n'),
    sourceName: 'MASTER Alpha.csv', mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(IMPORTED),
  } as never).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `alpha-${index + 1}`, importBatchId: 'batch-MASTER Alpha', sourceDocumentId: 'MASTER Alpha', projectControls: normalizeProjectControls((item as never as { projectControls: unknown }).projectControls as never), activity: [],
  } as unknown as ScheduleItem)).map(item => (item.taskName === 'Paint'
    ? { ...item, percentComplete: 30, status: 'In Progress', owner: 'Sam', notes: 'Primer is on site.', priority: 'High', progressSource: 'project_manager', progressConfirmedAt: '2026-09-29T17:00:00.000Z', progressConfirmedBy: 'David', updatedAt: '2026-09-29T17:00:00.000Z' }
    : item.taskName === 'Drywall'
      ? { ...item, status: 'Waiting', contractor: 'ACME Drywall', nextAction: 'Call the inspector.', updatedAt: '2026-09-28T17:00:00.000Z' }
      : item) as ScheduleItem);
  const photo = (id: string, change: Record<string, unknown>) => ({
    id, uri: `file:///phone/photos/${id}.jpg`, caption: 'Progress', category: 'Progress', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
    fileName: `${id}.jpg`, mimeType: 'image/jpeg', selectedAreaName: 'Lot', ...change,
  });
  const update = (id: string, task: ScheduleItem, at: string, notes: string, photos: unknown[]): ProjectUpdate => ({
    id, projectName: 'Alpha', scheduleProjectName: 'Alpha', date: at, photos, recipients: { contactIds: [] }, notes,
    scheduleItemId: task.id, scheduleTaskName: task.taskName, selectedAreaName: task.locationName || '', pieSuggestedNote: '', pieSuggestedNoteAccepted: false,
  }) as unknown as ProjectUpdate;
  return {
    project: 'Alpha', day0: '2026-10-01T18:00:00.000Z', items, documents: [document],
    shown: selectAuthoritativeScheduleItems({ scheduleItems: items, scheduleDocuments: [document] }) as ScheduleItem[],
    updates: [
      update('u-1', items[1], '2026-09-28T16:00:00.000Z', 'Drywall hung on the north wall; taping starts Monday.', [
        photo('p-1', { caption: 'Rebar installed at the east footing.' }),
        photo('p-2', { caption: 'Guardrail missing at the stair 2 landing.', category: 'Safety Concern', actionRequired: 'Install the guardrail before work resumes.', actionOwner: 'Sam', actionDueDate: '10/03/2026', selectedAreaName: 'Deck' }),
      ]),
      update('u-2', items[3], '2026-09-30T16:00:00.000Z', 'Roofing material delivered to the Deck.', [
        photo('p-3', { caption: 'Water ponding near the drain.', category: 'Open Issue', actionRequired: 'Regrade at the drain.', selectedAreaName: 'Deck' }),
      ]),
    ],
  };
}

// ---- three made-up projects (the same as the step 1 rig's) ----
const DAY0 = '2026-10-05T16:00:00.000Z';
const D0 = Date.parse(DAY0);
const due = (days: number) => mdy(D0 + days * DAY);
const savedDay = (days: number) => new Date(D0 + days * DAY).toISOString().slice(0, 10);
const task = (project: string, id: string, taskName: string, area: string, percent: number, finishIn: number, owner: string, extra: Record<string, unknown> = {}): ScheduleItem => ({
  id, projectName: project, scheduleProjectName: project, locationName: area, taskName,
  startDate: '09/01/2026', finishDate: due(finishIn), milestone: '', owner, contractor: 'Northgate Builders',
  percentComplete: percent, priority: 'Medium', status: percent >= 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z', ...extra,
}) as unknown as ScheduleItem;
const photo = (id: string, area: string, caption: string, extra: Record<string, unknown> = {}) => ({
  id, uri: `file:///phone/photos/${id}.jpg`, caption, category: 'Progress', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
  fileName: `${id}.jpg`, mimeType: 'image/jpeg', selectedAreaName: area, ...extra,
});
const update = (project: string, id: string, item: ScheduleItem, daysAgo: number, notes: string, photos: unknown[] = []): ProjectUpdate => ({
  id, projectName: project, scheduleProjectName: project, date: savedDay(-daysAgo), photos, recipients: { contactIds: [] }, notes, status: 'sent',
  scheduleItemId: item.id, scheduleTaskName: item.taskName, selectedAreaName: item.locationName || '',
}) as unknown as ProjectUpdate;
const COMPARISON = {
  status: 'analysis_complete', title: 'Photo comparison', summary: 'Footing rebar has been placed along the north line.', visibleChange: 'Rebar is in the north footing.',
  location: 'Site', comparisonConfidence: 'high', captureLimitations: [], projectProgress: 'supported', repeatPhotoGuidance: null, authorityMessage: '',
  currentObservation: 'Rebar mat in place; no concrete yet.', changedFromPrior: 'Rebar placed since the prior photo.', priorUpdateUsed: 'my-u1',
  comparability: 'strong', provenance: 'visual_only', userReview: 'confirmed', assessmentDisposition: 'finding', findings: [{ findingType: 'added', description: 'Rebar' }],
};
function marlowYard(): World {
  const p = 'Marlow Yard';
  const items = [
    task(p, 'my-1', 'Excavate footings', 'Site', 100, -12, 'Priya'),
    task(p, 'my-2', 'Pour footings', 'Site', 40, 10, 'Priya'),
    task(p, 'my-3', 'Frame level 1', 'Level 1', 0, 19, 'Tomas'),
    task(p, 'my-4', 'Set roof trusses', 'Roof', 0, 45, 'Tomas', { milestone: 'Dry-in', isMilestone: true }),
    task(p, 'my-5', 'Rough plumbing', 'Level 1', 10, 30, 'Ines', { priority: 'High' }),
  ];
  const updates = [
    update(p, 'my-u1', items[0], 8, 'Footing trenches are excavated to depth. Inspection passed.', [photo('my-p1', 'Site', 'North footing, forms only'), photo('my-p2', 'Site', 'Spoil pile at the east gate')]),
    update(p, 'my-u2', items[1], 4, 'Rebar is tied in the north footing. Pump truck is booked for Thursday.', [photo('my-p3', 'Site', 'North footing with rebar', { photoIntelligence: { ...COMPARISON, diagnostics: { selectedPriorPhotoId: 'my-p1' } } })]),
    update(p, 'my-u3', items[2], 2, 'Lumber for level 1 was delivered. Two bundles are damaged.', [photo('my-p4', 'Level 1', 'Damaged lumber bundles', { actionRequired: 'Confirm the replacement delivery', actionOwner: 'Tomas' })]),
    update(p, 'my-u4', items[1], 1, 'South footing forms are set.', []),
  ];
  return { project: p, day0: DAY0, items, updates, documents: [] };
}
function quarryLane(): World {
  const p = 'Quarry Lane';
  const items = [
    task(p, 'ql-1', 'Demolition', 'Site', 100, -15, 'Odile'),
    task(p, 'ql-2', 'Underground utilities', 'Site', 60, -2, 'Odile'),
    task(p, 'ql-3', 'Slab on grade', 'Level 1', 0, 9, 'Bram'),
    task(p, 'ql-4', 'Structural steel', 'Level 1', 0, 16, 'Bram', { isMilestone: true, milestone: 'Steel topped out' }),
    task(p, 'ql-5', 'Curtain wall', 'Level 2', 0, 3, 'Keiko', { status: 'Waiting' }),
  ];
  const updates = [
    update(p, 'ql-u1', items[0], 10, 'Demolition debris is hauled off.', [photo('ql-p1', 'Site', 'Cleared pad')]),
    update(p, 'ql-u2', items[1], 3, 'Storm line is in. Water service is waiting on the utility.', []),
  ];
  return { project: p, day0: DAY0, items, updates, documents: [] };
}
function fennelCourt(): World {
  const p = 'Fennel Court';
  const items = [
    task(p, 'fc-1', 'Survey', 'Site', 100, -40, 'Hollis'),
    task(p, 'fc-2', 'Permits', 'Site', 100, -25, 'Hollis'),
    task(p, 'fc-3', 'Mobilize', 'Site', 20, 60, 'Renata'),
    task(p, 'fc-4', 'Foundations', 'Level 1', 0, 90, 'Renata'),
  ];
  const updates = [
    update(p, 'fc-u1', items[2], 20, 'Trailer is set and temporary power is connected.', []),
    update(p, 'fc-u2', items[2], 6, 'Fence panels were installed along the street side.', [photo('fc-p1', 'Site', 'Street side fence')]),
  ];
  return { project: p, day0: DAY0, items, updates, documents: [] };
}
const WORLDS: Array<[string, () => World]> = [['Alpha (review pass 3)', alpha], ['Marlow Yard', marlowYard], ['Quarry Lane', quarryLane], ['Fennel Court', fennelCourt]];

/**
 * The 2.0 fingerprints a5cab6c (Build 231) itself worked out for these projects on mornings 0 to 14, phone and desktop
 * alike (notes/impl-high/runs-H1/02-measure-a5cab6c.json, the step 1 rig run on a5cab6c): a report sent there carries
 * one of these.
 */
const ON_A5CAB6C: Record<string, string[]> = {
  'Alpha (review pass 3)': ['a75ce932', '28d307fc', '28d307fc', '81cf08df', '8dcee419', '18a6eacd', '44bd0c44', '40b0b777', 'ee83216f', '3e6c4e70', '3e6c4e70', '0bab3db0', '0bab3db0', '8c80465d', '2c31a656'],
  'Marlow Yard': ['8b012d18', '8b012d18', '8b012d18', '320e01e8', '320e01e8', '49410b7b', '61e2f522', '61e2f522', '61e2f522', '30e63391', 'b0a3e9e9', '3e2ffd29', '45c4094f', '122b5984', '122b5984'],
  'Quarry Lane': ['902528b0', '902528b0', '5a0f4aba', '5a0f4aba', '2282b8d8', '2282b8d8', '2282b8d8', '2282b8d8', '8115ae31', 'a244ede2', '30dd9c72', 'bd366593', 'bd366593', 'bd366593', 'bd366593'],
  'Fennel Court': ['15e4c462', '15e4c462', '15e4c462', '15e4c462', '15e4c462', '15e4c462', '15e4c462', '15e4c462', '89dbbc92', '89dbbc92', '89dbbc92', '89dbbc92', '89dbbc92', '89dbbc92', '89dbbc92'],
};

// ---- what each device prints, on one morning ----
/** What the Reports preview (phone) and the Reports page (desktop) print of the briefing, field by field. */
function printedOnScreen(briefing: RI.DAVEReportBriefing): string[] {
  const b = briefing;
  return [
    `condition ${b.conditionLabel}`, `snapshot ${b.executiveSnapshot}`,
    ...b.completedWork.map(line => `completed ${line}`), ...b.currentWork.map(line => `current ${line}`),
    ...b.dashboard.workAreas.map(area => `area ${area.projectName} ${area.areaName} ${area.averagePercent}% ${area.completeTaskCount}/${area.taskCount}`),
    ...b.projectConditions.map(c => `position ${c.projectName} ${c.percentComplete}% ${c.currentReality} ${c.schedule} ${c.forecastFinish} ${c.baselineFinish} ${c.forecastVarianceDays}`),
    ...b.schedulePosition.map(line => `schedule ${line}`), ...b.criticalRisks.map(line => `risk ${line}`), ...b.decisionsRequired.map(line => `decision ${line}`),
    ...b.recentChanges.map(change => `change ${change.summary}`), ...b.whatChanged.map(line => `what changed ${line}`),
    ...b.nextActions.map(a => `action ${a.projectName} ${a.areaName} ${a.taskName} ${a.dueDate} | ${a.issue} | ${a.impact} | ${a.action} | ${a.owner} · ${a.timing} ${a.scheduleImpactDays}`),
    ...b.milestones.map(m => `milestone ${m.projectName} ${m.areaName} ${m.taskName} ${m.finishDate} ${m.state}`),
    `controls ${JSON.stringify(b.dashboard.controls)}`, `status ${JSON.stringify(b.dashboard.taskStatus)}`, `health ${JSON.stringify(b.dashboard.scheduleHealth)}`, `attention ${JSON.stringify(b.dashboard.attention)}`,
  ];
}
const withoutGenerated = (text: string) => text.split('\n').filter(line => !/^Generated: /.test(line)).join('\n');
const fakeNow = (now: string) => jest.useFakeTimers({ now: Date.parse(now), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });

function phoneTruths(world: World) {
  return buildDAVEReportProjectTruths({
    projects: [{ name: world.project, projectId: `report:${world.project.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` }], projectRecords: [{ name: world.project }] as never,
    updates: world.updates, scheduleItems: world.shown ?? world.items, knownScheduleItems: world.items, knownScheduleDocuments: world.documents, projectAreas: [], referenceDocuments: world.documents,
  });
}
function desktopTruths(world: World, now: string) {
  return WebOps.buildDAVEWebReportTruths({
    projects: [{ id: '5f0c2a9e-1b1d-4c55-9a53-0d6f2c7c1a10', name: world.project }], scheduleItems: world.shown ?? world.items, knownScheduleItems: world.items,
    projectUpdates: world.updates.map(entry => ({ id: entry.id, updateData: entry })), referenceDocuments: world.documents, refreshedAt: now,
  } as never, world.project);
}
/** The app's own draft, as providers/PIELiveAuthorityProvider makes it for the Reports screen (the plain Core). */
function appDraft(world: World) {
  return buildPIECoreIntelligence({
    runtimeContext: {
      projectName: world.project, projectNames: [world.project], reportType: 'daily_project_update', updates: world.updates, scheduleItems: world.shown ?? world.items,
      knownScheduleItems: world.items, currentUpdate: null, projectAreas: [], contacts: { contacts: [] }, referenceDocuments: world.documents, surface: 'reports',
    } as never,
    reportType: 'daily_project_update' as never, reportProjectNames: [world.project], organizationId: 'local-unverified-anonymous', projectId: 'project-x',
  } as never).reportDraft as never;
}
/** The 2.0 value of the same facts: the app's own 2.0 code (the head itself, before this change, has no other). */
const version2 = (truths: never) => ((RI as unknown as Record<string, (t: never) => string>).buildDAVEVersion2ReportSourceFingerprint ?? RI.buildDAVEReportSourceFingerprint)(truths);

type Morning = { fingerprint: string; desktopFingerprint: string; v2: string; printed: Record<string, string> };
function morning(world: World, now: string): Morning {
  fakeNow(now);
  try {
    const truths = phoneTruths(world);
    const briefing = RI.buildDAVEReportBriefing({ truths, selectedProjectNames: [world.project], previousSnapshot: null, scheduleItems: world.items } as never);
    const draft = appDraft(world);
    const web = desktopTruths(world, now);
    const webBriefing = WebOps.buildDAVEWebReportDraft({
      projects: [{ id: '5f0c2a9e-1b1d-4c55-9a53-0d6f2c7c1a10', name: world.project }], scheduleItems: world.shown ?? world.items, knownScheduleItems: world.items,
      projectUpdates: world.updates.map(entry => ({ id: entry.id, updateData: entry })), referenceDocuments: world.documents, refreshedAt: now,
    } as never, world.project);
    return {
      fingerprint: RI.buildDAVEReportSourceFingerprint(truths),
      desktopFingerprint: RI.buildDAVEReportSourceFingerprint(web),
      v2: version2(truths as never),
      printed: {
        'the phone\'s written report (Copy, e-mail, text, Word), Project Manager': String(RI.enhanceDAVEReportDraft(draft, briefing, 'project_manager').body),
        'the phone\'s written report, Executive': String(RI.enhanceDAVEReportDraft(draft, briefing, 'executive').body),
        'the Reports preview': printedOnScreen(briefing).join('\n'),
        'the desktop\'s Reports page': printedOnScreen(webBriefing).join('\n'),
        'the desktop\'s report, Project Manager': withoutGenerated(WebOps.formatDAVEWebReport(webBriefing, 'project_manager')),
        'the desktop\'s report, Executive': withoutGenerated(WebOps.formatDAVEWebReport(webBriefing, 'executive')),
      },
    };
  } finally {
    jest.useRealTimers();
  }
}
const fourteenMornings = (world: World) => Array.from({ length: 15 }, (_unused, day) => morning(world, new Date(Date.parse(world.day0) + day * DAY).toISOString()));
const readings = new Map<string, Morning[]>();
const mornings = (name: string, make: () => World) => {
  if (!readings.has(name)) readings.set(name, fourteenMornings(make()));
  return readings.get(name) as Morning[];
};

describe('HIGH 1. Fourteen mornings with nothing changed: the report is offered again only on a morning a word moved', () => {
  it.each(WORLDS)('%s: the fingerprint moves on a morning if and only if some output reads differently; the phone and the desktop agree every morning', (name, make) => {
    const read = mornings(name, make);
    const wrong: string[] = [];
    let moved = 0;
    read.slice(1).forEach((today, index) => {
      const yesterday = read[index];
      const outputs = Object.keys(today.printed).filter(output => today.printed[output] !== yesterday.printed[output]);
      const fingerprintMoved = today.fingerprint !== yesterday.fingerprint;
      if (fingerprintMoved) moved += 1;
      if (fingerprintMoved !== outputs.length > 0) {
        wrong.push(`morning ${index + 1}: the fingerprint ${fingerprintMoved ? 'MOVED' : 'did not move'}; outputs that read differently: ${outputs.join(', ') || 'NONE'}`);
      }
    });
    expect({ name, wrong }).toEqual({ name, wrong: [] });
    expect(read.map(entry => entry.desktopFingerprint)).toEqual(read.map(entry => entry.fingerprint));
    // Something does move with the calendar in the three that have open work (the check is not asleep).
    if (name !== 'Fennel Court') expect(moved).toBeGreaterThan(0);
  });

  it('review pass 3\'s mornings 7, 11, 13 and 14 (and the quiet project\'s 8th): offered again on the build before with no word changed; not now', () => {
    const quiet = (name: string, make: () => World, days: number[]) => {
      const read = mornings(name, make);
      return days.map(day => ({ day, v2Moved: read[day].v2 !== read[day - 1].v2, moved: read[day].fingerprint !== read[day - 1].fingerprint }));
    };
    expect(quiet('Alpha (review pass 3)', alpha, [7, 11, 13, 14])).toEqual([7, 11, 13, 14].map(day => ({ day, v2Moved: true, moved: false })));
    expect(quiet('Fennel Court', fennelCourt, [8])).toEqual([{ day: 8, v2Moved: true, moved: false }]);
  });
});

describe('HIGH 1. A report sent on the build before (a 2.0 fingerprint) is known exactly where that build knew it', () => {
  it.each(WORLDS)('%s: the 2.0 value worked out beside today\'s is a5cab6c\'s own, every morning', (name, make) => {
    expect(mornings(name, make).map(entry => entry.v2)).toEqual(ON_A5CAB6C[name].map(hash => `dave-report-source/2.0:${hash}`));
  });

  it.each(WORLDS)('%s: a report sent on a5cab6c on any morning is "the same report" on a later morning exactly when a5cab6c would say so', (name, make) => {
    const read = mornings(name, make);
    const differ: string[] = [];
    read.forEach((sentOn, sentDay) => {
      const sentFingerprint = `dave-report-source/2.0:${ON_A5CAB6C[name][sentDay]}`;
      read.slice(sentDay).forEach((openedOn, offset) => {
        // Today's value is worked out first (the screen does), and with it the 2.0 name of the same facts.
        fakeNow(new Date(Date.parse(make().day0) + (sentDay + offset) * DAY).toISOString());
        try { RI.buildDAVEReportSourceFingerprint(phoneTruths(make())); } finally { jest.useRealTimers(); }
        const known = Snapshots.sameReportSource(sentFingerprint, openedOn.fingerprint);
        const a5cab6cKnows = ON_A5CAB6C[name][sentDay + offset] === ON_A5CAB6C[name][sentDay];
        if (known !== a5cab6cKnows) differ.push(`sent on morning ${sentDay}, opened on morning ${sentDay + offset}: known ${known}, a5cab6c ${a5cab6cKnows}`);
        // The desktop's longer source fingerprint (with its photos' part) the same way.
        const web = Snapshots.sameReportSource(`${sentFingerprint}:media-0a0b0c0d`, `${openedOn.fingerprint}:media-0a0b0c0d`);
        if (web !== a5cab6cKnows) differ.push(`(desktop) sent on morning ${sentDay}, opened on morning ${sentDay + offset}: known ${web}, a5cab6c ${a5cab6cKnows}`);
      });
    });
    expect(differ).toEqual([]);
    expect(read[0].fingerprint.startsWith('dave-report-source/2.0:')).toBe(false);
  });

  it('the period: approving the same facts over a 2.0 approval saves nothing new; a 2.0 report sent is counted from as before; it is not "read as an earlier version\'s report" (that is 1.0\'s alone)', () => {
    const world = alpha();
    fakeNow(world.day0);
    try {
      const truths = phoneTruths(world);
      const today = RI.buildDAVEReportSourceFingerprint(truths);
      const scopeKey = Snapshots.daveReportSnapshotScopeKey(['Alpha']);
      const onA5cab6c = Snapshots.buildDAVEReportSnapshot({ truths, scopeKey, sourceFingerprint: `dave-report-source/2.0:${ON_A5CAB6C['Alpha (review pass 3)'][0]}`, capturedAt: world.day0, reportFormat: 'project_manager' });
      const current = Snapshots.buildDAVEReportSnapshot({ truths, scopeKey, sourceFingerprint: today, capturedAt: world.day0, reportFormat: 'project_manager' });
      const sent = Snapshots.markReportSnapshotDelivered({ ...onA5cab6c, deliveredAt: null }, '2026-10-01T17:00:00.000Z', 'install-ipad');
      expect(Snapshots.reportSnapshotToSave(current, sent)).toBeNull();
      expect(Snapshots.reportBaselineSnapshot(sent, today)).toBe(sent.supersedes ?? null);
      expect(Snapshots.reportReadAsEarlierVersionReport(sent, today)).toBe(false);
      // A 1.0 record is still never taken for today's report (R10).
      expect(Snapshots.sameReportSource('dave-report-source/1.0:0badc0de', today)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ---- F2 to F6b: what the phone's written report prints that 2.0 did not hold ----
const SMALL_COMPARISON = (summary: string, prior: string, area: string) => ({ photoIntelligence: { ...COMPARISON, summary, location: area, diagnostics: { selectedPriorPhotoId: prior } } });
/** A small project (Hollow Pines): one task finishing first, two later ones, notes and photos, one comparison he confirmed. */
function hollowPines(dueOfPour = 12): World {
  const p = 'Hollow Pines';
  const frame = task(p, 'hp-frame', 'Frame walls', 'Level 2', 100, -5, 'Dana');
  const pour = task(p, 'hp-pour', 'Pour slab', 'Level 1', 40, dueOfPour, 'Dana');
  const steel = task(p, 'hp-steel', 'Erect steel', 'Level 1', 0, dueOfPour + 1, 'Mara');
  const roof = task(p, 'hp-roof', 'Set roof trusses', 'Roof', 0, 80, 'Luis');
  const grade = task(p, 'hp-grade', 'Grade the lot', 'Site', 100, -10, 'Mara');
  return {
    project: p, day0: DAY0, items: [frame, pour, steel, roof, grade], documents: [],
    updates: [
      update(p, 'hp-u4', roof, 3, '', [photo('hp-p4', 'Roof', '', SMALL_COMPARISON('Roof trusses have been set on the north half.', 'hp-p0', 'Roof'))]),
      update(p, 'hp-u3', pour, 3, 'West bay forms started. Pump truck is booked for Tuesday.', [photo('hp-p3a', 'Level 1', 'West bay footing with rebar'), photo('hp-p3b', 'Level 1', 'Rebar chairs at grid C')]),
      update(p, 'hp-u2', frame, 4, 'Framing is complete on Level 2. Inspection passed.', [photo('hp-p2', 'Level 2', 'Framing complete')]),
      update(p, 'hp-u1', grade, 6, 'Called the office about parking.', []),
      update(p, 'hp-u0', roof, 8, '', [photo('hp-p0', 'Roof', '')]),
    ],
  };
}
const read = (world: World, now: string) => { const m = morning(world, now); return { fingerprint: m.fingerprint, desktop: m.desktopFingerprint, text: m.printed['the phone\'s written report (Copy, e-mail, text, Word), Project Manager'] }; };
const withItem = (world: World, id: string, change: (item: ScheduleItem) => ScheduleItem): World => ({ ...world, items: world.items.map(item => (item.id === id ? change(item) : item)) });
const withUpdate = (world: World, id: string, change: (item: ProjectUpdate) => ProjectUpdate): World => ({ ...world, updates: world.updates.map(item => (item.id === id ? change(item) : item)) });

describe('HIGH 1. F2 to F6b: a change the phone\'s written report prints moves the fingerprint', () => {
  const on = (day: number) => new Date(D0 + day * DAY).toISOString();
  type Case = { before: [World, string]; after: [World, string]; line: RegExp };
  const cases: Array<[string, () => Case]> = [
    ['F2: a later task made High priority ("<owner> – Please confirm the current status of <task>.")', () => ({ before: [hollowPines(), on(0)], after: [withItem(hollowPines(), 'hp-roof', item => ({ ...item, priority: 'High' } as ScheduleItem)), on(0)], line: /Please confirm the current status of Set roof trusses/ })],
    ['F2b: a task named a milestone ("Schedule focus" passes to it)', () => ({ before: [hollowPines(), on(0)], after: [withItem(hollowPines(), 'hp-steel', item => ({ ...item, milestone: 'Steel topped out' })), on(0)], line: /Schedule focus: Erect steel/ })],
    ['F3: the morning a task comes within two weeks and is the "Schedule focus"', () => ({ before: [hollowPines(15), on(0)], after: [hollowPines(15), on(1)], line: /Schedule focus: Pour slab/ })],
    ['F4: the morning a confirmed comparison stops being quoted (its 8th day)', () => ({ before: [hollowPines(60), on(3)], after: [hollowPines(60), on(4)], line: /Roof trusses have been set on the north half/ })],
    ['F5: the photos of one update in another order (image numbers, "Latest photo")', () => ({ before: [hollowPines(), on(0)], after: [withUpdate(hollowPines(), 'hp-u3', item => ({ ...item, photos: [...item.photos].reverse() })), on(0)], line: /Rebar chairs at grid C|West bay footing with rebar|Latest photo|See Image/ })],
    ['F6: a note marked as the photo analysis\'s own suggestion, accepted word for word', () => ({ before: [hollowPines(), on(0)], after: [withUpdate(hollowPines(), 'hp-u1', item => ({ ...item, pieSuggestedNote: item.notes, pieSuggestedNoteAccepted: true } as ProjectUpdate)), on(0)], line: /Called the office about parking/ })],
    ['F6b: the confirmed comparison\'s summary reworded alone', () => ({ before: [hollowPines(), on(0)], after: [withUpdate(hollowPines(), 'hp-u4', item => ({ ...item, photos: item.photos.map(entry => ({ ...entry, photoIntelligence: { ...(entry as unknown as { photoIntelligence: object }).photoIntelligence, summary: 'Roof trusses have been set and braced on the north half.' } })) } as ProjectUpdate)), on(0)], line: /Roof trusses have been set/ })],
    ['(review pass 3, part A) an update filed under another schedule project name, still the project\'s by its task', () => ({ before: [hollowPines(), on(0)], after: [withUpdate(hollowPines(), 'hp-u3', item => ({ ...item, scheduleProjectName: 'Hollow Pines North' })), on(0)], line: /Hollow Pines North|See Image/ })],
  ];
  it.each(cases)('%s', (_name, make) => {
    const { before, after, line } = make();
    const one = read(...before);
    const two = read(...after);
    // The phone's written report does read differently, in the lines the case is about (the case is real)...
    const about = (text: string) => text.split('\n').filter(entry => line.test(entry));
    expect(two.text).not.toBe(one.text);
    expect(about(two.text)).not.toEqual(about(one.text));
    // ...so the fingerprint moves, on the phone and on the desktop alike.
    expect({ phone: two.fingerprint !== one.fingerprint, desktop: two.desktop !== one.desktop, oneValue: two.desktop === two.fingerprint })
      .toEqual({ phone: true, desktop: true, oneValue: true });
  });
});
