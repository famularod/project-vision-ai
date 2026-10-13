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
 * Audit A9 pass 13: before those identifier rules, a plain number belongs
 * to the project whose name continues furthest around it in the question
 * (see ecosProjectsAroundNumber), when exactly one does: "Is 300 Elm done?"
 * names 300 Elm on "2375-B Annex Suite 300", and "Suite 300" is that
 * project's own. A tie is refused as ambiguous; no name around it falls
 * back to the identifier rules. Audit A9 pass 14 L1: a function word ("at",
 * "of", "the"...) is not counted as a name word.
 */

export type ECOSProjectReferenceMismatch = Readonly<{
  selectedProjectIdentifier: string;
  referencedProjectIdentifier: string;
  /** The number is a closed (archived, not deleted) project's, and no open project's (audit A9 pass 3 L1). */
  referencedProjectClosed: boolean;
  /**
   * Audit A9 pass 14 L2: only when the selected project's name continues as
   * far around the number as another's (a tie, so unsure which is meant):
   * every project named, as shown, the selected one first ("450 (24117 - 450
   * Elm St)", "450 (23088 - 450 Elm St)"). The refusal asks which one.
   * Audit A9 pass 15 L4: also for a tie between other projects with
   * different numbers; each job is named once.
   */
  namedProjects?: readonly string[];
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

  const selected = selectedProjectNumbers(projectName, PROJECT_IDENTIFIER_SOURCE).label;
  // The other projects `isProject` picks out, as a refusal: the open ones, or
  // else the closed ones (a number both use is read as the open one). With
  // `namedProjects`, the refusal asks which of those projects is meant (a
  // tie; audit A9 pass 14 L2 and pass 15 L4).
  const refusal = (fallbackLabel: string, isProject: (name: string) => boolean, namedProjects?: readonly string[]) => {
    const open = knownNames.filter(isProject);
    const names = open.length > 0 ? open : closedNames.filter(isProject);
    if (names.length === 0) return null;
    return projectReferenceMismatch(selected, numberLabel(names, fallbackLabel), open.length === 0, namedProjects);
  };
  // The selected project is passed too, so its own "2,321" is read whole (pass 7 L2).
  const mentions = ecosProjectNumberMentionsAt(question, [projectName, ...knownNames, ...closedNames], projectName);
  // Projects shown by the selected one's number ("2375 Main St Phase 2" on
  // "2375 Main St") count as it, as a shared number always has (Q20). Audit
  // A9 pass 14 L3: only for that number; another number in such a name is
  // that project's ("2375" in "Kroger #452 - 2375 Main St" on "452 Pine Ave").
  const shown = (name: string) => (ecosProjectDisplayIdentifier(name) ?? name.trim()).toUpperCase();
  const isSelectedFor = (number: string) => (name: string) =>
    name.trim().toUpperCase() === projectName.trim().toUpperCase() ||
    (shown(name) === shown(projectName) && shown(projectName) === number);
  for (const mention of mentions) {
    const { number, letter, spacedLetter } = mention;
    // Audit A9 pass 13 L1: a plain number belongs to the project whose name
    // continues furthest around it ("Is 300 Elm done?" names 300 Elm, even
    // on "2375-B Annex Suite 300", whose 300 it also is). When another
    // project's name does, it names that one (tied with the selected one's,
    // it is ambiguous: when unsure, refuse). L3: when only the selected
    // one's does, it is its own, identifier or not ("Suite 300" on "2375
    // Main St Suite 300", "450 Elm St" on "24117 - 450 Elm St", and "2375
    // Main St" on that project with "Bldg 100A 2375 Main"). Audit A9 pass 14
    // L2: a tie with the selected one asks which project is meant ("What is
    // left at 450 Elm St?" on "24117 - 450 Elm St" with a closed "23088 - 450
    // Elm St"), and a name said in full beats one said in part.
    if (!letter && !spacedLetter) {
      const around = ecosProjectsAroundNumber(question, mention, [projectName, ...knownNames, ...closedNames], projectName);
      const isSelected = isSelectedFor(number);
      // Audit A9 pass 15 L2: in a tie with the selected project, a project
      // shown by its number is it too, as in Talk ("What is left at 2375
      // Main St?" on "24117 - 2375 Main St Annex" with a closed "24117 -
      // 2375 Main St" is its own).
      const tiedWithSelected = around.some(isSelected);
      const others = around.filter(name => !isSelected(name) && !(tiedWithSelected && shown(name) === shown(projectName)));
      // Audit A9 pass 15 L4: a tie with projects of another number asks
      // which, each job named once (its open project, else its closed one),
      // as Talk does; other projects that share one number are the open one.
      const jobs = [...new Set(others.map(shown))];
      const jobLabel = (job: string) => {
        const inJob = others.filter(name => shown(name) === job);
        return ecosProjectNamedAs(knownNames.find(name => inJob.includes(name)) ?? inJob[0], number);
      };
      const namedProjects = tiedWithSelected || jobs.length > 1
        ? [...(tiedWithSelected ? [ecosProjectNamedAs(projectName, number)] : []), ...jobs.map(jobLabel)]
        : undefined;
      const other = others.length > 0 ? refusal(number, name => others.includes(name), namedProjects) : null;
      if (other) return other;
      if (around.length > 0) continue;
    }
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
    // one of them. Audit A9 pass 12 L2: only the selected one's identifiers
    // are its own; another number in its name ("What is left at 300?" on
    // "2375 Main St Suite 300") names a project numbered that, and with none
    // is answered (with its name around it, it is its own: pass 13 L3).
    if (hasIdentifier(projectName, number)) continue;
    const named = refusal(number, name => hasIdentifier(name, number)) ??
      (hasIdentifierNumber(projectName, number) ? null : refusal(number, name => hasIdentifierNumber(name, number)));
    if (named) return named;
  }
  return null;
}

