import { assert, assertEquals } from "jsr:@std/assert@1";
import { rankECOSDescriptiveResearchSources } from "./ecos-research-ranking.ts";
const source = (id: string, excerpt: string, score = 100) => ({ id, sourceType: "document", title: "Architectural drawing", excerpt, score, documentCitation: { regionId: id, pageNumber: 1 } });

Deno.test("descriptive research reserves space for separate requested details", () => {
  const generic = Array.from({ length: 12 }, (_, i) => source(`code-${i}`, "ACCESSIBLE ACCESSIBILITY ADA CLEARANCE"));
  const cabinet = source("cabinet", "BREAK ROOM CABINET MICROWAVES", 1);
  const load = source("load", "EMPLOYEE BREAK ROOM OCCUPANT LOAD", 1);
  const result = rankECOSDescriptiveResearchSources("What is the planned occupant load of the employee breakroom, and what cabinetry, appliances, and accessible features are shown?", [...generic, cabinet, load], 3);
  assert(result.includes(cabinet));
  assert(result.includes(load));
  assertEquals(result.filter((item) => item.id.startsWith("code-")).length, 1);
  assertEquals(result.find((item) => item.id === "cabinet"), cabinet);
});

Deno.test("ranking preserves quantity order and never introduces evidence", () => {
  const sources = [source("first", "Canopy A"), source("second", "Canopy A")];
  assertEquals(rankECOSDescriptiveResearchSources("How many lights are in Canopy A?", sources, 1), [sources[0]]);
  const result = rankECOSDescriptiveResearchSources("Describe canopy A cabinetry", sources, 36);
  assert(result.every((item) => sources.includes(item)));
});

Deno.test("ranking keeps exact named entity boundaries and result bounds", () => {
  const wrong = source("wrong", "Canopy B cabinet appliances cabinetry break room");
  const correct = source("correct", "Canopy A cabinet");
  assertEquals(rankECOSDescriptiveResearchSources("Describe canopy A cabinetry", [wrong, correct], 1), [correct]);
  assertEquals(rankECOSDescriptiveResearchSources("Describe cabinet appliances", Array.from({ length: 80 }, (_, i) => source(String(i), "CABINET")), 200).length, 36);
});

Deno.test("coherent exact-page details precede repeated generic code evidence", () => {
  const page = (id: string, text: string, number: number, documentId = "plan") => ({
    ...source(id, text), documentCitation: { documentId, pageNumber: number, regionId: id },
  });
  const repeats = Array.from({ length: 10 }, (_, i) => page(`parking-${i}`,
    "EMPLOYEE BREAK ROOM AREA DOES NOT INCREASE OCCUPANT LOAD", 2));
  const count = page("count", "NEW BREAK ROOM OCC. LOAD: 80", 17);
  const cabinet = page("cabinet", "CABINET MICROWAVES PLASTIC LAMINATE", 17);
  const access = page("access", "ACCESSIBLE CABINET MINIMUM CLEARANCE", 17);
  const generic = [page("code", "OCCUPANT REACH RANGES ACCESSIBLE CLEARANCE", 3),
    page("ev", "EV CHARGING CABINET ACCESSIBLE LOAD", 5)];
  const q = "What is the planned occupant load of the employee breakroom, and what cabinetry, appliances, and accessible features are shown?";
  const result = rankECOSDescriptiveResearchSources(q, [...repeats,...generic,count,cabinet,access], 5);
  assert(result.slice(0,3).includes(count));
  assert(result.slice(0,3).includes(cabinet));
  assert(result.slice(0,3).includes(access));
  assertEquals(result.filter(x => x.id.startsWith("parking-")).length,1);
});

Deno.test("page coverage never borrows from another document with the same page number", () => {
  const a = { ...source("a", "CABINET"), documentCitation: { documentId: "a", pageNumber: 1, regionId: "a" } };
  const b = { ...source("b", "MICROWAVE"), documentCitation: { documentId: "b", pageNumber: 1, regionId: "b" } };
  const full = { ...source("full", "CABINET MICROWAVE"), documentCitation: { documentId: "c", pageNumber: 2, regionId: "full" } };
  assertEquals(rankECOSDescriptiveResearchSources("What cabinetry and appliances are shown?", [a,b,full],1),[full]);
});

Deno.test("shared page headings do not make distinct notes or conflicting values duplicates", () => {
  const heading="Very long architectural drawing project address sheet document identity repeated for every note";
  const notes=["CABINET MICROWAVE CUBBY PLASTIC LAMINATE", "MICROWAVE WHITE MELAMINE INTERIOR SHELVES", "OCCUPANT LOAD 80", "OCCUPANT LOAD 90"].map((text,i)=>({
    ...source(String(i),heading+" "+text),title:heading,
    documentCitation:{documentId:"plan",pageNumber:1,regionId:String(i)},
  }));
  const result=rankECOSDescriptiveResearchSources("What occupant load, cabinetry and appliances are shown?",notes,4);
  assertEquals(new Set(result.map(x=>x.id)),new Set(notes.map(x=>x.id)));
  assert(result.every(x=>notes.includes(x)));
});
