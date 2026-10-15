/**
 * Open item 7.62 (High, Build 232's device checks, check 18): "See Image N" printed on a note that has no photo.
 *
 * A work area prints at most three lines. In the check, a note recorded with a photo ("Neighbor asked about weekend
 * hours.", no area) was pushed out of its area by three newer notes, and its photo's "See Image 1." ended the newest
 * of them: "Concrete washout pit was installed near the gate. See Image 1." The client is pointed at the wrong photo,
 * on the screen's Work Areas & Photos card and in every output (Copy, e-mail, text, Outlook and the Word file all
 * print the same lines). Build 231 put every photo of an area on the area's FIRST progress line, whoever's it was;
 * and where an area's three lines were full, on its first line (4.87); and the area's only plain note took the area's
 * photo numbers (4c).
 *
 * Now "See Image N" sits only on a line of the photo's own (made from the photo, or from a note or photo of the field
 * update it was taken with); where its own line is not printed, the photo keeps its number on a line of its own
 * ("See Image 1."). Every photo is still numbered, attached and cited once, and a line that was its photo's own reads
 * as before. The report's fingerprint (dave-report-source/3.0) holds which photo each update has, so a change that
 * moves a "See Image" moves the fingerprint. The draft, the briefing and the fingerprint are the app's own code, as the
 * Reports screen puts them together. Made-up project and notes. No network.
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

import * as fs from 'fs';
import { buildPIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, enhanceDAVEReportDraft } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildPIEReportDraft } from '../../services/PIEReporter';
import type { ProjectUpdate } from '../../types';

jest.setTimeout(240_000);
const OUT = process.env.R232_OUT_DIR || '';
const keep = (name: string, lines: string[]) => { if (OUT) fs.writeFileSync(`${OUT}/${name}`, `${lines.join('\n')}\n`); };

const PROJECT = 'Heron Yard';
const NOW = '2026-10-15T02:05:00.000Z';
const photo = (id: string, caption = '', extra: Record<string, unknown> = {}) => ({
  id, uri: `file:///p/${id}.jpg`, caption, category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '',
  actionStatus: 'Open', createdAt: '2026-10-10T12:00:00.000Z', fileName: `${id}.jpg`, mimeType: 'image/jpeg', ...extra,
});
const update = (id: string, area: string, date: string, notes: string, photos: unknown[] = []) => ({
  id, projectName: PROJECT, scheduleProjectName: PROJECT, date, photos, recipients: { contactIds: [] }, notes, status: 'sent',
  selectedAreaName: area,
}) as unknown as ProjectUpdate;

/** The written report as the Reports screen makes it (Project Manager format), its fingerprint, and the screen's cards. */
function phone(updates: ProjectUpdate[]) {
  jest.useFakeTimers({ now: Date.parse(NOW), doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
  try {
    const truths = buildDAVEReportProjectTruths({
      projects: [{ name: PROJECT, projectId: 'report:heron' }], projectRecords: [{ name: PROJECT }] as never,
      updates, scheduleItems: [], knownScheduleItems: [], knownScheduleDocuments: [], projectAreas: [], referenceDocuments: [],
    });
    const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: [PROJECT], previousSnapshot: null, scheduleItems: [] } as never);
    const core = buildPIECoreIntelligence({
      runtimeContext: {
        projectName: PROJECT, projectNames: [PROJECT], reportType: 'daily_project_update', updates, scheduleItems: [],
        knownScheduleItems: [], currentUpdate: null, projectAreas: [], contacts: { contacts: [] }, referenceDocuments: [], surface: 'reports',
      } as never,
      reportType: 'daily_project_update' as never, reportProjectNames: [PROJECT], organizationId: 'local-unverified-anonymous', projectId: 'project-heron',
    } as never);
    const draft = core.reportDraft as unknown as { locationGroups: Array<{ workAreas: Array<{ title: string; bullets: Array<{ text: string }>; imageReferences: Array<{ photoId: string; imageNumber: number }> }> }> };
    const body = String(enhanceDAVEReportDraft(core.reportDraft as never, briefing, 'project_manager').body);
    const from = body.indexOf('WORK AREAS / PHOTO NOTES');
    const section = body.slice(from, body.indexOf('\n\n', from)).split('\n').slice(1);
    const cards = draft.locationGroups.flatMap(group => group.workAreas.flatMap(area => area.bullets.map(bullet => `${area.title}: ${bullet.text}`)));
    const numberOf = Object.fromEntries(draft.locationGroups.flatMap(group => group.workAreas.flatMap(area =>
      area.imageReferences.map(reference => [reference.photoId, reference.imageNumber] as const))));
    return { fingerprint: buildDAVEReportSourceFingerprint(truths), section, cards, numberOf };
  } finally {
    jest.useRealTimers();
  }
}

