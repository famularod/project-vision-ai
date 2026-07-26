import type { DAVEConfirmedCaptureMemory } from './DAVECaptureMemory';
import {
  DEFAULT_PROJECT_TIME_ZONE,
  plainDateDueState,
  type ProjectTimeZone,
} from './ProjectDateTime';

export type DAVECommitmentStatus = 'Open' | 'Completed' | 'Overdue';
export type DAVECommitmentEvidenceType = 'update' | 'photo' | 'document' | 'memory' | 'transcript';

export type DAVECommitmentEvidenceLink = {
  type: DAVECommitmentEvidenceType;
  recordId: string;
};

export type DAVEProjectCommitment = {
  id: string;
  projectId: string;
  owner: string;
  description: string;
  dueDate: string | null;
  status: DAVECommitmentStatus;
  linkedEvidence: DAVECommitmentEvidenceLink[];
  recommendedFollowUpAction: string;
  sourceUpdateId: string;
  sourcePhotoId: string;
  sourceMemoryId?: string;
  priority: number;
};

export type DAVECommitmentPhotoInput = {
  id: string;
  category: string;
  actionRequired?: string;
  actionOwner?: string;
  actionDueDate?: string;
  actionStatus?: string;
};

export type DAVECommitmentUpdateInput = {
  id: string;
  projectName: string;
  photos: DAVECommitmentPhotoInput[];
};

export type DAVECommitmentDocumentInput = {
  id: string;
  projectId?: string;
  updateId?: string | null;
  isArchived?: boolean;
};

export type BuildProjectCommitmentsInput = {
  projectId: string;
  projectName: string;
  updates: DAVECommitmentUpdateInput[];
  documents?: DAVECommitmentDocumentInput[];
  captureMemories?: readonly DAVEConfirmedCaptureMemory[];
  now?: string;
  projectTimeZone?: ProjectTimeZone | string;
};

export type BuildProjectCommitmentsFromRealityInput = {
  reality: import('./DAVEProjectReality').DAVEProjectReality;
};

export function buildProjectCommitments(
  input: BuildProjectCommitmentsInput | BuildProjectCommitmentsFromRealityInput,
): DAVEProjectCommitment[] {
  if ('reality' in input) return input.reality.commitments;
  const now = validDate(input.now) ?? new Date();
  const projectTimeZone = input.projectTimeZone ?? DEFAULT_PROJECT_TIME_ZONE;
  const projectKey = normalizeKey(input.projectName);
  const documents = (input.documents ?? []).filter(document =>
    !document.isArchived && (!document.projectId || document.projectId === input.projectId),
  );
  const commitments: DAVEProjectCommitment[] = [];

  for (const update of input.updates) {
    if (normalizeKey(update.projectName) !== projectKey) continue;
    for (const photo of update.photos) {
      const description = clean(photo.actionRequired);
      const owner = clean(photo.actionOwner);
      const dueDate = validDateOnly(photo.actionDueDate);
      if (!description && !owner && !dueDate) continue;

      const status = commitmentStatus(photo.actionStatus, dueDate, now, projectTimeZone);
      const linkedEvidence: DAVECommitmentEvidenceLink[] = [
        { type: 'update', recordId: update.id },
        { type: 'photo', recordId: photo.id },
        ...documents
          .filter(document => document.updateId === update.id)
          .map(document => ({ type: 'document' as const, recordId: document.id })),
      ];
      commitments.push({
        id: stableCommitmentId(input.projectId, update.id, photo.id),
        projectId: input.projectId,
        owner: owner || 'Unassigned',
        description: description || 'Recorded follow-up requires clarification.',
        dueDate,
        status,
        linkedEvidence: uniqueEvidence(linkedEvidence),
        recommendedFollowUpAction: followUpAction(status, owner),
        sourceUpdateId: update.id,
        sourcePhotoId: photo.id,
        priority: commitmentPriority(photo.category, status, dueDate),
      });
    }
  }

  commitments.push(...projectCaptureMemoriesToCommitments(
    input.projectId,
    input.captureMemories ?? [],
    input.now,
    input.projectName,
    projectTimeZone,
  ));

  return uniqueById(commitments).sort((a, b) =>
    a.priority - b.priority || compareDueDates(a.dueDate, b.dueDate) || a.id.localeCompare(b.id),
  );
}

