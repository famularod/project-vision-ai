import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  canonicalizeECOSQuestionLanguage,
  ecosExpandedQuestionTokens,
  ecosQuestionDocumentAffinity,
  ecosQuestionExplicitSheetReferences,
  ecosQuestionLexicalQueries,
  ecosQuestionRequestsDrawingLocation,
  ecosQuestionRequiredDocumentDisciplines,
  ecosQuestionRetrievalVariants,
  ecosSheetReferenceMatches,
} from "./ecos-question-language.ts";

Deno.test("question language normalizes ordinary field vocabulary and typos without changing evidence", () => {
  assertEquals(
    canonicalizeECOSQuestionLanguage(
      "Hey ECOS, can you tell me how thik is teh cement paving on the noth side?",
    ),
    "how thick is the concrete paving on the north side?",
  );
});

Deno.test("direct ECOS greetings and up-north wording do not become retrieval noise", () => {
  assertEquals(
    canonicalizeECOSQuestionLanguage(
      "Hey ECOS, what concrete depth is called out for the north side?",
    ),
    "what concrete depth is called out for the north side?",
  );
  assertEquals(
    canonicalizeECOSQuestionLanguage(
      "How many inches of concrete do the plans call for up north?",
    ),
    "How many inches of concrete do the plans call for north lot?",
  );
  assertEquals(
    canonicalizeECOSQuestionLanguage(
      "Can the plans prove how thick the crew really placed the north-lot slab?",
    ),
    "Can the plans prove how thick the crew really placed the north lot slab?",
  );
});

Deno.test("document affinity routes field wording to relevant construction disciplines", () => {
  const civilQuestion = "How thik is teh cement paving on the noth side?";
  assert(
    ecosQuestionDocumentAffinity(civilQuestion, "02A 2375 CIVIL") >
      ecosQuestionDocumentAffinity(civilQuestion, "01 2375 ARCHITECTURAL"),
  );
  const slabQuestion =
    "How thick is the concrete pad under the new storage canopy?";
  assert(
    ecosQuestionDocumentAffinity(slabQuestion, "03 2321 STRUCTURAL") >
      ecosQuestionDocumentAffinity(slabQuestion, "02 2321 CIVIL"),
  );
  assert(
    ecosQuestionDocumentAffinity(
      "How many square feet is Canopy A?",
      "08A 2375 CANOPY 'A'",
    ) > 0,
  );
  const lightingQuestion =
    "Which plans control the outside lights on the north lot?";
  assert(
    ecosQuestionDocumentAffinity(lightingQuestion, "06 2375 ELECTRICAL") > 0,
  );
  assert(
    ecosQuestionDocumentAffinity(lightingQuestion, "02A 2375 CIVIL") > 0,
  );
  assertEquals(
    ecosQuestionDocumentAffinity("What changed this week?", "06 ELECTRICAL"),
    0,
  );
});

Deno.test("panel and amperage wording routes to electrical drawings", () => {
  const question =
    "What are the amperage and pole counts for the existing panel replacements?";
  assert(
    ecosQuestionDocumentAffinity(
      question,
      "06 - PLZ CORP - 2321 THIRD STREET - ELECTRICAL",
    ) > 0,
  );
  assertEquals(
    ecosQuestionDocumentAffinity(
      question,
      "04 - PLZ CORP - 2321 THIRD STREET - MECHANICAL",
    ),
    0,
  );
});

Deno.test("question variants bridge concrete, PCC, and north-lot wording", () => {
  const variants = ecosQuestionRetrievalVariants(
    "What is the thickness of the new cement on the north side?",
  );
  assert(variants.some((value) => /concrete/i.test(value)));
  assert(variants.some((value) => /pcc/i.test(value)));
  assert(variants.some((value) => /north lot/i.test(value)));
});

