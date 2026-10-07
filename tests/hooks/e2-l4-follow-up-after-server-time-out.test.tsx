/**
 * Review pass 1, L4 (older in what is sent; the sentence is from the last
 * round). When the SERVER gives up on a follow-up question (504), the sheet
 * says "Your question is still here — try again." Try Again then sent the
 * follow-up as a new conversation with no earlier turn, so "And on the south
 * side?" went out as a question on its own. After Stop, the X, or the app's
 * own time limit the earlier turn was kept.
 *
 * It is kept after a server time-out too, on the phone and iPad sheet and on
 * the desktop page: the same conversation and the same earlier turn go out.
 *
 * The real hook, the real desktop panel, the real wait and the real request
 * code, against a stand-in server that answers as scripted and records what
 * arrives. No live service is asked anything.
 */
import { FunctionsClient } from '@supabase/functions-js';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { DesktopAskECOSWorkspace } from '../../components/web-shell/desktop-ask-ecos';
import { useECOSProjectQuestionExperience } from '../../hooks/use-ecos-project-question-experience';
import { ECOS_ASK_STOPPED_MESSAGE } from '../../services/ECOSAskProgress';
import { askECOSProjectQuestion } from '../../services/ECOSProjectQuestion';
import { ECOSAskStoppedError, ecosAskConversationStands } from '../../services/ECOSAskWait';

type Body = Record<string, string>;
type Reply = Readonly<{ status: number; payload: unknown }> | 'never' | 'no connection';

const mockServer = {
  uuids: 0,
  /** What the server answers, in order; anything after the script is answered. */
  script: [] as Array<(body: Body) => Reply>,
  arrivals: [] as Body[],
  reset() { this.uuids = 0; this.script = []; this.arrivals.length = 0; },
};
function mockUuid() {
  mockServer.uuids += 1;
  return `00000000-0000-4000-8000-${String(mockServer.uuids).padStart(12, '0')}`;
}
function mockAnswer(body: Body) {
  return {
    schemaVersion: 'ecos-project-question/2.0', projectId: body.projectId, projectName: body.projectName, question: body.question,
    answer: `Answer to: ${body.question}`, confidence: 'high', facts: [], limitations: [], conflicts: [], suggestedQuestions: [],
    supportingEvidence: [], assurance: { status: 'verified', checkedSourceCount: 1, verifiedFactCount: 1, rejectedFactCount: 0, message: 'Verified.' },
    generatedAt: '2026-10-05T00:00:00.000Z', model: 'stand-in',
    diagnostics: { schemaVersion: 'ecos-question-trace/1.0', traceId: mockUuid(), clientRequestId: body.clientRequestId, clientSurface: body.clientSurface, replayed: false, persisted: true },
    conversation: { schemaVersion: 'ecos-agent-conversation-context/1.0', conversationId: body.conversationId, turnId: mockUuid(), priorTurnId: body.priorTurnId ?? null },
  };
}
function mockResponse(status: number, payload: unknown): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => { if (typeof payload === 'string') throw new Error('not JSON'); return JSON.parse(JSON.stringify(payload)); },
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    clone: () => mockResponse(status, payload),
  };
}
function mockFetch(_url: string, init: { body: string; signal?: AbortSignal }) {
  const body = JSON.parse(init.body) as Body;
  return new Promise((resolve, reject) => {
    const aborted = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    if (init.signal?.aborted) { aborted(); return; }
    init.signal?.addEventListener('abort', aborted);
    mockServer.arrivals.push(body);
    const scripted = mockServer.script.shift();
    const reply = scripted ? scripted(body) : { status: 200, payload: mockAnswer(body) };
    if (reply === 'no connection') reject(new TypeError('Network request failed'));
    else if (reply !== 'never') resolve(mockResponse(reply.status, reply.payload));
  });
}
const mockClient = {
  auth: { getSession: async () => ({ data: { session: { access_token: 'token' } }, error: null }) },
  functions: new FunctionsClient('https://project.supabase.co/functions/v1', { customFetch: mockFetch as never }),
};

