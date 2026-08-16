import type { DAVECaptureConfidence, DAVECaptureMemoryFields } from './DAVECaptureMemory';

export const DAVE_VOICE_UNDERSTANDING_SCHEMA_VERSION = 'dave-voice-understanding/1.0' as const;

export type DAVEVoiceUnderstanding = Readonly<{
  status: 'succeeded' | 'unavailable';
  model: string | null;
  recommendedLocation: Readonly<{
    value: string | null;
    confidence: DAVECaptureConfidence;
  }>;
  fields: DAVECaptureMemoryFields;
}>;

export type DAVEVoiceUnderstandingResponse = Readonly<{
  schemaVersion: typeof DAVE_VOICE_UNDERSTANDING_SCHEMA_VERSION;
  transcript: string;
  transcriptionModel: string;
  understanding: DAVEVoiceUnderstanding;
}>;

const FIELD_NAMES: ReadonlyArray<keyof DAVECaptureMemoryFields> = [
  'peopleOrCompany',
  'commitment',
  'dueDate',
  'decision',
  'ownerRequest',
  'inspectionChange',
  'scheduleChange',
  'issue',
  'risk',
  'followUp',
  'generalMemory',
];

export function parseDAVEVoiceUnderstandingResponse(
  value: unknown,
  candidateLocations: readonly string[],
): DAVEVoiceUnderstandingResponse {
  if (!isRecord(value) || value.schemaVersion !== DAVE_VOICE_UNDERSTANDING_SCHEMA_VERSION) {
    throw malformedResponse();
  }

  const transcript = requiredString(value.transcript);
  const transcriptionModel = requiredString(value.transcriptionModel);
  const understanding = value.understanding;
  if (!transcript || !transcriptionModel || !isRecord(understanding)) throw malformedResponse();

  const status = understanding.status;
  if (status !== 'succeeded' && status !== 'unavailable') throw malformedResponse();
  const model = optionalString(understanding.model);
  if ((status === 'succeeded' && !model) || (status === 'unavailable' && model)) {
    throw malformedResponse();
  }

  const recommendation = understanding.recommendedLocation;
  if (!isRecord(recommendation)) throw malformedResponse();
  const location = optionalString(recommendation.value);
  const allowedLocations = new Set(candidateLocations.map(item => item.trim()).filter(Boolean));
  const safeLocation = location && allowedLocations.has(location) ? location : null;

  const fields = parseFields(understanding.fields);
  return Object.freeze({
    schemaVersion: DAVE_VOICE_UNDERSTANDING_SCHEMA_VERSION,
    transcript,
    transcriptionModel,
    understanding: Object.freeze({
      status,
      model,
      recommendedLocation: Object.freeze({
        value: safeLocation,
        confidence: safeLocation ? confidence(recommendation.confidence) : 'unknown',
      }),
      fields: Object.freeze(fields),
    }),
  });
}

function parseFields(value: unknown): DAVECaptureMemoryFields {
  if (!isRecord(value)) throw malformedResponse();
  const entries = FIELD_NAMES.map(field => {
    const fieldValue = value[field];
    if (fieldValue !== null && typeof fieldValue !== 'string') throw malformedResponse();
    return [field, optionalString(fieldValue)] as const;
  });
  return Object.fromEntries(entries) as DAVECaptureMemoryFields;
}

function confidence(value: unknown): DAVECaptureConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalString(value: unknown): string | null {
  return requiredString(value) || null;
}

function malformedResponse() {
  return new Error('The memory review was incomplete. You can retry or type it instead.');
}
