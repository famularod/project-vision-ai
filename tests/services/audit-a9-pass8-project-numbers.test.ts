import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectQuestion';
import {
  answerDAVEConversationContext,
  askECOSQuestionForTalk,
  resolveDAVEConversationContext,
} from '../../services/DAVEConversationContext';
import {
  buildDAVETalkMemoryDraft,
  mentionedDAVEProject,
  routeDAVEConversation,
} from '../../services/DAVEConversationRouter';
import { findDAVETaskCandidates } from '../../services/DAVETaskConversation';
import { buildProjectIntelligence } from '../../services/DAVEIntelligence';
import { createTalkSession } from '../../hooks/use-talk-session';
import { ecosProjectNumberExemptSpans } from '../../supabase/functions/_shared/ecos-project-reference';

// Audit A9 pass 8 (30 Sep 2026): owner answer Q20 refuses a question that
// names another known project's number (open or closed, not deleted) and
// never the selected project's own. When unsure, refuse: a wrong refusal
// costs David a tap, a missed one answers from the wrong project. Synthetic
// project names.

const SELECTED = '2321 Compliance Project';
const OTHER = '2375 Compliance Project';
const PROJECTS = [SELECTED, OTHER];

const phone = (question: string, known: readonly string[], closed?: readonly string[], selected = SELECTED) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { closedProjectNames: closed, refusalWording: 'phone' });
const desktop = (question: string, known: readonly string[], closed?: readonly string[], selected = SELECTED) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { closedProjectNames: closed, refusalWording: 'desktop' });
const switchOnPhone = (number: string, selected = '2321') =>
  `Project ${selected} is selected, but this question names ${number}. Close this, open project ${number}, then ask again.`;
const switchOnDesktop = (number: string, selected = '2321') =>
  `Project ${selected} is selected, but this question names ${number}. Select project ${number} above, then ask again.`;
const reopenOnPhone = (number: string) =>
  `Project 2321 is selected, but ${number} is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.`;

function expectRefusedOpen(question: string, projects: readonly string[], number: string, project: string) {
  expect(phone(question, projects)).toBe(switchOnPhone(number));
  expect(desktop(question, projects)).toBe(switchOnDesktop(number));
  // Talk moves the question to that project.
  expect(mentionedDAVEProject(question, projects)).toBe(project);
}

function expectAllowed(question: string, projects: readonly string[], closed?: readonly string[]) {
  expect(phone(question, projects, closed)).toBeNull();
  expect(desktop(question, projects, closed)).toBeNull();
  // Talk keeps it on the selected project.
  expect(mentionedDAVEProject(question, projects, closed)).toBeNull();
}

describe('audit A9 pass 8 L1, L3: a quote mark after a number is a measurement only in a feet-inch pair', () => {
  it.each([
    // L1: the second quotation was misread, so 2375" was taken as inches.
    'Did he write "Gate 5" or "go to 2375" today?',
    // L3: smart and single quotes.
    'He wrote “the 6” pipe at 2375” this morning',
    "He wrote 'the 12' beam at 2375' this morning",
    'He wrote ‘the 12’ beam at 2375’ this morning',
    // A lone mark, straight or curly, is no longer an inch or feet mark.
    'Is the pipe 2375" long?',
    'Is the pipe 2375” long?',
    "Is the run 2375' long?",
    'Is the run 2375’ long?',
    'Is the 6" pipe 2375" long?',
  ])('%s is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
    expect(phone(question, [SELECTED], [OTHER])).toBe(reopenOnPhone('2375'));
  });

  it.each([
    // An explicit feet-inch pair with both marks, straight, curly or prime.
    "Is the run 2375'-6\" long?",
    "Is the run 2375' 6\" long?",
    "Is the run 2375'6\" long?",
    'Is the run 2375’-6” long?',
    'Is the run 2375’ 6” long?',
    'Is the run 2375′-6″ long?',
    "He wrote 'set the sleeve at 2375'-6\" above grade' today?",
    'He wrote "set the sleeve at 12\'-2375" above grade" today?',
    // Units written as words still count.
    'Is the run 2375 ft long?',
    'Is the run 2375 feet long?',
    'Is the pipe 2375 in. long?',
    'Is the pipe 2375 inch?',
    'Is the pipe 2375 inches?',
    'Is the run 2375 LF?',
  ])('%s is a measurement and is allowed', question => {
    expectAllowed(question, PROJECTS);
    expectAllowed(question, [SELECTED], [OTHER]);
  });
});

