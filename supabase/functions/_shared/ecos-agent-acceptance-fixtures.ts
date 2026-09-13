import {
  type ECOSControlledConflictFixtureSource,
} from "./ecos-agent-conflict-fixtures.ts";

export type ECOSControlledAcceptanceFixture = Readonly<{
  id: string;
  question: string;
  sources: readonly ECOSControlledConflictFixtureSource[];
}>;

const FIXTURE_VERSION = "ecos-controlled-acceptance-fixture/1.0";
const PREFIX = "private-acceptance-fixture:";

const FIXTURES: Readonly<Record<string, ECOSControlledAcceptanceFixture>> =
  Object.freeze({
    "closeout-01": Object.freeze({
      id: "closeout-01",
      question:
        "The INSPECTION & C OF O task is complete. Is final acceptance documented?",
      sources: Object.freeze([
        scheduleSource({
          id: "inspection-co-task-complete",
          title: "INSPECTION & C OF O",
          excerpt:
            "Schedule activity INSPECTION & C OF O. Status: Complete. Percent complete: 100%. Last schedule update: 2026-09-08. This schedule activity contains no inspection result, acceptance record, certificate number, or sign-off authority.",
          updatedAt: "2026-09-08T17:00:00.000Z",
          taskName: "INSPECTION & C OF O",
          status: "Complete",
          percentComplete: 100,
        }),
      ]),
    }),
    "closeout-02": Object.freeze({
      id: "closeout-02",
      question: "Which required inspections are still open?",
      sources: Object.freeze([
        documentSource({
          id: "required-inspection-register",
          title: "Current required-inspection register",
          excerpt:
            "Required inspections: Final electrical; Fire and life-safety; Final plumbing. The register is current as of 2026-09-10.",
          updatedAt: "2026-09-10T12:00:00.000Z",
          revision: "Current 2026-09-10",
          sheetNumber: "INSPECTION-REGISTER",
        }),
        memorySource({
          id: "final-electrical-passed",
          title: "Final electrical inspection result",
          excerpt:
            "Final electrical inspection performed 2026-09-09. Result: Passed. Acceptance recorded by the electrical inspector.",
          updatedAt: "2026-09-09T17:00:00.000Z",
          status: "Closed",
          observation: "Final electrical inspection passed.",
        }),
        memorySource({
          id: "fire-life-safety-corrections",
          title: "Fire and life-safety inspection result",
          excerpt:
            "Fire and life-safety inspection performed 2026-09-10. Result: Corrections Required. Status: Open. Reinspection is required after the listed corrections are completed.",
          updatedAt: "2026-09-10T18:00:00.000Z",
          status: "Open",
          observation:
            "Fire and life-safety inspection requires corrections and reinspection.",
        }),
        memorySource({
          id: "final-plumbing-pending",
          title: "Final plumbing inspection status",
          excerpt:
            "Final plumbing inspection status as of 2026-09-10: Pending and Open. No inspection result or acceptance has been recorded.",
          updatedAt: "2026-09-10T18:05:00.000Z",
          status: "Open",
          observation: "Final plumbing inspection remains pending.",
        }),
      ]),
    }),
    "closeout-03": Object.freeze({
      id: "closeout-03",
      question: "Did the latest inspection pass, fail, or require corrections?",
      sources: Object.freeze([
        memorySource({
          id: "firestopping-initial-failed",
          title: "Firestopping initial inspection",
          excerpt:
            "Firestopping inspection performed 2026-09-08. Result: Failed. Corrections and reinspection were required.",
          updatedAt: "2026-09-08T18:00:00.000Z",
          status: "Closed",
          observation: "Initial firestopping inspection failed.",
        }),
        memorySource({
          id: "firestopping-reinspection-corrections",
          title: "Firestopping reinspection",
          excerpt:
            "Firestopping reinspection performed 2026-09-10. Result: Corrections Required. Status: Open. Final acceptance was not granted.",
          updatedAt: "2026-09-10T19:00:00.000Z",
          status: "Open",
          observation:
            "Latest firestopping reinspection requires corrections; final acceptance was not granted.",
        }),
      ]),
    }),
    "closeout-04": Object.freeze({
      id: "closeout-04",
      question: "What closeout documents are still missing?",
      sources: Object.freeze([
        documentSource({
          id: "closeout-document-checklist",
          title: "Current closeout document checklist",
          excerpt:
            "Required closeout documents: Operations and maintenance manuals; Final as-built drawings; Product warranties; Certificate of occupancy.",
          updatedAt: "2026-09-10T12:00:00.000Z",
          revision: "Current 2026-09-10",
          sheetNumber: "CLOSEOUT-CHECKLIST",
        }),
        documentSource({
          id: "received-product-warranties",
          title: "Received product warranties",
          excerpt:
            "Closeout document received: Product warranties. Received 2026-09-09. Status: Current and accepted into the closeout file.",
          updatedAt: "2026-09-09T20:00:00.000Z",
          revision: "Received 2026-09-09",
          sheetNumber: "WARRANTIES",
        }),
        documentSource({
          id: "received-certificate-occupancy",
          title: "Received certificate of occupancy",
          excerpt:
            "Closeout document received: Certificate of occupancy. Received 2026-09-10. Status: Current and accepted into the closeout file.",
          updatedAt: "2026-09-10T20:00:00.000Z",
          revision: "Received 2026-09-10",
          sheetNumber: "CERTIFICATE-OF-OCCUPANCY",
        }),
      ]),
    }),
    "closeout-05": Object.freeze({
      id: "closeout-05",
      question: "Is the project ready for sign-off today?",
      sources: Object.freeze([
        scheduleSource({
          id: "all-closeout-work-complete",
          title: "Closeout work schedule summary",
          excerpt:
            "Closeout schedule summary as of 2026-09-10: 12 of 12 closeout activities are Complete at 100%. Schedule status does not constitute inspection or document acceptance.",
          updatedAt: "2026-09-10T17:00:00.000Z",
          taskName: "CLOSEOUT WORK SUMMARY",
          status: "Complete",
          percentComplete: 100,
        }),
        memorySource({
          id: "final-inspection-passed",
          title: "Final building inspection",
          excerpt:
            "Final building inspection performed 2026-09-10. Result: Passed. Final inspection acceptance was recorded by the building inspector.",
          updatedAt: "2026-09-10T18:00:00.000Z",
          status: "Closed",
          observation: "Final building inspection passed.",
        }),
        documentSource({
          id: "occupancy-certificate-missing",
          title: "Current sign-off checklist",
          excerpt:
            "Sign-off checklist status as of 2026-09-10: Certificate of occupancy is Required and Missing. Project sign-off is blocked until the certificate is received and verified.",
          updatedAt: "2026-09-10T19:00:00.000Z",
          revision: "Current 2026-09-10",
          sheetNumber: "SIGNOFF-CHECKLIST",
        }),
      ]),
    }),
  });

