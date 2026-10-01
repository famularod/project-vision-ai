import {
  askDAVE,
  routeDAVEAskIntent,
  type DAVEAskAnswer,
} from './DAVEAsk';
import {
  createCaptureMemory,
  type DAVECaptureMemory,
  type DAVECaptureMemoryFields,
} from './DAVECaptureMemory';
import type { DAVEProjectIntelligence } from './DAVEIntelligence';
import {
  parseDAVETaskUpdateCommand,
  type DAVETaskUpdateCommand,
} from './DAVETaskConversation';
import type { DAVEVoiceUnderstandingResponse } from './DAVEVoiceUnderstanding';
import {
  ecosProjectDisplayIdentifier,
  ecosProjectIdentifiers,
  ecosProjectNumberExemptSpans,
  ecosProjectNamedAs,
  ecosProjectNumberMentionsAt,
  ecosProjectsAroundNumber,
} from '../supabase/functions/_shared/ecos-project-reference';
import { ecosProjectReferenceMismatchMessage, projectReferenceMismatchText, projectsNamedTogetherText } from './ECOSProjectRefusal';

export type DAVEConversationIntent =
  | 'ask'
  | 'remember'
  | 'field_information'
  | 'navigate'
  | 'follow_up'
  | 'task_update';

export type DAVEConversationNavigationTarget =
  | 'overview'
  | 'tasks'
  | 'reports'
  | 'project';

export type DAVEConversationRoute =
  | Readonly<{
      intent: 'ask';
      transcript: string;
      answer: DAVEAskAnswer;
    }>
  | Readonly<{
      intent: 'navigate';
      transcript: string;
      target: DAVEConversationNavigationTarget;
    }>
  | Readonly<{
      intent: 'task_update';
      transcript: string;
      command: DAVETaskUpdateCommand;
    }>
  | Readonly<{
      intent: 'remember' | 'field_information' | 'follow_up';
      transcript: string;
      suggestedFields: Partial<DAVECaptureMemoryFields>;
    }>;

export function routeDAVEConversation({
  transcript,
  intelligence,
  interface: conversationInterface = 'text',
}: {
  transcript: string;
  intelligence: DAVEProjectIntelligence;
  interface?: 'text' | 'voice';
}): DAVEConversationRoute {
  const route = classifyDAVEConversation(transcript);
  if (route.intent === 'navigate') {
    return { intent: 'navigate', transcript: route.text, target: route.target };
  }

  if (route.intent === 'task_update') {
    return { intent: 'task_update', transcript: route.text, command: route.command };
  }

  if (route.intent === 'ask') {
    return {
      intent: 'ask',
      transcript: route.text,
      answer: askDAVE({
        question: route.text,
        intelligence,
        interface: conversationInterface,
      }),
    };
  }

  return {
    intent: route.intent,
    transcript: route.text,
    suggestedFields: { [route.field]: route.text },
  };
}

/**
 * The intent routeDAVEConversation chooses, without building an answer.
 * Whole-app audit A9 pass 1 #1 (30 Sep 2026): the Talk context check uses
 * this to tell a field note or task update from a question before it reads
 * "it", "this" or "they" as pointing at a previous answer.
 */
export function classifyDAVEConversationIntent(transcript: string): DAVEConversationRoute['intent'] {
  return classifyDAVEConversation(transcript).intent;
}

/**
 * The open project a Talk question or note moves to, or null to stay: no
 * project is named, or the one named is closed (audit A9 pass 6 L6b; Talk
 * then refuses a question in the closed wording, see
 * talkProjectQuestionRefusal).
 * A question naming two different projects stays too (L6a: Talk asks which),
 * and so does a task update (audit A9 pass 8 L6: Talk refuses it).
 * A note naming exactly one open project moves to it, whatever closed
 * projects it names alongside ("Crew from 4410 moves to 2375", 4410 closed;
 * audit A11 pass 7 L3); a note naming two or more open projects keeps the
 * earlier rule and moves, for confirmation, to an open project named in
 * full. The selected project itself may be returned; that is no move.
 * Audit A9 pass 8 L2: Talk never moves to a project named only by a part of
 * a comma group ("the 1,200 bricks" with a project 200); it asks instead.
 */
