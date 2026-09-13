export type ECOSControlledConflictFixtureSource = Readonly<{
  id: string;
  sourceType: "project" | "schedule" | "update" | "memory" | "document";
  recordId: string;
  title: string;
  excerpt: string;
  updatedAt: string | null;
  score: number;
  documentCitation?: Readonly<{
    documentId: string;
    documentName: string;
    revision: string | null;
    pageNumber: number;
    sheetNumber: string | null;
    regionId: string | null;
    label: string;
  }>;
  extractionConfidence?: number | null;
  documentLimitations?: readonly string[];
  scheduleData?: Readonly<{
    taskName: string;
    itemType: string | null;
    locationName: string | null;
    status: string | null;
    percentComplete: number | null;
    startDate: string | null;
    finishDate: string | null;
    baselineStartDate: string | null;
    baselineFinishDate: string | null;
    wbsCode: string | null;
    durationDays: number | null;
    dependencies: readonly string[];
    isMilestone: boolean;
    isSummary: boolean;
  }>;
  progressData?: Readonly<{
    recordKind: "update" | "memory";
    taskName: string | null;
    locationName: string | null;
    status: string | null;
    occurredAt: string | null;
    notes: string | null;
    observation: string | null;
    actionKind: string | null;
    actionText: string | null;
    photoCount: number;
    photoSummaries: readonly string[];
  }>;
}>;

export type ECOSControlledConflictFixture = Readonly<{
  id: string;
  question: string;
  sources: readonly ECOSControlledConflictFixtureSource[];
}>;

const FIXTURE_VERSION = "ecos-controlled-conflict-fixture/1.0";

