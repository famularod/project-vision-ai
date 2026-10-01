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
import { findECOSProjectReferenceMismatch } from '../../supabase/functions/_shared/ecos-project-reference';

// Audit A9 pass 9 (30 Sep 2026): owner answer Q20 refuses a question that
// names another known project's number (open or closed, not deleted) and
// never the selected project's own. When unsure, refuse: a wrong refusal
// costs David a tap, a missed one answers from the wrong project. Synthetic
// project names.

const SELECTED = '2321 Compliance Project';
const OTHER = '2375 Compliance Project';
const PROJECTS = [SELECTED, OTHER];

const phone = (question: string, known: readonly string[] | null, closed?: readonly string[], selected = SELECTED) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { closedProjectNames: closed, refusalWording: 'phone' });
const desktop = (question: string, known: readonly string[] | null, closed?: readonly string[], selected = SELECTED) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { closedProjectNames: closed, refusalWording: 'desktop' });
const switchOnPhone = (number: string, selected = '2321') =>
  `Project ${selected} is selected, but this question names ${number}. Close this, open project ${number}, then ask again.`;
const switchOnDesktop = (number: string, selected = '2321') =>
  `Project ${selected} is selected, but this question names ${number}. Select project ${number} above, then ask again.`;

/** What Talk says instead of answering, on `selected`, or null when it answers. */
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

