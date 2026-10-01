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
  ecosProjectIdentifier,
  ecosProjectNumberExemptSpans,
  ecosProjectNumberMentionsAt,
} from '../supabase/functions/_shared/ecos-project-reference';
import { ecosProjectReferenceMismatchMessage, projectReferenceMismatchText } from './ECOSProjectRefusal';

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
 * A question naming two different projects stays too (L6a: Talk asks which).
 * A note naming exactly one open project moves to it, whatever closed
 * projects it names alongside ("Crew from 4410 moves to 2375", 4410 closed;
 * audit A11 pass 7 L3); a note naming two or more open projects keeps the
 * earlier rule and moves, for confirmation, to an open project named in
 * full. The selected project itself may be returned; that is no move.
 */
export function mentionedDAVEProject(
  transcript: string,
  projectNames: readonly string[],
  closedProjectNames: readonly string[] | null = [],
) {
  const named = talkNamedProjects(transcript, projectNames, closedProjectNames || []);
  if (named.length === 0) return null;
  if (named.length > 1) {
    if (classifyDAVEConversation(transcript).intent === 'ask') return null;
    const open = named.filter(project => project.open.length > 0);
    if (open.length === 1) return openProjectNamed(open[0]);
    return projectNames.find(name => named.some(project => project.exactOpen.includes(name))) ?? null;
  }
  return openProjectNamed(named[0]);
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
  /** The project number, or the name of a project without one. */
  label: string;
  /** Open projects with this key, and those of them named in full. */
  open: string[];
  exactOpen: string[];
  /** Where the transcript first names it. */
  at: number;
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
 */
function talkNamedProjects(
  transcript: string,
  openNames: readonly string[],
  closedNames: readonly string[],
): TalkNamedProject[] {
  const open = uniqueNames(openNames);
  const openKeys = new Set(open.map(normalize));
  const closed = uniqueNames(closedNames).filter(name => !openKeys.has(normalize(name)));
  const all = [...open, ...closed];
  const exempt = ecosProjectNumberExemptSpans(transcript);
  const occurrences = all.flatMap(name => nameOccurrences(transcript, name)
    .filter(([start, end]) => !exempt.some(([from, to]) => from <= start && end <= to))
    .map(([start, end]) => ({ name, start, end })));
  // "Oak Street" names one project even when another is called "Oak".
  const exact = occurrences.filter(occurrence => !occurrences.some(other =>
    other.end - other.start > occurrence.end - occurrence.start &&
    other.start <= occurrence.start && occurrence.end <= other.end));
  const numbers = ecosProjectNumberMentionsAt(transcript, all);

  const named = new Map<string, TalkNamedProject>();
  const add = (name: string, at: number, inFull: boolean) => {
    const key = talkProjectKey(name);
    const project = named.get(key) ?? { key, label: ecosProjectIdentifier(name) ?? name, open: [], exactOpen: [], at };
    project.at = Math.min(project.at, at);
    const isOpen = openKeys.has(normalize(name));
    if (isOpen && !project.open.includes(name)) project.open.push(name);
    if (isOpen && inFull && !project.exactOpen.includes(name)) project.exactOpen.push(name);
    named.set(key, project);
  };
  for (const occurrence of exact) add(occurrence.name, occurrence.start, true);
  for (const { number, start } of numbers) {
    for (const name of all) if (ecosProjectIdentifier(name) === number) add(name, start, false);
  }
  return [...named.values()].sort((a, b) => a.at - b.at);
}

/** One key per project: its number, or its name when it has none (projects sharing a number are one). */
function talkProjectKey(name: string) {
  return ecosProjectIdentifier(name) ?? `name:${normalize(name)}`;
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
  const named = talkNamedProjects(question, projectNames, closedProjectNames);
  if (named.length >= 2) {
    const labels = named.map(project => project.label);
    const count = labels.length === 2 ? 'two' : String(labels.length);
    const list = `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
    return `This question names ${count} projects, ${list}. Which one do you mean? Ask again about just that project.`;
  }
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
    ecosProjectIdentifier(selected) ?? selected,
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
  const namesAnotherProject = talkNamedProjects(transcript, projectNames || [], closedProjectNames || [])
    .some(project => project.key !== projectKey);
  const needsProjectChoice = switchedProject || namesAnotherProject;
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
