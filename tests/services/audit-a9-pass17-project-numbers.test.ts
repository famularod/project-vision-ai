import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectRefusal';
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

// Audit A9 pass 17 L1 (1 Oct 2026): owner answer Q20 refuses a question that
// names another known project's number and never the selected project's own.
// When unsure, refuse. Since pass 16 L2, Talk moved to a lettered job ("400N
// Tower") that Ask ECOS on that job would refuse the same question on (there
// the letter gives way to the "24117 - 400 N Main St" address), then refused
// it there and stayed on it; a note was pre-filled to it. Talk now never
// moves to a project on which Ask ECOS would refuse the question; it refuses
// on the current project in Ask ECOS's words. Synthetic project names.

const SELECTED = '2321 Compliance Project';
const MAIN = '24117 - 400 N Main St';
const TOWER = '400N Tower';
const A_STREET = '24117 - 2375 A Street';
const PHASE = '2375A Phase 2';

const phone = (question: string, known: readonly string[], closed: readonly string[] = [], selected = SELECTED) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { closedProjectNames: closed, refusalWording: 'phone' });
const switchOnPhone = (number: string, selected = '2321') =>
  `Project ${selected} is selected, but this question names ${number}. Close this, open project ${number}, then ask again.`;

const intelligenceFor = (projectName: string) => buildProjectIntelligence({
  projectId: `project-${projectName}`,
  projectName,
  now: '2026-10-01T12:00:00.000Z',
  updates: [],
  documents: [],
  scheduleItems: [],
} as unknown as Parameters<typeof buildProjectIntelligence>[0]);

// App.tsx's own handleTalkInput, compiled from the source with the real Talk
// services (as in audit-a9-pass8-project-numbers.test.ts), opened on
// `talkProjectName`.
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

type Draft = { recommendedProject: { value: string; confirmed: boolean } };

