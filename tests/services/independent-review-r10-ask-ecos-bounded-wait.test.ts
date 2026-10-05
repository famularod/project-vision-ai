/**
 * Independent review R10 (Build 229): an Ask ECOS request had no time limit
 * and could not be stopped, so a connection that hung left the question
 * waiting for ever while the screen promised ECOS would stop by itself.
 * These cover the request (services/ECOSProjectQuestion) and the wait both
 * screens share (services/ECOSAskWait). The screens themselves are in
 * independent-review-r10-ask-ecos-screens.test.ts.
 */
import {
  ECOS_ASK_DEADLINE_MS,
  ECOS_ASK_SERVER_LONGEST_WAIT_MS,
  ECOS_ASK_STOPPED_MESSAGE,
  ecosAskProgressStage,
  ecosAskTimedOutMessage,
} from '../../services/ECOSAskProgress';
import { createECOSAskWait, ECOSAskStoppedError, isECOSAskStopped, type ECOSAskControl } from '../../services/ECOSAskWait';
import {
  askECOSProjectQuestion,
  ecosAskCanRetry,
  ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
  ECOSProjectQuestionError,
} from '../../services/ECOSProjectQuestion';

let mockUuidCount = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => {
    mockUuidCount += 1;
    return `00000000-0000-4000-8000-${String(mockUuidCount).padStart(12, '0')}`;
  },
}));

const QUESTION = 'How thick is the north side concrete?';
const never = <T>() => new Promise<T>(() => undefined);

type InvokeOptions = { body: Record<string, string>; signal?: AbortSignal; headers: Record<string, string> };

function answerFor(body: Record<string, string>) {
  return {
    schemaVersion: ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
    projectId: body.projectId,
    projectName: body.projectName,
    question: body.question,
    answer: 'The north side concrete is 6 inches thick.',
    confidence: 'high',
    facts: [],
    limitations: [],
    conflicts: [],
    suggestedQuestions: [],
    supportingEvidence: [],
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
  };
}

function client(invoke: jest.Mock, getSession: jest.Mock = jest.fn(async () => ({ data: { session: { access_token: 'token' } }, error: null }))) {
  return { auth: { getSession }, functions: { invoke } } as never;
}

const ask = (overrides: Partial<Parameters<typeof askECOSProjectQuestion>[0]>) => askECOSProjectQuestion({
  client: null,
  projectId: 'project-2375',
  projectName: '2375 Compliance Project',
  question: QUESTION,
  ...overrides,
});

/** Settles a promise into a value a test can read without waiting on it. */
function watch<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then(
    value => { state.settled = true; state.value = value; },
    error => { state.settled = true; state.error = error; },
  );
  return state;
}

beforeEach(() => {
  mockUuidCount = 0;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the time limit', () => {
  it('is the live gateway\'s own longest wait (10 s sign-in check + 125 s answer engine) plus 15 s', () => {
    expect(ECOS_ASK_SERVER_LONGEST_WAIT_MS).toBe(135_000);
    expect(ECOS_ASK_DEADLINE_MS).toBe(150_000);
    expect(ecosAskTimedOutMessage()).toBe(
      'ECOS did not answer within 2 min 30 s, so the app stopped waiting. ' +
      'No answer has been verified. Your question is still here — try again.',
    );
  });

  it('is what the progress wording tells the user, with no promise the app does not keep', () => {
    const longer = ecosAskProgressStage(120);
    expect(longer.key).toBe('longer');
    expect(longer.detail).toBe(
      'This is taking longer than usual. If there is no answer by 2 min 30 s, ' +
      'the app stops waiting and keeps your question so you can try again. You can also stop now.',
    );
    for (const seconds of [0, 10, 35, 50, 120, 149]) {
      expect(ecosAskProgressStage(seconds).detail).not.toContain('ECOS will stop');
    }
  });
});

