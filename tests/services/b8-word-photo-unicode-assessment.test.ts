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

function web(items: ScheduleItem[], updates: ProjectUpdate[]) {
  const projects = [...new Set(items.map(t => t.projectName))].map((name, i) => ({ id: `project-${i}`, name }));
  const snapshot = { projects, scheduleItems: items, knownScheduleItems: items, projectUpdates: updates.map(updateData => ({ updateData })), referenceDocuments: [], archivedDocumentIds: [], refreshedAt: NOW };
  const briefing = buildDAVEWebReportDraft(snapshot as never, null);
  return { briefing, body: formatDAVEWebReport(briefing, 'project_manager') };
}
async function word(body: string, item: ProjectUpdate) {
 const described = reportWordPhotoDescription(item.photos[0], item);
 const media: ReportWordMedia = { ...described, id: item.photos[0].id, kind: 'photo', displayNumber: 7, data: PNG, mimeType: 'image/png', width: 1, height: 1 };
 return paragraphsOf(await buildReportWordBase64({ title: 'Synthetic report', body, generatedAt: NOW, media: [media] }));
}
it('7.78 desktop Markdown Completed Work must cite the unambiguous attached task photo', async () => {
 const t = task('doors', 'Alpha', 'Hang doors', 'Yard', '09/30/2026', 100);
 const u = update('u', 'Alpha', 'Yard', 'Doors were hung.', 'p', t);
 const { body } = web([t, task('other', 'Zinnia', 'Paint walls', 'Lobby', '09/30/2026', 100)], [u]);
 const paragraphs = await word(body, u);
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
