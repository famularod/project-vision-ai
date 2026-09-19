import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { FieldNotesWorkspace } from '../../components/field-notes-workspace';
import {
  createFieldNote,
  localFieldNoteRepository,
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

describe('FieldNotesWorkspace', () => {
  beforeEach(() => {
    repository.list.mockResolvedValue([]);
    repository.save.mockImplementation(async (_ownerKey, note) => note);
    repository.updateStatus.mockReset();
  });

  it('saves a general observation without creating a project task', async () => {
    const screen = render(
      <FieldNotesWorkspace
        ownerKey="owner-a"
        projects={['2321 Compliance Project']}
      />,
    );
    await waitFor(() => expect(repository.list).toHaveBeenCalledWith('owner-a'));
    await waitFor(() => expect(screen.getByText('No open field notes.')).toBeTruthy());
    expect(screen.queryByLabelText('Field note')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Type field note' }));

    await fireEvent.changeText(
      screen.getByLabelText('Field note'),
      'Call the contractor after the project walk.',
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Follow-up' }));
    await fireEvent.changeText(
      screen.getByLabelText('Possible field note next step'),
      'Call the contractor',
    );
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Save Field Note' }));
      await Promise.resolve();
    });

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(
      screen.getByText('Field note saved on this device. Vitruvius will send it to the desktop automatically.'),
    ).toBeTruthy());
    const [ownerKey, note] = repository.save.mock.calls[0];
    expect(ownerKey).toBe('owner-a');
    expect(note.projectName).toBeNull();
    expect(note.actionKind).toBe('follow_up');
    expect(note.originalText).toBe('Call the contractor after the project walk.');
  });

  it('starts a general voice note without requiring a project selection', async () => {
    const onRecordVoice = jest.fn();
    const screen = render(
      <FieldNotesWorkspace
        ownerKey="owner-a"
        projects={['2321 Compliance Project']}
        onRecordVoice={onRecordVoice}
      />,
    );

    await waitFor(() => expect(repository.list).toHaveBeenCalledWith('owner-a'));
    fireEvent.press(screen.getByRole('button', { name: 'Record field note' }));
    expect(onRecordVoice).toHaveBeenCalledWith(null);
    expect(screen.getByText('Field Notes inbox')).toBeTruthy();
  });

  it('loads a voice transcript into review instead of saving automatically', async () => {
    const screen = render(
      <FieldNotesWorkspace
        ownerKey="owner-a"
        projects={['2321 Compliance Project']}
        voiceDraft={{
          id: 'voice-1',
          text: 'The parking edge may need guardrails.',
          projectName: '2321 Compliance Project',
          locationName: 'North Lot',
        }}
      />,
    );

    await waitFor(() => expect(repository.list).toHaveBeenCalledWith('owner-a'));
    expect(screen.getByDisplayValue('The parking edge may need guardrails.')).toBeTruthy();
    expect(screen.getByDisplayValue('North Lot')).toBeTruthy();
    expect(repository.save).not.toHaveBeenCalled();
    expect(screen.getByText('Voice note is ready. Review it, then save.')).toBeTruthy();
  });

  it('uses the desktop as a synchronized recipient with conflict-safe editing', async () => {
    const cloudNote = markFieldNoteSynced(
      createFieldNote({
        id: 'desktop-note',
        text: 'The parking edge may need guardrails.',
        source: 'voice',
        locationName: 'North Lot',
        actionKind: 'safety_candidate',
        actionText: 'Review with the civil engineer',
        now: '2026-08-03T15:00:00.000Z',
      }),
      4,
      '2026-08-03T15:00:00.000Z',
    );
    const dataSource = {
      list: jest.fn(async () => [cloudNote]),
      save: jest.fn(),
      update: jest.fn(async (_ownerKey: string, note: typeof cloudNote) =>
        markFieldNoteSynced(note, note.revision + 1, note.updatedAt)),
    };
    const screen = render(
      <FieldNotesWorkspace
        ownerKey="owner-a"
        projects={['2321 Compliance Project']}
        projectRecords={[{ id: 'project-2321', name: '2321 Compliance Project' }]}
        dataSource={dataSource}
        presentation="desktop_inbox"
      />,
    );

    await waitFor(() => expect(screen.getByText('The parking edge may need guardrails.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Type field note' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Edit field note' }));
    fireEvent.changeText(
      screen.getByLabelText('Edit field note text'),
      'Guardrails are required at the exposed parking edge.',
    );
    fireEvent.press(screen.getByRole('radio', { name: '2321 Compliance Project' }));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Save field note changes' }));
      await Promise.resolve();
    });

    await waitFor(() => expect(dataSource.update).toHaveBeenCalledTimes(1));
    const [, edited] = dataSource.update.mock.calls[0];
    expect(edited.revision).toBe(4);
    expect(edited.projectId).toBe('project-2321');
    expect(edited.originalText).toBe('Guardrails are required at the exposed parking edge.');
  });
});
