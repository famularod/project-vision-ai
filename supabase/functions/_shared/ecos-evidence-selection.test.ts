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
