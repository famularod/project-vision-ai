/**
 * Review pass 2, A1 (5 Oct 2026): after Stop, an immediate Try Again was
 * refused with "ECOS is already reviewing that question", because the server
 * was still finishing the first ask. Try Again now goes on waiting for that
 * answer: the refusal is not shown, the app says the earlier ask is still
 * being worked on, and it sends the same request again every few seconds
 * until the answer comes, he stops it, or 2 min 30 s pass.
 *
 * The phone hook and the desktop page run here with the real request code and
 * the real @supabase/functions-js client against a stand-in server. The
 * stand-in is the reviewer's (notes/p2-ecos), written from the gateway, the
 * engine (ask-ecos-engine/src/server.ts) and ecos_begin_project_question:
 *   - one record per project and question text;
 *   - finished: the stored answer is replayed, with the current request id;
 *   - processing and started under 2 minutes ago: 409 question_in_progress,
 *     and nothing is recorded, counted or started;
 *   - otherwise a run starts, and goes on whether or not anyone is listening;
 *   - the gateway answers 504 by itself 125 s into a run.
 */
import { FunctionsClient } from '@supabase/functions-js';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { createElement } from 'react';
import { DesktopAskECOSWorkspace } from '../../components/web-shell/desktop-ask-ecos';
import { useECOSProjectQuestionExperience } from '../../hooks/use-ecos-project-question-experience';
import {
  ECOS_ASK_DEADLINE_MS,
  ECOS_ASK_IN_PROGRESS_RETRY_MS,
  ECOS_ASK_STOPPED_MESSAGE,
  ecosAskProgressStage,
  ecosAskTimedOutMessage,
} from '../../services/ECOSAskProgress';
import { askECOSProjectQuestion } from '../../services/ECOSProjectQuestion';

type Body = Record<string, string>;
type Stored = { status: 'processing' | 'completed'; startedAt: number; payload?: Record<string, unknown> };

const mockServer = {
  uuids: 0,
  /** Seconds a run takes; Infinity = it never finishes. */
  engineSeconds: 40,
  /** The wait the server names in an "in progress" refusal; the engine names none, the classic route 15. */
  retryAfterSeconds: null as number | null,
  /** Whether answers carry conversation receipts (the live engine sends none). */
  conversations: false,
  records: new Map<string, Stored>(),
  /** How many times a record was written (a run started or finished). */
  recordWrites: 0,
  arrivals: [] as Array<{ at: number; body: Body; action: string }>,
  reset() {
    this.uuids = 0;
    this.engineSeconds = 40;
    this.retryAfterSeconds = null;
    this.conversations = false;
    this.records.clear();
    this.recordWrites = 0;
    this.arrivals.length = 0;
  },
};

function mockUuid() {
  mockServer.uuids += 1;
  return `00000000-0000-4000-8000-${String(mockServer.uuids).padStart(12, '0')}`;
}

function mockResponse(status: number, payload: unknown): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => JSON.parse(JSON.stringify(payload)),
    text: async () => JSON.stringify(payload),
    clone: () => mockResponse(status, payload),
  };
}

function mockAnswer(body: Body) {
  return {
    schemaVersion: 'ecos-project-question/2.0',
    projectId: body.projectId,
    projectName: body.projectName,
    question: body.question,
    answer: `Answer for ${body.projectName}: ${body.question}`,
    confidence: 'high',
    facts: [], limitations: [], conflicts: [], suggestedQuestions: [], supportingEvidence: [],
    assurance: { status: 'verified', checkedSourceCount: 1, verifiedFactCount: 1, rejectedFactCount: 0, message: 'Verified.' },
    generatedAt: '2026-10-05T00:00:00.000Z',
    model: 'test-model',
    diagnostics: {
      schemaVersion: 'ecos-question-trace/1.0', traceId: mockUuid(), clientRequestId: body.clientRequestId,
      clientSurface: body.clientSurface, replayed: false, persisted: true,
    },
    ...(mockServer.conversations ? {
      conversation: {
        schemaVersion: 'ecos-agent-conversation-context/1.0', conversationId: body.conversationId,
        turnId: mockUuid(), priorTurnId: body.priorTurnId || null,
      },
    } : {}),
  };
}

