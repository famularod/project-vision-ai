import { resolveFieldNoteVoiceContext } from '../../services/FieldNoteVoiceContext';

const PROJECT_A_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
const PROJECT_B_ID = '51a85b5e-35cf-4e90-a53d-b0f457952ba6';

describe('Field Note voice context', () => {
  const projects = [
    { id: PROJECT_A_ID, name: '2321 Compliance Project' },
    { id: PROJECT_B_ID, name: '2375 Compliance Project' },
  ];

  // Whole-app audit A11 pass 1 F10 (30 Sep 2026): a General note was described
  // to the voice service as the first project's note. The id stays only as the
  // access check the deployed service requires; the note is sent as general.
  it('authorizes general transcription without assigning or describing the note as a project', () => {
    expect(resolveFieldNoteVoiceContext(null, projects)).toEqual({
      projectId: PROJECT_A_ID,
      transcriptionProjectName: 'General field note',
      noteProjectName: null,
    });
  });

  it('preserves an explicitly selected project', () => {
    expect(resolveFieldNoteVoiceContext('2375 Compliance Project', projects)).toEqual({
      projectId: PROJECT_B_ID,
      transcriptionProjectName: '2375 Compliance Project',
      noteProjectName: '2375 Compliance Project',
    });
  });

  it('does not fabricate authorization when real project records are unavailable', () => {
    expect(resolveFieldNoteVoiceContext(null, [{ name: 'Still loading' }])).toBeNull();
  });
});
