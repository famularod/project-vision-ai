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
 *      prime mark) right after it, or a feet-inch pair with both marks:
 *      "4000 psi", "2375mm", "200 bags", "200 amps", "12'-6\"" (a lone ' or "
 *      is not a measurement; audit A9 pass 8; since pass 9 L5 a glued "200A"
 *      is not amps);
 *   2. money: "$2,375", "USD 2375", "2375 dollars";
 *   3. part of a full date or a clock time: "10/05/2026", "2026-10-05",
 *      "Oct 5, 2026", "5 Oct 2026", "7:30am", "0730 hrs" (a bare year, and
 *      since audit A9 pass 9 L2 "730am", are not exempt);
 *   4. a phone number: "555-2375", "(415) 555-2375", "415.555.2375";
 *   5. a spec section or sheet written as such: "03 30 00", "033000", "A-201".
 * Even then, the project's own next (or previous) name word next to the
 * number names the project: "2375 Days Inn" for "2375 Days Inn Renovation".
 * So "RFI 2375", "unit 2375", "rooms 2375 and 2376", "invoice 2375", "#2375",
 * "2375 Main Street" and "in 2026" are refused when that number is also
 * another project's. Without a usable project list the stricter pre-Q20 check
 * applies (fail closed). Audit A9 pass 9 L1: identifiers are compared whole
 * and upper-cased, so "2375" names "2375 Main St" and not "2375A Phase 2".
 * Audit A9 pass 12 L1: a name whose first number is lettered has two
 * identifiers ("480V Switchgear Upgrade 2375" is 480V and 2375; see
 * projectIdentifiers), and either names it.
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
/** A plain 3-6 digit number in a project name, not one with a hyphen and a letter ("2375-B"). */
const PROJECT_IDENTIFIER_SOURCE = String.raw`\b\d{3,6}\b(?!-[A-Za-z](?![A-Za-z0-9]))`;
/**
 * A project number with one letter glued to it ("2375A Main") or, since
 * audit A9 pass 10 L2, joined by a hyphen ("2375-B Annex", read as 2375B as
 * in a question). The digits name the project, and the letter is kept for
 * display and tells "2375A" from "2375B" (audit A9 pass 8 L7). It is the
 * project's identifier when it is the first 3-6 digit number in the name:
 * "2375-B Annex Suite 300" is 2375B (audit A9 pass 11 F3; pass 8 L7 took a
 * plain number anywhere first, so it was 300), and then the first plain
 * number after it is one too ("2375-B Annex Suite 300" is also 300; audit
 * A9 pass 12 L1). A spaced letter is not read ("2375 A Street" is 2375;
 * pass 10 L1).
 */