export function mentionedDAVEProject(
  transcript: string,
  projectNames: readonly string[],
  closedProjectNames: readonly string[] | null = [],
) {
  const named = talkNamedProjects(transcript, projectNames, closedProjectNames || []);
  if (named.length === 0) return null;
  if (named.length > 1) {
    const intent = classifyDAVEConversation(transcript).intent;
    if (intent === 'ask' || intent === 'task_update') return null;
    const open = named.filter(project => project.open.length > 0 && !project.unsure);
    if (open.length === 1) return openProjectNamed(open[0]);
    return projectNames.find(name => named.some(project => project.exactOpen.includes(name))) ?? null;
  }
  return named[0].unsure ? null : openProjectNamed(named[0]);
}

/**
 * The open project named in full; else the one open project with that
 * number (a number an open and a closed project share is the open one).
 */
function openProjectNamed(project: TalkNamedProject) {
  if (project.exactOpen.length === 1) return project.exactOpen[0];
  return project.open.length === 1 ? project.open[0] : null;
}

type TalkNamedProject = {
  key: string;
  /**
   * The project number ("2375A"), or the name of a project without one; when
   * first named by another number, that number and the name ("2375 (480V
   * Switchgear Upgrade 2375)"; audit A9 pass 13).
   */
  label: string;
  /** Open projects with this key, and those of them named in full. */
  open: string[];
  exactOpen: string[];
  /** Where the transcript first names it. */
  at: number;
  /** Named only by a part of a comma group ("1,200" for 200; audit A9 pass 8 L2). */
  unsure: boolean;
};

/**
 * The different projects a Talk transcript names, in the order first found.
 * Whole-app audit A11 pass 1 F6 (30 Sep 2026): a name matches whole words
 * only ("Oak" is not in "Oakland"), and a number that is a quantity, an
 * amount or part of a date ("2375 feet", "$2375", "9/30/2026") is not read
 * as a project number. A bare number ("What changed at 2375?") still is.
 * Audit A9 pass 3 L2: the same number rule as Ask ECOS; since pass 5 (when
 * unsure, refuse) only a measurement, money, a date or time, a phone number
 * or a spec/sheet ID keeps a project's number from naming it. Audit A9 pass 6
 * L6c: a project named just a number ("2375") is not matched by name inside
 * those spans either ("Is the slab 2375 sqft?", "Call 555-2375"). Projects
 * that share a number are one project here, keyed by that number.
 * Audit A9 pass 8 L5: a closed project's name of one word ("Main", "Harbor")
 * counts only when it is named as the project (closedNameNamesProject).
 * Audit A9 pass 9 L1: the number is compared whole ("2375" is not "2375A"),
 * as in Ask ECOS. A bare "2375" names the project numbered just 2375; with
 * none, the `selectedName` 2375A (its own digits), or else every lettered
 * 2375. "2375 B" names 2375B as well as 2375, and since audit A9 pass 10 L2
 * only 2375B when there is such a project ("2375-B Annex" is 2375B).
 */
