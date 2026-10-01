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
 *
 * Audit A9 pass 3 L2 (30 Sep 2026): which numbers can name a project is now one
 * rule with Talk (ecosProjectNumberMentions below).
 */

export type ECOSProjectReferenceMismatch = Readonly<{
  selectedProjectIdentifier: string;
  referencedProjectIdentifier: string;
  /** The number is a closed (archived, not deleted) project's, and no open project's (audit A9 pass 3 L1). */
  referencedProjectClosed: boolean;
}>;

/** More rows than this and the list may be incomplete, so the stricter check applies. */
export const ECOS_KNOWN_PROJECT_NAMES_LIMIT = 1000;

const LEGACY_IDENTIFIER_SOURCE = String.raw`\b\d{4,6}\b`;
const PROJECT_IDENTIFIER_SOURCE = String.raw`\b\d{3,6}\b`;

/**
 * Audit A9 pass 3 L1 (30 Sep 2026): `closedProjectNames` are the closed
 * (archived, not deleted) projects. They are not in the pickable list, so before
 * this "What was the slab thickness at 2375?" was sent to 2321 when 2375 was
 * closed. Their numbers are refused too, marked closed so the refusal can say so.
 */
export function findECOSProjectReferenceMismatch(
  projectName: string,
  question: string,
  knownProjectNames?: readonly string[] | null,
  closedProjectNames?: readonly string[] | null,
): ECOSProjectReferenceMismatch | null {
  const knownNames = usableKnownProjectNames(knownProjectNames);
  const closedNames = usableKnownProjectNames(closedProjectNames) ?? [];
  if (!knownNames) {
    const legacy = legacyProjectReferenceMismatch(projectName, question);
    if (!legacy) return null;
    const closedIdentifiers = otherProjectIdentifiers(closedNames, new Set([legacy.selectedProjectIdentifier]));
    return projectReferenceMismatch(
      legacy.selectedProjectIdentifier,
      legacy.referencedProjectIdentifier,
      closedIdentifiers.has(legacy.referencedProjectIdentifier),
    );
  }

  const selectedIdentifiers = uniqueMatches(projectName, PROJECT_IDENTIFIER_SOURCE);
  if (selectedIdentifiers.length === 0) return null;
  const selected = new Set(selectedIdentifiers);
  const openIdentifiers = otherProjectIdentifiers(knownNames, selected);
  const closedIdentifiers = otherProjectIdentifiers(closedNames, selected);
  if (openIdentifiers.size === 0 && closedIdentifiers.size === 0) return null;

  for (const identifier of ecosProjectNumberMentions(question, [...knownNames, ...closedNames])) {
    const open = openIdentifiers.has(identifier);
    if (!open && !closedIdentifiers.has(identifier)) continue;
    // A year stays a year, as in the check before Q20 ("due in 2026").
    if (/^(?:19|20)\d\d$/.test(identifier)) continue;
    // A number both an open and a closed project use is read as the open one.
    return projectReferenceMismatch(selectedIdentifiers[0], identifier, !open);
  }
  return null;
}

function otherProjectIdentifiers(projectNames: readonly string[], selected: ReadonlySet<string>): Set<string> {
  return new Set(
    projectNames
      .map(ecosProjectIdentifier)
      .filter((identifier): identifier is string => Boolean(identifier) && !selected.has(identifier as string)),
  );
}

function projectReferenceMismatch(
  selectedProjectIdentifier: string,
  referencedProjectIdentifier: string,
  referencedProjectClosed: boolean,
): ECOSProjectReferenceMismatch {
  return Object.freeze({ selectedProjectIdentifier, referencedProjectIdentifier, referencedProjectClosed });
}