const LETTERED_IDENTIFIER_SOURCE = String.raw`\b(\d{3,6})-?([A-Za-z])(?![A-Za-z0-9])`;
/**
 * A number in a question: 3-6 digits, even with letters right after them
 * ("2375A", "2375B wing"), which used to hide the number (audit A9 pass 7 L5).
 * Letters that are a listed unit ("2375mm", "2375V") are exempt below.
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
    return projectReferenceMismatch(
      legacy.selectedProjectIdentifier,
      legacy.referencedProjectIdentifier,
      closedNames.some(name => hasIdentifierNumber(name, legacy.referencedProjectIdentifier)),
    );
  }

  const selected = selectedProjectNumbers(projectName, PROJECT_IDENTIFIER_SOURCE);
  // The other projects `isProject` picks out, as a refusal: the open ones, or
  // else the closed ones (a number both use is read as the open one).
  const refusal = (fallbackLabel: string, isProject: (name: string) => boolean) => {
    const open = knownNames.filter(isProject);
    const names = open.length > 0 ? open : closedNames.filter(isProject);
    return names.length > 0 ? projectReferenceMismatch(selected.label, numberLabel(names, fallbackLabel), open.length === 0) : null;
  };
  // The selected project is passed too, so its own "2,321" is read whole (pass 7 L2).
  const mentions = ecosProjectNumberMentionsAt(question, [projectName, ...knownNames, ...closedNames]);
  for (const { number, letter, spacedLetter } of mentions) {
    // Identifiers are compared whole and upper-cased: "2375" is not "2375A"
    // (audit A9 pass 9 L1). "2375B" names the project written "2375B"; the
    // selected one's own "2375A" names only it (pass 8 L7; glued, and since
    // pass 10 L2 spaced or hyphen-joined too: "2375-B" on "2375-B Annex"). A
    // spaced "2375 B" or "2375-B" names 2375B too, and then also reads as 2375.
    // Audit A9 pass 12 L1: a project may have two identifiers ("480V
    // Switchgear Upgrade 2375" is 480V and 2375); either names it, and
    // either is the selected one's own.
    const lettered = `${number}${letter || spacedLetter}`.toUpperCase();
    if ((letter || spacedLetter) && hasIdentifier(projectName, lettered)) continue;
    if (letter || spacedLetter) {
      const letteredProject = refusal(lettered, name => hasIdentifier(name, lettered));
      if (letteredProject) return letteredProject;
    }
    // A bare number names a project numbered just that ("2375 Main St"),
    // even when the selected one is 2375A, unless it is the selected one's
    // own; with none, it names the lettered ones, unless the selected one is
    // one of them.
    if (hasIdentifier(projectName, number) || (!selected.lettered && selected.numbers.includes(number))) continue;
    const named = refusal(number, name => hasIdentifier(name, number)) ??
      (hasIdentifierNumber(projectName, number) ? null : refusal(number, name => hasIdentifierNumber(name, number)));
    if (named) return named;
  }
  return null;
}

/**
 * The selected project's numbers (every plain 3-6 digit number in its name,
 * as `source` reads them, and the digits of a lettered one when it comes
 * first: "2375A Main" is 2375, "2375A Main Suite 300" 2375 and 300; audit A9
 * pass 11 F3 and pass 12 L1), its lettered identifier upper-cased ("2375A",
 * or '') and how the refusal shows it ("2375A"; audit A9 pass 8 L7). A name
 * without a number has none and is shown by name (audit A9 pass 9 M1:
 * "Harbor Office" refused nothing, so another project's 2375 was answered
 * from Harbor Office).
 */
function selectedProjectNumbers(projectName: string, source: string): { numbers: string[]; lettered: string; label: string } {
  const first = firstProjectNumber(projectName, source);
  const plain = uniqueMatches(projectName, source);
  if (first?.letter) return { numbers: [first.digits, ...plain], lettered: `${first.digits}${first.letter}`.toUpperCase(), label: `${first.digits}${first.letter}` };
  if (plain.length > 0) return { numbers: plain, lettered: '', label: plain[0] };
  return { numbers: [], lettered: '', label: ecosProjectDisplayIdentifier(projectName) ?? projectName.trim() };
}

/**
 * The first project number in a name, plain (as `source` reads it) or with
 * a letter ("2375B", "2375-B"), whichever comes first (audit A9 pass 11 F3).
 */
function firstProjectNumber(projectName: string, source = PROJECT_IDENTIFIER_SOURCE): { digits: string; letter: string } | null {
  const plain = new RegExp(source).exec(projectName);
  const lettered = new RegExp(LETTERED_IDENTIFIER_SOURCE).exec(projectName);
  if (lettered && (!plain || lettered.index < plain.index)) return { digits: lettered[1], letter: lettered[2] };
  return plain ? { digits: plain[0], letter: '' } : null;
}

/**
 * A project's identifiers, the shown one first (audit A9 pass 12 L1): the
 * first number in its name, and when that one is lettered also the first
 * plain 3-6 digit number after it. "480V Switchgear Upgrade 2375" is 480V
 * and 2375 (pass 11 F3 made it 480V only, so "What is left on 2375?" was
 * answered from another project), "Bldg 100A 2375 Main" is 100A and 2375,
 * and "2375-B Annex Suite 300" is 2375B and 300 (when unsure, refuse: "What
 * is left at 300?" names it). "2375 Main Suite 300" is 2375 only.
 */
function projectIdentifiers(projectName: string): Array<{ digits: string; letter: string }> {
  const first = firstProjectNumber(projectName);
  if (!first?.letter) return first ? [first] : [];
  const plain = new RegExp(PROJECT_IDENTIFIER_SOURCE).exec(projectName);
  return plain ? [first, { digits: plain[0], letter: '' }] : [first];
}

