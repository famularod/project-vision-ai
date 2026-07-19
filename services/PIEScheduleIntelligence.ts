import type {
  ProjectArea,
  ScheduleItem,
  SchedulePriority,
  ScheduleStatus,
} from '../types';
import {
  SCHEDULE_PRIORITIES,
  SCHEDULE_STATUSES,
} from '../types';
import {
  daysUntilDate,
  dueStatusText,
  formatAppDate,
  parseFlexibleDate,
} from '../utils/date';
import {
  buildScheduleSummary,
  type ScheduleSummary,
  type ScheduleSummaryTask,
} from '../utils/schedule';
import type { ProjectConfidenceLevel } from './ProjectIntelligenceEngine';
import { stripScheduleDependencyMetadata } from './PIEScheduleDependencyNetwork';
import {
  normalizeScheduleStatus,
  reconcileScheduleProgress,
} from './ScheduleProgressInvariant';

export type PIEScheduleInputFormat =
  | 'pdf'
  | 'csv'
  | 'excel'
  | 'text'
  | 'json'
  | 'unknown';

export type PIESchedulePipelineStage =
  | 'Import'
  | 'Detect format'
  | 'Extract text'
  | 'Normalize'
  | 'Review uncertain items'
  | 'Feed Runtime'
  | 'Feed Mission'
  | 'Feed Executive'
  | 'Feed Knowledge Graph';

export type PIEScheduleFormatDetection = {
  format: PIEScheduleInputFormat;
  isPdf: boolean;
  isCsv: boolean;
  isExcel: boolean;
  isTextReadable: boolean;
  reason: string;
};

export type PIEScheduleTextExtraction = {
  extractedText: string;
  textDetected: boolean;
  scannedDetected: boolean;
  cleanedTextLength: number;
  dateLikeTextCount: number;
  wordLikeTextCount: number;
  message: string;
};

export type PIEScheduleType =
  | 'lookahead'
  | 'gantt'
  | 'milestone'
  | 'activity-list'
  | 'unknown';

export type PIEScheduleImportStatus =
  | 'Import Successful'
  | 'Import Partial'
  | 'Needs Review'
  | 'OCR Required'
  | 'Unsupported Schedule';

export type PIEScheduleDelimitedParseIssue = {
  code:
    | 'unexpected_quote'
    | 'characters_after_closing_quote'
    | 'unterminated_quote'
    | 'column_count_mismatch';
  row: number;
  column: number;
  message: string;
};

export type PIEScheduleDelimitedParseResult = {
  delimiter: ',' | '\t';
  rows: string[][];
  issues: PIEScheduleDelimitedParseIssue[];
};

export type PIENormalizedScheduleTask = {
  id: string;
  project: string;
  area: string;
  task: string;
  wbs: string | null;
  milestone: string | null;
  start: string | null;
  finish: string | null;
  duration: number | null;
  status: ScheduleStatus;
  percentComplete: number;
  owner: string | null;
  contractor: string | null;
  critical: boolean;
  float: number | null;
  notes: string | null;
  sourceItem: ScheduleItem;
  needsReview: boolean;
  reviewFields: Array<'Project' | 'Area' | 'Dates' | 'Task' | 'Owner' | 'Status'>;
  confidence: ProjectConfidenceLevel;
};

export type PIEScheduleReviewItem = {
  id: string;
  task: string;
  reason: string;
  correctionFields: Array<'Project' | 'Area' | 'Dates' | 'Task' | 'Owner' | 'Status'>;
  confidence: ProjectConfidenceLevel;
};

export type PIEScheduleIntelligence = {
  pipeline: PIESchedulePipelineStage[];
  generatedAt: string;
  projectName: string;
  scheduleSummary: ScheduleSummary;
  normalizedTasks: PIENormalizedScheduleTask[];
  reviewItems: PIEScheduleReviewItem[];
  upcomingTasks: PIENormalizedScheduleTask[];
  overdueTasks: PIENormalizedScheduleTask[];
  criticalTasks: PIENormalizedScheduleTask[];
  milestones: PIENormalizedScheduleTask[];
  criticalPathSummary: string;
  scheduleRisk: string;
  recommendedInspection: string;
  recommendedWalkAreas: string[];
  executiveSummary: string;
  scheduleConfidence: ProjectConfidenceLevel;
  runtimeFeed: {
    scheduleSummary: ScheduleSummary;
    upcomingTasks: PIENormalizedScheduleTask[];
    overdueTasks: PIENormalizedScheduleTask[];
    criticalTasks: PIENormalizedScheduleTask[];
    milestones: PIENormalizedScheduleTask[];
    recommendedWalkAreas: string[];
    scheduleConfidence: ProjectConfidenceLevel;
  };
  missionFeed: {
    recommendedMission: 'schedule-recovery' | 'inspection-verification' | 'project-walk' | 'monitoring';
    evidence: string[];
    blockers: string[];
    recommendedActions: string[];
  };
  executiveFeed: {
    executiveSummary: string;
    scheduleRisk: string;
    escalations: string[];
    preparations: string[];
  };
  knowledgeGraphFeed: {
    nodes: Array<{
      id: string;
      type: 'schedule_item' | 'milestone' | 'area' | 'contractor' | 'dependency';
      label: string;
    }>;
    relationships: Array<{
      from: string;
      to: string;
      type: 'belongs_to' | 'located_in' | 'owned_by' | 'depends_on' | 'blocks' | 'supports';
    }>;
  };
};

export type NormalizeScheduleImportParams = {
  contents: string;
  sourceName: string;
  mimeType?: string | null;
  projects?: string[];
  projectAreas?: ProjectArea[];
  now?: Date;
};

