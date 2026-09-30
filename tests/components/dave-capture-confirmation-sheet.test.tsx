import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { DAVECaptureConfirmationSheet } from '../../components/DAVECaptureConfirmationSheet';
import { buildDAVETalkMemoryDraft } from '../../services/DAVEConversationRouter';
import type { DAVEVoiceUnderstandingResponse } from '../../services/DAVEVoiceUnderstanding';

// Whole-app audit A11 pass 1 F6 (30 Sep 2026): a Talk note moved to another
// project must wait for the manager to confirm that project, and a location
// left over from the first project must be clearable. Synthetic data only.

const transcript = 'The gate code is 2375, tell the crew';
const voiceResult: DAVEVoiceUnderstandingResponse = {
  schemaVersion: 'dave-voice-understanding/1.0',
  transcript,
  transcriptionModel: 'test-transcription',
  understanding: {
    status: 'succeeded',
    model: 'test-understanding',
    recommendedLocation: { value: 'Level 2 corridor', confidence: 'high' },
    fields: {
      peopleOrCompany: null, commitment: null, dueDate: null, decision: null,
      ownerRequest: null, inspectionChange: null, scheduleChange: null, issue: null,
      risk: null, followUp: null, generalMemory: transcript,
    },
  },
};

function draft(switchedProject: boolean) {
  return buildDAVETalkMemoryDraft({
    id: 'talk-memory-1',
    createdAt: '2026-09-30T12:00:00.000Z',
    projectName: switchedProject ? '2375 Compliance Project' : '2321 Compliance Project',
    switchedProject,
    transcript,
    fields: { generalMemory: transcript },
    voiceResult,
  });
}

function renderSheet(switchedProject: boolean) {
  const onSave = jest.fn();
  const screen = render(
    <DAVECaptureConfirmationSheet
      visible
      transcript={transcript}
      draft={draft(switchedProject)}
      projects={['2321 Compliance Project', '2375 Compliance Project']}
      locations={['Level 2 corridor', 'Roof']}
      onSave={onSave}
      onCancel={() => undefined}
    />,
  );
  return { ...screen, onSave };
}

describe('DAVECaptureConfirmationSheet', () => {
  it('blocks Save on a moved note until the manager confirms the project', async () => {
    const screen = renderSheet(true);
    expect(screen.queryByText('No location')).toBeNull();

    fireEvent.press(screen.getByLabelText('Save confirmed memory'));
    expect(await screen.findByText('Project confirmation is required.')).toBeTruthy();
    expect(screen.onSave).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Confirm 2375 Compliance Project'));
    fireEvent.press(screen.getByLabelText('Save confirmed memory'));
    await waitFor(() => expect(screen.onSave).toHaveBeenCalledTimes(1));
    const saved = screen.onSave.mock.calls[0][0];
    expect(saved.recommendedProject).toMatchObject({ value: '2375 Compliance Project', confirmed: true });
    expect(saved.recommendedLocation.value).toBeNull();
  });

  it('clears an unconfirmed location with No location so the memory can be saved', async () => {
    const screen = renderSheet(false);

    fireEvent.press(screen.getByLabelText('Save confirmed memory'));
    expect(await screen.findByText('Location confirmation is required.')).toBeTruthy();
    expect(screen.onSave).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('No location'));
    expect(screen.getByText('No location recommended')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Save confirmed memory'));
    await waitFor(() => expect(screen.onSave).toHaveBeenCalledTimes(1));
    const saved = screen.onSave.mock.calls[0][0];
    expect(saved.recommendedProject).toMatchObject({ value: '2321 Compliance Project', confirmed: true });
    expect(saved.recommendedLocation.value).toBeNull();
  });
});
