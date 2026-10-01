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
import {
  ecosProjectIdentifier,
  ecosProjectNumberExemptSpans,
  findECOSProjectReferenceMismatch,
} from '../../supabase/functions/_shared/ecos-project-reference';

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
    // 'He wrote "set the sleeve at 12\'-2375" above grade" today?' moved to
    // audit-a9-pass9-project-numbers.test.ts: since pass 9 L4 the inches of
    // a feet-inch pair are one or two digits, so it names 2375.
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

  // Audit A9 pass 9 L2 removed the colon-less time exemption ("Who is the 1130
  // PM?" means project manager). These were allowed; they now name the
  // project, an accepted policy refusal. "7:30am" (below) is still a time.
  it.each([
    ['Will the crew arrive at 730am?', BAY, '730'],
    ['Will the crew arrive at 730 am?', BAY, '730'],
    ['Will the crew arrive at 730AM?', BAY, '730'],
    ['Will the crew arrive at 730 a.m.?', BAY, '730'],
    ['Is the pour at 0730am?', '0730 Night Works', '0730'],
    ['Is the walkthrough at 1130 pm?', PINE, '1130'],
    ['Is the walkthrough at 1130pm?', PINE, '1130'],
  ])('"%s" names "%s" since pass 9 L2', (question, project, number) => {
    expectRefusedOpen(question, [SELECTED, project], number, project);
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

const talkReopen = (closed: string) =>
  `Project 2321 is selected, but ${closed} is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.`;

function noteDraft(note: string, open: readonly string[], closed: readonly string[]) {
  return buildDAVETalkMemoryDraft({
    id: 'note-1',
    createdAt: '2026-09-30T12:00:00.000Z',
    projectName: SELECTED,
    switchedProject: false,
    projectNames: open,
    closedProjectNames: closed,
    transcript: note,
    fields: { generalMemory: note },
  });
}

describe('audit A9 pass 8 L5: a closed one-word project name counts only when named as the project', () => {
  it.each([
    ['Is the main electrical done?', 'Main'],
    ['Is the Main panel energized?', 'Main'],
    ['Is the harbor crane down?', 'Harbor'],
    ['Did the crew finish the main line at the harbor side?', 'Harbor'],
  ])('"%s" with "%s" closed is answered on 2321', (question, closed) => {
    expect(mentionedDAVEProject(question, PROJECTS, [closed])).toBeNull();
    expect(talkAnswer(question, PROJECTS, [closed])).toBeNull();
  });

  it('a note with the everyday word is pre-confirmed on 2321', () => {
    expect(noteDraft('The main electrical is done.', PROJECTS, ['Main']).recommendedProject.confirmed).toBe(true);
  });

  it.each([
    ['What is left at Harbor?', 'Harbor'],
    ['What is overdue for Harbor?', 'Harbor'],
    ['What is overdue on project Harbor?', 'Harbor'],
    ['What is overdue on job Main?', 'Main'],
    ['Is the Harbor project done?', 'Harbor'],
    ['Is the main job closed out?', 'Main'],
  ])('"%s" with "%s" closed names it and is refused', (question, closed) => {
    expect(mentionedDAVEProject(question, PROJECTS, [closed])).toBeNull();
    expect(talkAnswer(question, PROJECTS, [closed])).toBe(talkReopen(closed));
  });

  it('a closed name of two or more words counts wherever it is named in full', () => {
    expect(talkAnswer('Is riverside clinic closed out?', PROJECTS, ['Riverside Clinic'])).toBe(talkReopen('Riverside Clinic'));
    expect(talkAnswer('Did the main street crew leave?', PROJECTS, ['Main Street'])).toBe(talkReopen('Main Street'));
    expect(noteDraft('The Main Street crew left early.', PROJECTS, ['Main Street']).recommendedProject.confirmed).toBe(false);
  });

  it('an open one-word project keeps its behaviour: named anywhere, Talk moves to it', () => {
    expect(mentionedDAVEProject('Is the main electrical done?', [SELECTED, 'Main'])).toBe('Main');
    expect(mentionedDAVEProject('Shipment arrived at Oak today', ['Oak', 'Pine'])).toBe('Oak');
  });

  it('a closed project with a number is still named by its number', () => {
    expect(talkAnswer('Is 4410 done?', PROJECTS, ['4410'])).toBe(talkReopen('4410'));
  });
});

describe('audit A9 pass 8 L6: a Talk task update naming another project Talk does not move to is refused', () => {
  const OLD_YARD = '4410 Old Yard';
  const ANNEX = '2380 Harbor Annex';
  const OPEN = [SELECTED, OTHER, ANNEX];
  const CLOSED = [OLD_YARD, 'Riverside Clinic'];
  const TASKS: Task[] = [
    { id: 'task-2321', projectName: SELECTED, taskName: 'Framing' },
    { id: 'task-2375', projectName: OTHER, taskName: 'Framing' },
    { id: 'task-2380', projectName: ANNEX, taskName: 'Framing' },
  ];
  const twoProjects = (first: string, second: string) =>
    `This question names two projects, ${first} and ${second}. Which one do you mean? Ask again about just that project.`;

  it.each([
    ['Mark 4410 framing complete', talkReopen('4410')],
    ['Mark Riverside Clinic framing complete', talkReopen('Riverside Clinic')],
    ['Mark 2375 and 2380 framing complete', twoProjects('2375', '2380')],
    ['Mark 2375 and 4410 framing complete', twoProjects('2375', '4410')],
    ['Set 2375 framing at 4410 to 50%', twoProjects('2375', '4410')],
  ])('"%s" is refused in the question wording', (command, refusal) => {
    expect(routeDAVEConversation({ transcript: command, intelligence: intelligenceFor(SELECTED) }).intent).toBe('task_update');
    expect(mentionedDAVEProject(command, OPEN, CLOSED)).toBeNull();
    expect(talkAnswer(command, OPEN, CLOSED)).toBe(refusal);
  });

  it('App.tsx Talk refuses "Mark 4410 framing complete", stays on 2321 and pre-fills no task', async () => {
    const h = talkHarness(OPEN, CLOSED, SELECTED, TASKS);
    await h.handleTalkInput('Mark 4410 framing complete');
    expect(h.projectNames).toEqual([SELECTED]);
    expect(h.alert).toHaveBeenCalledWith('One detail needed', talkReopen('4410'));
    expect(h.taskActions).toEqual([]);
  });

  it('App.tsx Talk refuses a task update naming two projects and does not move', async () => {
    const h = talkHarness(OPEN, CLOSED, SELECTED, TASKS);
    await h.handleTalkInput('Mark 2375 and 4410 framing complete');
    expect(h.projectNames).toEqual([SELECTED]);
    expect(h.alert).toHaveBeenCalledWith('One detail needed', twoProjects('2375', '4410'));
    expect(h.taskActions).toEqual([]);
  });

  it.each([
    ['Mark 2375 framing complete', OTHER, 'task-2375'],
    ['Mark 2321 framing complete', SELECTED, 'task-2321'],
    ['Mark framing complete', SELECTED, 'task-2321'],
  ])('"%s" still offers %s\'s task', async (command, project, taskId) => {
    const h = talkHarness(OPEN, CLOSED, SELECTED, TASKS);
    await h.handleTalkInput(command);
    expect(h.alert).not.toHaveBeenCalled();
    expect(h.taskActions).toHaveLength(1);
    expect(h.taskActions[0].projectName).toBe(project);
    expect(h.taskActions[0].candidates.map(task => task.id)).toEqual([taskId]);
  });
});

describe('audit A9 pass 8 L7: a project number with one letter glued to it ("2375A Main")', () => {
  const A = '2375A Main';
  const B = '2375B Main';

  it('the identifier is the leading digits, with the letter kept for display', () => {
    expect(ecosProjectIdentifier(A)).toBe('2375');
    expect(ecosProjectIdentifier('2375a Main')).toBe('2375');
    expect(ecosProjectIdentifier('2375AB Main')).toBeNull();
    // A name with a plain number keeps it.
    expect(ecosProjectIdentifier('Building 2375 Phase 2B')).toBe('2375');
    expect(ecosProjectIdentifier(SELECTED)).toBe('2321');
  });

  it('elsewhere, a mention of it is refused, shown with its letter', () => {
    expect(desktop('What is left at 2375?', [SELECTED, A])).toBe(switchOnDesktop('2375A'));
    expect(phone('Is 2375A done?', [SELECTED, A])).toBe(switchOnPhone('2375A'));
    expect(mentionedDAVEProject('What is left at 2375?', [SELECTED, A])).toBe(A);
    expect(phone('What is left at 2375A?', [SELECTED], [A])).toBe(reopenOnPhone('2375A'));
  });

  it('"2375A" names 2375 when no project is lettered (audit A9 pass 9 L5: a glued A is never amps; was allowed)', () => {
    expect(phone('Is the breaker 2375A?', PROJECTS)).toBe(switchOnPhone('2375'));
  });

  it('two projects 2375A and 2375B share 2375: a bare "2375" refuses as ambiguous and Talk does not move', () => {
    expect(desktop('What is left at 2375?', [SELECTED, A, B])).toBe(switchOnDesktop('2375'));
    expect(mentionedDAVEProject('What is left at 2375?', [SELECTED, A, B])).toBeNull();
    // Audit A9 pass 9 L1: Talk keys projects by the whole identifier, so 2375A
    // and 2375B are two projects there and Talk asks which (was "names 2375").
    expect(talkAnswer('What is left at 2375?', [SELECTED, A, B])).toBe(
      'This question names two projects, 2375A and 2375B. Which one do you mean? Ask again about just that project.',
    );
  });

  it('"2375B" names 2375B Main, and Talk moves there', () => {
    expect(desktop('What is left at 2375B?', [SELECTED, A, B])).toBe(switchOnDesktop('2375B'));
    expect(mentionedDAVEProject('What is left at 2375B?', [SELECTED, A, B])).toBe(B);
  });

  it('with 2375A Main selected, its own "2375A" or "2375" is never refused', () => {
    for (const question of ['What is left at 2375A?', 'What is left at 2375?', 'Is the 2375A wing done?']) {
      expect(phone(question, [SELECTED, A, B], [], A)).toBeNull();
      expect(desktop(question, [SELECTED, A, B], [], A)).toBeNull();
      expect(talkAnswer(question, [SELECTED, A, B], [], A)).toBeNull();
    }
  });

  it('with 2375A Main selected, "2375B" and other projects are refused', () => {
    expect(desktop('What is left at 2375B?', [SELECTED, A, B], [], A)).toBe(switchOnDesktop('2375B', '2375A'));
    expect(desktop('What is left at 2321?', [SELECTED, A, B], [], A)).toBe(switchOnDesktop('2321', '2375A'));
    expect(talkAnswer('Compare 2375B and 2321', [SELECTED, A, B], [], A)).toBe(
      'This question names two projects, 2375B and 2321. Which one do you mean? Ask again about just that project.',
    );
  });

  it('without a project list, the stricter check applies to a lettered selected project', () => {
    expect(findECOSProjectReferenceMismatch(A, 'How thick is the slab at 2321?')?.referencedProjectIdentifier).toBe('2321');
    expect(findECOSProjectReferenceMismatch(A, 'How thick is the slab at 2375?')).toBeNull();
  });
});
