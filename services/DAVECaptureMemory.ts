export const DAVE_CAPTURE_MEMORY_VERSION = 'dave-capture-memory/1.0' as const;

export type DAVECaptureConfidence = 'high' | 'medium' | 'low' | 'unknown';
export type DAVECaptureMemoryStatus = 'draft' | 'confirmed' | 'cancelled';
export type DAVECaptureEvidenceKind = 'transcript' | 'project_record' | 'location_record' | 'pm_correction';

export type DAVECaptureEvidenceLink = Readonly<{
  id: string;
  kind: DAVECaptureEvidenceKind;
  sourceRecordId: string;
  summary: string;
}>;

export type DAVECaptureRecommendation = Readonly<{
  value: string | null;
  confidence: DAVECaptureConfidence;
  evidenceIds: readonly string[];
  confirmed: boolean;
}>;

export type DAVECaptureMemoryFields = Readonly<{
  peopleOrCompany: string | null;
  commitment: string | null;
  dueDate: string | null;
  decision: string | null;
  ownerRequest: string | null;
  inspectionChange: string | null;
  scheduleChange: string | null;
  issue: string | null;
  risk: string | null;
  followUp: string | null;
  generalMemory: string | null;
}>;

export type DAVECaptureCorrection = Readonly<{
  field: keyof DAVECaptureMemoryFields | 'project' | 'location';
  previousValue: string | null;
  correctedValue: string | null;
  correctedAt: string;
}>;

export type DAVECaptureMemory = Readonly<{
  schemaVersion: typeof DAVE_CAPTURE_MEMORY_VERSION;
  id: string;
  status: DAVECaptureMemoryStatus;
  transcript: string;
  transcriptEvidenceId: string;
  recommendedProject: DAVECaptureRecommendation;
  recommendedLocation: DAVECaptureRecommendation;
  fields: DAVECaptureMemoryFields;
  evidence: readonly DAVECaptureEvidenceLink[];
  corrections: readonly DAVECaptureCorrection[];
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
}>;

export type DAVEConfirmedCaptureMemory = DAVECaptureMemory & Readonly<{
  status: 'confirmed';
  confirmedAt: string;
  cancelledAt: null;
}>;

export type CreateCaptureMemoryInput = {
  id: string;
  transcript: string;
  transcriptSourceRecordId: string;
  createdAt: string;
  recommendedProject?: Partial<DAVECaptureRecommendation>;
  recommendedLocation?: Partial<DAVECaptureRecommendation>;
  fields?: Partial<DAVECaptureMemoryFields>;
  evidence?: DAVECaptureEvidenceLink[];
};

const EMPTY_FIELDS: DAVECaptureMemoryFields = Object.freeze({
  peopleOrCompany: null, commitment: null, dueDate: null, decision: null,
  ownerRequest: null, inspectionChange: null, scheduleChange: null, issue: null,
  risk: null, followUp: null, generalMemory: null,
});

export function createCaptureMemory(input: CreateCaptureMemoryInput): DAVECaptureMemory {
  const transcript = clean(input.transcript);
  if (!transcript) throw new Error('Transcript source is required.');
  const transcriptEvidenceId = `transcript:${clean(input.id)}`;
  const transcriptEvidence: DAVECaptureEvidenceLink = Object.freeze({
    id: transcriptEvidenceId,
    kind: 'transcript',
    sourceRecordId: clean(input.transcriptSourceRecordId),
    summary: 'Source transcript for this project memory.',
  });
  return freezeMemory({
    schemaVersion: DAVE_CAPTURE_MEMORY_VERSION,
    id: clean(input.id),
    status: 'draft',
    transcript,
    transcriptEvidenceId,
    recommendedProject: recommendation(input.recommendedProject),
    recommendedLocation: recommendation(input.recommendedLocation),
    fields: { ...EMPTY_FIELDS, ...normalizeFields(input.fields) },
    evidence: uniqueEvidence([transcriptEvidence, ...(input.evidence ?? [])]),
    corrections: [], createdAt: input.createdAt, confirmedAt: null, cancelledAt: null,
  });
}

export function confirmCaptureProject(memory: DAVECaptureMemory, value?: string): DAVECaptureMemory {
  assertDraft(memory);
  const selected = clean(value ?? memory.recommendedProject.value);
  if (!selected) throw new Error('Project confirmation is required.');
  return replace(memory, { recommendedProject: Object.freeze({ ...memory.recommendedProject, value: selected, confirmed: true }) });
}