jest.mock('expo-crypto', () => ({ randomUUID: () => mockUuid() }));
jest.mock('expo-router', () => ({ Link: ({ children }: { children: unknown }) => children }));
jest.mock('../../components/DAVETypedCaptureSheet', () => ({ DAVETypedCaptureSheet: () => null }));
jest.mock('../../components/DAVEVoiceCaptureSheet', () => ({ DAVEVoiceCaptureSheet: () => null }));
jest.mock('../../services/SupabaseService', () => ({ getSupabaseClient: () => mockClient }));
jest.mock('../../components/native-workspace-owner', () => ({ useNativeWorkspaceOwner: () => 'owner-one' }));

const FIRST = 'How thick is the north side concrete?';
const FOLLOW_UP = 'And on the south side?';
const RAN_OUT_OF_TIME =
  'ECOS ran out of time before it finished this question, so it stopped. ' +
  'No answer has been verified. Your question is still here — try again.';

const answered = (body: Body): Reply => ({ status: 200, payload: mockAnswer(body) });
const refused = (status: number, payload: unknown) => (): Reply => ({ status, payload });
const SERVER_GAVE_UP = refused(504, { error: 'agent_gateway_timed_out' });

/** What a request says about the conversation it belongs to. */
const turnOf = (body: Body) => ({ question: body.question, conversationId: body.conversationId, priorTurnId: body.priorTurnId ?? null });

beforeEach(() => mockServer.reset());