/** The numbers a line cites ("See Image 3.", "See Images 1, 2, and 4."). */
const cited = (line: string) => ((line.match(/See Images? ([0-9, and]+)\./)?.[1] || '').match(/\d+/g) || []).map(Number);
const withoutCitation = (line: string) => line.replace(/\s*See Images? [0-9, and]+\.$/, '').trim();
/**
 * Every line citing a photo is that photo's own note (its words begin the line), or the citation alone; each photo
 * is cited once. `notes` maps each photo to the note of the update it was taken with ('' for none).
 */
function citedOnItsOwnNote(lines: string[], numberOf: Record<string, number>, notes: Record<string, string>) {
  Object.entries(numberOf).forEach(([photoId, number]) => {
    const citing = lines.filter(line => cited(line).includes(number));
    expect({ photoId, citing: citing.length }).toEqual({ photoId, citing: 1 });
    const words = withoutCitation(citing[0].replace(/^.*?: /, ''));
    if (words) expect({ photoId, line: words }).toEqual({ photoId, line: notes[photoId] });
  });
}

// The check's Unassigned area, as the tester left it: the photo's note first, then three newer notes.
// (The app files a note recorded with no area under "Unassigned / Unknown Area".)
const NO_AREA = 'Unassigned / Unknown Area';
const CHECK_18 = [
  update('u1', NO_AREA, '2026-10-10', 'Neighbor asked about weekend hours.', [photo('p1')]),
  update('u2', NO_AREA, '2026-10-11', 'Owner walked the job with the lender.'),
  update('u3', NO_AREA, '2026-10-12', 'Temporary fencing was installed along the street frontage.'),
  update('u4', NO_AREA, '2026-10-13', 'Concrete washout pit was installed near the gate.'),
];

