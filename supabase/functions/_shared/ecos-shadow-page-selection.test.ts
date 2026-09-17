import { assert, assertEquals } from "jsr:@std/assert@1";
import { ecosHasDecisiveShadowPageEvidence } from "./ecos-shadow-page-selection.ts";

const compoundQuestion =
  "For the 2321 hazardous-material canopy, what plan area is shown and what slab thickness does the structural drawing require?";

Deno.test("multi-subject area expansion requires an independent calculation for every identity", () => {
  for (const question of ["What is the square footage for Canopy A, for Canopy B, and Canopy C?", "What are the recorded dimensions and sheet references for canopy A, canopy B, and canopy C footprint?"]) {
  const rows = [
    { document_name: "Canopy A", chunk_text: "Canopy A PLAN\nECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 122'-0\" × 52'-0\" = 6,344 square feet." },
    { document_name: "Canopy B", chunk_text: "Canopy B PLAN\nECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 82'-0\" × 64'-0\" = 5,248 square feet." },
    { document_name: "Canopy C", chunk_text: "Canopy C PLAN\nECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 32'-0\" × 82'-0\" = 2,624 square feet." },
  ];
  assertEquals(ecosHasDecisiveShadowPageEvidence(question, rows.slice(0, 1)), false);
  assertEquals(ecosHasDecisiveShadowPageEvidence(question, rows.slice(0, 2)), false);
  assertEquals(ecosHasDecisiveShadowPageEvidence(question, rows), true);
  assertEquals(ecosHasDecisiveShadowPageEvidence(question, [rows[0], rows[1], {...rows[0], document_name: "Canopy C"}]), false);
  }
});

Deno.test("compound canopy evidence does not stop on an unrelated calculated footprint", () => {
  assertEquals(
    ecosHasDecisiveShadowPageEvidence(compoundQuestion, [
      {
        document_name: "01 2321 ARCHITECTURAL",
        sheet_number: "A-1.5",
        chunk_text:
          "WEATHER PROTECTED CANOPY PLAN\nECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 60'-0\" × 4'-0\" = 240 square feet.",
      },
      {
        document_name: "03 2321 STRUCTURAL",
        sheet_number: "SB-1.1",
        chunk_text: "6-inch-thick reinforced concrete slab",
      },
    ]),
    false,
  );
});

Deno.test("compound canopy evidence stops only after responsive architectural and structural proof", () => {
  assert(
    ecosHasDecisiveShadowPageEvidence(compoundQuestion, [
      {
        document_name: "01 2321 ARCHITECTURAL",
        sheet_number: "A-1.5A",
        chunk_text:
          "WEATHER PROTECTED CANOPY — HAZARDOUS MATERIAL CONTAINMENT AREA — NEW CANOPY 1 — 6,496 SF",
      },
      {
        document_name: "03 2321 STRUCTURAL",
        sheet_number: "SB-1.1",
        chunk_text: "6-inch-thick reinforced concrete slab",
      },
    ]),
  );
});

Deno.test("explicit sheet evidence never treats a nearby sheet as decisive", () => {
  assertEquals(
    ecosHasDecisiveShadowPageEvidence(
      "What does current electrical Sheet E-2.1 show for Building Area 1?",
      [{
        document_name: "06 2375 ELECTRICAL",
        sheet_number: "E-2.2",
        chunk_text: "BUILDING AREA 1 ENLARGED POWER PLAN",
      }],
    ),
    false,
  );
});

Deno.test("explicit sheet evidence stops after the verified requested page is loaded", () => {
  assert(
    ecosHasDecisiveShadowPageEvidence(
      "What does current electrical Sheet E-2.1 show for Building Area 1?",
      [{
        document_name: "06 2375 ELECTRICAL",
        sheet_number: "E-2.1",
        chunk_text: "BUILDING AREA 1 ENLARGED LIGHTING PLAN",
      }],
    ),
  );
});

Deno.test("cross-discipline lighting does not stop on unbounded electrical page text", () => {
  const question =
    "Which plans should the field use to confirm north-lot area lighting?";
  assertEquals(
    ecosHasDecisiveShadowPageEvidence(question, [
      {
        document_name: "02A 2375 CIVIL",
        sheet_number: "C6",
        region_id: "civil-region",
        chunk_text: "AREA LIGHTING — SEE ARCHITECTURAL AND ELECTRICAL DRAWINGS",
        metadata: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      },
      {
        document_name: "06 2375 ELECTRICAL",
        sheet_number: "E-1.1",
        chunk_text: "EXTERIOR STORAGE LIGHTING FIXTURES SHOWN",
      },
    ]),
    false,
  );
});

Deno.test("cross-discipline lighting stops after two bounded verified sheets", () => {
  const question =
    "Which plans should the field use to confirm north-lot area lighting?";
  assert(
    ecosHasDecisiveShadowPageEvidence(question, [
      {
        document_name: "02A 2375 CIVIL",
        sheet_number: "C6",
        region_id: "civil-region",
        chunk_text: "AREA LIGHTING — SEE ARCHITECTURAL AND ELECTRICAL DRAWINGS",
        metadata: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      },
      {
        document_name: "06 2375 ELECTRICAL",
        sheet_number: "E-1.1",
        region_id: "electrical-region",
        chunk_text: "EXTERIOR STORAGE LIGHTING FIXTURES SHOWN",
        metadata: { x: 0.3, y: 0.2, width: 0.2, height: 0.1 },
      },
    ]),
  );
});
