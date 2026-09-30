export type FieldNoteVoiceProjectRecord = Readonly<{
  id?: string | null;
  name: string;
}>;

export type FieldNoteVoiceContext = Readonly<{
  projectId: string;
  transcriptionProjectName: string;
  noteProjectName: string | null;
}>;

/** What a General note is described as to the voice service (audit A11 pass 1 F10). */
export const GENERAL_FIELD_NOTE_TRANSCRIPTION_LABEL = 'General field note';

const PROJECT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveFieldNoteVoiceContext(
  noteProjectName: string | null,
  projectRecords: readonly FieldNoteVoiceProjectRecord[],
): FieldNoteVoiceContext | null {
  const requested = noteProjectName?.trim() || '';
  const usableProjects = projectRecords.filter(project =>
    PROJECT_UUID_PATTERN.test(project.id?.trim() || ''),
  );
  const authorizationProject = requested
    ? usableProjects.find(project => project.name.trim().toLowerCase() === requested.toLowerCase())
    : usableProjects[0];
  if (!authorizationProject?.id?.trim()) return null;
  // A General note went out described as the first project's note. The voice
  // service and its usage ledger still require one owned project id (they
  // reject a request without one), so that id is only the access check; the
  // note itself is described as general (whole-app audit A11 pass 1 F10).
  return {
    projectId: authorizationProject.id.trim(),
    transcriptionProjectName: requested
      ? authorizationProject.name.trim()
      : GENERAL_FIELD_NOTE_TRANSCRIPTION_LABEL,
    noteProjectName: requested || null,
  };
}
