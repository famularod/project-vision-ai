import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildECOSDrawingEvidencePassages } from "./ecos-drawing-evidence.ts";

const treeCountRegion = Object.freeze({
  id: "tree-count",
  text: "TREES PROVIDED 78",
  x: 0.2,
  y: 0.3,
  width: 0.2,
  height: 0.1,
  confidence: 0.99,
  source: "vision",
  searchable: true,
});

Deno.test("drawing evidence preserves a planned count for installed-condition questions", () => {
  const questions = [
    "Are all 78 trees really installed at 2321?",
    "Do the landscape plans prove the crew planted every required tree?",
    "How many of the planned trees can ECOS confirm are in the ground?",
  ];
  for (const question of questions) {
    const passages = buildECOSDrawingEvidencePassages({
      pageText: treeCountRegion.text,
      regions: [treeCountRegion],
      question,
      pageIdentity: "DRAWING PAGE CONTEXT: Sheet L1.1 — Tree Planting Plan.",
      maximumPassages: 6,
    });
    assert(passages.some((passage) => /TREES PROVIDED 78/i.test(passage.text)));
    const proof = passages.find((passage) =>
      /TREES PROVIDED 78/i.test(passage.text)
    );
    assertEquals(proof?.regionId, "tree-count");
    assert(proof?.x === 0.2 && proof?.y === 0.3);
  }
});

Deno.test("drawing evidence keeps the exact measurement before long nearby context", () => {
  const passages = buildECOSDrawingEvidencePassages({
    pageText: "NORTH LOT PLAN",
    regions: [
      {
        id: "pcc-note",
        text: "@ CONSTRUCT 6.0” THICK 6.0” PCC PAVING PCC",
        x: 0.60,
        y: 0.17,
        width: 0.09,
        height: 0.01,
        confidence: 0.99,
        source: "vision",
        searchable: true,
      },
      {
        id: "long-north-lot-context",
        text: `NORTH LOT CONCRETE PAVING ${
          "general drawing context ".repeat(120)
        }`,
        x: 0.59,
        y: 0.18,
        width: 0.20,
        height: 0.03,
        confidence: 0.95,
        source: "vision",
        searchable: true,
      },
    ],
    question: "What is the thickness of the new concrete on the north lot?",
    pageIdentity: "DRAWING PAGE CONTEXT: Sheet C6 — NORTH LOT PLAN.",
    maximumPassages: 6,
  });
  const proof = passages.find((passage) => passage.regionId === "pcc-note");
  assert(proof);
  assert(/6\.0” THICK 6\.0” PCC PAVING/i.test(proof.text.slice(0, 1_600)));
});

Deno.test("calculated area proof precedes long canopy context", () => {
  const passages = buildECOSDrawingEvidencePassages({
    pageText: "CANOPY A PLAN",
    regions: [
      {
        id: "horizontal-overall",
        text: "122'-0\" OVERALL",
        x: 0.40,
        y: 0.70,
        width: 0.20,
        height: 0.01,
        confidence: 0.99,
        source: "vision",
        searchable: true,
      },
      {
        id: "vertical-overall",
        text: "52'-0\" OVERALL",
        x: 0.10,
        y: 0.40,
        width: 0.01,
        height: 0.20,
        confidence: 0.99,
        source: "vision",
        searchable: true,
      },
      {
        id: "long-canopy-context",
        text: `CANOPY A PLAN ${"general erection context ".repeat(120)}`,
        x: 0.30,
        y: 0.30,
        width: 0.30,
        height: 0.10,
        confidence: 0.95,
        source: "vision",
        searchable: true,
      },
    ],
    question: "How many square feet is Canopy A?",
    pageIdentity: "DRAWING PAGE CONTEXT: Sheet WPA-4 — CANOPY A PLAN.",
    maximumPassages: 6,
  });
  const proof = passages.find((passage) =>
    passage.text.includes("ECOS VERIFIED PLAN-FOOTPRINT CALCULATION")
  );
  assert(proof);
  assert(
    /122'-0\" × 52'-0\" = 6,344 square feet/.test(
      proof.text.slice(0, 1_600),
    ),
  );
});

