import {
  PROJECT_ITEM_TYPES,
  type ProjectItemType,
  type SchedulePriority,
  type ScheduleStatus,
} from '../types';
import { reconcileScheduleProgressEdit } from './ScheduleProgressInvariant';

export const DAVE_TASK_FILL_SCHEMA_VERSION = 'dave-task-fill-understanding/1.0' as const;

export type DAVETaskStatus = ScheduleStatus;
export type DAVETaskPriority = SchedulePriority;
export type DAVETaskFillMode = 'create' | 'update';

export type DAVETaskFillFieldName =
  | 'taskName'
  | 'itemType'
  | 'projectName'
  | 'locationName'
  | 'startDate'
  | 'finishDate'
  | 'milestone'
  | 'owner'
  | 'contractor'
  | 'percentComplete'
  | 'status'
  | 'priority'
  | 'notes'
  | 'nextAction';

export interface DAVETaskFillField<T> {
  value: T | null;
  sourceText: string | null;
  confidence: number;
  needsConfirmation: boolean;
  candidates: T[];
}

export interface DAVETaskFillFields {
  taskName: DAVETaskFillField<string>;
  itemType: DAVETaskFillField<ProjectItemType>;
  projectName: DAVETaskFillField<string>;
  locationName: DAVETaskFillField<string>;
  startDate: DAVETaskFillField<string>;
  finishDate: DAVETaskFillField<string>;
  milestone: DAVETaskFillField<string>;
  owner: DAVETaskFillField<string>;
  contractor: DAVETaskFillField<string>;
  percentComplete: DAVETaskFillField<number>;
  status: DAVETaskFillField<DAVETaskStatus>;
  priority: DAVETaskFillField<DAVETaskPriority>;
  notes: DAVETaskFillField<string>;
  nextAction: DAVETaskFillField<string>;
}

export interface DAVETaskFillTaskCandidate {
  id: string;
  taskName: string;
  projectName: string;
  locationName: string;
  status: DAVETaskStatus;
  percentComplete: number;
}

export type DAVETaskFillGapKind =
  | 'required'
  | 'ambiguous'
  | 'low_confidence'
  | 'unclear_date'
  | 'duplicate_task'
  | 'no_changes';

export interface DAVETaskFillGap {
  field: DAVETaskFillFieldName | 'taskMatch' | 'instruction';
  kind: DAVETaskFillGapKind;
  message: string;
  blocking: boolean;
  candidates: string[];
}

export interface DAVETaskFillUnderstanding {
  schemaVersion: typeof DAVE_TASK_FILL_SCHEMA_VERSION;
  transcript: string;
  fields: DAVETaskFillFields;
  taskMatches: DAVETaskFillTaskCandidate[];
  warnings: string[];
  gaps: DAVETaskFillGap[];
}

export interface DAVETaskFillValues {
  taskName: string;
  itemType: ProjectItemType;
  projectName: string;
  locationName: string;
  startDate: string;
  finishDate: string;
  milestone: string;
  owner: string;
  contractor: string;
  percentComplete: number;
  status: DAVETaskStatus;
  priority: DAVETaskPriority;
  notes: string;
  nextAction: string;
}

export type DAVETaskFillPatch = Partial<DAVETaskFillValues>;

export interface DAVETaskFillContext {
  mode?: DAVETaskFillMode;
  projectNames?: readonly string[];
  locationNames?: readonly string[];
  ownerNames?: readonly string[];
  contractorNames?: readonly string[];
  taskCandidates?: readonly DAVETaskFillTaskCandidate[];
  currentValues?: Partial<DAVETaskFillValues>;
  now?: Date;
}

const EMPTY_CONFIDENCE = 0;
const DIRECT_CONFIDENCE = 0.96;
const INFERRED_CONFIDENCE = 0.88;
const LOW_CONFIDENCE = 0.72;
const CONFIRMATION_THRESHOLD = 0.85;

