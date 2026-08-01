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
  const photos = (input.media || []).filter(item => item.kind === 'photo');
  const drawings = (input.media || []).filter(item => item.kind === 'drawing');
  const unavailable = input.unavailableMedia || [];

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
  for (const photo of numbered) {
    lines.forEach((rawLine, index) => {
      const section = sectionByLine.get(index) || '';
      if (!eligibleSections.has(section)) return;
      if (!reportLineMatchesPhotoContext(rawLine, photo.item)) return;
      const existing = referencesByLine.get(index) || [];
      if (existing.includes(photo.number)) return;
      referencesByLine.set(index, [...existing, photo.number]);
    });
  }

  return lines.map((line, index) => {
    const photoNumbers = referencesByLine.get(index);
    if (!photoNumbers?.length) return line;
    return `${line.trimEnd()} ${photoReferenceSentence(photoNumbers)}`;
  });
}

function reportLineMatchesPhotoContext(
  line: string,
  photo: ReportWordMedia,
): boolean {
  const normalizedLine = normalizedReportMatchText(line);
  if (!normalizedLine) return false;

  const project = normalizedReportMatchText(photo.projectName || '');
  const area = normalizedReportMatchText(photo.areaName || '');
  const task = normalizedReportMatchText(photo.linkedTaskName || '');
  if (!project || !area) return false;
  if (!normalizedLine.includes(project) || !normalizedLine.includes(area)) {
    return false;
  }
  return task ? normalizedLine.includes(task) : true;
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
    const type = docxImageType(item.mimeType);
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

function docxImageType(
  mimeType: string,
): 'jpg' | 'png' | 'gif' | 'bmp' | null {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('bmp')) return 'bmp';
  return null;
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