/**
 * The selected project's numbers for the pre-Q20 check (every plain number
 * in its name, as `source` reads them, and the digits of a lettered one when
 * it comes first: "2375A Main" is 2375, "2375A Main Suite 3000" 2375 and
 * 3000; audit A9 pass 11 F3 and pass 12 L1; with a project list only its
 * identifiers are its own, pass 12 L2) and how a refusal shows it ("2375A";
 * audit A9 pass 8 L7). A name without a number has none and is shown by
 * name (audit A9 pass 9 M1: "Harbor Office" refused nothing, so another
 * project's 2375 was answered from Harbor Office).
 */
function selectedProjectNumbers(projectName: string, source: string): { numbers: string[]; label: string } {
  const first = firstProjectNumber(projectName, source);
  const plain = uniqueMatches(projectName, source);
  if (first?.letter) return { numbers: [first.digits, ...plain], label: `${first.digits}${first.letter}` };
  if (plain.length > 0) return { numbers: plain, label: plain[0] };
  return { numbers: [], label: ecosProjectDisplayIdentifier(projectName) ?? projectName.trim() };
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
 * pass 10). `used` is the number as the question wrote it (see
 * ecosProjectNamedAs).
 */
function numberLabel(projectNames: readonly string[], used: string) {
  const distinct = numberLabels(projectNames, used);
  if (distinct.length === 1) return distinct[0];
  return `${distinct.slice(0, -1).join(', ')} or ${distinct[distinct.length - 1]}`;
}

/** Each refused project as shown, once ("2375A" for "2375A Main" and "2375a Annex"). */
function numberLabels(projectNames: readonly string[], used: string) {
  const labels = new Set(projectNames.map(name => ecosProjectNamedAs(name, used)));
  if (labels.size === 1) return [...labels];
  return [...labels].filter((label, index, all) =>
    all.findIndex(other => other.toUpperCase() === label.toUpperCase()) === index);
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
 * number starts and ends in `text` (Talk orders projects by it). `unsure`: the number was found only by splitting a
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
 * "2375 A Street"; since audit A9 pass 15 M1 of any project with the number
 * as a word: "400 N. Main" for "24117 - 400 N Main St", and since pass 16 L2
 * only when no project but `selectedProjectName` is numbered with the
 * letter, "400N Tower") is that project's, so neither is one (with a word
 * after the capital, only when that word continues the name too: "2375 A
 * Phase" is not "2375 A Street"; pass 12 L3); a hyphen letter always is one
 * (audit A9 pass 11 F2). Audit A9 pass 11 F1: a
 * capital with a word after it is one only when the number and it are a
 * known project's identifier ("Is 2375 B done?" with "2375B Annex"; else
 * "Is 2375 A priority?" is a word).
 */
