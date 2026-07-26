import type { DAVECaptureMemory } from './DAVECaptureMemory';

export function buildMemoryConfirmation(memory: DAVECaptureMemory): string {
  const subject = memory.fields.peopleOrCompany || 'the team';
  const remembered = memory.fields.commitment || memory.fields.decision || memory.fields.ownerRequest || memory.fields.generalMemory;
  return remembered
    ? `I remember ${subject} ${sentenceFragment(remembered)} Is that right?`
    : 'Here is what I remember from that conversation. Is that right?';
}

export function buildAssignmentUncertainty(project: string | null, location: string | null): string {
  if (project && location) return `I think that belongs to ${project}, in ${location}. Is that right?`;
  if (project) return `I think that belongs to ${project}. Is that right?`;
  if (location) return `I think that was in ${location}. Which project should I use?`;
  return 'I am not sure which project or location this belongs to. Can you confirm them?';
}

export function buildCorrectionAcknowledgement(fieldLabel: string): string {
  return `Thanks. I’ll remember the corrected ${fieldLabel}.`;
}

export function buildRespectfulDisagreement(hasEvidence: boolean): string {
  return hasEvidence
    ? 'I remember it differently. Would you like to see what I’m basing that on?'
    : 'I may have that wrong. Let’s use your correction.';
}

export function buildSaveConfirmation(project: string): string {
  return `I saved that memory to ${project}.`;
}

export function buildFollowUpPrompt(followUp: string | null): string {
  return followUp ? `Would you like to review this follow-up: ${followUp}?` : 'Would you like to add a follow-up?';
}

export function buildInsufficientEvidence(fieldLabel: string): string {
  return `I don’t have enough evidence to confirm the ${fieldLabel}.`;
}

export function conversationLanguageUsesInternalTerminology(value: string): boolean {
  return /\b(extracted|classified|processing|operation completed|contractor commitment detected)\b/i.test(value);
}

function sentenceFragment(value: string): string {
  const text = value.trim().replace(/[.!?]+$/, '');
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}.`;
}
