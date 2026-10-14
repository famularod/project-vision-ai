jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

import * as web from '../../services/DAVEWebOperations';
import type { DAVEWebReferenceDocument } from '../../services/DAVEWebReadOnlyRepository';

// Review pass H4, H4S-1 (Medium, older; open item 2.42; 14 Oct 2026). On the computer, Edit Project Document Details on
// a REPLACED lookahead let him untick its project and tick another: saved, the lookahead counted again (the newest one
// for the project it now names), so Framing jumped back to its old dates and the detail task the newer lookahead had
// dropped came back, on every device, with no card. On an older master the same change hid the other project's tasks
// at Make Current, with no question (runs-M1/b02). M1's 2.34 already kept such a file's Category; its Projects now stay
// too, by the same rule and in the same words. Made-up projects.

const doc = (extra: Partial<DAVEWebReferenceDocument>): DAVEWebReferenceDocument => ({
  id: 'Alpha look 1', name: 'Alpha look 1', originalFileName: 'Alpha look 1.csv', uri: '', mimeType: 'text/csv', category: 'Schedules', notes: '',
  isCurrent: false, importedAt: '2026-09-09T12:00:00.000Z', projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: 'batch-alpha-look-1',
  cloudUpdatedAt: '2026-09-30T12:00:00.000Z', linkedScheduleItems: [{ id: 'detail-1', cloudUpdatedAt: '2026-09-30T12:00:00.000Z' }], importedScheduleItemCount: 2,
  scheduleRole: 'lookahead', lookaheadReplaced: 'Replaced by the lookahead of Sep 10, 2026', ...extra,
});
const STAY = web.DAVE_WEB_SCHEDULE_DETAILS_STAY_TEXT;

describe('the Projects of a schedule file with tasks stay as they are on the computer (review pass H4, H4S-1)', () => {
  it('the words he reads say why and what to do instead', () => {
    expect(STAY).toBe('This schedule file has tasks, so its category and projects stay as they are. Changed, its tasks could show again on every device (some twice, or on old dates), and Make Current on it could hide another project\'s tasks. To file it differently, delete it with its tasks, then upload it again.');
  });

  it('a replaced lookahead or an older master moved to another project, or given another as well: Save Document Details is refused in those words', () => {
    for (const document of [doc({}), doc({ id: 'Alpha rev 0', name: 'Alpha rev 0', scheduleRole: undefined, lookaheadReplaced: null })]) {
      expect([document.id, web.daveWebDocumentDetailsRefusal(document, { projectName: 'Beta', projectNames: ['Beta'] })]).toEqual([document.id, STAY]);
      expect([document.id, web.daveWebDocumentDetailsRefusal(document, { projectName: 'Alpha', projectNames: ['Alpha', 'Beta'] })]).toEqual([document.id, STAY]);
      expect([document.id, web.daveWebDocumentDetailsRefusal(document, { category: 'Report', projectName: 'Alpha', projectNames: ['Alpha'] })]).toEqual([document.id, STAY]);
    }
  });

  it('unchanged: the same projects (any capitals, listed twice) are not refused; nor is any change to a document that is not a schedule with tasks', () => {
    expect(web.daveWebDocumentDetailsRefusal(doc({}), { category: 'Schedules', projectName: 'Alpha', projectNames: ['Alpha', 'alpha '] })).toBeNull();
    expect(web.daveWebDocumentDetailsRefusal(doc({ category: 'Report', name: 'Site memo', scheduleRole: undefined, importBatchId: null, linkedScheduleItems: [], importedScheduleItemCount: 0 }), { projectName: 'Beta', projectNames: ['Beta'] })).toBeNull();
    expect(web.daveWebDocumentDetailsRefusal(doc({ scheduleRole: undefined, lookaheadReplaced: null, linkedScheduleItems: [], importedScheduleItemCount: 0 }), { projectName: 'Beta', projectNames: ['Beta'] })).toBeNull();
  });
});
