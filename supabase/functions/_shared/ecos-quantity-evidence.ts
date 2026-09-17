/**
 * Conservative count evidence, not a drawing-symbol counter. Topic overlap and
 * arbitrary numbers are retrieval hints, never proof of a requested quantity.
 * Unrecognized wording stays unverified rather than inventing an item count.
 */
const QUALIFIERS =
  "planned|required|provided|scheduled|shown|installed|existing|proposed|total";
const COUNT =
  "(?<![\\w.,/+\\-])(\\d{1,3}(?:,\\d{3})+|\\d+)(?![\\w,/+\\-]|\\.\\d)";

function normalize(value: string) {
  return value.toLowerCase().replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function subjectPattern(question: string): string | null {
  const text = normalize(question);
  let phrase = text.match(/\bhow\s+many\s+(.+)/)?.[1] ||
    text.match(/\b(?:number|quantity|count)\s+of\s+(.+)/)?.[1];
  if (!phrase) {
    phrase = text.match(
      /\b(?:what\s+is\s+(?:the\s+)?|give\s+me\s+(?:the\s+)?)(.+?)\s+(?:count|quantity)\b/,
    )?.[1];
  }
  if (!phrase) return null;
  phrase = phrase.split(
    /\b(?:are|is|was|were|does|do|did|can|have|has|in|at|on|under|for|within|from|shown|installed)\b|[?;.!]/,
  )[0]
    .replace(
      /^(?:(?:of|the|all|those|these|planned|required|provided|scheduled|existing|proposed|total)\s+|\d+(?:,\d{3})*\s+)+/,
      "",
    )
    .trim();
  // A multi-item request needs separately bound claims; do not silently choose
  // the first noun or let the location noun stand in for the counted object.
  if (!phrase || /\b(?:and|or)\b|[^a-z\s-]/.test(phrase)) return null;
  const words = phrase.split(/\s+/);
  if (words.length > 5) return null;
  const last = words.pop()!;
  const singular = last.endsWith("ies")
    ? `${last.slice(0, -3)}y`
    : last.endsWith("s") && !last.endsWith("ss")
    ? last.slice(0, -1)
    : last;
  const head = singular.endsWith("y")
    ? `${escape(singular.slice(0, -1))}(?:y|ies)`
    : `${escape(singular)}s?`;
  const prefix = words.map(escape).join("\\s+");
  if (
    singular === "luminaire" ||
    singular === "fixture" && /^(?:light|lighting)$/.test(words.join(" "))
  ) {
    return "(?:light(?:ing)?\\s+fixtures?|luminaires?)";
  }
  return `${prefix ? `${prefix}\\s+` : ""}${head}`;
}

/** All explicit, unqualified integer counts of the requested item. */
export function ecosRequestedItemCounts(
  question: string,
  evidence: string,
): number[] {
  const subject = subjectPattern(question);
  if (!subject) return [];
  const patterns = [
    new RegExp(`${COUNT}\\s+(?:(?:${QUALIFIERS})\\s+)*\\b${subject}\\b`, "g"),
    new RegExp(
      `\\b${subject}\\b\\s*(?:(?:${QUALIFIERS}|quantity|qty|count|number|is|are|of)\\b\\s*|[:=\\-]\\s*)+${COUNT}`,
      "g",
    ),
  ];
  const counts = new Set<number>();
  // Never stitch a number in one sentence to an item in another. Preserve
  // decimal points so 3.12 cannot be misread as 12 individual items.
  for (const clause of normalize(evidence).split(/[;\n!?]|\.(?!\d)/)) {
    if (
      /\b(?:not|no|none|unknown|unverified|unconfirmed|approximately|approx|about|estimated|estimate|maybe|possibly|up\s+to|at\s+least|at\s+most|more\s+than|less\s+than|per|each)\b/
        .test(clause)
    ) continue;
    for (const pattern of patterns) {
      for (const match of clause.matchAll(pattern)) {
        const before = clause.slice(0, match.index).trimEnd();
        const after = clause.slice(match.index! + match[0].length);
        if (/[<>~≥≤≈]$|\b(?:to|through|between|over|under)\s*$/.test(before)) {
          continue;
        }
        // Numbers in dates, identifiers, sizes, ranges and ratings are not
        // quantities even when the item name appears next to them.
        if (
          /\b(?:type|model|revision|rev|sheet|detail|circuit|phase)\s*[:#-]?\s*$/
            .test(before)
        ) continue;
        if (
          /^\s*(?:[-/+%"']|\b(?:to|through|volt\w*|watt\w*|inch\w*|feet|foot|ft|mm|cm|meter\w*|percent)\b)/
            .test(after)
        ) continue;
        const count = Number(match[1].replaceAll(",", ""));
        if (Number.isSafeInteger(count) && count >= 0) counts.add(count);
      }
    }
  }
  return [...counts];
}

/** The same explicit item/count pair must occur in one supporting passage. */
export function ecosQuantityClaimSupported(
  question: string,
  statement: string,
  source: string,
) {
  const claims = ecosRequestedItemCounts(question, statement);
  const evidence = ecosRequestedItemCounts(question, source);
  // Multiple different values need disambiguation, not an arbitrary match.
  return claims.length === 1 && evidence.length === 1 &&
    claims[0] === evidence[0];
}
