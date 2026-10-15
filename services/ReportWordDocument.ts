import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { reportWordDocxImageType } from './ReportWordImageFormat';

export type ReportWordMediaKind = 'photo' | 'drawing';

export type ReportWordMedia = Readonly<{
  id: string;
  kind: ReportWordMediaKind;
  displayNumber?: number | null;
  caption: string;
  data: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  projectName?: string | null;
  areaName?: string | null;
  linkedTaskName?: string | null;
  recordedAt?: string | null;
  reasonForInclusion?: string | null;
  citation?: string | null;
}>;

export type ReportWordUnavailableMedia = Readonly<{
  id: string;
  kind: ReportWordMediaKind;
  label: string;
  reason: string;
}>;

export type ReportWordDocumentInput = Readonly<{
  title: string;
  body: string;
  generatedAt?: string | Date | null;
  media?: readonly ReportWordMedia[];
  unavailableMedia?: readonly ReportWordUnavailableMedia[];
}>;

export function summarizeReportWordUnavailableMedia(
  unavailable: readonly ReportWordUnavailableMedia[],
): string {
  if (!unavailable.length) return '';

  const counts = unavailable.reduce(
    (summary, item) => {
      const reason = item.reason.toLowerCase();
      if (/(iphone photo|heic|heif|convert)/.test(reason)) {
        summary.conversion += 1;
      } else if (/(protected|cloud|download failed|retriev|temporarily unavailable)/.test(reason)) {
        summary.retrieval += 1;
      } else {
        summary.other += 1;
      }
      return summary;
    },
    { conversion: 0, retrieval: 0, other: 0 },
  );

  return [
    counts.conversion > 0
      ? `${counts.conversion} iPhone photo${counts.conversion === 1 ? '' : 's'} could not be converted for Word.`
      : '',
    counts.retrieval > 0
      ? `${counts.retrieval} protected source file${counts.retrieval === 1 ? '' : 's'} could not be retrieved.`
      : '',
    counts.other > 0
      ? `${counts.other} report source image${counts.other === 1 ? '' : 's'} could not be prepared.`
      : '',
  ].filter(Boolean).join(' ');
}

const WORD_BLUE = '0B66D4';
const WORD_DARK_BLUE = '173B69';
const WORD_LIGHT_BLUE = 'EAF3FF';
const WORD_MUTED = '5F6B7A';
const WORD_BORDER = 'C8D8EC';
const NO_TABLE_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
} as const;

