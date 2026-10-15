/**
 * Open item 7.73 (Medium, reports review pass 3 P3-2): the Word file says a photo "shows this work" under a task it is
 * not about.
 *
 * The Word file (Download Word Report, and the attachment of Email from Outlook (work)) ends a line of Completed Work,
 * Current Work, Action Plan, Schedule Risks ... with "Photo N shows this work." / "Photos 4, 5, and 6 show this work."
 * It put a photo there whenever the line named the photo's project and area (and its task, only if the photo's update
 * had one). So in a COMBINED report, where every task line names its project, every photo of an area whose update has
 * no task was said to show the work of every task of that area ("oak street lofts — Hang doors (Yard): Complete ...
 * Photos 4, 5, 6, 7, 8, and 9 show this work.", photos of "Neighbor asked about weekend hours." and a failed stair
 * test). 170 of the reviewer's 200 made-up combined Word files had such lines. A single-project report's Action Plan
 * line names its project too ("Heron Yard — Level 2: Paint lobby. Issue: ..."), so its Word file had the same fault
 * there. The same kind of fault 7.62 fixed in the report text (a photo cited where it is not the photo's).
 *
 * Now a task's line names only the photos whose own field update is linked to that task: the line must be that
 * task's line as the report writes it (its project, then its task: "<project> — <task> (<area>): ...", "... is
 * overdue", "<project> — <area>: <task>. Issue: ...", "<project>: <task> ...: ..."), and name the photo's area as
 * whole words. A photo whose update has no task is put on no line. Nothing is added anywhere: a line keeps a photo only
 * where it named it before. Every photo is still numbered and cited once ("See Image N.", "Photo N"). The report text
 * and its fingerprint are untouched (the Word file reads only what the fingerprint holds of each photo). The draft,
 * the briefing, the photo descriptions and the Word builder are the app's own code. Made-up projects. No network.
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

jest.setTimeout(120_000);
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

/** Each paragraph that ends with a photo sentence: its text before the sentence, and the photo numbers it names. */
function photoLines(paragraphs: readonly string[]) {
  return paragraphs.flatMap(paragraph => {
    const match = paragraph.match(SENTENCE);
    return match
      ? [{ line: paragraph.slice(0, match.index), numbers: match[1].split(/\D+/).filter(Boolean).map(Number) }]
      : [];
  });
}

/**
 * The Word file of a report as the phone makes it: the Reports screen's report (Project Manager format) through the
 * runtime (a combined report as App.tsx hands one over: 'Combined Project Portfolio', the projects in ticked order; a
 * single project's as a daily report), photos numbered as the report numbers them, described as the Word builders
 * describe them (ReportWordMediaDescription), built by the app's own Word builder and read back from the .docx.
 */
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
  return { body: report.body, paragraphs, numberOf };
}

/** Every photo is cited exactly once in the report's words ("See Image N.") and shown once ("Photo N"), by its number. */
function expectEveryPhotoCitedOnce(paragraphs: readonly string[], numberOf: ReadonlyMap<string, number>) {
  const numbers = [...numberOf.values()].sort((a, b) => a - b);
  const cited = paragraphs.flatMap(paragraph => Array.from(paragraph.matchAll(/See Images? ([0-9, and]+)\./g))
    .flatMap(match => match[1].split(/\D+/).filter(Boolean).map(Number)));
  expect([...cited].sort((a, b) => a - b)).toEqual(numbers);
  const shown = paragraphs.map(paragraph => paragraph.match(/^Photo (\d+)$/)?.[1]).filter(Boolean).map(Number);
  expect([...shown].sort((a, b) => a - b)).toEqual(numbers);
}

