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
