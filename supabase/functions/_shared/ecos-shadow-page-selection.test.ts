import { assert, assertEquals } from "jsr:@std/assert@1";
import { ecosHasDecisiveShadowPageEvidence } from "./ecos-shadow-page-selection.ts";

const compoundQuestion =
  "For the 2321 hazardous-material canopy, what plan area is shown and what slab thickness does the structural drawing require?";

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
