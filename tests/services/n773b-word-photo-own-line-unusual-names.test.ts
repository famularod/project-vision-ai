/**
 * N773b (review pass 1 of N773, R1, R4, R5, R7): the Word file says a photo "shows this work" on its own task's line,
 * also for unusual names.
 *
 * 7.73 (5598047a) made a Word task line name only the photos of its own task. Its review found four set-ups where that
 * was not so:
 *  R1 a task named only in non-Latin letters ("Покраска") lost its own photo line: its name read as empty, so its photo
 *     was taken for one with no task;
 *  R4 an area whose name holds ": " ("Bldg A: Level 2") lost its task's photo on the Action Plan line
 *     ("Heron Yard — Bldg A: Level 2: Paint. Issue: ..." was read as the task "Level 2: Paint");
 *  R5 (older) a task named like its area ("Roof" in Roof) had its photo named on the Action Plan line of every task of
 *     that area ("Heron Yard — Roof: Flashing. Issue: ..."), and on a same-named task's line in another area ("Lark Hill
 *     Annex — Level 2 (Lobby)"); a task named like another task plus its area ("Paint lobby" beside "Paint" in Lobby)
 *     had its photo named on the other's lines ("Heron Yard — Paint (Lobby): ...");
 *  R7 the line was read again at every separator for every photo: packed lines took close to a minute.
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
/** A field update as the app makes one: from a task (its area), or with no task. */
const update = (id: string, project: string, area: string, notes: string, photoId: string, linked?: ScheduleItem) => ({
  id, projectName: project, scheduleProjectName: project, date: '2026-10-12', status: 'sent', recipients: { contactIds: [] },
  selectedAreaName: area, notes,
  photos: [{
    id: photoId, uri: `file:///p/${photoId}.jpg`, caption: '', category: 'Update', actionRequired: '', actionOwner: '',
    actionDueDate: '', actionStatus: 'Open', fileName: `${photoId}.jpg`, mimeType: 'image/jpeg', createdAt: '2026-10-12T12:00:00.000Z',
  }],
  ...(linked ? { scheduleItemId: linked.id, scheduleTaskName: linked.taskName } : {}),
}) as unknown as ProjectUpdate;

async function paragraphsOf(base64: string): Promise<string[]> {
  const zip = await JSZip.loadAsync(Buffer.from(base64, 'base64'));
  const xml = await zip.file('word/document.xml')!.async('string');
  return Array.from(xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)).map(match =>
    Array.from(match[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)).map(t => t[1]).join('')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
}

/** The Word file of a report as the phone makes it (as tests/services/n773-word-photo-shows-only-its-own-task.test.ts). */
async function wordFile(projects: string[], updates: ProjectUpdate[], items: ScheduleItem[]) {
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
    report = enhanceDAVEReportDraft(core.reportDraft as never, briefing, 'project_manager') as never;
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
  // Every photo is cited exactly once in the report's words ("See Image N.") and shown once ("Photo N").
  const numbers = [...numberOf.values()].sort((a, b) => a - b);
  const cited = paragraphs.flatMap(paragraph => Array.from(paragraph.matchAll(/See Images? ([0-9, and]+)\./g))
    .flatMap(match => match[1].split(/\D+/).filter(Boolean).map(Number)));
  expect([...cited].sort((a, b) => a - b)).toEqual(numbers);
  const shown = paragraphs.map(paragraph => paragraph.match(/^Photo (\d+)$/)?.[1]).filter(Boolean).map(Number);
  expect([...shown].sort((a, b) => a - b)).toEqual(numbers);
  /** The lines that say the photo shows their work, cut before their first ". " or "; " (the line's own words). */
  const linesNaming = (photoId: string) => paragraphs.flatMap(paragraph => {
    const match = paragraph.match(SENTENCE);
    if (!match || !match[1].split(/\D+/).map(Number).includes(numberOf.get(photoId)!)) return [];
    return [paragraph.slice(0, match.index).split(/(?:\. Issue: |; | is overdue)/)[0]];
  });
  return { body: report.body, linesNaming };
}

