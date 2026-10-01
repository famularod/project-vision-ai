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
import { confirmCaptureMemory, type DAVECaptureMemory } from '../../services/DAVECaptureMemory';
import { buildProjectIntelligence } from '../../services/DAVEIntelligence';
import { createTalkSession } from '../../hooks/use-talk-session';

// Whole-app audit A11 pass 7 L3 (30 Sep 2026): since audit A9 pass 6 L6 a
// Talk note naming a closed project and an open project's number stayed on
// the current project, already confirmed ("Riverside Clinic crew moving to
// 2375 tomorrow" with Riverside Clinic closed, "Crew from 4410 moves to 2375
// tomorrow." with 4410 closed). Before, it moved to 2375. Now a note naming
// exactly one open project moves to it (closed ones named alongside do not
// block that), and a note naming any project other than the current one is
// never pre-confirmed when it does not move: David chooses in Confirm Memory.
// Synthetic project names.

const SELECTED = '2321 Compliance Project';
const OTHER = '2375 Compliance Project';
const PROJECTS = [SELECTED, OTHER];
const RIVERSIDE = 'Riverside Clinic';
const OLD_YARD = '4410 Old Yard';

describe('A11 pass 7 L3: a note naming one open project moves to it, closed ones alongside or not', () => {
  it.each([
    ['Riverside Clinic crew moving to 2375 tomorrow, bring the lift.', [RIVERSIDE]],
    ['Crew from 4410 moves to 2375 tomorrow.', [OLD_YARD]],
    ['Crew from 4410 and Riverside Clinic moves to 2375 tomorrow.', [OLD_YARD, RIVERSIDE]],
    ['Crew from 4410 moves to 2375 Compliance Project tomorrow.', [OLD_YARD]],
  ])('"%s" moves to 2375', (note, closed) => {
    expect(mentionedDAVEProject(note, PROJECTS, closed)).toBe(OTHER);
  });

  it('a question naming a closed and an open project still asks which (no move)', () => {
    expect(mentionedDAVEProject('Is the crew from 4410 at 2375?', PROJECTS, [OLD_YARD])).toBeNull();
  });

  it('a note naming two open projects keeps the earlier rule (the one named in full, else stay)', () => {
    const MAIN = '100 Main Street';
    expect(mentionedDAVEProject('Framing at 100 Main Street is done, 2375 is next', [SELECTED, MAIN, OTHER], [OLD_YARD])).toBe(MAIN);
    expect(mentionedDAVEProject('Crew from 2321 moves to 2375 tomorrow.', PROJECTS, [OLD_YARD])).toBeNull();
  });
});

function draftFor(note: string, current: string, open: readonly string[], closed: readonly string[]) {
  const projectName = mentionedDAVEProject(note, open, closed) || current;
  return buildDAVETalkMemoryDraft({
    id: 'talk-memory-1',
    createdAt: '2026-09-30T12:00:00.000Z',
    projectName,
    switchedProject: projectName !== current,
    projectNames: open,
    closedProjectNames: closed,
    transcript: note,
    fields: { generalMemory: note },
  });
}

function expectNeedsProjectChoice(draft: DAVECaptureMemory, project: string) {
  expect(draft.recommendedProject).toMatchObject({ value: project, confirmed: false, confidence: 'medium' });
  expect(() => confirmCaptureMemory(draft, '2026-09-30T12:01:00.000Z')).toThrow('Project confirmation is required.');
}