/*
 * Audit A9 pass 3 L2 (30 Sep 2026): which numbers in a question or a Talk note
 * can name a project. One rule for Ask ECOS (above) and Talk
 * (services/DAVEConversationRouter.ts mentionedDAVEProject); before, Ask ECOS
 * knew fewer units than Talk and neither knew phone numbers, so "555-2375",
 * "$2375 invoice", "2375 mm", "RFI 2375", "unit 2375" or "2375 Main Street"
 * were refused as project 2375, and "450 kcmil", "200 amp" or "208 V" as a
 * 3-digit project.
 */

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const DATE_SOURCE = [
  String.raw`\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b`,
  `\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`,
  `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH},?\\s+\\d{4}\\b`,
].join('|');
// "$2375", "$ 2,375.50".
const DOLLAR_SOURCE = String.raw`\$\s?\d[\d,]*(?:\.\d+)?`;
// "555-2375", "415-555-2375", "(415) 555-2375", "415.555.2375".
const PHONE_SOURCE = String.raw`(?:\(\d{3}\)\s*|\b\d{3}[-.\s])?\b\d{3}[-.]\d{4}\b`;
// A measurement or amount: "4000 psi", "2,375 ft", "95%", "450 kcmil", "208 V", "100 cubic yards".
const QUANTITY_SOURCE = String.raw`\b\d[\d,]*(?:\.\d+)?\s*-?\s*(?:%|°|(?:percent|feet|foot|ft|lf|sf|sq|square|cubic|cy|inches|inch|yards?|yds?|meters?|metres?|mm|cm|lbs?|pounds?|tons?|kips?|gallons?|gal|gpm|psi|ksi|psf|plf|amps?|amperes?|volts?|v|kv|kw|kwh|kva|watts?|hp|hz|btuh?|mbh|cfm|kcmil|mcm|awg|dollars?|pieces|pcs|degrees?)\b)`;
const NOT_A_PROJECT_NUMBER_SOURCE = [DATE_SOURCE, DOLLAR_SOURCE, PHONE_SOURCE, QUANTITY_SOURCE]
  .map(source => `(?:${source})`)
  .join('|');

// A drawing, building or paperwork reference, not a project: "room 1105",
// "Rm. 1105", "rooms 2375 and 2376", "RFI #2375", "unit 2375", "sheet #2375".
const REFERENCE_WORDS = [
  'rooms?', 'rm', 'units?', 'apt', 'apartment', 'suites?', 'ste', 'rfis?', 'submittals?', 'keynotes?', 'sheets?',
  'details?', 'sections?', 'doors?', 'elevations?', 'elev', 'el', 'grids?', 'levels?', 'specs?', 'drawings?',
  'dwgs?', 'invoices?', 'asis?', 'pcos?', 'bulletins?', 'permits?', 'items?',
].join('|');
const REFERENCE_LIST_ITEM = String.raw`#?[a-z]{0,3}[-.]?\d+[a-z]?`;
const REFERENCE_LIST_SEPARATOR = String.raw`(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|to|through|thru)\s+|\s*[&-]\s*)`;
const REFERENCE_WORD_BEFORE_NUMBER = new RegExp(
  String.raw`\b(?:${REFERENCE_WORDS})\.?\s*(?:(?:no|nos|number|numbers)\.?\s*)?[:#-]?\s*` +
    String.raw`(?:${REFERENCE_LIST_ITEM}${REFERENCE_LIST_SEPARATOR})*$`,
  'i',
);

// A street address: "2375 Main Street", "2375 N. Harbor Blvd". The street name
// is capitalized and is not an ordinary word, so "2375 by the service road"
// and "did 2375 take place" still name project 2375.
const STREET_ADDRESS_AFTER_NUMBER = new RegExp(
  String.raw`^\s+(?:(?:n|s|e|w|ne|nw|se|sw|north|south|east|west)\.?\s+)?((?:[a-z0-9][a-z0-9'.-]*\s+){1,3})` +
    String.raw`(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl|parkway|pkwy|highway|hwy|terrace|circle|plaza)\b`,
  'i',
);
const NOT_A_STREET_NAME = new Set([
  'a', 'an', 'the', 'at', 'by', 'on', 'in', 'of', 'to', 'for', 'from', 'near', 'with', 'and', 'or', 'is', 'are',
  'was', 'were', 'be', 'been', 'this', 'that', 'these', 'those', 'it', 'its', 'their', 'his', 'her', 'our', 'my',
  'your', 'which', 'what', 'where', 'when', 'how', 'off', 'into', 'onto', 'along', 'across', 'behind', 'past',
  'over', 'under', 'up', 'down', 'out', 'side', 'all', 'any', 'each', 'every', 'either', 'other', 'same', 'no',
  'not', 'job', 'project', 'site', 'crew', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'can', 'take',
  'took', 'taken', 'takes', 'taking',
]);