describe('N773b: a Word task line names its own task\'s photo, also for unusual names', () => {
  it('R1: a task named in non-Latin letters keeps its own photo, and only there', async () => {
    const ru = task('t-ru', 'Lark Hill', 'Покраска', 'Yard', '10/09/2026', 40);
    const doors = task('t-doors', 'Lark Hill', 'Hang doors', 'Yard', '09/30/2026', 100);
    const steel = task('t-steel', 'Quarry Row', 'Set steel', 'Site', '03/31/2027', 40);
    const updates = [
      update('u1', 'Lark Hill', 'Yard', 'First coat in the yard stair.', 'p-ru', ru),
      update('u2', 'Lark Hill', 'Yard', 'Doors were hung.', 'p-doors', doors),
      update('u3', 'Lark Hill', 'Yard', 'Neighbor asked about weekend hours.', 'p-none'),
      update('u4', 'Quarry Row', 'Site', 'Columns set.', 'p-steel', steel),
    ];
    const combined = await wordFile(['Lark Hill', 'Quarry Row'], updates, [ru, doors, steel]);
    expect(combined.body).toContain('Lark Hill — Покраска (Yard): In Progress; 40% complete; due 10/09/2026.');
    // Was (5598047a): on no line. Before 7.73 (1f445154): on every Yard line, as if it had no task.
    expect(combined.linesNaming('p-ru')).toEqual([
      'Lark Hill — Покраска (Yard): In Progress',
      'Lark Hill — Yard: Покраска',
      'Lark Hill — Покраска (Yard)',
    ]);
    expect(combined.linesNaming('p-doors')).toEqual(['Lark Hill — Hang doors (Yard): Complete']);
    expect(combined.linesNaming('p-none')).toEqual([]);

    const single = await wordFile(['Lark Hill'], updates.slice(0, 3), [ru, doors]);
    expect(single.linesNaming('p-ru')).toEqual(['Lark Hill — Yard: Покраска']);
    expect(single.linesNaming('p-none')).toEqual([]);
  });

  it('R4: an area whose name holds ": " keeps its task\'s photo on the Action Plan line', async () => {
    const paint = task('t-paint', 'Heron Yard', 'Paint', 'Bldg A: Level 2', '10/09/2026', 40);
    const steel = task('t-steel', 'Quarry Row', 'Set steel', 'Site', '03/31/2027', 40);
    const own = update('u1', 'Heron Yard', 'Bldg A: Level 2', 'First coat.', 'p-paint', paint);
    const single = await wordFile(['Heron Yard'], [own], [paint]);
    expect(single.body).toContain('Heron Yard — Bldg A: Level 2: Paint. Issue: ');
    // Was (5598047a): no photo ("Level 2: Paint" was read as the task).
    expect(single.linesNaming('p-paint')).toEqual(['Heron Yard — Bldg A: Level 2: Paint']);

    const combined = await wordFile(['Heron Yard', 'Quarry Row'], [own, update('u4', 'Quarry Row', 'Site', 'Columns set.', 'p-steel', steel)], [paint, steel]);
    expect(combined.linesNaming('p-paint')).toEqual([
      'Heron Yard — Paint (Bldg A: Level 2): In Progress',
      'Heron Yard — Bldg A: Level 2: Paint',
      'Heron Yard — Paint (Bldg A: Level 2)',
    ]);
  });

  it('R5: a task named like its area names its photo only on its own lines, not every Action Plan line of the area', async () => {
    const roof = task('t-roof', 'Heron Yard', 'Roof', 'Roof', '10/09/2026', 40);
    const flashing = task('t-flash', 'Heron Yard', 'Flashing', 'Roof', '10/09/2026', 40);
    const steel = task('t-steel', 'Quarry Row', 'Set steel', 'Site', '03/31/2027', 40);
    const updates = [
      update('u1', 'Heron Yard', 'Roof', 'Membrane down on the east half.', 'p-roof', roof),
      update('u2', 'Heron Yard', 'Roof', 'Flashing started.', 'p-flash', flashing),
    ];
    const single = await wordFile(['Heron Yard'], updates, [roof, flashing]);
    // Was: "Heron Yard — Roof: Flashing. Issue: ... Photos 1 and 2 show this work." (the Roof task's photo too).
    expect(single.linesNaming('p-roof')).toEqual(['Heron Yard — Roof: Roof']);
    expect(single.linesNaming('p-flash')).toEqual(['Heron Yard — Roof: Flashing']);

    const combined = await wordFile(['Heron Yard', 'Quarry Row'], [...updates, update('u4', 'Quarry Row', 'Site', 'Columns set.', 'p-steel', steel)], [roof, flashing, steel]);
    expect(combined.linesNaming('p-roof')).toEqual([
      'Heron Yard — Roof (Roof): In Progress',
      'Heron Yard — Roof: Roof',
      'Heron Yard — Roof (Roof)',
      // A risk the project's records state about the task Roof (its photo's update is older than the task's last save).
      'Heron Yard: Roof: Old project record may support a conclusion that is no longer true.',
    ]);
    expect(combined.linesNaming('p-flash')).toEqual([
      'Heron Yard — Flashing (Roof): In Progress',
      'Heron Yard — Roof: Flashing',
      'Heron Yard — Flashing (Roof)',
    ]);
  });

  it('R5: a task named like its area names its photo not on a same-named task\'s line in another area, or with none', async () => {
    const own = task('t-own', 'Lark Hill Annex', 'Level 2', 'Level 2', '03/31/2027', 40);
    const lobby = task('t-lobby', 'Lark Hill Annex', 'Level 2', 'Lobby', '03/31/2027', 10);
    const none = task('t-none', 'Lark Hill Annex', 'Level 2', '', '03/31/2027', 20);
    const steel = task('t-steel', 'Quarry Row', 'Set steel', 'Site', '03/31/2027', 40);
    const { body, linesNaming } = await wordFile(['Lark Hill Annex', 'Quarry Row'], [
      update('u1', 'Lark Hill Annex', 'Level 2', 'Deck poured on the north bay.', 'p-own', own),
      update('u4', 'Quarry Row', 'Site', 'Columns set.', 'p-steel', steel),
    ], [own, lobby, none, steel]);
    expect(body).toContain('Lark Hill Annex — Level 2 (Lobby): In Progress; 10% complete; due 03/31/2027.');
    expect(body).toContain('Lark Hill Annex — Level 2: In Progress; 20% complete; due 03/31/2027.');
    // Was: on all three ("Level 2" is in each task's name). The risk stated about "Level 2" prints no area, so it may be
    // this task's: kept, as before.
    expect(linesNaming('p-own')).toEqual([
      'Lark Hill Annex — Level 2 (Level 2): In Progress',
      'Lark Hill Annex: Level 2: Old project record may support a conclusion that is no longer true.',
    ]);
  });

  it('R5: a task named like another task plus its area names its photo not on the other\'s lines', async () => {
    const paint = task('t-paint', 'Heron Yard', 'Paint', 'Lobby', '10/09/2026', 40);
    const paintLobby = task('t-pl', 'Heron Yard', 'Paint lobby', 'Lobby', '03/31/2027', 40);
    const steel = task('t-steel', 'Quarry Row', 'Set steel', 'Site', '03/31/2027', 40);
    const { body, linesNaming } = await wordFile(['Heron Yard', 'Quarry Row'], [
      update('u1', 'Heron Yard', 'Lobby', 'Lobby walls first coat.', 'p-pl', paintLobby),
      update('u4', 'Quarry Row', 'Site', 'Columns set.', 'p-steel', steel),
    ], [paint, paintLobby, steel]);
    expect(body).toContain('Heron Yard — Paint (Lobby): In Progress; 40% complete; due 10/09/2026.');
    expect(body).toContain('Heron Yard — Paint (Lobby) is overdue at 40% complete.');
    // Was: on both Paint lines too ("Paint (Lobby)" read as "Paint lobby").
    expect(linesNaming('p-pl')).toEqual([
      'Heron Yard — Paint lobby (Lobby): In Progress',
      'Heron Yard: Paint lobby: Old project record may support a conclusion that is no longer true.',
    ]);
  });

  it('R5: ... also where the task\'s own line is not in the report (Current Work lists 12 tasks at most)', async () => {
    const body = [
      'CURRENT WORK',
      '• Heron Yard — Paint (Lobby): In Progress; 40% complete; due 10/09/2026.',
      '',
      'SCHEDULE RISKS',
      '• Heron Yard — Paint (Lobby) is overdue at 40% complete.',
      '• Heron Yard: Paint (Lobby): Newer field update reports unfinished work.',
    ].join('\n');
    const photo = (id: string, displayNumber: number, linkedTaskName: string): ReportWordMedia => ({
      id, kind: 'photo', displayNumber, caption: `Caption ${id}`, data: PNG, mimeType: 'image/png', width: 1, height: 1,
      projectName: 'Heron Yard', areaName: 'Lobby', linkedTaskName,
    });
    const paragraphs = await paragraphsOf(await buildReportWordBase64({ title: 'Report', body, generatedAt: NOW,
      media: [photo('paint', 1, 'Paint'), photo('lobby', 2, 'Paint lobby')] }));
    // Was "Photos 1 and 2" on each: "Paint (Lobby)" read as the task "Paint lobby".
    expect(paragraphs.filter(paragraph => SENTENCE.test(paragraph))).toEqual([
      'Heron Yard — Paint (Lobby): In Progress; 40% complete; due 10/09/2026. Photo 1 shows this work.',
      'Heron Yard — Paint (Lobby) is overdue at 40% complete. Photo 1 shows this work.',
      'Heron Yard: Paint (Lobby): Newer field update reports unfinished work. Photo 1 shows this work.',
    ]);
  });

  it('R7: packed lines are read once, not again at every separator for every photo', async () => {
    // The reviewer's dense case: 120 lines of 1,423 characters with about 200 separators each, 120 photos of the
    // lines' project and area (56 s on 5598047a; about half a second on 1f445154).
    const long = Array.from({ length: 40 }, (_, i) =>
      `• Heron Yard — Task ${i}: part: ${'a — b: c (d) is e has f. Issue: g '.repeat(40)}(Yard): In Progress; 40% complete.`);
    const body = ['CURRENT WORK', ...long, '', 'ACTION PLAN', ...long, '', 'SCHEDULE RISKS', ...long].join('\n');
    const media = Array.from({ length: 120 }, (_, i): ReportWordMedia => ({
      id: `p${i}`, kind: 'photo', displayNumber: i + 1, caption: 'c', data: PNG, mimeType: 'image/png', width: 1, height: 1,
      projectName: 'Heron Yard', areaName: 'Yard', linkedTaskName: `Task ${i}`,
    }));
    const started = Date.now();
    await buildReportWordBase64({ title: 'Speed', body, generatedAt: NOW, media });
    expect(Date.now() - started).toBeLessThan(8_000);
  });
});