/** Whether `identifier` ("2375", "2375A", any case) is one of the project's (audit A9 pass 12 L1). */
function hasIdentifier(projectName: string, identifier: string) {
  const wanted = identifier.toUpperCase();
  return projectIdentifiers(projectName).some(({ digits, letter }) => `${digits}${letter}`.toUpperCase() === wanted);
}

/** Whether `number` is the digits of one of the project's identifiers ("2375" for "2375A Main"). */
function hasIdentifierNumber(projectName: string, number: string) {
  return projectIdentifiers(projectName).some(({ digits }) => digits === number);
}

/**
 * A refused project as shown: its identifier as the first project writes it
 * ("2375A", also when another writes it "2375a"; audit A9 pass 11 F4: a bare
 * "2375" showed "2375", which no project is); projects with different
 * identifiers are each named ("2375A or 2375B" for a bare "2375"; audit A9
 * pass 10).
 */
function numberLabel(projectNames: readonly string[], fallback: string) {
  const labels = new Set(projectNames.map(name => ecosProjectDisplayIdentifier(name) ?? fallback));
  const distinct = [...labels].filter((label, index, all) =>
    all.findIndex(other => other.toUpperCase() === label.toUpperCase()) === index);
  if (labels.size === 1) return [...labels][0];
  if (distinct.length === 1) return distinct[0];
  return `${distinct.slice(0, -1).join(', ')} or ${distinct[distinct.length - 1]}`;
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
 * project's own name continues around it (see the header). With where each
 * number starts in `text` (Talk orders projects by it). `unsure`: the number was found only by splitting a
 * comma group ("1,200" read as 200). Ask ECOS refuses it like any other; Talk
 * asks instead of moving to it (audit A9 pass 8 L2). `letter`: one letter
 * glued after the number ("2375B"), or ''. A number and letter that are a
 * project's identifier ("2375V" for "2375V Main") are never read as volts or
 * another exemption (audit A9 pass 8 L7). `spacedLetter`: else one letter
 * after a hyphen ("2375-B"), or one capital after a space standing alone
 * (the end, punctuation or a space and a non-letter after it: "2375 B?",
 * "2375 B 2nd floor"), or '' (audit A9 pass 9 L1). Audit A9 pass 10 L1: a
 * lower-case letter is a word ("Is 2375 a priority?"), and a spaced capital
 * that continues the name of a project numbered just this ("2375 A?" for
 * "2375 A Street") is that project's, so neither is one; a hyphen letter
 * always is one (audit A9 pass 11 F2). Audit A9 pass 11 F1: a
 * capital with a word after it is one only when the number and it are a
 * known project's identifier ("Is 2375 B done?" with "2375B Annex"; else
 * "Is 2375 A priority?" is a word).
 */
export function ecosProjectNumberMentionsAt(
  text: string,
  projectNames: readonly string[] = [],
): Array<Readonly<{ number: string; start: number; unsure: boolean; letter: string; spacedLetter: string }>> {
  const exempt = exemptSpans(text);
  const known = new Set(projectNames.flatMap(name => projectIdentifiers(name).map(({ digits }) => digits)));
  const mentions: Array<Readonly<{ number: string; start: number; unsure: boolean; letter: string; spacedLetter: string }>> = [];
  const pattern = new RegExp(`${GROUPED_NUMBER_SOURCE}|${MENTIONED_NUMBER_SOURCE}`, 'g');
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const number = match[0].replace(/,/g, '');
    const start = match.index;
    const end = start + match[0].length;
    const [, letter = '', hyphenLetter = '', spacedCapital = '', capitalBeforeWord = ''] = match[0].includes(',')
      ? []
      : /^(?:([A-Za-z])(?![A-Za-z0-9])|-([A-Za-z])(?![A-Za-z0-9])| ([A-Z])(?=$|[^A-Za-z0-9\s]|\s+(?:[^A-Za-z\s]|$))| ([A-Z])(?=\s+[A-Za-z]))/
        .exec(text.slice(end)) ?? [];
    // Audit A9 pass 11 F1: a capital with a word after it ("Is 2375 B
    // done?") is the letter when the number and it are a known project's
    // identifier (open or closed), as a capital standing alone always is.
    const capital = spacedCapital ||
      (capitalBeforeWord && projectNames.some(name => hasIdentifier(name, `${number}${capitalBeforeWord}`)) ? capitalBeforeWord : '');
    // Audit A9 pass 10 L1: not a spaced capital that continues the name of a
    // project numbered just this ("2375 A?" for "2375 A Street"). A hyphen
    // letter always counts ("2375-A" is 2375A; audit A9 pass 11 F2).
    const spacedLetter = hyphenLetter || (capital && !projectNames.some(name =>
      hasIdentifier(name, number) && projectNameAroundNumber(number, '', text.slice(end), [name]))
      ? capital
      : '');
    if (
      exempt.some(([from, to]) => from <= start && end <= to) &&
      !projectNameAroundNumber(number, text.slice(0, start), text.slice(end), projectNames) &&
      !(letter && projectNames.some(name => hasIdentifier(name, `${number}${letter}`)))
    ) continue;
    if (/^\d{3,6}$/.test(number)) mentions.push({ number, start, unsure: false, letter, spacedLetter });
    if (match[0].includes(',') && !known.has(number)) {
      let partStart = start;
      for (const part of match[0].split(',')) {
        if (/^\d{3,6}$/.test(part)) mentions.push({ number: part, start: partStart, unsure: true, letter: '', spacedLetter: '' });
        partStart += part.length + 1;
      }
    }
  }
  return mentions;
}