Deno.test("whole-canopy footprint rejects component roof-covering dimensions", () => {
  const passages = buildECOSDrawingEvidencePassages({
    pageText: "CANOPY A ROOF COVERING PLAN",
    regions: [
      {
        id: "plan-title",
        text: "ROOF COVERING PLAN",
        x: 0.77,
        y: 0.17,
        width: 0.09,
        height: 0.01,
        confidence: 1,
        source: "embedded_text",
        searchable: true,
      },
      {
        id: "covering-width",
        text: "25'-9 7/8\"",
        x: 0.08,
        y: 0.86,
        width: 0.03,
        height: 0.004,
        confidence: 1,
        source: "embedded_text",
        searchable: true,
      },
      {
        id: "covering-depth",
        text: "25'-9\"",
        x: 0.08,
        y: 0.82,
        width: 0.004,
        height: 0.03,
        confidence: 1,
        source: "embedded_text",
        searchable: true,
      },
      {
        id: "canopy-label",
        text: "CANOPY A",
        x: 0.1,
        y: 0.7,
        width: 0.1,
        height: 0.02,
        confidence: 1,
        source: "embedded_text",
        searchable: true,
      },
    ],
    question: "How many square feet is Canopy A?",
    pageIdentity: "DRAWING PAGE CONTEXT: Sheet WPA-24.",
    maximumPassages: 6,
  });
  assert(
    !passages.some((passage) =>
      passage.text.includes("ECOS VERIFIED PLAN-FOOTPRINT CALCULATION")
    ),
  );
});

Deno.test("plan-footprint calculation rejects a different named canopy", () => {
  const regions = [
    {
      id: "horizontal-overall",
      text: "82'-0\" OVERALL",
      x: 0.40,
      y: 0.70,
      width: 0.20,
      height: 0.01,
      confidence: 0.99,
      source: "vision",
      searchable: true,
    },
    {
      id: "vertical-overall",
      text: "64'-0\" OVERALL",
      x: 0.10,
      y: 0.40,
      width: 0.01,
      height: 0.20,
      confidence: 0.99,
      source: "vision",
      searchable: true,
    },
    {
      id: "canopy-b-context",
      text: "CANOPY B ANCHOR ROD PLAN",
      x: 0.3,
      y: 0.3,
      width: 0.2,
      height: 0.02,
      confidence: 0.99,
      source: "vision",
      searchable: true,
    },
  ] as const;
  const wrongQuestionPassages = buildECOSDrawingEvidencePassages({
    pageText: "CANOPY B ANCHOR ROD PLAN",
    regions,
    question: "What is the square footage for canopy C?",
    pageIdentity: "DRAWING PAGE CONTEXT: 08B — CANOPY 'B', Sheet WPR-4.",
  });
  assert(
    !wrongQuestionPassages.some((passage) =>
      passage.text.includes("ECOS VERIFIED PLAN-FOOTPRINT CALCULATION")
    ),
  );

  const matchingPassages = buildECOSDrawingEvidencePassages({
    pageText: "CANOPY B ANCHOR ROD PLAN",
    regions,
    question: "What is the square footage for canopy B?",
    pageIdentity: "DRAWING PAGE CONTEXT: 08B — CANOPY 'B', Sheet WPR-4.",
  });
  assert(
    matchingPassages.some((passage) =>
      passage.text.includes("82'-0\" × 64'-0\" = 5,248 square feet")
    ),
  );
});

Deno.test("roof-covering area questions may use roof-covering dimensions", () => {
  const passages = buildECOSDrawingEvidencePassages({
    pageText: "CANOPY A ROOF COVERING PLAN",
    regions: [
      {
        id: "plan-title",
        text: "CANOPY A ROOF COVERING PLAN",
        x: 0.7,
        y: 0.17,
        width: 0.2,
        height: 0.02,
        confidence: 1,
        source: "embedded_text",
        searchable: true,
      },
      {
        id: "covering-width",
        text: "25'-9 7/8\" OVERALL",
        x: 0.08,
        y: 0.86,
        width: 0.08,
        height: 0.01,
        confidence: 1,
        source: "embedded_text",
        searchable: true,
      },
      {
        id: "covering-depth",
        text: "25'-9\" OVERALL",
        x: 0.08,
        y: 0.82,
        width: 0.01,
        height: 0.08,
        confidence: 1,
        source: "embedded_text",
        searchable: true,
      },
    ],
    question: "What is the area of the Canopy A roof covering?",
    pageIdentity: "DRAWING PAGE CONTEXT: Sheet WPA-24.",
    maximumPassages: 6,
  });
  assert(
    passages.some((passage) =>
      passage.text.includes("ECOS VERIFIED PLAN-FOOTPRINT CALCULATION")
    ),
  );
});

