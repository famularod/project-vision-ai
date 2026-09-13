import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  ecosEvidenceCoversExplicitSheetReferences,
  ecosSupportingEvidenceComplementScore,
  parseECOSExactPagePairs,
  selectECOSEvidenceSources,
} from "./ecos-evidence-selection.ts";

Deno.test("exact page-pair parsing preserves ECOS serialized page identities", () => {
  assertEquals(
    parseECOSExactPagePairs([
      "web-document-123:6",
      "web-document-123:6",
      "web-document-with:colon:53",
    ]),
    [
      { documentId: "web-document-123", pageNumber: 6 },
      { documentId: "web-document-with:colon", pageNumber: 53 },
    ],
  );
});

Deno.test("exact page-pair parsing rejects noncanonical and unsafe page identities", () => {
  assertEquals(
    parseECOSExactPagePairs([
      "web-document-123:06",
      "web-document-123:6.0",
      "web-document-123:-1",
      "web-document-123:100001",
      " web-document-123:6",
      "web-document-123:",
    ]),
    [],
  );
});

function source({
  id,
  excerpt,
  title = "Civil drawing, Sheet C6",
  score = 10,
  pageNumber = 6,
  sheetNumber,
  bounded = true,
}: {
  id: string;
  excerpt: string;
  title?: string;
  score?: number;
  pageNumber?: number;
  sheetNumber?: string;
  bounded?: boolean;
}) {
  return {
    id,
    sourceType: "document",
    recordId: title.startsWith("Civil") ? "civil" : title,
    title,
    excerpt,
    score,
    documentCitation: { pageNumber, sheetNumber },
    ...(bounded ? { documentRegion: { id } } : {}),
    documentPageSelectionRank: 1,
  };
}

Deno.test("explicit sheet questions admit only the verified requested sheet", () => {
  const question =
    "What does current electrical Sheet E-2.1 show for Building Area 1 at 2375?";
  const selected = selectECOSEvidenceSources(
    question,
    [
      source({
        id: "wrong-nearby-sheet",
        title: "Electrical drawing, Sheet E-2.2",
        pageNumber: 9,
        sheetNumber: "E-2.2",
        score: 500,
        excerpt: "BUILDING AREA 1 ENLARGED POWER PLAN",
      }),
      source({
        id: "requested-sheet",
        title: "Electrical drawing, Sheet E-2.1",
        pageNumber: 7,
        sheetNumber: "E-2.1",
        score: 10,
        excerpt: "BUILDING AREA 1 ENLARGED LIGHTING PLAN",
      }),
    ],
    4,
  );
  assertEquals(selected.map((item) => item.id), ["requested-sheet"]);
  assert(ecosEvidenceCoversExplicitSheetReferences(question, selected));
});

Deno.test("explicit sheet questions fail closed when the requested sheet is absent", () => {
  const question = "What does current electrical Sheet E-2.1 show?";
  const selected = selectECOSEvidenceSources(
    question,
    [
      source({
        id: "wrong-sheet",
        title: "Electrical drawing, Sheet E-2.2",
        sheetNumber: "E-2.2",
        excerpt: "ENLARGED POWER PLAN",
      }),
    ],
    4,
  );
  assertEquals(selected, []);
});

Deno.test("equipment tags do not filter out the verified mechanical schedule", () => {
  for (
    const question of [
      "How much airflow is scheduled for restroom exhaust fan EF-1?",
      "Compare the scheduled airflow and room coverage for EF-2 and EF-3.",
      "What was the measured field air-balance reading for exhaust fan EF-1?",
    ]
  ) {
    const selected = selectECOSEvidenceSources(
      question,
      [
        source({
          id: "mechanical-fan-schedule",
          title: "Mechanical drawing, Sheet MB-1.2",
          sheetNumber: "MB-1.2",
          excerpt:
            "Exhaust fan EF-1: 100 CFM; serves 4 restrooms and 1 janitor closet. Exhaust fan EF-2: 630 CFM; serves 3 control rooms. Exhaust fan EF-3: 630 CFM; serves 2 control rooms.",
        }),
      ],
      4,
    );
    assertEquals(selected.map((item) => item.id), ["mechanical-fan-schedule"]);
    assert(ecosEvidenceCoversExplicitSheetReferences(question, selected));
  }
});

Deno.test("supporting proof prioritizes complete panel relationships and containment context", () => {
  const panelScore = ecosSupportingEvidenceComplementScore(
    "What bus ratings and pole counts are required for the two panel replacements on Sheet E-2.5?",
    [
      "One panel has a 125-amp bus and 30 poles; the other has a 225-amp bus and 42 poles.",
    ],
    "EXISTING PANEL: 125 AMPS BUS, 30 POLES. EXISTING PANEL: 225 AMPS BUS, 42 POLES.",
  );
  assert(panelScore >= 80);
  const containmentScore = ecosSupportingEvidenceComplementScore(
    "Which architectural sheets show the hazardous-material containment layout?",
    ["Use Sheet A-1.5A for the hazardous-material containment data plan."],
    "WEATHER PROTECTED CANOPY — HAZARDOUS MATERIAL — CONTAINMENT AREA",
  );
  assert(containmentScore >= 6);
});

