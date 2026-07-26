import type {
  ProjectArea,
  ScheduleItem,
  SchedulePriority,
  ScheduleStatus,
} from '../types';
import { daysUntilDate, parseFlexibleDate } from '../utils/date';
import { createReportedCompletionVerification } from './DAVECompletionVerification';
import {
  classifyDAVEBlocker,
  classifyDAVEImplementation,
  hasDAVEExplicitCompletionReport,
} from './DAVEAssertionParser';

export type PIEScheduleCommunicationImportResult = {
  items: ScheduleItem[];
  recognizedLineCount: number;
  candidateCount: number;
  reviewCount: number;
  extractionConfidencePercent: number;
  message: string;
};

const SCHEDULE_CUE = /\b(due|deadline|by\s+(?:today|tomorrow|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|finish(?:ed)?|complet(?:e|ed|ion)|start|begin|scheduled|rescheduled|inspection|delivery|deliver|mobiliz|install|rough[ -]?in|pour|submit|waiting|blocked|delay|ready|working|in progress)\b/i;
const NON_CONTENT_LINE = /^(sent from my|reply|forward|to:|from:|subject:|message|mail|today|yesterday|delivered|read)$/i;
const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export function extractScheduleItemsFromCommunicationText({
  text,
  sourceName,
  projects = [],
  projectAreas = [],
  recognitionConfidence = null,
  now = new Date(),
}: {
  text: string;
  sourceName: string;
  projects?: string[];
  projectAreas?: ProjectArea[];
  recognitionConfidence?: number | null;
  now?: Date;
}): PIEScheduleCommunicationImportResult {
  const lines = text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(line => line.length >= 3 && !NON_CONTENT_LINE.test(line));
  const contexts = communicationContexts(lines);
  const importedAt = now.toISOString();
  const seen = new Set<string>();
  const items = contexts.flatMap((context, index) => {
    if (!SCHEDULE_CUE.test(context)) return [];

    const finishDate = communicationDate(context, now);
    const reportedComplete = completionWasReported(context);
    const status = reportedComplete ? 'Not Started' : communicationStatus(context);
    const projectName = findNamedContext(context, projects);
    const locationName = findNamedContext(
      context,
      projectAreas.map(area => area.name),
    );
    const taskName = communicationTaskName(context);
    const owner = communicationOwner(context);
    const signature = normalize(`${taskName}|${finishDate}|${projectName}|${locationName}`);

    if (!taskName || seen.has(signature)) return [];
    seen.add(signature);

    const missingFields = [
      !projectName ? 'project' : null,
      !locationName ? 'area' : null,
      !finishDate ? 'date' : null,
      !owner ? 'owner' : null,
    ].filter(Boolean) as string[];
    const confidencePercent = communicationConfidence({
      finishDate,
      projectName,
      locationName,
      owner,
      recognitionConfidence,
    });

    const itemId = `schedule-message-${stableHash(`${sourceName}|${context}|${index}`)}`;
    return [{
      id: itemId,
      projectName,
      locationName,
      taskName,
      startDate: '',
      finishDate,
      milestone: '',
      owner,
      contractor: '',
      percentComplete: 0,
      priority: communicationPriority(finishDate),
      status,
      notes: context,
      importedFrom: sourceName,
      importedAt,
      completionVerification: reportedComplete
        ? createReportedCompletionVerification({
            sourceName,
            sourceRecordId: itemId,
            summary: context,
            reportedAt: importedAt,
            reportedBy: owner || null,
            priorScheduleStatus: status,
            priorPercentComplete: 0,
          })
        : null,
      createdAt: importedAt,
    } satisfies ScheduleItem];
  });
  const reviewCount = items.filter(item =>
    !item.projectName || !item.locationName || !item.finishDate || !item.owner || item.completionVerification?.status === 'reported_complete',
  ).length;
  const extractionConfidencePercent = items.length
    ? Math.round(items.reduce((total, item) => total + communicationConfidence({
        finishDate: item.finishDate,
        projectName: item.projectName,
        locationName: item.locationName,
        owner: item.owner,
        recognitionConfidence,
      }), 0) / items.length)
    : 0;

  return {
    items,
    recognizedLineCount: lines.length,
    candidateCount: contexts.filter(context => SCHEDULE_CUE.test(context)).length,
    reviewCount,
    extractionConfidencePercent,
    message: items.length
      ? `${items.length} possible schedule activit${items.length === 1 ? 'y' : 'ies'} extracted from the screenshot. Completion statements remain unverified until the project manager confirms them.`
      : 'Text was recognized, but no clear schedule commitments or dates were found.',
  };
}

function communicationContexts(lines: string[]) {
  const contexts: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1];

    if (next && shouldJoinCommunicationLines(line, next)) {
      contexts.push(`${line} ${next}`);
      index += 1;
    } else {
      contexts.push(line);
    }
  }

  return contexts
    .map(value => value.replace(/\s+/g, ' ').trim())
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => scheduleContextScore(right) - scheduleContextScore(left));
}