const FIELD_BOUNDARY_LABELS = [
  'task name',
  'task',
  'title',
  'project item type',
  'item type',
  'type',
  'project',
  'area',
  'location',
  'owner',
  'assigned to',
  'contractor',
  'trade',
  'company',
  'start date',
  'start',
  'finish date',
  'finish',
  'due date',
  'due',
  'milestone',
  'percent complete',
  'percentage',
  'percent',
  'progress',
  'status',
  'priority',
  'note',
  'notes',
  'next action',
] as const;

const FIELD_LABELS_PATTERN = FIELD_BOUNDARY_LABELS
  .slice()
  .sort((left, right) => right.length - left.length)
  .map(label => label === 'progress'
    ? `${escapeRegExp(label)}(?=\\s*(?:is|to|:|=)?\\s*\\d)`
    : escapeRegExp(label))
  .join('|');

function emptyField<T>(): DAVETaskFillField<T> {
  return {
    value: null,
    sourceText: null,
    confidence: EMPTY_CONFIDENCE,
    needsConfirmation: false,
    candidates: [],
  };
}

function populatedField<T>(
  value: T,
  sourceText: string,
  confidence = DIRECT_CONFIDENCE,
  candidates: T[] = [],
): DAVETaskFillField<T> {
  return {
    value,
    sourceText,
    confidence,
    needsConfirmation: confidence < CONFIRMATION_THRESHOLD || candidates.length > 1,
    candidates,
  };
}

function ambiguousField<T>(sourceText: string, candidates: T[]): DAVETaskFillField<T> {
  return {
    value: null,
    sourceText,
    confidence: 0.62,
    needsConfirmation: true,
    candidates,
  };
}