Deno.test("selection preserves a bounded paving fact when a broad same-page row ranks first", () => {
  const selected = selectECOSEvidenceSources(
    "What is the thickness of the new cement on the north lot?",
    [
      source({
        id: "broad-page",
        score: 100,
        bounded: false,
        excerpt:
          "NORTH LOT PLAN. CONSTRUCT 4” THICK PCC WALKWAY. LEGEND PCC PAVING.",
      }),
      source({
        id: "exact-paving",
        score: 8,
        excerpt: "NORTH LOT PLAN. CONSTRUCT 6.0” THICK 6.0” PCC PAVING.",
      }),
    ],
    2,
  );
  assertEquals(selected[0]?.id, "exact-paving");
  assert(selected.some((item) => item.id === "broad-page"));
});

Deno.test("selection reserves exact calculated Canopy A proof", () => {
  const selected = selectECOSEvidenceSources(
    "How large is Canopy A in square feet?",
    [
      source({
        id: "generic-canopy",
        title: "Canopy A, Sheet WPA-14",
        score: 100,
        pageNumber: 14,
        excerpt: "Canopy A",
      }),
      source({
        id: "canopy-area",
        title: "Canopy A, Sheet WPA-4",
        score: 5,
        pageNumber: 4,
        excerpt:
          "ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 122'-0\" × 52'-0\" = 6,344 square feet.",
      }),
    ],
    2,
  );
  assertEquals(selected[0]?.id, "canopy-area");
});

Deno.test("selection cannot substitute Canopy A proof for Canopy B", () => {
  const selected = selectECOSEvidenceSources(
    "What is the square footage for canopy B?",
    [
      source({
        id: "wrong-canopy-a-area",
        title: "08A - Canopy 'A', Sheet WPA-4",
        score: 500,
        excerpt:
          "ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 122'-0\" × 52'-0\" = 6,344 square feet.",
      }),
      source({
        id: "correct-canopy-b-area",
        title: "08B - Canopy 'B', Sheet WPR-4",
        score: 5,
        excerpt:
          "ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 82'-0\" × 64'-0\" = 5,248 square feet.",
      }),
    ],
    2,
  );
  assertEquals(selected.map((item) => item.id), ["correct-canopy-b-area"]);
});

Deno.test("selection reserves both sides of bounded canopy lighting proof", () => {
  const selected = selectECOSEvidenceSources(
    "Is canopy lighting part of the current drawings?",
    [
      source({
        id: "generic-electrical",
        title: "Electrical drawing, Sheet E-2.0",
        score: 100,
        excerpt: "GENERAL LIGHTING NOTES",
      }),
      source({
        id: "architectural-canopy",
        title: "Architectural drawing, Sheet A-1.7",
        pageNumber: 14,
        excerpt:
          "WEATHER-PROTECTED CANOPY. NEW LIGHT FIXTURE. SEE ELECTRICAL DRAWINGS.",
      }),
      source({
        id: "electrical-exterior",
        title: "Electrical drawing, Sheet E-1.1",
        pageNumber: 4,
        excerpt: "EXTERIOR STORAGE LIGHTING PLANS",
      }),
    ],
    3,
  );
  assertEquals(
    new Set(selected.slice(0, 2).map((item) => item.id)),
    new Set(["architectural-canopy", "electrical-exterior"]),
  );
});

Deno.test("drawing-location selection prefers bounded detail proof over broad page text", () => {
  const selected = selectECOSEvidenceSources(
    "Where are the underground infiltration chamber details?",
    [
      source({
        id: "c8-page-text",
        title: "Civil drawing, Sheet C8",
        pageNumber: 8,
        sheetNumber: "C8",
        score: 500,
        bounded: false,
        excerpt:
          "Sheet C8. Underground infiltration chamber details. UIC long section and short section.",
      }),
      source({
        id: "c8-bounded-detail",
        title: "Civil drawing, Sheet C8",
        pageNumber: 8,
        sheetNumber: "C8",
        score: 5,
        excerpt:
          "Sheet C8. UNDERGROUND INFILTRATION CHAMBERS. UIC #2 SHORT SECTION.",
      }),
    ],
    1,
  );
  assertEquals(selected.map((item) => item.id), ["c8-bounded-detail"]);
});

Deno.test("drawing-location selection keeps bounded referral and target proof across sheets", () => {
  const selected = selectECOSEvidenceSources(
    "Where are the underground infiltration chamber details?",
    [
      source({
        id: "c8-page-text",
        title: "Civil drawing, Sheet C8",
        pageNumber: 8,
        sheetNumber: "C8",
        score: 500,
        bounded: false,
        excerpt: "Sheet C8. Underground infiltration chamber details.",
      }),
      source({
        id: "c4-page-text",
        title: "Civil drawing, Sheet C4",
        pageNumber: 4,
        sheetNumber: "C4",
        score: 450,
        bounded: false,
        excerpt: "Construct underground infiltration details on Sheet 8.",
      }),
      source({
        id: "c6-referral",
        title: "Civil drawing, Sheet C6",
        pageNumber: 6,
        sheetNumber: "C6",
        score: 25,
        excerpt:
          "CONSTRUCT UNDERGROUND INFILTRATION CHAMBERS - SEE DETAILS ON SHEET 8",
      }),
      source({
        id: "c8-bounded-detail",
        title: "Civil drawing, Sheet C8",
        pageNumber: 8,
        sheetNumber: "C8",
        score: 5,
        excerpt:
          "Sheet C8. UNDERGROUND INFILTRATION CHAMBERS. UIC #2 SHORT SECTION.",
      }),
    ],
    3,
  );
  assertEquals(
    new Set(selected.map((item) => item.id)),
    new Set(["c4-page-text", "c6-referral", "c8-bounded-detail"]),
  );
});