describe('7.62: "See Image N" sits on the note of the photo\'s own update', () => {
  it('check 18: the photo\'s note is pushed out of its area: its number stands on a line of its own, not on the washout note', () => {
    const read = phone(CHECK_18);
    keep('762-check18-section.txt', read.section);
    // Text, e-mail, Outlook and the Word file print the section; the screen prints the cards: the same lines.
    expect(read.section.map(line => line.replace(/^• [^—]+— /, ''))).toEqual(read.cards);
    expect(read.section.some(line => /washout pit was installed near the gate\. See Image/.test(line))).toBe(false);
    citedOnItsOwnNote(read.section, read.numberOf, { p1: 'Neighbor asked about weekend hours.' });
    expect(read.section).toContain(`• ${PROJECT} — Unassigned / Unknown Area: See Image 1.`);
  });

  it('two notes of one area, each with its photos: each line cites its own (Build 231 put all three on the first)', () => {
    const updates = [
      update('w1', 'Warehouse', '2026-10-06', 'Steel columns were set on line A.', [photo('q1', 'Line A columns'), photo('q2')]),
      update('w2', 'Warehouse', '2026-10-08', 'Anchor bolts were checked at column C4.', [photo('q3', 'Column C4 anchor bolts')]),
    ];
    const read = phone(updates);
    keep('762-two-notes-section.txt', read.section);
    citedOnItsOwnNote(read.section, read.numberOf, {
      q1: 'Steel columns were set on line A.', q2: 'Steel columns were set on line A.', q3: 'Anchor bolts were checked at column C4.',
    });
  });

  it('an area whose three lines are requests: a photo of another note keeps a line of its own (4.87 put it on the first)', () => {
    // Three requests (no progress line: the area's photos had a line of their own, cut at three), and a plain note
    // with a photo, older than all three.
    const updates = [
      update('r1', 'Roof', '2026-10-05', 'Neighbor asked about weekend hours.', [photo('r1p')]),
      update('r2', 'Roof', '2026-10-06', 'Dana – Please call the roofer about the drain.'),
      update('r3', 'Roof', '2026-10-08', 'Sam – Please send the flashing detail to the architect.'),
      update('r4', 'Roof', '2026-10-10', 'Lee – Please order the drain covers.'),
    ];
    const read = phone(updates);
    keep('762-busy-area-section.txt', read.section);
    citedOnItsOwnNote(read.section, read.numberOf, { r1p: 'Neighbor asked about weekend hours.' });
    expect(read.section).toContain(`• ${PROJECT} — Roof: See Image 1.`);
  });

  it('an area\'s only plain note takes the area\'s photo numbers only when they are its own photos (4c)', () => {
    const own = phone([update('d1', 'Dock', '2026-10-09', 'Neighbor asked about weekend hours.', [photo('d1p')])]);
    expect(own.section).toEqual([`• ${PROJECT} — Dock: Neighbor asked about weekend hours. See Image 1.`]);
    const another = phone([
      update('d2', 'Dock', '2026-10-09', '', [photo('d2p', '', { selectedAreaName: 'Dock' })]),
      update('d3', 'Dock', '2026-10-10', 'Mail carrier left a parcel at the trailer.'),
    ]);
    citedOnItsOwnNote(another.section, another.numberOf, { d2p: '' });
    expect(another.section).toEqual([
      `• ${PROJECT} — Dock: See Image 1.`,
      `• ${PROJECT} — Dock: Mail carrier left a parcel at the trailer.`,
    ]);
  });

  it('the fingerprint holds where each "See Image" stands: the same photo taken with another note moves both', () => {
    const before = phone(CHECK_18);
    const moved = phone(CHECK_18.map(item => item.id === 'u1'
      ? { ...item, photos: [] }
      : item.id === 'u4' ? { ...item, photos: [photo('p1')] } : item) as ProjectUpdate[]);
    // The photo is the washout note's now: it is cited there, and the report is another report.
    expect(moved.section).toContain(`• ${PROJECT} — Unassigned / Unknown Area: Concrete washout pit was installed near the gate. See Image 1.`);
    expect(moved.section).not.toEqual(before.section);
    expect(moved.fingerprint).not.toBe(before.fingerprint);
    // The same records read again: the same text, the same fingerprint.
    const again = phone([...CHECK_18].reverse());
    expect(again.section).toEqual(before.section);
    expect(again.fingerprint).toBe(before.fingerprint);
  });

  it('a report whose every line already cited its own photos reads as before, to the word', () => {
    const draft = buildPIEReportDraft({
      reportType: 'daily_project_update', audience: 'internal_team', selectedProjectNames: [PROJECT],
      savedUpdates: [
        update('k1', 'Quay', '2026-10-09', 'Piles were driven at grid 6.', [photo('k1a', 'Piles at grid 6'), photo('k1b')]),
        update('k2', 'Yard', '2026-10-07', 'Conduit was trenched along the yard fence.'),
      ],
      scheduleItems: [], generatedAt: new Date('2026-10-13T16:00:00.000Z'),
    } as never);
    expect(draft.body).toContain('• Progress: Piles were driven at grid 6. See Images 1 and 2.');
    expect(draft.body).toContain('• Progress: Conduit was trenched along the yard fence.');
  });
});
