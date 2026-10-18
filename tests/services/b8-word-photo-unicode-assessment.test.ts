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


import { buildDAVEWebReportDraft, formatDAVEWebReport } from '../../services/DAVEWebOperations';

function web(items: ScheduleItem[], updates: ProjectUpdate[], suppliedProjects?: Array<{ id: string; name: string }>) {
  const projects = [...new Set(items.map(t => t.projectName))].map((name, i) => ({ id: `project-${i}`, name }));
  const snapshot = { projects: suppliedProjects ?? projects, scheduleItems: items, knownScheduleItems: items, projectUpdates: updates.map(updateData => ({ updateData })), referenceDocuments: [], archivedDocumentIds: [], refreshedAt: NOW };
  const briefing = buildDAVEWebReportDraft(snapshot as never, null);
  return { briefing, body: formatDAVEWebReport(briefing, 'project_manager') };
}
async function word(body: string, item: ProjectUpdate, taskLines?: import('../../services/ReportWordDocument').ReportWordTaskLine[]) {
 const described = reportWordPhotoDescription(item.photos[0], item);
 const media: ReportWordMedia = { ...described, linkedTaskId: item.scheduleItemId, projectId: item.projectId, id: item.photos[0].id, kind: 'photo', displayNumber: 7, data: PNG, mimeType: 'image/png', width: 1, height: 1 };
 return paragraphsOf(await buildReportWordBase64({ title: 'Synthetic report', body, generatedAt: NOW, taskLines, media: [media] }));
}
it('7.78 desktop Markdown Completed Work must cite the unambiguous attached task photo', async () => {
 const t = task('doors', 'Alpha', 'Hang doors', 'Yard', '09/30/2026', 100);
 const u = update('u', 'Alpha', 'Yard', 'Doors were hung.', 'p', t);
 const { body, briefing } = web([t, task('other', 'Zinnia', 'Paint walls', 'Lobby', '09/30/2026', 100)], [u]);
 const paragraphs = await word(body, u, [...briefing.wordTaskLines!]);
 console.log(JSON.stringify({ scenario: 'heading', body, paragraphs }));
 expect(body).toContain('## Completed Work');
 const plainHeadingControl = await word(body.replace(/^## (.+)$/gm, (_, heading) => heading.toUpperCase()), u);
 expect(plainHeadingControl.some(p => p.includes('Hang doors') && p.includes('Photo 7 shows this work.'))).toBe(true);
 expect(paragraphs).toContain('Photo 7');
 expect(paragraphs.some(p => p.includes('Hang doors') && p.includes('Photo 7 shows this work.'))).toBe(true);
});
it('7.78 desktop formatter must preserve two nonLatin area identities', () => {
 const tasks = [task('a', 'Alpha', 'Hang doors', 'Подвал 1', '09/30/2026', 100), task('b', 'Alpha', 'Paint walls', 'Секция 1', '09/30/2026', 100)];
 const { body, briefing } = web(tasks, []);
 console.log(JSON.stringify({ scenario: 'unicode', body, dashboard: briefing.dashboard.workAreas }));
 expect(briefing.dashboard.workAreas.map(a => a.areaName).sort()).toEqual(['Подвал 1', 'Секция 1'].sort());
 expect(body).toContain('Подвал 1');
 expect(body).toContain('Секция 1');
});

import { reportWordingRequiresAppTextKey } from '../../services/PIEReporter';

it.each([
 ['Alpha', 'Hang doors', 'Yard'],
 ['Lot 5: North', 'X: Y', 'Bldg A: Level 2'],
 ['Alpha', 'Покраска', 'Подвал 1'],
 ['Alpha', 'X', 'Unit 4 (Rear'],
])('uses whole project/task/area identities for %s / %s / %s', async (project, name, area) => {
 const t = task('t', project, name, area, '09/30/2026', 100);
 const u = update('u', project, area, 'Work complete.', 'p', t);
 const { body, briefing } = web([t], [u]);
 const lines = [...briefing.wordTaskLines!];
 const paragraphs = await word(body, u, lines);
 // Older canonicalization may not represent a Unicode task. It must suppress rather than guess.
 const supported = lines.some(line => line.taskName === name);
 expect(paragraphs.some(p => p.endsWith('Photo 7 shows this work.'))).toBe(supported);
 expect(paragraphs).toContain('Photo 7');
 if (supported) {
   expect((await word(body.replace(name, name + ' changed'), u, lines)).some(p => p.endsWith('Photo 7 shows this work.'))).toBe(false);
   expect((await word(body, { ...u, scheduleItemId: 'other-id' }, lines)).some(p => p.endsWith('Photo 7 shows this work.'))).toBe(false);
   expect((await word(body, { ...u, scheduleTaskName: name + ': Other' }, lines)).some(p => p.endsWith('Photo 7 shows this work.'))).toBe(false);
   expect((await word(body, { ...u, projectName: project + ': Other' }, lines)).some(p => p.endsWith('Photo 7 shows this work.'))).toBe(false);
   expect((await word(body, { ...u, selectedAreaName: area + ' Other' }, lines)).some(p => p.endsWith('Photo 7 shows this work.'))).toBe(false);
   expect((await word(body.replace(/^## Completed Work$/m, '## Decisions Required'), u, lines)).some(p => p.endsWith('Photo 7 shows this work.'))).toBe(false);
 }
});
it.each(['same-name', 'same-id', 'missing-area'])('suppresses ambiguous %s provenance', async kind => {
 const t = task('t', 'Alpha', 'Hang doors', kind === 'missing-area' ? '' : 'Yard', '09/30/2026', 100);
 const other = task(kind === 'same-id' ? 't' : 'other', 'Alpha', kind === 'same-name' ? 'Hang doors' : 'Paint walls', 'Lobby', '09/30/2026', 100);
 const u = update('u', 'Alpha', 'Yard', 'Work complete.', 'p', t);
 const { body, briefing } = web(kind === 'missing-area' ? [t] : [t, other], [u]);
 const paragraphs = await word(body, u, [...briefing.wordTaskLines!]);
 expect(paragraphs.some(p => p.endsWith('Photo 7 shows this work.'))).toBe(false);
 expect(paragraphs).toContain('Photo 7');
});
it('new structured inputs do not run the old ambiguous Action/Decisions matcher', async () => {
 const t = task('t', 'Lot 5', 'X', 'Yard', '09/30/2026', 100);
 const u = update('u', 'Lot 5', 'Yard', 'Work complete.', 'p', t);
 const body = '## Action Plan\n- Lot 5: North — Yard: X. Issue: Complete.\n## Decisions Required\n- Lot 5 — X: Y: Select Yard finish.';
 expect((await word(body, u, [])).some(p => p.endsWith('Photo 7 shows this work.'))).toBe(false);
 expect((await word(body.replace(/^## (.+)$/gm, (_, h) => h.toUpperCase()), u, [])).some(p => p.endsWith('Photo 7 shows this work.'))).toBe(false);
});
it('Unicode-area native legacy sends require exact words evidence', () => {
 const { briefing } = web([task('t', 'Alpha', 'Hang doors', 'Подвал 1', '09/30/2026', 100)], []);
 expect(reportWordingRequiresAppTextKey({ sourceEvidence: [], daveBriefing: briefing })).toBe(true);
 expect(reportWordingRequiresAppTextKey({ sourceEvidence: [] })).toBe(false);
});

import { daveWebReportAlreadySentElsewhereAt } from '../../services/DAVEWebReportPeriod';
import { reportTextKey, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
it('desktop Unicode wording cannot reuse a legacy send but exact modern words remain recognizable', () => {
 const wording = { requiresTextKey: true, title: 'Report', body: 'Подвал 1 / Секция 1' };
 const old = { deliveredAt: NOW, sourceFingerprint: 'same-facts', sentBy: 'phone' } as DAVEReportSnapshot;
 expect(daveWebReportAlreadySentElsewhereAt(old, 'same-facts', new Set(), wording)).toBeNull();
 const modern = { ...old, appTextKey: reportTextKey(wording) };
 expect(daveWebReportAlreadySentElsewhereAt(modern, 'same-facts', new Set(), wording)).toBe(NOW);
 expect(daveWebReportAlreadySentElsewhereAt(modern, 'same-facts', new Set(), { ...wording, body: 'changed' })).toBeNull();
 expect(daveWebReportAlreadySentElsewhereAt(modern, 'new-facts', new Set(), wording)).toBeNull();
});

it('native formatter uses the same authoritative pointers and distinct Unicode areas', async () => {
 const projects = ['Alpha'];
 const items = [task('a', 'Alpha', 'Hang doors', 'Подвал 1', '09/30/2026', 100), task('b', 'Alpha', 'Paint walls', 'Секция 1', '10/30/2026', 40)];
 const updates = [update('u', 'Alpha', 'Подвал 1', 'Doors were hung.', 'p', items[0])];
 const truths = buildDAVEReportProjectTruths({ projects: projects.map(name => ({ name, projectId: 'report:alpha' })), projectRecords: [{ name: 'Alpha' }], updates, scheduleItems: items, knownScheduleItems: items, knownScheduleDocuments: [], projectAreas: [], referenceDocuments: [], now: NOW } as never);
 const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: projects, previousSnapshot: null, scheduleItems: items });
 const core = buildPIECoreIntelligence({ runtimeContext: { projectName: 'Alpha', projectNames: projects, reportType: 'daily_project_update', updates, scheduleItems: items, knownScheduleItems: items, currentUpdate: null, projectAreas: [], contacts: { contacts: [] }, referenceDocuments: [], surface: 'reports' }, reportType: 'daily_project_update', reportProjectNames: projects, organizationId: 'local-unverified-anonymous', projectId: 'project-x' } as never);
 const draft = enhanceDAVEReportDraft(core.reportDraft!, briefing, 'project_manager');
 expect(draft.body).toContain('Hang doors (Подвал 1)');
 expect(draft.body).toContain('Paint walls (Секция 1)');
 const paragraphs = await word(draft.body, updates[0], [...draft.daveBriefing!.wordTaskLines!]);
 expect(paragraphs.some(p => p.includes('Hang doors') && p.endsWith('Photo 7 shows this work.'))).toBe(true);
 expect(paragraphs.some(p => p.includes('Paint walls') && p.endsWith('Photo 7 shows this work.'))).toBe(false);
 expect(reportWordingRequiresAppTextKey(draft)).toBe(true);
});
it('current work is cited only by its exact original task ID', async () => {
 const t = task('t', 'Alpha', 'Hang doors', 'Yard', '10/30/2026', 40);
 const u = update('u', 'Alpha', 'Yard', 'Work progressing.', 'p', t);
 const { body, briefing } = web([t], [u]);
 expect(briefing.wordTaskLines![0].section).toBe('CURRENT WORK');
 expect((await word(body, u, [...briefing.wordTaskLines!])).some(p => p.includes('Hang doors') && p.endsWith('Photo 7 shows this work.'))).toBe(true);
});

it('prefix projects with identical task/area names retain only the linked project pointer', async () => {
 const a = task('short', 'Lot 5', 'X', 'Yard', '09/30/2026', 100);
 const b = task('long', 'Lot 5: North', 'X', 'Yard', '09/30/2026', 100);
 const u = update('u', 'Lot 5', 'Yard', 'Work complete.', 'p', a);
 const { body, briefing } = web([a,b], [u]);
 const paragraphs = await word(body, u, [...briefing.wordTaskLines!]);
 expect(paragraphs.some(p => p.startsWith('Lot 5 — X') && p.endsWith('Photo 7 shows this work.'))).toBe(true);
 expect(paragraphs.some(p => p.startsWith('Lot 5: North — X') && p.endsWith('Photo 7 shows this work.'))).toBe(false);
});
it('duplicate photo IDs suppress inline provenance while existing numbers/captions stay attached', async () => {
 const t = task('t', 'Alpha', 'Hang doors', 'Yard', '09/30/2026', 100);
 const { body, briefing } = web([t], []);
 const media: ReportWordMedia = { id: 'p', kind: 'photo', displayNumber: 7, caption: 'Original caption', projectName: 'Alpha', areaName: 'Yard', linkedTaskName: 'Hang doors', linkedTaskId: 't', data: PNG, mimeType: 'image/png', width: 1, height: 1 };
 const duplicate = await paragraphsOf(await buildReportWordBase64({ title: 'Report', body, taskLines: briefing.wordTaskLines, media: [media, { ...media, displayNumber: 11 }] }));
 expect(duplicate.some(p => p.endsWith('shows this work.'))).toBe(false);
 expect(duplicate).toContain('Photo 7');
 expect(duplicate).toContain('Photo 11');
 expect(duplicate.some(p => p.includes('Original caption'))).toBe(true);
 const separate = await paragraphsOf(await buildReportWordBase64({ title: 'Report', body, taskLines: briefing.wordTaskLines, media: [media, { ...media, id: 'p2', displayNumber: 11, caption: 'Second caption' }] }));
 expect(separate.some(p => p.includes('Hang doors') && p.endsWith('Photos 7 and 11 show this work.'))).toBe(true);
 expect(separate).toContain('Photo 7'); expect(separate).toContain('Photo 11');
 expect(separate.some(p => p.includes('Second caption'))).toBe(true);
});

it('explicit different project IDs cannot share a pointer', async () => {
 const t = { ...task('t', 'Alpha', 'Hang doors', 'Yard', '09/30/2026', 100), projectId: 'one' };
 const u = { ...update('u', 'Alpha', 'Yard', 'Work complete.', 'p', t), projectId: 'two' };
 const { body, briefing } = web([t], [u]);
 expect((await word(body, u, [...briefing.wordTaskLines!])).some(p => p.endsWith('Photo 7 shows this work.'))).toBe(false);
 expect((await word(body, { ...u, projectId: 'one' }, [...briefing.wordTaskLines!])).some(p => p.endsWith('Photo 7 shows this work.'))).toBe(true);
});

it.each(['same-name', 'same-id'])('duplicate project %s cannot authorize an inline pointer', async kind => {
 const a = task('a', 'Alpha', 'Hang doors', 'Yard', '09/30/2026', 100);
 const b = task('b', 'Beta', 'Paint walls', 'Lobby', '09/30/2026', 100);
 const u = update('u', 'Alpha', 'Yard', 'Work complete.', 'p', a);
 const projects = kind === 'same-name' ? [{ id: 'p', name: 'Alpha' }, { id: 'other', name: 'Alpha' }] : [{ id: 'p', name: 'Alpha' }, { id: 'p', name: 'Beta' }];
 const { body, briefing } = web([a,b], [u], projects);
 expect((await word(body, u, [...briefing.wordTaskLines!])).some(p => p.endsWith('Photo 7 shows this work.'))).toBe(false);
});
