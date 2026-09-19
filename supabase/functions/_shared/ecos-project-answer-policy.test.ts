import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  analyzeECOSProjectQuestion,
  buildECOSCanopyLightingFallback,
  buildECOSCrossDisciplineLightingFallback,
  buildECOSDrawingMeasurementFallback,
  buildECOSDrawingPresenceFallback,
  buildECOSDrawingQuantityFallback,
  ecosEvidenceMatchesQuestionRequirement,
  ecosNeedsDrawingOnlyInstalledConditionLimitation,
  ecosQuestionRequestsInstalledCondition,
  projectECOSDeterministicEvidenceText,
} from "./ecos-project-answer-policy.ts";

Deno.test("ordinary area wording is recognized without prompt-specific phrasing", () => {
  for (
    const question of [
      "How many square feet is Canopy A?",
      "What is the sq ft of Canopy A?",
      "How large is Canopy A in square feet?",
    ]
  ) {
    const requirement = analyzeECOSProjectQuestion(question);
    assertEquals(requirement.kind, "measurement");
    assertEquals(requirement.attribute, "area");
  }
});

Deno.test("tree presence questions retain the construction subject", () => {
  const requirement = analyzeECOSProjectQuestion(
    "Are all 78 trees really installed at 2321?",
  );
  assertEquals(requirement.kind, "presence");
  assertEquals(requirement.attribute, "tree");
  assert(
    ecosEvidenceMatchesQuestionRequirement(
      "Are all 78 trees really installed at 2321?",
      "Tree Planting Plan. TREES PROVIDED 78.",
    ),
  );
});

Deno.test("ordinary installed-condition wording is recognized", () => {
  for (
    const question of [
      "Are all 78 trees really installed at 2321?",
      "Did the crew plant every required tree?",
      "How many planned trees are in the ground?",
    ]
  ) {
    assert(ecosQuestionRequestsInstalledCondition(question));
  }
});

Deno.test("drawing-only installed answers always carry the field-verification limitation", () => {
  const question =
    "Was the hazardous-material canopy slab actually poured at 6 inches thick in the field?";
  assert(
    ecosNeedsDrawingOnlyInstalledConditionLimitation(question, [{
      statement:
        "Structural Sheet SB-1.1 specifies a 6-inch reinforced concrete slab.",
      sourceTypes: ["document", "project"],
    }]),
  );
  assertEquals(
    ecosNeedsDrawingOnlyInstalledConditionLimitation(question, [{
      statement:
        "A signed field update confirms the slab was poured at 6 inches.",
      sourceTypes: ["update"],
    }, {
      statement:
        "Structural Sheet SB-1.1 specifies a 6-inch reinforced concrete slab.",
      sourceTypes: ["document"],
    }]),
    false,
  );
});

Deno.test("measured field-result wording cannot be treated as design intent", () => {
  for (
    const question of [
      "What was the measured field air-balance reading for exhaust fan EF-1?",
      "What field test result was recorded for EF-1?",
      "Do we have an as-built airflow measurement?",
    ]
  ) {
    assert(ecosQuestionRequestsInstalledCondition(question));
  }
});

Deno.test("photometric questions are measurement requests", () => {
  for (
    const question of [
      "What are the site lighting high, low, and average foot-candle readings?",
      "Give me the average max and minimum light levels on the photometric sheet.",
      "What does the lighting calc say for avg maximum and minimum fc?",
    ]
  ) {
    const requirement = analyzeECOSProjectQuestion(question);
    assertEquals(requirement.kind, "measurement");
    assertEquals(requirement.attribute, "light_level");
  }
});

Deno.test("photometric fallback keeps the complete verified tuple", () => {
  const source = {
    id: "document:electrical:photometric",
    sourceType: "document",
    title: "Electrical drawing, Sheet E-2.7",
    excerpt:
      "DRAWING PAGE CONTEXT: Sheet E-2.7 — ALL 2.8 21.1 0.0 lighting photometric statistics Sheet E-2.7 coordinate-bound table ALL 2.8 21.1 0.0.",
  };
  for (
    const question of [
      "What are the site lighting high, low, and average foot-candle readings?",
      "Give me the average max and minimum light levels on the photometric sheet.",
      "What does the lighting calc say for avg maximum and minimum fc?",
    ]
  ) {
    const fallback = buildECOSDrawingMeasurementFallback(question, [source]);
    assert(fallback);
    assert(fallback.statement.match(/average 2\.8 fc/i));
    assert(fallback.statement.match(/maximum 21\.1 fc/i));
    assert(fallback.statement.match(/minimum 0\.0 fc/i));
  }
});