function shouldJoinCommunicationLines(line: string, next: string) {
  const nextIsDateContinuation = /^(?:by|due|on|before)\s+(?:next\s+)?(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[/-]|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i.test(next);
  if (nextIsDateContinuation) return true;

  const lineHasCue = SCHEDULE_CUE.test(line);
  const nextHasCue = SCHEDULE_CUE.test(next);
  const lineLooksComplete = /[.!?]$/.test(line);
  const nextLooksLikeContinuation = /^(?:and|or|but|be|is|are|was|were|to|for|with|after|before)\b/i.test(next);

  return !lineLooksComplete && (
    (!lineHasCue && nextHasCue) ||
    (lineHasCue && nextHasCue && nextLooksLikeContinuation)
  );
}

function scheduleContextScore(value: string) {
  return (SCHEDULE_CUE.test(value) ? 3 : 0) +
    (communicationDate(value, new Date()) ? 3 : 0) +
    Math.min(3, Math.floor(value.split(/\s+/).length / 5));
}

function communicationTaskName(value: string) {
  return value
    .replace(/^[^:]{1,28}:\s*/, '')
    .replace(/^(please|can you|could you|we need to|i need you to|make sure to)\s+/i, '')
    .replace(/^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?\s+(?:completed|finished)\s+/i, '')
    .replace(/\s+(?:was|is|were|are|has been|have been)\s+(?:done|complete|completed|finished)\b.*$/i, '')
    .replace(/\b(?:by|due|deadline|on|before)\s+(?:next\s+)?(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?).*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, '')
    .slice(0, 140)
    .trim();
}

function communicationDate(value: string, now: Date) {
  const explicit = value.match(/\b(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/)?.[1];
  if (explicit) return normalizedDate(explicit, now);

  const monthDate = value.match(/\b((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?)\b/i)?.[1];
  if (monthDate) return normalizedDate(monthDate, now);

  if (/\btoday\b/i.test(value)) return formatDate(now);
  if (/\btomorrow\b/i.test(value)) return formatDate(addDays(now, 1));

  const weekday = value.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2].toLowerCase());
    let days = (target - now.getDay() + 7) % 7;
    if (days === 0) days = 7;
    if (weekday[1]) days += 7;
    return formatDate(addDays(now, days));
  }

  return '';
}

function normalizedDate(value: string, now: Date) {
  let candidate = value;
  if (/^\d{1,2}[/-]\d{1,2}$/.test(value)) {
    candidate = `${value}/${now.getFullYear()}`;
  } else if (/^[a-z]+\s+\d{1,2}$/i.test(value)) {
    candidate = `${value}, ${now.getFullYear()}`;
  }

  const parsed = parseFlexibleDate(candidate);
  if (!parsed) return '';
  if (parsed.getTime() < addDays(now, -120).getTime() && !/\b\d{4}\b/.test(value)) {
    parsed.setFullYear(parsed.getFullYear() + 1);
  }
  return formatDate(parsed);
}

function communicationStatus(value: string): ScheduleStatus {
  if (classifyDAVEBlocker(value) === 'blocked') return 'Waiting';
  const implementation = classifyDAVEImplementation(value);
  if (implementation === 'in_progress' || implementation === 'implemented') {
    return 'In Progress';
  }
  return 'Not Started';
}

function completionWasReported(value: string) {
  return hasDAVEExplicitCompletionReport(value);
}

function communicationOwner(value: string) {
  return value.match(/\bowner\s*[:=-]\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?)/)?.[1] ||
    value.match(/\bassigned to\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?)/)?.[1] ||
    value.match(/^([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?)\s+(?:will|is|needs to|should)\b/)?.[1] ||
    value.match(/^([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?)\s+(?:completed|finished)\b/)?.[1] ||
    '';
}

function communicationPriority(finishDate: string): SchedulePriority {
  const days = finishDate ? daysUntilDate(finishDate) : null;
  if (days !== null && days <= 7) return 'High';
  return 'Medium';
}

function communicationConfidence({
  finishDate,
  projectName,
  locationName,
  owner,
  recognitionConfidence,
}: {
  finishDate: string;
  projectName: string;
  locationName: string;
  owner: string;
  recognitionConfidence: number | null;
}) {
  const metadataScore = 38 +
    (finishDate ? 25 : 0) +
    (projectName ? 12 : 0) +
    (locationName ? 12 : 0) +
    (owner ? 8 : 0);
  const recognitionScore = recognitionConfidence === null
    ? 0
    : Math.round(Math.max(0, Math.min(1, recognitionConfidence)) * 5);
  return Math.min(100, metadataScore + recognitionScore);
}

function findNamedContext(value: string, candidates: string[]) {
  const normalizedValue = normalize(value);
  return candidates.find(candidate =>
    candidate.trim() && normalizedValue.includes(normalize(candidate)),
  ) || '';
}

function cleanLine(value: string) {
  return value.replace(/[\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDate(value: Date) {
  return `${String(value.getMonth() + 1).padStart(2, '0')}/${String(value.getDate()).padStart(2, '0')}/${value.getFullYear()}`;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
