jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []) } }));
import { buildDailyProjectUpdate, buildCombinedProjectUpdate, buildPIEReportDraft, reportWordingRequiresAppTextKey } from '../../services/PIEReporter';
import type { ProjectUpdate } from '../../types';
const PROJECT = 'Juniper House';
const note = (id: string, notes: string, day: number, area = 'Roof') => ({ id, projectName: PROJECT, scheduleProjectName: PROJECT, date: `2026-10-${String(day).padStart(2, '0')}`, notes, selectedAreaName: area, photos: [], recipients: { contactIds: [] }, status: 'sent' }) as unknown as ProjectUpdate;
const build = (kind: string, updates: ProjectUpdate[]) => {
  const input = { selectedProjectNames: [PROJECT], savedUpdates: updates, scheduleItems: [] };
  return kind === 'combined' ? buildCombinedProjectUpdate(input as never) : kind === 'executive' ? buildPIEReportDraft({ ...input, reportType: 'executive_summary' } as never) : buildDailyProjectUpdate(input as never);
};
const lines = (r: ReturnType<typeof build>) => r.locationGroups.flatMap(g => g.workAreas.filter(a => a.projectName === PROJECT && a.title === 'Roof').flatMap(a => a.bullets.filter(b => b.kind !== 'image_reference').map(b => b.text)));
const PLAIN = 'Radio batteries were swapped.';
const PROGRESS = 'Roof flashing was installed at the north edge.';
const crowded = (kind: 'plain' | 'progress', count: number) => [note('real', kind === 'plain' ? PLAIN : PROGRESS, 1), ...Array.from({ length: count }, (_, i) => note(`hidden-${i}`, kind === 'plain' ? `Visitor log mentions project area group ${i}.` : `Roof membrane was installed in project area ${i}.`, i + 2))];
it.each(['daily', 'combined', 'executive'].flatMap(format => (['plain', 'progress'] as const).map(kind => ({ format, kind }))))('actual final $format report does not let suppressed $kind candidates hide printable work', ({ format, kind }) => {
  const updates = crowded(kind, kind === 'plain' ? 4 : 3);
  for (const ordered of [updates, [...updates].reverse()]) {
    const report = build(format, ordered);
    const expected = kind === 'plain' ? PLAIN : PROGRESS;
    expect(lines(report)).toContain(expected);
    if (format === 'executive') expect(report.body).not.toContain(expected);
    else expect(report.body).toContain(expected);
    expect(lines(report).join(' ')).not.toMatch(/project area/i);
    expect(lines(report).length).toBeLessThanOrEqual(3);
  }
});
it.each(['plain', 'progress'] as const)('newly recovered $s words cannot reuse a legacy sent record without an app text key', kind => {
  const report = build('daily', crowded(kind, 4));
  expect(reportWordingRequiresAppTextKey(report)).toBe(true);
});

it.each(['plain', 'progress'] as const)('unchanged raw executive wording retains legacy approval despite recovered $s area model', kind => {
  expect(reportWordingRequiresAppTextKey(build('executive', crowded(kind, 4)))).toBe(false);
});

const priority = [
  note('new-progress', 'Roof membrane was installed.', 20),
  note('new-issue', 'Water leak found at the roof drain.', 21),
  note('new-action', 'Dana to confirm the delivery date.', 22),
];
it.each((['plain', 'progress'] as const).flatMap(kind => [2, 3, 4, 6].flatMap(hidden => [0, 1, 2, 3].flatMap(occupied => [false, true].map(reverse => ({ kind, hidden, occupied, reverse }))))))(
  'printable $kind selection: $hidden suppressed, $occupied occupied, reverse=$reverse', ({ kind, hidden, occupied, reverse }) => {
    const updates = [...crowded(kind, hidden), ...priority.slice(0, occupied)];
    const report = build('daily', reverse ? updates.reverse() : updates);
    const actual = lines(report);
    const expected = kind === 'plain' ? PLAIN : PROGRESS;
    expect(actual.length).toBeLessThanOrEqual(3);
    expect(actual.join(' ')).not.toMatch(/project area/);
    if (occupied < 3) expect(actual).toContain(expected);
    else expect(actual).not.toContain(expected);
    const retained = lines(build('daily', priority.slice(0, occupied)));
    retained.forEach(text => expect(actual).toContain(text));
    expect(actual).toEqual(lines(build('daily', [...updates].reverse())));
    if (occupied === 3) expect(report.candidateSelectionRequiresAppTextKey).not.toBe(true);
  },
);
const ownPhoto = { id: 'own-p1', uri: 'file:///own-p1.jpg', caption: '', category: 'Progress', selectedAreaName: 'Roof', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open' };
it('recovered authored captured-for words keep their exemption and own photo reference', () => {
  const text = 'Signatures were captured for the project area access permit.';
  const updates = crowded('plain', 4).map(u => u.id === 'real' ? { ...u, notes: text, photos: [ownPhoto] } : u) as ProjectUpdate[];
  const report = build('daily', updates);
  expect(lines(report).filter(line => line.includes(text))).toEqual([`${text} See Image 1.`]);
  expect(report.imageReferences).toEqual(expect.arrayContaining([expect.objectContaining({ photoId: 'own-p1', sourceUpdateId: 'real' })]));
});
it('a suppressed newer note photo stays on its own image line rather than the recovered older note', () => {
  const updates = crowded('plain', 4).map(u => u.id === 'hidden-3' ? { ...u, photos: [ownPhoto] } : u) as ProjectUpdate[];
  const report = build('daily', updates);
  expect(lines(report)).toContain(PLAIN);
  expect(lines(report).find(line => line.includes(PLAIN))).not.toContain('See Image');
  const bullets = report.locationGroups.flatMap(g => g.workAreas.flatMap(a => a.bullets));
  expect(bullets.filter(b => b.kind === 'image_reference').map(b => b.text)).toContain('See Image 1.');
  expect(report.imageReferences).toEqual(expect.arrayContaining([expect.objectContaining({ photoId: 'own-p1', sourceUpdateId: 'hidden-3' })]));
});
it('accepted provider captured-for text stays suppressed while a saved owner edit is preserved', () => {
  const text = 'Signatures were captured for the project area access permit.';
  const updates = crowded('plain', 4).map(u => u.id === 'real' ? { ...u, notes: text, pieSuggestedNote: text, pieSuggestedNoteAccepted: true } : u) as ProjectUpdate[];
  expect(lines(build('daily', updates))).not.toContain(text);
  const edited = updates.map(u => u.id === 'real' ? { ...u, notes: `${text} Field record complete.` } : u);
  expect(lines(build('daily', edited))).toContain(`${text} Field record complete.`);
});
it('suppressed candidates in another area cannot crowd the printable area', () => {
  const updates = crowded('plain', 6).map(u => u.id === 'real' ? u : { ...u, selectedAreaName: 'Lobby' });
  expect(lines(build('daily', updates))).toEqual([PLAIN]);
});
