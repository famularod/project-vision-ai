/**
 * Whole-app audit A9 pass 2 F1/F2/F3 (30 Sep 2026): Talk answered a follow-up
 * from any saved answer of the project from the last 30 days, one the owner
 * had not been shown since opening Talk, and a quick follow-up could use an
 * answer older than the one on screen. "Ask in Ask ECOS" sent a follow-up's
 * bare words. "And the schedule" without "?" became a note. Runs App.tsx's
 * own openTalk, persistTalkAnswer, handleTalkInput and
 * openTalkSupportingEvidence, compiled from the source, with the real Talk
 * services. Synthetic project data only.
 */
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
import type { DAVEAskAnswer, DAVEAskEvidence } from '../../services/DAVEAsk';
import type { DAVEAskConversationEntry } from '../../services/DAVEAskConversation';
import { buildProjectIntelligence } from '../../services/DAVEIntelligence';
import { ecosDocumentProofClaimFromEvidence } from '../../services/ECOSDocumentProofAuthority';
import { createTalkSession } from '../../hooks/use-talk-session';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** A function declared at the given indent of App.tsx (component scope is two spaces), brace-matched. */
function appFunction(name: string, indent = '  '): string {
  const match = new RegExp(`\\n${indent}(?:async )?function ${name}\\(`).exec(app);
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

const PROJECT = 'Garage';
const PROJECT_ID = 'project-garage';
type TalkAnswer = { projectName: string; question: string; answer: DAVEAskAnswer; askECOSQuestion: string | null };
type Button = { text: string; style?: string; onPress?: () => void };

const intelligence = buildProjectIntelligence({
  projectId: PROJECT_ID,
  projectName: PROJECT,
  now: new Date().toISOString(),
  updates: [],
  documents: [],
  scheduleItems: [],
} as unknown as Parameters<typeof buildProjectIntelligence>[0]);

// An answer the owner was never shown in this Talk session, saved last week.
const savedAnswer: DAVEAskAnswer = {
  answer: 'OLD SAVED ANSWER: the controls startup is overdue.',
  confidence: 'high',
  limitations: [],
  supportingEvidence: [{ sourceType: 'schedule', recordId: 'old-task', summary: 'Controls startup overdue.', timelineEventId: null }],
  timelineReferences: [],
  recommendedNextAction: null,
  navigationTargets: [],
};
const savedEntry: DAVEAskConversationEntry = {
  id: 'saved-1', projectId: PROJECT_ID, question: 'What is overdue?', answer: savedAnswer,
  createdAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
};

const talkDocument: DAVEAskEvidence = {
  sourceType: 'document',
  recordId: 'drawing-a101',
  summary: 'Architectural drawings, Sheet A101',
  timelineEventId: null,
  excerpt: 'Provide galvanized steel guardrails at all open parking edges.',
  documentCitation: {
    documentId: 'drawing-a101', documentName: 'Architectural drawings', revision: '2',
    pageNumber: 3, sheetNumber: 'A101', regionId: 'a101-note-7', label: 'Architectural drawings, Sheet A101',
  },
};

function harness({ cloudRecord = true, saveNeverFinishes = false } = {}) {
  const talkSession = createTalkSession();
  const alert = jest.fn();
  const answers: Array<TalkAnswer | null> = [];
  const searched: string[] = [];
  const append = jest.fn(() => saveNeverFinishes ? new Promise<void>(() => undefined) : Promise.resolve());
  const read = jest.fn(async () => [savedEntry]);
  const askFor = jest.fn(() => cloudRecord);
  const setTalkCaptureDraft = jest.fn();
  let id = 0;
  const deps: Record<string, unknown> = {
    recordTalkAnswer: (value: TalkAnswer | null) => answers.push(value),
    Alert: { alert },
    talkSession,
    talkHistoryPersistence: { read, append },
    talkContextProjectForScreen: () => PROJECT,
    screen: 'Home',
    selectedWorkspaceProject: PROJECT,
    selectedReportProjectNames: [],
    setTalkProjectName: jest.fn(),
    setTalkTaskId: jest.fn(),
    setTalkTypedOpen: jest.fn(),
    setTalkVoiceOpen: jest.fn(),
    setTalkCaptureDraft,
    // No kept Confirm Memory sheet (audit A11 pass 1 F8 added this to openTalk).
    keptTalkCapture: { reopen: () => false, keep: jest.fn() },
    setTalkTaskAction: jest.fn(),
    navigateFromTalk: jest.fn(),
    mentionedDAVEProject,
    reportAvailableProjectNames: [PROJECT],
    talkProjectName: PROJECT,
    talkTaskId: null,
    authorityProjectId: () => PROJECT_ID,
    uid: () => `id-${(id += 1)}`,
    resolveDAVEConversationContext,
    answerDAVEConversationContext,
    askECOSQuestionForTalk,
    routeDAVEConversation,
    buildDAVETalkMemoryDraft,
    loadECOSTalkReferenceDocuments: async ({ question }: { question: string }) => { searched.push(question); return []; },
    getSupabaseClient: () => ({}),
    referenceDocuments: [],
    projectIntelligenceForTalk: () => intelligence,
    reportTalkAnswerPersistenceFailure: jest.fn(),
    ecosDocumentProofClaimFromEvidence,
    ecosDocumentEvidence: { openEvidence: jest.fn() },
    ecosProjectQuestion: { askFor, canAskFor: () => cloudRecord },
  };
  const js = ts.transpileModule([
    'let talkAnswer = null;',
    'function setTalkAnswer(value) { talkAnswer = value; recordTalkAnswer(value); }',
    appFunction('openTalk'),
    appFunction('persistTalkAnswer'),
    appFunction('handleTalkInput'),
    appFunction('openTalkSupportingEvidence'),
    'module.exports = { openTalk, handleTalkInput, openTalkSupportingEvidence, current: () => talkAnswer };',
  ].join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} as {
    openTalk: () => void;
    handleTalkInput: (transcript: string) => Promise<void>;
    openTalkSupportingEvidence: (projectName: string, citation: DAVEAskEvidence) => void;
    current: () => TalkAnswer | null;
  } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return { ...mod.exports, alert, answers, searched, append, read, askFor, setTalkCaptureDraft, talkSession };
}

async function say(h: ReturnType<typeof harness>, transcript: string) {
  await h.handleTalkInput(transcript);
  return h.current();
}

describe('Talk previous answer = this Talk session (audit A9 pass 2 F1b)', () => {
  it('"Why?" right after opening Talk asks for the detail; it never reads older saved answers', async () => {
    const h = harness();
    h.openTalk();
    await say(h, 'Why?');
    expect(h.alert).toHaveBeenCalledWith('One detail needed', 'What project information are you referring to?');
    expect(h.read).not.toHaveBeenCalled();
    expect(h.answers.filter(Boolean)).toEqual([]);
  });

  it('a pronoun question right after opening Talk is answered as asked, not from an old saved answer', async () => {
    const h = harness();
    h.openTalk();
    const answer = await say(h, 'Why is this wall cracked?');
    expect(answer!.answer.answer).not.toContain('OLD SAVED ANSWER');
    expect(answer!.answer.answer).not.toMatch(/previous answer/);
    expect(h.searched).toEqual(['Why is this wall cracked?']);
  });

  it('"Talk Again" stays in the session; opening Talk again starts a new one', async () => {
    const h = harness();
    h.openTalk();
    await say(h, 'What is overdue?');
    const first = h.current()!.answer.answer;
    // "Talk Again" only reopens the voice sheet, so the session continues.
    expect((await say(h, 'Why?'))!.answer.answer).toBe(
      `My previous answer was: ${first} The cited records and limitations below were the basis for that answer.`,
    );
    h.openTalk();
    await say(h, 'Why?');
    expect(h.alert).toHaveBeenCalledWith('One detail needed', 'What project information are you referring to?');
  });

  it('each answer joins the session before its save finishes, so a quick "Why?" explains the answer on screen', async () => {
    const h = harness({ saveNeverFinishes: true });
    h.openTalk();
    await say(h, 'What changed?');
    await say(h, 'What is overdue?');
    const shown = h.current()!.answer.answer;
    const why = await say(h, 'Why?');
    expect(why!.answer.answer.startsWith(`My previous answer was: ${shown}`)).toBe(true);
    expect(h.append).toHaveBeenCalledTimes(3); // every answer is still saved
  });
});

describe('follow-ups in one Talk session (audit A9 pass 2 F1a/c/d, F3)', () => {
  it('"Why?" after "Show me the evidence" explains the original answer without nesting', async () => {
    const h = harness();
    h.openTalk();
    const original = (await say(h, 'What is overdue?'))!.answer.answer;
    expect((await say(h, 'Show me the evidence'))!.answer.answer).toContain(original);
    const why = (await say(h, 'Why?'))!.answer.answer;
    expect(why.startsWith(`My previous answer was: ${original}`)).toBe(true);
    expect(why).not.toContain('These are the records');
    const evidence = (await say(h, 'Show me the evidence'))!.answer.answer;
    expect(evidence).not.toContain('My previous answer was');
    expect(evidence).toContain(original);
  });

  it('the document search sees the owner\'s own words for a pronoun question', async () => {
    const h = harness();
    h.openTalk();
    await say(h, 'What is overdue?');
    const answer = await say(h, 'What guardrail protection is required at this parking edge?');
    expect(h.searched[1]).toBe('What guardrail protection is required at this parking edge?');
    expect(answer!.question).toBe('What guardrail protection is required at this parking edge?');
    expect(answer!.answer.answer).not.toMatch(/previous (?:answer|question)/);
  });

  it('"And the drywall?" keeps drywall in the question searched and answered', async () => {
    const h = harness();
    h.openTalk();
    await say(h, 'What is overdue?');
    await say(h, 'And the drywall?');
    expect(h.searched[1]).toBe('What is overdue? And the drywall?');
    await say(h, 'What about the ramp?');
    expect(h.searched[2]).toBe('What is overdue? What about the ramp?');
  });

  it.each(['And the schedule', 'Also the inspections'])('"%s" without "?" is answered after an answer, and a note otherwise', async input => {
    const h = harness();
    h.openTalk();
    await say(h, input);
    expect(h.setTalkCaptureDraft).toHaveBeenCalledTimes(1);
    expect(h.current()).toBeNull();
    h.setTalkCaptureDraft.mockClear();
    await say(h, 'What is overdue?');
    const answer = await say(h, input);
    expect(h.setTalkCaptureDraft).not.toHaveBeenCalled();
    expect(answer!.question).toBe(input);
  });

  it('a field note starting with "And" is still a note after an answer', async () => {
    const h = harness();
    h.openTalk();
    await say(h, 'What is overdue?');
    await say(h, 'And the drywall crew finished level two');
    expect(h.setTalkCaptureDraft).toHaveBeenCalledTimes(1);
  });
});

describe('"Ask in Ask ECOS" from a Talk answer (audit A9 pass 2 F2/F4)', () => {
  const tapAsk = (h: ReturnType<typeof harness>) => {
    h.openTalkSupportingEvidence(PROJECT, talkDocument);
    const call = h.alert.mock.calls[h.alert.mock.calls.length - 1];
    return { message: call[1] as string, buttons: (call[2] || []) as Button[] };
  };

  it.each([
    ['Show me the evidence'],
    ['Why?'],
    ['Why is that?'],
  ])('"%s" sends the question it follows, quoted in the alert', async followUp => {
    const h = harness();
    h.openTalk();
    await say(h, 'What guardrail protection is required at the parking edge?');
    await say(h, followUp);
    expect(h.current()!.askECOSQuestion).toBe('What guardrail protection is required at the parking edge?');
    const { message, buttons } = tapAsk(h);
    expect(message).toContain('“What guardrail protection is required at the parking edge?”');
    buttons.find(button => button.text === 'Ask in Ask ECOS')!.onPress!();
    expect(h.askFor).toHaveBeenCalledWith(PROJECT, 'What guardrail protection is required at the parking edge?');
    expect(h.current()).toBeNull();
  });

  it('"Why?" after "Show me the evidence" still sends the original question', async () => {
    const h = harness();
    h.openTalk();
    await say(h, 'What guardrail protection is required at the parking edge?');
    await say(h, 'Show me the evidence');
    await say(h, 'Why?');
    expect(h.current()!.askECOSQuestion).toBe('What guardrail protection is required at the parking edge?');
  });

  it('a follow-up that is not the owner\'s full question asks him to type it, with no automatic question', async () => {
    const h = harness();
    h.openTalk();
    await say(h, 'What is overdue?');
    await say(h, 'What next?');
    expect(h.current()!.askECOSQuestion).toBeNull();
    const { message, buttons } = tapAsk(h);
    expect(message).toContain('Ask the full question in Ask ECOS');
    expect(buttons.map(button => button.text)).not.toContain('Ask in Ask ECOS');
    expect(h.askFor).not.toHaveBeenCalled();
    expect(h.current()).not.toBeNull();
  });

  it('a project with no cloud record is not offered Ask in Ask ECOS and keeps the Talk answer', async () => {
    const h = harness({ cloudRecord: false });
    h.openTalk();
    await say(h, 'What guardrail protection is required at the parking edge?');
    const { message, buttons } = tapAsk(h);
    expect(message).toContain('not synchronized');
    expect(buttons.map(button => button.text)).not.toContain('Ask in Ask ECOS');
    expect(h.askFor).not.toHaveBeenCalled();
    expect(h.current()).not.toBeNull();
  });
});