Deno.test("slab legend fallback preserves the verified thickness", () => {
  const source = {
    id: "document:structural:slab",
    sourceType: "document",
    title: "Structural drawing, Sheet SB-1.1",
    excerpt:
      "DRAWING PAGE CONTEXT: Sheet SB-1.1 — 6-inch-thick reinforced concrete slab slab construction coordinate-bound table.",
  };
  for (
    const question of [
      "How thick is the concrete pad under the new 2321 storage canopy?",
      "What slab depth does structural call for at the hazmat canopy?",
      "How many inches is the reinforced canopy slab supposed to be?",
    ]
  ) {
    const fallback = buildECOSDrawingMeasurementFallback(question, [source]);
    assert(fallback);
    assert(fallback.statement.match(/6-inch-thick reinforced concrete slab/i));
  }
});

Deno.test("civil construction-note fallback accepts the exact duplicated drawing format", () => {
  const source = {
    id: "document:civil:c6:pcc-paving",
    sourceType: "document",
    title: "Civil drawing, Sheet C6 — North Lot Plan",
    excerpt:
      "DRAWING PAGE CONTEXT: Sheet C6 — NORTH LOT PLAN. @ CONSTRUCT 6.0” THICK 6.0” PCC PAVING PCC",
  };
  for (
    const question of [
      "What is the thickness of the new cement on the north lot?",
      "How thick should the new north-side concrete be?",
      "What depth PCC is called out for the north lot?",
      "Hey ECOS, what concrete depth is called out for the north side?",
      "whats the p c c thickness at the back lot 2375",
      "How many inches of concrete do the plans call for up north?",
      "Was the concrete behind 2375 actually poured six inches thick?",
      "Can the plans prove how thick the crew really placed the north-lot slab?",
      "What was the as-built depth of the new cement on the back side?",
    ]
  ) {
    const fallback = buildECOSDrawingMeasurementFallback(question, [source]);
    assert(fallback);
    assert(fallback.statement.match(/6\.0” thick 6\.0” PCC paving/i));
    assertEquals(fallback.sourceIds, [source.id]);
  }
});

Deno.test("concrete fallback prefers responsive paving over a same-page walkway", () => {
  const question = "What is the thickness of the new cement on the north lot?";
  const fallback = buildECOSDrawingMeasurementFallback(question, [
    {
      id: "document:civil:c6:walkway",
      sourceType: "document",
      title: "Civil drawing, Sheet C6 — North Lot Plan",
      excerpt:
        "DRAWING PAGE CONTEXT: Sheet C6 — NORTH LOT PLAN. CONSTRUCT 4” THICK PCC WALKWAY.",
    },
    {
      id: "document:civil:c6:paving",
      sourceType: "document",
      title: "Civil drawing, Sheet C6 — North Lot Plan",
      excerpt:
        "DRAWING PAGE CONTEXT: Sheet C6 — NORTH LOT PLAN. CONSTRUCT 6.0” THICK 6.0” PCC PAVING.",
    },
  ]);
  assert(fallback);
  assert(fallback.statement.match(/6\.0” thick 6\.0” PCC paving/i));
  assert(!fallback.statement.match(/4” thick PCC walkway/i));
  assertEquals(fallback.sourceIds, ["document:civil:c6:paving"]);
});

Deno.test("photometric projection preserves the bounded tuple and adds explicit labels", () => {
  const projected = projectECOSDeterministicEvidenceText(
    "ALL 2.8 21.1 0.0 lighting photometric statistics Sheet E-2.7 coordinate-bound table",
  );
  assert(projected.match(/site photometric light levels: average 2\.8 fc/i));
  assert(projected.match(/maximum 21\.1 fc/i));
  assert(projected.match(/minimum 0\.0 fc/i));
});

Deno.test("cross-discipline lighting fallback requires both exact disciplines", () => {
  const fallback = buildECOSCrossDisciplineLightingFallback(
    "Which plans should the field use to confirm north-lot area lighting?",
    [
      {
        id: "civil-c6",
        sourceType: "document",
        title: "Civil drawing, Sheet C6",
        excerpt: "AREA LIGHTING — SEE ARCHITECTURAL AND ELECTRICAL DRAWINGS",
      },
      {
        id: "electrical-e11",
        sourceType: "document",
        title: "Electrical drawing, Sheet E-1.1",
        excerpt: "EXTERIOR STORAGE LIGHTING FIXTURES SHOWN",
      },
    ],
  );
  assert(fallback);
  assertEquals(fallback.sourceIds, ["civil-c6", "electrical-e11"]);
  assert(fallback.statement.match(/civil and electrical sources together/i));
});