Deno.test("drawing-detail location questions retain a bounded detail citation", () => {
  const question =
    "Which current civil sheet contains the underground infiltration chamber details, and what sheet sends the field team there?";
  const regions = [
    {
      id: "underground-infiltration",
      text: "UNDERGROUND INFILTRATION",
      x: 0.253889,
      y: 0.356667,
      width: 0.06,
      height: 0.005,
      confidence: 0.79,
      source: "fixed_visual_tile_coordinate_ocr",
      searchable: true,
    },
    {
      id: "chambers",
      text: "CHAMBERS",
      x: 0.253889,
      y: 0.364167,
      width: 0.019815,
      height: 0.004444,
      confidence: 0.74,
      source: "fixed_visual_tile_coordinate_ocr",
      searchable: true,
    },
    {
      id: "uic-short-section",
      text: "UIC #2 SHORT SECTION",
      x: 0.443519,
      y: 0.395278,
      width: 0.087963,
      height: 0.008889,
      confidence: 0.95,
      source: "fixed_visual_tile_coordinate_ocr",
      searchable: true,
    },
  ];
  const passages = buildECOSDrawingEvidencePassages({
    pageText: regions.map((region) => region.text).join("\n"),
    regions,
    question,
    questionVariants: ["UIC short section long section detail"],
    pageIdentity: "DRAWING PAGE CONTEXT: Sheet C8.",
    maximumPassages: 6,
  });
  const proof = passages.find((passage) =>
    /UNDERGROUND INFILTRATION[\s\S]*CHAMBERS/i.test(passage.text)
  );
  assert(proof);
  assertEquals(proof.regionId, "underground-infiltration");
  assertEquals(proof.x, 0.253889);
  assertEquals(proof.y, 0.356667);
});

Deno.test("exact-sheet purpose questions carry the verified title region", () => {
  const passages = buildECOSDrawingEvidencePassages({
    pageText: "E-2.1 2375-BLDG AREA 1 ENLARGED LIGHTING PLAN",
    regions: [
      {
        id: "building-area",
        text: "2375-BLDG AREA 1",
        x: 0.909841,
        y: 0.780667,
        width: 0.06,
        height: 0.01,
        confidence: 0.99,
        source: "embedded_text",
        searchable: true,
      },
      {
        id: "plan-purpose",
        text: "ENLARGED LIGHTING PLAN",
        x: 0.898095,
        y: 0.790444,
        width: 0.08,
        height: 0.01,
        confidence: 0.99,
        source: "embedded_text",
        searchable: true,
      },
    ],
    question: "What is the purpose of electrical sheet E-2.1?",
    pageIdentity: "DRAWING PAGE CONTEXT: Sheet E-2.1.",
    maximumPassages: 12,
  });
  const proof = passages.find((passage) => passage.regionId === "plan-purpose");
  assert(proof);
  assert(/Sheet E-2\.1/i.test(proof.text));
  assert(/2375-BLDG AREA 1/i.test(proof.text));
  assert(/ENLARGED LIGHTING PLAN/i.test(proof.text));
});

Deno.test("drawing passage selection can retain more than five bounded facts", () => {
  const passages = buildECOSDrawingEvidencePassages({
    pageText: "CANOPY A AREA SCHEDULE",
    regions: Array.from({ length: 7 }, (_, index) => ({
      id: `canopy-area-${index + 1}`,
      text: `CANOPY A AREA ${100 + index} square feet`,
      confidence: 0.99,
      source: "embedded_text",
      searchable: true,
    })),
    question: "How many square feet is Canopy A?",
    pageIdentity: "DRAWING PAGE CONTEXT: Sheet A-1.5A.",
    maximumPassages: 12,
  });
  assertEquals(passages.length, 7);
});

Deno.test("printed area proof can use a verified same-page plan title", () => {
  const passages = buildECOSDrawingEvidencePassages({
    pageText:
      "Weather Protected Canopy Hazardous Material Plan New Canopy 1 area: 6,496 square feet",
    regions: [
      {
        id: "plan-title",
        text: "Weather Protected Canopy Hazardous Material Plan",
        x: 0.8,
        y: 0.1,
        width: 0.15,
        height: 0.02,
        confidence: 0.99,
        source: "vision",
        searchable: true,
      },
      {
        id: "canopy-area",
        text: "New Canopy 1 area: 6,496 square feet",
        x: 0.1,
        y: 0.8,
        width: 0.15,
        height: 0.02,
        confidence: 0.99,
        source: "vision",
        searchable: true,
      },
    ],
    question: "hazardous material canopy architectural plan area footprint",
    pageIdentity: "DRAWING PAGE CONTEXT: Sheet A-1.5A.",
    maximumPassages: 12,
  });
  const proof = passages.find((passage) => passage.regionId === "canopy-area");
  assert(proof);
  assert(/Weather Protected Canopy Hazardous Material Plan/i.test(proof.text));
  assert(/6,496 square feet/i.test(proof.text));
});
