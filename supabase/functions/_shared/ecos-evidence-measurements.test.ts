import { assertEquals } from "jsr:@std/assert@1";
import { ecosClaimMeasurementUnitsSupported as supported } from "./ecos-evidence-measurements.ts";

Deno.test("measurement proof preserves quantity and unit as a pair", () => {
  const evidence = [
    "Area is 6,344 square feet; concrete thickness is 6.0 inches",
  ];
  assertEquals(supported("Area is 6 square feet", evidence), false);
  assertEquals(supported("Concrete is 6 feet thick", evidence), false);
  assertEquals(supported("Area is 6344 SF", evidence), true);
  assertEquals(supported("Concrete is 6″ thick", evidence), true);
  assertEquals(supported("Area is 6344 square meters", evidence), false);
});

Deno.test("measurement aliases do not split compound units or borrow adjacent values", () => {
  assertEquals(supported("10 feet", ["10 square feet"]), false);
  assertEquals(supported("10 cubic yards", ["10 cubic feet"]), false);
  assertEquals(supported("10 ft²", ["10 sq. ft."]), true);
  assertEquals(supported("10 m²", ["10 square metres"]), true);
  assertEquals(supported("10 mm", ["10 millimeters"]), true);
  assertEquals(supported("10 volts", ["10 watts; 20 volts"]), false);
  assertEquals(
    supported("6 inches", ["6 inspected items; thickness in inches"]),
    false,
  );
  assertEquals(supported("1 1/2 inches", ['1.5"']), true);
  assertEquals(supported("-1.5 inches", ["1.5 inches"]), false);
});

Deno.test("a quoted count label is not an invented linear measurement", () => {
  assertEquals(supported('The label reads "OCC. LOAD: 80".', ["OCC. LOAD: 80"]),true);
  assertEquals(supported("The label reads ‘OCC. LOAD: 80’.", ["OCC. LOAD: 80"]),true);
  assertEquals(supported('The detail shows 80".', ["OCC. LOAD: 80"]),false);
  assertEquals(supported('The note says "6 inches thick".', ["6 feet thick"]),false);
  assertEquals(supported('The note says "6\" thick".', ["6 feet thick"]),false);
});

Deno.test("adjectival units retain real conflict values without unit substitution", () => {
  assertEquals(supported("6 inches and 8 inches",["6-inch curb; 8-inch curb"]),true);
  assertEquals(supported("6-inch curb",["6 feet"]),false);
  assertEquals(supported("8 inches",["6-inch curb"]),false);
  assertEquals(supported("6 feet",["6-square feet"]),false);
  assertEquals(supported("6 inches",["-6-inch offset"]),false);
});

Deno.test("relational prose after a count is not an inch abbreviation", () => {
  assertEquals(supported("Occupant load 80 in connection with the addition.",["OCC. LOAD: 80"]),true);
  assertEquals(supported("80 in. in connection with the addition.",["OCC. LOAD: 80"]),false);
  assertEquals(supported("Slab thickness 6 in",["6 feet"]),false);
  assertEquals(supported("Slab thickness 6 in thick",["6 feet"]),false);
});
