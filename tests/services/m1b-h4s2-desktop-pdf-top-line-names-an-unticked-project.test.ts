jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

import * as web from '../../services/DAVEWebOperations';

// Review pass H4, H4S-2 (Low, caused by M1's 2.35 and 4.88; 14 Oct 2026). A Microsoft Project PDF whose top line is one
// of his projects that is NOT ticked: M1 cleared the top line (as the phone does), so its tasks said "Needs Project (the
// file names no project)" (untrue: the file names 6102 Mill Yard) and, with one project ticked, the one button offered
// the WRONG project ("Use 6101 Quay Works for all 2 tasks with no project in the file"). Now such a task is read as a
// spreadsheet row naming that project is read: the unticked-project words, the grey line naming it, and no button.
// The desktop's own functions; the positioned PDF page of review pass 10. Made-up projects.

const QUAY = '6101 Quay Works';
const MILL = '6102 Mill Yard';
const SHED = 'Garden shed';
const ALL = [QUAY, MILL, SHED];

type Row = readonly [name: string, indent: number, start: string, finish: string];
function microsoftProjectPage(rows: readonly Row[]) {
  const regions: unknown[] = [];
  const addRegion = (text: string, x: number, y: number, width = 0.04) => {
    regions.push({ id: `region-${regions.length + 1}`, text, label: text, x, y, width, height: 0.01, source: 'embedded_text', confidence: 1 });
  };
  ([['ID', 0.03], ['Task Name', 0.05], ['Duration', 0.31], ['Start', 0.36], ['Finish', 0.41], ['%', 0.46]] as const)
    .forEach(([text, x]) => addRegion(text, x, 0.02));
  rows.forEach(([taskName, indent, start, finish], index) => {
    const id = String(index + 1);
    const y = 0.05 + index * 0.02;
    const taskX = 0.05 + indent * 0.007;
    regions.push({
      id: `activity-${id}`, text: `${id} ${taskName}`, label: `${id} ${taskName}`, x: 0.03, y, width: 0.26, height: 0.01,
      source: 'embedded_text', confidence: 1,
      constituentEvidence: [
        { id: `activity-${id}-id`, text: id, source: 'embedded_text', confidence: 1, bounds: { x: 0.03, y, width: 0.012, height: 0.01 } },
        { id: `activity-${id}-task`, text: taskName, source: 'embedded_text', confidence: 1, bounds: { x: taskX, y, width: 0.29 - taskX, height: 0.01 } },
      ],
    });
    addRegion('3 days', 0.31, y);
    addRegion(start, 0.36, y);
    addRegion(finish, 0.41, y);
    addRegion('0%', 0.46, y, 0.025);
  });
  return { pageNumber: 1, text: (regions as { text: string }[]).map(region => region.text).join('\n'), regions };
}
/** A file whose top line is `root`, with its two tasks straight under it. */
const flatUnder = (root: string): Row[] => [[root, 0, '10/26/2026', '11/13/2026'], ['Pour deck', 1, '10/26/2026', '10/30/2026'], ['Framing', 1, '11/02/2026', '11/13/2026']];
const prepare = (ticked: readonly string[], rows: readonly Row[], projects: readonly string[] = ALL) => {
  const page = microsoftProjectPage(rows);
  return web.prepareDAVEWebDocumentUpload({
    fileName: 'Campus plan.pdf', mimeType: 'application/pdf', sizeBytes: 50_000, contents: page.text, extractedPages: [page] as never,
    category: 'Schedules', projectNames: ticked, projects: [...projects], openProjectNames: [...projects], fingerprint: 'e'.repeat(64),
    now: '2026-10-14T09:00:00.000Z',
  });
};
type Prepared = ReturnType<typeof prepare>;
const listed = (prepared: Prepared) => prepared.scheduleItems.map(item => `${item.taskName} | ${web.daveWebScheduleUploadRowProject(prepared, item)}`);
const HELD = '2 tasks need a project before you can upload: the file names their project "6102 Mill Yard", which is one of your projects but is not ticked. Choose a project for each of them above.';
const NAMED = '"6102 Mill Yard" in the file is your project 6102 Mill Yard, which is not ticked. To file these tasks under it, tick it under Projects above and choose the file again.';

describe('a Microsoft Project PDF whose top line is a project of his that is not ticked (review pass H4, H4S-2)', () => {
  it('Quay ticked: the tasks say the file names 6102 Mill Yard, the line names it, and there is no one button for Quay', () => {
    const prepared = prepare([QUAY], flatUnder(MILL));
    expect(listed(prepared)).toEqual(['Pour deck | Needs Project (the file names "6102 Mill Yard")', 'Framing | Needs Project (the file names "6102 Mill Yard")']);
    expect(web.daveWebScheduleUploadProjectReview(prepared)).toEqual({ heldLine: HELD, useForAll: null, savedUnderLine: null });
    expect(web.daveWebScheduleUploadOtherProjectLine(prepared)).toBe(NAMED);
    // Given Quay by hand on each task (his own presses), the grey line says what the file named.
    const given = { ...prepared, scheduleItems: prepared.scheduleItems.map(item => ({ ...item, projectName: QUAY, scheduleProjectName: QUAY })) };
    expect(web.daveWebScheduleUploadProjectReview(given).savedUnderLine).toBe('2 tasks named "6102 Mill Yard" in the file will be saved under 6101 Quay Works.');
  });

  it('Quay and Garden shed ticked: the same words, no button; another spelling of the top line is named as the file writes it', () => {
    const two = prepare([QUAY, SHED], flatUnder(MILL));
    expect(web.daveWebScheduleUploadProjectReview(two)).toEqual({ heldLine: HELD, useForAll: null, savedUnderLine: null });
    expect(web.daveWebScheduleUploadOtherProjectLine(two)).toBe(NAMED);
    const respelled = prepare([QUAY], flatUnder('6102 mill-yard'));
    expect(listed(respelled)).toEqual(['Pour deck | Needs Project (the file names "6102 mill-yard")', 'Framing | Needs Project (the file names "6102 mill-yard")']);
    expect(web.daveWebScheduleUploadOtherProjectLine(respelled)).toBe('"6102 mill-yard" in the file is your project 6102 Mill Yard, which is not ticked. To file these tasks under it, tick it under Projects above and choose the file again.');
  });

  it('unchanged: Mill Yard ticked (the right tick) files them under it; a top line that is none of his projects still names no project', () => {
    const right = prepare([MILL], flatUnder(MILL));
    expect(right.scheduleItems.map(item => [item.projectName, item.scheduleProjectName])).toEqual([[MILL, MILL], [MILL, MILL]]);
    expect(web.daveWebScheduleUploadProjectReview(right).heldLine).toBeNull();
    const campus = prepare([QUAY], flatUnder('Campus Works'));
    expect(listed(campus)).toEqual(['Pour deck | Needs Project (the file names no project)', 'Framing | Needs Project (the file names no project)']);
    expect(web.daveWebScheduleUploadProjectReview(campus).useForAll).toEqual({ project: QUAY, label: 'Use 6101 Quay Works for all 2 tasks with no project in the file' });
  });

  it('the "Full schedule or Lookahead" suggestion is Build 231\'s: it reads such a task as the first ticked project under the file\'s top line', () => {
    const snapshot = { referenceDocuments: [], scheduleItems: [], knownScheduleItems: [] };
    expect(web.daveWebScheduleUploadRoleSuggestion({ snapshot: snapshot as never, prepared: prepare([QUAY], flatUnder(MILL)) }))
      .toEqual({ role: 'master', reason: 'there is no master schedule for 6101 Quay Works yet' });
  });
});
