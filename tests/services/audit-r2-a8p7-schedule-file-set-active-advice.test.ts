/**
 * Audit round 2, A8 pass 7 L1 (30 Sep 2026), left by 174c05a: the "use Set
 * Active" advice could quietly swap out a newer schedule on another project
 * the file covers, and was given where the task list still shows a schedule.
 *
 * Case A: combined master F covers Alpha and Beta. New single-project
 * masters MA and MB were made current, so F is retired for both; David
 * deleted MB, so Beta shows nothing. Re-picking F was refused with the Set
 * Active advice; following it makes F current for Alpha too and retires MA,
 * and the Set Active question never mentioned Alpha (it skips the chosen
 * schedule's own projects). Now the refusal is plain ("already saved under
 * Schedule Sources") while another project F covers shows a different
 * schedule, and the Set Active question names Alpha.
 *
 * Case B: combined master MAB is retired for Alpha and still current for
 * Beta; Alpha has no schedule of its own, so the task list still shows MAB's
 * Alpha tasks (the fallback in selectAuthoritativeScheduleItems). Alpha's old
 * master F was refused with the Set Active advice as if Alpha showed nothing.
 * Now Alpha counts as showing MAB, and F's file is offered as a lookahead.
 * Synthetic data only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceDocument, ScheduleItem } from '../../types';
import { scheduleFullCopyLeftUnshown, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { scheduleImportRoleRefusal, suggestScheduleImportRole } from '../../services/ScheduleLookahead';
import { resolveScheduleImportSourceIdentity } from '../../services/ScheduleImportSourceIdentity';
import {
  activateSharedReferenceDocument,
  scheduleActivationEffects,
  scheduleImportOfFile,
  scheduleRetirementMessage,
} from '../../services/SharedDocumentActivation';

jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));

const SET_ACTIVE = 'This schedule file is already saved. Open it in Schedule Sources and use Set Active to show it again.';
const SAVED = 'This schedule file is already saved under Schedule Sources.';
const PROJECTS = [{ id: 'alpha-id', name: 'Alpha' }, { id: 'beta-id', name: 'Beta' }];
const schedule = (id: string, projectNames: string[], importedAt: string, extra: Partial<ReferenceDocument> = {}) => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true,
  importedAt, projectId: null, projectName: projectNames.length === 1 ? projectNames[0] : null, projectNames,
  importBatchId: `batch-${id}`, cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt, ...extra,
}) as ReferenceDocument;
const task = (id: string, projectName: string, source: ReferenceDocument) => ({
  id, projectName, taskName: `Task ${id}`, locationName: 'Lot', owner: '', contractor: '', startDate: '10/01/2026',
  finishDate: '10/03/2026', milestone: '', status: 'Not Started', percentComplete: 0, priority: 'Medium', notes: '',
  createdAt: '2026-08-31T00:00:00.000Z', sourceDocumentId: source.id, importBatchId: source.importBatchId,
}) as ScheduleItem;

function fileOf(lines: string[], projectNames: string[]) {
  const bytes = new TextEncoder().encode(lines.join('\n'));
  const projects = PROJECTS.filter(project => projectNames.includes(project.name));
  const identity = resolveScheduleImportSourceIdentity({ bytes, projects, documentIdIsDeleted: () => false });
  const saved = (importedAt: string, extra: Partial<ReferenceDocument> = {}) => schedule(identity.documentId, projectNames, importedAt, {
    importBatchId: identity.batchId, contentSha256: identity.contentSha256, ...extra,
  });
  const pick = (documents: ReferenceDocument[], onDocumentsScreen?: boolean) => scheduleImportOfFile({
    bytes, projects, documentIdIsDeleted: () => false, documents, scheduleItems: [], projectNames, onDocumentsScreen,
  });
  /** The review of the file picked again, preset to Lookahead (A8 pass 5 L3). */
  const review = { documents: [schedule('again', projectNames, '2026-09-30T12:00:00.000Z', { scheduleRole: 'lookahead', contentSha256: identity.contentSha256 })], items: [] as ScheduleItem[] };
  return { identity, saved, pick, review };
}

const HEADER = 'Task,Project,Area,Start,Finish,% Complete';