export type NormalizeScheduleImportResult = {
  format: PIEScheduleFormatDetection;
  extraction: PIEScheduleTextExtraction | null;
  scheduleType: PIEScheduleType;
  importStatus: PIEScheduleImportStatus;
  extractionConfidencePercent: number;
  items: ScheduleItem[];
  reviewItems: PIEScheduleReviewItem[];
  parseIssues: PIEScheduleDelimitedParseIssue[];
  message: string;
  validationOutput: {
    scheduleSummary: ScheduleSummary;
    criticalActivities: ScheduleSummaryTask[];
    overdueActivities: ScheduleSummaryTask[];
    upcomingActivities7Days: ScheduleSummaryTask[];
    upcomingActivities14Days: ScheduleSummaryTask[];
    upcomingActivities30Days: ScheduleSummaryTask[];
    recommendedWalkAreas: string[];
    recommendedInspectionAreas: string[];
    executiveSummary: string;
  };
};

const PIPELINE: PIESchedulePipelineStage[] = [
  'Import',
  'Detect format',
  'Extract text',
  'Normalize',
  'Review uncertain items',
  'Feed Runtime',
  'Feed Mission',
  'Feed Executive',
  'Feed Knowledge Graph',
];

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function explicitScheduleNote(value: unknown) {
  if (typeof value !== 'string') return '';

  return stripScheduleDependencyMetadata(value).trim();
}

