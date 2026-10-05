/**
 * Independent review R10 (Build 229), on the screens: the phone and iPad Ask
 * ECOS sheet (hooks/use-ecos-project-question-experience) and the desktop Ask
 * ECOS page (components/web-shell/desktop-ask-ecos), each running the real
 * request code against a cloud that answers only when the test says so.
 */
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { createElement } from 'react';
import { ECOSProjectAnswerSheet } from '../../components/ECOSProjectAnswerSheet';
import { DesktopAskECOSWorkspace } from '../../components/web-shell/desktop-ask-ecos';
import { useECOSProjectQuestionExperience } from '../../hooks/use-ecos-project-question-experience';
import { ECOS_ASK_DEADLINE_MS, ECOS_ASK_STOPPED_MESSAGE, ecosAskTimedOutMessage } from '../../services/ECOSAskProgress';
import { askECOSProjectQuestion } from '../../services/ECOSProjectQuestion';

type CloudRequest = {
  body: Record<string, string>;
  signal: AbortSignal;
  answer(): void;
  refuse(code: string, status: number): void;
};

const mockCloud = {
  owner: 'owner-one',
  uuids: 0,
  requests: [] as CloudRequest[],
  client: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } }, error: null }) },
    functions: {
      invoke: (_name: string, options: { body: Record<string, string>; signal: AbortSignal }) =>
        new Promise(resolve => {
          mockCloud.requests.push({
            body: options.body,
            signal: options.signal,
            answer: () => resolve({ data: mockAnswerFor(options.body), error: null, response: null }),
            refuse: (code, status) => resolve({
              data: null,
              error: new Error('Edge Function returned a non-2xx status code'),
              response: { status, clone: () => ({ json: async () => ({ error: code }) }) },
            }),
          });
        }),
    },
  },
};

function mockUuid() {
  mockCloud.uuids += 1;
  return `00000000-0000-4000-8000-${String(mockCloud.uuids).padStart(12, '0')}`;
}

function mockAnswerFor(body: Record<string, string>) {
  return {
    schemaVersion: 'ecos-project-question/2.0',
    projectId: body.projectId,
    projectName: body.projectName,
    question: body.question,
    answer: `Answer for ${body.projectName}.`,
    confidence: 'high',
    facts: [],
    limitations: [],
    conflicts: [],
    suggestedQuestions: [],
    supportingEvidence: [],
    aiReadStatements: [],
    assurance: { status: 'verified', checkedSourceCount: 1, verifiedFactCount: 1, rejectedFactCount: 0, message: 'Verified.' },
    generatedAt: '2026-10-05T00:00:00.000Z',
    model: 'test-model',
    diagnostics: {
      schemaVersion: 'ecos-question-trace/1.0',
      traceId: '11111111-1111-4111-8111-111111111111',
      clientRequestId: body.clientRequestId,
      clientSurface: body.clientSurface,
      evidenceSnapshotId: null,
      evidenceDossierId: null,
      replayed: false,
      persisted: true,
    },
    conversation: {
      schemaVersion: 'ecos-agent-conversation-context/1.0',
      conversationId: body.conversationId,
      turnId: mockUuid(),
      priorTurnId: body.priorTurnId || null,
    },
  };
}

jest.mock('expo-crypto', () => ({ randomUUID: () => mockUuid() }));
jest.mock('expo-router', () => ({ Link: ({ children }: { children: unknown }) => children }));
jest.mock('../../components/DAVETypedCaptureSheet', () => ({ DAVETypedCaptureSheet: () => null }));
jest.mock('../../components/DAVEVoiceCaptureSheet', () => ({ DAVEVoiceCaptureSheet: () => null }));
jest.mock('../../services/SupabaseService', () => ({ getSupabaseClient: () => mockCloud.client }));
jest.mock('../../components/native-workspace-owner', () => ({ useNativeWorkspaceOwner: () => mockCloud.owner }));

const QUESTION = 'How thick is the north side concrete?';
const PROJECTS = [
  { id: 'project-2321', name: '2321 Compliance Project' },
  { id: 'project-2375', name: '2375 Compliance Project' },
];

const advance = (milliseconds: number) => act(async () => { await jest.advanceTimersByTimeAsync(milliseconds); });

