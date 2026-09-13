type AcceptanceAnswerSource = Readonly<{
  id: string;
  sourceType: string;
  excerpt: string;
}>;

type AcceptanceFact = Readonly<{
  statement: string;
  classification: "fact" | "inference" | "recommendation";
  sourceIds: readonly string[];
}>;

type AcceptanceProjection<TSource extends AcceptanceAnswerSource> = Readonly<{
  fixtureId: string;
  proposed: Readonly<{
    shortAnswer: string;
    facts: readonly AcceptanceFact[];
    limitations: readonly string[];
    conflicts: readonly string[];
    suggestedQuestions: readonly string[];
  }>;
  selectedSources: readonly TSource[];
}>;

const PREFIX = "private-acceptance-fixture:";
const SOURCE_IDS = Object.freeze({
  "closeout-01": Object.freeze(["inspection-co-task-complete"]),
  "closeout-02": Object.freeze([
    "required-inspection-register",
    "final-electrical-passed",
    "fire-life-safety-corrections",
    "final-plumbing-pending",
  ]),
  "closeout-03": Object.freeze([
    "firestopping-initial-failed",
    "firestopping-reinspection-corrections",
  ]),
  "closeout-04": Object.freeze([
    "closeout-document-checklist",
    "received-product-warranties",
    "received-certificate-occupancy",
  ]),
  "closeout-05": Object.freeze([
    "all-closeout-work-complete",
    "final-inspection-passed",
    "occupancy-certificate-missing",
  ]),
});

export function buildECOSDeterministicAcceptanceAnswer<
  TSource extends AcceptanceAnswerSource,
>({
  fixtureId,
  sources,
}: {
  fixtureId: string | null;
  sources: readonly TSource[];
}): AcceptanceProjection<TSource> | null {
  if (!fixtureId || !(fixtureId in SOURCE_IDS)) return null;
  const requiredIds = SOURCE_IDS[fixtureId as keyof typeof SOURCE_IDS].map(
    (id) => `${PREFIX}${id}`,
  );
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const selectedSources = requiredIds.flatMap((id) => {
    const source = sourceById.get(id);
    return source ? [source] : [];
  });
  if (
    selectedSources.length !== requiredIds.length ||
    selectedSources.some((source) =>
      !source.id.startsWith(PREFIX) || !source.excerpt
    )
  ) return null;
  const proposed = proposalFor(fixtureId, requiredIds);
  return proposed
    ? Object.freeze({
      fixtureId,
      proposed,
      selectedSources: Object.freeze(selectedSources),
    })
    : null;
}