export function normalizeImportedScheduleNote(
  value: unknown,
  importedFrom?: string | null,
) {
  const note = explicitScheduleNote(value);
  if (!note || !importedFrom?.trim()) return note;

  if (
    /^AI\/OCR extraction from imported Gantt PDF\b/i.test(note) ||
    /^The PDF was saved, but no dated schedule activity could be extracted automatically\b/i.test(note)
  ) {
    return '';
  }

  if (/Imported from a structured Microsoft Project PDF/i.test(note)) {
    return note
      .replace(/\bActivity ID:\s*[^.]+\.?\s*/gi, ' ')
      .replace(/\bDuration:\s*\d+(?:\.\d+)?\s+days?\.?\s*/gi, ' ')
      .replace(/\bImported from a structured Microsoft Project PDF;?\s*/gi, ' ')
      .replace(/\bverify highlighted fields before approval\.?\s*/gi, ' ')
      .replace(/\s+([.,;:])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  const legacyCommunication = note.match(
    /^Extracted locally from .*?\. Original message:\s*(.*?)\s+Extraction confidence:\s*\d+%\./i,
  );
  if (legacyCommunication?.[1]) {
    return legacyCommunication[1].trim();
  }

  let cleaned = note;

  if (/\bSchedule confidence:/i.test(cleaned)) {
    const metadataStart = [
      /\bWBS:/i,
      /\bDuration:/i,
      /\bCritical:/i,
      /\bFloat:/i,
      /\bReview needed:/i,
      /\bSchedule confidence:/i,
    ]
      .map(pattern => cleaned.search(pattern))
      .filter(index => index >= 0)
      .sort((left, right) => left - right)[0];

    if (metadataStart !== undefined) {
      cleaned = cleaned.slice(0, metadataStart);
    }
  }

  const aiReviewStart = [
    /\bReview strength:/i,
    /\bSource page:/i,
    /\bReview this AI-extracted item before relying on it\.?/i,
    /\bReview task name, location, and dates before relying on this item\.?/i,
  ]
    .map(pattern => cleaned.search(pattern))
    .filter(index => index >= 0)
    .sort((left, right) => left - right)[0];

  if (aiReviewStart !== undefined) {
    cleaned = cleaned.slice(0, aiReviewStart);
  }

  return cleaned
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function confidenceFromScore(score: number): ProjectConfidenceLevel {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

export function detectScheduleFormat({
  fileName,
  mimeType = '',
  contents = '',
}: {
  fileName: string;
  mimeType?: string | null;
  contents?: string;
}): PIEScheduleFormatDetection {
  const lowerName = fileName.toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();
  const sample = contents.slice(0, 200);
  const isPdf = lowerMime.includes('pdf') || lowerName.endsWith('.pdf');
  const isCsv =
    lowerMime.includes('csv') ||
    lowerName.endsWith('.csv') ||
    sample.includes(',');
  const isExcel =
    lowerMime.includes('excel') ||
    lowerMime.includes('spreadsheet') ||
    lowerName.endsWith('.xls') ||
    lowerName.endsWith('.xlsx') ||
    lowerName.endsWith('.tsv');
  const isJson = lowerMime.includes('json') || lowerName.endsWith('.json');
  const isText =
    lowerMime.includes('text') ||
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.tsv');
  const binaryExcel = isExcel && contents.startsWith('PK');
  const isTextReadable = !binaryExcel && !/[\u0000-\u0008\u000E-\u001F]/.test(sample);

  if (isPdf) {
    return {
      format: 'pdf',
      isPdf,
      isCsv: false,
      isExcel: false,
      isTextReadable,
      reason: 'PDF schedule import detected.',
    };
  }

  if (isExcel) {
    return {
      format: 'excel',
      isPdf: false,
      isCsv,
      isExcel: true,
      isTextReadable,
      reason: binaryExcel
        ? 'Excel workbook detected. Without adding packages, readable CSV/TSV exports can be normalized automatically; binary workbook rows require review.'
        : 'Excel-readable schedule import detected.',
    };
  }

  if (isCsv || isText || isJson) {
    return {
      format: isJson ? 'json' : isCsv ? 'csv' : 'text',
      isPdf: false,
      isCsv,
      isExcel: false,
      isTextReadable,
      reason: 'Readable schedule text import detected.',
    };
  }

  return {
    format: 'unknown',
    isPdf: false,
    isCsv: false,
    isExcel: false,
    isTextReadable,
    reason: 'Unknown schedule import format.',
  };
}

export function cleanPdfScheduleText(value: string) {
  const readableLines = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, ' ').replace(/ +/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  const appearsToBeRawPdf = value.startsWith('%PDF-') || /\b(?:obj|stream|endobj)\b/.test(value.slice(0, 5_000));

  if (!appearsToBeRawPdf) return readableLines;

  const parentheticalText = Array.from(
    value.matchAll(/\((?:\\.|[^\\)])*\)/g),
  )
    .map(match =>
      match[0]
        .slice(1, -1)
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\n/g, ' ')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\/g, ''),
    )
    .join('\n');

  return `${value}\n${parentheticalText}`
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, ' ')
    .split('\n')
    .map(line => line.replace(/ +/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function extractPdfScheduleText(rawPdfText: string): PIEScheduleTextExtraction {
  const extractedText = cleanPdfScheduleText(rawPdfText);
  const dateLikeTextCount = Array.from(
    extractedText.matchAll(/\b\d{1,2}[\/-]\d{1,2}[\/-](?:\d{2}|\d{4})\b/g),
  ).length;
  const wordLikeTextCount = Array.from(
    extractedText.matchAll(/[a-zA-Z]{4,}/g),
  ).length;
  const textDetected =
    extractedText.length >= 250 &&
    wordLikeTextCount >= 20 &&
    dateLikeTextCount > 0;
  const scannedDetected = !textDetected;

  return {
    extractedText,
    textDetected,
    scannedDetected,
    cleanedTextLength: extractedText.length,
    dateLikeTextCount,
    wordLikeTextCount,
    message: textDetected
      ? 'PDF text detected. Schedule text can be normalized automatically.'
      : 'Scanned PDF detected or flattened/image-only schedule detected. OCR or manual review is required; this import must not silently fail.',
  };
}

export function parseScheduleDelimitedText(
  contents: string,
  delimiter: ',' | '\t' = ',',
): PIEScheduleDelimitedParseResult {
  const input = contents.startsWith('\uFEFF') ? contents.slice(1) : contents;
  const rows: string[][] = [];
  const issues: PIEScheduleDelimitedParseIssue[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotedField = false;
  let afterClosingQuote = false;
  let reportedCharactersAfterQuote = false;
  let recordStarted = false;

  const currentRowNumber = () => rows.length + 1;
  const currentColumnNumber = () => row.length + 1;
  const pushField = () => {
    row.push(field);
    field = '';
    afterClosingQuote = false;
    reportedCharactersAfterQuote = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    recordStarted = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const isLineBreak = char === '\r' || char === '\n';

    if (inQuotedField) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotedField = false;
          afterClosingQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (afterClosingQuote) {
      if (char === delimiter) {
        pushField();
        recordStarted = true;
        continue;
      }

      if (isLineBreak) {
        pushRow();
        if (char === '\r' && input[index + 1] === '\n') index += 1;
        continue;
      }

      if (!reportedCharactersAfterQuote) {
        issues.push({
          code: 'characters_after_closing_quote',
          row: currentRowNumber(),
          column: currentColumnNumber(),
          message: `Row ${currentRowNumber()}, column ${currentColumnNumber()} has characters after a closing quote.`,
        });
        reportedCharactersAfterQuote = true;
      }
      field += char;
      recordStarted = true;
      continue;
    }

    if (char === delimiter) {
      pushField();
      recordStarted = true;
      continue;
    }

    if (isLineBreak) {
      pushRow();
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      continue;
    }

    if (char === '"') {
      if (field.length === 0) {
        inQuotedField = true;
      } else {
        issues.push({
          code: 'unexpected_quote',
          row: currentRowNumber(),
          column: currentColumnNumber(),
          message: `Row ${currentRowNumber()}, column ${currentColumnNumber()} has a quote inside an unquoted field.`,
        });
        field += char;
      }
      recordStarted = true;
      continue;
    }

    field += char;
    recordStarted = true;
  }

  if (inQuotedField) {
    issues.push({
      code: 'unterminated_quote',
      row: currentRowNumber(),
      column: currentColumnNumber(),
      message: `Row ${currentRowNumber()}, column ${currentColumnNumber()} has an unterminated quoted field.`,
    });
  }

  if (recordStarted || row.length > 0 || field.length > 0) pushRow();

  return { delimiter, rows, issues };
}

function scheduleDelimiter(sourceName: string, mimeType: string | null | undefined, contents: string) {
  const lowerName = sourceName.toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();
  const firstRecord = contents.replace(/^\uFEFF/, '').split(/\r\n?|\n/, 1)[0] || '';

  if (
    lowerName.endsWith('.tsv') ||
    lowerMime.includes('tab-separated') ||
    (firstRecord.includes('\t') && !firstRecord.includes(','))
  ) {
    return '\t' as const;
  }

  return ',' as const;
}

function headerKey(value: string) {
  return normalized(value).replace(/[_-]+/g, ' ');
}

function hasScheduleHeader(cells: string[]) {
  return cells.some(cell =>
    [
      'task',
      'task name',
      'activity',
      'activity name',
      'wbs',
      'project',
      'area',
      'location',
      'start',
      'finish',
      'due',
      'owner',
      'status',
      'predecessors',
      'dependencies',
    ].includes(headerKey(cell)),
  );
}

function cell(
  cells: string[],
  headers: string[],
  names: string[],
  fallbackIndex: number,
) {
  const headerIndex = headers.findIndex(header => names.includes(header));

  if (headerIndex >= 0) return cells[headerIndex] || '';

  return cells[fallbackIndex] || '';
}

function normalizeStatus(value: string): ScheduleStatus {
  return normalizeScheduleStatus(value);
}

function normalizePriority(value: string, finishDate: string): SchedulePriority {
  const lower = normalized(value);
  const direct = SCHEDULE_PRIORITIES.find(priority => normalized(priority) === lower);

  if (direct) return direct;
  if (lower.includes('critical') || lower.includes('high')) return 'High';
  if (lower.includes('low')) return 'Low';

  const days = daysUntilDate(finishDate);

  if (days !== null && days <= 7) return 'High';

  return 'Medium';
}

function normalizePercent(value: string, status: ScheduleStatus) {
  const match = value.match(/(\d{1,3})\s*%?/);

  if (match) return clamp(Number(match[1]), 0, 100);
  if (status === 'Complete') return 100;

  return 0;
}

function normalizeDate(value: string) {
  const parsed = parseFlexibleDate(value);

  if (!parsed) return '';

  return formatAppDate(value);
}

function parseDuration(value: string) {
  const match = value.match(/-?\d+(\.\d+)?/);

  return match ? Number(match[0]) : null;
}

export function detectScheduleType(text: string): PIEScheduleType {
  const lower = text.toLowerCase();

  if (lower.includes('lookahead') || lower.includes('look ahead')) {
    return 'lookahead';
  }

  if (
    lower.includes('gantt') ||
    lower.includes('predecessor') ||
    lower.includes('successor') ||
    lower.includes('critical path') ||
    lower.includes('total float')
  ) {
    return 'gantt';
  }

  if (
    lower.includes('milestone') ||
    lower.includes('substantial completion') ||
    lower.includes('final completion')
  ) {
    return 'milestone';
  }

  if (
    lower.includes('activity') ||
    lower.includes('task') ||
    lower.includes('start') ||
    lower.includes('finish')
  ) {
    return 'activity-list';
  }

  return 'unknown';
}

function findNameMatch(value: string, names: string[]) {
  const normalizedValue = ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

  return names.find(name => {
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return normalizedName && normalizedValue.includes(` ${normalizedName} `);
  }) || '';
}

function scheduleMatchTokens(value: string) {
  const ignored = new Set([
    'and', 'building', 'campus', 'location', 'phase', 'project', 'site', 'the', 'work',
  ]);

  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(token => token && !ignored.has(token));
}

function bestScheduleProjectMatch(value: string, projects: string[]) {
  const direct = findNameMatch(value, projects);
  if (direct) return direct;

  const valueNumbers = new Set(scheduleMatchTokens(value).filter(token => /^\d{3,}$/.test(token)));
  const numericMatches = projects.filter(project =>
    scheduleMatchTokens(project).some(token => valueNumbers.has(token)),
  );
  if (valueNumbers.size && numericMatches.length === 1) return numericMatches[0];

  const valueWords = new Set(
    scheduleMatchTokens(value).filter(token => !/^\d+$/.test(token)),
  );
  const scoredMatches = projects
    .map(project => ({
      project,
      score: scheduleMatchTokens(project)
        .filter(token => !/^\d+$/.test(token) && valueWords.has(token))
        .length,
    }))
    .filter(candidate => candidate.score >= 2)
    .sort((a, b) => b.score - a.score);

  if (
    scoredMatches.length > 0 &&
    (scoredMatches.length === 1 || scoredMatches[0].score > scoredMatches[1].score)
  ) {
    return scoredMatches[0].project;
  }

  return '';
}

function bestScheduleAreaMatch(value: string, projectAreas: ProjectArea[]) {
  const normalizedValue = ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const valueTokens = new Set(scheduleMatchTokens(value));
  let bestArea = '';
  let bestScore = 0;

  projectAreas.forEach(area => {
    const normalizedName = area.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (normalizedName && normalizedValue.includes(` ${normalizedName} `)) {
      const score = 100 + normalizedName.length;
      if (score > bestScore) {
        bestArea = area.name;
        bestScore = score;
      }
      return;
    }

    const areaTokens = scheduleMatchTokens(area.name);
    const commonTokens = areaTokens.filter(token => valueTokens.has(token));
    const requiredMatches = areaTokens.length <= 1 ? areaTokens.length : Math.min(2, areaTokens.length);

    if (commonTokens.length >= requiredMatches && commonTokens.length > bestScore) {
      bestArea = area.name;
      bestScore = commonTokens.length;
    }
  });

  return bestArea;
}

function microsoftProjectContextBoundary(value: string) {
  return /\b(?:campus|canop(?:y|ies)|driveway|enclosure|house|lot|phase|sequence)\b/i.test(value);
}

function normalizeMicrosoftProjectDate(value: string) {
  const dateMatch = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (!dateMatch) return '';

  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const rawYear = Number(dateMatch[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const parsed = parseFlexibleDate(`${month}/${day}/${year}`);
  if (!parsed) return '';

  return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
}

function scheduleProjectNameFromGanttRoot(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const locationCode = normalized.match(
    /^(?:plz\s+)?([a-z0-9][a-z0-9-]{2,})\b.*\b(?:campus|project|site)\b/i,
  )?.[1];

  return locationCode && /\d/.test(locationCode)
    ? `${locationCode.toUpperCase()} Compliance Project`
    : normalized;
}

export function normalizeMicrosoftProjectPdfRows({
  contents,
  sourceName,
  projects = [],
  projectAreas = [],
  now = new Date(),
}: {
  contents: string;
  sourceName: string;
  projects?: string[];
  projectAreas?: ProjectArea[];
  now?: Date;
}) {
  const lines = contents.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const header = (lines[0] || '').split('\t').map(value => headerKey(value.trim()));

  if (!header.includes('task name') || !header.includes('indent') || !header.includes('finish')) {
    return [] as ScheduleItem[];
  }

  const importedAt = now.toISOString();
  const rows = lines.slice(1).map(line => {
    const cells = line.split('\t').map(value => value.trim());
    return {
      activityId: cell(cells, header, ['id', 'activity id'], 0),
      taskName: cell(cells, header, ['task name', 'task', 'activity'], 1),
      indent: Number(cell(cells, header, ['indent'], 2)) || 0,
      duration: parseDuration(cell(cells, header, ['duration'], 3)),
      startDate: normalizeMicrosoftProjectDate(cell(cells, header, ['start', 'start date'], 4)),
      finishDate: normalizeMicrosoftProjectDate(cell(cells, header, ['finish', 'finish date'], 5)),
      percentComplete: normalizePercent(
        cell(cells, header, ['percent complete', '% complete'], 6),
        'Not Started',
      ),
      notes: cell(cells, header, ['notes', 'comments', 'remarks'], -1),
    };
  }).filter(row => row.taskName && row.finishDate);
  const contexts = new Map<number, {
    scheduleProjectName: string;
    projectName: string;
    locationName: string;
  }>();
  const items: ScheduleItem[] = [];

  rows.forEach((row, index) => {
    Array.from(contexts.keys()).forEach(level => {
      if (level >= row.indent) contexts.delete(level);
    });

    let parentContext = { scheduleProjectName: '', projectName: '', locationName: '' };
    for (let level = row.indent - 1; level >= 0; level -= 1) {
      const candidate = contexts.get(level);
      if (candidate) {
        parentContext = candidate;
        break;
      }
    }

    const directProject = bestScheduleProjectMatch(row.taskName, projects);
    const directArea = bestScheduleAreaMatch(row.taskName, projectAreas);
    const hasChildren = (rows[index + 1]?.indent ?? -1) > row.indent;
    const directScheduleProject = row.indent === 0 && hasChildren
      ? scheduleProjectNameFromGanttRoot(row.taskName)
      : '';
    const startsNamedBranch = Boolean(
      hasChildren &&
      parentContext.locationName &&
      directProject &&
      microsoftProjectContextBoundary(row.taskName),
    );
    const changesMappedArea = Boolean(
      directArea &&
      parentContext.locationName &&
      directArea !== parentContext.locationName,
    );
    const context = {
      scheduleProjectName: directScheduleProject || parentContext.scheduleProjectName,
      projectName: (
        startsNamedBranch || changesMappedArea
          ? directProject
          : ''
      ) || parentContext.projectName || directProject,
      locationName: directArea || (
        hasChildren && microsoftProjectContextBoundary(row.taskName)
          ? ''
          : parentContext.locationName
      ),
    };

    if (hasChildren) {
      contexts.set(row.indent, context);
      return;
    }

    if (row.indent === 0) return;

    const percentComplete = clamp(row.percentComplete, 0, 100);
    const status: ScheduleStatus = percentComplete >= 100
      ? 'Complete'
      : percentComplete > 0
        ? 'In Progress'
        : 'Not Started';
    items.push({
      id: uid(),
      scheduleProjectName: context.scheduleProjectName || null,
      projectName: context.projectName,
      locationName: directArea || context.locationName,
      taskName: row.taskName,
      startDate: row.startDate,
      finishDate: row.finishDate,
      milestone: row.duration === 0 ? row.taskName : '',
      owner: '',
      contractor: '',
      durationDays: row.duration,
      percentComplete,
      priority: normalizePriority('', row.finishDate),
      status,
      notes: explicitScheduleNote(row.notes),
      importedFrom: sourceName,
      importedAt,
      createdAt: importedAt,
    });
  });

  return items;
}

function scheduleItemFromNormalizedTask(
  task: Omit<PIENormalizedScheduleTask, 'sourceItem'>,
  sourceName: string,
  importedAt: string,
): ScheduleItem {
  return {
    id: task.id,
    projectName: task.project,
    locationName: task.area,
    taskName: task.task || 'New Schedule Item',
    startDate: task.start || '',
    finishDate: task.finish || '',
    milestone: task.milestone || '',
    owner: task.owner || '',
    contractor: task.contractor || '',
    durationDays: task.duration,
    percentComplete: task.percentComplete,
    priority: task.critical ? 'High' : normalizePriority('', task.finish || ''),
    status: task.status,
    notes: explicitScheduleNote(task.notes),
    importedFrom: sourceName,
    importedAt,
    createdAt: importedAt,
  };
}

function reviewFieldsForTask(task: {
  project: string;
  area: string;
  task: string;
  start: string | null;
  finish: string | null;
  owner: string | null;
  status: ScheduleStatus;
}) {
  const fields: PIENormalizedScheduleTask['reviewFields'] = [];

  if (!task.project.trim()) fields.push('Project');
  if (!task.area.trim()) fields.push('Area');
  if (!task.task.trim()) fields.push('Task');
  if (!task.start && !task.finish) fields.push('Dates');
  if (!task.owner) fields.push('Owner');
  if (!SCHEDULE_STATUSES.includes(task.status)) fields.push('Status');

  return fields;
}

export function normalizeScheduleImport({
  contents,
  sourceName,
  mimeType = '',
  projects = [],
  projectAreas = [],
  now = new Date(),
}: NormalizeScheduleImportParams): NormalizeScheduleImportResult {
  const format = detectScheduleFormat({ fileName: sourceName, mimeType, contents });
  const extraction =
    format.format === 'pdf' ? extractPdfScheduleText(contents) : null;
  const readableText =
    extraction?.textDetected
      ? extraction.extractedText
      : format.format === 'pdf'
      ? ''
      : contents;
  const scheduleType = detectScheduleType(readableText || extraction?.extractedText || contents);
  const emptySummary = buildScheduleSummary([], {});
  const emptyValidationOutput = {
    scheduleSummary: emptySummary,
    criticalActivities: [] as ScheduleSummaryTask[],
    overdueActivities: [] as ScheduleSummaryTask[],
    upcomingActivities7Days: [] as ScheduleSummaryTask[],
    upcomingActivities14Days: [] as ScheduleSummaryTask[],
    upcomingActivities30Days: [] as ScheduleSummaryTask[],
    recommendedWalkAreas: [] as string[],
    recommendedInspectionAreas: [] as string[],
    executiveSummary: 'No schedule activities were imported.',
  };

  if (!readableText.trim()) {
    return {
      format,
      extraction,
      scheduleType,
      importStatus:
        format.format === 'pdf' && extraction?.scannedDetected
          ? 'OCR Required'
          : 'Needs Review',
      extractionConfidencePercent: 0,
      items: [],
      reviewItems: [{
        id: `schedule-review-${uid()}`,
        task: `Review imported schedule: ${sourceName}`,
        reason:
          extraction?.message ||
          format.reason ||
          'No readable schedule text was available for automatic normalization.',
        correctionFields: ['Project', 'Area', 'Dates', 'Task', 'Owner', 'Status'],
        confidence: 'low',
      }],
      parseIssues: [],
      message:
        extraction?.message ||
        'No schedule items were added automatically, so this import did not silently fail. No readable schedule text was available; OCR or review is required.',
      validationOutput: emptyValidationOutput,
    };
  }

  const importedAt = now.toISOString();
  const shouldParseWholeInput = format.format === 'csv' || format.format === 'excel';
  const delimiter = scheduleDelimiter(sourceName, mimeType, readableText);
  const parsedInput = shouldParseWholeInput
    ? parseScheduleDelimitedText(readableText, delimiter)
    : null;
  const records = (parsedInput
    ? parsedInput.rows.map((cells, index) => ({ cells, rowNumber: index + 1 }))
    : readableText
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line, index) => {
          const lineDelimiter = line.includes('\t') ? '\t' : ',';
          const parsedLine = parseScheduleDelimitedText(line, lineDelimiter);
          return {
            cells: parsedLine.rows[0] || [''],
            rowNumber: index + 1,
          };
        }))
    .map(record => ({
      ...record,
      cells: record.cells.map(value => value.trim()),
    }))
    .filter(record => record.cells.some(value => value.length > 0));
  const firstCells = records[0]?.cells || [];
  const hasHeader = hasScheduleHeader(firstCells);
  const headers = hasHeader ? firstCells.map(headerKey) : [];
  const dataRecords = hasHeader ? records.slice(1) : records;
  const parseIssues = [...(parsedInput?.issues || [])];

  if (parsedInput && hasHeader) {
    const expectedColumnCount = firstCells.length;
    dataRecords.forEach(record => {
      if (record.cells.length === expectedColumnCount) return;

      parseIssues.push({
        code: 'column_count_mismatch',
        row: record.rowNumber,
        column: Math.min(record.cells.length, expectedColumnCount) + 1,
        message: `Row ${record.rowNumber} has ${record.cells.length} column${record.cells.length === 1 ? '' : 's'}; the header defines ${expectedColumnCount}.`,
      });
    });
  }

  const normalizedTasks = dataRecords
    .map(record => {
      const { cells } = record;
      const rowText = cells.join(' ');
      const task = cell(cells, headers, ['task', 'task name', 'activity', 'activity name', 'item'], 0);
      const finish = normalizeDate(
        cell(cells, headers, ['finish', 'finish date', 'due', 'due date'], 4),
      );
      const start = normalizeDate(
        cell(cells, headers, ['start', 'start date'], 3),
      );
      const project = cell(cells, headers, ['project', 'project name'], 1) ||
        findNameMatch(rowText, projects);
      const area = cell(cells, headers, ['area', 'location', 'work area'], 2) ||
        findNameMatch(rowText, projectAreas.map(areaItem => areaItem.name));
      const rawStatus = cell(cells, headers, ['status'], 7);
      const parsedStatus = normalizeStatus(rawStatus);
      const owner = cell(cells, headers, ['owner', 'responsible'], 6);
      const contractor = cell(cells, headers, ['contractor', 'company', 'trade'], 9) || owner;
      const wbs = cell(cells, headers, ['wbs', 'code', 'activity id'], 10);
      const milestone = cell(cells, headers, ['milestone'], 5);
      const parsedPercent = normalizePercent(
        cell(cells, headers, ['percent complete', '% complete', 'progress'], 11),
        parsedStatus,
      );
      const progress = reconcileScheduleProgress(parsedStatus, parsedPercent);
      const { status, percentComplete } = progress;
      const floatValue = parseDuration(
        cell(cells, headers, ['float', 'total float'], 12),
      );
      const criticalText = cell(cells, headers, ['critical', 'critical path'], 14);
      const notes = cell(cells, headers, ['notes', 'comments', 'remarks'], -1);
      const critical =
        normalized(criticalText).includes('yes') ||
        normalized(criticalText).includes('critical') ||
        floatValue === 0 ||
        normalizePriority('', finish) === 'High';

      if (!task && !milestone) return null;

      const reviewFields = reviewFieldsForTask({
        project,
        area,
        task: task || milestone,
        start,
        finish,
        owner: optionalText(owner),
        status,
      });
      const confidenceScore =
        35 +
        (task || milestone ? 15 : 0) +
        (project ? 10 : 0) +
        (area ? 10 : 0) +
        (start || finish ? 15 : 0) +
        (owner ? 5 : 0) +
        (reviewFields.length === 0 ? 10 : 0);
      const baseTask: Omit<PIENormalizedScheduleTask, 'sourceItem'> = {
        id: uid(),
        project,
        area,
        task: task || milestone || 'Imported schedule item',
        wbs: optionalText(wbs),
        milestone: optionalText(milestone),
        start: optionalText(start),
        finish: optionalText(finish),
        duration: parseDuration(cell(cells, headers, ['duration'], 15)),
        status,
        percentComplete,
        owner: optionalText(owner),
        contractor: optionalText(contractor),
        critical,
        float: floatValue,
        notes: optionalText(stripScheduleDependencyMetadata(notes)),
        needsReview: reviewFields.length > 0,
        reviewFields,
        confidence: confidenceFromScore(confidenceScore),
      };

      return scheduleItemFromNormalizedTask(baseTask, sourceName, importedAt);
    })
    .filter((item): item is ScheduleItem => Boolean(item));
  const intelligence = buildScheduleIntelligence({
    scheduleItems: normalizedTasks,
    projectName: '',
    now,
  });
  const parseReviewItems: PIEScheduleReviewItem[] = parseIssues.map(issue => ({
    id: `schedule-parse-review-${uid()}`,
    task: `Review imported schedule row ${issue.row}`,
    reason: issue.message,
    correctionFields: ['Task', 'Dates', 'Status'],
    confidence: 'low',
  }));
  const reviewItems = [...parseReviewItems, ...intelligence.reviewItems];
  const totalCandidateLines = Math.max(dataRecords.length, normalizedTasks.length);
  const needsReviewCount = reviewItems.length;
  const extractionConfidencePercent = normalizedTasks.length === 0
    ? 0
    : clamp(
        Math.round(
          (normalizedTasks.length / totalCandidateLines) * 100 -
            needsReviewCount * 6,
        ),
        1,
        100,
      );
  const importStatus: PIEScheduleImportStatus =
    normalizedTasks.length === 0
      ? scheduleType === 'unknown' || format.format === 'unknown'
        ? 'Unsupported Schedule'
        : 'Needs Review'
      : extractionConfidencePercent < 85 || needsReviewCount > 0
        ? 'Import Partial'
        : 'Import Successful';
  const upcomingActivities7Days = intelligence.scheduleSummary.upcomingTasks
    .filter(task => task.daysUntilDue !== null && task.daysUntilDue <= 7);
  const upcomingActivities14Days = intelligence.scheduleSummary.upcomingTasks
    .filter(task => task.daysUntilDue !== null && task.daysUntilDue <= 14);

  return {
    format,
    extraction,
    scheduleType,
    importStatus,
    extractionConfidencePercent,
    items: normalizedTasks,
    reviewItems,
    parseIssues,
    message: normalizedTasks.length
      ? `${normalizedTasks.length} schedule item${normalizedTasks.length === 1 ? '' : 's'} normalized through Schedule Intelligence.${parseIssues.length ? ` ${parseIssues.length} delimited row issue${parseIssues.length === 1 ? '' : 's'} need review.` : ''}`
      : 'No schedule activities were normalized. Review the file format and add uncertain items manually.',
    validationOutput: {
      scheduleSummary: intelligence.scheduleSummary,
      criticalActivities: intelligence.scheduleSummary.upcomingTasks
        .filter(task => task.item.priority === 'High' || task.item.notes.toLowerCase().includes('critical'))
        .slice(0, 12),
      overdueActivities: intelligence.scheduleSummary.overdueTasks,
      upcomingActivities7Days,
      upcomingActivities14Days,
      upcomingActivities30Days: intelligence.scheduleSummary.upcomingTasks,
      recommendedWalkAreas: intelligence.recommendedWalkAreas,
      recommendedInspectionAreas: intelligence.recommendedWalkAreas,
      executiveSummary: intelligence.executiveSummary,
    },
  };
}

function parseNotesValue(notes: string, label: string) {
  const match = notes.match(new RegExp(`${label}:\\s*([^.;]+)`, 'i'));

  return match?.[1]?.trim() || null;
}

function taskFromSummary(summaryTask: ScheduleSummaryTask): PIENormalizedScheduleTask {
  const item = summaryTask.item;
  const floatValue = parseDuration(parseNotesValue(item.notes, 'Float') || '');
  const duration = typeof item.durationDays === 'number'
    ? item.durationDays
    : parseDuration(parseNotesValue(item.notes, 'Duration') || '');
  const critical =
    item.priority === 'High' ||
    summaryTask.isOverdue ||
    item.status === 'Waiting' ||
    item.notes.toLowerCase().includes('critical: yes') ||
    floatValue === 0;
  const reviewFields = reviewFieldsForTask({
    project: item.projectName,
    area: item.locationName,
    task: item.taskName,
    start: item.startDate || null,
    finish: item.finishDate || null,
    owner: optionalText(item.owner),
    status: item.status,
  });
  const confidenceScore =
    40 +
    (item.taskName.trim() ? 15 : 0) +
    (item.projectName.trim() ? 10 : 0) +
    (item.locationName.trim() ? 10 : 0) +
    (item.startDate.trim() || item.finishDate.trim() ? 15 : 0) +
    (item.owner.trim() || item.contractor.trim() ? 5 : 0) -
    (summaryTask.isNeedsReview ? 20 : 0);

  return {
    id: item.id,
    project: item.projectName,
    area: item.locationName,
    task: item.taskName,
    wbs: parseNotesValue(item.notes, 'WBS'),
    milestone: optionalText(item.milestone),
    start: optionalText(item.startDate),
    finish: optionalText(item.finishDate),
    duration,
    status: item.status,
    percentComplete: item.percentComplete,
    owner: optionalText(item.owner),
    contractor: optionalText(item.contractor),
    critical,
    float: floatValue,
    notes: optionalText(stripScheduleDependencyMetadata(item.notes)),
    sourceItem: item,
    needsReview: summaryTask.isNeedsReview || reviewFields.length > 0,
    reviewFields,
    confidence: confidenceFromScore(confidenceScore),
  };
}

function uniqueText(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map(value => value?.trim()).filter(Boolean) as string[]),
  );
}

function topAreas(tasks: PIENormalizedScheduleTask[]) {
  const counts = new Map<string, number>();

  tasks.forEach(task => {
    if (!task.area.trim()) return;

    counts.set(task.area, (counts.get(task.area) || 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([area]) => area)
    .slice(0, 5);
}

export function buildScheduleIntelligence({
  scheduleItems = [],
  projectName = '',
  now = new Date(),
}: {
  scheduleItems?: ScheduleItem[];
  projectName?: string | null;
  now?: Date;
} = {}): PIEScheduleIntelligence {
  const scheduleSummary = buildScheduleSummary(scheduleItems, {
    projectName: projectName || undefined,
  });
  const summaryTasks = [
    ...scheduleSummary.upcomingTasks,
    ...scheduleSummary.overdueTasks,
    ...scheduleSummary.completedTasks,
    ...scheduleSummary.needsReviewTasks,
  ];
  const taskMap = new Map<string, PIENormalizedScheduleTask>();

  summaryTasks.forEach(task => {
    taskMap.set(task.item.id, taskFromSummary(task));
  });

  const normalizedTasks = Array.from(taskMap.values());
  const upcomingTasks = scheduleSummary.upcomingTasks
    .map(task => taskMap.get(task.item.id))
    .filter((task): task is PIENormalizedScheduleTask => Boolean(task))
    .slice(0, 12);
  const overdueTasks = scheduleSummary.overdueTasks
    .map(task => taskMap.get(task.item.id))
    .filter((task): task is PIENormalizedScheduleTask => Boolean(task))
    .slice(0, 12);
  const criticalTasks = normalizedTasks
    .filter(task => task.critical)
    .slice(0, 12);
  const milestones = scheduleSummary.milestoneTasks
    .map(task => taskMap.get(task.item.id) || taskFromSummary(task))
    .slice(0, 12);
  const reviewItems = normalizedTasks
    .filter(task => task.needsReview || task.confidence === 'low')
    .map(task => ({
      id: `review-${task.id}`,
      task: task.task,
      reason:
        task.reviewFields.length > 0
          ? `Low confidence schedule item needs correction for ${task.reviewFields.join(', ')}.`
          : 'Low confidence schedule item should be reviewed before DAVE relies on it.',
      correctionFields: task.reviewFields.length
        ? task.reviewFields
        : (['Project', 'Area', 'Dates', 'Task', 'Owner', 'Status'] as PIEScheduleReviewItem['correctionFields']),
      confidence: task.confidence,
    }));
  const recommendedWalkAreas = topAreas([
    ...overdueTasks,
    ...criticalTasks,
    ...upcomingTasks,
  ]);
  const highRiskCount = overdueTasks.length + criticalTasks.length;
  const confidenceScore =
    scheduleSummary.totalItems === 0
      ? 20
      : clamp(
          88 -
            scheduleSummary.needsReviewCount * 8 -
            scheduleSummary.missingProjectCount * 6 -
            scheduleSummary.missingAreaCount * 5,
          20,
          95,
        );
  const scheduleConfidence = confidenceFromScore(confidenceScore);
  const scheduleRisk =
    scheduleSummary.totalItems === 0
      ? 'No schedule evidence is available.'
      : highRiskCount > 0
        ? `${highRiskCount} overdue, waiting, high-priority, or critical schedule item${highRiskCount === 1 ? '' : 's'} need review.`
        : 'No high-risk schedule items are currently flagged.';
  const criticalPathSummary =
    criticalTasks.length > 0
      ? `${criticalTasks.length} critical path candidate${criticalTasks.length === 1 ? '' : 's'} identified from high priority, waiting, overdue, zero-float, or critical markers.`
      : 'No critical path candidates are currently identified.';
  const recommendedInspection =
    criticalTasks.find(task => task.task.toLowerCase().includes('inspection'))?.task ||
    upcomingTasks.find(task => task.task.toLowerCase().includes('inspection'))?.task ||
    (recommendedWalkAreas[0]
      ? `Walk ${recommendedWalkAreas[0]} and verify upcoming or overdue schedule work.`
      : 'No inspection recommendation is available until schedule areas or inspection tasks are present.');
  const executiveSummary =
    scheduleSummary.totalItems === 0
      ? 'There is no schedule to summarize yet.'
      : `${scheduleSummary.totalItems} schedule item${scheduleSummary.totalItems === 1 ? '' : 's'} understood: ${scheduleSummary.upcoming30Count} upcoming in 30 days, ${scheduleSummary.overdueCount} overdue, ${scheduleSummary.milestoneCount} milestone${scheduleSummary.milestoneCount === 1 ? '' : 's'}, confidence ${scheduleConfidence}.`;
  const missionBlockers = uniqueText([
    ...overdueTasks.slice(0, 3).map(task => `${task.task} is overdue (${dueStatusText(task.finish || '')}).`),
    ...criticalTasks.slice(0, 3).map(task => `${task.task} is critical or high-priority.`),
  ]);
  const missionActions = uniqueText([
    overdueTasks.length > 0 ? 'Review overdue schedule work and confirm recovery dates.' : null,
    criticalTasks.length > 0 ? 'Verify critical path tasks with the responsible owner and current field status.' : null,
    recommendedWalkAreas.length > 0 ? `Walk ${recommendedWalkAreas.slice(0, 2).join(', ')}.` : null,
    reviewItems.length > 0 ? 'Review low-confidence schedule import items before relying on the schedule.' : null,
  ]);
  const graphNodes = normalizedTasks.flatMap(task => {
    const nodes: PIEScheduleIntelligence['knowledgeGraphFeed']['nodes'] = [{
      id: `schedule:${task.id}`,
      type: task.milestone ? 'milestone' : 'schedule_item',
      label: task.task,
    }];

    if (task.area) {
      nodes.push({
        id: `area:${normalized(task.area)}`,
        type: 'area',
        label: task.area,
      });
    }

    if (task.contractor) {
      nodes.push({
        id: `contractor:${normalized(task.contractor)}`,
        type: 'contractor',
        label: task.contractor,
      });
    }

    return nodes;
  });
  const graphRelationships = normalizedTasks.flatMap(task => {
    const relationships: PIEScheduleIntelligence['knowledgeGraphFeed']['relationships'] = [];

    if (task.area) {
      relationships.push({
        from: `schedule:${task.id}`,
        to: `area:${normalized(task.area)}`,
        type: 'located_in',
      });
    }

    if (task.contractor) {
      relationships.push({
        from: `schedule:${task.id}`,
        to: `contractor:${normalized(task.contractor)}`,
        type: 'owned_by',
      });
    }

    return relationships;
  });

  return {
    pipeline: PIPELINE,
    generatedAt: now.toISOString(),
    projectName: projectName || 'All Projects',
    scheduleSummary,
    normalizedTasks,
    reviewItems,
    upcomingTasks,
    overdueTasks,
    criticalTasks,
    milestones,
    criticalPathSummary,
    scheduleRisk,
    recommendedInspection,
    recommendedWalkAreas,
    executiveSummary,
    scheduleConfidence,
    runtimeFeed: {
      scheduleSummary,
      upcomingTasks,
      overdueTasks,
      criticalTasks,
      milestones,
      recommendedWalkAreas,
      scheduleConfidence,
    },
    missionFeed: {
      recommendedMission: overdueTasks.length > 0
        ? 'schedule-recovery'
        : recommendedInspection.toLowerCase().includes('inspection')
          ? 'inspection-verification'
          : recommendedWalkAreas.length > 0
            ? 'project-walk'
            : 'monitoring',
      evidence: uniqueText([
        executiveSummary,
        criticalPathSummary,
        scheduleRisk,
      ]),
      blockers: missionBlockers,
      recommendedActions: missionActions,
    },
    executiveFeed: {
      executiveSummary,
      scheduleRisk,
      escalations: highRiskCount > 0 ? [scheduleRisk] : [],
      preparations: uniqueText([
        recommendedInspection,
        reviewItems.length > 0
          ? `${reviewItems.length} low-confidence schedule item${reviewItems.length === 1 ? '' : 's'} need review.`
          : null,
      ]),
    },
    knowledgeGraphFeed: {
      nodes: Array.from(
        new Map(graphNodes.map(node => [node.id, node])).values(),
      ),
      relationships: graphRelationships,
    },
  };
}