export function createEmptyDAVETaskFillFields(): DAVETaskFillFields {
  return {
    taskName: emptyField(),
    itemType: emptyField(),
    projectName: emptyField(),
    locationName: emptyField(),
    startDate: emptyField(),
    finishDate: emptyField(),
    milestone: emptyField(),
    owner: emptyField(),
    contractor: emptyField(),
    percentComplete: emptyField(),
    status: emptyField(),
    priority: emptyField(),
    notes: emptyField(),
    nextAction: emptyField(),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizedMatchText(value: string): string {
  return normalizeSpace(value)
    .toLocaleLowerCase()
    .replace(/[“”'".,;:!?()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueOptions(values: readonly string[] = []): string[] {
  const seen = new Set<string>();
  return values.map(normalizeSpace).filter(value => {
    if (!value) return false;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function containsPhrase(source: string, candidate: string): boolean {
  const normalizedSource = normalizedMatchText(source);
  const normalizedCandidate = normalizedMatchText(candidate);
  if (!normalizedSource || !normalizedCandidate) return false;
  return new RegExp(`(?:^|\\s)${escapeRegExp(normalizedCandidate)}(?:$|\\s)`, 'i')
    .test(normalizedSource);
}

function candidateMatchesSource(source: string, candidate: string): boolean {
  const normalizedSource = normalizedMatchText(source);
  const normalizedCandidate = normalizedMatchText(candidate);
  if (!normalizedSource || !normalizedCandidate) return false;
  return normalizedSource === normalizedCandidate ||
    normalizedSource.includes(normalizedCandidate) ||
    (normalizedSource.length >= 3 && normalizedCandidate.includes(normalizedSource));
}

function matchCandidate(
  transcript: string,
  candidates: readonly string[] = [],
  labeledSource: string | null = null,
  allowUnlabeledMatch = true,
): DAVETaskFillField<string> {
  const options = uniqueOptions(candidates);
  const sourceMatches = labeledSource
    ? options.filter(candidate => candidateMatchesSource(labeledSource, candidate))
    : [];
  if (sourceMatches.length === 1) {
    return populatedField(sourceMatches[0], labeledSource || sourceMatches[0]);
  }
  if (sourceMatches.length > 1) {
    return ambiguousField(labeledSource || sourceMatches.join(', '), sourceMatches);
  }

  const transcriptMatches = allowUnlabeledMatch
    ? options.filter(candidate => containsPhrase(transcript, candidate))
    : [];
  if (transcriptMatches.length === 1) {
    return populatedField(transcriptMatches[0], transcriptMatches[0]);
  }
  if (transcriptMatches.length > 1) {
    return ambiguousField(transcriptMatches.join(', '), transcriptMatches);
  }
  if (labeledSource) {
    return populatedField(labeledSource, labeledSource, LOW_CONFIDENCE);
  }
  return emptyField();
}

function formatISODate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validCalendarDate(year: number, month: number, day: number): Date | null {
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  return parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
    ? parsed
    : null;
}

function resolveDatePhrase(source: string, now: Date): string | null {
  const normalized = source.toLocaleLowerCase();
  const resolved = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  if (/\btoday\b/.test(normalized)) return formatISODate(resolved);
  if (/\btomorrow\b/.test(normalized)) {
    resolved.setDate(resolved.getDate() + 1);
    return formatISODate(resolved);
  }
  const relativeDays = normalized.match(/\bin\s+(\d{1,3})\s+days?\b/);
  if (relativeDays) {
    resolved.setDate(resolved.getDate() + Number(relativeDays[1]));
    return formatISODate(resolved);
  }
  const slashDate = source.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (slashDate) {
    const year = Number(slashDate[3]) < 100 ? 2000 + Number(slashDate[3]) : Number(slashDate[3]);
    const parsed = validCalendarDate(year, Number(slashDate[1]), Number(slashDate[2]));
    return parsed ? formatISODate(parsed) : null;
  }
  const isoDate = source.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoDate) {
    const parsed = validCalendarDate(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
    return parsed ? formatISODate(parsed) : null;
  }
  return null;
}

function extractLabeledText(transcript: string, labels: readonly string[]): string | null {
  const labelPattern = labels
    .slice()
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join('|');
  const boundary = `(?=\\s*(?:[,;.]\\s*)?(?:${FIELD_LABELS_PATTERN})\\s*(?:is|to|:|=|named|called)?\\s*|$)`;
  const match = transcript.match(new RegExp(
    `(?:^|\\b)(?:${labelPattern})\\s*(?:is|to|:|=|named|called)?\\s*(.+?)${boundary}`,
    'i',
  ));
  return match?.[1]
    ? normalizeSpace(match[1].replace(/^[,;:\s]+|[,;.\s]+$/g, ''))
    : null;
}

function extractNewTaskName(transcript: string): string | null {
  const labeled = extractLabeledText(transcript, ['task name', 'task', 'title']);
  if (labeled) return labeled;
  const itemTypePattern = PROJECT_ITEM_TYPES
    .slice()
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join('|');
  const match = transcript.match(
    new RegExp(
      `\\b(?:add|create)\\s+(?:a|an)?\\s*(?:new\\s+)?(?:${itemTypePattern}|item)\\s+(?:named|called|to)?\\s*(.+?)(?=\\s*(?:[,;.]\\s*)?(?:project|area|location|owner|contractor|start|finish|due|milestone|percent|percentage|progress|status|priority|note|notes|next action)\\b|$)`,
      'i',
    ),
  );
  if (match?.[1]) {
    return normalizeSpace(match[1].replace(/^[,;:\s]+|[,;.\s]+$/g, ''));
  }
  const typedItem = transcript.match(new RegExp(
    `^(?:${itemTypePattern})\\s*:\\s*(.+?)(?=\\s*(?:[,;.]\\s*)?(?:project|area|location|owner|contractor|start|finish|due|milestone|percent|percentage|progress|status|priority|note|notes|next action)\\b|$)`,
    'i',
  ));
  return typedItem?.[1]
    ? normalizeSpace(typedItem[1].replace(/^[,;:\s]+|[,;.\s]+$/g, ''))
    : null;
}

export function statusForPercent(percent: number): DAVETaskStatus {
  if (percent <= 0) return 'Not Started';
  if (percent >= 100) return 'Complete';
  return 'In Progress';
}

function extractPercent(transcript: string): DAVETaskFillField<number> {
  const match = transcript.match(/\b(?:percent(?:\s+complete)?|percentage|progress)\s*(?:is|to|:|=)?\s*(\d{1,3})\s*(?:%|percent)?\b/i)
    ?? transcript.match(/\b(\d{1,3})\s*(?:%|percent)\b/i);
  if (!match) return emptyField();
  const value = Math.max(0, Math.min(100, Number(match[1])));
  return populatedField(value, match[0]);
}

function extractStatus(transcript: string): DAVETaskFillField<DAVETaskStatus> {
  const labeled = extractLabeledText(transcript, ['status']);
  const directive = transcript.match(
    /\b(?:mark|set|change|move|reopen)\s+(?:the\s+)?(?:task\s+)?(?:as|to)?\s*(not started|in progress|waiting|on hold|blocked|complete|completed|done|finished)\b/i,
  ) ?? transcript.match(
    /\b(?:task|work|it)\s+(?:is|is now|remains|should remain)\s+(not started|in progress|waiting|on hold|blocked|complete|completed|done|finished)\b/i,
  ) ?? transcript.match(/\b(waiting on|on hold|blocked by|in progress|underway)\b/i);
  const source = labeled || directive?.[1] || null;
  if (!source) return emptyField();
  const normalized = normalizedMatchText(source);
  if (/\b(?:waiting|on hold|blocked)\b/.test(normalized)) {
    return populatedField('Waiting', source);
  }
  if (/\b(?:not started|has not started)\b/.test(normalized)) {
    return populatedField('Not Started', source);
  }
  if (/\b(?:in progress|started|underway)\b/.test(normalized)) {
    return populatedField('In Progress', source);
  }
  if (/\b(?:complete|completed|done|finished)\b/.test(normalized)) {
    return populatedField('Complete', source);
  }
  return {
    ...emptyField<DAVETaskStatus>(),
    sourceText: source,
    needsConfirmation: true,
  };
}

function extractPriority(transcript: string): DAVETaskFillField<DAVETaskPriority> {
  const labeled = extractLabeledText(transcript, ['priority']);
  const match = labeled?.match(/\b(low|medium|high)\b/i)
    ?? transcript.match(/\b(low|medium|high)\s+priority\b/i);
  if (!match) return emptyField();
  const value = `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}` as DAVETaskPriority;
  return populatedField(value, labeled || match[0]);
}

function extractItemType(transcript: string): DAVETaskFillField<ProjectItemType> {
  const labeled = extractLabeledText(transcript, ['project item type', 'item type', 'type']);
  const search = normalizedMatchText(labeled || transcript);
  const matches = PROJECT_ITEM_TYPES.filter(itemType =>
    containsPhrase(search, itemType),
  );
  if (matches.length === 1) return populatedField(matches[0], labeled || matches[0]);
  if (matches.length > 1) return ambiguousField(labeled || matches.join(', '), [...matches]);
  return labeled ? {
    ...emptyField<ProjectItemType>(),
    sourceText: labeled,
    needsConfirmation: true,
  } : emptyField();
}

function extractDateField(
  transcript: string,
  labels: readonly string[],
  now: Date,
): DAVETaskFillField<string> {
  const source = extractLabeledText(transcript, labels);
  if (!source) return emptyField();
  const value = resolveDatePhrase(source, now);
  return value ? populatedField(value, source) : {
    ...emptyField<string>(),
    sourceText: source,
    needsConfirmation: true,
  };
}

function findTaskMatches(
  transcript: string,
  candidates: readonly DAVETaskFillTaskCandidate[] = [],
): DAVETaskFillTaskCandidate[] {
  return candidates.filter(candidate =>
    candidate.taskName.trim() && containsPhrase(transcript, candidate.taskName),
  );
}

function currentValuePresent(
  field: DAVETaskFillField<unknown>,
  currentValue: unknown,
): boolean {
  if (field.value !== null) return true;
  return typeof currentValue === 'string'
    ? Boolean(currentValue.trim())
    : currentValue !== null && currentValue !== undefined;
}

function buildGaps({
  transcript,
  fields,
  taskMatches,
  context,
}: {
  transcript: string;
  fields: DAVETaskFillFields;
  taskMatches: DAVETaskFillTaskCandidate[];
  context: DAVETaskFillContext;
}): DAVETaskFillGap[] {
  const gaps: DAVETaskFillGap[] = [];
  const mode = context.mode ?? 'create';
  const current = context.currentValues ?? {};

  if (!transcript) {
    gaps.push({
      field: 'instruction',
      kind: 'required',
      message: 'Type or record a task instruction before reviewing it.',
      blocking: true,
      candidates: [],
    });
    return gaps;
  }

  if (mode === 'create' && !currentValuePresent(fields.taskName, current.taskName)) {
    gaps.push({
      field: 'taskName',
      kind: 'required',
      message: 'What should this task be called?',
      blocking: true,
      candidates: [],
    });
  }
  if (!currentValuePresent(fields.projectName, current.projectName)) {
    gaps.push({
      field: 'projectName',
      kind: 'required',
      message: 'Which project does this task belong to?',
      blocking: true,
      candidates: uniqueOptions(context.projectNames),
    });
  }
  if (!currentValuePresent(fields.locationName, current.locationName)) {
    gaps.push({
      field: 'locationName',
      kind: 'required',
      message: 'Add an area or location if this task is tied to one.',
      blocking: false,
      candidates: uniqueOptions(context.locationNames),
    });
  }

  (Object.keys(fields) as DAVETaskFillFieldName[]).forEach(fieldName => {
    const field = fields[fieldName] as DAVETaskFillField<unknown>;
    if (!field.needsConfirmation) return;
    if (field.candidates.length > 1) {
      gaps.push({
        field: fieldName,
        kind: 'ambiguous',
        message: `Choose the intended ${fieldLabel(fieldName)}.`,
        blocking: true,
        candidates: field.candidates.map(String),
      });
      return;
    }
    if (field.value !== null) {
      gaps.push({
        field: fieldName,
        kind: 'low_confidence',
        message: `Confirm ${fieldLabel(fieldName)}: ${String(field.value)}.`,
        blocking: true,
        candidates: [String(field.value)],
      });
      return;
    }
    if (field.sourceText) {
      gaps.push({
        field: fieldName,
        kind: fieldName === 'startDate' || fieldName === 'finishDate'
          ? 'unclear_date'
          : 'low_confidence',
        message: fieldName === 'startDate' || fieldName === 'finishDate'
          ? `“${field.sourceText}” is not a clear calendar date. Edit the instruction or leave the date unchanged.`
          : `Clarify ${fieldLabel(fieldName)}: “${field.sourceText}”.`,
        blocking: false,
        candidates: [],
      });
    }
  });

  if (mode === 'create' && fields.taskName.value) {
    const duplicateMatches = taskMatches.filter(candidate =>
      normalizedMatchText(candidate.taskName) === normalizedMatchText(fields.taskName.value || ''),
    );
    if (duplicateMatches.length) {
      gaps.push({
        field: 'taskMatch',
        kind: 'duplicate_task',
        message: duplicateMatches.length === 1
          ? 'A task with this name already exists. Confirm that this should be a separate task.'
          : 'More than one task with this name already exists. Confirm that this should be a separate task.',
        blocking: true,
        candidates: duplicateMatches.map(candidate =>
          `${candidate.taskName} — ${candidate.projectName}${candidate.locationName ? ` / ${candidate.locationName}` : ''}`,
        ),
      });
    }
  }

  const hasProposedField = (Object.values(fields) as DAVETaskFillField<unknown>[])
    .some(field => field.value !== null);
  if (!hasProposedField) {
    gaps.push({
      field: 'instruction',
      kind: 'no_changes',
      message: 'No task fields were clear enough to propose. Add labels such as task, area, owner, due date, status, or percent.',
      blocking: true,
      candidates: [],
    });
  }

  return gaps;
}

function fieldLabel(fieldName: DAVETaskFillFieldName): string {
  const labels: Record<DAVETaskFillFieldName, string> = {
    taskName: 'task name',
    itemType: 'item type',
    projectName: 'project',
    locationName: 'area or location',
    startDate: 'start date',
    finishDate: 'finish or due date',
    milestone: 'milestone',
    owner: 'owner',
    contractor: 'trade or contractor',
    percentComplete: 'percent complete',
    status: 'status',
    priority: 'priority',
    notes: 'notes',
    nextAction: 'next action',
  };
  return labels[fieldName];
}

export function parseDAVETaskFillTranscript(
  rawTranscript: string,
  context: DAVETaskFillContext = {},
): DAVETaskFillUnderstanding {
  const transcript = normalizeSpace(rawTranscript);
  const fields = createEmptyDAVETaskFillFields();
  const warnings: string[] = [];
  const now = context.now ?? new Date();

  const labeledProject = extractLabeledText(transcript, ['project']);
  const labeledLocation = extractLabeledText(transcript, ['area', 'location']);
  const labeledOwner = extractLabeledText(transcript, ['owner', 'assigned to']);
  const labeledContractor = extractLabeledText(transcript, ['contractor', 'trade', 'company']);
  fields.projectName = matchCandidate(transcript, context.projectNames, labeledProject);
  fields.locationName = matchCandidate(transcript, context.locationNames, labeledLocation);
  fields.owner = matchCandidate(transcript, context.ownerNames, labeledOwner, false);
  fields.contractor = matchCandidate(transcript, context.contractorNames, labeledContractor, false);

  const taskName = extractNewTaskName(transcript);
  const notes = extractLabeledText(transcript, ['note', 'notes']);
  const nextAction = extractLabeledText(transcript, ['next action']);
  const milestone = extractLabeledText(transcript, ['milestone']);
  if (taskName) fields.taskName = populatedField(taskName, taskName, INFERRED_CONFIDENCE);
  if (notes) fields.notes = populatedField(notes, notes);
  if (nextAction) fields.nextAction = populatedField(nextAction, nextAction);
  if (milestone) fields.milestone = populatedField(milestone, milestone);

  fields.itemType = extractItemType(transcript);
  fields.percentComplete = extractPercent(transcript);
  fields.status = extractStatus(transcript);
  fields.priority = extractPriority(transcript);
  fields.startDate = extractDateField(transcript, ['start date', 'start'], now);
  fields.finishDate = extractDateField(transcript, ['finish date', 'finish', 'due date', 'due'], now);

  if (fields.percentComplete.value !== null && fields.status.value !== 'Waiting') {
    const normalizedStatus = statusForPercent(fields.percentComplete.value);
    if (fields.status.value && fields.status.value !== normalizedStatus) {
      warnings.push(`Status will be ${normalizedStatus} to match ${fields.percentComplete.value}% complete.`);
    }
    fields.status = populatedField(
      normalizedStatus,
      fields.percentComplete.sourceText ?? `${fields.percentComplete.value}%`,
    );
  }
  if (fields.status.value === 'Waiting' && fields.percentComplete.value === 100) {
    warnings.push('Waiting work cannot remain at 100%. The proposed percentage will be 99% so the task stays open.');
  }
  if (fields.locationName.candidates.length > 1) {
    warnings.push('More than one area matched. Choose the correct area before applying.');
  }
  if (fields.projectName.candidates.length > 1) {
    warnings.push('More than one project matched. Choose the correct project before applying.');
  }

  const taskMatches = findTaskMatches(transcript, context.taskCandidates);
  const gaps = buildGaps({ transcript, fields, taskMatches, context });

  return {
    schemaVersion: DAVE_TASK_FILL_SCHEMA_VERSION,
    transcript,
    fields,
    taskMatches,
    warnings,
    gaps,
  };
}

export function resolveDAVETaskFillCandidate(
  understanding: DAVETaskFillUnderstanding,
  fieldName: DAVETaskFillFieldName,
  candidate: string,
): DAVETaskFillUnderstanding {
  const current = understanding.fields[fieldName] as DAVETaskFillField<unknown>;
  const accepted = current.candidates.find(value => String(value) === candidate);
  if (accepted === undefined) return understanding;
  const fields = {
    ...understanding.fields,
    [fieldName]: populatedField(accepted, current.sourceText || candidate),
  } as DAVETaskFillFields;
  return {
    ...understanding,
    fields,
    gaps: understanding.gaps.filter(gap => gap.field !== fieldName),
  };
}

export function confirmDAVETaskFillField(
  understanding: DAVETaskFillUnderstanding,
  fieldName: DAVETaskFillFieldName,
): DAVETaskFillUnderstanding {
  const current = understanding.fields[fieldName] as DAVETaskFillField<unknown>;
  if (current.value === null) return understanding;
  const fields = {
    ...understanding.fields,
    [fieldName]: {
      ...current,
      confidence: Math.max(current.confidence, CONFIRMATION_THRESHOLD),
      needsConfirmation: false,
    },
  } as DAVETaskFillFields;
  return {
    ...understanding,
    fields,
    gaps: understanding.gaps.filter(gap => gap.field !== fieldName),
  };
}

export function buildDAVETaskFillPatch(
  understanding: DAVETaskFillUnderstanding,
  currentValues: Partial<DAVETaskFillValues> = {},
): DAVETaskFillPatch {
  const patch: DAVETaskFillPatch = {};
  const fields = understanding.fields;
  const accepted = <T,>(field: DAVETaskFillField<T>): T | null =>
    field.value !== null && !field.needsConfirmation ? field.value : null;

  const taskName = accepted(fields.taskName);
  const itemType = accepted(fields.itemType);
  const projectName = accepted(fields.projectName);
  const locationName = accepted(fields.locationName);
  const startDate = accepted(fields.startDate);
  const finishDate = accepted(fields.finishDate);
  const milestone = accepted(fields.milestone);
  const owner = accepted(fields.owner);
  const contractor = accepted(fields.contractor);
  const priority = accepted(fields.priority);
  const notes = accepted(fields.notes);
  const nextAction = accepted(fields.nextAction);
  if (taskName !== null) patch.taskName = taskName;
  if (itemType !== null) patch.itemType = itemType;
  if (projectName !== null) patch.projectName = projectName;
  if (locationName !== null) patch.locationName = locationName;
  if (startDate !== null) patch.startDate = startDate;
  if (finishDate !== null) patch.finishDate = finishDate;
  if (milestone !== null) patch.milestone = milestone;
  if (owner !== null) patch.owner = owner;
  if (contractor !== null) patch.contractor = contractor;
  if (priority !== null) patch.priority = priority;
  if (notes !== null) patch.notes = notes;
  if (nextAction !== null) patch.nextAction = nextAction;

  const percentComplete = accepted(fields.percentComplete);
  const status = accepted(fields.status);
  if (percentComplete !== null || status !== null) {
    const current = {
      status: currentValues.status ?? 'Not Started',
      percentComplete: currentValues.percentComplete ?? 0,
    };
    if (status === 'Waiting') {
      const waitingPercent = percentComplete ?? current.percentComplete;
      patch.status = 'Waiting';
      patch.percentComplete = Math.max(0, Math.min(99, Math.round(waitingPercent)));
    } else {
      const progress = reconcileScheduleProgressEdit(current, {
        ...(status !== null ? { status } : {}),
        ...(percentComplete !== null ? { percentComplete } : {}),
      });
      patch.status = progress.status;
      patch.percentComplete = progress.percentComplete;
    }
  }

  return patch;
}

export function appendDAVETaskFillInstruction(
  existingInstruction: string,
  nextInstruction: string,
): string {
  return [existingInstruction.trim(), nextInstruction.trim()].filter(Boolean).join('\n');
}

export function mergeTaskFillFields(
  primary: DAVETaskFillFields,
  fallback: DAVETaskFillFields,
): DAVETaskFillFields {
  const merged = {} as DAVETaskFillFields;
  (Object.keys(primary) as DAVETaskFillFieldName[]).forEach(key => {
    const primaryField = primary[key] as DAVETaskFillField<unknown>;
    const fallbackField = fallback[key] as DAVETaskFillField<unknown>;
    (merged as unknown as Record<string, DAVETaskFillField<unknown>>)[key] =
      primaryField.value !== null || primaryField.sourceText
        ? primaryField
        : fallbackField;
  });
  return merged;
}