const FIXTURES: Readonly<Record<string, ECOSControlledConflictFixture>> = Object
  .freeze({
    "conflict-01": Object.freeze({
      id: "conflict-01",
      question:
        "The drawing says six inches but a field note says four. What should the crew use?",
      sources: Object.freeze([
        documentSource({
          id: "drawing-c-5.1-r4",
          title: "Current civil drawing C-5.1 · North Lot concrete",
          excerpt:
            "Current civil drawing C-5.1, Revision 4, issued 2026-09-01. North Lot new concrete slab thickness: 6 inches. Authority: current design requirement. This drawing has not been revised by the field note.",
          updatedAt: "2026-09-01T12:00:00.000Z",
          revision: "4",
          pageNumber: 5,
          sheetNumber: "C-5.1",
        }),
        memorySource({
          id: "field-note-north-lot-depth",
          title: "Open field note · North Lot concrete depth",
          excerpt:
            "Field note dated 2026-09-04. A North Lot spot check recorded concrete depth of 4 inches. Status: open. Authority: reported field observation only; this note is not an approved design change and does not resolve the discrepancy with current drawing C-5.1.",
          updatedAt: "2026-09-04T16:30:00.000Z",
          locationName: "2375 North Lot",
          status: "Open",
          observation:
            "Spot check recorded 4 inches against the current 6-inch drawing requirement.",
        }),
      ]),
    }),
    "conflict-02": Object.freeze({
      id: "conflict-02",
      question:
        "The task is complete but the inspection failed. Is the work signed off?",
      sources: Object.freeze([
        scheduleSource({
          id: "schedule-firestopping-complete",
          title: "Firestopping installation",
          excerpt:
            "Schedule activity Firestopping installation. Status: Complete. Percent complete: 100%. Last schedule update: 2026-09-05. Inspection acceptance: not recorded in this schedule activity.",
          updatedAt: "2026-09-05T15:00:00.000Z",
          taskName: "Firestopping installation",
          status: "Complete",
          percentComplete: 100,
        }),
        memorySource({
          id: "inspection-firestopping-failed",
          title: "Firestopping inspection result",
          excerpt:
            "Firestopping inspection performed 2026-09-06. Result: Failed. Corrections are required before reinspection. Final acceptance and sign-off were not granted.",
          updatedAt: "2026-09-06T18:00:00.000Z",
          locationName: "Building interior",
          status: "Open",
          observation:
            "Inspection failed; corrections and reinspection are required before sign-off.",
        }),
      ]),
    }),
    "conflict-03": Object.freeze({
      id: "conflict-03",
      question:
        "An approved RFI changes the detail on the drawing. Which requirement controls?",
      sources: Object.freeze([
        documentSource({
          id: "drawing-s-3.2-r2",
          title: "Current structural drawing S-3.2",
          excerpt:
            "Structural drawing S-3.2, Revision 2, issued 2026-08-20. Detail 7 requires a 6-inch curb at the 2375 North Lot equipment pad.",
          updatedAt: "2026-08-20T12:00:00.000Z",
          revision: "2",
          pageNumber: 3,
          sheetNumber: "S-3.2",
        }),
        documentSource({
          id: "approved-rfi-017",
          title: "Approved RFI-017 · Equipment-pad curb revision",
          excerpt:
            "RFI-017 for 2375 Compliance Project was approved 2026-09-03 by the authorized design reviewer. Scope: 2375 North Lot equipment-pad curb, Structural Sheet S-3.2 Revision 2, Detail 7. Approved response: use an 8-inch curb. Governing effect: RFI-017 supersedes the 6-inch requirement in Detail 7 only for this verified scope; all other drawing requirements remain unchanged.",
          updatedAt: "2026-09-03T20:00:00.000Z",
          revision: "Approved 2026-09-03",
          pageNumber: 1,
          sheetNumber: "RFI-017",
        }),
      ]),
    }),
    "conflict-04": Object.freeze({
      id: "conflict-04",
      question:
        "Two documents are marked current and show different dimensions. What is required?",
      sources: Object.freeze([
        documentSource({
          id: "current-detail-a-5.1-r3",
          title: "Current architectural drawing A-5.1",
          excerpt:
            "Architectural drawing A-5.1, Revision 3, marked Current, issued 2026-09-02. Detail 4 shows a 6-inch wall curb at the loading area.",
          updatedAt: "2026-09-02T14:00:00.000Z",
          revision: "3",
          pageNumber: 5,
          sheetNumber: "A-5.1",
        }),
        documentSource({
          id: "current-detail-s-5.1-r3",
          title: "Current structural drawing S-5.1",
          excerpt:
            "Structural drawing S-5.1, Revision 3, marked Current, issued 2026-09-02. Detail 9 shows an 8-inch wall curb at the same loading-area location. No approved resolution or governing revision is present in the authorized evidence.",
          updatedAt: "2026-09-02T14:05:00.000Z",
          revision: "3",
          pageNumber: 5,
          sheetNumber: "S-5.1",
        }),
      ]),
    }),
    "conflict-05": Object.freeze({
      id: "conflict-05",
      question:
        "The schedule and a field update disagree about percent complete. What is the current status?",
      sources: Object.freeze([
        scheduleSource({
          id: "schedule-roofing-eighty-percent",
          title: "Roofing installation schedule activity",
          excerpt:
            "Schedule activity Roofing installation. Schedule snapshot updated 2026-09-08. Status: In Progress. Percent complete: 80%. This is the current schedule record and is not an inspection acceptance record.",
          updatedAt: "2026-09-08T17:00:00.000Z",
          taskName: "Roofing installation",
          status: "In Progress",
          percentComplete: 80,
        }),
        updateSource({
          id: "field-update-roofing-sixty-percent",
          title: "Roofing installation field update",
          excerpt:
            "Field update dated 2026-09-10 for Roofing installation. Field-reported progress: 60% complete. The update is newer than the 2026-09-08 schedule snapshot and does not overwrite or revise the schedule record.",
          updatedAt: "2026-09-10T19:00:00.000Z",
          taskName: "Roofing installation",
          locationName: "Main roof",
          observation: "Field-reported progress is 60% complete.",
        }),
      ]),
    }),
  });

export function ecosControlledConflictFixtureIds() {
  return Object.freeze(Object.keys(FIXTURES).sort());
}

