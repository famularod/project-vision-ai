/**
 * N773c (review pass 2 of N773, P2-1 to P2-4): the Word file says a photo "shows this work" on its own task's line, and
 * only there, also where an area's name has brackets that do not pair, a task's name holds ": ", or two names differ
 * only in a vowel sign or voicing mark.
 *
 *  P2-1 (caused by 5598047a) a task whose AREA's name has an unclosed bracket ("Unit 4 (rear", "Lot 3)") or brackets
 *       two levels deep ("Bldg B (East (rear))") lost its own photo on its Completed Work, Current Work and Schedule
 *       Risks lines (the area after the task was not read, so neither was the task);
 *  P2-2 (older) "Electrical"'s photo was named on "Electrical: trim (Level 2): ..." and "Electrical: rough-in (Level 2)
 *       ..." (the task's name was read up to its first ": ");
 *  P2-3 (older; back with 68478340) "Drywall"'s photo was named on the Action Plan line of "Level 3: Drywall" in the
 *       same area ("<project> — Building A: Level 3: Drywall. Issue: ..." read as area "Building A: Level 3");
 *  P2-4 (older; back with 68478340) two tasks whose names differ only in a Hindi vowel sign, a Thai vowel or a Japanese
 *       voicing mark ("काम" / "कम") read as one, so one's photo was named on the other's lines.
 * The report text, its fingerprint and every photo's number and citation are unchanged. The draft, the briefing, the
 * photo descriptions and the Word builder are the app's own code. Made-up projects. No network.
 */
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  const api = {
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { store.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { store.delete(key); }),
    getAllKeys: jest.fn(async () => Array.from(store.keys())),
    multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, store.get(key) ?? null])),
  };
  return { __esModule: true, default: api, ...api };
});

import JSZip from 'jszip';
import { buildPIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { buildDAVEReportBriefing, enhanceDAVEReportDraft } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildReportWordBase64, type ReportWordMedia } from '../../services/ReportWordDocument';
import { reportWordPhotoDescription } from '../../services/ReportWordMediaDescription';
import type { ProjectUpdate, ScheduleItem } from '../../types';

jest.setTimeout(180_000);
const NOW = '2026-10-15T02:05:00.000Z';
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlL6iQAAAAASUVORK5CYII=', 'base64'));
const SENTENCE = / (?:Photos? (\d+(?:(?:, | and |, and )\d+)*) shows? this work\.)$/;

const task = (id: string, project: string, name: string, area: string, finish: string, percent: number) => ({
  id, projectName: project, scheduleProjectName: project, locationName: area, taskName: name, startDate: '09/01/2026',
  finishDate: finish, milestone: '', owner: 'Dana', contractor: 'Acme', percentComplete: percent, priority: 'Medium',
  status: percent >= 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z',
}) as unknown as ScheduleItem;
/** A field update as the app makes one from a task (Add Photo on the task: the task's area). */
const update = (id: string, project: string, area: string, notes: string, photoId: string, linked: ScheduleItem) => ({
  id, projectName: project, scheduleProjectName: project, date: '2026-10-12', status: 'sent', recipients: { contactIds: [] },
  selectedAreaName: area, notes,
  photos: [{
    id: photoId, uri: `file:///p/${photoId}.jpg`, caption: '', category: 'Update', actionRequired: '', actionOwner: '',
    actionDueDate: '', actionStatus: 'Open', fileName: `${photoId}.jpg`, mimeType: 'image/jpeg', createdAt: '2026-10-12T12:00:00.000Z',
  }],
  scheduleItemId: linked.id, scheduleTaskName: linked.taskName,
}) as unknown as ProjectUpdate;

async function paragraphsOf(base64: string): Promise<string[]> {
  const zip = await JSZip.loadAsync(Buffer.from(base64, 'base64'));
  const xml = await zip.file('word/document.xml')!.async('string');
  return Array.from(xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)).map(match =>
    Array.from(match[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)).map(t => t[1]).join('')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
}

