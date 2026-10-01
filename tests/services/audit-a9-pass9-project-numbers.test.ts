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

  it.each(['What is left at 2375 B?', 'What is left at 2375-B?', 'What is left at 2375 b?'])(
    '"%s" names 2375B when it is another project',
    question => {
      expect(desktop(question, LETTERED, [], A)).toBe(switchOnDesktop('2375B', '2375A'));
      expect(desktop(question, LETTERED)).toBe(switchOnDesktop('2375B'));
      // Talk reads it as 2375B and as a bare 2375 (2375A's own digits), so it asks which.
      expect(talkAnswer(question, LETTERED, [], A)).toBe(
        'This question names two projects, 2375A and 2375B. Which one do you mean? Ask again about just that project.',
      );
      expect(mentionedDAVEProject(question, LETTERED)).toBeNull();
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