function talkNamedProjects(
  transcript: string,
  openNames: readonly string[],
  closedNames: readonly string[],
  selectedName = '',
): TalkNamedProject[] {
  const open = uniqueNames(openNames);
  const openKeys = new Set(open.map(normalize));
  const closed = uniqueNames(closedNames).filter(name => !openKeys.has(normalize(name)));
  const all = [...open, ...closed];
  const exempt = ecosProjectNumberExemptSpans(transcript);
  const closedSet = new Set(closed);
  // Audit A9 pass 9 L3: a task update counts a closed name anywhere.
  const taskUpdate = classifyDAVEConversation(transcript).intent === 'task_update';
  const occurrences = all.flatMap(name => nameOccurrences(transcript, name)
    .filter(([start, end]) => !exempt.some(([from, to]) => from <= start && end <= to))
    .filter(([start, end]) => !closedSet.has(name) || taskUpdate || closedNameNamesProject(name, transcript, start, end))
    .map(([start, end]) => ({ name, start, end, inCommaGroup: inCommaGroup(transcript, start, end) })));
  // Audit A9 pass 16 L2: with the selected project, so a spaced capital it is
  // numbered with ("400 N" on "400N Tower") still reads as another job's
  // address ("24117 - 400 N Main St"), as in Ask ECOS.
  const numbers = ecosProjectNumberMentionsAt(transcript, all, selectedName);
  // The projects whose name continues furthest around each plain number (see
  // the loop below); a name said in full decides only against `selectedName`
  // (audit A9 pass 15 L1).
  const aroundNumbers = numbers.map(mention =>
    mention.letter || mention.spacedLetter ? [] : ecosProjectsAroundNumber(transcript, mention, all, selectedName));
  // "Oak Street" names one project even when another is called "Oak". Audit
  // A9 pass 14 L5: so does a name that continues further around a number in
  // the one said in full ("What is left at 450 Elm St?" is "24117-450 Elm
  // St", not also "450 Elm"), as Ask ECOS reads it.
  const exact = occurrences.filter(occurrence => !occurrences.some(other =>
    other.end - other.start > occurrence.end - occurrence.start &&
    other.start <= occurrence.start && occurrence.end <= other.end) &&
    !numbers.some((mention, index) =>
      occurrence.start <= mention.start && mention.end <= occurrence.end &&
      aroundNumbers[index].length > 0 && !aroundNumbers[index].includes(occurrence.name)));

  const named = new Map<string, TalkNamedProject>();
  const add = (name: string, at: number, inFull: boolean, unsure: boolean, number = '') => {
    const key = talkProjectKey(name);
    const label = key.startsWith('name:') ? name : number ? ecosProjectNamedAs(name, number) : key;
    const project = named.get(key) ?? { key, label, open: [], exactOpen: [], at, unsure };
    project.at = Math.min(project.at, at);
    project.unsure = project.unsure && unsure;
    const isOpen = openKeys.has(normalize(name));
    if (isOpen && !project.open.includes(name)) project.open.push(name);
    if (isOpen && inFull && !unsure && !project.exactOpen.includes(name)) project.exactOpen.push(name);
    named.set(key, project);
  };
  // A name inside a comma group ("200" in "1,200") is as unsure as the number.
  for (const occurrence of exact) add(occurrence.name, occurrence.start, true, occurrence.inCommaGroup);
  // Audit A9 pass 12 L1: a project is matched by any of its identifiers
  // ("480V Switchgear Upgrade 2375" by 480V and by 2375), keyed by the first.
  const withKey = (key: string) => all.filter(name =>
    ecosProjectIdentifiers(name).some(({ digits, letter }) => `${digits}${letter}`.toUpperCase() === key.toUpperCase()));
  const withDigits = (number: string, name: string) => ecosProjectIdentifiers(name).some(({ digits }) => digits === number);
  for (const [index, mention] of numbers.entries()) {
    const { number, start, unsure, letter, spacedLetter } = mention;
    // Audit A9 pass 13 L4: as in Ask ECOS, a plain number belongs to the
    // projects whose name continues around it ("What is left at 2375 Main
    // St?" is 2375 Main St, not also "480V Switchgear Upgrade 2375"; "450 Elm
    // St" is "24117 - 450 Elm St", not 450 Oak Ave). Two or more are each
    // named, so Talk asks which; none falls back to the identifiers below.
    const around = aroundNumbers[index];
    if (around.length > 0) {
      for (const name of around) add(name, start, false, unsure, number);
      continue;
    }
    // "2375B" names the project written "2375B" when there is one (audit A9 pass 8 L7).
    const lettered = letter ? withKey(number + letter) : [];
    const plain = withKey(number);
    const withNumber = lettered.length > 0 ? lettered
      : plain.length > 0 ? plain
      : withDigits(number, selectedName) ? [selectedName]
      : all.filter(name => withDigits(number, name));
    // Audit A9 pass 10 L2: a spaced or hyphen-joined letter that is a
    // project's identifier names only it, like a glued one ("2375-B" on
    // "2375-B Annex" is its own, not also 2375 Main St), as in Ask ECOS.
    const spaced = spacedLetter ? withKey(number + spacedLetter) : [];
    for (const name of spaced.length > 0 ? spaced : withNumber) add(name, start, false, unsure, number);
  }
  return [...named.values()].sort((a, b) => a.at - b.at);
}

/**
 * Audit A9 pass 8 L5: whether a closed project's name found at text[start,
 * end) names that project. A closed project named "Main" refused "Is the main
 * electrical done?". A name of two or more words counts wherever it is named
 * in full; a one-word name only with "project", "job", "at", "for", "on",
 * "of", "about", "to", "from" or "with" before it ("at Harbor", "status of
 * Harbor"; audit A9 pass 9 L3 added the last six; pass 10 L3 added "in",
 * "and" and "vs": "What's left in Harbor?", "Compare 2321 and Harbor"), at
 * the start or right after "how", "is", "what's" or "status" ("Harbor is
 * behind?", "How is Harbor going?"; pass 9 L3) or "did", "does", "has",
 * "was" or "will" ("Did Harbor pass final?", "When will Harbor finish?";
 * pass 10 L3), or with "project" or "job" after it ("the
 * Harbor project"), as for the closed 3-digit numbers in audit A9 pass 4 L3.
 * Its number, if it has one, still names it (talkNamedProjects reads numbers
 * separately). Open projects are matched by name anywhere, as before.
 */
