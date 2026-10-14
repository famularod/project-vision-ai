/**
 * Open item 7.54 (found by the 4.87 fixer, M2; the coordinator's order of 13 Oct 2026): photos of an update saved
 * from a sub-project's task are numbered and attached in the parent project's report, by 4.87's rule.
 *
 * Before: such an update is saved under the sub-project's own name and names its parent in scheduleProjectName. The
 * parent's report carries its lines (report-subproject-task-updates), but its photos were never handed to the
 * report's numbering (PIEReporter buildReportImageReferences took an update by its own project name only): no
 * "See Image N", not attached to the e-mail or the text, not in the Word file.
 *
 * Now its photos are numbered with the parent's, in record order, and go under the line they belong to (the area
 * the update names, or the sub-project's own line), the same on every device. A report with no such photo keeps its
 * words. The fingerprint is not changed: what decides it (the photos, their order, the names the update was filed
 * under) is already in dave-report-source/3.0, and a change to any of it that moves the words moves the fingerprint
 * (the mini-guard below; the round's guard runs on twelve projects). Made-up names. No network.
 */
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));

import * as fs from 'fs';
import { buildPIEReportDraft } from '../../services/PIEReporter';
import { buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { reportCitedImages } from '../../services/ReportImageAttachments';
import type { ProjectUpdate, ScheduleItem } from '../../types';

const OUT = process.env.M2_OUT_DIR || '';
const keep = (name: string, text: string) => { if (OUT) fs.writeFileSync(`${OUT}/${name}`, text); };

const PARENT = 'Heron Yard';
const SUB = 'Canopy C Package';
const AT = '2026-10-13T16:00:00.000Z';
const photo = (id: string, caption: string, extra: Record<string, unknown> = {}) => ({
  id, uri: `file:///p/${id}.jpg`, caption, category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '',
  actionStatus: 'Open', createdAt: '2026-10-10T12:00:00.000Z', ...extra,
});
/** An update as the app saves it: from the parent's page, or from a sub-project's task (its own name, the parent named). */
const update = (id: string, project: string, parent: string | null, area: string, date: string, notes: string, photos: unknown[] = []) => ({
  id, projectName: project, scheduleProjectName: parent, date, photos, recipients: { contactIds: [] }, notes, status: 'sent', selectedAreaName: area,
}) as unknown as ProjectUpdate;

const PARENTS_OWN = [
  update('p1', PARENT, PARENT, 'Lot', '2026-10-06', 'Gravel was spread at the lot.', [photo('q1', 'Lot gravel')]),
  update('p2', PARENT, PARENT, 'Lot', '2026-10-08', 'Silt fence was set at the lot.', [photo('q4', 'Silt fence at the lot')]),
];
const FROM_THE_SUB_PROJECT = [
  update('s1', SUB, PARENT, 'Canopy C', '2026-10-07', 'Footings poured at grid C4.', [photo('q2', 'Footing at C4')]),
  // No area: its note is printed under the sub-project's own name; a photo whose caption makes a line of its own is
  // printed (as before) under "Needs Classification", one whose caption makes none goes with the note.
  update('s2', SUB, PARENT, '', '2026-10-09', 'Inspector walked the canopy.', [photo('q3', 'Canopy walk'), photo('q6', 'Gate sign')]),
];
const ANOTHER_JOB = [update('o1', 'Canopy A Package', 'Other Job', 'Canopy A', '2026-10-09', 'Other job note.', [photo('x1', 'Other job photo')])];
const UPDATES = [...PARENTS_OWN, ...FROM_THE_SUB_PROJECT, ...ANOTHER_JOB];
const TASKS: ScheduleItem[] = [];

const write = (updates: ProjectUpdate[]) => buildPIEReportDraft({
  reportType: 'daily_project_update', audience: 'internal_team', selectedProjectNames: [PARENT],
  savedUpdates: updates, scheduleItems: TASKS, generatedAt: new Date(AT),
} as never);
type Draft = ReturnType<typeof write>;
const attachedPhotos = (draft: Draft) => Object.fromEntries(draft.locationGroups.flatMap(group => group.workAreas.flatMap(area =>
  area.imageReferences.map(reference => [reference.photoId, `${reference.imageNumber} ${area.title}`] as const))));
const fingerprint = (updates: ProjectUpdate[]) => buildDAVEReportSourceFingerprint(buildDAVEReportProjectTruths({
  projects: [{ name: PARENT, projectId: 'report:heron yard' }], projectRecords: [{ name: PARENT }] as never,
  updates, scheduleItems: TASKS, projectAreas: [], referenceDocuments: [], now: AT,
} as never));

describe('7.54: a sub-project\'s photos are numbered and attached in the parent\'s report', () => {
  const draft = write(UPDATES);
  keep('754-report.txt', draft.body);

  it('every photo of the parent and of its sub-project has a number, in record order; another job\'s has none', () => {
    expect(attachedPhotos(draft)).toEqual({ q3: '1 Needs Classification', q6: '2 Canopy C Package', q4: '3 Lot', q2: '4 Canopy C', q1: '5 Lot' });
  });

  it('each goes under the line it belongs to', () => {
    const section = draft.body.split('\n');
    expect(section).toContain('• Progress: Inspector walked the canopy. See Image 2.');
    expect(section).toContain('• Progress: Canopy walk. See Image 1.');
    expect(section).toContain('• Progress: Footings poured at grid C4. See Image 4.');
    expect(section).toContain('• Evidence: See Images 3 and 5.');
  });

  it('the e-mail, the text message and the Word file are handed all five, in the body\'s numbers', () => {
    expect(reportCitedImages(draft as never).map(item => `${item.imageNumber}:${item.photoId}`)).toEqual(['1:q3', '2:q6', '3:q4', '4:q2', '5:q1']);
  });

  it('another device holding the same records in another order writes the same report', () => {
    expect(write([...UPDATES].reverse()).body).toBe(draft.body);
  });

  it('a sub-project\'s photo that names an area of the parent goes to that area, as the parent\'s own would', () => {
    const own = write([
      ...UPDATES,
      update('s3', SUB, PARENT, 'Canopy C', '2026-10-10', 'Canopy columns were plumbed.', [photo('q7', 'Gate sign', { selectedAreaName: 'Lot' })]),
    ]);
    expect(attachedPhotos(own).q7).toMatch(/ Lot$/);
  });

  it('a report with no photo from a sub-project keeps its words', () => {
    const without = write([...PARENTS_OWN, ...FROM_THE_SUB_PROJECT.map(item => ({ ...item, photos: [] })), ...ANOTHER_JOB]);
    keep('754-unchanged.txt', without.body);
    expect(without.body).toBe(UNCHANGED);
  });

  it('every change to the sub-project\'s update or photo that moves the words moves the fingerprint', () => {
    const [s1, s2] = FROM_THE_SUB_PROJECT;
    const changes: Array<[string, ProjectUpdate[]]> = [
      ['a photo\'s caption', [...PARENTS_OWN, s1, { ...s2, photos: [photo('q3', 'Canopy walk with the inspector')] } as ProjectUpdate]],
      ['a photo\'s own area', [...PARENTS_OWN, s1, { ...s2, photos: [photo('q3', 'Canopy walk', { selectedAreaName: 'Canopy C' })] } as ProjectUpdate]],
      ['a photo more', [...PARENTS_OWN, s1, { ...s2, photos: [photo('q3', 'Canopy walk'), photo('q5', 'Canopy bolts')] } as ProjectUpdate]],
      ['a photo less', [...PARENTS_OWN, { ...s1, photos: [] } as ProjectUpdate, s2]],
      ['the photos\' order', [...PARENTS_OWN, s1, { ...s2, photos: [photo('q5', 'Canopy bolts'), photo('q3', 'Canopy walk')] } as ProjectUpdate]],
      ['the update\'s area', [...PARENTS_OWN, { ...s1, selectedAreaName: 'Canopy D' } as ProjectUpdate, s2]],
      ['the sub-project\'s name', [...PARENTS_OWN, s1, { ...s2, projectName: 'Canopy C Works' } as ProjectUpdate]],
    ];
    const before = { text: draft.body, print: fingerprint(UPDATES) };
    const base = { text: write([...PARENTS_OWN, s1, { ...s2, photos: [photo('q3', 'Canopy walk'), photo('q5', 'Canopy bolts')] } as ProjectUpdate]).body };
    const moved: string[] = [];
    const slips = changes.flatMap(([what, updates]) => {
      const reference = what === 'the photos\' order' ? { text: base.text, print: fingerprint([...PARENTS_OWN, s1, { ...s2, photos: [photo('q3', 'Canopy walk'), photo('q5', 'Canopy bolts')] } as ProjectUpdate]) } : before;
      const text = write(updates).body;
      if (text !== reference.text) moved.push(what);
      return text !== reference.text && fingerprint(updates) === reference.print ? [what] : [];
    });
    expect(slips).toEqual([]);
    // Not a test of nothing: each of these changes moves the words.
    expect(moved).toEqual(changes.map(([what]) => what));
    // And the same records give the same fingerprint (nothing new, nothing moves).
    expect(fingerprint([...UPDATES].reverse())).toBe(before.print);
  });
});

/** The parent's report on ba74253c when the sub-project's updates carry no photo, letter for letter. */
const UNCHANGED = [
  "Please review the updates below and look for action items assigned to your name.",
  "",
  "Project Summary",
  "• Construction progress was reported or visually observed in 2 areas; verification status is identified in the detailed evidence.",
  "• Key update: Heron Yard / Canopy C Package — Inspector walked the canopy.",
  "",
  "Heron Yard",
  "",
  "1. Canopy C Package",
  "• Progress: Inspector walked the canopy.",
  "",
  "2. Lot",
  "• Evidence: See Images 1 and 2.",
  "• Progress: Silt fence was set at the lot.",
  "• Progress: Gravel was spread at the lot.",
  "",
  "3. Canopy C",
  "• Progress: Footings poured at grid C4.",
  "",
  "Please let me know if you have any questions.",
].join('\n');
