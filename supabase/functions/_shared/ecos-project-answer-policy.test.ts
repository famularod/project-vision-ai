import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  analyzeECOSProjectQuestion,
  buildECOSCanopyLightingFallback,
  buildECOSCrossDisciplineCanopyFallback,
  buildECOSCrossDisciplineLightingFallback,
  buildECOSCrossSheetCanopyPlanSetFallback,
  buildECOSDrawingAreaFallback,
  buildECOSDrawingLocationFallback,
  buildECOSDrawingMeasurementFallback,
  buildECOSDrawingPresenceFallback,
  buildECOSDrawingQuantityFallback,
  buildECOSExactSheetPurposeFallback,
  buildECOSInstalledDesignFallback,
  ecosCalculatedPlanFootprintLimitation,
  ecosDeterministicPresenceIsPositive,
  ecosEvidenceMatchesQuestionRequirement,
  ecosFactAnswersQuestion,
  ecosFactAnswersQuestionOrRetrievalVariant,
  ecosFactUsesCompetingDrawingMeasurement,
  ecosFactUsesCompetingDrawingQuantity,
  ecosIsNegativePresenceStatement,
  ecosNeedsDrawingOnlyInstalledConditionLimitation,
  ecosProposedLimitationIsRelevant,
  ecosQuestionRequestsInstalledCondition,
  ecosStatementHasDrawingMeasurement,
  ecosVerifiedAnswerStatus,
  projectECOSDeterministicEvidenceText,
} from "./ecos-project-answer-policy.ts";

Deno.test("ordinary area wording is recognized without prompt-specific phrasing", () => {
  for (
    const question of [
      "How many square feet is Canopy A?",
      "What is the sq ft of Canopy A?",
      "How large is Canopy A in square feet?",
      "Can you work out the footprint of canopy A?",
    ]
  ) {
    const requirement = analyzeECOSProjectQuestion(question);
    assertEquals(requirement.kind, "measurement");
    assertEquals(requirement.attribute, "area");
  }
});