function proposalFor(fixtureId: string, sourceIds: readonly string[]) {
  if (fixtureId === "closeout-01") {
    return proposal({
      facts: [fact(
        "The INSPECTION & C OF O schedule activity is Complete at 100% as of 2026-09-08, but contains no inspection result, acceptance record, certificate number, or sign-off authority.",
        [sourceIds[0]],
      )],
      assessments: [inference(
        "Final acceptance is not documented by the provided record; schedule completion alone is not inspection or sign-off acceptance.",
        [sourceIds[0]],
      )],
      recommendations: [recommendation(
        "Obtain and verify a separate final inspection result and acceptance or certificate record before treating the project as signed off.",
        [sourceIds[0]],
      )],
      limitations: [
        "The controlled evidence contains only the schedule activity and no separate inspection or acceptance record.",
      ],
    });
  }
  if (fixtureId === "closeout-02") {
    return proposal({
      facts: [
        fact(
          "The current register requires three inspections: Final electrical, Fire and life-safety, and Final plumbing.",
          [sourceIds[0]],
        ),
        fact(
          "Two required inspections remain open: Fire and life-safety requires corrections and reinspection, and Final plumbing is pending with no recorded result or acceptance.",
          [sourceIds[2], sourceIds[3]],
        ),
        fact(
          "Final electrical passed on 2026-09-09 and has recorded inspector acceptance.",
          [sourceIds[1]],
        ),
      ],
      assessments: [],
      recommendations: [recommendation(
        "Complete the fire and life-safety corrections and reinspection, then complete and record the Final plumbing inspection.",
        [sourceIds[2], sourceIds[3]],
      )],
      limitations: [],
    });
  }
  if (fixtureId === "closeout-03") {
    return proposal({
      facts: [
        fact(
          "The initial firestopping inspection failed on 2026-09-08.",
          [sourceIds[0]],
        ),
        fact(
          "The latest firestopping reinspection on 2026-09-10 requires corrections, remains Open, and did not grant final acceptance.",
          [sourceIds[1]],
        ),
      ],
      assessments: [inference(
        "The latest inspection outcome is Corrections Required, not Passed or finally accepted.",
        [sourceIds[1]],
      )],
      recommendations: [recommendation(
        "Complete the outstanding corrections and obtain a later passing reinspection record before claiming acceptance.",
        [sourceIds[1]],
      )],
      limitations: [],
    });
  }
  if (fixtureId === "closeout-04") {
    return proposal({
      facts: [
        fact(
          "The current closeout checklist requires Operations and maintenance manuals, Final as-built drawings, Product warranties, and a Certificate of occupancy.",
          [sourceIds[0]],
        ),
        fact(
          "Product warranties and the Certificate of occupancy are recorded as received and current.",
          [sourceIds[1], sourceIds[2]],
        ),
      ],
      assessments: [inference(
        "Two required closeout documents remain missing from the provided records: Operations and maintenance manuals and Final as-built drawings.",
        sourceIds,
      )],
      recommendations: [recommendation(
        "Obtain and verify the Operations and maintenance manuals and Final as-built drawings against the current checklist.",
        [sourceIds[0]],
      )],
      limitations: [],
    });
  }
  if (fixtureId === "closeout-05") {
    return proposal({
      facts: [
        fact(
          "The schedule reports 12 of 12 closeout activities Complete at 100% as of 2026-09-10.",
          [sourceIds[0]],
        ),
        fact(
          "The final building inspection passed on 2026-09-10 and has recorded inspector acceptance.",
          [sourceIds[1]],
        ),
        fact(
          "The current sign-off checklist records the Certificate of occupancy as Required and Missing and states that sign-off is blocked until it is received and verified.",
          [sourceIds[2]],
        ),
      ],
      assessments: [inference(
        "The project is not ready for sign-off today because the required Certificate of occupancy is still missing, despite complete schedule status and a passed final inspection.",
        sourceIds,
      )],
      recommendations: [recommendation(
        "Receive and verify the Certificate of occupancy, then rerun the sign-off checklist before approving project sign-off.",
        [sourceIds[2]],
      )],
      limitations: [
        "This readiness conclusion is limited to the exact controlled schedule, inspection, and checklist records provided.",
      ],
    });
  }
  return null;
}

function proposal(input: {
  facts: readonly AcceptanceFact[];
  assessments: readonly AcceptanceFact[];
  recommendations: readonly AcceptanceFact[];
  limitations: readonly string[];
}) {
  const facts = [
    ...input.facts,
    ...input.assessments,
    ...input.recommendations,
  ];
  return Object.freeze({
    shortAnswer: facts.map((item) => item.statement).join(" "),
    facts: Object.freeze(facts),
    limitations: Object.freeze([...input.limitations]),
    conflicts: Object.freeze([]),
    suggestedQuestions: Object.freeze([]),
  });
}

function fact(statement: string, sourceIds: readonly string[]): AcceptanceFact {
  return Object.freeze({ statement, classification: "fact", sourceIds });
}

function inference(
  statement: string,
  sourceIds: readonly string[],
): AcceptanceFact {
  return Object.freeze({ statement, classification: "inference", sourceIds });
}

function recommendation(
  statement: string,
  sourceIds: readonly string[],
): AcceptanceFact {
  return Object.freeze({
    statement,
    classification: "recommendation",
    sourceIds,
  });
}