describe('Case A: a combined master whose other project shows a newer schedule (A8 pass 7 L1)', () => {
  const combined = fileOf([HEADER, 'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,20%', 'Roofing,Beta,Lot,12/01/2026,12/15/2026,30%'], ['Alpha', 'Beta']);
  // F as the cloud leaves it once MA and then MB were made current: retired for both.
  const savedF = combined.saved('2026-08-31T12:00:00.000Z', { name: 'MASTER F 0831', isCurrent: false, retiredForProjectNames: ['Alpha', 'Beta'] });
  const ma = schedule('ALPHA 0926', ['Alpha'], '2026-09-26T12:00:00.000Z');
  // MB deleted: Beta shows nothing, Alpha shows MA.
  const documents = [savedF, ma];

  it('picking F again is refused plainly, with no Set Active advice', () => {
    expect(scheduleFullCopyLeftUnshown(savedF, documents)).toBe('other_shown');
    expect(combined.pick(documents)).toMatchObject({ alreadyImported: true, asLookahead: false, alreadyAddedMessage: SAVED });
  });

  it('the review says the same, and refuses Lookahead and Full schedule alike', () => {
    expect(suggestScheduleImportRole({ batch: combined.review, documents, scheduleItems: [] })).toEqual({
      role: 'lookahead', only: true, reason: 'this schedule file is already saved under Schedule Sources',
    });
    expect(scheduleImportRoleRefusal(combined.review, 'lookahead', documents)).toBe(SAVED);
    expect(scheduleImportRoleRefusal(combined.review, 'master', documents)).toBe(SAVED);
  });

  it('with neither project showing a schedule, Set Active is still the advice: it replaces nothing', () => {
    expect(scheduleFullCopyLeftUnshown(savedF, [savedF])).toBe('set_active');
    expect(combined.pick([savedF])).toMatchObject({ alreadyImported: true, alreadyAddedMessage: SET_ACTIVE });
    expect(scheduleImportRoleRefusal(combined.review, 'lookahead', [savedF])).toBe(SET_ACTIVE);
  });

  it('the Set Active question names Alpha, which would switch away from the newer MA', async () => {
    const own = { projectName: 'Alpha', fallbackSchedule: { id: savedF.id, name: savedF.name }, newerScheduleReplaced: { id: ma.id, name: ma.name } };
    expect(scheduleActivationEffects(savedF, documents, 'schedule')).toEqual([own]);
    expect(scheduleActivationEffects(savedF, documents, 'project')).toEqual([own]);
    expect(scheduleRetirementMessage([own])).toBe('Alpha now shows ALPHA 0926 (newer). Set Active on MASTER F 0831 will show MASTER F 0831 for Alpha too.');
    const confirm = jest.fn(async () => false);
    const activate = jest.fn();
    await expect(activateSharedReferenceDocument({
      documentId: savedF.id, documents, activate, confirmRetiringProjects: confirm,
      client: {} as SupabaseClient, listDocuments: async () => documents, loadRetirementScope: async () => 'project',
    })).resolves.toEqual({ status: 'cancelled' });
    expect(confirm).toHaveBeenCalledWith([own]);
    expect(activate).not.toHaveBeenCalled();
  });

  it('names it after another project\'s own effect, and leaves out a schedule older than F or a plain rollback', () => {
    // Gamma is shown by a combined schedule that F retires: the existing sentence comes first.
    const gammaShared = schedule('ALPHA GAMMA 0901', ['Alpha', 'Gamma'], '2026-09-01T12:00:00.000Z', { retiredForProjectNames: ['Alpha'] });
    expect(scheduleRetirementMessage(scheduleActivationEffects(savedF, [...documents, gammaShared], 'schedule'))).toBe(
      'The schedule now current for Gamma will be retired too. ' +
      'Gamma is left with no current schedule and shows no schedule tasks until you set one. ' +
      'Alpha now shows ALPHA 0926 (newer). Set Active on MASTER F 0831 will show MASTER F 0831 for Alpha too.',
    );
    // Alpha shows a schedule older than F: Alpha moves forward, nothing to name.
    const older = schedule('ALPHA 0801', ['Alpha'], '2026-08-01T12:00:00.000Z');
    expect(scheduleActivationEffects(savedF, [savedF, older], 'schedule')).toEqual([]);
    // Both projects show newer schedules: a rollback of the whole master, asked as before (nothing).
    const mb = schedule('BETA 0926', ['Beta'], '2026-09-26T12:00:00.000Z');
    expect(scheduleActivationEffects(savedF, [savedF, ma, mb], 'schedule')).toEqual([]);
    // A single-project rollback names nothing either.
    const alphaF = schedule('ALPHA 0831', ['Alpha'], '2026-08-31T12:00:00.000Z', { isCurrent: false });
    expect(scheduleActivationEffects(alphaF, [alphaF, ma], 'schedule')).toEqual([]);
  });
});

