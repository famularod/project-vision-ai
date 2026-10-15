/**
 * Open item 7.64 (Medium, Build 232's device checks, check 21): a combined report of two projects listed the WORK
 * AREAS of the project with the newer notes first, ticked either way round, while the line under the title, Project
 * Position, Completed Work and Schedule Risks listed the projects by name (HIGH item 1e).
 *
 * The work areas were listed in the order their notes came (the newest first), so the project with the newest note
 * led WORK AREAS / PHOTO NOTES (Copy, e-mail, text, Outlook, the Word file) and the Work Areas & Photos cards. Now a
 * report of several projects lists them by name there too, the same however they were ticked; each project's areas keep
 * their order and each photo its number. A report of one project reads as before. The draft is the app's own writer's,
 * and the section is printed as the written report prints it. Made-up projects and notes. No network.
 */
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));

import { reportBulletText } from '../../services/DAVEReportIntelligence';
import { buildPIEReportDraft } from '../../services/PIEReporter';
import type { ProjectUpdate } from '../../types';

const photo = (id: string, caption: string) => ({
  id, uri: `file:///p/${id}.jpg`, caption, category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '',
  actionStatus: 'Open', createdAt: '2026-10-10T12:00:00.000Z',
});
const update = (id: string, project: string, area: string, date: string, notes: string, photos: unknown[] = []) => ({
  id, projectName: project, scheduleProjectName: project, date, photos, recipients: { contactIds: [] }, notes, status: 'sent',
  selectedAreaName: area,
}) as unknown as ProjectUpdate;

// "Zinnia Court" has the newest notes (as the later-named project had in the check); "4410 Alder Works" comes first by name.
const UPDATES = [
  update('z1', 'Zinnia Court', 'Site', '2026-10-14', 'Temporary fencing was installed along the street frontage.', [photo('zp1', 'Fence line')]),
  update('z2', 'Zinnia Court', '', '2026-10-13', 'Concrete washout pit was installed near the gate.'),
  update('a1', '4410 Alder Works', 'Warehouse 131', '2026-10-09', 'Steel columns were set on line A.', [photo('ap1', 'Line A columns')]),
  update('a2', '4410 Alder Works', 'Yard', '2026-10-08', 'Conduit was trenched along the yard fence.'),
];
const combined = (ticked: string[]) => buildPIEReportDraft({
  reportType: 'combined_project_update', audience: 'internal_team', selectedProjectNames: ticked,
  savedUpdates: UPDATES, scheduleItems: [], generatedAt: new Date('2026-10-15T02:00:00.000Z'),
} as never);
/** WORK AREAS / PHOTO NOTES, line by line, as the written report prints it (DAVEReportIntelligence formatReportBody). */
const workAreas = (draft: ReturnType<typeof combined>) => draft.locationGroups.flatMap(group =>
  group.workAreas.flatMap(area => area.bullets.map(bullet => `${area.projectName} — ${area.title}: ${reportBulletText(bullet)}`)));
/** The Work Areas & Photos cards: each project's heading, in order. */
const cards = (draft: ReturnType<typeof combined>) => draft.locationGroups.map(group => group.title);

describe('7.64: a combined report lists its projects\' work areas in name order', () => {
  it('ticked either way round: 4410 Alder Works\' lines come before Zinnia Court\'s, word for word the same', () => {
    const zinniaFirst = combined(['Zinnia Court', '4410 Alder Works']);
    const alderFirst = combined(['4410 Alder Works', 'Zinnia Court']);
    expect(workAreas(zinniaFirst)).toEqual(workAreas(alderFirst));
    expect(cards(zinniaFirst)).toEqual(['4410 Alder Works', 'Zinnia Court']);
    const lines = workAreas(zinniaFirst);
    const lastAlder = Math.max(...lines.map((line, index) => (line.startsWith('4410 Alder Works — ') ? index : -1)));
    const firstZinnia = lines.findIndex(line => line.startsWith('Zinnia Court — '));
    expect(lastAlder).toBeGreaterThanOrEqual(0);
    expect(firstZinnia).toBeGreaterThan(lastAlder);
  });

  it('each project\'s areas keep their own order, and each photo its number', () => {
    const draft = combined(['Zinnia Court', '4410 Alder Works']);
    const of = (project: string) => buildPIEReportDraft({
      reportType: 'daily_project_update', audience: 'internal_team', selectedProjectNames: [project],
      savedUpdates: UPDATES.filter(item => item.projectName === project), scheduleItems: [], generatedAt: new Date('2026-10-15T02:00:00.000Z'),
    } as never);
    const areasOf = (source: ReturnType<typeof combined>, project: string) => source.locationGroups
      .filter(group => group.title === project).flatMap(group => group.workAreas.map(area => area.title));
    for (const project of ['4410 Alder Works', 'Zinnia Court']) expect(areasOf(draft, project)).toEqual(areasOf(of(project), project));
    // The photos are numbered as before: in the order of their records, the newest first.
    const numbers = Object.fromEntries(draft.locationGroups.flatMap(group => group.workAreas.flatMap(area =>
      area.imageReferences.map(reference => [reference.photoId, reference.imageNumber] as const))));
    expect(numbers).toEqual({ zp1: 1, ap1: 2 });
  });
});
