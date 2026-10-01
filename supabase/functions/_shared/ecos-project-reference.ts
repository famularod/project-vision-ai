/**
 * Ask ECOS wrong-project guard, shared by the app (services/ECOSProjectRefusal.ts
 * for Ask ECOS and Talk, and Talk's project matching in
 * services/DAVEConversationRouter.ts) and the repo copy of the
 * ecos-ask-project edge function. No imports and no I/O: callers pass the
 * project lists in.
 *
 * Owner answer Q20 (30 Sep 2026): a question that names ANOTHER known project's
 * number (open, or closed but not deleted; 3-6 digits) is refused and David is
 * told to switch; the selected project's own number is never refused. The live
 * edge function does not check numbers, so this check is the only guard.
 *
 * Audit A9 pass 5 (30 Sep 2026): rule simplified, when unsure, refuse. Passes
 * 1-4 let numbers through after reference words ("RFI", "unit", "room"...),
 * in plural lists and from/to ranges, before street names, as years, and as
 * closed 3-digit counts; every review then found a question those exemptions
 * answered from the wrong project ("Compare the drawings from 2375 and 2321",
 * "Is 200 done?" with 200 closed). A wrong refusal costs David a tap; a missed
 * one answers from the wrong project. Now every 3-6 digit number that is
 * another known project's number names that project ("2,375" is read as
 * 2375; pass 6 L4), unless it is written as one of five things
 * (EXEMPT_PATTERNS below):
 *   1. a measurement: a unit from MEASUREMENT_WORD_UNITS (or V, m, %, °, a
 *      glued A, a feet or inch mark) right after it: "4000 psi", "2375mm",
 *      "200 bags", "200A";
 *   2. money: "$2,375", "USD 2375", "2375 dollars";
 *   3. part of a full date or a clock time: "10/05/2026", "2026-10-05",
 *      "Oct 5, 2026", "5 Oct 2026", "0730 hrs" (a bare year is not exempt);
 *   4. a phone number: "555-2375", "(415) 555-2375", "415.555.2375";
 *   5. a spec section or sheet written as such: "03 30 00", "033000", "A-201".
 * Even then, the project's own next (or previous) name word next to the
 * number names the project: "2375 Days Inn" for "2375 Days Inn Renovation".
 * So "RFI 2375", "unit 2375", "rooms 2375 and 2376", "invoice 2375", "#2375",
 * "2375 Main Street" and "in 2026" are refused when that number is also
 * another project's. Without a usable project list the stricter pre-Q20 check
 * applies (fail closed).
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
 * A number in a question: 3-6 digits, even with letters right after them
 * ("2375A", "2375B wing"), which used to hide the number (audit A9 pass 7 L5).
 * Letters that are a listed unit ("2375mm", "2375A" as amps) are exempt below.
 */
const MENTIONED_NUMBER_SOURCE = String.raw`\b\d{3,6}(?!\d)`;

/**
 * `closedProjectNames` are the closed (archived, not deleted) projects. They
 * are not in the pickable list, but their numbers are refused too, marked
 * closed so the refusal can say so (audit A9 pass 3 L1).
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
  // The selected project is passed too, so its own "2,321" is read whole (pass 7 L2).
  for (const identifier of ecosProjectNumberMentions(question, [projectName, ...knownNames, ...closedNames])) {
    const open = openIdentifiers.has(identifier);
    // A number both an open and a closed project use is read as the open one.
    if (open || closedIdentifiers.has(identifier)) {
      return projectReferenceMismatch(selectedIdentifiers[0], identifier, !open);
    }
  }
  return null;
}

/**
 * A number written with thousands commas ("2,375"). Outside an exempt span
 * (money or a measurement: "$2,375", "2,375 sqft") it is read as its digits,
 * so "project 2,375" is checked as 2375 (audit A9 pass 6 L4). When those
 * digits are not a known project's number, each 3-6 digit part is checked
 * too: "Compare 200,375" names 200 and 375, and "2,375" names 375 when there
 * is a project 375 and no project 2375 (audit A9 pass 7 L2).
 */
const GROUPED_NUMBER_SOURCE = String.raw`\b\d{1,3}(?:,\d{3})+(?!\d)`;

/**
 * The 3-6 digit numbers in `text` that can name a project, in order: every
 * one, except a number written as a measurement, money, a date or time, a
 * phone number, or a spec section or sheet, and not even then when the
 * project's own name continues around it (see the header).
 */
export function ecosProjectNumberMentions(text: string, projectNames: readonly string[] = []): string[] {
  return ecosProjectNumberMentionsAt(text, projectNames).map(mention => mention.number);
}

