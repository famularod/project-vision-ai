/**
 * Open item 4.87 (review pass 7, R7-4; the owner's authorisation of 13 Oct 2026): every photo he records is numbered
 * and attached, under the line it belongs to or a line of its own, the same on every device and in the Word file.
 *
 * Before: a photo recorded by itself whose caption has no word of the writer's building vocabulary, and a photo on a
 * note with no area, were in no line, had no number and were not attached (the reviewer's project: 7 photos, 5
 * numbered). The writer attached a photo to a work area only through a line made from the photo itself or from
 * another photo or note of ITS update in the same area; a photo with no area of its own was never attached.
 *
 * Now a photo that no line claims goes, in this order: under the line made from the photo itself; to its own area's
 * lines; to the lines of the update it was recorded with; else to a line of its own, under its own area (or the
 * update's), carrying its caption. Its number is its place among all the report's photos, as before (record order).
 * A report in which every photo was already attached is not changed by one word. Made-up project and names.
 */
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));

import * as fs from 'fs';
import { buildPIEReportDraft } from '../../services/PIEReporter';
import { reportCitedImages } from '../../services/ReportImageAttachments';
import type { ProjectUpdate } from '../../types';

const OUT = process.env.M2_OUT_DIR || '';
const keep = (name: string, text: string) => { if (OUT) fs.writeFileSync(`${OUT}/${name}`, text); };

const PROJECT = 'Kittiwake Quay';
const photo = (id: string, caption: string, extra: Record<string, unknown> = {}) => ({
  id, uri: `file:///p/${id}.jpg`, caption, category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '',
  actionStatus: 'Open', createdAt: '2026-10-10T12:00:00.000Z', ...extra,
});
const update = (id: string, area: string, date: string, notes: string, photos: unknown[] = []) => ({
  id, projectName: PROJECT, date, photos, recipients: { contactIds: [] }, notes, status: 'sent', selectedAreaName: area,
}) as unknown as ProjectUpdate;

/** Photos every report attached before this change (p1 to p5), and the four it did not (p6 to p9). */
const ATTACHED_BEFORE = [
  update('u1', 'Warehouse', '2026-10-06', 'Steel columns were set on line A.', [photo('p1', 'Line A columns'), photo('p2', '')]),
  update('u2', 'Warehouse', '2026-10-08', 'Anchor bolts were checked at column C4.', [photo('p3', 'Column C4 anchor bolts')]),
  update('u6', 'Yard', '2026-10-07', 'Conduit was trenched along the yard fence.'),
  update('u3', 'Quay', '2026-10-09', 'Piles were driven at grid 6.', [photo('p4', 'Piles at grid 6'), photo('p5', '')]),
];
const UPDATES = [
  ...ATTACHED_BEFORE,
  // The reviewer's first kind: a photo recorded alone, caption without a building word, in an area with lines.
  update('u4', 'Yard', '2026-10-10', '', [photo('p6', 'Base course at the yard entrance')]),
  // The second kind: a photo on a note that has no area.
  update('u5', '', '2026-10-11', 'Neighbor asked about weekend hours.', [photo('p7', 'Notice board at the gate')]),
  // Alone in an area with no other line: no caption, and a caption (the same day: the writer's own order puts u8 first).
  update('u7', 'Dock', '2026-10-12', '', [photo('p8', '')]),
  update('u8', 'Gate', '2026-10-12', '', [photo('p9', 'Visitor sign at the gate')]),
];

const write = (updates: ProjectUpdate[]) => buildPIEReportDraft({
  reportType: 'daily_project_update', audience: 'internal_team', selectedProjectNames: [PROJECT],
  savedUpdates: updates, scheduleItems: [], generatedAt: new Date('2026-10-13T16:00:00.000Z'),
} as never);
type Draft = ReturnType<typeof write>;
/** Each photo with its number and the heading of the work area it is attached under. */
const attachedPhotos = (draft: Draft) => Object.fromEntries(draft.locationGroups.flatMap(group => group.workAreas.flatMap(area =>
  area.imageReferences.map(reference => [reference.photoId, `${reference.imageNumber} ${area.title}`] as const))));
/** The image numbers a written line cites ("See Image 3.", "See Images 1, 2, and 4."). */
const cited = (text: string) => ((text.match(/See Images? ([0-9, and]+)\./)?.[1] || '').match(/\d+/g) || []).map(Number);
/** The written lines that cite image `n`. */
const lineCiting = (draft: Draft, n: number) => draft.locationGroups.flatMap(group => group.workAreas.flatMap(area =>
  area.bullets.filter(bullet => cited(bullet.text).includes(n)).map(bullet => `${area.title}: ${bullet.text}`)));

