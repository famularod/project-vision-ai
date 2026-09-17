import { assertEquals } from "jsr:@std/assert@1";
import {
  buildECOSDrawingQuantityFallback,
  containsECOSQuantityValue,
  ecosFactAnswersQuestion,
  ecosFactAnswersQuestionOrRetrievalVariant,
} from "./ecos-project-answer-policy.ts";

const question = "How many light fixtures are in canopy C";
const claim = "Canopy C has 12 light fixtures.";
const unrelated =
  "Field update date: 2026-07-07. Area: Canopy C. Notes: the flooring changed from light wood laminate to darker tile. A gray CMU block wall was installed on previously poured concrete footings; no light fixture count is given.";
const nonAnswer =
  "Field updates dated 2026-07-07 for area Canopy C describe flooring material differences and installation of a gray CMU block wall on previously poured concrete footings; they contain no light fixture count.";

Deno.test("quantity regression: the owner's dated flooring non-answer is rejected", () => {
  assertEquals(containsECOSQuantityValue(unrelated, question), false);
  assertEquals(
    ecosFactAnswersQuestion({
      question,
      statement: nonAnswer,
      sourceExcerpts: [unrelated],
    }),
    false,
  );
  assertEquals(
    ecosFactAnswersQuestionOrRetrievalVariant({
      question,
      statement: nonAnswer,
      sourceExcerpts: [unrelated],
    }),
    false,
  );
});

for (
  const source of [
    "Canopy C light fixtures: revised 2026-07-07, Sheet E-12, revision 12.",
    "Canopy C: 12 inch light fixtures, 120 volt supply.",
    "Canopy C light fixture count is not verified. 12 doors are scheduled.",
    "Canopy C has 8 light fixtures and 12 doors.",
    "Canopy C has 120 light fixtures.",
    "Canopy C has not confirmed 12 light fixtures.",
    "Canopy C has approximately 12 light fixtures.",
    "Canopy C: 12-volt light fixtures.",
    "Canopy C: 3.12 light fixtures.",
    "Canopy C: 12 light fixtures per circuit.",
    "Canopy C has 8 to 12 light fixtures.",
    "Canopy C has >12 light fixtures.",
    "Canopy C has 12 light fixtures. Canopy C fixture schedule: light fixtures: 8.",
    "Canopy A has 12 light fixtures.",
  ]
) {
  Deno.test(`quantity regression rejects unrelated, mismatched or qualified counts: ${source}`, () => {
    assertEquals(
      ecosFactAnswersQuestion({
        question,
        statement: claim,
        sourceExcerpts: [source],
      }),
      false,
    );
  });
}

for (
  const [q, statement, source] of [
    [question, claim, "Canopy C lighting schedule: 12 light fixtures."],
    [question, claim, "Canopy C: LIGHT FIXTURES — QUANTITY: 12."],
    [question, claim, "Canopy C: 12 luminaires."],
    [
      question,
      "Canopy C has 0 light fixtures.",
      "Canopy C: light fixtures: 0.",
    ],
    [
      "How many doors are in Canopy C?",
      "Canopy C has 12 doors.",
      "Canopy C: 12 doors.",
    ],
    [
      "What is the number of fans in Canopy C?",
      "Canopy C has 8 fans.",
      "Canopy C: fan count: 8.",
    ],
    [
      "How many windows are in Canopy C?",
      "Canopy C has 1,200 windows.",
      "Canopy C: window quantity: 1200.",
    ],
    [
      "How many of the 12 fixtures are in Canopy C?",
      "Canopy C has 12 fixtures.",
      "Canopy C: 12 fixtures.",
    ],
  ]
) {
  Deno.test(`quantity regression accepts supported same-item counts: ${q} ${source}`, () => {
    assertEquals(
      ecosFactAnswersQuestion({
        question: q,
        statement,
        sourceExcerpts: [source],
      }),
      true,
    );
  });
}

Deno.test("quantity regression does not join an identity-only source to another source's count", () => {
  assertEquals(
    ecosFactAnswersQuestion({
      question,
      statement: claim,
      sourceExcerpts: ["Canopy C lighting schedule.", "12 light fixtures."],
    }),
    false,
  );
});

Deno.test("quantity fallback cannot turn a canopy count into a light fixture count", () => {
  assertEquals(
    buildECOSDrawingQuantityFallback(question, [{
      id: "wrong-count",
      sourceType: "document",
      title: "Canopy C",
      excerpt: "Canopy C light wood flooring. Canopy quantity: 12.",
    }]),
    null,
  );
});