Deno.test("an exact slab dimension answers a generic concrete-thickness question", () => {
  const question = "What concrete thickness does the current drawing require?";
  assert(
    ecosFactAnswersQuestion({
      question,
      statement:
        "The current drawing requires an 8-inch reinforced concrete slab.",
      sourceExcerpts: [
        "Current structural Sheet S-2.1 requires an 8-inch reinforced concrete slab under the hazardous-material canopy.",
      ],
    }),
  );
  assertEquals(
    ecosFactAnswersQuestion({
      question,
      statement: "An 8-inch pipe crosses the reinforced concrete slab.",
      sourceExcerpts: [
        "An 8-inch-diameter pipe crosses the reinforced concrete slab.",
      ],
    }),
    false,
  );
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

Deno.test("field-only model limitations do not destabilize a design answer", () => {
  assertEquals(
    ecosProposedLimitationIsRelevant(
      "How thick should the new north-side concrete be?",
      "The drawing does not field-verify the actual poured thickness.",
    ),
    false,
  );
  assert(
    ecosProposedLimitationIsRelevant(
      "Was the concrete actually poured six inches thick?",
      "The drawing does not field-verify the actual poured thickness.",
    ),
  );
});

Deno.test("a clean verified answer is not downgraded by internal proposal rejection", () => {
  assertEquals(ecosVerifiedAnswerStatus(false, []), "verified");
  assertEquals(
    ecosVerifiedAnswerStatus(false, ["The drawing is design-only evidence."]),
    "verified_with_limits",
  );
  assertEquals(ecosVerifiedAnswerStatus(true, []), "verified_with_limits");
});

Deno.test("a calculated plan footprint always carries the same proof limitation", () => {
  const expected =
    "The square footage is calculated from the cited drawing dimensions; it is not a separately printed area value.";
  assertEquals(
    ecosCalculatedPlanFootprintLimitation([{
      sourceType: "document",
      excerpt:
        "ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 122'-0\" × 52'-0\" = 6,344 square feet.",
    }]),
    expected,
  );
  assertEquals(
    ecosCalculatedPlanFootprintLimitation([{
      sourceType: "document",
      excerpt: "CANOPY A OVERALL DIMENSIONS 122'-0\" BY 52'-0\".",
    }]),
    null,
  );
});

Deno.test("work-out-the-footprint wording uses the verified Canopy A calculation", () => {
  const fallback = buildECOSDrawingAreaFallback(
    "Can you work out the footprint of canopy A?",
    [{
      id: "document:canopy-a:plan-dimensions",
      sourceType: "document",
      title: "Canopy A drawing, Sheet 1",
      excerpt:
        "ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 122'-0\" × 52'-0\" = 6,344 square feet.",
    }],
  );
  assert(fallback);
  assert(fallback.statement.match(/6,344 square feet/i));
  assert(fallback.statement.match(/calculated plan footprint/i));
});

Deno.test("calculated canopy area is bound to the requested canopy document", () => {
  const sources = [
    {
      id: "document:canopy-a:plan-dimensions",
      sourceType: "document",
      title: "08A - Canopy 'A', Sheet WPA-4",
      excerpt:
        "ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 122'-0\" × 52'-0\" = 6,344 square feet.",
    },
    {
      id: "document:canopy-b:plan-dimensions",
      sourceType: "document",
      title: "08B - Canopy 'B', Sheet WPR-4",
      excerpt:
        "ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 82'-0\" × 64'-0\" = 5,248 square feet.",
    },
    {
      id: "document:canopy-c:plan-dimensions",
      sourceType: "document",
      title: "08C - Canopy 'C', Sheet WPR-4",
      excerpt:
        "ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 82'-0\" × 32'-0\" = 2,624 square feet.",
    },
  ] as const;
  for (const question of ["What is the square footage of all three canopies?", "What is the square footage of each canopy A, B and C?", "Compare the square footage of canopies C, B and A"]) {
    assertEquals(buildECOSDrawingAreaFallback(question, sources), null);
  }
  for (
    const [identity, expectedArea, expectedSourceId] of [
      ["A", "6,344", "document:canopy-a:plan-dimensions"],
      ["B", "5,248", "document:canopy-b:plan-dimensions"],
      ["C", "2,624", "document:canopy-c:plan-dimensions"],
    ] as const
  ) {
    const question = `What is the square footage for canopy ${identity}?`;
    const fallback = buildECOSDrawingAreaFallback(question, sources);
    assert(fallback);
    assert(fallback.statement.includes(`${expectedArea} square feet`));
    assertEquals(fallback.sourceIds, [expectedSourceId]);
  }

  assertEquals(
    buildECOSDrawingAreaFallback(
      "What is the square footage for canopy B?",
      [sources[0]],
    ),
    null,
  );
  assertEquals(
    ecosFactAnswersQuestion({
      question: "What is the square footage for canopy B?",
      statement: "Canopy B has a calculated footprint of 6,344 square feet.",
      sourceExcerpts: [`${sources[0].title} ${sources[0].excerpt}`],
    }),
    false,
  );
});

Deno.test("drawing-only installed evidence forces a negative direct answer", () => {
  assert(
    ecosIsNegativePresenceStatement(
      "The drawing does not verify or confirm that 78 trees are installed in the field.",
    ),
  );
  assertEquals(
    ecosIsNegativePresenceStatement(
      "A signed field update confirms that all 78 trees are installed.",
    ),
    false,
  );
});

Deno.test("drawing presence cannot prove an installed field condition", () => {
  assert(
    ecosDeterministicPresenceIsPositive(
      "Does the drawing show parking-lot trees?",
      true,
    ),
  );
  assertEquals(
    ecosDeterministicPresenceIsPositive(
      "Have all 78 trees been installed in the field?",
      true,
    ),
    false,
  );
});

Deno.test("competing measurements outside the deterministic selection are rejected", () => {
  assert(
    ecosFactUsesCompetingDrawingMeasurement({
      statement: "The north-lot walkway is 4 inches thick.",
      sourceIds: ["document:walkway"],
    }, ["document:paving"]),
  );
  assertEquals(
    ecosFactUsesCompetingDrawingMeasurement({
      statement: "The north-lot paving is 6 inches thick.",
      sourceIds: ["document:paving"],
    }, ["document:paving"]),
    false,
  );
  assert(
    ecosFactUsesCompetingDrawingMeasurement(
      {
        statement:
          "The drawing specifies 6 inches of PCC paving and also a 4-inch walkway.",
        sourceIds: ["document:paving", "document:walkway"],
      },
      ["document:paving"],
      "The drawing specifies 6-inch PCC paving.",
    ),
  );
});

Deno.test("model-proposed measurements can yield to deterministic drawing proof", () => {
  assert(ecosStatementHasDrawingMeasurement(
    "The drawing shows 6 inches of PCC paving and a separate 4-inch walkway.",
  ));
  assert(ecosStatementHasDrawingMeasurement(
    "Civil Sheet C6 specifies: CONSTRUCT 6” THICK PCC in the North Lot Plan.",
  ));
  assert(ecosStatementHasDrawingMeasurement(
    'The drawing specifies CONSTRUCT 6" THICK PCC PAVING.',
  ));
  assertEquals(
    ecosStatementHasDrawingMeasurement(
      "Use the current civil sheet for the north-lot paving requirement.",
    ),
    false,
  );
});

Deno.test("competing installed quantities outside the selected proof are rejected", () => {
  const question = "Are all 78 trees really installed at 2321?";
  const selected =
    "The current drawing shows 78 trees provided by the plan. The drawing does not verify or confirm that 78 trees are installed in the field.";
  assert(
    ecosFactUsesCompetingDrawingQuantity(
      question,
      {
        statement:
          "Sheet L-4 lists 12 maple trees and 8 oak trees in the planting schedule.",
      },
      selected,
    ),
  );
  assertEquals(
    ecosFactUsesCompetingDrawingQuantity(
      question,
      {
        statement:
          "The drawing does not verify that all 78 trees are installed at 2321.",
      },
      selected,
    ),
    false,
  );
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

Deno.test("airflow and air-balance questions are exact measurement requests", () => {
  for (
    const question of [
      "What airflow is scheduled for exhaust fan EF-1?",
      "What was the measured field air-balance reading for EF-1?",
      "How many CFM does EF-2 provide?",
      "How much air does EF-1 move and what rooms does it exhaust?",
    ]
  ) {
    const requirement = analyzeECOSProjectQuestion(question);
    assertEquals(requirement.kind, "measurement");
    assertEquals(requirement.attribute, "airflow");
  }
});

Deno.test("equipment schedule fallback preserves each requested fan relationship", () => {
  const source = {
    id: "document:mechanical:mb12:fan-schedule",
    sourceType: "document",
    title: "Mechanical drawing, Sheet MB-1.2",
    excerpt:
      "Exhaust fan EF-1: 100 CFM; serves 4 restrooms and 1 janitor closet. Exhaust fan EF-2: 630 CFM; serves 3 control rooms. Exhaust fan EF-3: 630 CFM; serves 2 control rooms.",
  };
  const single = buildECOSDrawingMeasurementFallback(
    "How much airflow is scheduled for restroom exhaust fan EF-1?",
    [source],
  );
  assert(single);
  assert(single.statement.match(/EF-1: 100 CFM/i));
  assert(single.statement.match(/4 restrooms and 1 janitor closet/i));

  const comparison = buildECOSDrawingMeasurementFallback(
    "Compare the scheduled airflow and room coverage for EF-2 and EF-3.",
    [source],
  );
  assert(comparison);
  assert(comparison.statement.match(/EF-2: 630 CFM/i));
  assert(comparison.statement.match(/3 control rooms/i));
  assert(comparison.statement.match(/EF-3: 630 CFM/i));
  assert(comparison.statement.match(/2 control rooms/i));
});

Deno.test("measured airflow fallback states the design value and field limitation", () => {
  for (
    const question of [
      "What was the measured field air-balance reading for exhaust fan EF-1?",
      "What was the measured air-balance reading for EF-1?",
    ]
  ) {
    const fallback = buildECOSDrawingMeasurementFallback(
      question,
      [{
        id: "document:mechanical:mb12:ef1",
        sourceType: "document",
        title: "Mechanical drawing, Sheet MB-1.2",
        excerpt:
          "Exhaust fan EF-1: 100 CFM; serves 4 restrooms and 1 janitor closet.",
      }],
      { includeRelatedSpecifications: true },
    );
    assert(fallback);
    assert(fallback.statement.match(/EF-1: 100 CFM/i));
    assert(fallback.statement.match(/does not field-verify/i));
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
      "What's the required thickness for the new weather-cover slab at 2321?",
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
      "How thick should the new slab be in the back parking lot?",
      "whats the p c c thickness at the back lot 2375",
      "How many inches of concrete do the plans call for up north?",
      "north side cement how many inchs is it sposed to be",
      "Was the concrete behind 2375 actually poured six inches thick?",
      "Can the plans prove how thick the crew really placed the north-lot slab?",
      "What was the as-built depth of the new cement on the back side?",
      "Do we have proof the north-lot pour is really six inches?",
    ]
  ) {
    const fallback = buildECOSDrawingMeasurementFallback(question, [source]);
    assert(fallback);
    assert(fallback.statement.match(/6\.0” thick 6\.0” PCC paving/i));
    assertEquals(fallback.sourceIds, [source.id]);
  }
  const fieldProof = buildECOSDrawingMeasurementFallback(
    "Do we have proof the north-lot pour is really six inches?",
    [source],
  );
  assert(fieldProof?.statement.match(/does not field-verify/i));
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

Deno.test("measurement fallback resolves equal-score proof independently of source order", () => {
  const question = "What is the thickness of the new cement on the north lot?";
  const sources = [
    {
      id: "document:civil:c6:paving:z-source",
      sourceType: "document",
      title: "Civil drawing, Sheet C6 — North Lot Plan",
      excerpt:
        "DRAWING PAGE CONTEXT: Sheet C6 — NORTH LOT PLAN. CONSTRUCT 6.0” THICK 6.0” PCC PAVING.",
    },
    {
      id: "document:civil:c6:paving:a-source",
      sourceType: "document",
      title: "Civil drawing, Sheet C6 — North Lot Plan",
      excerpt:
        "DRAWING PAGE CONTEXT: Sheet C6 — NORTH LOT PLAN. CONSTRUCT 6.0” THICK 6.0” PCC PAVING.",
    },
  ];
  const forward = buildECOSDrawingMeasurementFallback(question, sources);
  const reverse = buildECOSDrawingMeasurementFallback(
    question,
    [...sources].reverse(),
  );
  assert(forward);
  assert(reverse);
  assertEquals(forward.statement, reverse.statement);
  assertEquals(forward.sourceIds, ["document:civil:c6:paving:a-source"]);
  assertEquals(reverse.sourceIds, forward.sourceIds);
});

Deno.test("installed-condition fallback excludes unrelated specifications", () => {
  const fallback = buildECOSInstalledDesignFallback(
    "Was the concrete behind 2375 actually poured six inches thick?",
    [
      {
        id: "document:civil:c6:walkway",
        sourceType: "document",
        title: "Civil drawing, Sheet C6 — North Lot Plan",
        excerpt: "CONSTRUCT 4” THICK PCC WALKWAY.",
      },
      {
        id: "document:civil:c6:paving",
        sourceType: "document",
        title: "Civil drawing, Sheet C6 — North Lot Plan",
        excerpt: "CONSTRUCT 6.0” THICK 6.0” PCC PAVING.",
      },
    ],
  );
  assert(fallback);
  assert(fallback.statement.match(/6\.0” thick 6\.0” PCC paving/i));
  assert(!fallback.statement.match(/4” thick PCC walkway/i));
  assert(fallback.statement.match(/does not field-verify/i));
});

Deno.test("photometric projection preserves the bounded tuple and adds explicit labels", () => {
  const projected = projectECOSDeterministicEvidenceText(
    "ALL 2.8 21.1 0.0 lighting photometric statistics Sheet E-2.7 coordinate-bound table",
  );
  assert(projected.match(/site photometric light levels: average 2\.8 fc/i));
  assert(projected.match(/maximum 21\.1 fc/i));
  assert(projected.match(/minimum 0\.0 fc/i));
});

Deno.test("panel replacement projection normalizes amp and pole proof without changing values", () => {
  const projected = projectECOSDeterministicEvidenceText(
    "Existing panel replacement: 125-amp bus and 30 poles. Existing panel replacement: 225-amp bus and 42 poles.",
  );
  assert(projected.match(/125 AMPS bus and 30 POLES/i));
  assert(projected.match(/225 AMPS bus and 42 POLES/i));
});

Deno.test("exact sheet purpose fallback joins purpose and area only on the requested sheet", () => {
  const fallback = buildECOSExactSheetPurposeFallback(
    "What does current electrical Sheet E-2.1 show for Building Area 1?",
    [
      {
        id: "e21-purpose",
        sourceType: "document",
        title: "Electrical drawing, Sheet E-2.1",
        excerpt: "ENLARGED LIGHTING PLAN",
        documentCitation: { sheetNumber: "E-2.1" },
      },
      {
        id: "e21-area",
        sourceType: "document",
        title: "Electrical drawing, Sheet E-2.1",
        excerpt: "BLDG AREA 1",
        documentCitation: { sheetNumber: "E2.1" },
      },
      {
        id: "e22-wrong",
        sourceType: "document",
        title: "Electrical drawing, Sheet E-2.2",
        excerpt: "BUILDING AREA 1 ENLARGED POWER PLAN",
        documentCitation: { sheetNumber: "E-2.2" },
      },
    ],
  );
  assert(fallback);
  assert(fallback.statement.match(/Building Area 1 Enlarged Lighting Plan/i));
  assertEquals(fallback.sourceIds, ["e21-purpose", "e21-area"]);
});

Deno.test("exact sheet purpose fallback fails closed on conflicting purpose or area", () => {
  const question = "What is electrical Sheet E-2.1 for?";
  const base = {
    id: "e21-lighting",
    sourceType: "document",
    title: "Electrical drawing, Sheet E-2.1",
    excerpt: "BUILDING AREA 1 ENLARGED LIGHTING PLAN",
    documentCitation: { sheetNumber: "E-2.1" },
  };
  assertEquals(
    buildECOSExactSheetPurposeFallback(question, [
      base,
      { ...base, id: "e21-power", excerpt: "BUILDING AREA 1 POWER PLAN" },
    ]),
    null,
  );
  assertEquals(
    buildECOSExactSheetPurposeFallback(question, [
      base,
      {
        ...base,
        id: "e21-area-2",
        excerpt: "BUILDING AREA 2 ENLARGED LIGHTING PLAN",
      },
    ]),
    null,
  );
});

Deno.test("drawing location fallback requires bounded referral and target proof", () => {
  const question = "Where are the underground infiltration chamber details?";
  const sources = [
    {
      id: "c6-referral",
      sourceType: "document",
      title: "Civil drawing, Sheet C6",
      excerpt:
        "CONSTRUCT UNDERGROUND INFILTRATION CHAMBERS - SEE DETAILS ON SHEET 8",
      score: 25,
      documentCitation: { sheetNumber: "C6" },
      documentRegion: { id: "visual-c6" },
    },
    {
      id: "c8-detail",
      sourceType: "document",
      title: "Civil drawing, Sheet C8",
      excerpt: "UNDERGROUND INFILTRATION CHAMBERS. UIC #2 SHORT SECTION.",
      score: 20,
      documentCitation: { sheetNumber: "C8" },
      documentRegion: { id: "visual-c8" },
    },
  ];
  const fallback = buildECOSDrawingLocationFallback(question, sources);
  assert(fallback);
  assert(
    fallback.statement.match(
      /Sheet C6 directs the field team to Sheet C8 for the Underground Infiltration Chambers details/i,
    ),
  );
  assertEquals(fallback.sourceIds, ["c6-referral", "c8-detail"]);

  assertEquals(
    buildECOSDrawingLocationFallback(question, [
      sources[0],
      { ...sources[1], documentRegion: undefined },
    ]),
    null,
  );
});

Deno.test("cross-sheet canopy plan-set fallback requires both exact bounded plan titles", () => {
  const question =
    "Which current architectural sheets make up the 2321 hazardous-material canopy plan set?";
  const sources = [
    {
      id: "a15-referral",
      sourceType: "document",
      title: "Architectural drawing, Sheet A-1.5A",
      excerpt:
        "HAZARDOUS MATERIAL LAYOUT PLAN 2. SEE SHEET A-1.5 FOR CANOPY INFORMATION",
      score: 100,
      documentCitation: { sheetNumber: "A-1.5A" },
      documentRegion: { id: "weak-referral" },
    },
    {
      id: "a15-plan-title",
      sourceType: "document",
      title: "Architectural drawing, Sheet A-1.5",
      excerpt: "WEATHER PROTECTED CANOPY PLANS",
      score: 20,
      documentCitation: { sheetNumber: "A-1.5" },
      documentRegion: {
        id: "visual-a15",
        reconstructionMethod: "exact_source_bound_dual_render_consensus",
        evidenceSources: ["primary", "corroboration"],
      },
    },
    {
      id: "a15a-plan-title",
      sourceType: "document",
      title: "Architectural drawing, Sheet A-1.5A",
      excerpt: "WEATHER PROTECTED CANOPY HAZARDOUS MATERIAL PLAN.",
      score: 20,
      documentCitation: { sheetNumber: "A-1.5A" },
      documentRegion: {
        id: "visual-a15a",
        reconstructionMethod: "exact_source_bound_dual_render_consensus",
        evidenceSources: ["primary", "corroboration"],
      },
    },
    {
      id: "a15a-containment-area",
      sourceType: "document",
      title: "Architectural drawing, Sheet A-1.5A",
      excerpt:
        "HAZARDOUS MATERIAL CONTAINMENT AREA 2: corrosive/toxic storage.",
      score: 20,
      documentCitation: { sheetNumber: "A-1.5A" },
      documentRegion: {
        id: "visual-a15a-containment",
        reconstructionMethod: "exact_source_bound_dual_render_consensus",
        evidenceSources: ["primary", "corroboration"],
      },
    },
  ];
  const forward = buildECOSCrossSheetCanopyPlanSetFallback(question, sources);
  const reverse = buildECOSCrossSheetCanopyPlanSetFallback(
    question,
    [...sources].reverse(),
  );
  assertEquals(forward, reverse);
  assertEquals(forward?.sourceIds, [
    "a15-plan-title",
    "a15a-plan-title",
    "a15a-containment-area",
  ]);
  assert(forward?.statement.match(/Sheet A-1\.5\b/i));
  assert(forward?.statement.match(/Sheet A-1\.5A\b/i));
  assert(forward?.statement.match(/containment area/i));

  assertEquals(
    buildECOSCrossSheetCanopyPlanSetFallback(question, [
      ...sources,
      {
        ...sources[1],
        id: "conflicting-canopy-plan",
        documentCitation: { sheetNumber: "A-9.9" },
      },
    ]),
    null,
  );
  assertEquals(
    buildECOSCrossSheetCanopyPlanSetFallback(question, [
      sources[0],
      { ...sources[1], documentRegion: undefined },
      sources[2],
      sources[3],
    ]),
    null,
  );
});

Deno.test("compound facts may answer separate bounded question clauses", () => {
  const question =
    "For the hazardous-material canopy, what plan area is shown and what slab thickness does structural require?";
  assert(
    ecosFactAnswersQuestionOrRetrievalVariant({
      question,
      statement: "New Canopy 1 is 6,496 square feet.",
      sourceExcerpts: [
        "Architectural hazardous material canopy plan. New Canopy 1 area: 6,496 square feet.",
      ],
    }),
  );
  assert(
    ecosFactAnswersQuestionOrRetrievalVariant({
      question,
      statement:
        "The structural drawing requires a 6-inch-thick reinforced concrete slab.",
      sourceExcerpts: [
        "Structural hazardous material canopy detail. 6-inch-thick reinforced concrete slab.",
      ],
    }),
  );
});

Deno.test("compound canopy fallback requires exact architectural area and structural slab proof", () => {
  const fallback = buildECOSCrossDisciplineCanopyFallback(
    "For the hazardous-material canopy, what plan area is shown and what slab thickness does the structural drawing require?",
    [
      {
        id: "architectural-a15a",
        sourceType: "document",
        title: "Architectural drawing, Sheet A-1.5A",
        excerpt:
          "HAZARDOUS MATERIAL CONTAINMENT AREA. NEW CANOPY 1 area: 6,496 square feet.",
      },
      {
        id: "structural-sb11",
        sourceType: "document",
        title: "Structural drawing, Sheet SB-1.1",
        excerpt: "6-inch-thick reinforced concrete slab",
      },
    ],
  );
  assert(fallback);
  assert(fallback.statement.match(/6,496 square feet/i));
  assert(fallback.statement.match(/6-inch-thick reinforced concrete slab/i));
  assertEquals(fallback.sourceIds, [
    "architectural-a15a",
    "structural-sb11",
  ]);
});

Deno.test("compound canopy fallback derives other canopy values and fails closed on conflicts", () => {
  const question =
    "For Canopy B, what is its plan area and what slab thickness does structural require?";
  const architectural = {
    id: "architectural-canopy-b",
    sourceType: "document",
    title: "Architectural drawing, Sheet A-4.2",
    excerpt: "NEW CANOPY B area: 1,275 square feet.",
  };
  const structural = {
    id: "structural-canopy-b",
    sourceType: "document",
    title: "Structural drawing, Sheet S-4.2",
    excerpt: "8-inch-thick reinforced concrete slab",
  };
  const fallback = buildECOSCrossDisciplineCanopyFallback(question, [
    architectural,
    structural,
  ]);
  assert(fallback);
  assert(fallback.statement.match(/Canopy B at 1,275 square feet/i));
  assert(fallback.statement.match(/8-inch-thick/i));

  assertEquals(
    buildECOSCrossDisciplineCanopyFallback(question, [
      architectural,
      structural,
      {
        ...structural,
        id: "structural-conflict",
        excerpt: "10-inch-thick reinforced concrete slab",
      },
    ]),
    null,
  );

  const selectedFromMultiple = buildECOSCrossDisciplineCanopyFallback(
    question,
    [
      {
        ...architectural,
        excerpt:
          "NEW CANOPY A area: 900 square feet. NEW CANOPY B area: 1,275 square feet.",
      },
      structural,
    ],
  );
  assert(selectedFromMultiple);
  assert(
    selectedFromMultiple.statement.match(/Canopy B at 1,275 square feet/i),
  );
  assert(!selectedFromMultiple.statement.match(/900 square feet/i));
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
        documentCitation: { sheetNumber: "C6" },
        documentRegion: { id: "visual-c6" },
      },
      {
        id: "electrical-e11",
        sourceType: "document",
        title: "Electrical drawing, Sheet E-1.1",
        excerpt: "EXTERIOR STORAGE LIGHTING FIXTURES SHOWN",
        documentCitation: { sheetNumber: "E-1.1" },
        documentRegion: { id: "visual-e11" },
      },
    ],
  );
  assert(fallback);
  assertEquals(fallback.sourceIds, ["civil-c6", "electrical-e11"]);
  assert(fallback.statement.match(/^Yes\./i));
  assert(fallback.statement.match(/civil and electrical sources together/i));
});

Deno.test("cross-discipline lighting fallback rejects unbounded page text", () => {
  const fallback = buildECOSCrossDisciplineLightingFallback(
    "Which plans should the field use to confirm north-lot area lighting?",
    [
      {
        id: "civil-c6",
        sourceType: "document",
        title: "Civil drawing, Sheet C6",
        excerpt: "AREA LIGHTING — SEE ARCHITECTURAL AND ELECTRICAL DRAWINGS",
        documentCitation: { sheetNumber: "C6" },
        documentRegion: { id: "visual-c6" },
      },
      {
        id: "electrical-page-text",
        sourceType: "document",
        title: "Electrical drawing, Sheet E-1.1",
        excerpt: "EXTERIOR STORAGE LIGHTING FIXTURES SHOWN",
        documentCitation: { sheetNumber: "E-1.1" },
      },
    ],
  );
  assertEquals(fallback, null);
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
        documentCitation: { sheetNumber: "C6" },
        documentRegion: { id: "visual-c6" },
      },
      {
        id: "electrical-e22",
        sourceType: "document",
        title: "Electrical drawing, Sheet E-2.2",
        excerpt: "EXISTING LIGHTING IN THIS AREA TO REMAIN.",
        documentCitation: { sheetNumber: "E-2.2" },
        documentRegion: { id: "visual-e22" },
      },
      {
        id: "electrical-e12",
        sourceType: "document",
        title: "Electrical drawing, Sheet E-1.2",
        excerpt: "OUTDOOR LIGHTING CONTROLS",
        documentCitation: { sheetNumber: "E-1.2" },
        documentRegion: { id: "visual-e12" },
      },
    ],
  );
  assert(fallback);
  assertEquals(fallback.sourceIds, ["civil-c6", "electrical-e12"]);
  assert(fallback.statement.match(/Civil Sheet C6/i));
  assert(fallback.statement.match(/Electrical Sheet E-1\.2/i));
});

