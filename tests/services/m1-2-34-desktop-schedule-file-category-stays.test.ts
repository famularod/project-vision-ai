jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

import * as web from '../../services/DAVEWebOperations';
import type { DAVEWebReferenceDocument } from '../../services/DAVEWebReadOnlyRepository';

// Open item 2.34 (review pass 6, O-8; 13 Oct 2026). On the computer's Documents page, Edit Project Document Details on
// an OLDER schedule file (or an upload never made current, or a replaced lookahead) let him change its Category, say
// to Report. The file was then no longer a schedule by the app's own test, and its tasks were listed again on every
// device at once: each task the newer schedule had moved twice, a task it had dropped back. Nothing asked first.
// Of the brief's two ways, the smaller and safer: the Category of a schedule file with tasks is not changed on the
// computer, and the form says so. Everything else he types in that form is saved as before. Made-up projects.

const doc = (extra: Partial<DAVEWebReferenceDocument>): DAVEWebReferenceDocument => ({
  id: 'Alpha rev 1', name: 'Alpha rev 1', originalFileName: 'Alpha rev 1.csv', uri: '', mimeType: 'text/csv', category: 'Schedules', notes: '',
  isCurrent: false, importedAt: '2026-09-01T12:00:00.000Z', projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: 'batch-alpha-1',
  cloudUpdatedAt: '2026-09-30T12:00:00.000Z', linkedScheduleItems: [{ id: 'row-1', cloudUpdatedAt: '2026-09-30T12:00:00.000Z' }], importedScheduleItemCount: 3,
  ...extra,
});
const STAYS = 'This schedule file has tasks, so its category stays Schedules. Under another category its tasks would show again on every device, some of them twice. To file it as something else, delete it with its tasks, then upload it again.';

describe('the Category of a schedule file with tasks stays as it is on the computer (open item 2.34)', () => {
  it('an older master, an upload never made current, a replaced lookahead: the category stays', () => {
    for (const [what, document] of [
      ['an older master', doc({})],
      ['an upload never made current, every task shared with the master', doc({ linkedScheduleItems: [], importedScheduleItemCount: 3 })],
      ['a replaced lookahead', doc({ scheduleRole: 'lookahead', lookaheadReplaced: 'Replaced by the lookahead of 10/05/2026', linkedScheduleItems: [], importedScheduleItemCount: 0 })],
      ['a file named as a schedule with no category', doc({ category: '', name: 'Alpha schedule rev 1' })],
    ] as const) {
      expect([what, web.daveWebScheduleCategoryStays(document)]).toEqual([what, true]);
    }
  });

  it('Save Document Details with another Category is refused in his words; with the same Category it is not', () => {
    expect(web.daveWebDocumentDetailsRefusal(doc({}), { category: 'Report', projectNames: ['Alpha'] })).toBe(STAYS);
    expect(web.daveWebDocumentDetailsRefusal(doc({}), { category: 'Other' })).toBe(STAYS);
    expect(web.daveWebDocumentDetailsRefusal(doc({}), { category: 'Schedules', projectNames: ['Alpha', 'Beta'] })).toBeNull();
    expect(web.daveWebDocumentDetailsRefusal(doc({}), { projectNames: ['Beta'] })).toBeNull();
    expect(web.daveWebScheduleCategoryStaysText('Schedules')).toBe(STAYS);
  });

  it('unchanged: a schedule file with no task, a drawing, a report or a message screenshot can still be filed under another category', () => {
    for (const [what, document] of [
      ['a schedule file with no task (it could not be read)', doc({ linkedScheduleItems: [], importedScheduleItemCount: 0 })],
      ['a drawing', doc({ category: 'Drawing', name: 'A2.01', originalFileName: 'A2.01.pdf', importBatchId: null, linkedScheduleItems: [], importedScheduleItemCount: 0 })],
      ['a report', doc({ category: 'Report', name: 'Site memo', importBatchId: null, linkedScheduleItems: [], importedScheduleItemCount: 0 })],
      ['a message screenshot with activities', doc({ category: 'Other', name: 'Schedule message - IMG_0001', notes: '[Schedule communication screenshot] Imported for local text recognition and schedule review.' })],
    ] as const) {
      expect([what, web.daveWebScheduleCategoryStays(document)]).toEqual([what, false]);
      expect([what, web.daveWebDocumentDetailsRefusal(document, { category: 'Permit Card' })]).toEqual([what, null]);
    }
  });
});