export function buildReportWordDocument(input: ReportWordDocumentInput): Document {
  const generatedAt = normalizedDate(input.generatedAt);
  // An image is embedded by what its bytes are, never by its label; one that
  // is no type Word can show is listed, not dropped (independent review R07).
  const embeddable = (input.media || []).filter(item => reportWordDocxImageType(item.data));
  const photos = embeddable.filter(item => item.kind === 'photo');
  const drawings = embeddable.filter(item => item.kind === 'drawing');
  const unavailable = [
    ...(input.unavailableMedia || []),
    ...(input.media || []).filter(item => !reportWordDocxImageType(item.data)).map(unembeddableMedia),
  ];

  return new Document({
    creator: 'Vitruvius Project Intelligence',
    title: input.title,
    subject: 'Project status report',
    description: 'A Vitruvius project report prepared from the current shared project record.',
    styles: {
      default: {
        document: {
          run: {
            font: 'Aptos',
            size: 21,
            color: '1C2430',
          },
          paragraph: {
            spacing: { after: 120, line: 292 },
          },
        },
      },
      paragraphStyles: [
        {
          id: 'ReportHeading1',
          name: 'Report Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            font: 'Aptos Display',
            bold: true,
            size: 30,
            color: WORD_DARK_BLUE,
          },
          paragraph: {
            spacing: { before: 240, after: 100 },
            keepNext: true,
          },
        },
        {
          id: 'ReportHeading2',
          name: 'Report Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            font: 'Aptos Display',
            bold: true,
            size: 25,
            color: WORD_DARK_BLUE,
          },
          paragraph: {
            spacing: { before: 190, after: 80 },
            keepNext: true,
          },
        },
        {
          id: 'ReportCaption',
          name: 'Report Caption',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            font: 'Aptos',
            italics: true,
            size: 18,
            color: WORD_MUTED,
          },
          paragraph: {
            spacing: { before: 60, after: 180 },
          },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'report-bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: 420, hanging: 220 },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720,
              right: 720,
              bottom: 720,
              left: 720,
            },
          },
        },
        headers: {
          default: buildHeader(),
        },
        footers: {
          default: buildFooter(),
        },
        children: [
          buildMasthead(),
          new Paragraph({
            children: [
              new TextRun({
                text: input.title.trim() || 'Project Status Report',
                bold: true,
                size: 38,
                color: WORD_DARK_BLUE,
                font: 'Aptos Display',
              }),
            ],
            spacing: { before: 280, after: 80 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Prepared ${generatedAt.toLocaleDateString(undefined, {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}`,
                color: WORD_MUTED,
                size: 19,
              }),
            ],
            spacing: { after: 260 },
          }),
          ...reportBodyParagraphs(input.body, photos),
          ...photoReferenceGuide(photos),
          ...mediaSection('Project Photos', photos),
          ...mediaSection('Current Drawing References', drawings),
          ...unavailableMediaSection(unavailable),
        ],
      },
    ],
  });
}

export async function buildReportWordBlob(
  input: ReportWordDocumentInput,
): Promise<Blob> {
  return Packer.toBlob(buildReportWordDocument(input));
}

export async function buildReportWordBase64(
  input: ReportWordDocumentInput,
): Promise<string> {
  return Packer.toBase64String(buildReportWordDocument(input));
}

function buildHeader() {
  return new Header({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: 'VITRUVIUS  |  PROJECT INTELLIGENCE',
            bold: true,
            size: 16,
            color: WORD_DARK_BLUE,
            characterSpacing: 80,
          }),
        ],
        border: {
          bottom: {
            color: WORD_BORDER,
            style: BorderStyle.SINGLE,
            size: 8,
            space: 6,
          },
        },
        spacing: { after: 90 },
      }),
    ],
  });
}

function buildFooter() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: 'Vitruvius Project Intelligence  •  ',
            color: WORD_MUTED,
            size: 16,
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            color: WORD_MUTED,
            size: 16,
          }),
        ],
      }),
    ],
  });
}

function buildMasthead() {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 11, type: WidthType.PERCENTAGE },
            shading: {
              type: ShadingType.CLEAR,
              fill: WORD_BLUE,
              color: 'auto',
            },
            verticalAlign: 'center',
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: 'V',
                    bold: true,
                    size: 34,
                    color: 'FFFFFF',
                    font: 'Aptos Display',
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 89, type: WidthType.PERCENTAGE },
            shading: {
              type: ShadingType.CLEAR,
              fill: WORD_LIGHT_BLUE,
              color: 'auto',
            },
            margins: {
              top: 110,
              bottom: 110,
              left: 180,
              right: 160,
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'Vitruvius',
                    bold: true,
                    size: 26,
                    color: WORD_DARK_BLUE,
                    font: 'Aptos Display',
                  }),
                ],
                spacing: { after: 0 },
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'Project Intelligence',
                    size: 17,
                    color: WORD_MUTED,
                  }),
                ],
                spacing: { after: 0 },
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function reportBodyParagraphs(
  body: string,
  photos: readonly ReportWordMedia[] = [],
) {
  const lines = addInlinePhotoReferences(
    body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trimEnd()),
    photos,
  );
  const paragraphs: Paragraph[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      paragraphs.push(new Paragraph({ text: '', spacing: { after: 40 } }));
      continue;
    }

    const markdownHeading = line.match(/^(#{1,6})\s+(.+)$/);
    if (markdownHeading) {
      paragraphs.push(new Paragraph({
        text: markdownHeading[2],
        style: markdownHeading[1].length <= 2 ? 'ReportHeading1' : 'ReportHeading2',
      }));
      continue;
    }

    if (isSectionHeading(line)) {
      paragraphs.push(new Paragraph({
        text: titleCaseHeading(line),
        style: 'ReportHeading1',
      }));
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      paragraphs.push(new Paragraph({
        text: bullet[1],
        numbering: { reference: 'report-bullets', level: 0 },
        spacing: { after: 70 },
      }));
      continue;
    }

    paragraphs.push(new Paragraph({
      children: [new TextRun({ text: line })],
      spacing: { after: 110 },
    }));
  }

  return paragraphs;
}

function addInlinePhotoReferences(
  lines: readonly string[],
  photos: readonly ReportWordMedia[],
): string[] {
  const numbered = numberedReportPhotos(photos);
  if (!numbered.length) return [...lines];

  const eligibleSections = new Set([
    'COMPLETED WORK',
    'CURRENT WORK',
    'RECENT CHANGES',
    'IMMEDIATE ATTENTION',
    'ACTION PLAN',
    'NEXT ACTIONS',
    'SCHEDULE RISKS',
    'RISKS AND DECISIONS',
    'RISKS',
    'DECISIONS REQUIRED',
  ]);
  const sectionByLine = new Map<number, string>();
  let currentSection = '';

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (isSectionHeading(line)) currentSection = line.toUpperCase();
    sectionByLine.set(index, currentSection);
  });

  const referencesByLine = new Map<number, number[]>();
  const preparedLines = new Map<number, PreparedReportLine>();
  for (const photo of numbered) {
    const target = reportPhotoMatchTarget(photo.item);
    if (!target) continue;
    const matches: Array<{ index: number; match: ReportLineMatch }> = [];
    lines.forEach((rawLine, index) => {
      const section = sectionByLine.get(index) || '';
      if (!eligibleSections.has(section)) return;
      let prepared = preparedLines.get(index);
      if (!prepared) {
        prepared = prepareReportLine(rawLine, section);
        preparedLines.set(index, prepared);
      }
      const match = reportLinePhotoMatch(prepared, target);
      if (match) matches.push({ index, match });
    });
    // N773b (R5): a line printing the photo's own area takes the photo from lines of a same-named task printed in
    // another area or with none ("Level 2 (Level 2)" over "Level 2 (Lobby)" and "Level 2: In Progress ...").
    const ownAreaLine = matches.some(({ match }) => match === 'area');
    for (const { index, match } of matches) {
      if (ownAreaLine && match === 'other area') continue;
      const existing = referencesByLine.get(index) || [];
      if (existing.includes(photo.number)) continue;
      referencesByLine.set(index, [...existing, photo.number]);
    }
  }

  return lines.map((line, index) => {
    const photoNumbers = referencesByLine.get(index);
    if (!photoNumbers?.length) return line;
    return `${line.trimEnd()} ${photoReferenceSentence(photoNumbers)}`;
  });
}

/**
 * How a report line names a photo's task (open item 7.73, reports review pass 3 P3-2; N773b). It said a photo "shows
 * this work" on any line naming the photo's project and area, so in a combined report (every task line names its
 * project) and on a single project's Action Plan line, a photo whose field update has no task was said to show the work
 * of every task of its area, and a task's photo that of a task or project whose name contains its own ("Paint" in "Paint
 * lobby", "Lark Hill" in "Lark Hill Annex"). Now a photo whose update is linked to no task shows no task's work; otherwise
 * the line must be its task's, as the report writes a task's line (reportLinePhotoMatch), and name the photo's area as
 * whole words. Every line that names a photo named it before 7.73 too (1f445154); the photo's own citation ("See Image
 * N") is in the report's words and does not move.
 *  - 'area': the line prints the task's area, and it is the photo's area;
 *  - 'other area': the line is of a form that always prints its task's area (Completed / Current Work, Schedule Risks,
 *    Action Plan), and prints another area or none: a same-named task elsewhere, unless the photo was recorded away from
 *    its task's area (7.75: the Word file knows the photo's area and task name, not which task);
 *  - 'unknown': a line that may leave out its task's area (a risk stated about the task, Decisions Required).
 */
type ReportLineMatch = 'area' | 'unknown' | 'other area';
const REPORT_LINE_MATCH_RANK: Readonly<Record<ReportLineMatch, number>> = { 'other area': 1, unknown: 2, area: 3 };

type ReportPhotoMatchTarget = Readonly<{
  project: string;
  area: string;
  /** The photo's area as it records it ("Unit 4 (rear"): read after a task in brackets, whatever its own (P2-1). */
  areaText: string;
  /** The task's name with letters and digits of any script ("Покраска" is a name, R1), and as Latin letters only. */
  task: string;
  taskLatin: string;
  /** "Paint (west wall)": a task whose own name ends in brackets (R5b). */
  taskEndsInBracket: boolean;
}>;

function reportPhotoMatchTarget(photo: ReportWordMedia): ReportPhotoMatchTarget | null {
  const project = normalizedReportMatchText(photo.projectName || '');
  const area = normalizedReportMatchText(photo.areaName || '');
  const taskName = (photo.linkedTaskName || '').trim();
  const task = matchTextByPosition(taskName, true).text.trim();
  if (!project || !area || !task) return null;
  return {
    project,
    area,
    areaText: (photo.areaName || '').trim(),
    task,
    taskLatin: normalizedReportMatchText(taskName),
    taskEndsInBracket: taskName.endsWith(')'),
  };
}

/** A report line read once for every photo: its separators and its names by position (R7: no slice is normalized again). */
type PreparedReportLine = Readonly<{
  text: string;
  /** ` ${normalizedReportMatchText(line)} `: the photo's area is looked for here as whole words. */
  words: string;
  latin: ReportMatchText;
  letters: ReportMatchText;
  /** Where each ": " starts; where a project's name may end (" — ", ": "); each ". Issue: "; where a task's name may end
   * (" (", ": ", " is ", " has ", ". Issue: "). */
  colons: readonly number[];
  projectEnds: readonly number[];
  issues: readonly number[];
  taskEnds: readonly number[];
  /** " (<area>): ", " (<area>) is ", " (<area>) has ": where the area a task line prints after the task begins and ends. */
  areaAfter: ReadonlyMap<number, readonly [number, number]>;
  /** A line of DECISIONS REQUIRED ("<project> — <task>: <action>"): there ": " ends a task's name (P2-2). */
  decisions: boolean;
}>;

/** " (<area>): ", " (<area>) is ", " (<area>) has ": the area a task line prints after the task (one nested pair kept). */
const REPORT_TASK_AREA_THEN_TEXT = / \(((?:[^()]|\([^()]*\))*)\)(?:: | is | has )/y;
/** What Completed / Current Work prints after a task with no area: "<status>; N% complete" (reportTaskFact). */
const REPORT_TASK_FACT_STATUS = /(?:Not Started|In Progress|Waiting|Complete); \d{1,3}% complete/y;

/** What a task line prints after its area in brackets: ": " (Completed / Current Work), " is ", " has " (Schedule Risks). */
const REPORT_TASK_AREA_FOLLOWERS = [': ', ' is ', ' has '] as const;

function prepareReportLine(rawLine: string, section: string): PreparedReportLine {
  const text = rawLine.trim().replace(/^[-*•]\s+/, '');
  const starts = (separator: string) => {
    const found: number[] = [];
    for (let index = text.indexOf(separator, 1); index >= 0; index = text.indexOf(separator, index + 1)) found.push(index);
    return found;
  };
  const colons = starts(': ');
  const issues = starts('. Issue: ');
  const parens = starts(' (');
  const areaAfter = new Map<number, readonly [number, number]>();
  for (const paren of parens) {
    REPORT_TASK_AREA_THEN_TEXT.lastIndex = paren;
    const area = REPORT_TASK_AREA_THEN_TEXT.exec(text);
    if (area) areaAfter.set(paren, [paren + 2, paren + 2 + area[1].length]);
  }
  const sorted = (...lists: number[][]) => Array.from(new Set(lists.flat())).sort((a, b) => a - b);
  return {
    text,
    words: ` ${normalizedReportMatchText(rawLine)} `,
    latin: matchTextByPosition(text, false),
    letters: matchTextByPosition(text, true),
    colons,
    projectEnds: sorted(starts(' — '), colons),
    issues,
    taskEnds: sorted(parens, colons, starts(' is '), starts(' has '), issues),
    areaAfter,
    decisions: section === 'DECISIONS REQUIRED',
  };
}

/**
 * Whether, and how, a line is this photo's task's line, as the report writes a task: "<project> — <task> (<area>): …"
 * (Completed / Current Work; "<task>: <status>; N% complete" with no area), "<project> — <task> (<area>) is overdue …"
 * (Schedule Risks), "<project>: <task> (<area>): …" (a risk the project's records state about the task), "<project> —
 * <task>: …" (Decisions Required), "<project> — <area>: <task>. Issue: …" / "<project>: <task>. Issue: …" (Action
 * Plan). The project is the whole name before its " — " or ": ", the task the whole name up to where the report ends it.
 * N773b: the task's name keeps letters of any script (R1); an Action Plan line's area may hold ": " ("Bldg A: Level 2",
 * R4), and its area is never read as a task (R5a); a task read up to ": ", " is ", " has " does not take in the
 * line's "(<area>)" ("Paint (Lobby)" is not "Paint lobby", R5b). Each name is compared where it stands on the line,
 * read once (R7). N773c: the photo's own area is read after the task whatever brackets it holds (P2-1); a " — " line
 * ends a task at ": " only before its status or in Decisions Required (P2-2); an Action Plan area ends at a later ": "
 * only where it is the photo's own (P2-3); names keep the marks of other scripts (P2-4).
 */
function reportLinePhotoMatch(line: PreparedReportLine, photo: ReportPhotoMatchTarget): ReportLineMatch | null {
  if (!line.words.includes(` ${photo.area} `)) return null;
  const { text } = line;
  let best: ReportLineMatch | null = null;
  const take = (match: ReportLineMatch) => {
    if (!best || REPORT_LINE_MATCH_RANK[match] > REPORT_LINE_MATCH_RANK[best]) best = match;
  };
  const namesTask = (start: number, end: number) =>
    reportMatchTextEquals(line.letters, start, end, photo.task) &&
    reportMatchTextEquals(line.latin, start, end, photo.taskLatin);
  const areaMatch = (start: number, end: number): ReportLineMatch =>
    reportMatchTextEquals(line.latin, start, end, photo.area) ? 'area' : 'other area';

  for (const projectEnd of line.projectEnds) {
    if (!reportMatchTextEquals(line.latin, 0, projectEnd, photo.project)) continue;
    const dash = text.startsWith(' — ', projectEnd);
    const start = projectEnd + (dash ? 3 : 2);

    // Action Plan: "<project> — <area>: <task>. Issue: …", trying each ": " before the ". Issue: " as the area's end. A
    // later ": " ends it only where the text before it is the photo's own area ("Bldg A: Level 2"): "Building A: Level 3:
    // Drywall" is the task "Level 3: Drywall" in Building A, not Drywall in "Building A: Level 3" (P2-3).
    let actionPlan = false;
    let issue = 0;
    let laterColon = false;
    for (const colon of line.colons) {
      if (colon < start) continue;
      while (issue < line.issues.length && line.issues[issue] < colon + 2) issue += 1;
      if (issue >= line.issues.length) break;
      if (dash) actionPlan = true;
      const later = laterColon;
      laterColon = true;
      if (!namesTask(colon + 2, line.issues[issue])) continue;
      const area = areaMatch(start, colon);
      if (!later || area === 'area') take(area);
    }
    // There the text before ": " is the area, never a task (a task named "Roof" in area Roof is not "Roof: Flashing").
    if (actionPlan) continue;

    for (const end of line.taskEnds) {
      if (end <= start) continue;
      // The photo's own area after the task, as the photo records it, whatever brackets it holds: "Paint (Unit 4 (rear):
      // …", "Paint (Lot 3)) is overdue …" (P2-1; the reading below keeps one level of paired brackets).
      const close = end + 2 + photo.areaText.length;
      if (text.startsWith(' (', end) && text.startsWith(')', close) &&
        REPORT_TASK_AREA_FOLLOWERS.some(follower => text.startsWith(follower, close + 1)) &&
        text.startsWith(photo.areaText, end + 2) && namesTask(start, end)) take('area');
      const area = line.areaAfter.get(end);
      if (area) {
        if (namesTask(start, end)) take(areaMatch(area[0], area[1]));
        continue;
      }
      if (text.startsWith(' (', end)) continue;
      if (text.startsWith('. Issue: ', end)) {
        if (namesTask(start, end)) take(dash ? 'unknown' : 'other area');
        continue;
      }
      // "Paint (Lobby): …" is the task Paint in Lobby, not a task "Paint lobby", unless the task's own name ends in brackets.
      if (text[end - 1] === ')' && !photo.taskEndsInBracket) continue;
      if (!namesTask(start, end)) continue;
      if (text.startsWith(': ', end)) {
        // "<project> — <task>: …" ends the task at ": " only where the report writes one there: before its status (a
        // task with no area) or in Decisions Required. "Electrical: trim (Level 2): …" is not Electrical's line (P2-2).
        REPORT_TASK_FACT_STATUS.lastIndex = end + 2;
        if (!dash) take('unknown');
        else if (REPORT_TASK_FACT_STATUS.test(text)) take('other area');
        else if (line.decisions) take('unknown');
      } else {
        take(dash ? 'other area' : 'unknown');
      }
    }
  }
  return best;
}

/**
 * A text's letters and digits by position, as normalizedReportMatchText reads them (accents dropped, "&" as AND, the
 * rest as single spaces, upper case), with Latin letters only or letters of any script: `at[i]` is how much of `text`
 * comes before the value's i-th character, so any part of the value reads as `text.slice(at[start], at[end])`, trimmed.
 */
type ReportMatchText = Readonly<{ text: string; at: Int32Array }>;

const REPORT_MATCH_LATIN = /[A-Za-z0-9]/;
/** Letters, digits and marks of any script: a Hindi vowel sign, a Thai vowel, a Japanese voicing mark are part of a
 * name ("\u0915\u093e\u092e" is not "\u0915\u092e"); only the Latin accents are dropped, as in the Latin reading (P2-4). */
const REPORT_MATCH_ANY_SCRIPT = /[\p{L}\p{N}\p{M}]/u;
const REPORT_MATCH_LATIN_MARK = /[\u0300-\u036f]/;

function matchTextByPosition(value: string, anyScript: boolean): ReportMatchText {
  const at = new Int32Array(value.length + 1);
  const keep = anyScript ? REPORT_MATCH_ANY_SCRIPT : REPORT_MATCH_LATIN;
  let text = '';
  const add = (part: string) => {
    if (part !== ' ') text += part;
    else if (text && !text.endsWith(' ')) text += ' ';
  };
  let index = 0;
  for (const character of value) {
    at[index] = text.length;
    if (character.length > 1) at[index + 1] = text.length;
    index += character.length;
    const code = character.charCodeAt(0);
    const parts = code < 128 ? character : character.normalize('NFKD');
    for (const part of parts) {
      if (REPORT_MATCH_LATIN_MARK.test(part)) continue;
      if (part === '&') {
        add(' '); add('AND'); add(' ');
      } else if (keep.test(part)) {
        add(part.toUpperCase());
      } else {
        add(' ');
      }
    }
  }
  at[value.length] = text.length;
  return { text, at };
}

/** Whether `value.slice(start, end)` reads as `target` (a name read as matchTextByPosition / normalizedReportMatchText do). */
function reportMatchTextEquals(value: ReportMatchText, start: number, end: number, target: string): boolean {
  let from = value.at[start];
  let to = value.at[end];
  if (from < to && value.text.charCodeAt(from) === 32) from += 1;
  if (to > from && value.text.charCodeAt(to - 1) === 32) to -= 1;
  return to - from === target.length && value.text.startsWith(target, from);
}

function photoReferenceGuide(
  photos: readonly ReportWordMedia[],
): Paragraph[] {
  const numbered = numberedReportPhotos(photos);
  if (!numbered.length) return [];

  const groups = new Map<string, {
    projectName: string;
    areaName: string;
    taskName: string;
    reason: string;
    numbers: number[];
  }>();

  numbered.forEach(({ item, number }) => {
    const projectName = item.projectName?.trim() || 'Project not identified';
    const areaName = item.areaName?.trim() || 'Area not identified';
    const taskName = item.linkedTaskName?.trim() || '';
    const key = [
      normalizedReportMatchText(projectName),
      normalizedReportMatchText(areaName),
      normalizedReportMatchText(taskName),
    ].join('|');
    const existing = groups.get(key);
    if (existing) {
      existing.numbers.push(number);
      return;
    }
    groups.set(key, {
      projectName,
      areaName,
      taskName,
      reason: item.reasonForInclusion?.trim() || '',
      numbers: [number],
    });
  });

  return [
    new Paragraph({
      text: 'Photo Reference Guide',
      style: 'ReportHeading1',
    }),
    new Paragraph({
      text:
        'Use these numbered references to connect each image to the project work it documents. ' +
        'Only photos with matching project and area records are grouped together.',
      spacing: { after: 100 },
    }),
    ...Array.from(groups.values()).map(group => {
      const context = [
        group.projectName,
        group.areaName,
        group.taskName,
      ].filter(Boolean).join(' — ');
      const reason = group.reason
        ? ` ${group.reason}`
        : ' These photos support the recorded field condition for this work area.';
      return new Paragraph({
        children: [
          new TextRun({
            text: `${photoReferenceLabel(group.numbers)} — ${context}.`,
            bold: true,
          }),
          new TextRun({ text: reason }),
        ],
        numbering: { reference: 'report-bullets', level: 0 },
        spacing: { after: 90 },
      });
    }),
  ];
}

function numberedReportPhotos(photos: readonly ReportWordMedia[]) {
  return photos.map((item, index) => ({
    item,
    number: item.displayNumber || index + 1,
  }));
}

function photoReferenceSentence(numbers: readonly number[]) {
  return `${photoReferenceLabel(numbers)} ${numbers.length === 1 ? 'shows' : 'show'} this work.`;
}

function photoReferenceLabel(numbers: readonly number[]) {
  const uniqueNumbers = Array.from(new Set(numbers)).sort((a, b) => a - b);
  if (uniqueNumbers.length === 1) return `Photo ${uniqueNumbers[0]}`;
  if (uniqueNumbers.length === 2) {
    return `Photos ${uniqueNumbers[0]} and ${uniqueNumbers[1]}`;
  }
  return `Photos ${uniqueNumbers.slice(0, -1).join(', ')}, and ${uniqueNumbers.at(-1)}`;
}

function normalizedReportMatchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' AND ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function mediaSection(
  title: string,
  media: readonly ReportWordMedia[],
): Array<Paragraph | Table> {
  if (!media.length) return [];
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      text: title,
      style: 'ReportHeading1',
      pageBreakBefore: true,
    }),
  ];

  media.forEach((item, index) => {
    const dimensions = wordImageDimensions(item.width, item.height);
    const type = reportWordDocxImageType(item.data);
    if (!type) return;
    const mediaLabel = item.kind === 'photo'
      ? `Photo ${item.displayNumber || index + 1}`
      : `Drawing excerpt ${index + 1}`;
    const context = [
      item.projectName?.trim() ? `Project: ${item.projectName.trim()}` : '',
      item.areaName?.trim() ? `Area: ${item.areaName.trim()}` : '',
      item.linkedTaskName?.trim() ? `Task: ${item.linkedTaskName.trim()}` : '',
      item.recordedAt?.trim() ? `Recorded: ${item.recordedAt.trim()}` : '',
    ].filter(Boolean).join('  •  ');
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: NO_TABLE_BORDERS,
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              margins: {
                top: 160,
                bottom: 180,
                left: 0,
                right: 0,
              },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: mediaLabel,
                      bold: true,
                      size: 24,
                      color: WORD_DARK_BLUE,
                    }),
                  ],
                  spacing: { after: 80 },
                }),
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new ImageRun({
                      type,
                      data: item.data,
                      transformation: dimensions,
                      altText: {
                        title: item.caption || title,
                        description: item.citation || item.caption || title,
                        name: `${item.kind}-${item.id}`,
                      },
                    }),
                  ],
                  spacing: { after: 30 },
                }),
                new Paragraph({
                  style: 'ReportCaption',
                  children: [
                    new TextRun({ text: 'Recorded description: ', bold: true }),
                    new TextRun({
                      text: item.caption.trim(),
                    }),
                  ],
                }),
                ...(context ? [
                  new Paragraph({
                    style: 'ReportCaption',
                    children: [new TextRun({ text: context })],
                  }),
                ] : []),
                ...(item.reasonForInclusion?.trim() ? [
                  new Paragraph({
                    style: 'ReportCaption',
                    children: [
                      new TextRun({ text: 'Why this image is included: ', bold: true }),
                      new TextRun({ text: item.reasonForInclusion.trim() }),
                    ],
                  }),
                ] : []),
                ...(item.citation?.trim() ? [
                  new Paragraph({
                    style: 'ReportCaption',
                    children: [
                      new TextRun({ text: 'Source: ', bold: true }),
                      new TextRun({ text: item.citation.trim() }),
                    ],
                  }),
                ] : []),
              ],
            }),
          ],
        }),
      ],
    }));
  });
  return children;
}

function unavailableMediaSection(
  unavailable: readonly ReportWordUnavailableMedia[],
): Paragraph[] {
  if (!unavailable.length) return [];
  return [
    new Paragraph({
      text: 'Media Requiring Review',
      style: 'ReportHeading1',
    }),
    new Paragraph({
      text: 'The following report source images could not be embedded. Each item includes the actual failure reason so the report does not imply that an image is present when it is not.',
      spacing: { after: 100 },
    }),
    ...unavailable.map(item => new Paragraph({
      text: `${item.label}: ${item.reason}`,
      numbering: { reference: 'report-bullets', level: 0 },
      spacing: { after: 70 },
    })),
  ];
}

function unembeddableMedia(item: ReportWordMedia): ReportWordUnavailableMedia {
  const caption = item.caption.trim();
  return {
    id: item.id,
    kind: item.kind,
    label: item.kind === 'photo' && item.displayNumber
      ? `Photo ${item.displayNumber}${caption ? ` — ${caption}` : ''}`
      : caption || item.citation?.trim() || 'Report image',
    reason: 'The image data is not a JPEG, PNG, GIF or BMP, so Word could not show it. It was left out.',
  };
}

function wordImageDimensions(width: number, height: number) {
  const safeWidth = Math.max(1, width || 1);
  const safeHeight = Math.max(1, height || 1);
  const maxWidth = 600;
  const maxHeight = 500;
  const scale = Math.min(1, maxWidth / safeWidth, maxHeight / safeHeight);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function isSectionHeading(value: string) {
  return value.length <= 80 &&
    /[A-Z]/.test(value) &&
    value === value.toUpperCase() &&
    !/[.!?]$/.test(value);
}

function titleCaseHeading(value: string) {
  return value
    .toLowerCase()
    .replace(/\b\w/g, character => character.toUpperCase());
}

function normalizedDate(value: string | Date | null | undefined) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}
