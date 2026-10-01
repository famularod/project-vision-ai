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

  for (const mention of projectNumberMentions(question, [...knownNames, ...closedNames])) {
    const identifier = mention.number;
    const open = openIdentifiers.has(identifier);
    if (!open && !closedIdentifiers.has(identifier)) continue;
    // A year stays a year, as in the check before Q20 ("due in 2026").
    if (/^(?:19|20)\d\d$/.test(identifier)) continue;
    // Audit A9 pass 4 L3: a closed 3-digit number only when it is named as the project.
    if (!open && identifier.length === 3 && !namesClosedProject(mention, closedNames)) continue;
    // A number both an open and a closed project use is read as the open one.
    return projectReferenceMismatch(selectedIdentifiers[0], identifier, !open);
  }
  return null;
}

/*
 * Audit A9 pass 4 L3 (30 Sep 2026): with "200 Oak Street" closed, "Did the 200
 * bags of grout arrive?" was refused and David was told to reopen project 200.
 * A 3-digit number is often a count, and a closed project is not one David is
 * working in, so a closed 3-digit project's number is refused only when it is
 * named as the project: its own name word follows ("200 Oak St") or comes
 * before it, "project", "job", "at" or "for" comes before it ("job no. 200",
 * "at 200"), or "job" or "project" follows it ("the 200 job"). An open project's
 * number and a closed 4-6 digit number are refused as before.
 */