function talkHarness(open: readonly string[], closed: readonly string[], talkProjectName: string) {
  const projectNames: string[] = [];
  const shown: Array<{ projectName: string } | null> = [];
  const drafts: Draft[] = [];
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
    setTalkCaptureDraft: (draft: Draft) => drafts.push(draft),
    authoritativeScheduleItems: [],
    scheduleTasksForParentProject: () => [],
    findDAVETaskCandidates,
    setTalkTaskAction: jest.fn(),
    navigateFromTalk: jest.fn(),
  };
  const js = ts.transpileModule(
    [appFunction('persistTalkAnswer'), appFunction('handleTalkInput'), 'module.exports = { handleTalkInput };'].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const mod = { exports: {} as { handleTalkInput: (transcript: string) => Promise<void> } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return { handleTalkInput: mod.exports.handleTalkInput, projectNames, shown, drafts, alert };
}

/** Talk in App.tsx on `current`: the project it ends on, what it says instead of answering, and any note draft. */
async function talk(transcript: string, current: string, open: readonly string[], closed: readonly string[] = []) {
  const h = talkHarness(open, closed, current);
  await h.handleTalkInput(transcript);
  const refusal = h.alert.mock.calls.find(([title]) => title === 'One detail needed')?.[1] ?? null;
  return { projects: h.projectNames, refusal, answered: h.shown.length > 0, draft: h.drafts.at(-1)?.recommendedProject ?? null };
}

describe('audit A9 pass 17 L1: Talk never moves to a project on which Ask ECOS would refuse the question', () => {
  const PROJECTS = [SELECTED, MAIN, TOWER];

  it('on 2321, "What is left at 400 N?" stays on 2321 and refuses in Ask ECOS\'s words (moved to 400N Tower, then refused there)', async () => {
    const question = 'What is left at 400 N?';
    expect(phone(question, PROJECTS, [], TOWER)).not.toBeNull();
    expect(mentionedDAVEProject(question, PROJECTS, [], SELECTED)).toBeNull();
    const result = await talk(question, SELECTED, PROJECTS);
    expect(result.projects).toEqual([SELECTED]);
    expect(result.refusal).toBe(phone(question, PROJECTS));
    expect(result.refusal).toBe(switchOnPhone('400N'));
    expect(result.answered).toBe(false);
  });

  it('on 24117 - 400 N Main St, "What is left at 400 N Main St?" stays there (moved to 400N Tower, which pointed back to it)', async () => {
    const question = 'What is left at 400 N Main St?';
    const result = await talk(question, MAIN, PROJECTS);
    expect(result.projects).toEqual([MAIN]);
    // the recorded Q27 circle: on this job, with 400N Tower open, Ask ECOS reads 400 N as 400N
    expect(result.refusal).toBe(phone(question, PROJECTS, [], MAIN));
    expect(result.refusal).toBe(switchOnPhone('400N', '24117'));
    expect(result.answered).toBe(false);
  });

  it('the note "Crew finished framing at 400 N Main St today" on the N Main job stays there, not pre-confirmed (was pre-filled to 400N Tower)', async () => {
    const note = 'Crew finished framing at 400 N Main St today';
    expect(mentionedDAVEProject(note, PROJECTS, [], MAIN)).toBeNull();
    const result = await talk(note, MAIN, PROJECTS);
    expect(result.projects).toEqual([MAIN]);
    expect(result.draft).toMatchObject({ value: MAIN, confirmed: false });
  });

  it('the same with "24117 - 2375 A Street" and "2375A Phase 2"', async () => {
    const projects = [SELECTED, A_STREET, PHASE];
    const onSelected = await talk('What is left at 2375 A?', SELECTED, projects);
    expect(onSelected.projects).toEqual([SELECTED]);
    expect(onSelected.refusal).toBe(switchOnPhone('2375A'));
    const onStreet = await talk('What is left at 2375 A Street?', A_STREET, projects);
    expect(onStreet.projects).toEqual([A_STREET]);
    expect(onStreet.refusal).toBe(phone('What is left at 2375 A Street?', projects, [], A_STREET));
    const note = await talk('Crew finished framing at 2375 A Street today', A_STREET, projects);
    expect(note.projects).toEqual([A_STREET]);
    expect(note.draft).toMatchObject({ value: A_STREET, confirmed: false });
  });

  it('Talk still moves to a lettered job that Ask ECOS answers the question on', async () => {
    const projects = [SELECTED, A_STREET, PHASE];
    expect(phone('Is 2375A done?', projects, [], PHASE)).toBeNull();
    const question = await talk('Is 2375A done?', SELECTED, projects);
    expect(question.projects).toEqual([PHASE]);
    expect(question.refusal).toBeNull();
    expect(question.answered).toBe(true);
    const note = await talk('Crew finished framing at 2375 A today', SELECTED, projects);
    expect(note.projects).toEqual([PHASE]);
    expect(note.draft).toMatchObject({ value: PHASE, confirmed: false });
  });

  it('the selected project named itself is no move', () => {
    expect(mentionedDAVEProject('Is 2375A done?', [SELECTED, A_STREET, PHASE], [], PHASE)).toBe(PHASE);
  });

  it('a task update stays and is refused in Ask ECOS\'s words; with no project selected, a question stays too', async () => {
    const update = await talk('Mark 400 N Main St framing complete', SELECTED, PROJECTS);
    expect(update.projects).toEqual([SELECTED]);
    expect(update.refusal).toBe(switchOnPhone('400N'));
    const none = await talk('What is left at 400 N?', '', PROJECTS);
    expect(none.projects).toEqual(['']);
    expect(none.refusal).toBe('No project is selected, and this question names 400N. Close this, open project 400N, then ask again.');
  });

  it('a note naming a closed project too stays when Ask ECOS on the target reads another project ("400 N Main St")', async () => {
    const note = 'Crew from 4410 finished framing at 400 N Main St today';
    const result = await talk(note, MAIN, PROJECTS, ['4410 Old Yard']);
    expect(result.projects).toEqual([MAIN]);
    expect(result.draft).toMatchObject({ value: MAIN, confirmed: false });
  });

  it('a note naming a closed project and one open project still moves there for confirmation (A11 pass 7 L3, unchanged)', async () => {
    const result = await talk('Crew from 4410 moves to 2375 tomorrow.', SELECTED, [SELECTED, '2375 Compliance Project'], ['4410 Old Yard']);
    expect(result.projects).toEqual(['2375 Compliance Project']);
    expect(result.draft).toMatchObject({ value: '2375 Compliance Project', confirmed: false });
  });

  it('"Open ..." is not a question and moves as before', () => {
    expect(mentionedDAVEProject('Open 400 N', PROJECTS, [], SELECTED)).toBe(TOWER);
  });

  // The rule over a grid of jobs, questions and notes: wherever Talk moves,
  // Ask ECOS on that project answers the same words.
  const GRIDS: Array<readonly string[]> = [
    [SELECTED, MAIN, TOWER],
    [SELECTED, A_STREET, PHASE],
    [SELECTED, MAIN, TOWER, A_STREET, PHASE],
  ];
  const TRANSCRIPTS = [
    'What is left at 400 N?', 'What is left at 400 N Main St?', 'Is 400 N. Main done?', 'Is 400N done?',
    'What is left at 2375 A?', 'What is left at 2375 A Street?', 'Is 2375A done?', 'Is 2375 A Phase 2 done?',
    'Crew finished framing at 400 N Main St today', 'Crew finished framing at 400 N today',
    'Crew finished framing at 2375 A Street today', 'Crew finished framing at 2375 A today',
  ];
  it('over a grid of jobs, questions and notes, Talk moves only where Ask ECOS answers', () => {
    const refusedWhereMoved = GRIDS.flatMap(open => open.flatMap(current => TRANSCRIPTS.flatMap(text => {
      const moved = mentionedDAVEProject(text, open, [], current);
      return moved && moved !== current && phone(text, open, [], moved) !== null ? [`"${text}" on ${current} -> ${moved}`] : [];
    })));
    expect(refusedWhereMoved).toEqual([]);
  });
});