export function getECOSControlledConflictFixture(
  fixtureId: string,
  question: string,
) {
  const fixture = FIXTURES[fixtureId] || null;
  if (!fixture) return null;
  return normalizedText(fixture.question) === normalizedText(question)
    ? fixture
    : null;
}

export function ecosControlledConflictFixtureVersion() {
  return FIXTURE_VERSION;
}

function documentSource(input: {
  id: string;
  title: string;
  excerpt: string;
  updatedAt: string;
  revision: string;
  pageNumber: number;
  sheetNumber: string;
}): ECOSControlledConflictFixtureSource {
  const recordId = `private-conflict-fixture:${input.id}`;
  return Object.freeze({
    id: recordId,
    sourceType: "document",
    recordId,
    title: input.title,
    excerpt: input.excerpt,
    updatedAt: input.updatedAt,
    score: 100,
    documentCitation: Object.freeze({
      documentId: recordId,
      documentName: input.title,
      revision: input.revision,
      pageNumber: input.pageNumber,
      sheetNumber: input.sheetNumber,
      regionId: `private-region:${input.id}`,
      label: `${input.sheetNumber} page ${input.pageNumber}`,
    }),
    extractionConfidence: 1,
    documentLimitations: Object.freeze([
      "Private controlled conflict fixture; not customer project evidence.",
    ]),
  });
}

function scheduleSource(input: {
  id: string;
  title: string;
  excerpt: string;
  updatedAt: string;
  taskName: string;
  status: string;
  percentComplete: number;
}): ECOSControlledConflictFixtureSource {
  const recordId = `private-conflict-fixture:${input.id}`;
  return Object.freeze({
    id: recordId,
    sourceType: "schedule",
    recordId,
    title: input.title,
    excerpt: input.excerpt,
    updatedAt: input.updatedAt,
    score: 100,
    scheduleData: Object.freeze({
      taskName: input.taskName,
      itemType: "Activity",
      locationName: null,
      status: input.status,
      percentComplete: input.percentComplete,
      startDate: null,
      finishDate: null,
      baselineStartDate: null,
      baselineFinishDate: null,
      wbsCode: null,
      durationDays: null,
      dependencies: Object.freeze([]),
      isMilestone: false,
      isSummary: false,
    }),
  });
}

function memorySource(input: {
  id: string;
  title: string;
  excerpt: string;
  updatedAt: string;
  locationName: string;
  status: string;
  observation: string;
}): ECOSControlledConflictFixtureSource {
  const recordId = `private-conflict-fixture:${input.id}`;
  return Object.freeze({
    id: recordId,
    sourceType: "memory",
    recordId,
    title: input.title,
    excerpt: input.excerpt,
    updatedAt: input.updatedAt,
    score: 100,
    progressData: Object.freeze({
      recordKind: "memory",
      taskName: null,
      locationName: input.locationName,
      status: input.status,
      occurredAt: input.updatedAt,
      notes: null,
      observation: input.observation,
      actionKind: "Review",
      actionText: "Resolve the documented conflict before relying on it.",
      photoCount: 0,
      photoSummaries: Object.freeze([]),
    }),
  });
}

function updateSource(input: {
  id: string;
  title: string;
  excerpt: string;
  updatedAt: string;
  taskName: string;
  locationName: string;
  observation: string;
}): ECOSControlledConflictFixtureSource {
  const recordId = `private-conflict-fixture:${input.id}`;
  return Object.freeze({
    id: recordId,
    sourceType: "update",
    recordId,
    title: input.title,
    excerpt: input.excerpt,
    updatedAt: input.updatedAt,
    score: 100,
    progressData: Object.freeze({
      recordKind: "update",
      taskName: input.taskName,
      locationName: input.locationName,
      status: null,
      occurredAt: input.updatedAt,
      notes: input.observation,
      observation: input.observation,
      actionKind: null,
      actionText: null,
      photoCount: 0,
      photoSummaries: Object.freeze([]),
    }),
  });
}

function normalizedText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
