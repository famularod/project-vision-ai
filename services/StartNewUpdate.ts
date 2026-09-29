// "Start New" from the capture flow. When it replaces an unfinished draft, the
// discarded draft's stored photo files are deleted only after the draft itself
// has been replaced. Without a confident project the flow opens the project
// picker, so the draft is replaced with a blank one first: leaving the picker
// without choosing must not leave the old draft in place pointing at files that
// are gone.

export type StartNewUpdateSteps<Draft> = Readonly<{
  // The project the new update belongs to, or null when the PM must pick one.
  target: string | null;
  // The unfinished draft being replaced, or null when the draft has no content.
  discardedDraft: Draft | null;
  beginDraftForProject: (projectName: string) => void;
  replaceDraftWithBlank: () => void;
  openProjectPicker: () => void;
  deleteDiscardedPhotos: (discardedDraft: Draft) => Promise<unknown> | void;
}>;

export function startNewUpdate<Draft>(steps: StartNewUpdateSteps<Draft>): void {
  if (steps.target) {
    steps.beginDraftForProject(steps.target);
  } else {
    if (steps.discardedDraft) steps.replaceDraftWithBlank();
    steps.openProjectPicker();
  }

  if (steps.discardedDraft) void steps.deleteDiscardedPhotos(steps.discardedDraft);
}