Deno.test("hazardous-material wording keeps structural canopy affinity", () => {
  const question =
    "What slab thickness is required for the hazardous-material canopy?";
  assertEquals(
    canonicalizeECOSQuestionLanguage(question),
    "What slab thickness is required for the hazardous material canopy?",
  );
  assert(
    ecosQuestionDocumentAffinity(question, "03 2321 STRUCTURAL") >
      ecosQuestionDocumentAffinity(question, "02 2321 CIVIL"),
  );
});

Deno.test("explicit sheet references are canonical and do not confuse project numbers", () => {
  assertEquals(
    ecosQuestionExplicitSheetReferences(
      "What does current Sheet E-2.1 show at 2375?",
    ),
    ["E-2.1"],
  );
  assert(ecosSheetReferenceMatches("E2.1", "E-2.1"));
  assert(!ecosSheetReferenceMatches("E-2.5", "E-2.1"));
});

Deno.test("compound hazardous-canopy questions preserve both requested disciplines", () => {
  assertEquals(
    ecosQuestionRequiredDocumentDisciplines(
      "For the hazardous-material canopy, what plan area is shown and what slab thickness does the structural drawing require?",
    ),
    ["structural", "architectural"],
  );
});

Deno.test("question tokens bridge ordinary behind-the-building wording to the saved rear area", () => {
  const tokens = ecosExpandedQuestionTokens(
    "How deep is the new concrete paving behind 2375?",
  );
  assert(tokens.includes("behind"));
  assert(tokens.includes("back"));
  assert(tokens.includes("north lot"));
});

Deno.test("question normalization never substitutes project numbers", () => {
  assertEquals(
    canonicalizeECOSQuestionLanguage("What changed at 2375?"),
    "What changed at 2375?",
  );
});

Deno.test("question variants bridge field language to drawing-discipline vocabulary", () => {
  const lighting = ecosQuestionRetrievalVariants(
    "Are there lights under the north-side canopies?",
  );
  assert(
    lighting.some((value) => /^exterior storage lighting plans$/i.test(value)),
  );
  const crossDiscipline = ecosQuestionRetrievalVariants(
    "The civil sheet points lighting elsewhere. Where is it actually shown?",
  );
  assert(
    crossDiscipline.some((value) =>
      /architectural and electrical drawings civil plan/i.test(value)
    ),
  );
  const footprint = ecosQuestionRetrievalVariants(
    "How many square feet is Canopy A?",
  );
  assert(
    footprint.some((value) =>
      /overall plan dimensions.*footprint/i.test(value)
    ),
  );
  const abbreviatedFootprint = ecosQuestionRetrievalVariants(
    "What is the sq ft of canopy A on the plan?",
  );
  assert(
    abbreviatedFootprint.some((value) =>
      /overall plan dimensions.*footprint/i.test(value)
    ),
  );
});

Deno.test("lexical queries use the same bounded plan as the production runtime", () => {
  const queries = ecosQuestionLexicalQueries(
    "What is the thickness of the new cement on the north lot?",
  );
  assert(queries.length > 1 && queries.length <= 20);
  assert(queries.some((value) => /^pcc$/i.test(value)));
  assert(queries.some((value) => /^north lot$/i.test(value)));
});

Deno.test("lexical query budget fairly includes exact domain phrases", () => {
  const queries = ecosQuestionLexicalQueries(
    "Are there lights under the north-side canopies?",
  );
  assert(queries.length <= 20);
  assert(
    queries.some((value) =>
      /^exterior storage lighting plans$/i
        .test(value)
    ),
  );
  assert(
    queries.some((value) => /^lighting plans$/i.test(value)),
  );
});

Deno.test("drawing-detail location questions request bounded page expansion and UIC vocabulary", () => {
  const question =
    "Which current civil sheet contains the underground infiltration chamber details, and what sheet sends the field team there?";
  assert(ecosQuestionRequestsDrawingLocation(question));
  const variants = ecosQuestionRetrievalVariants(question);
  assert(
    variants.some((value) =>
      /UIC short section long section detail/i.test(value)
    ),
  );
  const lexical = ecosQuestionLexicalQueries(question);
  assert(lexical.some((value) => /^uic$/i.test(value)));
});