describe('L4, the phone and iPad sheet', () => {
  type Experience = ReturnType<typeof useECOSProjectQuestionExperience>;
  const voice = (hook: { current: Experience }) => hook.current.sheets.props.children[0].props;
  const sheet = (hook: { current: Experience }) => hook.current.sheets.props.children[2].props;
  const settle = () => act(async () => { for (let turn = 0; turn < 20; turn += 1) await Promise.resolve(); });

  function open() {
    return renderHook(() => useECOSProjectQuestionExperience({
      contextualProjectName: 'Lot 9',
      projectRecords: [{ id: 'project-lot-9', name: 'Lot 9' }] as never,
      candidateProjects: ['Lot 9'],
      onOpenEvidence: jest.fn(),
    }));
  }

  /** Asks the first question, has it answered, then asks the follow-up against the given scripted replies. */
  async function followUpAfterAnAnswer(...replies: Array<(body: Body) => Reply>) {
    mockServer.script = [answered, ...replies];
    const hook = open();
    await act(async () => { hook.result.current.open(); });
    await act(async () => { voice(hook.result).onMemoryReady({ transcript: FIRST }); });
    await settle();
    expect(sheet(hook.result).answer.answer).toBe(`Answer to: ${FIRST}`);
    await act(async () => { sheet(hook.result).onAskAnother(FOLLOW_UP); });
    await settle();
    return hook;
  }

  it.each([
    ['the gateway\'s 504', SERVER_GAVE_UP],
    ['a 504 that is not JSON (a proxy\'s page)', refused(504, '<html>504 Gateway Time-out</html>')],
    ['a code the server names as a time-out', refused(503, { error: 'dependency_timed_out' })],
  ])('after %s on a follow-up, Try Again sends it in the same conversation, after the same earlier turn (was: a new conversation, with no earlier turn)', async (_name, gaveUp) => {
    const hook = await followUpAfterAnAnswer(gaveUp);
    expect(sheet(hook.result)).toMatchObject({ loading: false, question: FOLLOW_UP, error: RAN_OUT_OF_TIME });
    const [first, timedOut] = mockServer.arrivals;
    expect(turnOf(timedOut)).toMatchObject({ question: FOLLOW_UP, conversationId: first.conversationId });
    expect(timedOut.priorTurnId).toBeTruthy();

    await act(async () => { sheet(hook.result).onRetry(); });
    await settle();
    expect(mockServer.arrivals).toHaveLength(3);
    expect(turnOf(mockServer.arrivals[2])).toEqual(turnOf(timedOut));
    expect(sheet(hook.result).answer.answer).toBe(`Answer to: ${FOLLOW_UP}`);
  });

  it('once the retried follow-up is answered, the next follow-up comes after it', async () => {
    const hook = await followUpAfterAnAnswer(SERVER_GAVE_UP);
    await act(async () => { sheet(hook.result).onRetry(); });
    await settle();
    const retriedTurnId = sheet(hook.result).answer.conversation.turnId;
    await act(async () => { sheet(hook.result).onAskAnother('And the east side?'); });
    await settle();
    expect(turnOf(mockServer.arrivals[3])).toEqual({
      question: 'And the east side?',
      conversationId: mockServer.arrivals[0].conversationId,
      priorTurnId: retriedTurnId,
    });
  });

  it('the server gives up twice running: the earlier turn is still there the third time', async () => {
    const hook = await followUpAfterAnAnswer(SERVER_GAVE_UP, SERVER_GAVE_UP);
    await act(async () => { sheet(hook.result).onRetry(); });
    await settle();
    expect(sheet(hook.result).error).toBe(RAN_OUT_OF_TIME);
    await act(async () => { sheet(hook.result).onRetry(); });
    await settle();
    expect(mockServer.arrivals.slice(1).map(turnOf)).toEqual([1, 2, 3].map(() => turnOf(mockServer.arrivals[1])));
  });

  // Guards: these already hold.
  it('after Stop, Try Again keeps the earlier turn, as before', async () => {
    const hook = await followUpAfterAnAnswer(() => 'never');
    await act(async () => { sheet(hook.result).onStop(); });
    expect(sheet(hook.result).error).toBe(ECOS_ASK_STOPPED_MESSAGE);
    await act(async () => { sheet(hook.result).onRetry(); });
    await settle();
    expect(turnOf(mockServer.arrivals[2])).toEqual(turnOf(mockServer.arrivals[1]));
  });

  it('when the server says it cannot recover the conversation, the next ask starts a new one, as before', async () => {
    const hook = await followUpAfterAnAnswer(refused(409, { error: 'conversation_turn_stale' }));
    expect(sheet(hook.result).error).toBe('ECOS could not recover the prior question for this project. Please ask again using the full question.');
    await act(async () => { sheet(hook.result).onRetry(); });
    await settle();
    const [first, , retried] = mockServer.arrivals;
    expect(retried.conversationId).not.toBe(first.conversationId);
    expect(retried.priorTurnId).toBeUndefined();
  });

  // Not changed by this fix, and pinned so that it is known: other failures still start a new conversation.
  it.each([
    ['the service is unavailable (503)', refused(503, { error: 'agent_gateway_unavailable' })],
    ['the answer could not be verified (502)', refused(502, { error: 'answer_invalid' })],
    ['the answer engine\'s own time limit', refused(503, { error: 'answer_timed_out' })],
    ['no connection ("Could not reach Ask ECOS")', (): Reply => 'no connection'],
  ])('unchanged: after %s, Try Again sends the follow-up as a new conversation', async (_name, failed) => {
    const hook = await followUpAfterAnAnswer(failed);
    await act(async () => { sheet(hook.result).onRetry(); });
    await settle();
    const [first, , retried] = mockServer.arrivals;
    expect(retried.conversationId).not.toBe(first.conversationId);
    expect(retried.priorTurnId).toBeUndefined();
  });
});