export function projectCaptureMemoriesToCommitments(
  projectId: string,
  memories: readonly DAVEConfirmedCaptureMemory[],
  now?: string,
  projectName?: string,
  projectTimeZone: ProjectTimeZone | string = DEFAULT_PROJECT_TIME_ZONE,
): DAVEProjectCommitment[] {
  const evaluatedAt = validDate(now) ?? new Date();
  return memories
    .filter(memory => {
      const selectedProject = normalizeKey(memory.recommendedProject.value ?? '');
      return Boolean(clean(memory.fields.commitment)) && (
        selectedProject === normalizeKey(projectId) ||
        Boolean(projectName && selectedProject === normalizeKey(projectName))
      );
    })
    .map(memory => {
      const dueDate = validDateOnly(memory.fields.dueDate);
      const status: DAVECommitmentStatus = dueDate &&
        plainDateDueState(dueDate, evaluatedAt, projectTimeZone) === 'overdue'
        ? 'Overdue'
        : 'Open';
      const owner = clean(memory.fields.peopleOrCompany) || 'Unassigned';
      return {
        id: ['commitment', projectId, 'memory', memory.id, 'confirmed-commitment']
          .map(part => encodeURIComponent(part.trim() || 'unknown'))
          .join(':'),
        projectId,
        owner,
        description: clean(memory.fields.commitment),
        dueDate,
        status,
        linkedEvidence: uniqueEvidence([
          { type: 'memory', recordId: memory.id },
          { type: 'transcript', recordId: memory.transcriptEvidenceId },
        ]),
        recommendedFollowUpAction: followUpAction(status, owner === 'Unassigned' ? '' : owner),
        sourceUpdateId: '',
        sourcePhotoId: '',
        sourceMemoryId: memory.id,
        priority: commitmentPriority('', status, dueDate),
      };
    });
}

function commitmentStatus(
  actionStatus: string | undefined,
  dueDate: string | null,
  now: Date,
  projectTimeZone: ProjectTimeZone | string,
): DAVECommitmentStatus {
  if (actionStatus === 'Closed') return 'Completed';
  if (dueDate && plainDateDueState(dueDate, now, projectTimeZone) === 'overdue') return 'Overdue';
  return 'Open';
}

function followUpAction(status: DAVECommitmentStatus, owner: string): string {
  if (status === 'Completed') return 'Review the linked record if closure needs confirmation.';
  if (status === 'Overdue') {
    return owner ? `Confirm status with ${owner}.` : 'Assign an owner and confirm the current status.';
  }
  return owner ? `Confirm the next step with ${owner}.` : 'Assign an owner for the recorded follow-up.';
}

function commitmentPriority(category: string, status: DAVECommitmentStatus, dueDate: string | null): number {
  if (status === 'Completed') return 100;
  if (category === 'Safety Concern') return 0;
  if (status === 'Overdue') return dueDate ? 2 : 3;
  return 6;
}

function stableCommitmentId(projectId: string, updateId: string, photoId: string): string {
  return ['commitment', projectId, updateId, photoId, 'recorded-action']
    .map(part => encodeURIComponent(part.trim() || 'unknown'))
    .join(':');
}

function uniqueById(items: DAVEProjectCommitment[]): DAVEProjectCommitment[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function uniqueEvidence(items: DAVECommitmentEvidenceLink[]): DAVECommitmentEvidenceLink[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.type}:${item.recordId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareDueDates(a: string | null, b: string | null): number {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validDateOnly(value: string | null | undefined): string | null {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : null;
}

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
