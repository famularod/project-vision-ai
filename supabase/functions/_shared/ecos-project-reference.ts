/**
 * Ask ECOS wrong-project guard, shared by the app (services/ECOSProjectQuestion.ts)
 * and the ecos-ask-project edge function so both sides apply one rule. No imports
 * and no I/O: the edge function reads the project list and passes it in.
 *
 * Owner answer Q20 (30 Sep 2026; audit A9 pass 1 #2): the guard used to refuse
 * any 4-6 digit number that was not the selected project's own number or a year,
 * so "4000 psi", "room 1105", "section 079200", "12000 BTU" and "elevation 1250"
 * were refused as if they named another project. A number is now refused only
 * when it is another known project's identifier (the first 3-6 digit number in
 * that project's name), and not even then when a unit follows it or a drawing
 * reference word comes before it. Without a usable project list the old, stricter
 * check still applies (fail closed).
 */

export type ECOSProjectReferenceMismatch = Readonly<{
  selectedProjectIdentifier: string;
  referencedProjectIdentifier: string;
}>;

/** More rows than this and the list may be incomplete, so the stricter check applies. */
export const ECOS_KNOWN_PROJECT_NAMES_LIMIT = 1000;

const LEGACY_IDENTIFIER_SOURCE = String.raw`\b\d{4,6}\b`;
const PROJECT_IDENTIFIER_SOURCE = String.raw`\b\d{3,6}\b`;

// A measurement, not a project: "4000 psi", "12000 BTU", "1200 sq ft", "95%".
const UNIT_AFTER_NUMBER =
  /^\s*-?\s*(?:%|(?:psi|ksi|lbs?|pounds?|btuh?|cfm|sf|lf|ft|feet|foot|gal|gallons?|sq\.?\s*ft|square\s+f(?:ee|oo)t)\b)/i;

// A drawing or building reference, not a project: "room 1105", "Rm. 1105",
// "section 079200", "El. 1250", "sheet #2375".
const CONTEXT_WORD_BEFORE_NUMBER =
  /\b(?:room|rm|section|door|elevation|elev|el|grid|level|detail|sheet)\.?\s*(?:(?:no\.?|number|#)\s*)?[:#-]?\s*$/i;

export function findECOSProjectReferenceMismatch(
  projectName: string,
  question: string,
  knownProjectNames?: readonly string[] | null,
): ECOSProjectReferenceMismatch | null {
  const knownNames = usableKnownProjectNames(knownProjectNames);
  if (!knownNames) return legacyProjectReferenceMismatch(projectName, question);

  const selectedIdentifiers = uniqueMatches(projectName, PROJECT_IDENTIFIER_SOURCE);
  if (selectedIdentifiers.length === 0) return null;
  const selected = new Set(selectedIdentifiers);
  const otherProjectIdentifiers = new Set(
    knownNames
      .map(ecosProjectIdentifier)
      .filter((identifier): identifier is string => Boolean(identifier) && !selected.has(identifier as string)),
  );
  if (otherProjectIdentifiers.size === 0) return null;

  const pattern = new RegExp(PROJECT_IDENTIFIER_SOURCE, 'g');
  for (let match = pattern.exec(question); match; match = pattern.exec(question)) {
    const identifier = match[0];
    if (!otherProjectIdentifiers.has(identifier)) continue;
    // A year stays a year, as in the check before Q20 ("due in 2026").
    if (/^(?:19|20)\d\d$/.test(identifier)) continue;
    if (UNIT_AFTER_NUMBER.test(question.slice(match.index + identifier.length))) continue;
    if (CONTEXT_WORD_BEFORE_NUMBER.test(question.slice(0, match.index))) continue;
    return Object.freeze({
      selectedProjectIdentifier: selectedIdentifiers[0],
      referencedProjectIdentifier: identifier,
    });
  }
  return null;
}

/** The project's identifier: the first 3-6 digit number in its name, if any. */
export function ecosProjectIdentifier(projectName: string): string | null {
  return new RegExp(PROJECT_IDENTIFIER_SOURCE).exec(projectName)?.[0] ?? null;
}

/** Whether a question has any number that either rule could treat as a project number. */
export function ecosQuestionMayNameAProject(question: string): boolean {
  return new RegExp(PROJECT_IDENTIFIER_SOURCE).test(question);
}

export type ECOSUnarchivedProjectRows = Readonly<{
  data: unknown;
  error: unknown;
  count?: number | null;
}>;

/**
 * Reads the names of every unarchived project the caller can see, for the guard.
 * Returns null, so the stricter check applies, whenever the list cannot be
 * trusted as complete: the read failed or threw, the row count disagrees, the
 * limit was reached, or the already-authorized selected project is missing.
 */
export async function loadECOSKnownProjectNames({
  projectId,
  readUnarchivedProjects,
}: {
  projectId: string;
  readUnarchivedProjects: (limit: number) => PromiseLike<ECOSUnarchivedProjectRows>;
}): Promise<readonly string[] | null> {
  let result: ECOSUnarchivedProjectRows;
  try {
    result = await readUnarchivedProjects(ECOS_KNOWN_PROJECT_NAMES_LIMIT);
  } catch {
    return null;
  }
  return ecosKnownProjectNamesFromRows(result, projectId);
}

export function ecosKnownProjectNamesFromRows(
  result: ECOSUnarchivedProjectRows | null | undefined,
  projectId: string,
): readonly string[] | null {
  const selectedProjectId = projectId.trim();
  if (!result || result.error || !selectedProjectId || !Array.isArray(result.data)) return null;
  const rows: unknown[] = result.data;
  if (rows.length >= ECOS_KNOWN_PROJECT_NAMES_LIMIT) return null;
  if (typeof result.count === 'number' && result.count !== rows.length) return null;
  let includesSelectedProject = false;
  const names: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const record = row as Record<string, unknown>;
    if (String(record.id ?? '').trim() === selectedProjectId) includesSelectedProject = true;
    if (typeof record.name === 'string' && record.name.trim()) names.push(record.name.trim());
  }
  return includesSelectedProject ? Object.freeze(names) : null;
}

/** The pre-Q20 check, kept exactly for callers without a project list. */
function legacyProjectReferenceMismatch(
  projectName: string,
  question: string,
): ECOSProjectReferenceMismatch | null {
  const selectedIdentifiers = uniqueMatches(projectName, LEGACY_IDENTIFIER_SOURCE);
  if (selectedIdentifiers.length === 0) return null;
  const selected = new Set(selectedIdentifiers);
  const referencedProjectIdentifier = uniqueMatches(question, LEGACY_IDENTIFIER_SOURCE).find(identifier => {
    if (selected.has(identifier)) return false;
    const numericIdentifier = Number(identifier);
    return numericIdentifier < 1900 || numericIdentifier > 2099;
  });
  return referencedProjectIdentifier ? Object.freeze({
    selectedProjectIdentifier: selectedIdentifiers[0],
    referencedProjectIdentifier,
  }) : null;
}

function usableKnownProjectNames(value: readonly string[] | null | undefined): string[] | null {
  if (!Array.isArray(value)) return null;
  const names = value
    .filter((name): name is string => typeof name === 'string')
    .map(name => name.trim())
    .filter(Boolean);
  // An empty list cannot be complete (it would not even hold the selected
  // project), so it is treated like no list at all.
  return names.length > 0 ? names : null;
}

function uniqueMatches(value: string, source: string): string[] {
  return [...new Set(value.match(new RegExp(source, 'g')) || [])];
}