/** ecosProjectNumberMentions with where each number starts in `text` (Talk orders projects by it). */
export function ecosProjectNumberMentionsAt(
  text: string,
  projectNames: readonly string[] = [],
): Array<Readonly<{ number: string; start: number }>> {
  const exempt = exemptSpans(text);
  const known = new Set(projectNames.map(ecosProjectIdentifier));
  const mentions: Array<Readonly<{ number: string; start: number }>> = [];
  const pattern = new RegExp(`${GROUPED_NUMBER_SOURCE}|${MENTIONED_NUMBER_SOURCE}`, 'g');
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const number = match[0].replace(/,/g, '');
    const start = match.index;
    const end = start + match[0].length;
    if (
      exempt.some(([from, to]) => from <= start && end <= to) &&
      !projectNameAroundNumber(number, text.slice(0, start), text.slice(end), projectNames)
    ) continue;
    if (/^\d{3,6}$/.test(number)) mentions.push({ number, start });
    if (match[0].includes(',') && !known.has(number)) {
      let partStart = start;
      for (const part of match[0].split(',')) {
        if (/^\d{3,6}$/.test(part)) mentions.push({ number: part, start: partStart });
        partStart += part.length + 1;
      }
    }
  }
  return mentions;
}

const NUMBER = String.raw`\b(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const YEAR = '(?:19|20)\\d{2}';
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';

/**
 * Exemption 1, the fixed unit list (matched without case). A word unit may
 * follow the number directly, after one space or after a hyphen ("4000-psi").
 * Left out on purpose because they read as English after a project number:
 * a bare "in" ("Is 2375 in progress?"; write "in." or "inches") and "each"
 * ("2375 each week"). The singular "unit", "bag" and "sheet" are left out too
 * ("2375 unit 4"), and since audit A9 pass 6 M1 so are "units" and "sheets":
 * "Are the 2375 units framed?" and "Are the 2375 sheets issued?" name project
 * 2375 (a count of 200 units now costs a tap). Beyond the owner's list, ksi,
 * psf, kips, foot, yards, cubic feet, gallons, cfm, btu(h), gpm and percent
 * are kept from the earlier rule; none reads as English after a project number.
 * Audit A9 pass 6 L5 brought back more of the earlier rule's units (plf,
 * watts, mcm, mbh, min, pcs): "500 kcmil" passed while its synonym "500 MCM"
 * was refused for a project 500. Audit A9 pass 7 L1 took "meters", "metres"
 * and "pieces" out again: like "units" and "sheets" they are construction
 * nouns ("Are the 2375 meters set?", "Are the 2375 pieces delivered?" name
 * project 2375). The short forms "m" and "pcs" stay.
 */
const MEASUREMENT_WORD_UNITS = [
  // pressure and load
  'psi', 'ksi', 'psf', 'ksf', 'kips?', 'plf',
  // length
  'mm', 'cm', String.raw`in\.`, 'inch(?:es)?', String.raw`ft\.?`, 'feet', 'foot', 'lf',
  String.raw`(?:lineal|linear)\s(?:feet|foot|ft\.?)`, String.raw`yds?\.?`, 'yards?',
  // area
  'sf', String.raw`sq\.?\s?ft\.?`, 'sqft', String.raw`square\s(?:feet|foot)`, 'sy',
  // volume
  'cy', String.raw`c\.y\.`, String.raw`cubic\s(?:yards?|feet|foot)`, String.raw`gal\.?`, 'gallons?',
  // weight
  String.raw`lbs?\.?`, 'pounds?', 'kg', 'tons?',
  // electrical and mechanical
  'amps?', 'amperes?', 'volts?', 'watts', 'kw', 'kva', 'kcmil', 'mcm', 'hp', 'cfm', 'btuh?', 'mbh', 'gpm',
  // percent, temperature and time
  'percent', 'degrees?', 'days?', 'weeks?', 'months?', 'hours?', 'hrs?', 'minutes', 'mins', 'min',
  // counts ("units", "sheets" and "pieces" read as a project's units, drawing
  // sheets or delivered pieces; audit A9 pass 6 M1 and pass 7 L1)
  'ea', 'bags', 'pcs',
];

/** A word naming part of a site: after "2375A" the A is a wing or building letter. */
const SITE_PART_WORDS = ['wing', 'building', 'bldg', 'side', 'tower', 'block', 'phase', 'unit', 'level', 'area'];
const anyCase = (word: string) => word.replace(/[a-z]/g, letter => `[${letter}${letter.toUpperCase()}]`);
/** After a glued A: a letter list (", B", "/B", " & B", " and B") or a site-part word. */
const WING_LETTER_AFTER_A = String.raw`(?:\s*[,/&]\s*|\s+and\s+)[A-Z](?![A-Za-z])|\s+(?:${SITE_PART_WORDS.map(anyCase).join('|')})s?(?![A-Za-z])`;

const EXEMPT_PATTERNS: readonly RegExp[] = [
  // 1. Measurements: word units, then the case-sensitive one-letter units A
  //    (amps), V (volts) and m (metres) with a space or the end after them
  //    ("2375-A" and "2375 A/C" still name 2375). A is amps only glued to the
  //    number ("2375A?", "a 200A main"), and not even then before a letter
  //    list or a site-part word ("the 2375A wing", "2375A, B and C"); a
  //    spaced " A" is never amps ("What is left at 2375 A?"; audit A9 pass 7
  //    L5; write "200A" or "200 amps"). Then %, ° and the prime marks ′ and
  //    ″ with a word or a hyphen after them ("2375′ run"); a mark that may
  //    close a quotation ("at 2375′?", "2375′s") is not a measurement. The
  //    quote marks ' ’ " ” are checked in exemptSpans (FEET_QUOTE_MARK,
  //    INCH_QUOTE_MARK).
  new RegExp(`${NUMBER}[ -]?(?:${MEASUREMENT_WORD_UNITS.join('|')})(?![a-z0-9])`, 'gi'),
  new RegExp(String.raw`${NUMBER}(?:A(?!${WING_LETTER_AFTER_A})| ?[Vm])(?=[\s.,;:!?)]|$)`, 'g'),
  new RegExp(String.raw`${NUMBER} ?(?:%|°[FC]?)`, 'gi'),
  new RegExp(String.raw`(?<!['"‘“’”′″])${NUMBER}[′″](?=\s[a-z0-9]|-)`, 'gi'),
  // 2. Money: "$2,375.50", "$ 2375", "USD 2375", "2375 dollars", "2375 USD".
  new RegExp(String.raw`(?:\$|\bUSD)\s?${NUMBER}|${NUMBER}\s?(?:dollars|USD)\b`, 'gi'),
  // 3. Full dates and clock times: "10/05/2026", "10-5-26", "2026-10-05",
  //    "Oct 5, 2026", "5th October 2026", "7:30", "0730 hrs". A bare year
  //    ("due in 2026") is not exempt, and a four-digit year is 19xx or 20xx
  //    ("Sept 30 2375", "9/30/2375" name 2375; audit A9 pass 6 L3).
  new RegExp([
    String.raw`\b\d{1,2}[/.-]\d{1,2}[/.-](?:${YEAR}|\d{2})\b`,
    String.raw`\b${YEAR}[/.-]\d{1,2}[/.-]\d{1,2}\b`,
    `\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+${YEAR}\\b`,
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH},?\\s+${YEAR}\\b`,
    String.raw`\b(?:[01]?\d|2[0-3]):[0-5]\d\b`,
    String.raw`\b(?:[01]\d|2[0-3])[0-5]\d\s?(?:hrs?|hours)\b`,
  ].join('|'), 'gi'),
  // 4. Phone numbers: "555-2375", "415-555-2375", "(415) 555-2375", "415.555.2375".
  /(?:\(\d{3}\)\s?|\b\d{3}-)?\b\d{3}-\d{4}\b|\b\d{3}\.\d{3}\.\d{4}\b/g,
  // 5. Spec sections and sheets: "03 30 00"; "033000" (six digits starting
  //    with 0: a later division such as "260519" also looks like a year-coded
  //    job number, so it is not exempt; write "26 05 19"); one or two capital
  //    letters, an optional hyphen and the digits with no space: "A-201",
  //    "S201", "E-2375" ("RFI-2375" and "a-201" still name the number).
  /\b\d{2} \d{2} \d{2}\b|\b0\d{5}\b|\b[A-Z]{1,2}-?\d{3,6}\b/g,
];

/**
 * A number with ' or ’ after it. It is a feet mark only in a feet-inch pair
 * ("2375'-6\"", "2375' 6\"", "2375'6\"") or, with a word or a hyphen next,
 * when no single quotation is open before the number; otherwise it closes
 * the quotation ("The super wrote 'delivered to 2375' this morning"; audit
 * A9 pass 7 L3, mirroring the double quote rule below).
 */
const FEET_QUOTE_MARK = new RegExp(String.raw`${NUMBER}['’]`, 'g');

function feetQuoteMarkIsMeasurement(before: string, after: string) {
  if (/^\s?-?\s?\d+(?:\.\d+)?["”″]/.test(after)) return true;
  if (!/^(?:\s[a-z0-9]|-)/i.test(after)) return false;
  return !/['"‘“’”′″]$/.test(before) && !singleQuotationOpen(before);
}

/**
 * Whether a single quotation opened in `text` is still open at its end: ' or
 * ‘ at the start of a word opens one, and ' or ’ at the end of a word closes
 * it. An apostrophe inside a word ("don't", "2375's", "crew’s") does neither.
 */
function singleQuotationOpen(text: string) {
  let open = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character !== "'" && character !== '‘' && character !== '’') continue;
    const afterWord = /[a-z0-9]/i.test(text[index - 1] ?? '');
    const beforeWord = /[a-z0-9]/i.test(text[index + 1] ?? '');
    if (afterWord && beforeWord) continue;
    if (!afterWord && character !== '’') open = true;
    else if (afterWord && character !== '‘') open = false;
  }
  return open;
}

/**
 * A number with " or ” after it and a word or a hyphen next. It is an inch
 * mark only in a feet-inch pair ("12'-6\"", "12' 6\"") or when no double
 * quotation is open before the number; otherwise it closes the quotation
 * ('The super wrote "delivered to 2375" this morning'; audit A9 pass 6 L2).
 */
const INCH_QUOTE_MARK = new RegExp(String.raw`${NUMBER}["”](?=\s[a-z0-9]|-)`, 'gi');

function inchQuoteMarkIsMeasurement(before: string) {
  if (/\d['’′]\s?-?\s?$/.test(before)) return true;
  return !/['"‘“’”′″]$/.test(before) && !doubleQuotationOpen(before);
}

/**
 * Whether a double quotation opened in `text` is still open at its end: “
 * opens and ” closes; a straight " closes an open quotation, and opens one
 * only after the start, a space or punctuation (after a letter it is a stray
 * mark). A straight " right after a digit is an inch mark ('the 6" pipe'): it
 * neither opens nor closes, so 'He wrote "the 6" pipe at 2375" today' keeps
 * the quotation open up to 2375 (audit A9 pass 7 L4).
 */
function doubleQuotationOpen(text: string) {
  let open = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const previous = text[index - 1] ?? '';
    if (character === '“') open = true;
    else if (character === '”') open = false;
    else if (character === '"' && !/\d/.test(previous)) open = open ? false : !/[a-z]/i.test(previous);
  }
  return open;
}

/**
 * The [start, end) spans of `text` written as one of the five exemptions.
 * Talk uses them so a project named just a number ("2375") is not matched
 * by name inside "2375 sqft" or "555-2375" (audit A9 pass 6 L6c).
 */
export function ecosProjectNumberExemptSpans(text: string): Array<readonly [number, number]> {
  return exemptSpans(text);
}

function exemptSpans(text: string): Array<readonly [number, number]> {
  const spans: Array<readonly [number, number]> = [];
  for (const source of EXEMPT_PATTERNS) {
    const pattern = new RegExp(source.source, source.flags);
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      spans.push([match.index, match.index + match[0].length]);
    }
  }
  const feetMark = new RegExp(FEET_QUOTE_MARK.source, FEET_QUOTE_MARK.flags);
  for (let match = feetMark.exec(text); match; match = feetMark.exec(text)) {
    const end = match.index + match[0].length;
    if (feetQuoteMarkIsMeasurement(text.slice(0, match.index), text.slice(end))) {
      spans.push([match.index, end]);
    }
  }
  const inchMark = new RegExp(INCH_QUOTE_MARK.source, INCH_QUOTE_MARK.flags);
  for (let match = inchMark.exec(text); match; match = inchMark.exec(text)) {
    if (inchQuoteMarkIsMeasurement(text.slice(0, match.index))) {
      spans.push([match.index, match.index + match[0].length]);
    }
  }
  return spans;
}

/**
 * Whether the project named by this number continues around it: its next name
 * word follows the number ("2375 Days Inn" for "2375 Days Inn Renovation",
 * checked before any exemption, so a unit that is the project's own name word
 * does not hide it) or its previous name word comes before it ("Tower E-2375").
 */
function projectNameAroundNumber(number: string, before: string, after: string, projectNames: readonly string[]) {
  const nextWord = /^[\s,-]+([a-z0-9]+)/i.exec(after)?.[1]?.toLowerCase();
  return projectNames.some(name => {
    if (ecosProjectIdentifier(name) !== number) return false;
    const index = name.search(new RegExp(`\\b${number}\\b`));
    const nextNameWord = /^[^a-z0-9]*([a-z0-9]+)/i.exec(name.slice(index + number.length))?.[1]?.toLowerCase();
    const previousNameWord = /([a-z0-9]+)[^a-z0-9]*$/i.exec(name.slice(0, index))?.[1];
    return Boolean(
      (nextNameWord && nextWord === nextNameWord) ||
      (previousNameWord && new RegExp(`\\b${previousNameWord}[\\s#:.-]*$`, 'i').test(before)),
    );
  });
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

/** The project's identifier: the first 3-6 digit number in its name, if any. */
export function ecosProjectIdentifier(projectName: string): string | null {
  return new RegExp(PROJECT_IDENTIFIER_SOURCE).exec(projectName)?.[0] ?? null;
}

/** Whether a question has any number that either rule could treat as a project number. */
export function ecosQuestionMayNameAProject(question: string): boolean {
  return new RegExp(MENTIONED_NUMBER_SOURCE).test(question);
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