function closedNameNamesProject(name: string, text: string, start: number, end: number) {
  if (normalize(name).split(' ').length > 1) return true;
  return /(?:^|\b(?:project|job|at|for|on|of|about|to|from|with|in|and|vs\.?|did|does|has|was|will|how|is|what['’]?s|status)\s*(?:(?:no|number)\.?\s*)?[:#]?)\s*$/i
    .test(text.slice(0, start)) ||
    /^\s+(?:project|job)\b/i.test(text.slice(end));
}

/** Whether text[start, end) is part of a comma-grouped number ("200" in "1,200" or "200,375"). */
function inCommaGroup(text: string, start: number, end: number) {
  return /\d,$/.test(text.slice(0, start)) || /^,\d{3}(?!\d)/.test(text.slice(end));
}

/**
 * One key per project: its whole number upper-cased ("2375", "2375A"; audit
 * A9 pass 9 L1), or its name when it has none (projects sharing a number are one).
 */
function talkProjectKey(name: string) {
  return ecosProjectDisplayIdentifier(name)?.toUpperCase() ?? `name:${normalize(name)}`;
}

/** [start, end) of each whole-word occurrence of `name` in `text`, without case. */
function nameOccurrences(text: string, name: string): Array<readonly [number, number]> {
  const words = normalize(name).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const pattern = new RegExp(`(?<![A-Za-z0-9])${words.join('[^A-Za-z0-9]+')}(?![A-Za-z0-9])`, 'gi');
  const found: Array<readonly [number, number]> = [];
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    found.push([match.index, match.index + match[0].length]);
  }
  return found;
}

function uniqueNames(names: readonly string[]) {
  const seen = new Set<string>();
  return names.map(name => (typeof name === 'string' ? name.trim() : '')).filter(name => {
    const key = normalize(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * What Talk says instead of answering a question that names another project
 * (audit A9 pass 6 L6): two or more different projects are named, so it asks
 * which (no switch); or the one named is another project Talk did not move
 * to, such as a closed one, in Ask ECOS's phone wording ("... is a closed
 * project. Reopen it under Archived Projects ..."). Null to answer. Talk
 * shows it through resolveDAVEConversationContext, before any answer.
 * Audit A9 pass 7 L6: a closed project named only by its name ("What is left
 * at Harbor?") is refused like a closed number, and `selectedProjectName`
 * may be '' (Talk opened with no project selected).
 */
export function talkProjectQuestionRefusal(
  question: string,
  selectedProjectName: string,
  projectNames: readonly string[],
  closedProjectNames: readonly string[] = [],
): string | null {
  const named = talkNamedProjects(question, projectNames, closedProjectNames, selectedProjectName.trim());
  if (named.length >= 2) return projectsNamedTogetherText(named.map(project => project.label));
  const numberRefusal = ecosProjectReferenceMismatchMessage(selectedProjectName, question, projectNames, {
    closedProjectNames,
    refusalWording: 'phone',
  });
  if (numberRefusal) return numberRefusal;
  // One project is named and Talk did not move to it: a closed one (by name
  // or number), or one Talk could not pick (two open projects share it).
  const [project] = named;
  const selected = selectedProjectName.trim();
  if (!project || (selected && project.key === talkProjectKey(selected))) return null;
  return projectReferenceMismatchText(
    ecosProjectDisplayIdentifier(selected) ?? selected,
    project.label,
    project.open.length === 0,
    'phone',
  );
}

/**
 * The confirmation draft for a note said or typed in Talk.
 * Whole-app audit A11 pass 1 F6 (30 Sep 2026): a number in the note can move
 * it to another project, and that move was saved pre-confirmed with the
 * location heard against the first project's areas. A moved note now needs
 * the manager to confirm the project, and starts with no location.
 * Audit A11 pass 7 L3: with the open and closed project lists, a note that
 * stays but names any other project (open or closed: "Riverside Clinic crew
 * is done", "Crew from 2321 moves to 2375") is not pre-confirmed either;
 * David chooses in Confirm Memory.
 */
export function buildDAVETalkMemoryDraft({
  id,
  createdAt,
  projectName,
  switchedProject,
  projectNames,
  closedProjectNames,
  transcript,
  fields,
  voiceResult,
}: {
  id: string;
  createdAt: string;
  projectName: string;
  switchedProject: boolean;
  projectNames?: readonly string[] | null;
  closedProjectNames?: readonly string[] | null;
  transcript: string;
  fields: Partial<DAVECaptureMemoryFields>;
  voiceResult?: DAVEVoiceUnderstandingResponse;
}): DAVECaptureMemory {
  const projectKey = talkProjectKey(projectName);
  const namesAnotherProject = talkNamedProjects(transcript, projectNames || [], closedProjectNames || [], projectName)
    .some(project => project.key !== projectKey);
  // Audit A9 pass 15 L2: nor when Ask ECOS would refuse it as a question
  // (Talk keys projects by job number, so "24117 - 400 Court St" on "24117
  // - 2375 Main St" looked like this project).
  const askWouldRefuse = Boolean(projectNames) &&
    ecosProjectReferenceMismatchMessage(projectName, transcript, projectNames, { closedProjectNames }) !== null;
  const needsProjectChoice = switchedProject || namesAnotherProject || askWouldRefuse;
  const location = switchedProject ? null : voiceResult?.understanding.recommendedLocation;
  return createCaptureMemory({
    id,
    transcript,
    transcriptSourceRecordId: voiceResult
      ? `voice-transcription:${id}`
      : `typed-entry:${id}`,
    createdAt,
    recommendedProject: {
      value: projectName,
      confidence: needsProjectChoice ? 'medium' : 'high',
      confirmed: !needsProjectChoice,
    },
    recommendedLocation: {
      value: location?.value || null,
      confidence: location?.confidence || 'unknown',
      confirmed: false,
    },
    fields,
  });
}

function classifyDAVEConversation(transcript: string):
  | { intent: 'navigate'; text: string; target: DAVEConversationNavigationTarget }
  | { intent: 'task_update'; text: string; command: DAVETaskUpdateCommand }
  | { intent: 'ask'; text: string }
  | { intent: 'remember' | 'field_information' | 'follow_up'; text: string; field: keyof DAVECaptureMemoryFields } {
  const text = transcript.replace(/\s+/g, ' ').trim();
  const target = navigationTargetFor(text);
  if (target) return { intent: 'navigate', text, target };

  const command = parseDAVETaskUpdateCommand(text);
  if (command) return { intent: 'task_update', text, command };

  if (routeDAVEAskIntent(text) !== 'unknown' || looksLikeQuestion(text)) return { intent: 'ask', text };

  return { ...memoryIntentFor(text), text };
}

function navigationTargetFor(value: string): DAVEConversationNavigationTarget | null {
  const text = normalize(value);
  if (!/^(?:open|show|go to|take me to|view)\b/.test(text)) return null;
  if (/\breports?\b/.test(text)) return 'reports';
  if (/\b(?:tasks?|schedule)\b/.test(text)) return 'tasks';
  if (/\b(?:overview|home)\b/.test(text)) return 'overview';
  if (/\bprojects?\b/.test(text) || /\b\d{3,6}\b/.test(text)) return 'project';
  return null;
}

function looksLikeQuestion(value: string) {
  const text = normalize(value);
  return value.trim().endsWith('?') ||
    /^(?:what|why|how|when|where|which|who|is|are|was|were|do|does|did|can|could|should|would|tell me|summarize|explain|compare)\b/.test(text);
}

function memoryIntentFor(value: string): {
  intent: 'remember' | 'field_information' | 'follow_up';
  field: keyof DAVECaptureMemoryFields;
} {
  const text = normalize(value);
  if (/\b(?:follow up|follow-up|remind me|call|check back)\b/.test(text)) {
    return { intent: 'follow_up', field: 'followUp' };
  }
  if (/\b(?:committed|commitment|promised|will finish|will complete)\b/.test(text)) {
    return { intent: 'remember', field: 'commitment' };
  }
  if (/\b(?:decision|decided|approved|rejected)\b/.test(text)) {
    return { intent: 'remember', field: 'decision' };
  }
  if (/\b(?:schedule|delayed|moved to|rescheduled|due date)\b/.test(text)) {
    return { intent: 'field_information', field: 'scheduleChange' };
  }
  if (/\b(?:issue|problem|blocked|failed|damage|leak|unsafe|hazard)\b/.test(text)) {
    return { intent: 'field_information', field: 'issue' };
  }
  if (/\b(?:risk|concern)\b/.test(text)) {
    return { intent: 'field_information', field: 'risk' };
  }
  return { intent: 'field_information', field: 'generalMemory' };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
