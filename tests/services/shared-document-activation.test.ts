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
  projectsLeftWithoutCurrentSchedule,
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

  it('names the projects that would be left without a current schedule', () => {
    expect(projectsLeftWithoutCurrentSchedule(alphaNew, documents)).toEqual(['Beta']);
    // Beta keeps a schedule of its own, so nothing is left without one.
    const betaOwn = schedule('beta-own', ['Beta'], { isCurrent: true });
    expect(projectsLeftWithoutCurrentSchedule(alphaNew, [...documents, betaOwn])).toEqual([]);
    // Same project only, and never for a drawing.
    const alphaOld = schedule('alpha-old', ['Alpha'], { isCurrent: true });
    expect(projectsLeftWithoutCurrentSchedule(alphaNew, [alphaOld, alphaNew])).toEqual([]);
    expect(projectsLeftWithoutCurrentSchedule({ ...alphaNew, category: 'Drawing' }, documents)).toEqual([]);
  });

  it('asks before retiring another project\'s schedule, and changes nothing when declined', async () => {
    const activate = jest.fn(async () => activated('alpha-new'));
    const confirm = jest.fn(async () => false);
    await expect(activateSharedReferenceDocument({
      documentId: 'alpha-new', documents, client, activate,
      listDocuments: async () => documents, confirmRetiringProjects: confirm,
    })).resolves.toEqual({ status: 'cancelled' });
    expect(confirm).toHaveBeenCalledWith(['Beta']);
    expect(activate).not.toHaveBeenCalled();
  });

  it('activates through the cloud with the record revision, then returns the cloud list', async () => {
    const cloudAfter = [{ ...combined, isCurrent: false }, { ...alphaNew, isCurrent: true }];
    const activate = jest.fn(async () => activated('alpha-new'));
    await expect(activateSharedReferenceDocument({
      documentId: 'alpha-new', documents, client, activate,
      listDocuments: async () => cloudAfter, confirmRetiringProjects: async () => true,
    })).resolves.toEqual({ status: 'activated', documents: cloudAfter });
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
    await expect(activateSharedReferenceDocument({
      documentId: 'alpha-new', documents, client, activate,
      listDocuments: async () => fresh, confirmRetiringProjects: async () => true,
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
