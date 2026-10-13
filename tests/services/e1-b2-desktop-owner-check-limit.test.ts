/**
 * Build 231 E1 item 2 (review pass 2, R10 desktop): the owner check that runs
 * before a desktop Ask ECOS question (createDAVEWebSupabaseGateway
 * .askAuthorizedProjectQuestion) when its own request never comes back.
 * Every later question waited on that same check and stopped at the 150 s
 * limit, until the page was reloaded.
 */
import {
  ECOS_ASK_DEADLINE_MS,
  ECOS_ASK_OWNER_CHECK_LIMIT_MS,
  ecosAskOwnerCheckTimedOutMessage,
} from '../../services/ECOSAskProgress';
import { createECOSAskWait, isECOSAskStopped } from '../../services/ECOSAskWait';
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { ecosAskCanRetry } from '../../services/ECOSProjectQuestion';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('expo-crypto', () => {
  let count = 0;
  return { randomUUID: () => `00000000-0000-4000-8000-${String(++count).padStart(12, '0')}` };
});

const INPUT = { projectId: 'project-2375', projectName: '2375 Compliance Project', question: 'How thick is the north side concrete?' };

/** A cloud whose owner checks answer only when the test says so; the question itself is answered at once with an error the test can see. */
function cloud() {
  const ownerChecks: Array<() => void> = [];
  const invocations: Array<{ body: Record<string, unknown> }> = [];
  const client = {
    auth: {
      getUser: () => new Promise(resolve => {
        ownerChecks.push(() => resolve({ data: { user: { id: 'owner-1' } }, error: null }));
      }),
      getSession: async () => ({ data: { session: { access_token: 'token' } }, error: null }),
    },
    rpc: async () => ({ data: true, error: null, status: 200 }),
    functions: {
      invoke: async (_name: string, options: { body: Record<string, unknown> }) => {
        invocations.push(options);
        return { data: null, error: new Error('refused'), response: new Response(JSON.stringify({ error: 'sent_to_server' }), { status: 500 }) };
      },
    },
  };
  const gateway = createDAVEWebSupabaseGateway(client as never);
  const wait = createECOSAskWait();
  const ask = () => wait.run([INPUT.projectId, INPUT.question], control => gateway.askAuthorizedProjectQuestion({ ...INPUT, ...control }))
    .then(() => 'answered', (error: Error & { code?: string }) => error);
  return { ownerChecks, invocations, wait, ask, gateway };
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('E1 item 2: the desktop owner check before an Ask ECOS question has its own time limit', () => {
  it('is 20 seconds, well inside the 150 s the whole question may take', () => {
    expect(ECOS_ASK_OWNER_CHECK_LIMIT_MS).toBe(20_000);
    expect(ECOS_ASK_OWNER_CHECK_LIMIT_MS).toBeLessThan(ECOS_ASK_DEADLINE_MS / 5);
    expect(ecosAskOwnerCheckTimedOutMessage()).toBe(
      'The sign-in check did not answer within 20 s, so the question was not sent. ' +
      'No answer has been verified. Your question is still here — try again.',
    );
  });

  it('a check that never answers ends the question at 20 s (was 150 s), with nothing sent', async () => {
    const { ownerChecks, invocations, ask } = cloud();
    const first = ask();
    await jest.advanceTimersByTimeAsync(ECOS_ASK_OWNER_CHECK_LIMIT_MS - 1);
    expect(ownerChecks).toHaveLength(1);
    let settled = false;
    void first.then(() => { settled = true; });
    await jest.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const error = await first as Error & { code?: string };
    expect(error).toMatchObject({ code: 'owner_check_timed_out', message: ecosAskOwnerCheckTimedOutMessage() });
    // Nothing was sent: the conversation stands, as for a stopped question, and Try Again is offered.
    expect(isECOSAskStopped(error)).toBe(true);
    expect(ecosAskCanRetry(error)).toBe(true);
    expect(invocations).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('the next question starts a new check (was: waited on the same one until reload) and is sent when it answers', async () => {
    const { ownerChecks, invocations, ask } = cloud();
    const first = ask();
    await jest.advanceTimersByTimeAsync(ECOS_ASK_OWNER_CHECK_LIMIT_MS);
    await expect(first).resolves.toMatchObject({ code: 'owner_check_timed_out' });

    const second = ask();
    await jest.advanceTimersByTimeAsync(0);
    expect(ownerChecks).toHaveLength(2);
    ownerChecks[1]();
    await jest.advanceTimersByTimeAsync(0);
    await expect(second).resolves.toMatchObject({ code: 'sent_to_server' });
    expect(invocations).toHaveLength(1);
    expect(invocations[0].body).toMatchObject({ projectId: INPUT.projectId, question: INPUT.question });

    // The first check answering at last sends nothing for the question that gave up on it.
    ownerChecks[0]();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(invocations).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('the limit belongs to the check: a question stopped and asked again waits only for what is left of it', async () => {
    const { ownerChecks, invocations, wait, ask } = cloud();
    const first = ask();
    await jest.advanceTimersByTimeAsync(12_000);
    wait.cancel();
    await expect(first).resolves.toMatchObject({ code: 'question_cancelled' });

    const second = ask();
    await jest.advanceTimersByTimeAsync(7_999);
    expect(ownerChecks).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toMatchObject({ code: 'owner_check_timed_out' });

    const third = ask();
    await jest.advanceTimersByTimeAsync(0);
    expect(ownerChecks).toHaveLength(2);
    ownerChecks[1]();
    await jest.advanceTimersByTimeAsync(0);
    await expect(third).resolves.toMatchObject({ code: 'sent_to_server' });
    expect(invocations).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  // Guards: these already hold on 594a71d.
  it('a check that answers inside the limit sends the question and leaves no timer', async () => {
    const { ownerChecks, invocations, ask } = cloud();
    const first = ask();
    await jest.advanceTimersByTimeAsync(15_000);
    ownerChecks[0]();
    await jest.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toMatchObject({ code: 'sent_to_server' });
    expect(invocations).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a kept owner check answers the next question with no check and no timer', async () => {
    const { ownerChecks, invocations, ask } = cloud();
    const first = ask();
    await jest.advanceTimersByTimeAsync(0);
    ownerChecks[0]();
    await jest.advanceTimersByTimeAsync(0);
    await first;
    const second = ask();
    await jest.advanceTimersByTimeAsync(0);
    await second;
    expect(ownerChecks).toHaveLength(1);
    expect(invocations).toHaveLength(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('other desktop reads still share one owner check while it is on its way', async () => {
    const { ownerChecks, gateway } = cloud();
    const one = gateway.authorizedOwnerId();
    const two = gateway.authorizedOwnerId();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(ownerChecks).toHaveLength(1);
    ownerChecks[0]();
    await expect(Promise.all([one, two])).resolves.toEqual(['owner-1', 'owner-1']);
  });
});