beforeEach(() => {
  mockCloud.owner = 'owner-one';
  mockCloud.uuids = 0;
  mockCloud.requests.length = 0;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('Ask ECOS on the phone and iPad', () => {
  type Experience = ReturnType<typeof useECOSProjectQuestionExperience>;
  const voice = (result: { current: Experience }) => result.current.sheets.props.children[0].props;
  const answerSheet = (result: { current: Experience }) => result.current.sheets.props.children[2].props;

  function open(selected = '2375 Compliance Project') {
    return renderHook<Experience, { selected: string }>(props => useECOSProjectQuestionExperience({
      contextualProjectName: props.selected,
      projectRecords: PROJECTS as never,
      candidateProjects: PROJECTS.map(project => project.name),
      onOpenEvidence: jest.fn(),
    }), { initialProps: { selected } });
  }

  async function askIn(result: { current: Experience }, question = QUESTION) {
    await act(async () => { result.current.open(); });
    await act(async () => { voice(result).onMemoryReady({ transcript: question }); });
    await advance(0);
  }

  it('stops waiting at the time limit, keeps the question and offers Try Again', async () => {
    const { result } = open();
    await askIn(result);
    expect(answerSheet(result)).toMatchObject({ visible: true, loading: true, question: QUESTION, error: null });
    expect(answerSheet(result).onRetry).toBeUndefined();

    await advance(ECOS_ASK_DEADLINE_MS - 1);
    expect(answerSheet(result)).toMatchObject({ loading: true, error: null });
    expect(mockCloud.requests[0].signal.aborted).toBe(false);

    await advance(1);
    expect(answerSheet(result)).toMatchObject({
      visible: true,
      loading: false,
      question: QUESTION,
      answer: null,
      error: ecosAskTimedOutMessage(),
    });
    expect(typeof answerSheet(result).onRetry).toBe('function');
    expect(mockCloud.requests[0].signal.aborted).toBe(true);
  });

  it('returns control at once on Stop, keeps the question and offers Try Again', async () => {
    const { result } = open();
    await askIn(result);
    await advance(12_000);
    await act(async () => { answerSheet(result).onStop(); });
    expect(answerSheet(result)).toMatchObject({
      visible: true,
      loading: false,
      question: QUESTION,
      answer: null,
      error: ECOS_ASK_STOPPED_MESSAGE,
    });
    expect(typeof answerSheet(result).onRetry).toBe('function');
    expect(mockCloud.requests[0].signal.aborted).toBe(true);
  });

  it.each(['Stop', 'the time limit'])('does not show an answer that arrives after %s', async kind => {
    const { result } = open();
    await askIn(result);
    if (kind === 'Stop') await act(async () => { answerSheet(result).onStop(); });
    else await advance(ECOS_ASK_DEADLINE_MS);
    const shown = { loading: answerSheet(result).loading, error: answerSheet(result).error };

    await act(async () => { mockCloud.requests[0].answer(); });
    await advance(0);
    expect(answerSheet(result)).toMatchObject({ ...shown, loading: false, answer: null, question: QUESTION });
  });

  it('stops the request when the sheet is closed, and does not reopen it for a late answer', async () => {
    const { result } = open();
    await askIn(result);
    await act(async () => { answerSheet(result).onClose(); });
    expect(mockCloud.requests[0].signal.aborted).toBe(true);
    await act(async () => { mockCloud.requests[0].answer(); });
    await advance(0);
    expect(answerSheet(result)).toMatchObject({ visible: false, answer: null });
  });

  it('stops the request when Ask ECOS goes away altogether', async () => {
    const { result, unmount } = open();
    await askIn(result);
    expect(mockCloud.requests[0].signal.aborted).toBe(false);
    unmount();
    expect(mockCloud.requests[0].signal.aborted).toBe(true);
  });

  it.each(['project', 'account'])('stops the request on a change of %s, shows no late answer, and starts a new request there', async kind => {
    const { result, rerender } = open();
    await askIn(result);
    if (kind === 'project') await act(async () => { voice(result).onProjectChange('2321 Compliance Project'); });
    else {
      mockCloud.owner = 'owner-two';
      await act(async () => { rerender({ selected: '2375 Compliance Project' }); });
    }
    expect(mockCloud.requests[0].signal.aborted).toBe(true);
    await act(async () => { mockCloud.requests[0].answer(); });
    await advance(0);
    expect(answerSheet(result)).toMatchObject({ visible: false, answer: null });

    // The same words asked again there are a different request.
    await act(async () => { voice(result).onMemoryReady({ transcript: QUESTION }); });
    await advance(0);
    expect(mockCloud.requests).toHaveLength(2);
    expect(mockCloud.requests[1].body.clientRequestId).not.toBe(mockCloud.requests[0].body.clientRequestId);
    expect(mockCloud.requests[1].body.conversationId).not.toBe(mockCloud.requests[0].body.conversationId);
  });

  it.each(['Stop', 'the time limit'])('Try Again after %s sends the same request again, and shows its answer', async kind => {
    const { result } = open();
    await askIn(result);
    if (kind === 'Stop') await act(async () => { answerSheet(result).onStop(); });
    else await advance(ECOS_ASK_DEADLINE_MS);

    await act(async () => { answerSheet(result).onRetry(); });
    await advance(0);
    expect(answerSheet(result)).toMatchObject({ visible: true, loading: true, question: QUESTION, error: null });
    expect(mockCloud.requests).toHaveLength(2);
    // Same request id and conversation, so a server that recognises the id need not do the work twice.
    expect(mockCloud.requests[1].body).toEqual(mockCloud.requests[0].body);
    expect(mockCloud.requests[1].signal).not.toBe(mockCloud.requests[0].signal);
    expect(mockCloud.requests[1].signal.aborted).toBe(false);

    // The first, abandoned request answering now changes nothing.
    await act(async () => { mockCloud.requests[0].answer(); });
    await advance(0);
    expect(answerSheet(result)).toMatchObject({ loading: true, answer: null });

    await act(async () => { mockCloud.requests[1].answer(); });
    await advance(0);
    expect(answerSheet(result)).toMatchObject({
      loading: false,
      error: null,
      answer: { answer: 'Answer for 2375 Compliance Project.' },
    });

    // The next question is a new request that follows on from that answer.
    const answeredTurn = answerSheet(result).answer.conversation.turnId;
    await act(async () => { answerSheet(result).onAskAnother('And the south side?'); });
    await advance(0);
    expect(mockCloud.requests[2].body.clientRequestId).not.toBe(mockCloud.requests[0].body.clientRequestId);
    expect(mockCloud.requests[2].body).toMatchObject({
      conversationId: mockCloud.requests[0].body.conversationId,
      priorTurnId: answeredTurn,
    });
  });

  it('uses a new request id once the server has answered the question with a refusal', async () => {
    const { result } = open();
    await askIn(result);
    await act(async () => { mockCloud.requests[0].refuse('answer_provider_unavailable', 503); });
    await advance(0);
    expect(answerSheet(result)).toMatchObject({
      loading: false,
      error: 'The AI answering service is temporarily unavailable. Your project information is unchanged. Please try again shortly.',
    });
    await act(async () => { answerSheet(result).onRetry(); });
    await advance(0);
    expect(mockCloud.requests[1].body.question).toBe(QUESTION);
    expect(mockCloud.requests[1].body.clientRequestId).not.toBe(mockCloud.requests[0].body.clientRequestId);
  });

  it('does not offer Try Again when the question names a different project', async () => {
    const { result } = open('2321 Compliance Project');
    await askIn(result, 'How thick is the new concrete on the north side of 2375?');
    expect(answerSheet(result)).toMatchObject({ loading: false });
    expect(answerSheet(result).error).toContain('2375');
    expect(answerSheet(result).onRetry).toBeUndefined();
    expect(mockCloud.requests).toHaveLength(0);
  });
});

describe('the phone and iPad answer sheet', () => {
  const sheet = (props: Partial<Parameters<typeof ECOSProjectAnswerSheet>[0]>) => render(createElement(ECOSProjectAnswerSheet, {
    visible: true,
    projectName: '2375 Compliance Project',
    question: QUESTION,
    answer: null,
    loading: false,
    error: null,
    onOpenEvidence: () => undefined,
    onAskAnother: () => undefined,
    onClose: () => undefined,
    ...props,
  }));

  it('shows Stop while it waits, with the question, and no Try Again', () => {
    const onStop = jest.fn();
    const screen = sheet({ loading: true, onStop, onRetry: jest.fn() });
    expect(screen.getByText(QUESTION)).toBeTruthy();
    expect(screen.queryByText('Try Again')).toBeNull();
    fireEvent.press(screen.getByLabelText('Stop waiting for this answer'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('says what will really happen once the wait runs long', async () => {
    const screen = sheet({ loading: true, onStop: jest.fn() });
    await advance(95_000);
    expect(screen.getByText('Still working…')).toBeTruthy();
    expect(screen.getByText(
      'This is taking longer than usual. If there is no answer by 2 min 30 s, ' +
      'the app stops waiting and keeps your question so you can try again. You can also stop now.',
    )).toBeTruthy();
    expect(screen.getByLabelText('Stop waiting for this answer')).toBeTruthy();
  });

  it('shows the question, the reason and Try Again after a stop or a time-out', () => {
    const onRetry = jest.fn();
    const screen = sheet({ error: ecosAskTimedOutMessage(), onStop: jest.fn(), onRetry });
    expect(screen.getByText(QUESTION)).toBeTruthy();
    expect(screen.getByText(ecosAskTimedOutMessage())).toBeTruthy();
    expect(screen.queryByLabelText('Stop waiting for this answer')).toBeNull();
    fireEvent.press(screen.getByText('Try Again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Ask Another Question')).toBeTruthy();
  });

  it('shows no Try Again when a retry is not offered', () => {
    const screen = sheet({ error: 'This question names a different project.' });
    expect(screen.queryByText('Try Again')).toBeNull();
    expect(screen.getByText('Ask Another Question')).toBeTruthy();
  });
});

describe('Ask ECOS on the desktop', () => {
  const INPUT = 'Project question for ECOS';
  /** As the desktop shell and its cloud gateway pass it on. */
  const onAsk: Parameters<typeof DesktopAskECOSWorkspace>[0]['onAsk'] = (input, control) =>
    askECOSProjectQuestion({ client: mockCloud.client as never, ...input, ...control });

  const page = (project = PROJECTS[1], ownerKey = 'owner') => createElement(DesktopAskECOSWorkspace, {
    ownerKey,
    projectId: project.id,
    projectName: project.name,
    onAsk,
  });

  async function ask(screen: ReturnType<typeof render>, question = QUESTION) {
    fireEvent.changeText(screen.getByLabelText(INPUT), question);
    await act(async () => { fireEvent.press(screen.getByText('Ask ECOS')); });
    await advance(0);
  }

  it('stops waiting at the time limit, keeps the typed question and lets it be asked again', async () => {
    const screen = render(page());
    await ask(screen);
    expect(screen.getByText('Checking evidence…')).toBeTruthy();
    expect(screen.getByLabelText('Stop waiting for this answer')).toBeTruthy();

    await advance(ECOS_ASK_DEADLINE_MS - 1);
    expect(screen.getByText('Checking evidence…')).toBeTruthy();
    expect(screen.queryByText(ecosAskTimedOutMessage())).toBeNull();

    await advance(1);
    expect(screen.queryByText('Checking evidence…')).toBeNull();
    expect(screen.queryByLabelText('Stop waiting for this answer')).toBeNull();
    expect(screen.getByText(ecosAskTimedOutMessage())).toBeTruthy();
    expect(screen.getByLabelText(INPUT).props.value).toBe(QUESTION);
    expect(screen.getByText('Ask ECOS')).toBeTruthy();
    expect(mockCloud.requests[0].signal.aborted).toBe(true);
  });

  it('says what will really happen once the wait runs long', async () => {
    const screen = render(page());
    await ask(screen);
    await advance(95_000);
    expect(screen.getByText('Still working…')).toBeTruthy();
    expect(screen.getByText(/If there is no answer by 2 min 30 s, the app stops waiting and keeps your question/)).toBeTruthy();
    expect(screen.queryByText(/ECOS will stop and tell you/)).toBeNull();
  });

  it('returns control at once on Stop, and never shows the answer that arrives afterwards', async () => {
    const screen = render(page());
    await ask(screen);
    await advance(8_000);
    await act(async () => { fireEvent.press(screen.getByLabelText('Stop waiting for this answer')); });
    expect(screen.queryByText('Checking evidence…')).toBeNull();
    expect(screen.getByText(ECOS_ASK_STOPPED_MESSAGE)).toBeTruthy();
    expect(screen.getByLabelText(INPUT).props.value).toBe(QUESTION);
    expect(mockCloud.requests[0].signal.aborted).toBe(true);

    await act(async () => { mockCloud.requests[0].answer(); });
    await advance(0);
    expect(screen.queryByText('Answer for 2375 Compliance Project.')).toBeNull();
    expect(screen.getByText(ECOS_ASK_STOPPED_MESSAGE)).toBeTruthy();
  });

  it.each(['Stop', 'the time limit'])('asking again after %s sends the same request again, and shows its answer', async kind => {
    const screen = render(page());
    await ask(screen);
    if (kind === 'Stop') await act(async () => { fireEvent.press(screen.getByLabelText('Stop waiting for this answer')); });
    else await advance(ECOS_ASK_DEADLINE_MS);

    await act(async () => { fireEvent.press(screen.getByText('Ask ECOS')); });
    await advance(0);
    expect(mockCloud.requests).toHaveLength(2);
    expect(mockCloud.requests[1].body).toEqual(mockCloud.requests[0].body);
    expect(mockCloud.requests[1].signal.aborted).toBe(false);

    await act(async () => { mockCloud.requests[0].answer(); });
    await advance(0);
    expect(screen.queryByText('Answer for 2375 Compliance Project.')).toBeNull();

    await act(async () => { mockCloud.requests[1].answer(); });
    await advance(0);
    expect(screen.getByText('Answer for 2375 Compliance Project.')).toBeTruthy();

    // A new question is a new request.
    await ask(screen, 'And the south side?');
    expect(mockCloud.requests[2].body.clientRequestId).not.toBe(mockCloud.requests[0].body.clientRequestId);
    expect(mockCloud.requests[2].body.conversationId).toBe(mockCloud.requests[0].body.conversationId);
  });

  it.each(['project', 'account'])('stops the request on a change of %s, shows no late answer, and starts a new request there', async kind => {
    const screen = render(page());
    await ask(screen);
    await act(async () => {
      screen.rerender(kind === 'project' ? page(PROJECTS[0]) : page(PROJECTS[1], 'other-owner'));
    });
    expect(mockCloud.requests[0].signal.aborted).toBe(true);
    await act(async () => { mockCloud.requests[0].answer(); });
    await advance(0);
    expect(screen.queryByText('Answer for 2375 Compliance Project.')).toBeNull();
    expect(screen.queryByText(ECOS_ASK_STOPPED_MESSAGE)).toBeNull();
    expect(screen.getByLabelText(INPUT).props.value).toBe('');

    await ask(screen);
    expect(mockCloud.requests).toHaveLength(2);
    expect(mockCloud.requests[1].body.clientRequestId).not.toBe(mockCloud.requests[0].body.clientRequestId);
  });

  it('stops the request when the page goes away', async () => {
    // The desktop shell replaces the whole page when the project or account changes.
    const screen = render(page());
    await ask(screen);
    expect(mockCloud.requests[0].signal.aborted).toBe(false);
    screen.unmount();
    expect(mockCloud.requests[0].signal.aborted).toBe(true);
  });

  it('regains control at the limit even when a step before the request hangs', async () => {
    // The desktop gateway checks the owner before it sends the request.
    const hung = jest.fn(() => new Promise<never>(() => undefined));
    const screen = render(createElement(DesktopAskECOSWorkspace, {
      ownerKey: 'owner', projectId: PROJECTS[1].id, projectName: PROJECTS[1].name, onAsk: hung,
    }));
    await ask(screen);
    await advance(ECOS_ASK_DEADLINE_MS);
    expect(screen.queryByText('Checking evidence…')).toBeNull();
    expect(screen.getByText(ecosAskTimedOutMessage())).toBeTruthy();
    expect(screen.getByLabelText(INPUT).props.value).toBe(QUESTION);
  });
});
