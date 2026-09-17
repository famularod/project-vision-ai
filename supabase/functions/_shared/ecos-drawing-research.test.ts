import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildECOSDrawingResearchPassages, buildECOSDrawingEvidencePassages } from "./ecos-drawing-evidence.ts";
import { ecosExpandedQuestionTokens, ecosQuestionRequestsDrawingDescription } from "./ecos-question-language.ts";

const question = "What is the planned occupant load of the new employee breakroom, and what cabinetry, appliances, and accessible features are shown?";
const region = { id: "original-cabinet-region", text: "CABINET", x: 0.1, y: 0.1, width: 0.1, height: 0.01, confidence: 0.95, source: "ocr", searchable: true };
const input = { question, pageIdentity: "Sheet A-2.10", regions: [region] };

Deno.test("research retrieves a supported facet without pretending it answers the whole question", () => {
  assertEquals(buildECOSDrawingEvidencePassages({ ...input, pageText: "" }), []);
  const result = buildECOSDrawingResearchPassages(input);
  assertEquals(result.length, 1);
  assertEquals(result[0].regionId, region.id);
  assertEquals(result[0].x, region.x);
  assertEquals(result[0].text, "Sheet A-2.10\nCABINET");
  assertEquals(result[0].contextRegionIds, [region.id]);
  assert(!/200|206|occupant load/i.test(result[0].text));
});

Deno.test("research never resurrects quarantined text or unlocatable evidence", () => {
  for (const invalid of [{ searchable: false }, { id: "" }, { x: null }, { width: 0 }, { x: 0.99, width: 0.1 }]) {
    assertEquals(buildECOSDrawingResearchPassages({ ...input, regions: [{ ...region, ...invalid }] }), []);
  }
});

Deno.test("research cannot turn topic matches into quantity or measurement answers", () => {
  for (const question of ["How many cabinets are in the breakroom?", "How thick is the concrete?"]) {
    assertEquals(buildECOSDrawingResearchPassages({ ...input, question }), []);
  }
});

Deno.test("research rejects another named entity and unrelated drawing headings", () => {
  assertEquals(buildECOSDrawingResearchPassages({ ...input, question: "Describe the cabinetry in Canopy B", regions: [{ ...region, text: "Canopy A CABINET" }] }), []);
  assertEquals(buildECOSDrawingResearchPassages({ ...input, regions: [{ ...region, text: "SHOWN NEW FLOOR PLAN" }] }), []);
});

Deno.test("research bounds passages and never borrows distant detail text", () => {
  const result = buildECOSDrawingResearchPassages({ ...input, regions: [region, { ...region, id: "distant", text: "OCCUPANT LOAD 999", x: 0.8, y: 0.8 }] });
  assert(!result.find((item) => item.regionId === region.id)!.text.includes("999"));
  assertEquals(buildECOSDrawingResearchPassages({ ...input, regions: Array.from({ length: 30 }, (_, i) => ({ ...region, id: `region-${i}` })) }).length, 6);
});

Deno.test("ordinary drawing wording expands without inserting project facts", () => {
  const tokens = ecosExpandedQuestionTokens(question);
  for (const token of ["break room", "cabinet", "microwave"]) assert(tokens.includes(token));
  assert(tokens.length <= 20);
  assert(!tokens.includes("200"));
});

Deno.test("descriptive plan questions request exact page expansion without requiring sheet hints", () => {
  for (const value of [question, "How will Labs 201 and 202 be arranged?", "Which ramp slopes are specified?", "What changes are shown for Stair 2?"]) {
    assert(ecosQuestionRequestsDrawingDescription(value));
  }
  assert(!ecosQuestionRequestsDrawingDescription("Which tasks are overdue?"));
});

Deno.test("nearby component words cannot evict complete descriptive notes", () => {
  const anchor = {...region, text:"CABINET", width:0.02};
  const fragments = ["PLASTIC", "LAMINATE", "ALL", "PANEL", "TYP", "SHELVES"].map((text, index) =>
    ({...anchor, id:`word-${index}`, text, x:0.101 + index * 0.003, width:0.002})
  );
  const complete = {...anchor, id:"complete-note", text:"COUNTER FINISH: BLUE LAMINATE WITH SEALED EDGES", x:0.145, width:0.1};
  const result = buildECOSDrawingResearchPassages({...input, regions:[anchor, ...fragments, complete]});
  assert(result.find((item) => item.regionId === anchor.id)!.contextRegionIds.includes(complete.id));
  assert(result.every((item) => item.contextRegionIds.length <= 6));
});

Deno.test("overlapping OCR component words do not consume duplicate context slots", () => {
  const anchor = {...region, text:"CABINET", width:0.02};
  const line = {...anchor, id:"whole-line", text:"PLASTIC LAMINATE PANEL", x:0.13, width:0.06};
  const word = {...anchor, id:"component", text:"LAMINATE", x:0.15, width:0.01};
  const result = buildECOSDrawingResearchPassages({...input, regions:[anchor, word, line]})[0];
  assert(result.contextRegionIds.includes(line.id));
  assert(!result.contextRegionIds.includes(word.id));
});

Deno.test("different-layer and nonoverlapping words are not treated as redundant proof", () => {
  const anchor = {...region, text:"CABINET", width:0.02};
  const line = {...anchor, id:"whole-line", text:"PLASTIC LAMINATE PANEL", x:0.13, width:0.06};
  for (const change of [{source:"vision"}, {x:0.195}]) {
    const word = {...anchor, id:"component", text:"LAMINATE", x:0.15, width:0.01, ...change};
    const result = buildECOSDrawingResearchPassages({...input, regions:[anchor, word, line]})[0];
    assert(result.contextRegionIds.includes(line.id));
    assert(result.contextRegionIds.includes(word.id));
  }
});

Deno.test("repeated count labels cannot evict independent appliance and access passages", () => {
  const repeated = Array.from({length:8},(_,i)=>({...region,id:`load-${i}`,text:"OCCUPANT LOAD BREAK ROOM",x:.7,y:.7}));
  const microwave = {...region,id:"appliance",text:"MICROWAVES",x:.1,y:.1};
  const interior = {...region,id:"interior",text:"WHITE MELAMINE INTERIOR AND SHELVES",x:.1,y:.115};
  const access = {...region,id:"access",text:"ACCESSIBLE CABINET",x:.4,y:.4};
  const sink = {...region,id:"sink",text:"STAINLESS STEEL SINK",x:.4,y:.415};
  const result=buildECOSDrawingResearchPassages({...input,regions:[...repeated,microwave,interior,access,sink]});
  assert(result.some(x=>x.regionId===microwave.id && x.contextRegionIds.includes(interior.id)));
  assert(result.some(x=>x.regionId===access.id && x.contextRegionIds.includes(sink.id)));
  assert(result.length<=6);
});
