/**
 * Whole-app audit A12 pass 5 M1 (30 Sep 2026): a new web task's cloud
 * project id comes from the one open cloud project with its project's name,
 * compared as the phone's upload compares them. The workspace keeps every
 * open project row (two with one name included) so "exactly one" can be
 * checked; the project list itself shows one entry per name.
 */
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { daveWebNewTaskProjectId } from '../../services/DAVEWebTaskEditing';

jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  daveWebSupabaseGateway: {
    loadAuthorizedRows: jest.fn(),
  },
}));

const mockedLoadRows = jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows);
const LOT_9 = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
const MAIN_ST = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const SECOND_LOT_9 = '0b0f6ad4-31a7-4c8b-9a51-1f43b8c0d7e2';

describe('daveWebNewTaskProjectId', () => {
  const listing = {
    projects: [{ id: LOT_9, name: 'Lot 9' }, { id: MAIN_ST, name: '2375 Main St' }],
    openCloudProjects: [{ id: LOT_9, name: 'Lot 9' }, { id: MAIN_ST, name: '2375 Main St' }],
  };

  test('exactly one open project of that name: its id, matched trimmed and in any case', () => {
    expect(daveWebNewTaskProjectId(listing, '2375 Main St')).toEqual({ ok: true, projectId: MAIN_ST });
    expect(daveWebNewTaskProjectId(listing, '  lot 9 ')).toEqual({ ok: true, projectId: LOT_9 });
  });

  test('no open project of that name, or no workspace yet: refused, with why', () => {
    const notOpen = 'This item was not saved: “Old Yard” is not one of your open projects in the cloud. Check the project on your iPhone or iPad, then try again.';
    expect(daveWebNewTaskProjectId(listing, 'Old Yard')).toEqual({ ok: false, message: notOpen });
    expect(daveWebNewTaskProjectId(null, 'Old Yard')).toEqual({ ok: false, message: notOpen });
    // A name only tasks carry is in the list with no id.
    expect(daveWebNewTaskProjectId({
      projects: [{ id: null, name: 'Old Yard' }],
      openCloudProjects: [],
    }, 'Old Yard')).toEqual({ ok: false, message: notOpen });
    // The phone compares names trimmed and in any case, not with inner
    // spaces merged: "Lot  9" is not "Lot 9" there, so it is not here.
    expect(daveWebNewTaskProjectId(listing, 'Lot  9')).toMatchObject({ ok: false });
  });

  test('two open projects with that name: refused, with why', () => {
    expect(daveWebNewTaskProjectId({
      ...listing,
      openCloudProjects: [...listing.openCloudProjects, { id: SECOND_LOT_9, name: 'LOT 9' }],
    }, 'Lot 9')).toEqual({
      ok: false,
      message: 'This item was not saved: more than one open project is named “Lot 9”, so Vitruvius cannot tell which one it belongs to. Check your projects on your iPhone or iPad.',
    });
  });

  test('without the open-rows list, the project list is used, closed projects left out', () => {
    expect(daveWebNewTaskProjectId({
      projects: [
        { id: LOT_9, name: 'Lot 9', archived: false },
        { id: SECOND_LOT_9, name: 'Lot 9', archived: true },
      ],
    }, 'Lot 9')).toEqual({ ok: true, projectId: LOT_9 });
  });
});

describe('the web workspace keeps every open project row (A12 pass 5 M1)', () => {
  test('two open rows with one name stay two; closed, deleted and id-less rows are left out', async () => {
    mockedLoadRows.mockResolvedValue({
      projects: [
        { id: LOT_9, name: 'Lot 9', archived: false },
        { id: SECOND_LOT_9, name: 'Lot 9 ', archived: false },
        { id: MAIN_ST, name: '2375 Main St', archived: false },
        { id: 'closed-row', name: 'Old Tank Farm', archived: true },
        { id: 'deleted-row', name: 'Torn Down', archived: false },
        { name: 'No Id Yet', archived: false },
      ],
      scheduleItems: [],
      projectUpdates: [],
      referenceDocuments: [],
      syncTombstones: [{
        entity_type: 'project',
        record_id: 'Torn Down',
        deleted_at: '2026-09-29T11:00:00.000Z',
      }],
    } as never);

    const snapshot = await loadDAVEWebReadOnlySnapshot();

    expect(snapshot.openCloudProjects).toEqual([
      { id: LOT_9, name: 'Lot 9' },
      { id: SECOND_LOT_9, name: 'Lot 9 ' },
      { id: MAIN_ST, name: '2375 Main St' },
    ]);
    expect(daveWebNewTaskProjectId(snapshot, 'Lot 9')).toMatchObject({ ok: false });
    expect(daveWebNewTaskProjectId(snapshot, '2375 Main St')).toEqual({ ok: true, projectId: MAIN_ST });
  });
});
