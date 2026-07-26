import type { DAVEConfirmedCaptureMemory } from './DAVECaptureMemory';

export const DAVE_PROJECT_WALK_FIELD_UPDATE_VERSION =
  'dave-project-walk-field-update/1.0' as const;

export type DAVEProjectWalkFieldUpdateDraft = Readonly<{
  schemaVersion: typeof DAVE_PROJECT_WALK_FIELD_UPDATE_VERSION;
  projectName: string;
  sourceMemoryIds: readonly string[];
  recommendedAreaName: string | null;
  notes: string;
}>;

export function unusedConfirmedProjectWalkMemories({
  projectName,
  memories,
  usedMemoryIds,
}: {
  projectName: string;
  memories: readonly DAVEConfirmedCaptureMemory[];
  usedMemoryIds: readonly string[];
}) {
  const projectKey = key(projectName);
  const used = new Set(usedMemoryIds.filter(Boolean));

  return Object.freeze(
    memories
      .filter(memory =>
        memory.status === 'confirmed' &&
        Boolean(memory.confirmedAt) &&
        key(memory.recommendedProject.value || '') === projectKey &&
        memory.recommendedProject.confirmed &&
        !used.has(memory.id),
      )
      .sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ),
  );
}

export function buildDAVEProjectWalkFieldUpdateDraft({
  projectName,
  memories,
}: {
  projectName: string;
  memories: readonly DAVEConfirmedCaptureMemory[];
}): DAVEProjectWalkFieldUpdateDraft {
  const projectMemories = unusedConfirmedProjectWalkMemories({
    projectName,
    memories,
    usedMemoryIds: [],
  });
  if (projectMemories.length === 0) {
    throw new Error('At least one confirmed Project Walk memory is required.');
  }

  const confirmedAreaNames = uniqueText(
    projectMemories
      .filter(memory => memory.recommendedLocation.confirmed)
      .map(memory => memory.recommendedLocation.value || ''),
  );
  const recommendedAreaName = confirmedAreaNames.length === 1
    ? confirmedAreaNames[0]
    : null;
  const memorySections = projectMemories.map(memory => formatMemorySection(memory));
  const notes = [
    'Project Walk draft — review before sending',
    `Prepared from ${projectMemories.length} confirmed field ${projectMemories.length === 1 ? 'memory' : 'memories'}.`,
    recommendedAreaName ? `Confirmed area: ${recommendedAreaName}` : '',
    ...memorySections,
  ].filter(Boolean).join('\n\n');

  return deepFreeze({
    schemaVersion: DAVE_PROJECT_WALK_FIELD_UPDATE_VERSION,
    projectName: clean(projectName),
    sourceMemoryIds: projectMemories.map(memory => memory.id),
    recommendedAreaName,
    notes,
  });
}

function formatMemorySection(memory: DAVEConfirmedCaptureMemory) {
  const fields = memory.fields;
  const location = memory.recommendedLocation.confirmed
    ? clean(memory.recommendedLocation.value)
    : '';
  const lines = [
    location ? `Area: ${location}` : 'Area: Unassigned / Unknown Area',
    fieldLine('Person or company', fields.peopleOrCompany),
    fieldLine('Commitment', fields.commitment),
    fieldLine('Due date', fields.dueDate),
    fieldLine('Decision', fields.decision),
    fieldLine('Owner request', fields.ownerRequest),
    fieldLine('Inspection change', fields.inspectionChange),
    fieldLine('Schedule change', fields.scheduleChange),
    fieldLine('Issue', fields.issue),
    fieldLine('Risk', fields.risk),
    fieldLine('Follow-up', fields.followUp),
    fieldLine('General note', fields.generalMemory),
  ].filter(Boolean);

  if (lines.length === 1) {
    lines.push(`Field note: ${clean(memory.transcript)}`);
  }

  return lines.join('\n');
}

function fieldLine(label: string, value: string | null) {
  const text = clean(value);
  return text ? `${label}: ${text}` : '';
}

function uniqueText(values: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach(value => {
    const text = clean(value);
    const normalized = key(text);
    if (!text || !normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(text);
  });
  return result;
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function key(value: string) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object') return value;
  const objectValue = value as object;
  if (seen.has(objectValue)) return value;
  seen.add(objectValue);
  Object.values(objectValue).forEach(item => deepFreeze(item, seen));
  return Object.freeze(value);
}