describe('4.87: every photo he records is numbered and attached', () => {
  const draft = write(UPDATES);
  keep('487-report.txt', draft.body);

  it('all nine photos have a number, 1 to 9, each once, in record order (newest first, as the writer numbers)', () => {
    const numbers = Object.values(attachedPhotos(draft)).map(value => Number(value.split(' ')[0])).sort((a, b) => a - b);
    expect(Object.keys(attachedPhotos(draft)).sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('each goes under the line it belongs to, or a line of its own', () => {
    expect(attachedPhotos(draft)).toEqual({
      p9: '1 Gate', p8: '2 Dock', p7: `3 ${PROJECT}`, p6: '4 Yard',
      p4: '5 Quay', p5: '6 Quay', p3: '7 Warehouse', p1: '8 Warehouse', p2: '9 Warehouse',
    });
    const section = draft.body.split('\n');
    // The note with no area carries the photo taken with it.
    expect(section).toContain('• Progress: Neighbor asked about weekend hours. See Image 3.');
    // The photo alone in the Yard is cited on the Yard's line.
    expect(section).toContain('• Progress: Conduit was trenched along the yard fence. See Image 4.');
    // A photo alone in an area with nothing else: a line of its own, its caption where it has one.
    expect(section).toContain('• Evidence: See Image 2.');
    expect(section).toContain('• Progress: Visitor sign at the gate. See Image 1.');
    for (let n = 1; n <= 9; n += 1) expect(lineCiting(draft, n)).toHaveLength(1);
    // An area made for a photo stands where its update stands among the others (newest first); the rest keep theirs.
    expect(section.filter(line => /^\d+\. /.test(line))).toEqual(['1. Gate', '2. Dock', `3. ${PROJECT}`, '4. Quay', '5. Warehouse', '6. Yard']);
  });

  it('a photo with no area whose caption makes a line of its own goes with that line, not with its note', () => {
    const own = write([
      ...ATTACHED_BEFORE,
      update('u10', '', '2026-10-12', 'Gate code was changed.', [photo('p11', 'Rebar delivered to the north gate')]),
    ]);
    keep('487-own-line.txt', own.body);
    const lineOfP11 = own.locationGroups.flatMap(group => group.workAreas)
      .find(area => area.bullets.some(bullet => bullet.text.startsWith('Rebar delivered to the north gate')));
    expect(lineOfP11?.imageReferences.map(reference => reference.photoId)).toEqual(['p11']);
  });

  it('the e-mail, the text message and the Word file are handed all nine, in the body\'s numbers', () => {
    // reportCitedImages is what the e-mail and text attach; the Word file takes the same numbers (App, Download Word).
    expect(reportCitedImages(draft as never).map(item => `${item.imageNumber}:${item.photoId}`))
      .toEqual(['1:p9', '2:p8', '3:p7', '4:p6', '5:p4', '6:p5', '7:p3', '8:p1', '9:p2']);
  });

  it('another device holding the same records in another order writes the same report', () => {
    expect(write([...UPDATES].reverse()).body).toBe(draft.body);
    expect(attachedPhotos(write([...UPDATES].reverse()))).toEqual(attachedPhotos(draft));
  });

  it('a photo with an area of its own, taken with a note in another area, goes to its own area', () => {
    const own = write([
      ...ATTACHED_BEFORE,
      update('u9', 'Quay', '2026-10-12', 'Fender boards were stacked.', [photo('p10', 'Gate keypad', { selectedAreaName: 'Yard' })]),
    ]);
    expect(attachedPhotos(own).p10).toMatch(/ Yard$/);
  });

  it('an area whose lines are a problem and two requests still cites its photo', () => {
    const busy = write([
      update('b1', 'Roof', '2026-10-10', '', [photo('r1', 'Water pooling at the drain', { category: 'Open Issue' })]),
      update('b2', 'Roof', '2026-10-11', 'Dana – Please call the roofer about the drain.'),
      update('b3', 'Roof', '2026-10-12', 'Sam – Please send the flashing detail to the architect.'),
    ]);
    keep('487-busy-area.txt', busy.body);
    expect(attachedPhotos(busy)).toEqual({ r1: '1 Roof' });
    expect(lineCiting(busy, 1)).toHaveLength(1);
  });

  it('a report in which every photo was already attached is not changed by one word', () => {
    const before = write(ATTACHED_BEFORE);
    keep('487-unchanged.txt', before.body);
    expect(before.body).toBe(UNCHANGED);
  });
});

/** The writer's text for ATTACHED_BEFORE on the base (b962c3cf), letter for letter. */
const UNCHANGED = [
  'Please review the updates below and look for action items assigned to your name.',
  '',
  'Project Summary',
  '• Construction progress was reported or visually observed in 2 areas; verification status is identified in the detailed evidence.',
  `• Key update: ${PROJECT} / Warehouse — Steel columns were set on line A.`,
  '',
  PROJECT,
  '',
  '1. Quay',
  '• Progress: Piles were driven at grid 6. See Images 1 and 2.',
  '',
  '2. Warehouse',
  '• Progress: Steel columns were set on line A. See Images 3, 4, and 5.',
  '• Progress: Anchor bolts were checked at column C4.',
  '',
  '3. Yard',
  '• Progress: Conduit was trenched along the yard fence.',
  '',
  'Please let me know if you have any questions.',
].join('\n');
