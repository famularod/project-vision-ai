/** Explicit labels are constraints, not similarity-search tokens.
 * This layer complements authenticated project/document/version authority;
 * text labels must never grant access to a record or invent its identity.
 */
export type ECOSEntityIdentity = Readonly<{ kind: string; id: string }>;

const KIND: Readonly<Record<string, string>> = Object.freeze({
  canopy: "canopy",
  canopies: "canopy",
  building: "building",
  bldg: "building",
  room: "room",
  rm: "room",
  area: "area",
  zone: "zone",
  phase: "phase",
  unit: "unit",
  lot: "lot",
  level: "level",
  floor: "level",
  door: "door",
  rfi: "rfi",
  submittal: "submittal",
  revision: "revision",
  rev: "revision",
});

export function ecosExplicitEntityIdentities(
  text: string,
): readonly ECOSEntityIdentity[] {
  const normalized = text.normalize("NFKC").replace(/\p{Cf}/gu, "")
    .replace(/[‘’“”]/g, "'").replace(/[‐‑‒–—―−]/g, "-");
  const identities = new Map<string, ECOSEntityIdentity>();
  const pattern =
    /\b(canop(?:y|ies)|building|bldg\.?|room|rm\.?|area|zone|phase|unit|lot|level|floor|door|rfi|submittal|revision|rev\.?)\s+(?:(?:no\.?|#)\s*)?'?([a-z]\d{1,5}(?:-\d{1,5})?|\d{1,6}[a-z]?|[a-z])'?(?![\w-])/gi;
  for (const match of normalized.matchAll(pattern)) {
    const kind = KIND[match[1].toLowerCase().replace(/\.$/, "")];
    const id = match[2].toUpperCase();
    const before = normalized.slice(0, match.index);
    const after = normalized.slice(match.index! + match[0].length);
    // A bare project number after an already located lot is not a lot ID.
    // Explicit "north lot #2375" remains an identity constraint.
    if (
      kind === "lot" && /^\d+$/.test(id) && !/#|\bno\./i.test(match[0]) &&
      /\b(?:north|south|east|west|back|rear|front)\s+$/i.test(before)
    ) continue;
    // Numeric areas are quantities, not named areas ("area 20 SF").
    if (
      kind === "area" && /^\d+$/.test(id) &&
      /^(?:[,.]\d|\s*(?:sq\.?|square|sf|m2|m²|ft2|ft²)\b)/i.test(after)
    ) continue;
    // "Building a new shed" and "room a person uses" are not labels.
    if (
      id === "A" &&
      /^(?:\s+)(?:new|person|shed|house|structure|space|temporary)\b/i
        .test(normalized.slice(match.index! + match[0].length))
    ) continue;
    identities.set(`${kind}:${id}`, Object.freeze({ kind, id }));
    // Shared-noun lists must retain every identity. Otherwise "canopies A,
    // B and C" silently becomes a single-canopy question again.
    let remainder = after;
    for (let count = 0; count < 20; count += 1) {
      const next = remainder.match(
        /^(?:\s*,\s*(?:and\s+)?|\s+(?:and|&)\s+)'?([a-z]\d{1,5}|\d{1,6}[a-z]?|[a-z])'?(?![\w-])/i,
      );
      if (!next) break;
      const tail = remainder.slice(next[0].length);
      if (/^\s*(?:sq\.?|square|sf|feet|foot|inches|inch|mm|cm)\b/i.test(tail)) {
        break;
      }
      const nextId = next[1].toUpperCase();
      identities.set(`${kind}:${nextId}`, Object.freeze({ kind, id: nextId }));
      remainder = tail;
    }
  }
  // Equipment tags carry identity even without the word "equipment".
  // Keep the family as its own kind; EF-1 and RTU-1 are not interchangeable.
  for (
    const match of normalized.matchAll(
      /\b(EF|AHU|RTU|FCU|MAU|VAV)\s*-?\s*(\d{1,4}[a-z]?)(?![\w-])/gi,
    )
  ) {
    const kind = `equipment:${match[1].toUpperCase()}`;
    const id = match[2].toUpperCase();
    identities.set(`${kind}:${id}`, Object.freeze({ kind, id }));
  }
  return Object.freeze([...identities.values()]);
}

/** Retrieval keeps unlabeled context, but never a known conflicting identity.
 * When title and excerpt both name a requested kind they must both agree.
 * A title cannot launder a mismatched passage, nor can a passage relabel a file.
 */
export function ecosEvidenceIdentityCompatible(
  request: string,
  title: string,
  excerpt: string,
  requireExplicit = false,
): boolean {
  const requested = ecosExplicitEntityIdentities(request);
  for (const kind of new Set(requested.map((entity) => entity.kind))) {
    const ids = requested.filter((entity) => entity.kind === kind).map((
      entity,
    ) => entity.id);
    const groups = [title, excerpt].map((value) =>
      ecosExplicitEntityIdentities(value).filter((entity) =>
        entity.kind === kind
      )
    );
    if (
      groups.some((group) =>
        group.length > 0 && !group.some((entity) => ids.includes(entity.id))
      )
    ) {
      return false;
    }
    if (
      requireExplicit &&
      !groups.some((group) => group.some((entity) => ids.includes(entity.id)))
    ) {
      return false;
    }
  }
  return true;
}

/** A statement cannot introduce an entity absent from its supporting passage. */
export function ecosStatementIdentitySupported(
  statement: string,
  evidence: string,
): boolean {
  const available = ecosExplicitEntityIdentities(evidence);
  return ecosExplicitEntityIdentities(statement).every((entity) =>
    available.some((source) =>
      source.kind === entity.kind && source.id === entity.id
    )
  );
}