describe('an Ask ECOS request', () => {
  it('ends at the time limit when the request never comes back, and aborts it', async () => {
    const invoke = jest.fn((_name: string, _options: InvokeOptions) => never());
    const state = watch(ask({ client: client(invoke) }));

    await jest.advanceTimersByTimeAsync(ECOS_ASK_DEADLINE_MS - 1);
    expect(state.settled).toBe(false);
    expect(invoke.mock.calls[0][1].signal?.aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    expect(state.error).toBeInstanceOf(ECOSProjectQuestionError);
    expect(state.error).toMatchObject({ code: 'question_timed_out', message: ecosAskTimedOutMessage() });
    expect(invoke.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('ends at the same limit when the sign-in check never comes back', async () => {
    const invoke = jest.fn();
    const state = watch(ask({ client: client(invoke, jest.fn(() => never())) }));
    await jest.advanceTimersByTimeAsync(ECOS_ASK_DEADLINE_MS);
    expect(state.error).toMatchObject({ code: 'question_timed_out' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('ends at the same limit when a refusal from the server never finishes arriving', async () => {
    const response = { status: 503, clone: () => ({ json: () => never() }) };
    const invoke = jest.fn(async () => ({ data: null, error: new Error('Edge Function returned a non-2xx status code'), response }));
    const state = watch(ask({ client: client(invoke) }));
    await jest.advanceTimersByTimeAsync(ECOS_ASK_DEADLINE_MS);
    expect(state.error).toMatchObject({ code: 'question_timed_out' });
  });

  it('counts the whole wait once: a slow sign-in check does not buy the request a fresh limit', async () => {
    const getSession = jest.fn(() => new Promise(resolve => {
      setTimeout(() => resolve({ data: { session: { access_token: 'token' } }, error: null }), 100_000);
    }));
    const invoke = jest.fn((_name: string, _options: InvokeOptions) => never());
    const state = watch(ask({ client: client(invoke, getSession as jest.Mock) }));
    await jest.advanceTimersByTimeAsync(100_000);
    expect(invoke).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(49_999);
    expect(state.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(state.error).toMatchObject({ code: 'question_timed_out' });
  });

  it('stops at once when the caller cancels, and aborts the request', async () => {
    const invoke = jest.fn((_name: string, _options: InvokeOptions) => never());
    const controller = new AbortController();
    const state = watch(ask({ client: client(invoke), signal: controller.signal }));
    await jest.advanceTimersByTimeAsync(5_000);
    expect(state.settled).toBe(false);

    controller.abort();
    await jest.advanceTimersByTimeAsync(0);
    expect(state.error).toBeInstanceOf(ECOSProjectQuestionError);
    expect(state.error).toMatchObject({ code: 'question_cancelled', message: ECOS_ASK_STOPPED_MESSAGE });
    expect(invoke.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('sends nothing when it was cancelled before it started', async () => {
    const invoke = jest.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(ask({ client: client(invoke), signal: controller.signal }))
      .rejects.toMatchObject({ code: 'question_cancelled' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(['time-out', 'cancel'])('does not hand back an answer that arrives after a %s', async kind => {
    let arrive!: (value: unknown) => void;
    const invoke = jest.fn((_name: string, _options: InvokeOptions) => new Promise(resolve => { arrive = resolve; }));
    const controller = new AbortController();
    const state = watch(ask({ client: client(invoke), signal: controller.signal }));
    await jest.advanceTimersByTimeAsync(1_000);
    if (kind === 'cancel') controller.abort();
    await jest.advanceTimersByTimeAsync(kind === 'cancel' ? 0 : ECOS_ASK_DEADLINE_MS);
    const stoppedWith = state.error;
    expect(stoppedWith).toMatchObject({ code: kind === 'cancel' ? 'question_cancelled' : 'question_timed_out' });

    arrive({ data: answerFor(invoke.mock.calls[0][1].body), error: null, response: null });
    await jest.advanceTimersByTimeAsync(0);
    expect(state.value).toBeUndefined();
    expect(state.error).toBe(stoppedWith);
  });

  it('answers as before when the answer comes in time, and leaves no timer running', async () => {
    const invoke = jest.fn(async (_name: string, { body }: InvokeOptions) => ({ data: answerFor(body), error: null, response: null }));
    const controller = new AbortController();
    const answer = await ask({ client: client(invoke), signal: controller.signal });
    expect(answer.answer).toBe('The north side concrete is 6 inches thick.');
    expect(invoke.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(invoke.mock.calls[0][1].signal?.aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    // A cancel after the answer changes nothing.
    controller.abort();
    expect(invoke.mock.calls[0][1].signal?.aborted).toBe(false);
  });

  it('sends the request id it is given, and a new one when it is given none', async () => {
    const invoke = jest.fn(async (_name: string, { body }: InvokeOptions) => ({ data: answerFor(body), error: null, response: null }));
    const kept = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const first = await ask({ client: client(invoke), clientRequestId: kept });
    const second = await ask({ client: client(invoke) });
    expect(invoke.mock.calls[0][1].body.clientRequestId).toBe(kept);
    expect(first.diagnostics.clientRequestId).toBe(kept);
    expect(invoke.mock.calls[1][1].body.clientRequestId).toBe('00000000-0000-4000-8000-000000000001');
    expect(second.diagnostics.clientRequestId).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('still refuses a wrong-project question before any request, cancelled or not', async () => {
    // Real timers: an unhandled rejection is only reported once the event loop turns.
    jest.useRealTimers();
    const invoke = jest.fn();
    const getSession = jest.fn();
    const controller = new AbortController();
    controller.abort();
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await expect(ask({
        client: client(invoke, getSession),
        projectId: 'project-2321',
        projectName: '2321 Compliance Project',
        question: 'How thick is the new concrete on the north side of 2375?',
        knownProjectNames: ['2321 Compliance Project', '2375 Compliance Project'],
        signal: controller.signal,
      })).rejects.toMatchObject({ code: 'project_reference_mismatch' });
      await new Promise(resolve => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', unhandled);
    }
    expect(getSession).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('offers a retry unless the question or the project has to change first', () => {
    expect(ecosAskCanRetry(new ECOSProjectQuestionError('question_timed_out', 'x'))).toBe(true);
    expect(ecosAskCanRetry(new ECOSAskStoppedError('question_cancelled'))).toBe(true);
    expect(ecosAskCanRetry(new ECOSProjectQuestionError('request_failed', 'x'))).toBe(true);
    expect(ecosAskCanRetry(new ECOSProjectQuestionError('answer_timed_out', 'x'))).toBe(true);
    expect(ecosAskCanRetry(new Error('anything else'))).toBe(true);
    for (const code of ['project_reference_mismatch', 'project_required', 'question_required', 'question_too_long']) {
      expect(ecosAskCanRetry(new ECOSProjectQuestionError(code, 'x'))).toBe(false);
    }
  });
});

describe('the wait both screens share', () => {
  const IDENTITY = ['project-2375', QUESTION, 'conversation-1', undefined] as const;
  /** A request that records what it was given and never answers unless told to. */
  function recorder() {
    const controls: ECOSAskControl[] = [];
    const answers: Array<(value: string) => void> = [];
    const failures: Array<(error: Error) => void> = [];
    const request = (control: ECOSAskControl) => {
      controls.push(control);
      return new Promise<string>((resolve, reject) => {
        answers.push(resolve);
        failures.push(reject);
      });
    };
    return { controls, answers, failures, request };
  }

  it('ends a request that never comes back at the time limit, and aborts it', async () => {
    const wait = createECOSAskWait();
    const { controls, request } = recorder();
    const state = watch(wait.run(IDENTITY, request));
    await jest.advanceTimersByTimeAsync(ECOS_ASK_DEADLINE_MS - 1);
    expect(state.settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(state.error).toBeInstanceOf(ECOSAskStoppedError);
    expect(state.error).toMatchObject({ code: 'question_timed_out', message: ecosAskTimedOutMessage() });
    expect(isECOSAskStopped(state.error)).toBe(true);
    expect(controls[0].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('returns control at once on cancel, and aborts the request', async () => {
    const wait = createECOSAskWait();
    const { controls, request } = recorder();
    const state = watch(wait.run(IDENTITY, request));
    await jest.advanceTimersByTimeAsync(20_000);
    wait.cancel();
    await jest.advanceTimersByTimeAsync(0);
    expect(state.error).toMatchObject({ code: 'question_cancelled', message: ECOS_ASK_STOPPED_MESSAGE });
    expect(controls[0].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['time-out', 'cancel', 'project or account change'])('never hands back an answer that arrives after a %s', async kind => {
    const wait = createECOSAskWait();
    const { answers, request } = recorder();
    const state = watch(wait.run(IDENTITY, request));
    await jest.advanceTimersByTimeAsync(1_000);
    if (kind === 'cancel') wait.cancel();
    if (kind === 'project or account change') wait.reset();
    await jest.advanceTimersByTimeAsync(kind === 'time-out' ? ECOS_ASK_DEADLINE_MS : 0);
    const stoppedWith = state.error;
    expect(isECOSAskStopped(stoppedWith)).toBe(true);

    answers[0]('A late answer');
    await jest.advanceTimersByTimeAsync(0);
    expect(state.value).toBeUndefined();
    expect(state.error).toBe(stoppedWith);
  });

  it('hands back an answer that comes in time, and a refusal as it is', async () => {
    const wait = createECOSAskWait();
    const { answers, failures, request } = recorder();
    const answered = watch(wait.run(IDENTITY, request));
    answers[0]('In time');
    await jest.advanceTimersByTimeAsync(0);
    expect(answered.value).toBe('In time');

    const refused = watch(wait.run(IDENTITY, request));
    const refusal = new ECOSProjectQuestionError('answer_provider_unavailable', 'Try again shortly.');
    failures[1](refusal);
    await jest.advanceTimersByTimeAsync(0);
    expect(refused.error).toBe(refusal);
    expect(isECOSAskStopped(refusal)).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['time-out', 'cancel'])('repeats the request id when the same question is asked again after a %s', async kind => {
    const wait = createECOSAskWait();
    const { controls, request } = recorder();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = watch(wait.run(IDENTITY, request));
      if (kind === 'cancel') wait.cancel();
      await jest.advanceTimersByTimeAsync(kind === 'cancel' ? 0 : ECOS_ASK_DEADLINE_MS);
      expect(isECOSAskStopped(state.error)).toBe(true);
    }
    expect(controls.map(control => control.clientRequestId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
    ]);
    // Each try has its own stop switch.
    expect(new Set(controls.map(control => control.signal)).size).toBe(3);
  });

  it.each<[string, readonly unknown[]]>([
    ['a different question', ['project-2375', 'And the south side?', 'conversation-1', undefined]],
    ['another project', ['project-2321', QUESTION, 'conversation-1', undefined]],
    ['another conversation', ['project-2375', QUESTION, 'conversation-2', undefined]],
    ['a later turn of the conversation', ['project-2375', QUESTION, 'conversation-1', 'turn-1']],
  ])('uses a new request id for %s', async (_name, identity) => {
    const wait = createECOSAskWait();
    const { controls, request } = recorder();
    const first = watch(wait.run(IDENTITY, request));
    await jest.advanceTimersByTimeAsync(ECOS_ASK_DEADLINE_MS);
    expect(isECOSAskStopped(first.error)).toBe(true);
    watch(wait.run(identity, request));
    expect(controls[1].clientRequestId).not.toBe(controls[0].clientRequestId);
  });

  it.each(['answered', 'refused'])('forgets the request id once the server has %s the retry', async kind => {
    const wait = createECOSAskWait();
    const { controls, answers, failures, request } = recorder();
    watch(wait.run(IDENTITY, request));
    await jest.advanceTimersByTimeAsync(ECOS_ASK_DEADLINE_MS);
    const retry = watch(wait.run(IDENTITY, request));
    expect(controls[1].clientRequestId).toBe(controls[0].clientRequestId);
    if (kind === 'answered') answers[1]('Answer');
    else failures[1](new ECOSProjectQuestionError('question_in_progress', 'ECOS is already reviewing that question.'));
    await jest.advanceTimersByTimeAsync(0);
    expect(retry.settled).toBe(true);

    watch(wait.run(IDENTITY, request));
    expect(controls[2].clientRequestId).not.toBe(controls[0].clientRequestId);
  });

  it('forgets the request id on a project or account change, even one in the same moment as a cancel', async () => {
    const wait = createECOSAskWait();
    const { controls, request } = recorder();
    watch(wait.run(IDENTITY, request));
    wait.cancel();
    wait.reset();
    await jest.advanceTimersByTimeAsync(0);
    watch(wait.run(IDENTITY, request));
    expect(controls[1].clientRequestId).not.toBe(controls[0].clientRequestId);

    wait.reset();
    await jest.advanceTimersByTimeAsync(0);
    expect(controls[1].signal.aborted).toBe(true);
    watch(wait.run(IDENTITY, request));
    expect(controls[2].clientRequestId).not.toBe(controls[1].clientRequestId);
  });

  it('stops the earlier question when another is asked, without keeping its request id', async () => {
    const wait = createECOSAskWait();
    const { controls, answers, request } = recorder();
    const first = watch(wait.run(IDENTITY, request));
    const second = watch(wait.run(['project-2375', 'And the south side?', 'conversation-1', undefined], request));
    await jest.advanceTimersByTimeAsync(0);
    expect(first.error).toMatchObject({ code: 'question_cancelled' });
    expect(controls[0].signal.aborted).toBe(true);
    expect(second.settled).toBe(false);
    expect(controls[1].signal.aborted).toBe(false);

    // The earlier question's late answer goes nowhere; the later one's is handed back.
    answers[0]('Late answer to the first');
    answers[1]('Answer to the second');
    await jest.advanceTimersByTimeAsync(0);
    expect(first.value).toBeUndefined();
    expect(second.value).toBe('Answer to the second');

    watch(wait.run(IDENTITY, request));
    expect(controls[2].clientRequestId).not.toBe(controls[0].clientRequestId);
  });

  it('ends at the limit even when the request ignores its stop switch and when it throws at once', async () => {
    const wait = createECOSAskWait(30_000);
    const ignoring = watch(wait.run(IDENTITY, () => never<string>()));
    await jest.advanceTimersByTimeAsync(30_000);
    expect(ignoring.error).toMatchObject({ code: 'question_timed_out', message: ecosAskTimedOutMessage(30_000) });

    const boom = new Error('The desktop cloud connection is not configured.');
    await expect(wait.run(IDENTITY, () => { throw boom; })).rejects.toBe(boom);
    expect(jest.getTimerCount()).toBe(0);
  });
});