describe('audit A9 pass 9 M1: a selected project whose name has no number still refuses another project\'s number', () => {
  const OFFICE = 'Harbor Office';
  const WITH_OFFICE = [OFFICE, ...PROJECTS];

  it('"What is left at 2375?" on Harbor Office is refused, naming Harbor Office', () => {
    expect(desktop('What is left at 2375?', WITH_OFFICE, [], OFFICE)).toBe(switchOnDesktop('2375', OFFICE));
    expect(phone('What is left at 2375?', WITH_OFFICE, [], OFFICE)).toBe(switchOnPhone('2375', OFFICE));
    expect(talkAnswer('What is left at 2375?', WITH_OFFICE, [], OFFICE)).toBe(switchOnPhone('2375', OFFICE));
  });

  it('a closed project\'s number is refused as closed', () => {
    expect(findECOSProjectReferenceMismatch(OFFICE, 'What is left at 2375?', [OFFICE], [OTHER])).toEqual({
      selectedProjectIdentifier: OFFICE,
      referencedProjectIdentifier: '2375',
      referencedProjectClosed: true,
    });
  });

  it('a number that is no project\'s, or is written as a measurement, is still answered', () => {
    expect(desktop('What is left at 2400?', WITH_OFFICE, [], OFFICE)).toBeNull();
    expect(desktop('Is 2375 psi enough for the slab?', WITH_OFFICE, [], OFFICE)).toBeNull();
    expect(desktop('What is overdue?', WITH_OFFICE, [], OFFICE)).toBeNull();
  });

  it('without a project list, the stricter check refuses a 4-6 digit number that is not a year, as for a numbered project', () => {
    expect(desktop('What is left at 2375?', null, [], OFFICE)).toBe(switchOnDesktop('2375', OFFICE));
    expect(desktop('What is left at 2375?', null, [], SELECTED)).toBe(switchOnDesktop('2375'));
    // The stricter check reads 4-6 digits and never a year, for every selection.
    for (const selected of [OFFICE, SELECTED]) {
      expect(desktop('Which deliveries are due in 2026?', null, [], selected)).toBeNull();
      expect(desktop('What is left at 450?', null, [], selected)).toBeNull();
    }
  });

  it('Talk keeps the question on Harbor Office and does not move to 2375 when it is closed', () => {
    expect(mentionedDAVEProject('What is left at 2375?', [OFFICE, SELECTED], [OTHER])).toBeNull();
    expect(talkAnswer('What is left at 2375?', [OFFICE, SELECTED], [OTHER], OFFICE)).toBe(
      'Project Harbor Office is selected, but 2375 is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.',
    );
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

function noteDraft(note: string, selected: string, open: readonly string[], closed: readonly string[] = []) {
  return buildDAVETalkMemoryDraft({
    id: 'note-1',
    createdAt: '2026-09-30T12:00:00.000Z',
    projectName: selected,
    switchedProject: false,
    projectNames: open,
    closedProjectNames: closed,
    transcript: note,
    fields: { generalMemory: note },
  });
}

// App.tsx's own handleTalkInput, compiled from the source with the real Talk
// services (as in audit-a9-pass8-project-numbers.test.ts), opened on
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

function talkHarness(open: readonly string[], closed: readonly string[], talkProjectName: string, tasks: Task[] = []) {
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

describe('audit A9 pass 9 L1: identifiers are compared whole, so "2375" is not "2375A"', () => {
  const A = '2375A Phase 2';
  const MAIN = '2375 Main St';
  const B = '2375B Main';
  const WITH_MAIN = [SELECTED, A, MAIN];
  const LETTERED = [SELECTED, A, B];

  it('with 2375A selected, a bare "2375" names the project 2375 Main St and is refused', () => {
    expect(desktop('What is left at 2375?', WITH_MAIN, [], A)).toBe(switchOnDesktop('2375', '2375A'));
    expect(phone('What is left at 2375?', WITH_MAIN, [], A)).toBe(switchOnPhone('2375', '2375A'));
    expect(findECOSProjectReferenceMismatch(A, 'What is left at 2375?', [SELECTED, A], [MAIN])?.referencedProjectClosed).toBe(true);
  });

  it('with 2375A selected, its own "2375A" is never refused, and nor are its digits when no project is plain 2375', () => {
    expect(desktop('What is left at 2375A?', WITH_MAIN, [], A)).toBeNull();
    expect(desktop('Is the 2375A wing done?', WITH_MAIN, [], A)).toBeNull();
    expect(desktop('What is left at 2375?', LETTERED, [], A)).toBeNull();
    expect(talkAnswer('What is left at 2375?', LETTERED, [], A)).toBeNull();
  });

  it('with 2375 Main St selected, its own "2375" is answered and "2375A" is refused', () => {
    expect(desktop('What is left at 2375?', WITH_MAIN, [], MAIN)).toBeNull();
    expect(desktop('What is left at 2375A?', WITH_MAIN, [], MAIN)).toBe(switchOnDesktop('2375A', '2375'));
  });

  // Audit A9 pass 10 L1: a lower-case spaced "2375 b" is a bare 2375 now (a
  // spaced letter is the number's only as a capital standing alone), so it
  // left this list; see audit-a9-pass10-project-numbers.test.ts.
  it.each(['What is left at 2375 B?', 'What is left at 2375-B?'])(
    '"%s" names 2375B when it is another project',
    question => {
      expect(desktop(question, LETTERED, [], A)).toBe(switchOnDesktop('2375B', '2375A'));
      expect(desktop(question, LETTERED)).toBe(switchOnDesktop('2375B'));
      // Audit A9 pass 10 L2: Talk reads it as 2375B only, as Ask ECOS does
      // (it asked "which one" for 2375A and 2375B here), so it refuses in
      // the switch wording and a question with no selection moves to 2375B.
      expect(talkAnswer(question, LETTERED, [], A)).toBe(switchOnPhone('2375B', '2375A'));
      expect(mentionedDAVEProject(question, LETTERED)).toBe(B);
    },
  );

  it('Talk on 2375A moves "What is left at 2375?" to 2375 Main St and answers there', async () => {
    expect(mentionedDAVEProject('What is left at 2375?', WITH_MAIN)).toBe(MAIN);
    const h = talkHarness(WITH_MAIN, [], A);
    await h.handleTalkInput('What is left at 2375?');
    expect(h.projectNames).toEqual([MAIN]);
    expect(h.alert).not.toHaveBeenCalled();
    expect(h.shown.map(answer => answer?.projectName)).toEqual([MAIN]);
  });

  it('a note about "2375" on 2375A is not pre-confirmed on 2375A', async () => {
    expect(noteDraft('Crew at 2375 left early.', A, WITH_MAIN).recommendedProject.confirmed).toBe(false);
    const h = talkHarness(WITH_MAIN, [], A);
    await h.handleTalkInput('Crew at 2375 left early.');
    expect(h.drafts).toHaveLength(1);
    expect(h.drafts[0].recommendedProject).toMatchObject({ value: MAIN, confirmed: false });
  });

  it('a note about "2375" on 2375A, with no project plain 2375, stays pre-confirmed on 2375A', () => {
    expect(noteDraft('Crew at 2375 left early.', A, LETTERED).recommendedProject.confirmed).toBe(true);
    expect(noteDraft('Crew at 2375-B left early.', A, LETTERED).recommendedProject.confirmed).toBe(false);
    // Audit A9 pass 11 F1: a spaced capital with a word after it is the
    // letter when it makes a project's identifier, so "2375 B left" names
    // 2375B Main and the note is no longer pre-confirmed on 2375A (pass 10
    // L1 had accepted it as 2375A's own 2375).
    expect(noteDraft('Crew at 2375 B left early.', A, LETTERED).recommendedProject.confirmed).toBe(false);
  });

  it('"Mark 2375 framing complete" on 2375A offers 2375 Main St\'s task', async () => {
    const tasks: Task[] = [
      { id: 'task-a', projectName: A, taskName: 'Framing' },
      { id: 'task-main', projectName: MAIN, taskName: 'Framing' },
    ];
    const h = talkHarness(WITH_MAIN, [], A, tasks);
    await h.handleTalkInput('Mark 2375 framing complete');
    expect(h.alert).not.toHaveBeenCalled();
    expect(h.taskActions).toHaveLength(1);
    expect(h.taskActions[0].projectName).toBe(MAIN);
    expect(h.taskActions[0].candidates.map(task => task.id)).toEqual(['task-main']);
  });
});

describe('audit A9 pass 9 L2: "PM" after a number is not read as a clock time', () => {
  it.each([
    ['Who is the 1130 PM?', '1130 Pine', '1130'],
    ['Is the 730 PM on site today?', '730 Bay', '730'],
    ['Is the 730 pm on site today?', '730 Bay', '730'],
    // Accepted policy refusals: a colon-less time is a project number too.
    ['Will the crew arrive at 730am?', '730 Bay', '730'],
    ['Is the walkthrough at 1130 p.m.?', '1130 Pine', '1130'],
  ])('"%s" is refused when "%s" is another project', (question, project, number) => {
    expect(desktop(question, [SELECTED, project])).toBe(switchOnDesktop(number));
    expect(mentionedDAVEProject(question, [SELECTED, project])).toBe(project);
    expect(phone(question, [SELECTED], [project])).toBe(
      `Project 2321 is selected, but ${number} is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.`,
    );
  });

  it.each([
    ['Will the crew arrive at 7:30am?', '730 Bay'],
    ['Will the crew arrive at 7:30 pm?', '730 Bay'],
    ['Is the walkthrough at 11:30 p.m.?', '1130 Pine'],
    ['Is the pour at 0730 hrs?', '0730 Night Works'],
  ])('"%s" is still a clock time with "%s" another project', (question, project) => {
    expect(desktop(question, [SELECTED, project])).toBeNull();
    expect(mentionedDAVEProject(question, [SELECTED, project])).toBeNull();
  });
});

describe('audit A9 pass 9 L3: a closed one-word project name after on/of/about/to/from/with, or as the subject, names it', () => {
  const talkReopen = (closed: string) =>
    `Project 2321 is selected, but ${closed} is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.`;

  it.each([
    'What is left on Harbor?',
    "What's the status of Harbor?",
    'What’s the status of Harbor?',
    'How is Harbor going?',
    'Harbor is behind schedule?',
    'Is Harbor done?',
    'What do we know about Harbor?',
    'Did the crane go to Harbor?',
    'Did the crane come back from Harbor?',
    'Are we done with Harbor?',
  ])('"%s" with Harbor closed is refused in Talk', question => {
    expect(mentionedDAVEProject(question, PROJECTS, ['Harbor'])).toBeNull();
    expect(talkAnswer(question, PROJECTS, ['Harbor'])).toBe(talkReopen('Harbor'));
  });

  it.each([
    'Is the harbor crane down?',
    'Is the main electrical done?',
    'Did the crew finish the main line at the harbor side?',
  ])('"%s" with Harbor and Main closed is still answered', question => {
    expect(talkAnswer(question, PROJECTS, ['Harbor', 'Main'])).toBeNull();
  });

  it('a Talk task update counts a closed one-word name anywhere', async () => {
    expect(talkAnswer('Mark Harbor framing complete', PROJECTS, ['Harbor'])).toBe(talkReopen('Harbor'));
    // Accepted: an everyday word that is a closed project's name is refused in a task update.
    expect(talkAnswer('Mark main electrical complete', PROJECTS, ['Main'])).toBe(talkReopen('Main'));
    const tasks: Task[] = [{ id: 'task-2321', projectName: SELECTED, taskName: 'Framing' }];
    const h = talkHarness(PROJECTS, ['Harbor'], SELECTED, tasks);
    await h.handleTalkInput('Mark Harbor framing complete');
    expect(h.alert).toHaveBeenCalledWith('One detail needed', talkReopen('Harbor'));
    expect(h.taskActions).toEqual([]);
  });

  it('a note keeps the earlier rule: the everyday word alone is pre-confirmed', () => {
    expect(noteDraft('The main electrical is done.', SELECTED, PROJECTS, ['Main']).recommendedProject.confirmed).toBe(true);
  });
});

describe('audit A9 pass 9 L4: in a feet-inch pair the inches are one or two digits', () => {
  it.each([
    'Is it 12\' 2375"?',
    'Is it 12\'-2375"?',
    'Is it 12’2375”?',
    'He wrote "set the sleeve at 12\'-2375" above grade" today?',
  ])('"%s" names 2375', question => {
    expect(desktop(question, PROJECTS)).toBe(switchOnDesktop('2375'));
    expect(mentionedDAVEProject(question, PROJECTS)).toBe(OTHER);
  });

  it.each([
    'Is the run 2375\'-6" long?',
    'Is the run 2375\' 11.5" long?',
    'Is the run 2375’-10” long?',
    'Is the run 2375′ 6″ long?',
  ])('"%s" is still a measurement', question => {
    expect(desktop(question, PROJECTS)).toBeNull();
    expect(mentionedDAVEProject(question, PROJECTS)).toBeNull();
  });
});

describe('audit A9 pass 9 L5: a glued "A" after a project\'s number is never amps', () => {
  const A_STREET = '2375 A Street';
  const PHASE = '2375A Phase 2';

  it('"Is 2375A done?" names "2375 A Street"', () => {
    expect(desktop('Is 2375A done?', [SELECTED, A_STREET])).toBe(switchOnDesktop('2375'));
    expect(mentionedDAVEProject('Is 2375A done?', [SELECTED, A_STREET])).toBe(A_STREET);
    expect(desktop('Is 2375A done?', [SELECTED], [A_STREET])).toBe(
      'Project 2321 is selected, but 2375 is a closed project. Reopen it in the Vitruvius iPhone or iPad app, then select it above and ask again.',
    );
  });

  it('"2375 A Street" and "2375A Phase 2" do not collide: a glued "2375A" names 2375A', () => {
    expect(desktop('Is 2375A done?', [SELECTED, A_STREET, PHASE])).toBe(switchOnDesktop('2375A'));
    expect(mentionedDAVEProject('Is 2375A done?', [SELECTED, A_STREET, PHASE])).toBe(PHASE);
    expect(desktop('Is 2375A done?', [SELECTED, A_STREET, PHASE], [], PHASE)).toBeNull();
    expect(desktop('Is 2375A done?', [SELECTED, A_STREET, PHASE], [], A_STREET)).toBe(switchOnDesktop('2375A', '2375'));
    expect(desktop('Is 2375 done?', [SELECTED, A_STREET, PHASE], [], A_STREET)).toBeNull();
    // Audit A9 pass 10 L1: "2375 A Street" is that project's own name, no
    // longer read as 2375A, so it is answered on 2375 A Street (was refused).
    expect(desktop('Is 2375 A Street done?', [SELECTED, A_STREET, PHASE], [], A_STREET)).toBeNull();
  });

  it('amps after a project\'s number are written as a word; "200A" names the project (accepted)', () => {
    expect(desktop('Is the breaker 200A?', [SELECTED, '200 Oak Street'])).toBe(switchOnDesktop('200'));
    expect(desktop('Is the breaker 200 amps?', [SELECTED, '200 Oak Street'])).toBeNull();
    expect(desktop('Is the breaker 200 amp?', [SELECTED, '200 Oak Street'])).toBeNull();
    // A number that is no project's is never refused, glued A or not.
    expect(desktop('Is the breaker 400A?', [SELECTED, '200 Oak Street'])).toBeNull();
  });
});