describe('7.73: a Word task line names only the photos of its own task', () => {
  it('in a combined report, a photo whose update has no task shows no task\'s work (the reviewer\'s steps)', async () => {
    const doors = task('t-doors', 'Lark Hill', 'Hang doors', 'Yard', '09/30/2026', 100);
    const paint = task('t-paint', 'Zinnia Court', 'Paint lobby', 'Yard', '10/09/2026', 40);
    const updates = [
      update('u1', 'Lark Hill', 'Yard', 'Neighbor asked about weekend hours.', 'p-neighbor'),
      update('u2', 'Lark Hill', 'Yard', 'Doors were hung on the yard side.', 'p-doors', doors),
      update('u3', 'Zinnia Court', 'Yard', 'Stair pressurization test failed. Stair finishes are on hold.', 'p-stair'),
      update('u4', 'Zinnia Court', 'Yard', 'Lobby walls got their first coat.', 'p-paint', paint),
    ];
    const { body, paragraphs, numberOf } = await wordFile(['Lark Hill', 'Zinnia Court'], updates, [doors, paint]);
    const n = (id: string) => numberOf.get(id)!;
    // The report names each task where the old Word file put the unlinked photos.
    expect(body).toContain('Lark Hill — Hang doors (Yard): Complete; 100% complete.');
    expect(body).toContain('Zinnia Court — Paint lobby (Yard): In Progress; 40% complete; due 10/09/2026.');
    expect(body).toContain('Zinnia Court — Yard: Paint lobby. Issue: ');
    expect(body).toContain('Zinnia Court — Paint lobby (Yard) is overdue at 40% complete.');

    const lines = photoLines(paragraphs);
    // Was: "Lark Hill — Hang doors (Yard): ... Photos 3 and 4 show this work." (the neighbor's note's photo too), and
    // each Paint lobby line named the failed stair test's photo too ("Photos 1 and 2").
    const head = (line: string) => (line.includes(':') ? line.slice(0, line.indexOf(':')) : line);
    expect(lines.map(({ line, numbers }) => [head(line), numbers])).toEqual([
      ['Lark Hill — Hang doors (Yard)', [n('p-doors')]],
      ['Zinnia Court — Paint lobby (Yard)', [n('p-paint')]],
      ['Zinnia Court — Yard', [n('p-paint')]],
      ['Zinnia Court — Paint lobby (Yard) is overdue at 40% complete.', [n('p-paint')]],
    ]);
    const named = lines.flatMap(({ numbers }) => numbers);
    expect(named).not.toContain(n('p-neighbor'));
    expect(named).not.toContain(n('p-stair'));
    expectEveryPhotoCitedOnce(paragraphs, numberOf);
  });

  it('in a single-project report, the Action Plan line names only its task\'s photo; task lines stay as they were', async () => {
    const paint = task('t-paint', 'Heron Yard', 'Paint lobby', 'Level 2', '10/09/2026', 40);
    const doors = task('t-doors', 'Heron Yard', 'Hang doors', 'Level 2', '09/30/2026', 100);
    const updates = [
      update('u1', 'Heron Yard', 'Level 2', 'Water leak at the riser was found.', 'p-leak'),
      update('u2', 'Heron Yard', 'Level 2', 'Lobby walls got their first coat.', 'p-paint', paint),
    ];
    const { body, paragraphs, numberOf } = await wordFile(['Heron Yard'], updates, [paint, doors]);
    const n = (id: string) => numberOf.get(id)!;
    expect(body).toContain('Heron Yard — Level 2: Paint lobby. Issue: ');
    // A single project's task lines do not print the project, and never named a photo (before or now).
    expect(body).toContain('• Hang doors (Level 2): Complete; 100% complete.');
    expect(body).toContain('• Paint lobby (Level 2): In Progress; 40% complete; due 10/09/2026.');

    // Was: "Heron Yard — Level 2: Paint lobby. Issue: ... Photos 1 and 2 show this work." (the leak's photo too).
    expect(photoLines(paragraphs).map(({ line, numbers }) => [line.slice(0, line.indexOf('. Issue:')), numbers])).toEqual([
      ['Heron Yard — Level 2: Paint lobby', [n('p-paint')]],
    ]);
    expectEveryPhotoCitedOnce(paragraphs, numberOf);
  });

  const photo = (id: string, displayNumber: number, project: string, area: string, linkedTaskName: string | null): ReportWordMedia => ({
    id, kind: 'photo', displayNumber, caption: `Caption ${id}`, data: PNG, mimeType: 'image/png', width: 1, height: 1,
    projectName: project, areaName: area, linkedTaskName,
  });
  const linesOf = async (body: string, media: ReportWordMedia[]) =>
    photoLines(await paragraphsOf(await buildReportWordBase64({ title: 'Report', body, generatedAt: NOW, media })))
      .map(({ line, numbers }) => `${line} => ${numbers.join(', ')}`);

  it('names a task\'s photo on that task\'s line only, not on a longer task or project name that contains it', async () => {
    const body = [
      'CURRENT WORK',
      '• Lark Hill — Paint (Dock): In Progress; 40% complete; due 10/09/2026.',
      '• Lark Hill — Paint lobby (Dock): In Progress; 40% complete; due 10/30/2026.',
      '• Lark Hill Annex — Paint (Dock): In Progress; 10% complete; due 10/30/2026.',
      '• Lark Hill — Paint (west wall) (Dock): Not Started; 0% complete; due 11/30/2026.',
      '',
      'ACTION PLAN',
      '• Lark Hill — Dock: Paint. Issue: Paint is overdue at 40% complete. Action: Set a recovery date. Owner: Dana. Due 10/09/2026.',
      '• Lark Hill — Dock: Paint lobby. Issue: Paint lobby needs a color. Action: Pick one. Owner: Dana.',
      '',
      'SCHEDULE RISKS',
      '• Lark Hill — Paint (Dock) is overdue at 40% complete.',
      '• Lark Hill: Paint (Dock): Newer field update reports unfinished work.',
    ].join('\n');
    expect(await linesOf(body, [
      photo('paint', 1, 'Lark Hill', 'Dock', 'Paint'),
      photo('lobby', 2, 'Lark Hill', 'Dock', 'Paint lobby'),
    ])).toEqual([
      '• Lark Hill — Paint (Dock): In Progress; 40% complete; due 10/09/2026. => 1',
      // Was "Photos 1 and 2": "Paint" is in "Paint lobby".
      '• Lark Hill — Paint lobby (Dock): In Progress; 40% complete; due 10/30/2026. => 2',
      // "Lark Hill Annex — Paint (Dock)" names no photo (was Photo 1: "Lark Hill" is in "Lark Hill Annex"), nor does the
      // task "Paint (west wall)" (was Photo 1).
      '• Lark Hill — Dock: Paint. Issue: Paint is overdue at 40% complete. Action: Set a recovery date. Owner: Dana. Due 10/09/2026. => 1',
      '• Lark Hill — Dock: Paint lobby. Issue: Paint lobby needs a color. Action: Pick one. Owner: Dana. => 2',
      '• Lark Hill — Paint (Dock) is overdue at 40% complete. => 1',
      '• Lark Hill: Paint (Dock): Newer field update reports unfinished work. => 1',
    ].map(line => line.replace(/^• /, '')));
  });

  it('names a photo only on a line naming its area as whole words ("Level 1" is not "Level 10")', async () => {
    const body = [
      'CURRENT WORK',
      '• Lark Hill — Paint (Level 1): In Progress; 40% complete; due 10/30/2026.',
      '• Lark Hill — Paint (Level 10): In Progress; 10% complete; due 10/30/2026.',
      '• Lark Hill — Paint (Building A (East)): In Progress; 20% complete; due 10/30/2026.',
    ].join('\n');
    expect(await linesOf(body, [
      photo('paint', 1, 'Lark Hill', 'Level 1', 'Paint'),
      photo('east', 2, 'Lark Hill', 'Building A (East)', 'Paint'),
    ])).toEqual([
      'Lark Hill — Paint (Level 1): In Progress; 40% complete; due 10/30/2026. => 1',
      // An area with brackets of its own is still its task's area.
      'Lark Hill — Paint (Building A (East)): In Progress; 20% complete; due 10/30/2026. => 2',
    ]);
  });
});
