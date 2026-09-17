import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildECOSDrawingEvidencePassages } from "./ecos-drawing-evidence.ts";

const question = "What is the square footage for Canopy A, for Canopy B, and Canopy C?";
function passages(identity: string, width: number, length: number, query = question, dimensionLabel = "") {
  return buildECOSDrawingEvidencePassages({
    question: query, pageIdentity: identity, pageText: "ANCHOR ROD PLAN", maximumPassages: 6,
    regions: [
      { id: "heading", text: "ANCHOR ROD PLAN", x: .2, y: .7, width: .2, height: .02, source: "vision", confidence: .99, searchable: true },
      { id: "width", text: `${dimensionLabel} OVERALL WIDTH: ${width}'-0\"`, x: .2, y: .8, width: .2, height: .01, source: "vision", confidence: .99, searchable: true },
      { id: "length", text: `OVERALL LENGTH: ${length}'-0\"`, x: .1, y: .2, width: .01, height: .2, source: "vision", confidence: .99, searchable: true },
    ],
  }).filter((passage) => passage.text.includes("ECOS VERIFIED PLAN-FOOTPRINT CALCULATION:"));
}

Deno.test("combined question produces distinct exact-page calculations, not relabeled A answers", () => {
  for (const [label, width, length, expected] of [
    ["A", 122, 52, "6,344"], ["B", 82, 64, "5,248"], ["C", 32, 82, "2,624"],
  ] as const) {
    const result = passages(`Canopy ${label} — Sheet WP${label}-4`, width, length);
    assertEquals(result.length, 1);
    assert(result[0].text.includes(`${expected} square feet`));
    assert(result[0].text.startsWith(`Canopy ${label}`));
    for (const other of ["A", "B", "C"].filter((value) => value !== label)) {
      assert(!result[0].text.includes(`Canopy ${other}`));
    }
  }
});

Deno.test("September 14 desktop and repeated mobile questions retain each dimension pair", () => {
  const ownerQuestions = [
    "what is the square footage for canopy A, canopy B and Canopy C?",
    "What is the square footage for canopy A, what is the square footage for canopy B, and what is the square footage for canopy C?",
  ];
  for (const query of ownerQuestions) {
    for (const [label, width, length, expected] of [
      ["A", 122, 52, "6,344"], ["B", 82, 64, "5,248"], ["C", 32, 82, "2,624"],
    ] as const) {
      const result = passages(`Canopy ${label} — Sheet WP${label}-4`, width, length, query);
      assertEquals(result.length, 1, `${query}: ${label} same-page width/length pair lost`);
      assert(result[0].text.startsWith(`Canopy ${label}`));
      assert(result[0].text.includes(`${expected} square feet`));
      assert(result[0].text.includes(`${width}'-0\"`));
      assert(result[0].text.includes(`${length}'-0\"`));
      assert(!result[0].text.toLowerCase().includes("conflicting"));
    }
  }
});

Deno.test("same mechanism handles shared-noun lists and non-canopy subjects", () => {
  assertEquals(passages("Canopy C — Sheet 4", 32, 82, "What is the square footage of canopies A, B and C?").length, 1);
  const result = passages("Building B — foundation plan", 30, 40, "What is the square footage of Building A and Building B?");
  assertEquals(result.length, 1);
  assert(result[0].text.includes("1,200 square feet"));
});

Deno.test("multi-entity calculations reject missing, mixed, other or conflicting dimension identities", () => {
  for (const identity of ["ANCHOR ROD PLAN", "Canopy D — Sheet 4", "Canopy A and Canopy B — Sheet 4"]) {
    assertEquals(passages(identity, 122, 52).length, 0);
  }
  assertEquals(passages("Canopy A — Sheet 4", 122, 52, question, "Canopy B").length, 0);
  assertEquals(passages("Canopy A south lot — Sheet 4", 122, 52,
    "What is the square footage of Canopy A and Canopy B on the north lot?").length, 0);
});