export function confirmCaptureLocation(memory: DAVECaptureMemory, value?: string): DAVECaptureMemory {
  assertDraft(memory);
  const selected = clean(value ?? memory.recommendedLocation.value);
  if (!selected) throw new Error('Location confirmation is required.');
  return replace(memory, { recommendedLocation: Object.freeze({ ...memory.recommendedLocation, value: selected, confirmed: true }) });
}

export function correctCaptureMemory(
  memory: DAVECaptureMemory,
  field: DAVECaptureCorrection['field'],
  correctedValue: string | null,
  correctedAt: string,
): DAVECaptureMemory {
  assertDraft(memory);
  const value = optional(correctedValue);
  const previousValue = field === 'project'
    ? memory.recommendedProject.value
    : field === 'location'
      ? memory.recommendedLocation.value
      : memory.fields[field];
  const correction = Object.freeze({ field, previousValue, correctedValue: value, correctedAt });
  const evidence = uniqueEvidence([...memory.evidence, Object.freeze({
    id: `correction:${memory.id}:${memory.corrections.length + 1}`,
    kind: 'pm_correction' as const,
    sourceRecordId: memory.id,
    summary: `PM corrected ${field}.`,
  })]);
  if (field === 'project') return replace(memory, {
    recommendedProject: Object.freeze({ ...memory.recommendedProject, value, confirmed: Boolean(value), confidence: 'high' }),
    corrections: [...memory.corrections, correction], evidence,
  });
  if (field === 'location') return replace(memory, {
    recommendedLocation: Object.freeze({ ...memory.recommendedLocation, value, confirmed: Boolean(value), confidence: 'high' }),
    corrections: [...memory.corrections, correction], evidence,
  });
  return replace(memory, {
    fields: { ...memory.fields, [field]: value },
    corrections: [...memory.corrections, correction], evidence,
  });
}

export function confirmCaptureMemory(memory: DAVECaptureMemory, confirmedAt: string): DAVECaptureMemory {
  assertDraft(memory);
  if (!memory.recommendedProject.confirmed) throw new Error('Project confirmation is required.');
  if (memory.recommendedLocation.value && !memory.recommendedLocation.confirmed) {
    throw new Error('Location confirmation is required.');
  }
  return replace(memory, { status: 'confirmed', confirmedAt });
}

export function cancelCaptureMemory(memory: DAVECaptureMemory, cancelledAt: string): DAVECaptureMemory {
  assertDraft(memory);
  return replace(memory, { status: 'cancelled', cancelledAt });
}

export function confirmedCaptureMemoryForSave(memory: DAVECaptureMemory): DAVEConfirmedCaptureMemory | null {
  return isConfirmedCaptureMemory(memory) ? memory : null;
}

export function isConfirmedCaptureMemory(memory: DAVECaptureMemory): memory is DAVEConfirmedCaptureMemory {
  return memory.status === 'confirmed' && Boolean(memory.confirmedAt) && memory.cancelledAt === null;
}

function recommendation(value?: Partial<DAVECaptureRecommendation>): DAVECaptureRecommendation {
  return Object.freeze({
    value: optional(value?.value),
    confidence: validConfidence(value?.confidence),
    evidenceIds: Object.freeze([...(value?.evidenceIds ?? [])].filter(item => typeof item === 'string')),
    confirmed: Boolean(value?.confirmed && optional(value?.value)),
  });
}

function normalizeFields(value?: Partial<DAVECaptureMemoryFields>): Partial<DAVECaptureMemoryFields> {
  if (!value) return {};
  return Object.fromEntries(Object.keys(EMPTY_FIELDS).map(key => [key, optional(value[key as keyof DAVECaptureMemoryFields])])) as Partial<DAVECaptureMemoryFields>;
}

function replace(memory: DAVECaptureMemory, patch: Partial<DAVECaptureMemory>): DAVECaptureMemory {
  return freezeMemory({ ...memory, ...patch });
}

function freezeMemory(memory: DAVECaptureMemory): DAVECaptureMemory {
  Object.freeze(memory.fields); Object.freeze(memory.evidence); Object.freeze(memory.corrections);
  return Object.freeze(memory);
}

function uniqueEvidence(items: DAVECaptureEvidenceLink[]): readonly DAVECaptureEvidenceLink[] {
  const seen = new Set<string>();
  return Object.freeze(items.filter(item => Boolean(item.id) && !seen.has(item.id) && Boolean(seen.add(item.id))));
}

function assertDraft(memory: DAVECaptureMemory) {
  if (memory.status !== 'draft') throw new Error('Only an unconfirmed memory can be changed.');
}

function validConfidence(value: unknown): DAVECaptureConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'unknown';
}

function optional(value: unknown): string | null { return clean(value) || null; }
function clean(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