const NUMBER = String.raw`\b(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const YEAR = '(?:19|20)\\d{2}';
const AM_PM = String.raw`[ap]\.?m\.?(?![a-z])`;
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

const EXEMPT_PATTERNS: readonly RegExp[] = [
  // 1. Measurements: word units, then the case-sensitive one-letter units V
  //    (volts) and m (metres) with a space or the end after them. A letter A
  //    is never amps (write "200 amps"): audit A9 passes 7 L5, 8 L7 and 9 L5
  //    each found a project the glued-A reading hid ("the 2375A wing",
  //    "2375A Main", "Is 2375A done?" for "2375 A Street"), so it was
  //    removed: "Is the breaker 200A?" now names project 200 when there is
  //    one, and a number that is no project's is never refused anyway. Then
  //    %, ° and the prime marks ′ and ″ with a word or a hyphen after them
  //    ("2375′ run"); a mark that may close a quotation ("at 2375′?",
  //    "2375′s") is not a measurement. Then a
  //    feet-inch pair with both marks, straight, curly or prime: "12'-6\"",
  //    "12' 6\"", "12'6\"", "12’-6”", "12′-6″", with one or two digits of
  //    inches ("12' 2375\"" names 2375; audit A9 pass 9 L4). Audit A9 pass
  //    8: no other ' ’ " or ” after a number is a measurement, so a lone
  //    "2375\"" or "2375'" names the project (four passes of quotation
  //    tracking each left a quotation misread; write "2375 in." or "2375 ft").
  new RegExp(`${NUMBER}[ -]?(?:${MEASUREMENT_WORD_UNITS.join('|')})(?![a-z0-9])`, 'gi'),
  new RegExp(String.raw`${NUMBER} ?[Vm](?=[\s.,;:!?)]|$)`, 'g'),
  new RegExp(String.raw`${NUMBER} ?(?:%|°[FC]?)`, 'gi'),
  new RegExp(String.raw`(?<!['"‘“’”′″])${NUMBER}[′″](?=\s[a-z0-9]|-)`, 'gi'),
  new RegExp(String.raw`${NUMBER}['’′]\s?-?\s?\d{1,2}(?:\.\d+)?["”″]`, 'g'),
  // 2. Money: "$2,375.50", "$ 2375", "USD 2375", "2375 dollars", "2375 USD".
  new RegExp(String.raw`(?:\$|\bUSD)\s?${NUMBER}|${NUMBER}\s?(?:dollars|USD)\b`, 'gi'),
  // 3. Full dates and clock times: "10/05/2026", "10-5-26", "2026-10-05",
  //    "Oct 5, 2026", "5th October 2026", "7:30", "7:30am", "0730 hrs". A bare
  //    year ("due in 2026") is not exempt, and a four-digit year is 19xx or
  //    20xx ("Sept 30 2375", "9/30/2375" name 2375; audit A9 pass 6 L3).
  //    Audit A9 pass 9 L2: a time without a colon ("730am", "1130 pm"; pass 8
  //    L4) is no longer exempt, since "Who is the 1130 PM?" means project
  //    manager. "arrive at 730am" now names project 730 (write "7:30am").
  new RegExp([
    String.raw`\b\d{1,2}[/.-]\d{1,2}[/.-](?:${YEAR}|\d{2})\b`,
    String.raw`\b${YEAR}[/.-]\d{1,2}[/.-]\d{1,2}\b`,
    `\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+${YEAR}\\b`,
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH},?\\s+${YEAR}\\b`,
    String.raw`\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?${AM_PM}|\b)`,
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
    if (!hasIdentifierNumber(name, number)) return false;
    // Where the number is in the name, with a glued letter ("2375A Main"; pass 8 L7).
    const at = new RegExp(`\\b${number}\\b`).exec(name) ?? new RegExp(`\\b${number}[A-Za-z]\\b`).exec(name);
    if (!at) return false;
    const nextNameWord = /^[^a-z0-9]*([a-z0-9]+)/i.exec(name.slice(at.index + at[0].length))?.[1]?.toLowerCase();
    const previousNameWord = /([a-z0-9]+)[^a-z0-9]*$/i.exec(name.slice(0, at.index))?.[1];
    return Boolean(
      (nextNameWord && nextWord === nextNameWord) ||
      (previousNameWord && new RegExp(`\\b${previousNameWord}[\\s#:.-]*$`, 'i').test(before)),
    );
  });
}