describe('Case B: a project shown through the fallback counts as showing a schedule (A8 pass 7 L1)', () => {
  const alphaOnly = fileOf([HEADER, 'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,20%', 'Frame walls,Alpha,Lot,10/05/2026,10/09/2026,0%'], ['Alpha']);
  // Alpha's old master F, replaced by MAB; then MAB retired for Alpha by an Alpha schedule later deleted.
  const savedF = alphaOnly.saved('2026-08-01T12:00:00.000Z', { isCurrent: false });
  const mab = schedule('MASTER AB 0901', ['Alpha', 'Beta'], '2026-09-01T12:00:00.000Z', { retiredForProjectNames: ['Alpha'] });
  const documents = [savedF, mab];

  it('the task list still shows MAB\'s Alpha tasks', () => {
    const items = [task('mab-alpha', 'Alpha', mab), task('mab-beta', 'Beta', mab)];
    expect(selectAuthoritativeScheduleItems({ scheduleItems: items, scheduleDocuments: documents }).map(item => item.id).sort())
      .toEqual(['mab-alpha', 'mab-beta']);
  });

  it('so F is not left unshown: its file is offered as a lookahead, and the review accepts Lookahead', () => {
    expect(scheduleFullCopyLeftUnshown(savedF, documents)).toBeNull();
    expect(alphaOnly.pick(documents)).toMatchObject({ alreadyImported: false, asLookahead: true });
    expect(suggestScheduleImportRole({ batch: alphaOnly.review, documents, scheduleItems: [] })).toMatchObject({
      role: 'lookahead', reason: 'this exact file is already saved as a full schedule for these projects, so it can only be added again as a lookahead',
    });
    expect(scheduleImportRoleRefusal(alphaOnly.review, 'lookahead', documents)).toBeNull();
  });

  it('only a lookahead left for Alpha is still no full schedule (A8 pass 6 L1)', () => {
    const lookahead = schedule('Alpha 3 Week Lookahead', ['Alpha'], '2026-09-20T12:00:00.000Z', { scheduleRole: 'lookahead' });
    expect(scheduleFullCopyLeftUnshown(savedF, [savedF, lookahead])).toBe('set_active');
    expect(alphaOnly.pick([savedF, lookahead])).toMatchObject({ alreadyImported: true, alreadyAddedMessage: SET_ACTIVE });
  });
});

describe('on the Documents screen the refusal says where Schedule Sources is', () => {
  const alphaOnly = fileOf([HEADER, 'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,20%'], ['Alpha']);
  const savedF = alphaOnly.saved('2026-08-01T12:00:00.000Z', { isCurrent: false });
  const combined = fileOf([HEADER, 'Pour slab,Alpha,Lot,10/01/2026,10/03/2026,20%', 'Roofing,Beta,Lot,12/01/2026,12/15/2026,30%'], ['Alpha', 'Beta']);
  const savedCombined = combined.saved('2026-08-31T12:00:00.000Z', { isCurrent: false });

  it('names the Schedule screen there, and only there', () => {
    expect(alphaOnly.pick([savedF], true).alreadyAddedMessage).toBe(
      'This schedule file is already saved. Open it in Schedule Sources on the Schedule screen and use Set Active to show it again.');
    expect(alphaOnly.pick([savedF], false).alreadyAddedMessage).toBe(SET_ACTIVE);
    expect(combined.pick([savedCombined, schedule('ALPHA 0926', ['Alpha'], '2026-09-26T12:00:00.000Z')], true).alreadyAddedMessage)
      .toBe('This schedule file is already saved under Schedule Sources on the Schedule screen.');
  });

  it('App.tsx tells the pick which screen it was made from', () => {
    const app = (jest.requireActual('fs') as typeof import('fs')).readFileSync(
      (jest.requireActual('path') as typeof import('path')).resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(app.includes("onDocumentsScreen: screen === 'ProjectDocuments'")).toBe(true);
  });
});
