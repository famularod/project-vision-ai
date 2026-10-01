import {
  askECOSProjectQuestion,
  ecosClosedProjectNames,
  findECOSProjectReferenceMismatch,
} from '../../services/ECOSProjectQuestion';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() },
}));
const mockedLoadRows = jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows);

// Audit A9 pass 3 L1 (30 Sep 2026): owner answer Q20 checked a question only
// against the pickable projects, and a closed project is not pickable. With
// 2375 closed and 2321 selected, "What was the slab thickness at 2375?" was
// sent to 2321 (before Q20 it was refused). Closed (archived, not deleted)
// project names are now checked too, on the phone and the desktop, and the
// refusal says the project is closed. Synthetic project names.

const SELECTED = '2321 Compliance Project';
const CLOSED = '2375 Compliance Project';
const QUESTION = 'What was the slab thickness at 2375?';

const unreachableClient = () => {
  const getSession = jest.fn();
  const invoke = jest.fn();
  return { getSession, invoke, client: { auth: { getSession }, functions: { invoke } } as never };
};

describe('audit A9 pass 3 L1: a closed project\'s number is refused again', () => {
  it('reproduction: the pickable list alone lets the closed project\'s number through', () => {
    expect(findECOSProjectReferenceMismatch(SELECTED, QUESTION, [SELECTED])).toBeNull();
  });

  it('with the closed projects, the number is refused and marked closed', () => {
    expect(findECOSProjectReferenceMismatch(SELECTED, QUESTION, [SELECTED], [CLOSED])).toEqual({
      selectedProjectIdentifier: '2321',
      referencedProjectIdentifier: '2375',
      referencedProjectClosed: true,
    });
    // A measurement is still not the closed project.
    expect(findECOSProjectReferenceMismatch(SELECTED, 'Is 2375 psi enough?', [SELECTED], [CLOSED])).toBeNull();
    // Audit A9 pass 5 (rule simplified: when unsure, refuse): a reference word
    // no longer exempts the number, so "RFI 2375" names closed project 2375.
    expect(findECOSProjectReferenceMismatch(SELECTED, 'What did RFI 2375 say?', [SELECTED], [CLOSED])?.referencedProjectClosed)
      .toBe(true);
  });

  it('the phone says the project is closed and where to reopen it, before any cloud request', async () => {
    const { client, getSession, invoke } = unreachableClient();
    await expect(askECOSProjectQuestion({
      client,
      projectId: 'p2321',
      projectName: SELECTED,
      question: QUESTION,
      knownProjectNames: [SELECTED],
      closedProjectNames: [CLOSED],
      refusalWording: 'phone',
    })).rejects.toMatchObject({
      code: 'project_reference_mismatch',
      message: 'Project 2321 is selected, but 2375 is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.',
    });
    expect(getSession).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('the desktop, which cannot reopen a project, points to the phone app', async () => {
    const { client, invoke } = unreachableClient();
    await expect(askECOSProjectQuestion({
      client,
      projectId: 'p2321',
      projectName: SELECTED,
      question: QUESTION,
      knownProjectNames: [SELECTED],
      closedProjectNames: [CLOSED],
    })).rejects.toMatchObject({
      code: 'project_reference_mismatch',
      message: 'Project 2321 is selected, but 2375 is a closed project. Reopen it in the Vitruvius iPhone or iPad app, then select it above and ask again.',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('a server refusal of a number the app knows only as closed is worded as closed', async () => {
    const response = new Response(JSON.stringify({
      error: 'project_reference_mismatch',
      selectedProjectIdentifier: '2321',
      referencedProjectIdentifier: '2375',
    }), { status: 409, headers: { 'content-type': 'application/json' } });
    const client = {
      auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null }) },
      functions: { invoke: jest.fn().mockResolvedValue({ data: null, error: new Error('request failed'), response }) },
    } as never;
    await expect(askECOSProjectQuestion({
      client,
      projectId: 'p2321',
      projectName: SELECTED,
      // Not refused here (a reference), so the server's numbers are used.
      question: 'What did RFI 2375 say?',
      knownProjectNames: [SELECTED],
      closedProjectNames: [CLOSED],
      refusalWording: 'phone',
    })).rejects.toMatchObject({
      message: 'Project 2321 is selected, but 2375 is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.',
    });
  });

  it('closed names leave out deleted, reopened and repeated projects', () => {
    expect(ecosClosedProjectNames({
      archived: [CLOSED, ' 2375 compliance project ', '2400 Deleted Job', '2500 Reopened', ''],
      deleted: ['2400 deleted job'],
      open: [SELECTED, '2500 Reopened'],
    })).toEqual([CLOSED]);
  });

  it('the desktop snapshot carries closed, not deleted, project names', async () => {
    mockedLoadRows.mockResolvedValue({
      projects: [
        { id: 'p2321', name: SELECTED, archived: false },
        { id: 'p2375', name: CLOSED, archived: true },
        { id: 'p2400', name: '2400 Deleted Job', archived: true },
      ],
      scheduleItems: [],
      projectUpdates: [],
      referenceDocuments: [],
      syncTombstones: [
        { entity_type: 'project', record_id: '2400 deleted job', deleted_at: '2026-09-30T12:01:00.000Z' },
      ],
    } as never);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    expect(snapshot.projects.map(project => project.name)).toEqual([SELECTED]);
    expect(snapshot.closedProjectNames).toEqual([CLOSED]);
  });
});

it('the phone app passes its closed and deleted project lists to Ask ECOS', () => {
  const app = readFileSync(join(__dirname, '../../App.tsx'), 'utf8');
  const call = app.slice(app.indexOf('useECOSProjectQuestionExperience({'), app.indexOf('onOpenEvidence: (projectName, evidence)'));
  expect(call).toContain('candidateProjects: reportAvailableProjectNames,');
  expect(call).toContain('archivedProjectNames: archivedProjects,');
  expect(call).toMatch(/\n\s*deletedProjectNames,\n/);
});