/** The Word file of a report as the phone makes it (as tests/services/n773b-word-photo-own-line-unusual-names.test.ts). */
async function wordFile(projects: string[], updates: ProjectUpdate[], items: ScheduleItem[],
  format: 'project_manager' | 'executive' = 'project_manager') {
  const single = projects.length === 1;
  jest.useFakeTimers({ now: Date.parse(NOW), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
  let report: { title: string; body: string };
  let numberOf: Map<string, number>;
  try {
    const truths = buildDAVEReportProjectTruths({
      projects: projects.map(name => ({ name, projectId: `report:${name.toLowerCase()}` })), projectRecords: projects.map(name => ({ name })) as never,
      updates, scheduleItems: items, knownScheduleItems: items, knownScheduleDocuments: [], projectAreas: [], referenceDocuments: [],
    } as never);
    const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: projects, previousSnapshot: null, scheduleItems: items } as never);
    const reportType = single ? 'daily_project_update' : 'combined_project_update';
    const core = buildPIECoreIntelligence({
      runtimeContext: {
        projectName: single ? projects[0] : 'Combined Project Portfolio', projectNames: projects, reportType, updates,
        scheduleItems: items, knownScheduleItems: items, currentUpdate: null, projectAreas: [], contacts: { contacts: [] },
        referenceDocuments: [], surface: 'reports',
      } as never,
      reportType: reportType as never, reportProjectNames: projects, organizationId: 'local-unverified-anonymous', projectId: 'project-x',
    } as never);
    const draft = core.reportDraft as unknown as { locationGroups: Array<{ workAreas: Array<{ imageReferences: Array<{ photoId: string; imageNumber: number }> }> }> };
    numberOf = new Map(draft.locationGroups.flatMap(group => group.workAreas.flatMap(area =>
      area.imageReferences.map(reference => [reference.photoId, reference.imageNumber] as const))));
    report = enhanceDAVEReportDraft(core.reportDraft as never, briefing, format) as never;
  } finally {
    jest.useRealTimers();
  }
  const media: ReportWordMedia[] = updates.flatMap(item => item.photos.filter(photo => numberOf.has(photo.id)).map(photo => {
    const described = reportWordPhotoDescription(photo, item);
    return {
      id: photo.id, kind: 'photo' as const, displayNumber: numberOf.get(photo.id)!, caption: described.caption, data: PNG,
      mimeType: 'image/png', width: 1, height: 1, projectName: described.projectName, areaName: described.areaName,
      linkedTaskName: described.linkedTaskName, recordedAt: described.recordedAt, reasonForInclusion: described.reasonForInclusion,
    };
  }));
  const paragraphs = await paragraphsOf(await buildReportWordBase64({ title: report.title, body: report.body, generatedAt: NOW, media }));
  // Every photo is shown once ("Photo N"); in the project manager format also cited once in the report's words.
  const numbers = [...numberOf.values()].sort((a, b) => a - b);
  if (format === 'project_manager') {
    const cited = paragraphs.flatMap(paragraph => Array.from(paragraph.matchAll(/See Images? ([0-9, and]+)\./g))
      .flatMap(match => match[1].split(/\D+/).filter(Boolean).map(Number)));
    expect([...cited].sort((a, b) => a - b)).toEqual(numbers);
  }
  const shown = paragraphs.map(paragraph => paragraph.match(/^Photo (\d+)$/)?.[1]).filter(Boolean).map(Number);
  expect([...shown].sort((a, b) => a - b)).toEqual(numbers);
  /** The lines that say the photo shows their work, cut before their first ". Issue: ", "; " or " is overdue". */
  const linesNaming = (photoId: string) => paragraphs.flatMap(paragraph => {
    const match = paragraph.match(SENTENCE);
    if (!match || !match[1].split(/\D+/).map(Number).includes(numberOf.get(photoId)!)) return [];
    return [paragraph.slice(0, match.index).split(/(?:\. Issue: |; | is overdue)/)[0]];
  });
  return { body: report.body, linesNaming };
}

