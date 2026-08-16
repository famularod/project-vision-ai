export type FieldNoteVoiceProjectRecord = Readonly<{
  id?: string | null;
  name: string;
}>;

export type FieldNoteVoiceContext = Readonly<{
  projectId: string;
  transcriptionProjectName: string;
  noteProjectName: string | null;
}>;

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
  return {
    projectId: authorizationProject.id.trim(),
    transcriptionProjectName: authorizationProject.name.trim(),
    noteProjectName: requested || null,
  };
}
