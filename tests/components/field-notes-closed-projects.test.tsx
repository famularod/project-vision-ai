import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { FieldNotesWorkspace } from '../../components/field-notes-workspace';
import { forgetFieldNoteDraft } from '../../hooks/use-field-note-draft';
import { localFieldNoteRepository } from '../../services/FieldNoteRepository';

// Whole-app audit A11 pass 4 L2 (30 Sep 2026): Field Notes offered closed
// projects as project choices. Closing a project only adds it to the archived
// list, and the workspace's choices came from every project record.
// Synthetic data only.

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiRemove: jest.fn(async () => undefined),
}));
jest.mock('../../services/FieldNoteRepository', () => {
  const actual = jest.requireActual('../../services/FieldNoteRepository');
  return {
    ...actual,
    localFieldNoteRepository: {
      list: jest.fn(async () => []),
      save: jest.fn(async (_ownerKey: string, note: unknown) => note),
      replace: jest.fn(async (_ownerKey: string, note: unknown) => note),
    },
  };
});

const repository = localFieldNoteRepository as jest.Mocked<typeof localFieldNoteRepository>;
const OPEN = '2321 Compliance Project';
const CLOSED = 'Old Yard';
const DELETED = 'Gone Lot';
const RECORDS = [
  { id: 'project-2321', name: OPEN },
  { id: 'project-old', name: CLOSED },
  { id: 'project-gone', name: DELETED },
];

afterEach(() => forgetFieldNoteDraft());

function renderNotes(ownerKey: string, voiceDraft: { id: string; text: string; projectName: string | null } | null = null) {
  return (
    <FieldNotesWorkspace
      ownerKey={ownerKey}
      projects={[OPEN]}
      projectRecords={RECORDS}
      voiceDraft={voiceDraft ? { ...voiceDraft, locationName: null } : null}
    />
  );
}

describe('Field Notes project choices (A11 pass 4 L2)', () => {
  it('offers only open projects for a new note', async () => {
    const screen = render(renderNotes('owner-l2-open'));
    await waitFor(() => expect(repository.list).toHaveBeenCalledWith('owner-l2-open'));
    fireEvent.press(screen.getByRole('button', { name: 'Type field note' }));

    expect(screen.getByRole('radio', { name: OPEN })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'General / no project' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: CLOSED })).toBeNull();
    expect(screen.queryByRole('radio', { name: `${CLOSED} (closed)` })).toBeNull();
    expect(screen.queryByRole('radio', { name: DELETED })).toBeNull();
  });

  it('a note that already names a closed project keeps it, shown as closed, and saves it with its id', async () => {
    const screen = render(renderNotes('owner-l2-kept'));
    await waitFor(() => expect(repository.list).toHaveBeenCalledWith('owner-l2-kept'));
    screen.rerender(renderNotes('owner-l2-kept', { id: 'voice-l2', text: 'Gate chain cut.', projectName: CLOSED }));

    const closedChip = await screen.findByRole('radio', { name: `${CLOSED} (closed)` });
    expect(closedChip.props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.queryByRole('radio', { name: DELETED })).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Save Field Note' }));
      await Promise.resolve();
    });
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(repository.save.mock.calls[0][1]).toMatchObject({ projectId: 'project-old', projectName: CLOSED });
  });

  it('once another project is picked, the closed one is no longer offered', async () => {
    const screen = render(renderNotes('owner-l2-moved'));
    await waitFor(() => expect(repository.list).toHaveBeenCalledWith('owner-l2-moved'));
    screen.rerender(renderNotes('owner-l2-moved', { id: 'voice-l2-moved', text: 'Gate chain cut.', projectName: CLOSED }));
    await screen.findByRole('radio', { name: `${CLOSED} (closed)` });

    fireEvent.press(screen.getByRole('radio', { name: OPEN }));
    expect(screen.queryByRole('radio', { name: `${CLOSED} (closed)` })).toBeNull();
  });
});