const intelligenceFor = (projectName: string) => buildProjectIntelligence({
  projectId: `project-${projectName}`,
  projectName,
  now: '2026-09-30T12:00:00.000Z',
  updates: [],
  documents: [],
  scheduleItems: [],
} as unknown as Parameters<typeof buildProjectIntelligence>[0]);

/** What Talk says instead of answering, on `selected` ('' = no project), or null when it answers. */
function talkAnswer(question: string, open: readonly string[], closed: readonly string[] = [], selected = SELECTED) {
  const context = resolveDAVEConversationContext({
    transcript: question,
    history: [],
    projectId: `project-${selected}`,
    projectName: selected,
    projectNames: open,
    closedProjectNames: closed,
  });
  return context.status === 'ambiguous_follow_up' ? context.effectiveQuestion : null;
}

// App.tsx's own handleTalkInput, compiled from the source with the real Talk
// services (as in audit-a9-pass7-project-numbers.test.ts), opened on
// `talkProjectName`, with `tasks` as the schedule.
const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

function appFunction(name: string): string {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no function ${name}`);
  const start = match.index + 1;
  const open = app.indexOf(' {\n', start) + 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced function ${name}`);
}

type Task = { id: string; projectName: string; taskName: string };

function talkHarness(open: readonly string[], closed: readonly string[], talkProjectName = SELECTED, tasks: Task[] = []) {
  const projectNames: string[] = [];
  const shown: Array<{ projectName: string } | null> = [];
  const taskActions: Array<{ projectName: string; candidates: Task[] }> = [];
  const drafts: Array<{ recommendedProject: { value: string; confirmed: boolean } }> = [];
  const alert = jest.fn();
  const deps: Record<string, unknown> = {
    setTalkAnswer: (value: { projectName: string } | null) => shown.push(value),
    Alert: { alert },
    talkSession: createTalkSession(),
    talkHistoryPersistence: { append: async () => undefined },
    mentionedDAVEProject,
    reportAvailableProjectNames: open,
    ecosProjectQuestion: { closedProjectNames: closed },
    talkProjectName,
    talkTaskId: null,
    authorityProjectId: (name: string) => `project-${name}`,
    uid: () => 'id-1',
    resolveDAVEConversationContext,
    answerDAVEConversationContext,
    askECOSQuestionForTalk,
    routeDAVEConversation,
    buildDAVETalkMemoryDraft,
    loadECOSTalkReferenceDocuments: async () => [],
    getSupabaseClient: () => ({}),
    referenceDocuments: [],
    projectIntelligenceForTalk: intelligenceFor,
    reportTalkAnswerPersistenceFailure: jest.fn(),
    setTalkProjectName: (name: string) => projectNames.push(name),
    setTalkTaskId: jest.fn(),
    setTalkVoiceOpen: jest.fn(),
    setTalkTypedOpen: jest.fn(),
    setTalkCaptureDraft: (draft: { recommendedProject: { value: string; confirmed: boolean } }) => drafts.push(draft),
    authoritativeScheduleItems: tasks,
    scheduleTasksForParentProject: (projectName: string, items: Task[]) => items.filter(item => item.projectName === projectName),
    findDAVETaskCandidates,
    setTalkTaskAction: (action: { projectName: string; candidates: Task[] }) => taskActions.push(action),
    navigateFromTalk: jest.fn(),
  };
  const js = ts.transpileModule(
    [appFunction('persistTalkAnswer'), appFunction('handleTalkInput'), 'module.exports = { handleTalkInput };'].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const mod = { exports: {} as { handleTalkInput: (transcript: string) => Promise<void> } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return { handleTalkInput: mod.exports.handleTalkInput, projectNames, shown, taskActions, drafts, alert };
}

describe('audit A9 pass 8 L2: a number found only by splitting a comma group is unsure', () => {
  const OAK = '200 Oak Street';
  const BRICKS = 'How many of the 1,200 bricks are laid?';

  it('Ask ECOS refuses it as before (the accepted trade-off)', () => {
    expect(phone(BRICKS, [SELECTED, OAK])).toBe(switchOnPhone('200'));
    expect(desktop(BRICKS, [SELECTED, OAK])).toBe(switchOnDesktop('200'));
  });

  it('Talk does not move to 200 and asks instead', () => {
    expect(mentionedDAVEProject(BRICKS, [SELECTED, OAK])).toBeNull();
    expect(talkAnswer(BRICKS, [SELECTED, OAK])).toBe(switchOnPhone('200'));
    expect(talkAnswer(BRICKS, [SELECTED, OAK], [], '')).toBe(
      'No project is selected, and this question names 200. Close this, open project 200, then ask again.',
    );
  });

  it('a project named just "200" is not matched by name inside "1,200" either', () => {
    expect(mentionedDAVEProject(BRICKS, [SELECTED, '200'])).toBeNull();
    expect(talkAnswer(BRICKS, [SELECTED, '200'])).toBe(switchOnPhone('200'));
  });

  it('a note with "1,200" stays on 2321 and is not pre-confirmed', () => {
    expect(mentionedDAVEProject('Laid 1,200 bricks on the east wall today.', [SELECTED, OAK])).toBeNull();
  });

  it('the selected project 200 itself is answered', () => {
    expect(phone(BRICKS, [SELECTED, OAK], [], OAK)).toBeNull();
    expect(talkAnswer(BRICKS, [SELECTED, OAK], [], OAK)).toBeNull();
  });

  it('a whole grouped number that is a project ("2,375") still moves Talk', () => {
    expect(mentionedDAVEProject('What is overdue on project 2,375?', PROJECTS)).toBe(OTHER);
  });

  it('App.tsx Talk asks "One detail needed", stays on 2321 and does not answer', async () => {
    const h = talkHarness([SELECTED, OAK], []);
    await h.handleTalkInput(BRICKS);
    expect(h.projectNames).toEqual([SELECTED]);
    expect(h.alert).toHaveBeenCalledWith('One detail needed', switchOnPhone('200'));
    expect(h.shown).toEqual([]);
  });

  it('App.tsx Talk keeps a "1,200" note on 2321 for David to confirm', async () => {
    const h = talkHarness([SELECTED, OAK], []);
    await h.handleTalkInput('Laid 1,200 bricks on the east wall today.');
    expect(h.projectNames).toEqual([SELECTED]);
    expect(h.drafts).toHaveLength(1);
    expect(h.drafts[0].recommendedProject).toMatchObject({ value: SELECTED, confirmed: false });
  });
});

describe('audit A9 pass 8 L4: a 3-4 digit time with am or pm is a clock time', () => {
  const BAY = '730 Bay';
  const PINE = '1130 Pine';

  it.each([
    ['Will the crew arrive at 730am?', BAY],
    ['Will the crew arrive at 730 am?', BAY],
    ['Will the crew arrive at 730AM?', BAY],
    ['Will the crew arrive at 730 a.m.?', BAY],
    ['Is the pour at 0730am?', '0730 Night Works'],
    ['Is the walkthrough at 1130 pm?', PINE],
    ['Is the walkthrough at 1130pm?', PINE],
  ])('"%s" is allowed with "%s" open or closed', (question, project) => {
    expectAllowed(question, [SELECTED, project]);
    expectAllowed(question, [SELECTED], [project]);
  });

  it.each([
    // Not a valid time: hours 1-12 and minutes 00-59 only.
    ['Is the crew at 2375am?', OTHER, '2375'],
    ['Is the crew at 2375 am?', OTHER, '2375'],
    ['Is the crew at 1330pm?', '1330 Elm', '1330'],
    ['Is the crew at 760am?', '760 Oak', '760'],
    // No am or pm: still the project.
    ['Will the crew arrive at 730?', BAY, '730'],
  ])('"%s" is refused', (question, project, number) => {
    expectRefusedOpen(question, [SELECTED, project], number, project);
  });

  it('"7:30am" and "7:30 am" are clock times too', () => {
    expect(ecosProjectNumberExemptSpans('arrive at 7:30am')).toContainEqual([10, 16]);
    expect(ecosProjectNumberExemptSpans('arrive at 7:30 am')).toContainEqual([10, 17]);
    expect(ecosProjectNumberExemptSpans('arrive at 11:30 p.m.')).toContainEqual([10, 20]);
  });
});