/**
 * The 3-6 digit numbers in `text` that can name a project, in order: not part
 * of a date, dollar amount, phone number or measurement, not a room, unit,
 * RFI, submittal, keynote, suite, sheet or detail reference, and not a street
 * address. A number followed or preceded by the rest of one of `projectNames`
 * ("2375 Compliance", "2375 Main Street" when that is a project) always can.
 */
export function ecosProjectNumberMentions(text: string, projectNames: readonly string[] = []): string[] {
  const blanked = text.replace(new RegExp(NOT_A_PROJECT_NUMBER_SOURCE, 'gi'), match => ' '.repeat(match.length));
  const mentions: string[] = [];
  const pattern = new RegExp(PROJECT_IDENTIFIER_SOURCE, 'g');
  for (let match = pattern.exec(blanked); match; match = pattern.exec(blanked)) {
    const number = match[0];
    const before = blanked.slice(0, match.index);
    const after = blanked.slice(match.index + number.length);
    if (
      projectNameAroundNumber(number, before, after, projectNames) ||
      (!REFERENCE_WORD_BEFORE_NUMBER.test(before) && !streetAddressAfterNumber(after))
    ) {
      mentions.push(number);
    }
  }
  return mentions;
}

function streetAddressAfterNumber(after: string) {
  const match = STREET_ADDRESS_AFTER_NUMBER.exec(after);
  return Boolean(match && match[1].trim().split(/\s+/).every(word =>
    /^[A-Z0-9]/.test(word) && !NOT_A_STREET_NAME.has(word.toLowerCase().replace(/[^a-z0-9]+$/, ''))));
}

/** Whether the word after (or before) the number is the next word of a project named by that number. */
function projectNameAroundNumber(number: string, before: string, after: string, projectNames: readonly string[]) {
  return projectNames.some(name => {
    const index = ecosProjectIdentifier(name) === number ? name.search(new RegExp(`\\b${number}\\b`)) : -1;
    if (index < 0) return false;
    const nextWord = /^[^a-z0-9]*([a-z0-9]+)/i.exec(name.slice(index + number.length))?.[1];
    const previousWord = /([a-z0-9]+)[^a-z0-9]*$/i.exec(name.slice(0, index))?.[1];
    return Boolean(
      (nextWord && new RegExp(`^[\\s,-]+${nextWord}\\b`, 'i').test(after)) ||
      (previousWord && new RegExp(`\\b${previousWord}[\\s#:.-]*$`, 'i').test(before)),
    );
  });
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
): Readonly<{ selectedProjectIdentifier: string; referencedProjectIdentifier: string }> | null {
  const selectedIdentifiers = uniqueMatches(projectName, LEGACY_IDENTIFIER_SOURCE);
  if (selectedIdentifiers.length === 0) return null;
  const selected = new Set(selectedIdentifiers);
  const referencedProjectIdentifier = uniqueMatches(question, LEGACY_IDENTIFIER_SOURCE).find(identifier => {
    if (selected.has(identifier)) return false;
    const numericIdentifier = Number(identifier);
    return numericIdentifier < 1900 || numericIdentifier > 2099;
  });
  return referencedProjectIdentifier ? {
    selectedProjectIdentifier: selectedIdentifiers[0],
    referencedProjectIdentifier,
  } : null;
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