export function ecosControlledAcceptanceFixtureIds() {
  return Object.freeze(Object.keys(FIXTURES).sort());
}

export function getECOSControlledAcceptanceFixture(
  fixtureId: string,
  question: string,
) {
  const fixture = FIXTURES[fixtureId] || null;
  if (!fixture) return null;
  return normalizedText(fixture.question) === normalizedText(question)
    ? fixture
    : null;
}

export function ecosControlledAcceptanceFixtureVersion() {
  return FIXTURE_VERSION;
}

function documentSource(input: {
  id: string;
  title: string;
  excerpt: string;
  updatedAt: string;
  revision: string;
  sheetNumber: string;
}): ECOSControlledConflictFixtureSource {
  const recordId = `${PREFIX}${input.id}`;
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
      pageNumber: 1,
      sheetNumber: input.sheetNumber,
      regionId: `${PREFIX}region:${input.id}`,
      label: `${input.sheetNumber} page 1`,
    }),
    extractionConfidence: 1,
    documentLimitations: Object.freeze([
      "Private controlled acceptance fixture; not customer project evidence.",
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
  const recordId = `${PREFIX}${input.id}`;
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
  status: string;
  observation: string;
}): ECOSControlledConflictFixtureSource {
  const recordId = `${PREFIX}${input.id}`;
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
      locationName: "Project closeout",
      status: input.status,
      occurredAt: input.updatedAt,
      notes: null,
      observation: input.observation,
      actionKind: "Inspection",
      actionText: null,
      photoCount: 0,
      photoSummaries: Object.freeze([]),
    }),
  });
}

function normalizedText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