Deno.test("cross-discipline lighting fallback is stable across source order", () => {
  const question =
    "Which current drawings should the field team use for the north-lot lighting work?";
  const sources = [
    {
      id: "civil-page-text",
      sourceType: "document",
      title: "Civil drawing, Sheet C6",
      excerpt: "AREA LIGHTING - SEE ARCHITECTURAL AND ELECTRICAL DRAWINGS",
      score: 90,
      documentCitation: { sheetNumber: "C6" },
    },
    {
      id: "civil-bounded",
      sourceType: "document",
      title: "Civil drawing, Sheet C6",
      excerpt: "AREA LIGHTING - SEE ARCHITECTURAL AND ELECTRICAL DRAWINGS",
      score: 20,
      documentCitation: { sheetNumber: "C6" },
      documentRegion: { id: "visual-c6" },
    },
    {
      id: "electrical-bounded-b",
      sourceType: "document",
      title: "Electrical drawing, Sheet E-2.2",
      excerpt: "LIGHTING PLAN",
      score: 30,
      documentCitation: { sheetNumber: "E-2.2" },
      documentRegion: { id: "visual-b" },
    },
    {
      id: "electrical-bounded-a",
      sourceType: "document",
      title: "Electrical drawing, Sheet E-2.1",
      excerpt: "LIGHTING PLAN",
      score: 30,
      documentCitation: { sheetNumber: "E-2.1" },
      documentRegion: { id: "visual-a" },
    },
  ];
  const forward = buildECOSCrossDisciplineLightingFallback(question, sources);
  const reverse = buildECOSCrossDisciplineLightingFallback(
    question,
    [...sources].reverse(),
  );
  assertEquals(forward, reverse);
  assertEquals(forward?.sourceIds, ["civil-bounded", "electrical-bounded-a"]);
  assert(forward?.statement.match(/Civil Sheet C6/i));
  assert(forward?.statement.match(/Electrical Sheet E-2\.1/i));
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
      "Can you verify from current records that all seventy-eight trees were planted?",
      "Do we have field proof every tree shown on the landscape plan is installed?",
    ]
  ) {
    const fallback = buildECOSDrawingQuantityFallback(question, sources);
    assert(fallback);
    assert(fallback.statement.match(/78 trees provided by the plan/i));
    assert(fallback.statement.match(/does not verify or confirm/i));
    assert(fallback.statement.match(/installed in the field/i));
  }
});

Deno.test("installed quantity proof is stable across equal-score source order", () => {
  const first = {
    id: "document:landscape:1:provided-trees-a",
    sourceType: "document",
    title: "Landscape drawing, Sheet L-1",
    excerpt:
      "DRAWING PAGE CONTEXT: Sheet L-1 — 2321 LANDSCAPE PLAN. TREES PROVIDED: 78 TREES.",
  };
  const second = {
    id: "document:landscape:4:provided-trees-b",
    sourceType: "document",
    title: "Landscape drawing, Sheet L-4",
    excerpt:
      "DRAWING PAGE CONTEXT: Sheet L-4 — 2321 PLANTING PLAN. TREES PROVIDED: 78 TREES.",
  };
  const question = "Are all 78 planned trees installed at 2321?";
  const forward = buildECOSDrawingQuantityFallback(question, [first, second]);
  const reverse = buildECOSDrawingQuantityFallback(question, [second, first]);
  assert(forward);
  assert(reverse);
  assertEquals(forward, reverse);
  assertEquals(forward.sourceIds, [first.id]);
});
