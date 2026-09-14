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