describe('L4, the desktop page', () => {
  const ask = (input: Parameters<React.ComponentProps<typeof DesktopAskECOSWorkspace>['onAsk']>[0], control?: { signal: AbortSignal; clientRequestId: string }) =>
    askECOSProjectQuestion({ client: mockClient as never, knownProjectNames: ['Lot 9'], ...input, ...control });

  async function followUpAfterAnAnswer(...replies: Array<(body: Body) => Reply>) {
    mockServer.script = [answered, ...replies];
    const screen = render(<DesktopAskECOSWorkspace ownerKey="owner" projectId="project-lot-9" projectName="Lot 9" onAsk={ask} />);
    fireEvent.changeText(screen.getByLabelText('Project question for ECOS'), FIRST);
    await act(async () => { fireEvent.press(screen.getByText('Ask ECOS')); });
    await screen.findByText(`Answer to: ${FIRST}`);
    fireEvent.changeText(screen.getByLabelText('Project question for ECOS'), FOLLOW_UP);
    await act(async () => { fireEvent.press(screen.getByText('Ask ECOS')); });
    await waitFor(() => expect(mockServer.arrivals).toHaveLength(2));
    return screen;
  }

  it('after the server gives up on a follow-up, asking again sends it in the same conversation, after the same earlier turn (was: a new conversation)', async () => {
    const screen = await followUpAfterAnAnswer(SERVER_GAVE_UP);
    await screen.findByText(RAN_OUT_OF_TIME);
    // The question is still in the box, as the sentence says.
    expect(screen.getByLabelText('Project question for ECOS').props.value).toBe(FOLLOW_UP);
    await act(async () => { fireEvent.press(screen.getByText('Ask ECOS')); });
    await screen.findByText(`Answer to: ${FOLLOW_UP}`);
    expect(turnOf(mockServer.arrivals[2])).toEqual(turnOf(mockServer.arrivals[1]));
    expect(mockServer.arrivals[2].priorTurnId).toBeTruthy();
  });

  it('unchanged: after "temporarily unavailable" (503), asking again starts a new conversation', async () => {
    const screen = await followUpAfterAnAnswer(refused(503, { error: 'agent_gateway_unavailable' }));
    await screen.findByText('Ask ECOS is temporarily unavailable. Try again shortly.');
    await act(async () => { fireEvent.press(screen.getByText('Ask ECOS')); });
    await screen.findByText(`Answer to: ${FOLLOW_UP}`);
    expect(mockServer.arrivals[2].conversationId).not.toBe(mockServer.arrivals[0].conversationId);
    expect(mockServer.arrivals[2].priorTurnId).toBeUndefined();
  });
});

describe('L4: which failures leave the conversation standing', () => {
  const failure = async (status: number, payload: unknown) => {
    mockServer.script = [refused(status, payload)];
    return askECOSProjectQuestion({ client: mockClient as never, projectId: 'project-lot-9', projectName: 'Lot 9', question: FIRST })
      .catch(caught => caught);
  };

  it.each([
    [504, { error: 'agent_gateway_timed_out' }],
    [504, 'upstream request timeout'],
    [503, { error: 'dependency_timed_out' }],
  ])('a server time-out (%i %p): it stands, and the sentence says the question is still here', async (status, payload) => {
    const error = await failure(status, payload);
    expect(error.message).toBe(RAN_OUT_OF_TIME);
    expect(ecosAskConversationStands(error)).toBe(true);
  });

  it.each([
    [503, { error: 'answer_timed_out' }],
    [503, { error: 'agent_gateway_unavailable' }],
    [502, { error: 'answer_invalid' }],
    [500, { error: 'internal_error' }],
    [409, { error: 'conversation_turn_stale' }],
    [429, { error: 'question_rate_limited' }],
    [401, { error: 'unauthorized' }],
  ])('another failure (%i %p): it does not, and the sentence does not say so', async (status, payload) => {
    const error = await failure(status, payload);
    expect(error.message).not.toContain('still here');
    expect(ecosAskConversationStands(error)).toBe(false);
  });

  it('the app\'s own stops stand, as before; a plain error does not', () => {
    expect(ecosAskConversationStands(new ECOSAskStoppedError('question_cancelled'))).toBe(true);
    expect(ecosAskConversationStands(new ECOSAskStoppedError('question_timed_out'))).toBe(true);
    expect(ecosAskConversationStands(new Error('anything else'))).toBe(false);
    expect(ecosAskConversationStands(null)).toBe(false);
  });
});