describe('A11 pass 7 L3: a note naming another project is not pre-confirmed when it stays', () => {
  it.each([
    ['Riverside Clinic crew is done for the week.', [RIVERSIDE]],
    ['Crew from 4410 moves to 2321 tomorrow.', [OLD_YARD]],
    ['Crew from 2321 moves to 2375 tomorrow.', [OLD_YARD]],
  ])('"%s" stays on 2321 for David to choose', (note, closed) => {
    expectNeedsProjectChoice(draftFor(note, SELECTED, PROJECTS, closed), SELECTED);
  });

  it('a note that moves to the one open project named is not pre-confirmed either', () => {
    expectNeedsProjectChoice(draftFor('Crew from 4410 moves to 2375 tomorrow.', SELECTED, PROJECTS, [OLD_YARD]), OTHER);
  });

  it.each([
    'Drywall crew will finish level two on Friday',
    'The gate code is 2321, tell the crew',
    'Ordered 2375 feet of conduit',
  ])('"%s" names no other project and stays confirmed', note => {
    const draft = draftFor(note, SELECTED, PROJECTS, [OLD_YARD, RIVERSIDE]);
    expect(draft.recommendedProject).toMatchObject({ value: SELECTED, confirmed: true, confidence: 'high' });
  });

  it('without the project lists the draft is built as before', () => {
    const draft = buildDAVETalkMemoryDraft({
      id: 'talk-memory-1',
      createdAt: '2026-09-30T12:00:00.000Z',
      projectName: SELECTED,
      switchedProject: false,
      transcript: 'Riverside Clinic crew is done for the week.',
      fields: {},
    });
    expect(draft.recommendedProject.confirmed).toBe(true);
  });
});

// App.tsx's own handleTalkInput, compiled from the source with the real Talk
// services (as in audit-a9-pass6-project-numbers.test.ts), so the project
// lists really reach the draft.
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

const intelligenceFor = (projectName: string) => buildProjectIntelligence({
  projectId: `project-${projectName}`,
  projectName,
  now: '2026-09-30T12:00:00.000Z',
  updates: [],
  documents: [],
  scheduleItems: [],
} as unknown as Parameters<typeof buildProjectIntelligence>[0]);

function talkHarness(open: readonly string[], closed: readonly string[]) {
  const projectNames: string[] = [];
  const drafts: DAVECaptureMemory[] = [];
  const deps: Record<string, unknown> = {
    setTalkAnswer: jest.fn(),
    Alert: { alert: jest.fn() },
    talkSession: createTalkSession(),
    talkHistoryPersistence: { append: async () => undefined },
    mentionedDAVEProject,
    reportAvailableProjectNames: open,
    ecosProjectQuestion: { closedProjectNames: closed },
    talkProjectName: SELECTED,
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
    setTalkCaptureDraft: (draft: DAVECaptureMemory) => drafts.push(draft),
  };
  const js = ts.transpileModule(
    [appFunction('persistTalkAnswer'), appFunction('handleTalkInput'), 'module.exports = { handleTalkInput };'].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const mod = { exports: {} as { handleTalkInput: (transcript: string) => Promise<void> } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return { handleTalkInput: mod.exports.handleTalkInput, projectNames, drafts };
}

describe('A11 pass 7 L3: App.tsx Talk notes', () => {
  it('"Riverside Clinic crew moving to 2375 tomorrow" (Riverside closed) moves to 2375 for confirmation', async () => {
    const h = talkHarness(PROJECTS, [RIVERSIDE]);
    await h.handleTalkInput('Riverside Clinic crew moving to 2375 tomorrow, bring the lift.');
    expect(h.projectNames).toEqual([OTHER]);
    expect(h.drafts.at(-1)?.recommendedProject).toMatchObject({ value: OTHER, confirmed: false });
  });

  it('"Crew from 4410 moves to 2375 tomorrow." (4410 closed) moves to 2375 for confirmation', async () => {
    const h = talkHarness(PROJECTS, [OLD_YARD]);
    await h.handleTalkInput('Crew from 4410 moves to 2375 tomorrow.');
    expect(h.projectNames).toEqual([OTHER]);
    expect(h.drafts.at(-1)?.recommendedProject).toMatchObject({ value: OTHER, confirmed: false });
  });

  it('a note naming only a closed project stays on 2321, not pre-confirmed', async () => {
    const h = talkHarness(PROJECTS, [RIVERSIDE]);
    await h.handleTalkInput('Riverside Clinic crew is done for the week.');
    expect(h.projectNames).toEqual([SELECTED]);
    expect(h.drafts.at(-1)?.recommendedProject).toMatchObject({ value: SELECTED, confirmed: false });
  });

  it('a note about 2321 alone is still pre-confirmed', async () => {
    const h = talkHarness(PROJECTS, [RIVERSIDE]);
    await h.handleTalkInput('Drywall crew will finish level two on Friday');
    expect(h.drafts.at(-1)?.recommendedProject).toMatchObject({ value: SELECTED, confirmed: true });
  });
});
