import {
  analyzeECOSProjectQuestion,
  buildECOSDrawingAreaFallback,
  buildECOSDrawingMeasurementFallback,
  buildECOSInstalledDesignFallback,
  analyzeECOSQuestionEvidenceContext,
  containsECOSMeasurementValue,
  containsECOSRequestedMeasurementValue,
  ecosAnswerRequirementInstruction,
  ecosEvidenceQuestionContextScore,
  ecosEvidenceMatchesQuestionRequirement,
  ecosFactAnswersQuestion,
  ecosMissingAnswerLimitation,
  ecosQuestionRequestsInstalledCondition,
  sanitizeECOSAnswerStatement,
} from '../../supabase/functions/_shared/ecos-project-answer-policy';

describe('ECOS project answer assurance policy', () => {
  const question = 'How thick is the new concrete on the north side of 2375?';

  it('recognizes a thickness question as a measurement request', () => {
    expect(analyzeECOSProjectQuestion(question)).toMatchObject({
      kind: 'measurement',
      attribute: 'thickness',
    });
    expect(ecosAnswerRequirementInstruction(question)).toContain('exact numeric measurement');
    expect(ecosMissingAnswerLimitation(question)).toContain('numeric thickness value');
  });

  it('rejects the unrelated completed cement task as an answer', () => {
    expect(ecosFactAnswersQuestion({
      question,
      statement: 'A completed task at 2375 North Side required making a water shutoff cover flush with cement; it does not provide a concrete thickness.',
      sourceExcerpts: [
        'Task: Make water shutoff cover flush with cement. Location: 2375 North Side. Status: Complete. Percent complete: 100.',
      ],
    })).toBe(false);
    expect(ecosEvidenceMatchesQuestionRequirement(
      question,
      'Task: Make water shutoff cover flush with cement. Location: 2375 North Side. Status: Complete. Percent complete: 100.',
    )).toBe(false);
  });

  it('accepts a cited numeric thickness with a construction unit', () => {
    expect(ecosFactAnswersQuestion({
      question,
      statement: 'The new concrete slab at the 2375 north side is 6 inches thick.',
      sourceExcerpts: [
        '2375 NORTH SIDE NEW CONCRETE. SLAB THICKNESS (T) = 6 INCHES. SEE DETAIL 4/C5.2.',
      ],
    })).toBe(true);
  });

  it('requires the cited evidence itself to identify the requested subject and location', () => {
    expect(ecosFactAnswersQuestion({
      question,
      statement: 'The new concrete at the 2375 north side is 4 inches thick.',
      sourceExcerpts: [
        'CONSTRUCT 4" THICK PCC WALKWAY - SEE ARCHITECTURAL.',
      ],
    })).toBe(false);
    expect(analyzeECOSQuestionEvidenceContext(
      question,
      '2375 NORTH LOT PLAN. CONSTRUCT 6" THICK PCC PAVING.',
    )).toMatchObject({
      subjectMatched: true,
      locationMatched: true,
      measurementMatched: true,
      attributeMatched: true,
    });
  });

  it('prioritizes a north-lot measurement page over an isolated walkway note', () => {
    const northLotPage = [
      '2375 THIRD STREET',
      'NORTH LOT PLAN',
      'CONSTRUCTION NOTES',
      'CONSTRUCT 6.0" THICK PCC PAVING',
    ].join('\n');
    const isolatedWalkway = 'CONSTRUCT 4" THICK PCC WALKWAY - SEE ARCHITECTURAL';

    expect(ecosEvidenceQuestionContextScore(question, northLotPage))
      .toBeGreaterThan(ecosEvidenceQuestionContextScore(question, isolatedWalkway));
    expect(ecosFactAnswersQuestion({
      question,
      statement: 'The north-side PCC paving is 6 inches thick.',
      sourceExcerpts: [northLotPage],
    })).toBe(true);
  });

  it('recognizes common drawing measurement formats but not percentages or dates', () => {
    expect(containsECOSMeasurementValue('SLAB THICKNESS T = 6"')).toBe(true);
    expect(containsECOSMeasurementValue("DEPTH = 1'-6\"")).toBe(true);
    expect(containsECOSMeasurementValue('THICKNESS 150 mm')).toBe(true);
    expect(containsECOSMeasurementValue('6.0-inch-thick PCC paving')).toBe(true);
    expect(containsECOSMeasurementValue('Percent complete: 100%')).toBe(false);
    expect(containsECOSMeasurementValue('Finish: 08/10/2026')).toBe(false);
  });

  it('treats an explicitly requested maximum grade as a percentage measurement', () => {
    const gradeQuestion = 'What is the maximum permitted grade in the delineated ADA-accessible parking areas?';
    expect(analyzeECOSProjectQuestion(gradeQuestion)).toMatchObject({
      kind: 'measurement',
      attribute: 'grade',
    });
    expect(containsECOSRequestedMeasurementValue(
      gradeQuestion,
      'ADA accessible parking max slope shall be 2.00% in all directions.',
    )).toBe(true);
    expect(ecosFactAnswersQuestion({
      question: gradeQuestion,
      statement: 'The maximum permitted grade is 2.00% in all directions.',
      sourceExcerpts: ['IN DELINEATED ADA ACCESSIBLE PARKING AREAS, GRADES SHALL BE 2.00% MAX. IN ALL DIRECTIONS.'],
    })).toBe(true);
  });

  it('keeps the relevance gate permissive for ordinary non-design questions', () => {
    expect(ecosFactAnswersQuestion({
      question: 'What is the ramp task status?',
      statement: 'The ramp task is Waiting.',
      sourceExcerpts: ['Task: Ramp. Status: Waiting.'],
    })).toBe(true);
  });

  it('classifies a canopy-lighting yes/no question as presence evidence', () => {
    const presenceQuestion = 'Do the canopies at 2375 have lighting?';
    expect(analyzeECOSProjectQuestion(presenceQuestion)).toMatchObject({
      kind: 'presence',
      attribute: 'lighting',
    });
    expect(ecosAnswerRequirementInstruction(presenceQuestion)).toContain('direct yes or no answer');
  });

  it('classifies scheduled canopy lights as lighting presence instead of the word be', () => {
    const presenceQuestion = 'Are lights scheduled to be installed in the canopies at 2375?';
    const drawingEvidence = [
      'Sheet E-1.1 — EXTERIOR STORAGE AREAS 1, 2, 3 LIGHTING PLAN.',
      "ECOS VISUAL DRAWING FACT. Subject: Lighting fixture symbol. Location: within STORAGE 1 area. Fact: Square symbols with '24 F' are shown as lighting fixtures in a grid.",
      "ECOS VISUAL DRAWING FACT. Subject: Exterior storage area. Location: Plan left. Fact: Labeled as '2375 W.P. EXT. STORAGE 1'.",
    ].join(' ');

    expect(analyzeECOSProjectQuestion(presenceQuestion)).toMatchObject({
      kind: 'presence',
      attribute: 'lighting',
    });
    expect(ecosEvidenceMatchesQuestionRequirement(presenceQuestion, drawingEvidence)).toBe(true);
    expect(ecosFactAnswersQuestion({
      question: presenceQuestion,
      statement: 'The current electrical drawing shows lighting fixtures in the exterior storage areas corresponding to the canopies.',
      sourceExcerpts: [drawingEvidence],
    })).toBe(true);
  });

  it('rejects an ambiguous field update as canopy-lighting proof', () => {
    const presenceQuestion = 'Do the canopies at 2375 have lighting?';
    const fieldUpdate = 'Field updates for Canopies A, B, and C state that a flooring change indicated either a lighting difference or a material difference at the entrance.';
    expect(ecosEvidenceMatchesQuestionRequirement(presenceQuestion, fieldUpdate)).toBe(false);
    expect(ecosFactAnswersQuestion({
      question: presenceQuestion,
      statement: fieldUpdate,
      sourceExcerpts: [fieldUpdate],
    })).toBe(false);
  });

  it('accepts explicit drawing evidence that shows canopy lighting', () => {
    const presenceQuestion = 'Do the canopies at 2375 have lighting?';
    const drawingEvidence = 'CANOPIES A, B, AND C. ELECTRICAL LIGHTING PLAN. LIGHT FIXTURES TYPE 24 ARE SHOWN WITHIN EACH CANOPY.';
    expect(ecosEvidenceMatchesQuestionRequirement(presenceQuestion, drawingEvidence)).toBe(true);
    expect(ecosFactAnswersQuestion({
      question: presenceQuestion,
      statement: 'Yes. The current electrical drawing shows light fixtures in Canopies A, B, and C.',
      sourceExcerpts: [drawingEvidence],
    })).toBe(true);
  });

  it('matches plural canopy questions to singular drawing labels', () => {
    const presenceQuestion = 'Do the canopies at 2375 have lighting?';
    expect(ecosFactAnswersQuestion({
      question: presenceQuestion,
      statement: 'The current drawing shows lighting at Canopy A.',
      sourceExcerpts: ['CANOPY A LIGHTING PLAN. LIGHT FIXTURES ARE SHOWN.'],
    })).toBe(true);
  });

  it('removes internal evidence ids from user-facing answer statements', () => {
    expect(sanitizeECOSAnswerStatement(
      'The canopy has lighting. [update:mrcu2abk-63b55h5l] [document:drawing-1:4:region-2]',
    )).toBe('The canopy has lighting.');
  });

  it('treats square footage as a measurement and rejects a non-answer', () => {
    const areaQuestion = 'How many square feet is Canopy A?';
    expect(analyzeECOSProjectQuestion(areaQuestion)).toMatchObject({
      kind: 'measurement',
      attribute: 'area',
    });
    expect(ecosFactAnswersQuestion({
      question: areaQuestion,
      statement: 'The drawing identifies Canopy A but does not state its area.',
      sourceExcerpts: ["CANOPY 'A' ANCHOR ROD PLAN"],
    })).toBe(false);
    expect(ecosFactAnswersQuestion({
      question: areaQuestion,
      statement: 'Canopy A has a calculated plan footprint of 6,344 square feet.',
      sourceExcerpts: [
        "CANOPY 'A' ANCHOR ROD PLAN. ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 122'-0\" × 52'-0\" = 6,344 square feet.",
      ],
    })).toBe(true);
  });

  it('builds a deterministic calculated-area answer from verified overall dimensions', () => {
    expect(buildECOSDrawingAreaFallback('How many square feet is Canopy A?', [{
      id: 'document:canopy-a-ab60',
      sourceType: 'document',
      title: "2375 CANOPY 'A', Sheet AB60, Rev 1",
      excerpt: [
        "CANOPY 'A' ANCHOR ROD PLAN.",
        'ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 122\'-0" × 52\'-0" = 6,344 square feet.',
      ].join(' '),
    }])).toEqual({
      statement: "Using the 122'-0\" by 52'-0\" overall dimensions on the current drawing, Canopy A has a calculated plan footprint of 6,344 square feet; this is a calculation, not a printed area value.",
      sourceIds: ['document:canopy-a-ab60'],
    });
  });

  it('does not misclassify a named building area as a square-footage request', () => {
    expect(analyzeECOSProjectQuestion(
      'What does current electrical Sheet E-2.1 show for Building Area 1 at 2375?',
    )).toMatchObject({
      kind: 'general',
      attribute: null,
    });
  });

  it('recognizes an installed-condition question while accepting its drawing design answer', () => {
    const installedQuestion = 'How thick is the new concrete that was poured in the back of 2375 on the north side?';
    expect(ecosQuestionRequestsInstalledCondition(installedQuestion)).toBe(true);
    expect(ecosFactAnswersQuestion({
      question: installedQuestion,
      statement: 'The current drawing specifies 6 inches of PCC paving at the north lot.',
      sourceExcerpts: [
        '2375 NORTH LOT PLAN. CONSTRUCTION NOTE 1: CONSTRUCT 6.0" THICK PCC PAVING.',
      ],
    })).toBe(true);
    expect(buildECOSInstalledDesignFallback(installedQuestion, [{
      id: 'document:c6',
      sourceType: 'document',
      excerpt: [
        '2375 NORTH LOT PLAN.',
        'ECOS VISUAL DRAWING FACT. Subject: PCC paving. Location: North Lot.',
        'Fact: The plan specifies construction of 6.0-inch-thick PCC paving.',
        'Visible evidence: CONSTRUCT 6.0\" THICK PCC PAVING',
      ].join(' '),
    }])).toEqual({
      statement: 'The current drawing specifies construction of 6.0-inch-thick PCC paving. The drawing does not field-verify the actual installed condition.',
      sourceIds: ['document:c6'],
    });

    expect(buildECOSInstalledDesignFallback(installedQuestion, [{
      id: 'document:c1',
      sourceType: 'document',
      excerpt: [
        '2375 NORTH LOT PLAN.',
        'ECOS VISUAL DRAWING FACT. Subject: PCC paving. Location: Construction Notes.',
        'Fact: The plan specifies construction of 6.0-inch-thick PCC paving.',
        'Visible evidence: CONSTRUCT 6.0" THICK PCC PAVING',
      ].join(' '),
    }, {
      id: 'document:c6',
      sourceType: 'document',
      excerpt: [
        '2375 NORTH LOT PLAN.',
        'ECOS VISUAL DRAWING FACT. Subject: PCC paving. Location: Construction Notes.',
        'Fact: 6.0-inch-thick PCC paving is specified where construction-note symbol 1 is shown.',
        'Visible evidence: CONSTRUCT 6.0" THICK PCC PAVING',
      ].join(' '),
    }])).toEqual({
      statement: 'The current drawing specifies construction of 6.0-inch-thick PCC paving. The drawing does not field-verify the actual installed condition.',
      sourceIds: ['document:c1'],
    });
  });

  it('answers a direct sheet measurement when the sheet identity is in the citation title', () => {
    const question = 'What thickness does C6 specify for north lot PCC paving?';
    const source = {
      id: 'document:c6',
      sourceType: 'document',
      title: '2375 CIVIL, Sheet C6, Rev 1',
      excerpt: [
        'ECOS VISUAL DRAWING FACT. Subject: PCC paving. Location: Construction notes, upper-right.',
        'Fact: 6.0-inch-thick PCC paving is specified where construction-note symbol 1 is shown.',
        'Visible evidence: CONSTRUCT 6.0" THICK PCC PAVING',
      ].join(' '),
    };
    expect(ecosFactAnswersQuestion({
      question,
      statement: 'The current drawing specifies 6.0-inch-thick PCC paving.',
      sourceExcerpts: [`${source.title} ${source.excerpt}`],
    })).toBe(true);
    expect(analyzeECOSQuestionEvidenceContext(
      question,
      `${source.title} 6.0-inch-thick PCC paving is specified where construction-note symbol 1 is shown.`,
    )).toMatchObject({
      subjectTokens: ['c6', 'pcc', 'paving'],
      matchedSubjectTokens: ['c6', 'pcc', 'paving'],
    });
    expect(buildECOSDrawingMeasurementFallback(question, [source])).toEqual({
      statement: 'The current drawing specifies 6.0-inch-thick PCC paving where construction-note symbol 1 is shown.',
      sourceIds: ['document:c6'],
    });

    expect(buildECOSDrawingMeasurementFallback(
      'How many inches thick is the PCC paving at the 2375 north lot?',
      [{
        ...source,
        excerpt: `NORTH LOT PLAN. ${source.excerpt} ECOS VISUAL DRAWING FACT. Subject: PCC walkway. Location: Construction notes, upper-right. Fact: A 4-inch-thick PCC walkway is specified. Visible evidence: CONSTRUCT 4" THICK PCC WALKWAY`,
      }],
    )).toEqual({
      statement: 'The current drawing specifies 6.0-inch-thick PCC paving where construction-note symbol 1 is shown.',
      sourceIds: ['document:c6'],
    });
  });

  it('treats how-many-inches concrete slab wording as thickness and resolves north-lot PCC paving', () => {
    const fieldQuestion = 'About how many inches is the new concrete slab on the north side of 2375?';
    const source = {
      id: 'document:c6:pcc-paving',
      sourceType: 'document',
      title: '02A - 2375 CIVIL, Sheet C6, Rev 1',
      excerpt: [
        'DRAWING PAGE CONTEXT: Sheet C6 — PRECISE GRADING PLAN NORTH LOT PLAN.',
        'ECOS VISUAL DRAWING FACT. Subject: PCC paving thickness. Location: Construction Note 1.',
        'Fact: CONSTRUCT 6.0" THICK PCC PAVING.',
        'Visible evidence: CONSTRUCT 6.0" THICK PCC PAVING',
      ].join(' '),
    };

    expect(analyzeECOSProjectQuestion(fieldQuestion)).toMatchObject({
      kind: 'measurement',
      attribute: 'thickness',
    });
    expect(buildECOSDrawingMeasurementFallback(fieldQuestion, [source])).toEqual({
      statement: 'The current drawing specifies 6.0" THICK PCC PAVING.',
      sourceIds: ['document:c6:pcc-paving'],
    });
    expect(ecosFactAnswersQuestion({
      question: fieldQuestion,
      statement: 'Sheet C6 specifies 6.0-inch-thick PCC paving.',
      sourceExcerpts: [source.excerpt],
    })).toBe(true);
    expect(ecosFactAnswersQuestion({
      question: fieldQuestion,
      statement: 'The same plan separately specifies 4.0-inch-thick PCC walkways.',
      sourceExcerpts: [
        'Sheet C6 — NORTH LOT PLAN. Fact: 4.0-inch-thick PCC walkways. Visible evidence: CONSTRUCT 4.0" THICK PCC WALKWAYS',
      ],
    })).toBe(false);
  });

  it('compares walkway and paving thicknesses from separate bounded drawing notes', () => {
    expect(buildECOSDrawingMeasurementFallback(
      'How thick is the new PCC walkway, and is that the same as the PCC paving thickness?',
      [{
        id: 'document:c5:walkway',
        sourceType: 'document',
        title: '2375 CIVIL, Sheet C5, Rev 1',
        excerpt: 'CONSTRUCT 4" THICK PCC WALKWAY — SEE ARCHITECTURAL',
      }, {
        id: 'document:c5:paving',
        sourceType: 'document',
        title: '2375 CIVIL, Sheet C5, Rev 1',
        excerpt: 'CONSTRUCT 6.0" THICK PCC PAVING',
      }],
    )).toEqual({
      statement: 'The current drawing specifies 4" THICK PCC WALKWAY, and separately 6.0" THICK PCC PAVING. These are different specifications, not the same thickness.',
      sourceIds: ['document:c5:walkway', 'document:c5:paving'],
    });
  });
});