export function ecosProjectNumberMentionsAt(
  text: string,
  projectNames: readonly string[] = [],
  selectedProjectName = '',
): Array<Readonly<{ number: string; start: number; end: number; unsure: boolean; letter: string; spacedLetter: string }>> {
  const exempt = exemptSpans(text);
  const known = new Set(projectNames.flatMap(name => projectIdentifiers(name).map(({ digits }) => digits)));
  const mentions: Array<Readonly<{ number: string; start: number; end: number; unsure: boolean; letter: string; spacedLetter: string }>> = [];
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
    // letter always counts ("2375-A" is 2375A; audit A9 pass 11 F2). Audit
    // A9 pass 12 L3: with a word after the capital, the name must continue
    // with that word too ("2375 A Phase 2" does not continue "2375 A Street";
    // "2375 A St." does, pass 13 L2). Audit A9 pass 15 M1: any project
    // whose name has the number as a word of its own, not only one numbered
    // just this ("400 N. Main" continues "24117 - 400 N Main St"). Audit A9
    // pass 16 L2: such a name (not numbered just this) yields to another
    // project numbered with the letter ("What is left at 400 N?" names "400N
    // Tower", even on "24117 - 400 N Main St"), but not on that project
    // itself, where the address still names the other job (when unsure,
    // refuse either way).
    const letteredProject = Boolean(capital) && !hasIdentifier(selectedProjectName, `${number}${capital}`) &&
      projectNames.some(name => hasIdentifier(name, `${number}${capital}`));
    const spacedLetter = hyphenLetter || (capital && !projectNames.some(name =>
      (!letteredProject || hasIdentifier(name, number)) &&
      nameContinuesAfterPlainNumber(name, number, text.slice(end)) &&
      (!capitalBeforeWord || sameNameWord(wordsAfterNumber(text.slice(end))[1], wordsAfterNumber(name, number)[1])))
      ? capital
      : '');
    if (
      exempt.some(([from, to]) => from <= start && end <= to) &&
      !projectNameAroundNumber(number, text.slice(0, start), text.slice(end), projectNames) &&
      !(letter && projectNames.some(name => hasIdentifier(name, `${number}${letter}`)))
    ) continue;
    if (/^\d{3,6}$/.test(number)) mentions.push({ number, start, end, unsure: false, letter, spacedLetter });
    if (match[0].includes(',') && !known.has(number)) {
      let partStart = start;
      for (const part of match[0].split(',')) {
        if (/^\d{3,6}$/.test(part)) {
          mentions.push({ number: part, start: partStart, end: partStart + part.length, unsure: true, letter: '', spacedLetter: '' });
        }
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
  return projectNames.some(name => {
    if (!hasIdentifierNumber(name, number)) return false;
    // Where the number is in the name, with a glued letter ("2375A Main"; pass 8 L7).
    const at = new RegExp(`\\b${number}\\b`).exec(name) ?? new RegExp(`\\b${number}[A-Za-z]\\b`).exec(name);
    return Boolean(at) && nameContinuesAt(name, at!, before, after);
  });
}

/**
 * Audit A9 pass 13: the projects whose name continues furthest around the
 * plain number at text[start, end). The name has the number as a word of its
 * own (identifier or not, so "450" in "24117 - 450 Elm St"; not "2375A" or
 * "2375-B"), and its next name word follows the number in `text` or its
 * previous name word comes before it: "Is 300 Elm done?" for "300 Elm",
 * "Suite 300" for "2375 Main St Suite 300". How far is counted in name words,
 * outward from the number on both sides, so "Is 2375 Main St done?" is
 * "2375 Main St" (two words) and not also "Bldg 100A 2375 Main" (one). A
 * number belongs to the project whose name continues furthest around it,
 * when exactly one does; more than one is ambiguous. Audit A9 pass 14 L2:
 * among those, a name said in full beats one said in part ("Is 2375 Main St
 * done?" is "2375 Main St", not also "24117 - 2375 Main St"). Audit A9 pass
 * 15 L1: only when `selectedProjectName` is among them; between other
 * projects it decides nothing ("What is left at 2375 Main St?" on 2321 is
 * the open "2375 Main St Phase 2" as much as a closed "2375 Main St").
 */
export function ecosProjectsAroundNumber(
  text: string,
  { number, start, end }: Readonly<{ number: string; start: number; end: number }>,
  projectNames: readonly string[],
  selectedProjectName = '',
): string[] {
  const reach = projectNames.map(name => {
    const at = plainNumberIn(name, number);
    return at ? nameWordsAround(name, at, text.slice(0, start), text.slice(end)) : { count: 0, full: false };
  });
  const furthest = Math.max(0, ...reach.map(({ count }) => count));
  if (furthest === 0) return [];
  const tied = projectNames.filter((_, index) => reach[index].count === furthest);
  const selected = selectedProjectName.trim().toUpperCase();
  if (!selected || !tied.some(name => name.trim().toUpperCase() === selected)) return tied;
  const inFull = projectNames.filter((_, index) => reach[index].count === furthest && reach[index].full);
  return inFull.length > 0 ? inFull : tied;
}

/** Where `number` is a word of its own in the name ("450" in "24117 - 450 Elm St"; not "2375A" or "2375-B"). */
function plainNumberIn(name: string, number: string) {
  return new RegExp(String.raw`(?<![A-Za-z0-9])${number}(?![A-Za-z0-9]|-[A-Za-z](?![A-Za-z0-9]))`).exec(name);
}

/** Whether the name has `number` as a word of its own and continues in `after` (audit A9 pass 15 M1). */
function nameContinuesAfterPlainNumber(name: string, number: string, after: string) {
  const at = plainNumberIn(name, number);
  return Boolean(at) && nameContinuesAt(name, at!, '', after);
}

/** Whether the name around name[at] continues in `before` or `after`. */
function nameContinuesAt(name: string, at: RegExpExecArray, before: string, after: string) {
  return nameWordsAround(name, at, before, after).count > 0;
}

/**
 * How many of the name's words around name[at] continue in `before` and
 * `after`, word by word outward from the number, and whether all of them do
 * (`full`: the whole name is said). The nearest word must touch the number:
 * after a space, comma or hyphen ("2375 Main"), or before it with only a
 * space, #, :, . or - between ("Tower E-2375"). Audit A9 pass 14 L4: a word
 * matched only through a street abbreviation counts only when another of
 * the name's words matches as written ("400 Ct St", "2375 A St."), so "Is
 * the 400 CT cabinet set?" does not continue "24117 - 400 Court St".
 */
function nameWordsAround(name: string, at: RegExpExecArray, before: string, after: string) {
  const afterWords = /^[\s,-]+[a-z0-9]/i.test(after) ? wordsIn(after) : [];
  // The last 64 characters are enough to test the end and keep the match linear.
  const beforeWords = /[a-z0-9][\s#:.-]*$/i.test(before.slice(-64)) ? wordsIn(before).reverse() : [];
  const nameAfter = withStreetLetter(wordsIn(name.slice(at.index + at[0].length)));
  const nameBefore = wordsIn(name.slice(0, at.index)).reverse();
  const following = wordsInCommon(nameAfter, afterWords, true);
  const preceding = wordsInCommon(nameBefore, beforeWords);
  const asWritten = following.count + preceding.count;
  return {
    count: asWritten > 0 ? asWritten + following.abbreviated + preceding.abbreviated : 0,
    full: following.walked === nameAfter.length && preceding.walked === nameBefore.length,
  };
}

function wordsIn(text: string): string[] {
  return text.match(/[a-z0-9]+/gi) ?? [];
}

/**
 * Build 231 E1 item 9 (audit A9 pass 17 L2): a name typed with a lower-case
 * street letter ("24117 - 450 a Street") is read as "450 A Street". Only the
 * "a" straight after the number and before a street word is the letter;
 * "2375 a new roof" keeps its article.
 */
function withStreetLetter(nameWordsAfterNumber: string[]) {
  const [first, next] = nameWordsAfterNumber;
  return first === 'a' && next && ECOS_STREET_LETTER_WORDS.has(next.toLowerCase())
    ? ['A', ...nameWordsAfterNumber.slice(1)]
    : nameWordsAfterNumber;
}

/**
 * The words that make the "a" before them, straight after the number in a
 * project NAME, the street's letter and not the article: "450 a Way" is
 * 450 A Way (review pass 1, L5: only ten street words did, so "450 a Way",
 * Circle, Terrace, Trail and Alley were still read with the article).
 *
 * The common street words of United States addresses, each written out and
 * in its usual short form. The list follows the street suffixes of USPS
 * Publication 28 (Appendix C1), written from memory: it was not looked up
 * when this was written, and it is the common ones, not all of them.
 *
 * This list is used for that one reading only. It does not make a short
 * form and its word the same word in a question; that is STREET_WORDS, which
 * is kept to its ten on purpose ("CT" is also a cabinet, "CIR" a circuit).
 */
export const ECOS_STREET_LETTER_WORDS: ReadonlySet<string> = new Set([
  'alley', 'aly', 'avenue', 'ave', 'bend', 'bnd', 'boulevard', 'blvd', 'circle', 'cir', 'court', 'ct',
  'cove', 'cv', 'crescent', 'cres', 'crossing', 'xing', 'drive', 'dr', 'expressway', 'expy',
  'freeway', 'fwy', 'glen', 'gln', 'heights', 'hts', 'highway', 'hwy', 'lane', 'ln', 'loop',
  'parkway', 'pkwy', 'pass', 'path', 'pike', 'place', 'pl', 'plaza', 'plz', 'point', 'pt',
  'ridge', 'rdg', 'road', 'rd', 'route', 'rte', 'row', 'run', 'square', 'sq', 'street', 'st',
  'terrace', 'ter', 'trace', 'trce', 'trail', 'trl', 'turnpike', 'tpke', 'view', 'vw', 'walk', 'way',
]);

/**
 * How many name words the two lists share from the start, as name words
 * (sameNameWord). Audit A9 pass 14 L1: a function word of the name is
 * passed over when it matches but never counted, so "What is left at
 * 2375?" does not continue "Suite 300 at 2375 Main" and "Is 300 at 2375
 * Main done?" still does. `walked` counts every word matched (pass 14 L2);
 * `count` the ones written as in the name and `abbreviated` the ones that
 * match only through a street abbreviation ("St" for "Street"; pass 14 L4).
 */
function wordsInCommon(nameWords: readonly string[], words: readonly string[], toQuestionEnd = false) {
  let walked = 0;
  let count = 0;
  let abbreviated = 0;
  while (walked < nameWords.length && walked < words.length && sameNameWord(words[walked], nameWords[walked])) {
    if (words[walked].toLowerCase() !== nameWords[walked].toLowerCase()) abbreviated += 1;
    else if (!isFunctionWord(nameWords[walked], words[walked]) || isLetterA(nameWords, words, walked, toQuestionEnd)) count += 1;
    walked += 1;
  }
  return { count, abbreviated, walked };
}

/**
 * Audit A9 pass 16 L1: a lower-case "a" is the capital A of a name when the
 * name's next word follows it too, even abbreviated ("2375 a st" continues
 * "24117 - 2375 A Street"), or when it ends the question (`toQuestionEnd`:
 * `words` run to the end; "What is left at 450 a"); "Is 450 a priority this
 * week?" still does not (pass 15 L5), nor does an "a" that starts it ("a
 * 2375 update" is not "Tower A 2375").
 */
function isLetterA(nameWords: readonly string[], words: readonly string[], at: number, toQuestionEnd: boolean) {
  return nameWords[at] === 'A' && words[at] === 'a' &&
    ((toQuestionEnd && at === words.length - 1) || sameNameWord(words[at + 1], nameWords[at + 1]));
}

const FUNCTION_WORDS = new Set(['at', 'on', 'of', 'for', 'in', 'and', 'the', 'to', 'a', 'an', 'by', 'with', 'from']);

/**
 * A function word in a name; a capital A is a letter, as in "2375 A Street"
 * (audit A9 pass 10 L1), when the question writes it as a capital too
 * (audit A9 pass 15 L5: "Is 450 a priority?" does not continue "450 A Street"),
 * or as a lower-case "a" in the places isLetterA reads (pass 16 L1).
 */
function isFunctionWord(nameWord: string, word: string) {
  return !(nameWord === 'A' && word === 'A') && FUNCTION_WORDS.has(nameWord.toLowerCase());
}

/**
 * Whether a question word is the name word, without case. Audit A9 pass 13
 * L2: a common street word and its abbreviation are one word ("2375 A St."
 * continues "2375 A Street"; a trailing period is never part of a word here).
 */
function sameNameWord(word: string | undefined, nameWord: string | undefined) {
  return Boolean(word && nameWord && streetWord(word) === streetWord(nameWord));
}

/** Audit A9 pass 15 M1: compass words too ("400 North Main" continues "400 N Main St"). */
const STREET_WORDS: ReadonlyMap<string, string> = new Map([
  ['st', 'street'], ['ave', 'avenue'], ['rd', 'road'], ['blvd', 'boulevard'], ['dr', 'drive'],
  ['ln', 'lane'], ['ct', 'court'], ['pl', 'place'], ['hwy', 'highway'], ['pkwy', 'parkway'],
  ['n', 'north'], ['s', 'south'], ['e', 'east'], ['w', 'west'],
  ['ne', 'northeast'], ['nw', 'northwest'], ['se', 'southeast'], ['sw', 'southwest'],
]);

function streetWord(word: string) {
  const lower = word.toLowerCase();
  return STREET_WORDS.get(lower) ?? lower;
}

/**
 * The words after `number` in a project name (or, without `number`, in
 * `text`), lower-cased: ["a", "street"] for "2375 A Street" (audit A9 pass
 * 12 L3).
 */
function wordsAfterNumber(text: string, number?: string): string[] {
  const at = number ? new RegExp(`\\b${number}\\b`).exec(text) : null;
  if (number && !at) return [];
  const rest = at ? text.slice(at.index + at[0].length) : text;
  return (rest.match(/[a-z0-9]+/gi) ?? []).map(word => word.toLowerCase());
}

function projectReferenceMismatch(
  selectedProjectIdentifier: string,
  referencedProjectIdentifier: string,
  referencedProjectClosed: boolean,
  namedProjects?: readonly string[],
): ECOSProjectReferenceMismatch {
  return Object.freeze({
    selectedProjectIdentifier,
    referencedProjectIdentifier,
    referencedProjectClosed,
    ...(namedProjects ? { namedProjects: Object.freeze([...namedProjects]) } : {}),
  });
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

/**
 * How a refusal shows a project the question named by `used` ("2375",
 * "2375B"): its shown identifier when `used` is that number ("2375A" for a
 * bare "2375"), else the number the question used and the project's name.
 * Audit A9 pass 13: "What is left on 2375?" said "names 480V", a number the
 * question never used; now "2375 (480V Switchgear Upgrade 2375)".
 */
export function ecosProjectNamedAs(projectName: string, used: string): string {
  const first = firstProjectNumber(projectName);
  if (!first) return used;
  return first.digits === used.replace(/[A-Za-z]$/, '') ? `${first.digits}${first.letter}` : `${used} (${projectName.trim()})`;
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