const PROJECT_WORD_BEFORE_NUMBER = /\b(?:project|job|at|for)\s*(?:(?:no|number)\.?\s*)?[:#]?\s*$/i;
const PROJECT_WORD_AFTER_NUMBER = /^\s+(?:project|job)\b/i;

function namesClosedProject({ number, before, after }: ProjectNumberMention, closedNames: readonly string[]) {
  return projectNameAroundNumber(number, before, after, closedNames) ||
    PROJECT_WORD_BEFORE_NUMBER.test(before) ||
    PROJECT_WORD_AFTER_NUMBER.test(after);
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
// Audit A9 pass 4 L3: also "2375 linear feet", "2375 sqft" and "120 days".
const QUANTITY_SOURCE = String.raw`\b\d[\d,]*(?:\.\d+)?\s*-?\s*(?:%|°|(?:percent|linear\s+(?:feet|foot|ft)|sqft|days?|weeks?|months?|hours?|hrs?|feet|foot|ft|lf|sf|sq|square|cubic|cy|inches|inch|yards?|yds?|meters?|metres?|mm|cm|lbs?|pounds?|tons?|kips?|gallons?|gal|gpm|psi|ksi|psf|plf|amps?|amperes?|volts?|v|kv|kw|kwh|kva|watts?|hp|hz|btuh?|mbh|cfm|kcmil|mcm|awg|dollars?|pieces|pcs|degrees?)\b)`;
const NOT_A_PROJECT_NUMBER_SOURCE = [DATE_SOURCE, DOLLAR_SOURCE, PHONE_SOURCE, QUANTITY_SOURCE]
  .map(source => `(?:${source})`)
  .join('|');

// A drawing, building or paperwork reference, not a project: "room 1105",
// "Rm. 1105", "rooms 2375 and 2376", "RFI #2375", "unit 2375", "sheet #2375".
//
// Audit A9 pass 4 L2 (30 Sep 2026): with 2375 another project, "Did we invoice
// 2375 yet?", "Open RFIs 2375?", "Copy submittal 14 to 2375?" or "Did RFI 12
// and 2375 close?" were not refused, because any reference word, plural or
// verb, also covered numbers carried over "and", "or" or "to". Now:
// - a singular word labels only the number right after it (optionally after
//   "#", "no." or "number"): "RFI 2375", "unit 2375", "sheet no. 2375";
// - a plural word labels only a real list of two or more numbers: "rooms 2375
//   and 2376", "RFIs 12, 13 and 14", "rooms 2370 through 2375"; "to" joins a
//   list only in a range started with "from" ("rooms from 2370 to 2375");
// - "invoice" and "permit", which are also verbs, label a number only with
//   "#", "no." or "number": "invoice #2375", "permit no. 2375".
const SINGLE_REFERENCE_WORDS = [
  'room', 'rm', 'unit', 'apt', 'apartment', 'suite', 'ste', 'rfi', 'submittal', 'keynote', 'sheet', 'detail',
  'section', 'door', 'elevation', 'elev', 'el', 'grid', 'level', 'spec', 'drawing', 'dwg', 'asi', 'pco',
  'bulletin', 'item',
].join('|');
const LIST_REFERENCE_WORDS = [
  'rooms', 'units', 'apartments', 'suites', 'rfis', 'submittals', 'keynotes', 'sheets', 'details', 'sections',
  'doors', 'elevations', 'grids', 'levels', 'specs', 'drawings', 'dwgs', 'asis', 'pcos', 'bulletins', 'items',
].join('|');
const MARKED_REFERENCE_WORDS = ['invoices?', 'permits?'].join('|');
const SINGLE_REFERENCE_BEFORE_NUMBER = new RegExp(
  String.raw`\b(?:${SINGLE_REFERENCE_WORDS})\.?\s*(?:(?:no|number)\.?\s*)?[:#-]?\s*$`,
  'i',
);
const MARKED_REFERENCE_BEFORE_NUMBER = new RegExp(
  String.raw`\b(?:${MARKED_REFERENCE_WORDS})\.?\s*(?:#|(?:no|number)\.?\s*#?)\s*$`,
  'i',
);
const REFERENCE_LIST_ITEM = String.raw`#?[a-z]{0,3}[-.]?\d+[a-z]?`;
const REFERENCE_LIST_SEPARATOR = String.raw`(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|through|thru)\s+|\s*[&-]\s*)`;
const REFERENCE_RANGE_SEPARATOR = String.raw`(?:${REFERENCE_LIST_SEPARATOR}|\s+to\s+)`;
// Group 1 holds the list items before the number; empty when it is the first.
const REFERENCE_LIST_BEFORE_NUMBER = new RegExp(
  String.raw`\b(?:${LIST_REFERENCE_WORDS})\.?\s*(?:(?:nos?|numbers?)\.?\s*)?[:#-]?\s*` +
    String.raw`((?:${REFERENCE_LIST_ITEM}${REFERENCE_LIST_SEPARATOR})*)#?$`,
  'i',
);
const REFERENCE_RANGE_BEFORE_NUMBER = new RegExp(
  String.raw`\b(?:${LIST_REFERENCE_WORDS})\s+from\s+((?:${REFERENCE_LIST_ITEM}${REFERENCE_RANGE_SEPARATOR})*)#?$`,
  'i',
);
const REFERENCE_LIST_CONTINUES = new RegExp(String.raw`^${REFERENCE_LIST_SEPARATOR}${REFERENCE_LIST_ITEM}\b`, 'i');
const REFERENCE_RANGE_CONTINUES = new RegExp(String.raw`^${REFERENCE_RANGE_SEPARATOR}${REFERENCE_LIST_ITEM}\b`, 'i');

// A street address: "2375 Main Street", "2375 N. Harbor Blvd". The street name
// is capitalized and is not an ordinary word, so "2375 by the service road"
// and "did 2375 take place" still name project 2375.
const STREET_WORD_SOURCE = String.raw`(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl|parkway|pkwy|highway|hwy|terrace|circle|plaza)`;
const STREET_ADDRESS_AFTER_NUMBER = new RegExp(
  String.raw`^\s+(?:(?:n|s|e|w|ne|nw|se|sw|north|south|east|west)\.?\s+)?((?:[a-z0-9][a-z0-9'.-]*\s+){1,3})` +
    String.raw`${STREET_WORD_SOURCE}\b`,
  'i',
);
// Audit A9 pass 4 L1: a project whose name is itself an address ("2375 Harbor Blvd").
const ADDRESS_PROJECT_NAME = new RegExp(String.raw`\b${STREET_WORD_SOURCE}\b`, 'i');
// How a project name's next word may be written: direction words are skipped
// and street words and directions are compared in one spelling, so "2375 N.
// Harbor Blvd" and "2375 Harbor Boulevard" both name "2375 Harbor Blvd".
const DIRECTION_SPELLINGS: ReadonlyMap<string, string> = new Map(Object.entries({
  n: 'north', north: 'north', s: 'south', south: 'south', e: 'east', east: 'east', w: 'west', west: 'west',
  ne: 'northeast', northeast: 'northeast', nw: 'northwest', northwest: 'northwest',
  se: 'southeast', southeast: 'southeast', sw: 'southwest', southwest: 'southwest',
}));
const DIRECTIONS: ReadonlySet<string> = new Set(DIRECTION_SPELLINGS.values());
const STREET_WORD_SPELLINGS: ReadonlyMap<string, string> = new Map(Object.entries({
  st: 'street', str: 'street', street: 'street', ave: 'avenue', av: 'avenue', avenue: 'avenue',
  blvd: 'boulevard', boulevard: 'boulevard', rd: 'road', road: 'road', dr: 'drive', drive: 'drive',
  ln: 'lane', lane: 'lane', ct: 'court', court: 'court', pl: 'place', place: 'place',
  pkwy: 'parkway', parkway: 'parkway', hwy: 'highway', highway: 'highway',
}));
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
 *
 * Audit A9 pass 4 L1 (30 Sep 2026): with project "2375 Harbor Blvd", "2375 N.
 * Harbor Blvd" was read as a street address and not the project, because only
 * the word right after the number was compared with the name. A number that
 * belongs to a project whose name is an address is never let through as a
 * street address, and the name is matched past direction words and street
 * abbreviations.
 */
export function ecosProjectNumberMentions(text: string, projectNames: readonly string[] = []): string[] {
  return projectNumberMentions(text, projectNames).map(mention => mention.number);
}

type ProjectNumberMention = Readonly<{ number: string; before: string; after: string }>;

function projectNumberMentions(text: string, projectNames: readonly string[]): ProjectNumberMention[] {
  const blanked = text.replace(new RegExp(NOT_A_PROJECT_NUMBER_SOURCE, 'gi'), match => ' '.repeat(match.length));
  const addressProjectNumbers = new Set(
    projectNames.filter(name => ADDRESS_PROJECT_NAME.test(name)).map(ecosProjectIdentifier),
  );
  const mentions: ProjectNumberMention[] = [];
  const pattern = new RegExp(PROJECT_IDENTIFIER_SOURCE, 'g');
  for (let match = pattern.exec(blanked); match; match = pattern.exec(blanked)) {
    const number = match[0];
    const before = blanked.slice(0, match.index);
    const after = blanked.slice(match.index + number.length);
    if (
      projectNameAroundNumber(number, before, after, projectNames) ||
      (!referenceWordLabelsNumber(before, after) &&
        (addressProjectNumbers.has(number) || !streetAddressAfterNumber(after)))
    ) {
      mentions.push({ number, before, after });
    }
  }
  return mentions;
}

/** Whether a room, RFI, sheet or other reference word labels this number (audit A9 pass 4 L2). */
function referenceWordLabelsNumber(before: string, after: string) {
  if (SINGLE_REFERENCE_BEFORE_NUMBER.test(before) || MARKED_REFERENCE_BEFORE_NUMBER.test(before)) return true;
  const list = REFERENCE_LIST_BEFORE_NUMBER.exec(before);
  if (list && (list[1] || REFERENCE_LIST_CONTINUES.test(after))) return true;
  const range = REFERENCE_RANGE_BEFORE_NUMBER.exec(before);
  return Boolean(range && (range[1] || REFERENCE_RANGE_CONTINUES.test(after)));
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
    const nextWord = nameWordKey(leadingWords(name.slice(index + number.length)));
    const previousWord = /([a-z0-9]+)[^a-z0-9]*$/i.exec(name.slice(0, index))?.[1];
    return Boolean(
      (nextWord && /^[\s,-]/.test(after) && nameWordCandidates(leadingWords(after)).includes(nextWord)) ||
      (previousWord && new RegExp(`\\b${previousWord}[\\s#:.-]*$`, 'i').test(before)),
    );
  });
}

/** The first few words of `text`, lower-case, with one spelling for street words and directions. */
function leadingWords(text: string): string[] {
  return (text.match(/[a-z0-9]+/gi) || []).slice(0, 4).map(word => {
    const lower = word.toLowerCase();
    return DIRECTION_SPELLINGS.get(lower) ?? STREET_WORD_SPELLINGS.get(lower) ?? lower;
  });
}

/** A project name's next word: the first word that is not a direction, or the direction when that is all there is. */
function nameWordKey(words: readonly string[]): string | undefined {
  return words.find(word => !isDirection(word)) ?? words[0];
}

/** The words after a number that can be a project name's next word: the leading directions and the word after them. */
function nameWordCandidates(words: readonly string[]): string[] {
  const firstWord = words.findIndex(word => !isDirection(word));
  return firstWord < 0 ? [...words] : words.slice(0, firstWord + 1);
}

function isDirection(word: string) {
  return DIRECTIONS.has(word);
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
