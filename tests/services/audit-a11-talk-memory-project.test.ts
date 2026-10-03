import { confirmCaptureMemory } from '../../services/DAVECaptureMemory';
import {
  buildDAVETalkMemoryDraft,
  mentionedDAVEProject,
} from '../../services/DAVEConversationRouter';
import type { DAVEVoiceUnderstandingResponse } from '../../services/DAVEVoiceUnderstanding';

// Whole-app audit A11 pass 1 F6 (30 Sep 2026): a number said in Talk
// ("gate code 2321") moved the note to the project with that number, and the
// draft still came out with that project confirmed at high confidence and the
// location heard against the first project's areas. Typed Talk saved it under
// the other project in one tap. Synthetic project data only.

const PROJECTS = ['2321 Compliance Project', '2375 Compliance Project'];

function voiceResult(transcript: string): DAVEVoiceUnderstandingResponse {
  return {
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
}

function draftFor(transcript: string, currentProject: string, voice: boolean) {
  const projectName = mentionedDAVEProject(transcript, PROJECTS) || currentProject;
  return buildDAVETalkMemoryDraft({
    id: 'talk-memory-1',
    createdAt: '2026-09-30T12:00:00.000Z',
    projectName,
    switchedProject: projectName !== currentProject,
    transcript,
    fields: { generalMemory: transcript },
    voiceResult: voice ? voiceResult(transcript) : undefined,
  });
}

describe('audit A11 pass 1 F6: a Talk note moved to another project by a number', () => {
  it.each([true, false])('is not pre-confirmed and carries no location (voice: %s)', voice => {
    const draft = draftFor('The gate code is 2375, tell the crew', '2321 Compliance Project', voice);
    expect(draft.recommendedProject).toMatchObject({
      value: '2375 Compliance Project',
      confirmed: false,
      confidence: 'medium',
    });
    expect(draft.recommendedLocation.value).toBeNull();
    expect(draft.recommendedLocation.confirmed).toBe(false);
    expect(() => confirmCaptureMemory(draft, '2026-09-30T12:01:00.000Z')).toThrow('Project confirmation is required.');
  });

  it('stays confirmed with its location when it stays on the current project', () => {
    const draft = draftFor('The gate code is 2321, tell the crew', '2321 Compliance Project', true);
    expect(draft.recommendedProject).toMatchObject({
      value: '2321 Compliance Project',
      confirmed: true,
      confidence: 'high',
    });
    expect(draft.recommendedLocation).toMatchObject({ value: 'Level 2 corridor', confidence: 'high', confirmed: false });
    expect(draft.evidence.some(item => item.sourceRecordId === 'voice-transcription:talk-memory-1')).toBe(true);
  });

  it('a typed note on the current project is ready to save', () => {
    const draft = draftFor('Drywall crew will finish level two on Friday', '2321 Compliance Project', false);
    expect(draft.recommendedProject.confirmed).toBe(true);
    expect(draft.evidence.some(item => item.sourceRecordId === 'typed-entry:talk-memory-1')).toBe(true);
    expect(confirmCaptureMemory(draft, '2026-09-30T12:01:00.000Z').status).toBe('confirmed');
  });

  it('a quantity does not move the note at all', () => {
    const draft = draftFor('Ordered 2375 feet of conduit', '2321 Compliance Project', true);
    expect(draft.recommendedProject).toMatchObject({ value: '2321 Compliance Project', confirmed: true });
    expect(draft.recommendedLocation.value).toBe('Level 2 corridor');
  });
});