const STEEL = task('t-steel', 'Quarry Row', 'Set steel', 'Site', '03/31/2027', 40);
const STEEL_UPDATE = update('u-steel', 'Quarry Row', 'Site', 'Columns set.', 'p-steel', STEEL);

describe('N773c: a Word task line names its own task\'s photo, and only there (review pass 2)', () => {
  it.each([
    ['an unclosed bracket', 'Unit 4 (rear'],
    ['a closing bracket alone', 'Lot 3)'],
    ['brackets two levels deep', 'Bldg B (East (rear))'],
  ])('P2-1: an area whose name has %s keeps its task\'s photo on every line of that task', async (_kind, area) => {
    const paint = task('t-paint', 'Heron Yard', 'Paint', area, '10/09/2026', 40);
    const doors = task('t-doors', 'Heron Yard', 'Hang doors', area, '09/30/2026', 100);
    const updates = [
      update('u-paint', 'Heron Yard', area, 'First coat.', 'p-paint', paint),
      update('u-doors', 'Heron Yard', area, 'Doors were hung.', 'p-doors', doors),
      STEEL_UPDATE,
    ];
    const pm = await wordFile(['Heron Yard', 'Quarry Row'], updates, [paint, doors, STEEL]);
    expect(pm.body).toContain(`Heron Yard — Paint (${area}): In Progress; 40% complete; due 10/09/2026.`);
    // Was (5598047a, 68478340): only the Action Plan line; Hang doors (Completed Work only) on no line.
    expect(pm.linesNaming('p-paint')).toEqual([
      `Heron Yard — Paint (${area}): In Progress`,
      `Heron Yard — ${area}: Paint`,
      `Heron Yard — Paint (${area})`,
    ]);
    expect(pm.linesNaming('p-doors')).toEqual([`Heron Yard — Hang doors (${area}): Complete`]);
    expect(pm.linesNaming('p-steel')).toEqual(['Quarry Row — Set steel (Site): In Progress']);

    // The executive format: Hang doors' Completed Work line (was: no photo named in the whole file).
    const executive = await wordFile(['Heron Yard', 'Quarry Row'], updates, [paint, doors, STEEL], 'executive');
    expect(executive.linesNaming('p-doors')).toEqual([`Heron Yard — Hang doors (${area}): Complete`]);
    expect(executive.linesNaming('p-paint')).toEqual([]);
  });

  it('P2-1: ... also on a conflict the project\'s records state about the task, and not on a same-named task elsewhere', async () => {
    const body = [
      'CURRENT WORK',
      '• Heron Yard — Paint (Unit 4 (rear): In Progress; 40% complete; due 10/09/2026.',
      '• Heron Yard — Paint (Unit 4): In Progress; 10% complete; due 10/09/2026.',
      '',
      'SCHEDULE RISKS',
      '• Heron Yard — Paint (Unit 4 (rear) has conflicting status information; the schedule shows in progress at 40% complete.',
      '• Heron Yard: Paint (Unit 4 (rear): The field update says complete. Check the field condition or correct the task status.',
    ].join('\n');
    const paragraphs = await paragraphsOf(await buildReportWordBase64({ title: 'Report', body, generatedAt: NOW, media: [{
      id: 'p', kind: 'photo', displayNumber: 1, caption: 'c', data: PNG, mimeType: 'image/png', width: 1, height: 1,
      projectName: 'Heron Yard', areaName: 'Unit 4 (rear', linkedTaskName: 'Paint',
    }] }));
    expect(paragraphs.filter(paragraph => SENTENCE.test(paragraph))).toEqual([
      'Heron Yard — Paint (Unit 4 (rear): In Progress; 40% complete; due 10/09/2026. Photo 1 shows this work.',
      'Heron Yard — Paint (Unit 4 (rear) has conflicting status information; the schedule shows in progress at 40% complete. Photo 1 shows this work.',
      'Heron Yard: Paint (Unit 4 (rear): The field update says complete. Check the field condition or correct the task status. Photo 1 shows this work.',
    ]);
  });

  it('P2-2: a task\'s photo is not named on the lines of tasks named "<task>: ..." in its area', async () => {
    const electrical = task('t-el', 'Heron Yard', 'Electrical', 'Level 2', '03/31/2027', 40);
    const roughIn = task('t-ro', 'Heron Yard', 'Electrical: rough-in', 'Level 2', '10/09/2026', 40);
    const trim = task('t-tr', 'Heron Yard', 'Electrical: trim', 'Level 2', '09/30/2026', 100);
    const updates = [
      update('u-el', 'Heron Yard', 'Level 2', 'Panel set.', 'p-el', electrical),
      update('u-ro', 'Heron Yard', 'Level 2', 'Rough-in on the east side.', 'p-ro', roughIn),
      STEEL_UPDATE,
    ];
    const pm = await wordFile(['Heron Yard', 'Quarry Row'], updates, [electrical, roughIn, trim, STEEL]);
    expect(pm.body).toContain('Heron Yard — Electrical: trim (Level 2): Complete; 100% complete.');
    // Was: also on "Electrical: trim (Level 2): Complete ..." and on both of rough-in's lines.
    expect(pm.linesNaming('p-el')).toEqual(['Heron Yard — Electrical (Level 2): In Progress']);
    expect(pm.linesNaming('p-ro')).toEqual([
      'Heron Yard — Electrical: rough-in (Level 2): In Progress',
      'Heron Yard — Level 2: Electrical: rough-in',
      'Heron Yard — Electrical: rough-in (Level 2)',
    ]);
    // The executive format: its only photo line was trim's Completed Work line, naming Electrical's photo.
    const executive = await wordFile(['Heron Yard', 'Quarry Row'], updates, [electrical, roughIn, trim, STEEL], 'executive');
    expect(executive.linesNaming('p-el')).toEqual([]);
  });

  it('P2-2: ... while a task with no area and Decisions Required still end the task\'s name at ": "', async () => {
    const body = [
      'CURRENT WORK',
      '• Heron Yard — Electrical: trim (Level 2): In Progress; 40% complete; due 10/09/2026.',
      '• Heron Yard — Electrical: In Progress; 40% complete; due 10/09/2026. Level 2 panel.',
      '',
      'DECISIONS REQUIRED',
      '• Heron Yard — Electrical: Approve the Level 2 panel change.',
      '• Heron Yard — Electrical: trim: Approve the Level 2 fixtures.',
    ].join('\n');
    const paragraphs = await paragraphsOf(await buildReportWordBase64({ title: 'Report', body, generatedAt: NOW, media: [{
      id: 'p', kind: 'photo', displayNumber: 1, caption: 'c', data: PNG, mimeType: 'image/png', width: 1, height: 1,
      projectName: 'Heron Yard', areaName: 'Level 2', linkedTaskName: 'Electrical',
    }] }));
    // A Decisions line prints no area; "Electrical: trim: ..." there may be Electrical's own (kept, as before).
    expect(paragraphs.filter(paragraph => SENTENCE.test(paragraph))).toEqual([
      'Heron Yard — Electrical: In Progress; 40% complete; due 10/09/2026. Level 2 panel. Photo 1 shows this work.',
      'Heron Yard — Electrical: Approve the Level 2 panel change. Photo 1 shows this work.',
      'Heron Yard — Electrical: trim: Approve the Level 2 fixtures. Photo 1 shows this work.',
    ]);
  });

  it('P2-3: a task\'s photo is not named on the Action Plan line of "<X>: <task>" in its area', async () => {
    const level3 = task('t-d3', 'Heron Yard', 'Level 3: Drywall', 'Building A', '09/01/2026', 40);
    const drywall = task('t-dw', 'Heron Yard', 'Drywall', 'Building A', '09/30/2026', 100);
    const single = await wordFile(['Heron Yard'], [
      update('u-dw', 'Heron Yard', 'Building A', 'Drywall done on 2.', 'p-dw', drywall),
      update('u-d3', 'Heron Yard', 'Building A', 'Level 3 boarded.', 'p-d3', level3),
    ], [level3, drywall]);
    expect(single.body).toContain('Heron Yard — Building A: Level 3: Drywall. Issue: ');
    // Was (68478340, 1f445154): "Photos 1 and 2" there (Drywall's too: read as area "Building A: Level 3").
    expect(single.linesNaming('p-dw')).toEqual([]);
    expect(single.linesNaming('p-d3')).toEqual(['Heron Yard — Building A: Level 3: Drywall']);

    const framing = task('t-fr', 'Heron Yard', 'Framing', 'Yard', '03/31/2027', 40);
    const phase2 = task('t-pf', 'Heron Yard', 'Phase 2: Framing', 'Yard', '09/01/2026', 40);
    const framed = await wordFile(['Heron Yard'], [
      update('u-fr', 'Heron Yard', 'Yard', 'Framing started.', 'p-fr', framing),
      update('u-pf', 'Heron Yard', 'Yard', 'Phase 2 framing.', 'p-pf', phase2),
    ], [phase2, framing]);
    expect(framed.linesNaming('p-fr')).toEqual([]);
    expect(framed.linesNaming('p-pf')).toEqual(['Heron Yard — Yard: Phase 2: Framing']);
  });

  it.each([
    ['a Hindi vowel sign', 'काम', 'कम'],
    ['a Thai vowel', 'ทาสี', 'ทาส'],
    ['a Japanese voicing mark', 'ガス配管', 'カス配管'],
  ])('P2-4: two task names that differ only in %s are told apart', async (_kind, own, other) => {
    const ownTask = task('t-own', 'Lark Hill', own, 'Yard', '10/09/2026', 40);
    const otherTask = task('t-other', 'Lark Hill', other, 'Yard', '10/09/2026', 40);
    const { body, linesNaming } = await wordFile(['Lark Hill', 'Quarry Row'], [
      update('u-own', 'Lark Hill', 'Yard', 'Work recorded.', 'p-own', ownTask), STEEL_UPDATE,
    ], [ownTask, otherTask, STEEL]);
    expect(body).toContain(`Lark Hill — ${other} (Yard): In Progress; 40% complete; due 10/09/2026.`);
    // Was (68478340): also on the other task's lines. Its own Current Work and Schedule Risks lines keep it.
    // (The report's Action Plan keeps one of the two names: it compares them by Latin letters.)
    const ownLines = [`Lark Hill — ${own} (Yard): In Progress`, `Lark Hill — Yard: ${own}`, `Lark Hill — ${own} (Yard)`];
    const lines = linesNaming('p-own');
    expect(lines).toEqual(expect.arrayContaining([ownLines[0], ownLines[2]]));
    expect(lines.filter(line => !ownLines.includes(line))).toEqual([]);
  });

  it('P2-4: names in other scripts with accents read as before (the Latin accents dropped, as in the Latin reading)', async () => {
    const body = [
      'CURRENT WORK',
      '• Lark Hill — Покраска́ (Yard): In Progress; 40% complete; due 10/09/2026.',
      '• Lark Hill — काम (Yard): In Progress; 40% complete; due 10/09/2026.',
    ].join('\n');
    const photo = (id: string, displayNumber: number, linkedTaskName: string): ReportWordMedia => ({
      id, kind: 'photo', displayNumber, caption: 'c', data: PNG, mimeType: 'image/png', width: 1, height: 1,
      projectName: 'Lark Hill', areaName: 'Yard', linkedTaskName,
    });
    const paragraphs = await paragraphsOf(await buildReportWordBase64({ title: 'Report', body, generatedAt: NOW,
      media: [photo('ru', 1, 'Покраска'), photo('hi', 2, 'काम'), photo('hi2', 3, 'कम')] }));
    expect(paragraphs.filter(paragraph => SENTENCE.test(paragraph))).toEqual([
      'Lark Hill — Покраска́ (Yard): In Progress; 40% complete; due 10/09/2026. Photo 1 shows this work.',
      'Lark Hill — काम (Yard): In Progress; 40% complete; due 10/09/2026. Photo 2 shows this work.',
    ]);
  });
});
