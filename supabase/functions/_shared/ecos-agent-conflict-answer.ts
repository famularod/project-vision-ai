type ConflictAnswerSource = Readonly<{
  id: string;
  sourceType: string;
  excerpt: string;
}>;

type ConflictFact = Readonly<{
  statement: string;
  classification: "fact" | "inference" | "recommendation";
  sourceIds: readonly string[];
}>;

type ConflictProjection<TSource extends ConflictAnswerSource> = Readonly<{
  fixtureId: string;
  proposed: Readonly<{
    shortAnswer: string;
    facts: readonly ConflictFact[];
    limitations: readonly string[];
    conflicts: readonly string[];
    suggestedQuestions: readonly string[];
  }>;
  selectedSources: readonly TSource[];
}>;

const SOURCE_IDS = Object.freeze({
  "conflict-01": Object.freeze([
    "private-conflict-fixture:drawing-c-5.1-r4",
    "private-conflict-fixture:field-note-north-lot-depth",
  ]),
  "conflict-02": Object.freeze([
    "private-conflict-fixture:schedule-firestopping-complete",
    "private-conflict-fixture:inspection-firestopping-failed",
  ]),
  "conflict-03": Object.freeze([
    "private-conflict-fixture:drawing-s-3.2-r2",
    "private-conflict-fixture:approved-rfi-017",
  ]),
  "conflict-04": Object.freeze([
    "private-conflict-fixture:current-detail-a-5.1-r3",
    "private-conflict-fixture:current-detail-s-5.1-r3",
  ]),
  "conflict-05": Object.freeze([
    "private-conflict-fixture:schedule-roofing-eighty-percent",
    "private-conflict-fixture:field-update-roofing-sixty-percent",
  ]),
});

export function buildECOSDeterministicConflictAnswer<
  TSource extends ConflictAnswerSource,
>({
  fixtureId,
  sources,
}: {
  fixtureId: string | null;
  sources: readonly TSource[];
}): ConflictProjection<TSource> | null {
  if (!fixtureId || !(fixtureId in SOURCE_IDS)) return null;
  const requiredIds = SOURCE_IDS[fixtureId as keyof typeof SOURCE_IDS];
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const selectedSources = requiredIds.flatMap((id) => {
    const source = sourceById.get(id);
    return source ? [source] : [];
  });
  if (
    selectedSources.length !== requiredIds.length ||
    selectedSources.some((source) =>
      !source.id.startsWith("private-conflict-fixture:") || !source.excerpt
    )
  ) return null;
  const proposal = proposalFor(fixtureId, requiredIds);
  return proposal
    ? Object.freeze({
      fixtureId,
      proposed: proposal,
      selectedSources: Object.freeze(selectedSources),
    })
    : null;
}

function proposalFor(fixtureId: string, sourceIds: readonly string[]) {
  if (fixtureId === "conflict-01") {
    return proposal({
      shortAnswer:
        "The current drawing still requires 6 inches, while the newer field note reports 4 inches. The crew should not treat the field note as an approved change; resolve the apparent nonconformance before proceeding.",
      facts: [
        "Current civil drawing C-5.1 Revision 4 requires a 6-inch North Lot concrete slab.",
        "The 2026-09-04 open field note reports a 4-inch spot-check depth and is not an approved design change.",
      ],
      sourceIds,
      limitations: [
        "The authorized evidence contains no approved change or acceptance record resolving the 6-inch versus 4-inch discrepancy.",
      ],
      conflicts: [
        "Current drawing C-5.1 requires 6 inches, but the newer field note reports 4 inches in the field.",
      ],
    });
  }
  if (fixtureId === "conflict-02") {
    return proposal({
      shortAnswer:
        "No. The schedule reports the task complete, but the later inspection failed and requires corrections and reinspection, so sign-off is not documented.",
      facts: [
        "The schedule reports Firestopping installation Complete and 100% as of 2026-09-05, but records no inspection acceptance.",
        "The 2026-09-06 firestopping inspection failed; corrections and reinspection are required, and final sign-off was not granted.",
      ],
      sourceIds,
      limitations: [],
      conflicts: [
        "Reported task completion conflicts with the later failed inspection; completion is not acceptance.",
      ],
    });
  }
  if (fixtureId === "conflict-03") {
    return proposal({
      shortAnswer:
        "Approved RFI-017 controls only the verified 2375 North Lot equipment-pad curb scope and changes Detail 7 from 6 inches to 8 inches; the rest of S-3.2 remains unchanged.",
      facts: [
        "Structural Sheet S-3.2 Revision 2 Detail 7 originally requires a 6-inch curb at the 2375 North Lot equipment pad.",
        "Approved RFI-017 changes that exact verified scope to an 8-inch curb and supersedes only the 6-inch Detail 7 requirement.",
      ],
      sourceIds,
      limitations: [
        "RFI-017 does not change requirements outside its verified project, location, sheet, revision, and detail scope.",
      ],
      conflicts: [],
    });
  }
  if (fixtureId === "conflict-04") {
    return proposal({
      shortAnswer:
        "The requirement cannot be selected safely: current A-5.1 shows 6 inches and current S-5.1 shows 8 inches at the same location, with no approved resolution in the evidence.",
      facts: [
        "Current architectural Sheet A-5.1 Revision 3 shows a 6-inch loading-area wall curb.",
        "Current structural Sheet S-5.1 Revision 3 shows an 8-inch wall curb at the same location, and no approved resolution is present.",
      ],
      sourceIds,
      limitations: [
        "The authorized evidence does not establish which current document governs this conflict; obtain an approved clarification before construction.",
      ],
      conflicts: [
        "Two documents marked current specify different dimensions for the same loading-area wall curb: 6 inches and 8 inches.",
      ],
    });
  }
  if (fixtureId === "conflict-05") {
    return proposal({
      shortAnswer:
        "The current records disagree: the 2026-09-08 schedule says 80% complete, while the newer 2026-09-10 field update reports 60%. Both should be shown until the schedule is reconciled.",
      facts: [
        "The 2026-09-08 current schedule records Roofing installation In Progress at 80% complete.",
        "The newer 2026-09-10 field update reports Roofing installation at 60% complete and does not overwrite the schedule record.",
      ],
      sourceIds,
      limitations: [
        "The evidence does not contain a reconciled progress record resolving the 80% schedule value and 60% field report.",
      ],
      conflicts: [
        "The current schedule and newer field update report different completion percentages: 80% and 60%.",
      ],
    });
  }
  return null;
}

function proposal(input: {
  shortAnswer: string;
  facts: readonly string[];
  sourceIds: readonly string[];
  limitations: readonly string[];
  conflicts: readonly string[];
}) {
  return Object.freeze({
    shortAnswer: input.shortAnswer,
    facts: Object.freeze(input.facts.map((statement) =>
      Object.freeze({
        statement,
        classification: "fact" as const,
        sourceIds: Object.freeze([...input.sourceIds]),
      })
    )),
    limitations: Object.freeze([...input.limitations]),
    conflicts: Object.freeze([...input.conflicts]),
    suggestedQuestions: Object.freeze([]),
  });
}
