export type DraftLocationCaptureIdentity = Readonly<{
  id: string;
  projectName: string;
}>;

export type DraftLocationCaptureTarget = Readonly<{
  draftId: string;
  projectName: string;
  generation: number;
}>;

export function createDraftLocationCaptureTarget(
  draft: DraftLocationCaptureIdentity,
  generation: number,
): DraftLocationCaptureTarget {
  return {
    draftId: draft.id,
    projectName: normalizeProjectName(draft.projectName),
    generation,
  };
}

export function isDraftLocationCaptureTargetCurrent(
  target: DraftLocationCaptureTarget,
  draft: DraftLocationCaptureIdentity,
  activeGeneration: number,
) {
  return (
    target.generation === activeGeneration &&
    target.draftId === draft.id &&
    target.projectName === normalizeProjectName(draft.projectName)
  );
}

function normalizeProjectName(value: string) {
  return value.trim().toLowerCase();
}