/** The gateway and the engine behind it, as fetch. An abort ends the request, not the server's run. */
function mockFetch(_url: string, init: { body: string; signal?: AbortSignal }) {
  const body = JSON.parse(init.body) as Body;
  return new Promise((resolve, reject) => {
    const abortError = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
    if (init.signal?.aborted) { reject(abortError()); return; }
    init.signal?.addEventListener('abort', () => reject(abortError()));
    const key = `${body.projectId}|${body.question}`;
    const now = Date.now();
    const existing = mockServer.records.get(key);
    const arrival = { at: now, body, action: '' };
    mockServer.arrivals.push(arrival);
    if (existing?.status === 'completed') {
      arrival.action = 'replay';
      const stored = existing.payload as { diagnostics: Record<string, unknown> };
      setTimeout(() => resolve(mockResponse(200, {
        ...stored,
        diagnostics: { ...stored.diagnostics, replayed: true, clientRequestId: body.clientRequestId, clientSurface: body.clientSurface },
      })), 1_000);
      return;
    }
    if (existing?.status === 'processing' && now - existing.startedAt < 120_000) {
      // Refused before anything is counted, recorded or started.
      arrival.action = 'in_progress';
      setTimeout(() => resolve(mockResponse(409, {
        error: 'question_in_progress',
        ...(mockServer.retryAfterSeconds ? { retryAfterSeconds: mockServer.retryAfterSeconds } : {}),
      })), 1_000);
      return;
    }
    arrival.action = 'start';
    const record: Stored = { status: 'processing', startedAt: now };
    mockServer.records.set(key, record);
    mockServer.recordWrites += 1;
    const gatewayTimer = setTimeout(() => resolve(mockResponse(504, { error: 'agent_gateway_timed_out' })), 125_000);
    if (Number.isFinite(mockServer.engineSeconds)) {
      setTimeout(() => {
        const answer = mockAnswer(body);
        record.status = 'completed';
        record.payload = answer;
        mockServer.recordWrites += 1;
        clearTimeout(gatewayTimer);
        resolve(mockResponse(200, answer));
      }, mockServer.engineSeconds * 1_000);
    }
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

const QUESTION = 'How thick is the north side concrete?';
const FOLLOW_UP = 'And on the south side?';
const PROJECTS = [
  { id: 'project-2321', name: '2321 Compliance Project' },
  { id: 'project-2375', name: '2375 Compliance Project' },
];
const REFUSAL = 'ECOS is already reviewing that question. Wait a moment, then retry.';
const ANSWER = `Answer for 2375 Compliance Project: ${QUESTION}`;
const EARLIER = ecosAskProgressStage(0, true);

const advance = (milliseconds: number) => act(async () => { await jest.advanceTimersByTimeAsync(milliseconds); });
const actions = () => mockServer.arrivals.map(arrival => arrival.action);
const secondsSinceFirstAsk = () => mockServer.arrivals.map(arrival => Math.round((arrival.at - mockServer.arrivals[0].at) / 1000));

beforeEach(() => {
  mockServer.reset();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

it('says the earlier ask is still being worked on, and what the app will do', () => {
  expect(EARLIER).toEqual({
    key: 'earlier',
    title: 'Still working on this question…',
    detail: 'ECOS had already started on this question when you asked again. The app is waiting for that answer and shows it as soon as it is ready. ' +
      'If there is none by 2 min 30 s, the app stops waiting and keeps your question. You can also stop now.',
  });
  // Whatever the clock says: the usual stages describe steps that are not starting now.
  expect(ecosAskProgressStage(120, true)).toEqual(EARLIER);
  expect(ecosAskProgressStage(0).key).toBe('finding');
  expect(ECOS_ASK_IN_PROGRESS_RETRY_MS).toBe(5_000);
});

describe('Stop, then Try Again, on the phone and iPad', () => {
  type Experience = ReturnType<typeof useECOSProjectQuestionExperience>;
  const voice = (result: { current: Experience }) => result.current.sheets.props.children[0].props;
  const sheet = (result: { current: Experience }) => result.current.sheets.props.children[2].props;

  function open() {
    return renderHook<Experience, { selected: string }>(props => useECOSProjectQuestionExperience({
      contextualProjectName: props.selected,
      projectRecords: PROJECTS as never,
      candidateProjects: PROJECTS.map(project => project.name),
      onOpenEvidence: jest.fn(),
    }), { initialProps: { selected: '2375 Compliance Project' } });
  }

  async function ask(result: { current: Experience }, question = QUESTION) {
    await act(async () => { result.current.open(); });
    await act(async () => { voice(result).onMemoryReady({ transcript: question }); });
    await advance(0);
  }

  /** Asks, lets `seconds` pass, presses Stop, then Try Again a second later. */
  async function stopThenTryAgain(result: { current: Experience }, seconds = 5) {
    await ask(result);
    await advance(seconds * 1_000);
    await act(async () => { sheet(result).onStop(); });
    expect(sheet(result)).toMatchObject({ loading: false, question: QUESTION, error: ECOS_ASK_STOPPED_MESSAGE });
    await advance(1_000);
    await act(async () => { sheet(result).onRetry(); });
    await advance(0);
  }

  it('goes on waiting for the first ask\'s answer instead of showing a refusal', async () => {
    const { result } = open();
    await stopThenTryAgain(result);
    expect(sheet(result)).toMatchObject({ loading: true, question: QUESTION, error: null, earlierAskStillRunning: false });

    // About a second later the server has said it is still on the first ask.
    await advance(1_000);
    expect(actions()).toEqual(['start', 'in_progress']);
    expect(sheet(result)).toMatchObject({ loading: true, question: QUESTION, error: null, answer: null, earlierAskStillRunning: true });

    // The server's run ends 40 s after the first ask. Until then: waiting, never the refusal.
    for (let second = 8; second < 40; second += 1) {
      await advance(1_000);
      expect(sheet(result)).toMatchObject({ loading: true, error: null, answer: null, earlierAskStillRunning: true });
    }
    // The next check after that gets the stored answer.
    await advance(ECOS_ASK_IN_PROGRESS_RETRY_MS + 1_000);
    expect(sheet(result)).toMatchObject({ loading: false, error: null, question: QUESTION });
    expect(sheet(result).answer.answer).toBe(ANSWER);
    expect(sheet(result).onRetry).toBeUndefined();

    // One run on the server. Every check was the same request, and was refused without a record written.
    expect(actions().filter(action => action === 'start')).toHaveLength(1);
    expect(actions().at(-1)).toBe('replay');
    expect(actions().slice(1, -1).every(action => action === 'in_progress')).toBe(true);
    expect(mockServer.recordWrites).toBe(2);
    for (const arrival of mockServer.arrivals) expect(arrival.body).toEqual(mockServer.arrivals[0].body);
    // Asked again 5 s after each refusal (each refusal takes the server 1 s to send).
    expect(secondsSinceFirstAsk()).toEqual([0, 6, 12, 18, 24, 30, 36, 42]);

    await advance(ECOS_ASK_DEADLINE_MS * 2);
    expect(sheet(result)).toMatchObject({ loading: false, error: null });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('never shows "already reviewing" on the way', async () => {
    const { result } = open();
    await stopThenTryAgain(result);
    for (let second = 0; second < 60; second += 1) {
      await advance(1_000);
      expect(sheet(result).error).not.toBe(REFUSAL);
    }
    expect(sheet(result).answer.answer).toBe(ANSWER);
  });

  it('Stop still returns control at once during that wait, and Try Again picks it up again', async () => {
    const { result } = open();
    await stopThenTryAgain(result);
    await advance(9_000);
    const before = mockServer.arrivals.length;
    await act(async () => { sheet(result).onStop(); });
    expect(sheet(result)).toMatchObject({ loading: false, question: QUESTION, answer: null, error: ECOS_ASK_STOPPED_MESSAGE });
    expect(typeof sheet(result).onRetry).toBe('function');

    // Nothing more is sent, and nothing appears, while it is stopped.
    await advance(60_000);
    expect(mockServer.arrivals).toHaveLength(before);
    expect(sheet(result)).toMatchObject({ loading: false, answer: null, error: ECOS_ASK_STOPPED_MESSAGE });

    // The server finished meanwhile: Try Again shows the stored answer.
    await act(async () => { sheet(result).onRetry(); });
    await advance(1_000);
    expect(sheet(result).answer.answer).toBe(ANSWER);
    expect(actions().at(-1)).toBe('replay');
    expect(mockServer.arrivals.at(-1)!.body).toEqual(mockServer.arrivals[0].body);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops at 2 min 30 s from Try Again when the server never finishes, and keeps the question', async () => {
    mockServer.engineSeconds = Infinity;
    const { result } = open();
    await stopThenTryAgain(result);
    await advance(ECOS_ASK_DEADLINE_MS - 1);
    expect(sheet(result)).toMatchObject({ loading: true, error: null });
    await advance(1);
    expect(sheet(result)).toMatchObject({ loading: false, question: QUESTION, answer: null, error: ecosAskTimedOutMessage() });
    expect(typeof sheet(result).onRetry).toBe('function');

    // Refused until 2 minutes after the first ask; the check after that is taken as a new run (the server's own rule).
    const starts = mockServer.arrivals.filter(arrival => arrival.action === 'start');
    expect(starts).toHaveLength(2);
    expect(Math.round((starts[1].at - starts[0].at) / 1000)).toBeGreaterThanOrEqual(120);
    expect(actions().slice(1, -1).every(action => action === 'in_progress')).toBe(true);
    // At most one check every 6 s: 20 refusals in those 2 minutes.
    expect(actions().filter(action => action === 'in_progress').length).toBeLessThanOrEqual(20);
    await advance(ECOS_ASK_DEADLINE_MS);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('waits the same way when the first ask of a question finds the server already on it', async () => {
    // The same question was asked from the desktop 10 s ago.
    mockServer.records.set(`project-2375|${QUESTION}`, { status: 'processing', startedAt: Date.now() - 10_000 });
    const { result } = open();
    await ask(result);
    await advance(1_000);
    expect(sheet(result)).toMatchObject({ loading: true, error: null, earlierAskStillRunning: true });
    // That other run ends; the next check here is accepted and answered.
    mockServer.records.get(`project-2375|${QUESTION}`)!.startedAt = Date.now() - 130_000;
    await advance(ECOS_ASK_IN_PROGRESS_RETRY_MS + 40_000);
    expect(sheet(result)).toMatchObject({ loading: false, error: null });
    expect(sheet(result).answer.answer).toBe(ANSWER);
  });

  it('uses the wait the server names when it names one', async () => {
    mockServer.retryAfterSeconds = 15;
    const { result } = open();
    await stopThenTryAgain(result);
    await advance(60_000);
    expect(sheet(result).answer.answer).toBe(ANSWER);
    // 15 s after each refusal instead of 5.
    expect(secondsSinceFirstAsk()).toEqual([0, 6, 22, 38, 54]);
    expect(actions()).toEqual(['start', 'in_progress', 'in_progress', 'in_progress', 'replay']);
  });

  it('a different project is never answered by that wait', async () => {
    const { result } = open();
    await stopThenTryAgain(result);
    await advance(3_000);
    await act(async () => { voice(result).onProjectChange('2321 Compliance Project'); });
    const sent = mockServer.arrivals.length;
    await advance(120_000);
    expect(mockServer.arrivals).toHaveLength(sent);
    expect(sheet(result)).toMatchObject({ visible: false, answer: null });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps a follow-up linked to the first answer through Stop and Try Again (only matters if the server ever sends receipts)', async () => {
    mockServer.conversations = true;
    const { result } = open();
    await ask(result);
    await advance(40_000);
    const firstTurn = sheet(result).answer.conversation.turnId;

    await act(async () => { sheet(result).onAskAnother(FOLLOW_UP); });
    await advance(5_000);
    await act(async () => { sheet(result).onStop(); });
    await act(async () => { sheet(result).onRetry(); });
    await advance(60_000);
    // Every request for the follow-up carried the same conversation and the first answer's turn.
    const followUps = mockServer.arrivals.filter(arrival => arrival.body.question === FOLLOW_UP);
    expect(followUps.length).toBeGreaterThan(2);
    for (const arrival of followUps) {
      expect(arrival.body).toMatchObject({ conversationId: mockServer.arrivals[0].body.conversationId, priorTurnId: firstTurn });
    }
    expect(sheet(result)).toMatchObject({ loading: false, error: null });
    expect(sheet(result).answer.answer).toBe(`Answer for 2375 Compliance Project: ${FOLLOW_UP}`);
  });
});

describe('Stop, then Ask ECOS again, on the desktop', () => {
  const INPUT = 'Project question for ECOS';
  const onAsk: Parameters<typeof DesktopAskECOSWorkspace>[0]['onAsk'] = (input, control) =>
    askECOSProjectQuestion({ client: mockClient as never, ...input, ...control });
  const page = (project = PROJECTS[1]) => createElement(DesktopAskECOSWorkspace, {
    ownerKey: 'owner', projectId: project.id, projectName: project.name, onAsk,
  });

  async function stopThenAskAgain(screen: ReturnType<typeof render>) {
    fireEvent.changeText(screen.getByLabelText(INPUT), QUESTION);
    await act(async () => { fireEvent.press(screen.getByText('Ask ECOS')); });
    await advance(5_000);
    await act(async () => { fireEvent.press(screen.getByLabelText('Stop waiting for this answer')); });
    expect(screen.getByText(ECOS_ASK_STOPPED_MESSAGE)).toBeTruthy();
    await advance(1_000);
    await act(async () => { fireEvent.press(screen.getByText('Ask ECOS')); });
    await advance(0);
  }

  it('goes on waiting for the first ask\'s answer, says so, and shows it when it is ready', async () => {
    const screen = render(page());
    await stopThenAskAgain(screen);
    await advance(1_000);
    expect(screen.getByText(EARLIER.title)).toBeTruthy();
    expect(screen.getByText(EARLIER.detail)).toBeTruthy();
    expect(screen.getByLabelText('Stop waiting for this answer')).toBeTruthy();

    for (let second = 8; second < 40; second += 1) {
      await advance(1_000);
      expect(screen.queryByText(REFUSAL)).toBeNull();
      expect(screen.getByText(EARLIER.title)).toBeTruthy();
    }
    await advance(ECOS_ASK_IN_PROGRESS_RETRY_MS + 1_000);
    expect(screen.getByText(ANSWER)).toBeTruthy();
    expect(screen.queryByText(EARLIER.title)).toBeNull();
    expect(screen.queryByText(REFUSAL)).toBeNull();
    expect(screen.getByLabelText(INPUT).props.value).toBe(QUESTION);
    expect(actions().filter(action => action === 'start')).toHaveLength(1);
    for (const arrival of mockServer.arrivals) expect(arrival.body).toEqual(mockServer.arrivals[0].body);

    // The next question starts with the ordinary wording again.
    fireEvent.changeText(screen.getByLabelText(INPUT), FOLLOW_UP);
    await act(async () => { fireEvent.press(screen.getByText('Ask ECOS')); });
    await advance(2_000);
    expect(screen.queryByText(EARLIER.title)).toBeNull();
    expect(screen.getByText('Finding the right pages and records…')).toBeTruthy();
  });

  it('Stop returns control at once during that wait; 2 min 30 s ends it when the server never finishes', async () => {
    mockServer.engineSeconds = Infinity;
    const screen = render(page());
    await stopThenAskAgain(screen);
    await advance(20_000);
    await act(async () => { fireEvent.press(screen.getByLabelText('Stop waiting for this answer')); });
    expect(screen.getByText(ECOS_ASK_STOPPED_MESSAGE)).toBeTruthy();
    expect(screen.queryByText('Checking evidence…')).toBeNull();
    const sent = mockServer.arrivals.length;
    await advance(30_000);
    expect(mockServer.arrivals).toHaveLength(sent);

    await act(async () => { fireEvent.press(screen.getByText('Ask ECOS')); });
    await advance(ECOS_ASK_DEADLINE_MS - 1);
    expect(screen.getByText('Checking evidence…')).toBeTruthy();
    await advance(1);
    expect(screen.getByText(ecosAskTimedOutMessage())).toBeTruthy();
    expect(screen.queryByText(REFUSAL)).toBeNull();
    expect(screen.getByLabelText(INPUT).props.value).toBe(QUESTION);
    await advance(ECOS_ASK_DEADLINE_MS);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('changing project ends that wait and sends nothing more', async () => {
    const screen = render(page());
    await stopThenAskAgain(screen);
    await advance(3_000);
    await act(async () => { screen.rerender(page(PROJECTS[0])); });
    const sent = mockServer.arrivals.length;
    await advance(120_000);
    expect(mockServer.arrivals).toHaveLength(sent);
    expect(screen.queryByText(/Answer for/)).toBeNull();
    expect(screen.queryByText(EARLIER.title)).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });
});