function projectReferenceMismatch(
  selectedProjectIdentifier: string,
  referencedProjectIdentifier: string,
  referencedProjectClosed: boolean,
): ECOSProjectReferenceMismatch {
  return Object.freeze({ selectedProjectIdentifier, referencedProjectIdentifier, referencedProjectClosed });
}

/**
 * The project's identifier: the first 3-6 digit number in its name, the
 * digits only when a letter is glued or hyphen-joined to it ("2375A Main"
 * is 2375; audit A9 pass 8 L7), if any. Since audit A9 pass 11 F3 the
 * first number counts, lettered or plain ("2375B Annex Suite 300" is 2375).
 * A project whose first number is lettered has a second identifier (audit
 * A9 pass 12 L1); compare numbers with ecosProjectIdentifiers.
 */
export function ecosProjectIdentifier(projectName: string): string | null {
  return firstProjectNumber(projectName)?.digits ?? null;
}

/**
 * Every identifier of the project, the shown one first (audit A9 pass 12
 * L1): [{ digits: "480", letter: "V" }, { digits: "2375", letter: "" }] for
 * "480V Switchgear Upgrade 2375", one for "2375 Main Suite 300", none for
 * "Harbor Office". Talk matches a number against all of them.
 */
export function ecosProjectIdentifiers(projectName: string): Array<Readonly<{ digits: string; letter: string }>> {
  return projectIdentifiers(projectName);
}

/**
 * The identifier as the name writes it, letter included ("2375A"), for display
 * (audit A9 pass 8 L7); a hyphen-joined letter is shown joined ("2375-B Annex"
 * is 2375B, as a question's "2375-B" is; audit A9 pass 10 L2).
 */
export function ecosProjectDisplayIdentifier(projectName: string): string | null {
  const first = firstProjectNumber(projectName);
  return first ? `${first.digits}${first.letter}` : null;
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

/**
 * The pre-Q20 check for callers without a project list: any 4-6 digit number
 * that is not a year (1900-2099) and not the selected project's own. Audit A9
 * pass 9 M1: a selected project without a number ("Harbor Office") gets the
 * same check instead of none; 3-digit numbers stay out for every selection.
 */
function legacyProjectReferenceMismatch(
  projectName: string,
  question: string,
): Readonly<{ selectedProjectIdentifier: string; referencedProjectIdentifier: string }> | null {
  // A lettered selected project ("2375A Main") counts as 2375 (audit A9 pass 8 L7).
  const selectedProject = selectedProjectNumbers(projectName, LEGACY_IDENTIFIER_SOURCE);
  const selected = new Set(selectedProject.numbers);
  const referencedProjectIdentifier = uniqueMatches(question, LEGACY_IDENTIFIER_SOURCE).find(identifier => {
    if (selected.has(identifier)) return false;
    const numericIdentifier = Number(identifier);
    return numericIdentifier < 1900 || numericIdentifier > 2099;
  });
  return referencedProjectIdentifier ? {
    selectedProjectIdentifier: selectedProject.label,
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