Deno.test("cross-discipline lighting fallback prefers the controlling outdoor-lighting sheet", () => {
  const fallback = buildECOSCrossDisciplineLightingFallback(
    "Check civil and electrical and tell me what drawings control the outside lights.",
    [
      {
        id: "civil-c6",
        sourceType: "document",
        title: "Civil drawing, Sheet C6",
        excerpt: "AREA LIGHTING — SEE ARCHITECTURAL AND ELECTRICAL DRAWINGS",
      },
      {
        id: "electrical-e22",
        sourceType: "document",
        title: "Electrical drawing, Sheet E-2.2",
        excerpt: "EXISTING LIGHTING IN THIS AREA TO REMAIN.",
      },
      {
        id: "electrical-e12",
        sourceType: "document",
        title: "Electrical drawing, Sheet E-1.2",
        excerpt: "OUTDOOR LIGHTING CONTROLS",
      },
    ],
  );
  assert(fallback);
  assertEquals(fallback.sourceIds, ["civil-c6", "electrical-e12"]);
});

Deno.test("reinforced canopy slab questions reject unrelated PCC paving", () => {
  const fallback = buildECOSDrawingMeasurementFallback(
    "How many inches is the reinforced canopy slab supposed to be?",
    [
      {
        id: "grading-paving",
        sourceType: "document",
        title: "Civil grading plan",
        excerpt:
          "DRAWING PAGE CONTEXT: 2321 plan. CONSTRUCT 6.0” THICK PCC PAVING.",
      },
    ],
  );
  assertEquals(fallback, null);
});

Deno.test("canopy lighting fallback binds architectural canopy proof to electrical plan proof", () => {
  const fallback = buildECOSCanopyLightingFallback(
    "Are there lights under the north-side canopies?",
    [
      {
        id: "architectural-a17",
        sourceType: "document",
        title: "Architectural drawing, Sheet A-1.7",
        excerpt:
          "WEATHER-PROTECTED CANOPY. NEW LIGHT FIXTURE. SEE ELECTRICAL DRAWINGS FOR ADDITIONAL INFORMATION.",
      },
      {
        id: "electrical-e11",
        sourceType: "document",
        title: "Electrical drawing, Sheet E-1.1",
        excerpt: "EXTERIOR STORAGE LIGHTING PLANS",
      },
    ],
  );
  assert(fallback);
  assertEquals(fallback.sourceIds, ["architectural-a17", "electrical-e11"]);
  assert(fallback.statement.match(/use both sources together/i));
});

Deno.test("existential lighting wording is a presence request", () => {
  for (
    const question of [
      "Are there lights under the north-side canopies?",
      "Is canopy lighting part of the current drawings?",
    ]
  ) {
    const requirement = analyzeECOSProjectQuestion(question);
    assertEquals(requirement.kind, "presence");
    assertEquals(requirement.attribute, "lighting");
  }
});

Deno.test("drawing presence fallback remains bounded to responsive evidence", () => {
  const question = "Are there lights under the north-side canopies?";
  const fallback = buildECOSDrawingPresenceFallback(question, [{
    id: "document:electrical:1:light",
    sourceType: "document",
    title: "Electrical drawing, Sheet E-1.1",
    excerpt:
      "DRAWING PAGE CONTEXT: Sheet E-1.1 — NORTH SIDE EXTERIOR STORAGE AREA. LIGHTING FIXTURES SHOWN.",
  }]);
  assert(fallback);
  assert(fallback.statement.match(/current drawing shows lighting/i));
  assertEquals(fallback.sourceIds, ["document:electrical:1:light"]);
});

Deno.test("installed tree quantity fallback carries the plan count and field limit", () => {
  const sources = [
    {
      id: "document:landscape:1:required-trees",
      sourceType: "document",
      title: "Landscape drawing, Sheet L-1",
      excerpt:
        "DRAWING PAGE CONTEXT: Sheet L-1 — 2321 LANDSCAPE PLAN. TREES REQUIRED: 71 TREES.",
    },
    {
      id: "document:landscape:1:provided-trees",
      sourceType: "document",
      title: "Landscape drawing, Sheet L-1",
      excerpt:
        "DRAWING PAGE CONTEXT: Sheet L-1 — 2321 LANDSCAPE PLAN. TREES PROVIDED: 78 TREES.",
    },
  ];
  for (
    const question of [
      "Are all 78 trees really installed at 2321?",
      "Do the landscape plans prove the crew planted every required tree?",
      "How many of the planned trees can ECOS confirm are in the ground?",
    ]
  ) {
    const fallback = buildECOSDrawingQuantityFallback(question, sources);
    assert(fallback);
    assert(fallback.statement.match(/78 trees provided by the plan/i));
    assert(fallback.statement.match(/does not verify or confirm/i));
    assert(fallback.statement.match(/installed in the field/i));
  }
});
