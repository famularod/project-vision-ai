/**
 * Whole-app audit A5 F4 (30 Sep 2026): Set Active on a schedule flipped flags
 * on the phone only; every merge takes the cloud's current flag, so the choice
 * never reached the cloud and the next refresh undid it. Activation now goes
 * through the cloud's activation call and changes nothing locally first.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceDocument } from '../../types';
import {
  activateSharedReferenceDocument,
  scheduleActivationEffects,
  scheduleRetirementMessage,
} from '../../services/SharedDocumentActivation';

const client = {} as SupabaseClient;
const schedule = (id: string, projectNames: string[], extra: Partial<ReferenceDocument> = {}) => ({
  id,
  name: id,
  originalFileName: `${id}.pdf`,
  uri: '',
  category: 'Schedules',
  notes: '',
  isCurrent: false,
  importedAt: '2026-09-01T00:00:00.000Z',
  projectId: null,
  projectName: projectNames.length === 1 ? projectNames[0] : null,
  projectNames,
  cloudUpdatedAt: `2026-09-01T00:00:00.000Z-${id}`,
  ...extra,
}) as ReferenceDocument;
const activated = (documentId: string) => ({
  status: 'activated' as const, documentId, updatedAt: 'later', changedCount: 2, message: null,
});
const conflict = {
  status: 'conflict' as const, documentId: null, updatedAt: null, changedCount: 0,
  message: 'The shared document changed first. Refresh before changing the current revision.',
};

describe('making a shared document current (audit A5 F4)', () => {
  const combined = schedule('combined', ['Alpha', 'Beta'], { isCurrent: true });
  const alphaNew = schedule('alpha-new', ['Alpha']);
  const documents = [combined, alphaNew];

  // Round 2 (A5 pass 3 F2): projectsLeftWithoutCurrentSchedule became
  // scheduleActivationEffects, which also names the schedule a project goes
  // back to; the cases below keep their meaning.
  it('names the projects that would be left without a current schedule', () => {
    expect(scheduleActivationEffects(alphaNew, documents)).toEqual([{ projectName: 'Beta', fallbackSchedule: null }]);
    // Beta shows a schedule of its own (the same age wins by id), so its schedule does not change.
    const betaOwn = schedule('beta-own', ['Beta'], { isCurrent: true });
    expect(scheduleActivationEffects(alphaNew, [...documents, betaOwn])).toEqual([]);
    // Same project only, and never for a drawing.
    const alphaOld = schedule('alpha-old', ['Alpha'], { isCurrent: true });
    expect(scheduleActivationEffects(alphaNew, [alphaOld, alphaNew])).toEqual([]);
    expect(scheduleActivationEffects({ ...alphaNew, category: 'Drawing' }, documents)).toEqual([]);
  });

  it('asks before retiring another project\'s schedule, and changes nothing when declined', async () => {
    const activate = jest.fn(async () => activated('alpha-new'));
    const confirm = jest.fn(async () => false);
    await expect(activateSharedReferenceDocument({
      documentId: 'alpha-new', documents, client, activate,
      listDocuments: async () => documents, confirmRetiringProjects: confirm,
    })).resolves.toEqual({ status: 'cancelled' });
    expect(confirm).toHaveBeenCalledWith([{ projectName: 'Beta', fallbackSchedule: null }]);
    expect(activate).not.toHaveBeenCalled();
  });

  it('activates through the cloud with the record revision, then returns the cloud list', async () => {
    const cloudAfter = [{ ...combined, isCurrent: false }, { ...alphaNew, isCurrent: true }];
    const activate = jest.fn(async () => activated('alpha-new'));
    // Round 2 (A5 pass 3 F2): the cloud's list is read before the question too.
    const listDocuments = jest.fn().mockResolvedValueOnce(documents).mockResolvedValueOnce(cloudAfter);
    await expect(activateSharedReferenceDocument({
      documentId: 'alpha-new', documents, client, activate,
      listDocuments, confirmRetiringProjects: async () => true,
    })).resolves.toEqual({ status: 'activated', documents: cloudAfter });
    expect(listDocuments).toHaveBeenCalledTimes(2);
    expect(activate).toHaveBeenCalledWith({
      client, documentId: 'alpha-new', expectedUpdatedAt: alphaNew.cloudUpdatedAt,
    });
  });

  it('needs a record the cloud already has, and a signed-in client', async () => {
    const activate = jest.fn(async () => activated('alpha-new'));
    const base = { documentId: 'alpha-new', activate, listDocuments: async () => documents, confirmRetiringProjects: async () => true };
    await expect(activateSharedReferenceDocument({ ...base, client: null, documents }))
      .resolves.toEqual({ status: 'refresh_required' });
    await expect(activateSharedReferenceDocument({ ...base, client, documents: [combined, { ...alphaNew, cloudUpdatedAt: null }] }))
      .resolves.toEqual({ status: 'refresh_required' });
    expect(activate).not.toHaveBeenCalled();
  });

  it('retries once against the cloud copy after a conflict', async () => {
    const fresh = [combined, { ...alphaNew, cloudUpdatedAt: 'fresher' }];
    const activate = jest.fn()
      .mockResolvedValueOnce(conflict)
      .mockResolvedValueOnce(activated('alpha-new'));
    await expect(activateSharedReferenceDocument({
      documentId: 'alpha-new', documents, client, activate,
      listDocuments: async () => fresh, confirmRetiringProjects: async () => true,
    })).resolves.toMatchObject({ status: 'activated' });
    expect(activate).toHaveBeenCalledTimes(2);
    expect(activate).toHaveBeenLastCalledWith({ client, documentId: 'alpha-new', expectedUpdatedAt: 'fresher' });
  });

  it('does not retry when the cloud copy would retire a project the owner was not asked about', async () => {
    const gamma = schedule('gamma-combined', ['Alpha', 'Gamma'], { isCurrent: true });
    const fresh = [combined, gamma, { ...alphaNew, cloudUpdatedAt: 'fresher' }];
    const activate = jest.fn().mockResolvedValue(conflict);
    // Round 2 (A5 pass 3 F2): the owner is asked from the first cloud read; Gamma appears only after it.
    await expect(activateSharedReferenceDocument({
      documentId: 'alpha-new', documents, client, activate,
      listDocuments: jest.fn().mockResolvedValueOnce(documents).mockResolvedValue(fresh),
      confirmRetiringProjects: async () => true,
    })).resolves.toEqual({ status: 'failed', message: conflict.message });
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('passes a drawing that is not prepared through as not prepared', async () => {
    const drawing = { ...alphaNew, id: 'drawing', category: 'Drawing' };
    const activate = jest.fn(async () => ({
      status: 'not_prepared' as const, documentId: null, updatedAt: null, changedCount: 0, message: 'Not prepared yet.',
    }));
    await expect(activateSharedReferenceDocument({
      documentId: 'drawing', documents: [drawing], client, activate,
      listDocuments: async () => [drawing], confirmRetiringProjects: async () => true,
    })).resolves.toEqual({ status: 'not_prepared', message: 'Not prepared yet.' });
  });
});

// Whole-app audit A5 pass 3 F2 (30 Sep 2026): the confirmation was worked out
// from the phone's flags, which mark one current schedule per project. A
// project whose older schedule the cloud still marked current was said to
// show no schedule tasks, and then silently went back to that schedule.
describe('the Set Active confirmation says what each other project shows next (audit A5 pass 3 F2)', () => {
  const combined = schedule('Combined master', ['Alpha', 'Beta', 'Gamma'], { isCurrent: true, importedAt: '2026-09-10T00:00:00.000Z' });
  const betaOld = schedule('Beta rev 1', ['Beta'], { isCurrent: true, importedAt: '2026-09-01T00:00:00.000Z' });
  const alphaNew = schedule('Alpha rev 2', ['Alpha'], { importedAt: '2026-09-20T00:00:00.000Z' });
  const cloud = [combined, betaOld, alphaNew];
  // The phone's reconciled copy: the master is Beta's newest, so Beta rev 1 reads as not current.
  const phone = [combined, { ...betaOld, isCurrent: false }, alphaNew];

  it('names the older schedule a project goes back to, and says when one is left with none', async () => {
    const confirm = jest.fn(async (_effects: unknown) => false);
    await expect(activateSharedReferenceDocument({
      documentId: alphaNew.id, documents: phone, client, activate: jest.fn(),
      listDocuments: async () => cloud, confirmRetiringProjects: confirm,
    })).resolves.toEqual({ status: 'cancelled' });
    const effects = [
      { projectName: 'Beta', fallbackSchedule: { id: 'Beta rev 1', name: 'Beta rev 1' } },
      { projectName: 'Gamma', fallbackSchedule: null },
    ];
    expect(confirm).toHaveBeenCalledWith(effects);
    const message = scheduleRetirementMessage(effects);
    expect(message).toBe(
      'The schedule now current for Beta, Gamma will be retired too. ' +
      'Beta goes back to Beta rev 1, an older schedule still marked current there. ' +
      'Gamma is left with no current schedule and shows no schedule tasks until you set one.',
    );
  });

  it('leaves out a project whose own newer schedule it already shows', () => {
    const betaNewer = schedule('Beta rev 3', ['Beta'], { isCurrent: true, importedAt: '2026-09-15T00:00:00.000Z' });
    expect(scheduleActivationEffects(alphaNew, [...cloud, betaNewer])).toEqual([{ projectName: 'Gamma', fallbackSchedule: null }]);
  });

  it('is what the app asks: App.tsx activateReferenceDocument, compiled, with the phone and cloud lists', async () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const ts = jest.requireActual('typescript') as typeof import('typescript');
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    const start = app.indexOf('\n  async function activateReferenceDocument(') + 1;
    const end = app.indexOf('\n  function markReferenceDocumentCurrent(', start);
    const alerts: Array<{ title: string; message: string }> = [];
    const deps: Record<string, unknown> = {
      referenceDocumentsCurrentRef: { current: phone }, currentReferenceActivationIdsRef: { current: new Set<string>() },
      buildECOSDocumentReadiness: () => ({ canMakeCurrent: true, detail: '' }), canonicalReferenceCategory: () => 'schedule',
      activateSharedReferenceDocument, scheduleRetirementMessage, getSupabaseClient: () => client,
      listReferenceDocuments: async () => ({ ok: true, stubbed: false, data: cloud }), normalizeReferenceDocuments: (rows: unknown) => rows,
      Alert: { alert: (title: string, message: string, buttons?: Array<{ text: string; onPress?: () => void }>) => {
        alerts.push({ title, message });
        buttons?.find(button => button.text === 'Cancel')?.onPress?.();
      } },
    };
    const js = ts.transpileModule(`module.exports = ${app.slice(start, end).trim()}`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const mod = { exports: {} as unknown as (documentId: string) => Promise<boolean> };
    new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
    await expect((mod.exports as unknown as (documentId: string) => Promise<boolean>)(alphaNew.id)).resolves.toBe(false);
    expect(alerts).toEqual([{
      title: 'Change the current schedule?',
      message: expect.stringContaining('Beta goes back to Beta rev 1, an older schedule still marked current there.'),
    }]);
    expect(alerts[0].message).not.toContain('Beta is left with no current schedule');
  });

  it('changes nothing when the cloud list cannot be read first', async () => {
    const activate = jest.fn();
    const confirm = jest.fn(async () => true);
    await expect(activateSharedReferenceDocument({
      documentId: alphaNew.id, documents: phone, client, activate,
      listDocuments: async () => null, confirmRetiringProjects: confirm,
    })).resolves.toEqual({ status: 'failed', message: 'The shared schedules could not be read. Try again shortly.' });
    expect(confirm).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('asks for a refresh when the cloud no longer has the schedule', async () => {
    const activate = jest.fn();
    await expect(activateSharedReferenceDocument({
      documentId: alphaNew.id, documents: phone, client, activate,
      listDocuments: async () => [combined, betaOld], confirmRetiringProjects: async () => true,
    })).resolves.toEqual({ status: 'refresh_required' });
    expect(activate).not.toHaveBeenCalled();
  });
});
