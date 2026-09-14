/** A numeric value must carry its own unit in the cited evidence.
 * This is a rejection guard, not complete claim entailment. It does not infer
 * geometry, perform unrecorded conversions, or prove a value's physical role.
 */
export function ecosClaimMeasurementUnitsSupported(
  statement: string,
  excerpts: readonly string[],
): boolean {
  const available = new Set(excerpts.flatMap(measurementKeys));
  return measurementKeys(statement).every((key) => available.has(key));
}

function measurementKeys(value: string): string[] {
  const text = value.replace(/[“”″]/g, '"').replace(/[‘’′]/g, "'")
    .normalize("NFKC").toLowerCase()
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "");
  // Keep compound units before their linear counterparts. Word boundaries
  // prevent "in" inside "inspected" from becoming an inch measurement.
  const pattern =
    /(?<![\w.])([+-]?\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?)\s*(square\s+(?:feet|foot|meters?|metres?)|sq\.?\s*(?:ft\.?|m)|sqft|sf|ft2|m2|cubic\s+(?:feet|foot|yards?|meters?|metres?)|cu\.?\s*(?:ft\.?|yd\.?|m)|ft3|yd3|m3|inches|inch|in\.?|feet|foot|ft\.?|millimeters?|millimetres?|mm|centimeters?|centimetres?|cm|meters?|metres?|m|psi|psf|kpa|mpa|gpm|cfm|volts?|watts?|kw|amps?|lb|lbs|kg)(?!\w)|(?<![\w.])([+-]?\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+|\s*\/\s*\d+)?)\s*(["'])/g;
  return [...text.matchAll(pattern)].map((match) => {
    const raw = (match[1] || match[3]).trim();
    const mixed = raw.match(/^([+-]?\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    const fraction = raw.match(/^([+-]?\d+)\s*\/\s*(\d+)$/);
    const number = mixed
      ? Number(mixed[1]) +
        (raw.startsWith("-") ? -1 : 1) * Number(mixed[2]) / Number(mixed[3])
      : fraction
      ? Number(fraction[1]) / Number(fraction[2])
      : Number(raw);
    const unit = canonicalUnit(match[2] || match[4]);
    return `${Number.isFinite(number) ? number : raw}:${unit}`;
  });
}

function canonicalUnit(value: string): string {
  const unit = value.replace(/[.\s]/g, "");
  if (/^(?:squaref(?:eet|oot)|sqft|sf|ft2)$/.test(unit)) return "ft2";
  if (/^(?:squarem(?:eters?|etres?)|sqm|m2)$/.test(unit)) return "m2";
  if (/^(?:cubicf(?:eet|oot)|cuft|ft3)$/.test(unit)) return "ft3";
  if (/^(?:cubicyards?|cuyd|yd3)$/.test(unit)) return "yd3";
  if (/^(?:cubicm(?:eters?|etres?)|cum|m3)$/.test(unit)) return "m3";
  if (/^(?:inches|inch|in|")$/.test(unit)) return "in";
  if (/^(?:feet|foot|ft|')$/.test(unit)) return "ft";
  if (/^(?:millimeters?|millimetres?|mm)$/.test(unit)) return "mm";
  if (/^(?:centimeters?|centimetres?|cm)$/.test(unit)) return "cm";
  if (/^(?:meters?|metres?|m)$/.test(unit)) return "m";
  return unit.replace(/^(volt|watt|amp|lb)s$/, "$1");
}
