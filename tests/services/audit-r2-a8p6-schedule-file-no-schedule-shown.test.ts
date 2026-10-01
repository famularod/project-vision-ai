/**
 * Audit round 2, A8 pass 6 L1 (30 Sep 2026), a gap c1e30db's guard left:
 * with NO schedule shown for the project, re-picking the old master's file
 * was pushed into a lookahead.
 *
 * Master F was replaced by M2; David deleted M2, so the project showed no
 * schedule. He picked F's file again instead of tapping Set Active: the
 * review came preset and forced to Lookahead ("this exact file is already
 * saved as a full schedule … can only be added again as a lookahead"), and
 * Full schedule was refused. Accepted, the master became its own lookahead,
 * so a task the next master dropped kept showing. The guard only asked
 * whether the saved copy is the schedule shown now.
 *
 * Now the saved full copy is also in use while any project it covers shows
 * no full schedule: the import is refused either way, with "This schedule
 * file is already saved. Open it in Schedule Sources and use Set Active to
 * show it again." (the phone's Schedule Sources panel and its Set Active
 * button), at the pick and again at Accept. Synthetic data only.
 */
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { scheduleImportRoleRefusal, suggestScheduleImportRole } from '../../services/ScheduleLookahead';
import { resolveScheduleImportSourceIdentity } from '../../services/ScheduleImportSourceIdentity';
import { scheduleImportOfFile } from '../../services/SharedDocumentActivation';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

const SET_ACTIVE = 'This schedule file is already saved. Open it in Schedule Sources and use Set Active to show it again.';
const PROJECTS = [{ id: 'alpha-id', name: 'Alpha' }, { id: 'beta-id', name: 'Beta' }];
const schedule = (id: string, projectNames: string[], importedAt: string, extra: Partial<ReferenceDocument> = {}) => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true,
  importedAt, projectId: null, projectName: projectNames.length === 1 ? projectNames[0] : null, projectNames,
  importBatchId: `batch-${id}`, cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt, ...extra,
}) as ReferenceDocument;

function fileOf(lines: string[], projectNames: string[]) {
  const bytes = new TextEncoder().encode(lines.join('\n'));
  const projects = PROJECTS.filter(project => projectNames.includes(project.name));
  const identity = resolveScheduleImportSourceIdentity({ bytes, projects, documentIdIsDeleted: () => false });
  const saved = (importedAt: string, extra: Partial<ReferenceDocument> = {}) => schedule(identity.documentId, projectNames, importedAt, {
    importBatchId: identity.batchId, contentSha256: identity.contentSha256, ...extra,
  });
  const pick = (documents: ReferenceDocument[]) => scheduleImportOfFile({
    bytes, projects, documentIdIsDeleted: () => false, documents, scheduleItems: [], projectNames,
  });
  return { identity, saved, pick };
}

const HEADER = 'Task,Project,Area,Start,Finish,% Complete';
const masterF = fileOf([HEADER, 'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,20%', 'Frame walls,Alpha,Lot,10/05/2026,10/09/2026,0%'], ['Alpha']);
// F as the cloud leaves it once M2 was made current: no longer current.
const savedF = masterF.saved('2026-08-31T12:00:00.000Z', { isCurrent: false });
const m2 = schedule('MASTER 0926', ['Alpha'], '2026-09-26T12:00:00.000Z');

/** The review of F's file picked again while another master was shown: preset to Lookahead. */
const review = { documents: [schedule('again', ['Alpha'], '2026-09-30T12:00:00.000Z', { scheduleRole: 'lookahead', contentSha256: masterF.identity.contentSha256 })], items: [] as ScheduleItem[] };

describe('A8 pass 6 L1: with no schedule shown, the old master\'s file is never pushed into a lookahead', () => {
  it('with M2 shown, F\'s file is offered as a lookahead, as before', () => {
    expect(masterF.pick([savedF, m2])).toMatchObject({ alreadyImported: false, asLookahead: true });
  });

  it('M2 deleted, so Alpha shows no schedule: picking F\'s file again is refused, saying to use Set Active', () => {
    expect(masterF.pick([savedF])).toMatchObject({ alreadyImported: true, asLookahead: false, alreadyAddedMessage: SET_ACTIVE });
    // Only a lookahead left for Alpha is no full schedule either.
    const lookahead = schedule('Alpha 3 Week Lookahead', ['Alpha'], '2026-09-20T12:00:00.000Z', { scheduleRole: 'lookahead' });
    expect(masterF.pick([savedF, lookahead])).toMatchObject({ alreadyImported: true, asLookahead: false, alreadyAddedMessage: SET_ACTIVE });
  });

  it('a combined master covering Alpha and Beta is refused when either shows no full schedule', () => {
    const combined = fileOf([HEADER, 'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,20%', 'Roofing,Beta,Lot,12/01/2026,12/15/2026,30%'], ['Alpha', 'Beta']);
    const savedCombined = combined.saved('2026-08-31T12:00:00.000Z', { isCurrent: false });
    const betaMaster = schedule('BETA 0926', ['Beta'], '2026-09-26T12:00:00.000Z');
    const alphaMaster = schedule('ALPHA 0926', ['Alpha'], '2026-09-26T12:00:00.000Z');
    // Pin updated deliberately (audit round 2, A8 pass 7 L1, 30 Sep 2026): still refused, but Beta shows its
    // own newer master, which Set Active on the combined copy would quietly replace: no Set Active advice.
    expect(combined.pick([savedCombined, betaMaster])).toMatchObject({ alreadyImported: true, asLookahead: false, alreadyAddedMessage: 'This schedule file is already saved under Schedule Sources.' });
    expect(combined.pick([savedCombined])).toMatchObject({ alreadyImported: true, asLookahead: false, alreadyAddedMessage: SET_ACTIVE });
    expect(combined.pick([savedCombined, alphaMaster, betaMaster])).toMatchObject({ alreadyImported: false, asLookahead: true });
  });

  it('the review says why, and refuses Lookahead and Full schedule alike', () => {
    expect(suggestScheduleImportRole({ batch: review, documents: [savedF], scheduleItems: [] })).toEqual({
      role: 'lookahead', only: true,
      reason: 'this schedule file is already saved. Open it in Schedule Sources and use Set Active to show it again',
    });
    expect(scheduleImportRoleRefusal(review, 'lookahead', [savedF])).toBe(SET_ACTIVE);
    expect(scheduleImportRoleRefusal(review, 'master', [savedF])).toBe(SET_ACTIVE);
  });

  it('checks again at Accept: M2 deleted while the review was open refuses it; with M2 shown it saves as before', () => {
    // Opened while M2 was shown: offered as a lookahead, Lookahead accepted, Full schedule refused.
    expect(scheduleImportRoleRefusal(review, 'lookahead', [savedF, m2])).toBeNull();
    expect(scheduleImportRoleRefusal(review, 'master', [savedF, m2])).toMatch(/^This exact schedule is already saved as a full schedule/);
    // M2 deleted before Accept.
    expect(scheduleImportRoleRefusal(review, 'lookahead', [savedF])).toBe(SET_ACTIVE);
  });

  it('F still shown is refused as before (make the master current first), not with the Set Active message', () => {
    const shownF = masterF.saved('2026-08-31T12:00:00.000Z');
    expect(masterF.pick([shownF]).alreadyAddedMessage).toMatch(/make your master schedule current first/);
    expect(scheduleImportRoleRefusal(review, 'lookahead', [shownF])).toMatch(/^This exact schedule is the full schedule shown now/);
  });
});
