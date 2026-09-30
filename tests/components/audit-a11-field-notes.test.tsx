import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { FieldNotesWorkspace } from '../../components/field-notes-workspace';
import {
  createFieldNote,
  localFieldNoteRepository,
  markFieldNoteConflict,
  markFieldNoteSynced,
} from '../../services/FieldNoteRepository';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../../services/FieldNoteRepository', () => {
  const actual = jest.requireActual('../../services/FieldNoteRepository');
  return {
    ...actual,
    localFieldNoteRepository: {
      list: jest.fn(async () => []),
      save: jest.fn(async (_ownerKey: string, note: unknown) => note),
      updateStatus: jest.fn(),
      replace: jest.fn(async (_ownerKey: string, note: unknown) => note),
      replaceAll: jest.fn(async (_ownerKey: string, notes: unknown) => notes),
    },
  };
});

const repository = localFieldNoteRepository as jest.Mocked<typeof localFieldNoteRepository>;


// Whole-app audit A11 pass 1 (30 Sep 2026), field notes.
describe('field notes (audit A11 pass 1)', () => {
  beforeEach(() => {
    repository.list.mockResolvedValue([]);
    repository.save.mockImplementation(async (_ownerKey, note) => note);
  });

  it('F4: finishing a typed note by voice adds to it, and a typed location wins', async () => {
    const screen = render(
      <FieldNotesWorkspace ownerKey="owner-f4" projects={['2321 Compliance Project']} voiceDraft={null} />,
    );
    await waitFor(() => expect(repository.list).toHaveBeenCalledWith('owner-f4'));
    fireEvent.press(screen.getByRole('button', { name: 'Type field note' }));
    fireEvent.changeText(screen.getByLabelText('Field note'), 'East fence has a gap near');
    fireEvent.changeText(screen.getByLabelText('Field note location'), 'South Lot');
    screen.rerender(
      <FieldNotesWorkspace
        ownerKey="owner-f4"
        projects={['2321 Compliance Project']}
        voiceDraft={{ id: 'voice-f4', text: 'the north gate.', projectName: null, locationName: 'North Lot' }}
      />,
    );
    await waitFor(() => expect(screen.getByDisplayValue('East fence has a gap near the north gate.')).toBeTruthy());
    expect(screen.getByDisplayValue('South Lot')).toBeTruthy();
  });

  const desktopNote = (projectId: string, projectName: string) => markFieldNoteSynced(
    createFieldNote({
      id: `desktop-${projectId}`,
      text: 'Guardrail missing at the dock.',
      source: 'typed',
      projectId,
      projectName,
      now: '2026-08-03T15:00:00.000Z',
    }),
    2,
    '2026-08-03T15:00:00.000Z',
  );
  const editOnDesktop = async (note: ReturnType<typeof desktopNote>, pick?: string) => {
    const dataSource = {
      list: jest.fn(async () => [note]),
      save: jest.fn(),
      update: jest.fn(async (_ownerKey: string, edited: typeof note) => markFieldNoteSynced(edited, edited.revision + 1, edited.updatedAt)),
    };
    const screen = render(
      <FieldNotesWorkspace
        ownerKey="owner-f5"
        projects={['2321 Compliance Project']}
        projectRecords={[{ id: 'project-2321', name: '2321 Compliance Project' }]}
        dataSource={dataSource}
        presentation="desktop_inbox"
      />,
    );
    await waitFor(() => expect(screen.getByText('Guardrail missing at the dock.')).toBeTruthy());
    fireEvent.press(screen.getByRole('button', { name: 'Edit field note' }));
    fireEvent.changeText(screen.getByLabelText('Edit field note text'), 'Guardrail missing at the loading dock.');
    if (pick) fireEvent.press(screen.getByRole('radio', { name: pick }));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Save field note changes' }));
      await Promise.resolve();
    });
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    return { screen, edited: dataSource.update.mock.calls[0][1] };
  };

  it('F5: a text edit on the desktop keeps a closed project, shown as closed', async () => {
    const { screen, edited } = await editOnDesktop(desktopNote('project-old', 'Old Yard'));
    expect(screen.getByRole('radio', { name: 'Old Yard (closed)' })).toBeTruthy();
    expect(edited.projectId).toBe('project-old');
    expect(edited.projectName).toBe('Old Yard');
  });

  it('F5: a renamed project keeps its id and takes the current name; General still clears', async () => {
    const renamed = await editOnDesktop(desktopNote('project-2321', 'Building 2321'));
    expect(renamed.edited.projectId).toBe('project-2321');
    expect(renamed.edited.projectName).toBe('2321 Compliance Project');
    renamed.screen.unmount();
    const cleared = await editOnDesktop(desktopNote('project-old', 'Old Yard'), 'General / no project');
    expect(cleared.edited.projectId).toBeNull();
    expect(cleared.edited.projectName).toBeNull();
  });
});
